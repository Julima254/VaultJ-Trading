require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const passport = require("passport");
const session = require("express-session");
const flash = require("connect-flash");
const User = require("./models/user"); 
const Transaction = require("./models/transaction");
const adminRoutes = require("./routes/admin");
const { stkPush } = require("./services/daraja");
const adminPaymentsRoutes = require('./routes/adminPayments');
const accountPackagesRoutes = require('./routes/accountPackages');
const adminReferralsRoutes = require('./routes/adminReferrals');
const teamRoutes = require('./routes/team');
const profileRoutes = require('./routes/profile');
const transactionRoutes = require('./routes/transaction');
const adminPackages = require('./routes/adminPackages');
const adminSettingsRoutes = require('./routes/adminSettings');



const app = express();


// Middleware
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(bodyParser.urlencoded({
    extended: true
}));


// Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use("/admin", adminRoutes);

// Make user info & flash messages available in all EJS templates
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.error = req.flash("error");
    res.locals.success = req.flash("success");
    next();
});

//MongoDB Connection 
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB!");
}).catch(err => {
    console.log("MongoDB connection error:", err);
});


//Passport Config
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Routes
app.get("/", function(req, res){
    res.render("landing");
});

// ===== REGISTER =====
app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/register", async (req, res) => {
    try {
        const { username, email, phone, country, invitationCode, password } = req.body;

        // Optional: handle invitation code logic here
        let referrer = null;
        if (invitationCode) {
            const inviter = await User.findOne({ username: invitationCode });
            if (inviter) referrer = inviter._id;
        }

        const newUser = new User({
            username,
            email,
            phone,
            country,
            invitationCode: invitationCode || null,
            referrer: referrer
        });

        await User.register(newUser, password); // passport-local-mongoose handles hashing
        req.flash("success", "Registered successfully! You can now login.");
        res.redirect("/login");
    } catch (err) {
        console.log(err);
        req.flash("error", err.message);
        res.redirect("/register");
    }
});

//LOGIN 
app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login",
    passport.authenticate("local", {
        successRedirect: "/home", 
        failureRedirect: "/login",
        failureFlash: true
    })
);

//  LOGOUT 
app.get("/logout", (req, res) => {
    req.logout(err => {
        if (err) return next(err);
        req.flash("success", "Logged out successfully.");
        res.redirect("/");
    });
});

// FORGOT PASSWORD 
app.get("/forgot", (req, res) => {
    res.render("forgot");
});

app.post("/forgot", async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const user = await User.findOne({ email: email });
        if (!user) {
            req.flash("error", "Email not found.");
            return res.redirect("/forgot");
        }

        await user.setPassword(newPassword); // passport-local-mongoose method
        await user.save();
        req.flash("success", "Password reset successfully! You can now login.");
        res.redirect("/login");
    } catch (err) {
        console.log(err);
        req.flash("error", "Something went wrong.");
        res.redirect("/forgot");
    }
});


app.get("/home", isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        // Count total referrals
        const totalReferrals = await User.countDocuments({ referrer: user._id });

        // Fetch last 10 transactions
        const transactions = await Transaction.find({ user: user._id })
            .sort({ createdAt: -1 })
            .limit(10);

        // Calculate wallet balance dynamically
       // Wallet balance includes deposits + referral earnings only if a package is purchased
const walletBalance = (user.package === 'None') 
    ? 0 
    : (user.depositBalance || 0) + (user.referralEarnings || 0);


        res.render("home", {
            user,
            totalReferrals,
            transactions,
            walletBalance
        });
    } catch (err) {
        console.error(err);
        req.flash("error", "Cannot load home page");
        res.redirect("/login");
    }
});




// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash("error", "Please login first");
    res.redirect("/login");
}

//deposit
// deposit page
app.get("/deposit", isLoggedIn, async (req, res) => {
    try {
        const deposits = await Transaction.find({
            user: req.user._id,
            type: "deposit"
        }).sort({ createdAt: -1 });

        // pass user too
        res.render("deposit", { deposits, user: req.user });
    } catch (err) {
        console.error(err);
        req.flash("error", "Unable to load deposits");
        res.redirect("/home");
    }
});




//daraja payment route
app.post("/deposit", isLoggedIn, async (req, res) => {
  try {
    const { phone, amount, acknowledge } = req.body;

    if (!acknowledge) {
      req.flash("error", "You must acknowledge the no-reversal policy.");
      return res.redirect("/deposit");
    }

    // Save transaction
    await Transaction.create({
      user: req.user._id,
      type: "deposit",
      phone,
      amount,
      status: "pending"
    });

    // Trigger MPESA
    await stkPush(phone, amount);

    req.flash("success", "Payment request sent. Enter M-Pesa PIN.");
    res.redirect("/deposit");

  } catch (error) {
    console.error(error.response?.data || error.message);
    req.flash("error", "Payment failed. Try again.");
    res.redirect("/deposit");
  }
});

// MPESA CALLBACK 
app.post("/mpesa/callback", (req, res) => {
    console.log("MPESA CALLBACK RECEIVED");
    console.log(JSON.stringify(req.body, null, 2));

    // Always respond with success to Safaricom
    res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
    });});


app.use('/admin', adminPaymentsRoutes);
app.use('/account-packages', accountPackagesRoutes);
app.use('/admin/referrals', adminReferralsRoutes);
app.use('/team', teamRoutes);
app.use('/profile', profileRoutes);
app.use('/transactions', transactionRoutes);
app.use('/admin', adminPackages);
app.use('/admin/settings', adminSettingsRoutes);





// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});