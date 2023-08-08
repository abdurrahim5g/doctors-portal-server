const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();
// Stripe for payment
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

/**
 *
 * Verify token
 * ======================
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  // console.log(authHeader);
  if (!authHeader) {
    res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader?.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
  // console.log(token);
};

const run = async () => {
  try {
    /**
     * All collection in here
     * ==========================
     * => appointmentCollection
     * => bookingsCollection
     * => usersCollection
     * => doctorsCollection
     */
    const appointmentCollections = client
      .db("doctorsAppointment")
      .collection("appointmentCollections");
    const bookingsCollection = client
      .db("doctorsAppointment")
      .collection("bookings");
    const usersCollection = client.db("doctorsAppointment").collection("users");
    const doctorsCollection = client
      .db("doctorsAppointment")
      .collection("doctors");
    const paymentsCollection = client
      .db("doctorsAppointment")
      .collection("payments");

    /**
     * Veryfy Admin
     * =========================
     */
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const filter = { email: decodedEmail };
      const user = await usersCollection.findOne(filter);
      if (user?.role !== "admin") {
        res.status(401).send({ message: "4Ø1 Unauthorized" });
      }
      if (user?.role === "admin") {
        next();
      }
    };

    // get app the appointmentOptions
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      // console.log(date);
      const query = {};
      const appointmentOptions = await appointmentCollections
        .find(query)
        .toArray();

      const bookingQuery = { appointmentDate: date };
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
      // console.log(date);
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
                      $eq: ["$appointmentDate", date],
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
              price: 1,
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
              price: 1,
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
     * Get speciality
     * =====================
     * app.get("/speciality")         => Get doctors speciality
     *
     */
    app.get("/speciality", verifyToken, verifyAdmin, async (req, res) => {
      const filter = {};
      const result = await appointmentCollections
        .find(filter)
        .project({ name: 1 }) // [ .project({name: 1}) ] => IN the same line project should be write without $sign
        .toArray();
      // console.log(result);
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

    // GET request for bookings
    app.get("/bookings", verifyToken, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const myBookings = await bookingsCollection
        .find({ email: email })
        .toArray();
      res.send(myBookings);
    });

    // GET Single bookings
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(filter);
      res.send(result);
    });

    // Post request for bookings
    app.post("/bookings", async (req, res) => {
      const bookingInfo = req.body;

      // console.log(bookingInfo);

      const alreadyBooked = await bookingsCollection
        .find({
          appointmentDate: bookingInfo.appointmentDate,
          tritmentName: bookingInfo.tritmentName,
          email: bookingInfo.email,
        })
        .toArray();
      // if user book an appointment on this date
      if (alreadyBooked.length > 0) {
        return res.send({
          acknowledged: false,
          message: `Already booked an appoinement on ${bookingInfo.appointmentDate}`,
        });
      }

      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    });

    /**
     *
     * Stripe Payment APIs
     */
    app.post("/create-payment-intent", async (req, res) => {
      const price = req.body;
      const amount = price.price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        // paymentMethodTypes: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const paymentInfo = req.body;
      const result = await paymentsCollection.insertOne(paymentInfo);

      // Update the booking paid information
      const filter = { _id: new ObjectId(paymentInfo.bookingId) };
      await bookingsCollection.updateOne(
        filter,
        { $set: { paid: true } },
        { upsert: true }
      );

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

    // get all users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const result = await usersCollection.insertOne(userInfo);
      res.send(result);
    });

    /**
     * Handle Admin API
     * =============================
     * app.patch("/make-admin")       => Make admin
     * app.get("/user/admin/:email")  => check user isAdmin
     */

    // make admin with API
    app.patch("/make-admin", verifyToken, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const userFilter = { email: decodedEmail };
      const user = await usersCollection.findOne(userFilter);

      if (user?.role !== "admin") {
        return res.status(401).send({ message: "Admin can only make admin!" });
      }

      const id = req.query.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role: "admin" } };

      const result = await usersCollection.updateOne(query, updateDoc, {
        upsert: true,
      });
      res.send(result);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const filter = { email };
      const user = await usersCollection.findOne(filter);
      res.send({ isAdmin: user?.role === "admin" }); // return true; if user is admin
    });

    /**
     *
     * JWT = JSON web token
     * ========================
     */

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }
      res.status(403).send({ accessToken: null });
    });

    /**
     * doctors API
     * ====================
     * => app.get("/doctors")
     * => app.post("/doctors")
     *
     */

    app.get("/doctors", verifyToken, verifyAdmin, async (req, res) => {
      const filter = {};
      const doctors = await doctorsCollection.find(filter).toArray();
      res.send(doctors);
    });

    app.post("/doctors", verifyToken, verifyAdmin, async (req, res) => {
      const doctorInfo = req.body;
      console.log(doctorInfo);
      const result = await doctorsCollection.insertOne(doctorInfo);
      res.send(result);
    });

    app.delete("/doctors/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params;
      const filter = { _id: new ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send({ status: 200, result });
    });

    /**
     * Temprory API
     * ===================
     */
    // app.get("/update-price", async (req, res) => {
    //   const filter = {};
    //   const updateDoc = {
    //     $set: {
    //       price: 99,
    //     },
    //   };
    //   const option = {
    //     upsert: true,
    //   };

    //   const result = await appointmentCollections.updateMany(
    //     filter,
    //     updateDoc,
    //     option
    //   );
    //   res.send(result);
    // });

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
