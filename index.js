const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
require("dotenv").config();

// firebase admin sdk

const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-auth-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// tracking id function
const crypto = require("crypto");

function generateTrackingId() {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `TRK-${random}`;
}
// mongodb uri
const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// middleware
app.use(cors());
app.use(express.json());

const verifyFbToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access." });
  }
  const idToken = token.split(" ")[1];
  console.log(idToken);
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    console.log(decoded);
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access." });
  }
};

app.get("/", (req, res) => {
  res.json({ message: "welcome to zap shift server." });
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const database = client.db("zap-shift-db");
    const parcelCollection = database.collection("zapParcels");
    const paymentCollection = database.collection("payments");
    const userCollection = database.collection("users");
    const riderCollection = database.collection("riders");

    // user related api
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const isExist = await userCollection.findOne({ email: user.email });

      if (isExist) {
        return res.send({ message: "user already exist." });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // rider related api
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();

      const result = await riderCollection.insertOne(rider);
      res.send(result);
    });

    // parcel related api
    app.get("/parcels", async (req, res) => {
      const { email } = req.query;
      const query = {};

      if (email) {
        query.senderEmail = email;
      }
      const sortField = { created_at: -1 };
      const cursor = parcelCollection.find(query).sort(sortField);
      const result = await cursor.toArray();

      res.json(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.created_at = new Date();

      const result = await parcelCollection.insertOne(parcel);

      res.json(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };

      const result = await parcelCollection.deleteOne(query);
      res.json(result);
    });

    // get percel by id

    app.get("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.json(result);
    });

    // payment related api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const amount = parseInt(paymentInfo?.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        customer_email: paymentInfo.sellerEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success/:sessionId", async (req, res) => {
      const { sessionId } = req.params;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);
      const transactionId = session.payment_intent;

      if (transactionId) {
        const query = { transactionId: transactionId };
        const isExist = await paymentCollection.findOne(query);

        if (isExist) {
          return res.send({
            message: "Already existed.",
            transactionId,
            trackingId: isExist.trackingId,
          });
        }
      }

      if (session.payment_status === "paid") {
        const trackingId = generateTrackingId();
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: { paymentStatus: session.payment_status, trackingId },
        };
        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          customerEmail: session.customer_email,
          currency: session.currency,
          amount: session.amount_total / 100,
          transactionId: session.payment_intent,
          paymentAt: new Date(),
          paymentStatus: session.payment_status,
          trackingId,
        };

        const paymentResult = await paymentCollection.insertOne(payment);
        res.send({
          success: true,
          updatedParcel: result,
          trackingId,
          transactionId: session.payment_intent,
          paymentInfo: paymentResult,
        });
      }
    });

    app.get("/payments", verifyFbToken, async (req, res) => {
      console.log(req.decoded_email);
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access." });
        }
      }

      const cursor = paymentCollection.find(query).sort({ paymentAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`App is listening on port : ${port}`);
});
