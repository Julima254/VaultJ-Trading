const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Spin = require("../models/spin");
const SpinPot = require("../models/spinPot");

// Logged-in middleware
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash("error", "Please login first");
    res.redirect("/login");
}

// GET spin page
router.get("/", isLoggedIn, async (req, res) => {
    if (!req.user.package || req.user.package === "None") {
        req.flash("error", "You must purchase a package to spin.");
        return res.redirect("/account-packages");
    }
    res.render("spin", { 
        walletBalance: req.user.walletBalance,
        user: req.user,
        currentUser: req.user
    });
});

// POST spin
router.post("/play", isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
       const spinPot = await SpinPot.findOne();
if (!spinPot) {
    spinPot = await SpinPot.create({ totalAmount: 5000 }); // auto-create
}

        let { betAmount } = req.body;
        betAmount = Number(betAmount);

        // Validate bet
        if (betAmount < 10 || betAmount > 2000)
            return res.json({ success: false, message: "Bet amount must be between 10 and 2000" });
        if (betAmount > user.walletBalance)
            return res.json({ success: false, message: "Insufficient wallet balance" });
        if (!user.package || user.package === "None")
            return res.json({ success: false, message: "You must purchase a package to spin" });

        // Deduct bet
        user.walletBalance -= betAmount;
        await user.save();

        // Wheel logic
        
            const wheel = [
    { multiplier: 0, chance: 90 },   // 90% chance
    { multiplier: 0.5, chance: 4 },  // 4%
    { multiplier: 1, chance: 3 },    // 3%
    { multiplier: 2, chance: 2 },    // 2%
    { multiplier: 5, chance: 0.9 },  // 0.9%
    { multiplier: 10, chance: 0.1 }  // 0.1%
];

        let rand = Math.random() * 100;
        let cumulative = 0;
        let selectedMultiplier = 0;
        for (let segment of wheel) {
            cumulative += segment.chance;
            if (rand <= cumulative) {
                selectedMultiplier = segment.multiplier;
                break;
            }
        }

        let reward = Math.min(betAmount * selectedMultiplier, spinPot.totalAmount);

        // Deduct reward from spin pot
        spinPot.totalAmount -= reward;
        await spinPot.save();

        // Add reward to user wallet
        if (reward > 0) {
    user.walletBalance += reward; // Main balance for future bets/withdrawals
    user.spinningBalance = (user.spinningBalance || 0) + reward; // Total winnings log
}

await user.save(); // Essential: Save the changes to MongoDB


        // Save spin record
        await Spin.create({
            user: user._id,
            betAmount,
            multiplier: selectedMultiplier,
            reward,
            status: "claimed"
        });

        // Return JSON
       return res.json({
    success: true,
    multiplier: selectedMultiplier,
    reward,
    walletBalance: user.walletBalance,
    spinningBalance: user.spinningBalance || 0
});

    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: err.message || "Something went wrong" });
    }
});


// GET spin pot amount
router.get('/pot', async (req, res) => {
    try {
        let spinPot = await SpinPot.findOne();
        // If no SpinPot exists, create one with a default value
        if (!spinPot) {
            spinPot = await SpinPot.create({ totalAmount: 5000 }); // initial pot
            console.log("SpinPot initialized with 5000");
        }
        res.json({ totalAmount: spinPot.totalAmount });
    } catch(err) {
        console.error(err);
        res.json({ totalAmount: 0 });
    }
});

module.exports = router;