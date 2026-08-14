require('dotenv').config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const connectDB = require("./config/db");
const indexRoutes = require("./routes/index");
const homeRoutes = require("./routes/home");
const depositRoutes = require("./routes/deposit");
const packagesRoutes = require("./routes/packages");
const adminRoutes = require("./routes/admin");
const vaultJspinsRoutes = require("./routes/vaultJspins");
const teamRoutes = require("./routes/team");
const withdrawRoutes = require("./routes/withdraw");
const darajaCallbackRoutes = require("./routes/darajaCallbacks");

const app = express();

// Connect to MongoDB
connectDB();

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions (stored in MongoDB)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
  }
}));

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Static files
app.use(express.static(path.join(__dirname, "public")));


// app.js — add after session middleware, before routes
const User = require("./models/User");

app.use(async (req, res, next) => {
  res.locals.user = null;
  res.locals.currentPage = ""; // used for active nav highlighting

  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId).lean();
      res.locals.user = user;
    } catch (err) {
      console.error("Error loading user for locals:", err);
    }
  }
  next();
});


// Routes
app.use("/", indexRoutes);
app.use("/", homeRoutes);
app.use("/", depositRoutes);
app.use("/", packagesRoutes);
app.use("/", adminRoutes);
app.use("/", require("./routes/adminPayments"));
app.use("/", vaultJspinsRoutes);
app.use("/", teamRoutes);
app.use("/", withdrawRoutes);
app.use("/", darajaCallbackRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));