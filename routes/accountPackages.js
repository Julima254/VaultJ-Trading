const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Transaction = require('../models/transaction');

// Middleware to ensure user is logged in
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

// Define the packages
const packages = [
    { name: 'Starter', cost: 100 },
    { name: 'Bronze', cost: 200 },
    { name: 'Silver', cost: 500 },
    { name: 'Gold', cost: 1000 },
    { name: 'Platinum', cost: 2000 }
];

// GET /account-packages
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        res.render('account-packages', { packages, user });
    } catch (err) {
        console.log(err);
        req.flash('error', 'Unable to load packages');
        res.redirect('/home');
    }
});

// POST /account-packages/purchase/:packageName
router.post("/purchase/:packageName", isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const packages = {
            Starter: 100,
            Bronze: 200,
            Silver: 500,
            Gold: 1000,
            Platinum: 2000
        };
        const cost = packages[req.params.packageName];

        if (!cost) {
            req.flash("error", "Invalid package");
            return res.redirect("/account-packages");
        }

        if (user.depositBalance < cost) {
            req.flash("error", `You need at least KES ${cost} to purchase this package`);
            return res.redirect("/account-packages");
        }

        // Deduct cost and assign package
        user.depositBalance -= cost;
        user.package = req.params.packageName;
        await user.save();

        req.flash("success", `You purchased the ${req.params.packageName} package`);
        res.redirect("/account-packages");

    } catch (err) {
        console.error(err);
        req.flash("error", "Something went wrong");
        res.redirect("/account-packages");
    }
});

module.exports = router;
