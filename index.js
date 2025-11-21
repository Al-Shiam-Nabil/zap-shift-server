const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 3000;
require("dotenv").config();

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

app.get("/", (req, res) => {
  res.json({ message: "welcome to zap shift server." });
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const database = client.db("zap-shift-db");
    const parcelCollection = database.collection("zapParcels");

    app.get("/parcels", async (req, res) => {
      const { email } = req.query;
      const query = {};

      if (email) {
        query.senderEmail = email;
      }
      const sortField={created_at:-1}
      const cursor = parcelCollection.find(query).sort(sortField);
      const result = await cursor.toArray();

      res.json(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.created_at=new Date()

      const result = await parcelCollection.insertOne(parcel);

      res.json(result);
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
