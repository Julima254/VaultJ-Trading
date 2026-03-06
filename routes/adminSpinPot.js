const express = require("express");
const router = express.Router();
const SpinPot = require("../models/spinPot");
const Spin = require("../models/spin");

// Admin guard
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user?.isAdmin) return next();
    req.flash("error", "Access denied");
    res.redirect("/home");
}

// GET admin spin dashboard
router.get("/", isAdmin, async (req, res) => {
    const spinPot = await SpinPot.findOne();
    const spins = await Spin.find().populate("user", "username email").sort({ createdAt: -1 });
    res.render("admin/spinPot", { spinPot, spins });
});

// POST update spin pot
router.post("/update", isAdmin, async (req, res) => {
    const { totalAmount } = req.body;
    let spinPot = await SpinPot.findOne();
    if (!spinPot) {
        spinPot = await SpinPot.create({ totalAmount });
    } else {
        spinPot.totalAmount = totalAmount;
        await spinPot.save();
    }
    req.flash("success", "Spin pot updated");
    res.redirect("/admin/spins");
});

module.exports = router;