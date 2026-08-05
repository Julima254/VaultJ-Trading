require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const passport = require("passport");
const session = require("express-session");
const flash = require("connect-flash");

// Models
const User = require("./models/user"); 
const Transaction = require("./models/transaction");

// Routes
const adminRoutes = require("./routes/admin");
const adminPaymentsRoutes = require('./routes/adminPayments');
const accountPackagesRoutes = require('./routes/accountPackages');
const adminReferralsRoutes = require('./routes/adminReferrals');
const teamRoutes = require('./routes/team');
const profileRoutes = require('./routes/profile');
const transactionRoutes = require('./routes/transaction');
const adminPackages = require('./routes/adminPackages');
const adminSettingsRoutes = require('./routes/adminSettings');
const adminSpinRoutes = require('./routes/adminSpinPot');
const spinRouter = require('./routes/spin');
const coinRouter = require('./routes/coin');
const depositRoutes = require('./routes/deposit');
const mpesaCallbackRoutes = require('./routes/mpesaCallback');

const { stkPush } = require("./services/daraja");

const app = express();

// 1. Static & View Engine
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 2. Session Configuration (Must be before Passport and Flash)
app.use(session({
  secret: process.env.SESSION_SECRET || "vaultj_secret_key",
  resave: false,
  saveUninitialized: false
}));

// 3. Passport & Flash Initialization
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// 4. Global Variables Middleware (CRITICAL: Must be before Routes)
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    // req.flash() returns an array, EJS logic handles the display
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    next();
});

// 5. MongoDB Connection 
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("Connected to MongoDB!"))
.catch(err => console.log("MongoDB connection error:", err));

// 6. Passport Config
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// 7. Standard Routes
app.get("/", (req, res) => res.render("landing"));

app.get("/register", (req, res) => res.render("register"));
app.post("/register", async (req, res) => {
    try {
        const { username, email, phone, country, invitationCode, password } = req.body;
        let referrer = null;
        if (invitationCode) {
            const inviter = await User.findOne({ username: invitationCode });
            if (inviter) referrer = inviter._id;
        }
        const newUser = new User({ username, email, phone, country, invitationCode: invitationCode || null, referrer: referrer });
        await User.register(newUser, password);
        req.flash("success", "Registered successfully! You can now login.");
        res.redirect("/login");
    } catch (err) {
        req.flash("error", err.message);
        res.redirect("/register");
    }
});

app.get("/login", (req, res) => res.render("login"));
app.post("/login", passport.authenticate("local", {
    successRedirect: "/home", 
    failureRedirect: "/login",
    failureFlash: true
}));

app.get("/logout", (req, res) => {
    req.logout(err => {
        if (err) return next(err);
        req.flash("success", "Logged out successfully.");
        res.redirect("/");
    });
});

// 8. Logged-In User Routes
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash("error", "Please login first");
    res.redirect("/login");
}

// GET /forgot - Show the page
app.get("/forgot", (req, res) => {
    res.render("forgot"); 
});

app.get("/home", isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const totalReferrals = await User.countDocuments({ referrer: user._id });
        const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
        
        res.render("home", { 
            user, 
            totalReferrals, 
            transactions, 
            walletBalance: user.walletBalance || 0,
            // Ensure this matches your User schema field (coinsBalance)
            coinsBalance: user.coinsBalance || 0 
        });
    } catch (err) { res.redirect("/login"); }
});

// Withdrawal & Deposit Routes...
app.get("/withdraw", isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id);
    res.render("withdrawal", { user, walletBalance: user.walletBalance || 0 });
});

app.post("/withdraw", isLoggedIn, async (req, res) => {
    try {
        const { amount, phone } = req.body;
        const withdrawAmount = parseFloat(amount);
        const user = await User.findById(req.user._id);

        // 1. Validation
        if (!withdrawAmount || withdrawAmount <= 0) {
            req.flash("error", "Please enter a valid amount.");
            return res.redirect("/withdraw");
        }

        if (user.walletBalance < withdrawAmount) {
            req.flash("error", "Insufficient balance.");
            return res.redirect("/withdraw");
        }

        // 2. Deduct from balance immediately (Prevents double-spending)
        user.walletBalance -= withdrawAmount;
        await user.save();

        // 3. Create a Pending Transaction record
        await Transaction.create({
            user: user._id,
            amount: withdrawAmount,
            phone: phone || user.phone,
            type: "withdrawal",
            status: "pending" // Admin will approve this later in withdrawals.ejs
        });

        req.flash("success", "Withdrawal request submitted! Awaiting admin approval.");
        res.redirect("/home");

    } catch (err) {
        console.error(err);
        req.flash("error", "An error occurred during withdrawal.");
        res.redirect("/withdraw");
    }
});


// 9. API / Callback Routes
app.use("/mpesa", mpesaCallbackRoutes);

// Feature routes


// 10. Admin & Feature Routes (Organized)
// Main adminRoutes moved to top of admin section for priority
app.use("/admin", adminRoutes); 
app.use('/admin', adminPaymentsRoutes);
app.use('/admin/referrals', adminReferralsRoutes);
app.use('/admin/settings', adminSettingsRoutes);
app.use('/admin/spins', adminSpinRoutes);
app.use('/admin', adminPackages);
app.use('/deposit', depositRoutes);

// Feature routes
app.use('/account-packages', accountPackagesRoutes);
app.use('/team', teamRoutes);
app.use('/profile', profileRoutes);
app.use('/transactions', transactionRoutes);
app.use('/spins', spinRouter);
app.use('/coin', coinRouter);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));