const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.undypbz.mongodb.net/?retryWrites=true&w=majority`;
// console.log(uri);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Base api for checking api is running
app.get("/", (req, res) => {
  res.send("Doctors server is running");
});

const run = async () => {
  try {
    const appointmentCollections = client
      .db("doctorsAppointment")
      .collection("appointmentCollections");
    const bookingsCollection = client
      .db("doctorsAppointment")
      .collection("bookings");

    // get app the appointmentOptions
    app.get("/appointmentOptions", async (req, res) => {
      const query = {};
      const result = await appointmentCollections.find(query).toArray();
      res.send(result);
    });

    /**
     * API naming convension
     * get("/bookings")       => all bookings
     * get("/bookings/:id")   => single booking
     * post("/bookings")      => Post a booking
     * patch("/bookings/:id") => Update single booking
     * delete("/bookings/:id")=> Delete single booking
     */
    // Post a booking
    app.post("/bookings", async (req, res) => {
      const bookingInfo = req.body;
      // console.log(bookingInfo);
      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    });
  } finally {
    // Finally
  }
};
run().catch(console.dir);

// Listen
app.listen(port, () => {
  console.log(`Doctors server is running on port:${port}`);
});
