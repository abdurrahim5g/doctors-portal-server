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
    /**
     * All collection in here
     * ==========================
     * => appointmentCollection
     * => bookingsCollection
     * => usersCollection
     */
    const appointmentCollections = client
      .db("doctorsAppointment")
      .collection("appointmentCollections");
    const bookingsCollection = client
      .db("doctorsAppointment")
      .collection("bookings");
    const usersCollection = client.db("doctorsAppointment").collection("users");

    // get app the appointmentOptions
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      // console.log(date);
      const query = {};
      const appointmentOptions = await appointmentCollections
        .find(query)
        .toArray();

      const bookingQuery = { appointmentData: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();

      // Let's get only available slot
      appointmentOptions.forEach((option) => {
        const bookedOption = alreadyBooked.filter(
          (book) => book.tritmentName === option.name
        );
        const bookedSlots = bookedOption.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );

        option.slots = remainingSlots;
      });

      res.send(appointmentOptions);
    });

    // Use MongoDB Aggrigate
    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await appointmentCollections
        .aggregate([
          {
            $lookup: {
              from: "bookings", // this name should be MongoDB collection name
              localField: "name",
              foreignField: "tritmentName",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentData", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              slots: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();

      res.send(options);
    });

    /**
     * API naming convension
     * get("/bookings")       => all bookings
     * get("/bookings/:id")   => single booking
     * post("/bookings")      => Post a booking
     * patch("/bookings/:id") => Update single booking
     * delete("/bookings/:id")=> Delete single booking
     */

    // GET request for bookings
    app.get("/bookings", async (req, res) => {
      const query = req.query;
      const myBookings = await bookingsCollection.find(query).toArray();
      res.send(myBookings);
    });

    // Post request for bookings
    app.post("/bookings", async (req, res) => {
      const bookingInfo = req.body;

      console.log(bookingInfo);

      const alreadyBooked = await bookingsCollection
        .find({
          appointmentData: bookingInfo.appointmentData,
          tritmentName: bookingInfo.tritmentName,
          email: bookingInfo.email,
        })
        .toArray();
      // if user book an appointment on this date
      if (alreadyBooked.length > 0) {
        return res.send({
          acknowledged: false,
          message: `Already booked an appoinement on ${bookingInfo.appointmentData}`,
        });
      }

      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    });

    /**
     *
     * API naming convention for users
     * ===============================
     * app.get("/users")          => get all users
     * app.get("/users?email")    => get single user with email
     * app.post("/users")         => Added a user to the database
     * ===========================================================
     */

    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const result = await usersCollection.insertOne(userInfo);
      res.send(result);
    });

    /**
     * Try end here
     * ===================== */
  } finally {
    // Finally
  }
};
run().catch(console.dir);

// Listen
app.listen(port, () => {
  console.log(`Doctors server is running on port:${port}`);
});
