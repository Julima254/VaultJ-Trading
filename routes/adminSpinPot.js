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
    try {

        const spinPot = await SpinPot.findOne();

        const spins = await Spin.find()
            .populate("user", "username email")
            .sort({ createdAt: -1 });

        // 🔹 Calculate total deducted from users
        const totalDeducted = spins.reduce((sum, spin) => {
            return sum + spin.betAmount;
        }, 0);

        res.render("admin/spinPot", {
            spinPot,
            spins,
            totalDeducted
        });

    } catch (err) {
        console.error(err);
        req.flash("error", "Failed to load spin dashboard");
        res.redirect("/admin");
    }
});

// POST update spin pot
router.post("/update", isAdmin, async (req, res) => {
    try {

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

    } catch (err) {
        console.error(err);
        req.flash("error", "Failed to update spin pot");
        res.redirect("/admin/spins");
    }
});

// RESET TOTAL DEDUCTED (delete spin history)
router.post("/reset-deducted", isAdmin, async (req, res) => {
    try {

        await Spin.deleteMany({});

        req.flash("success", "Total deducted reset successfully");
        res.redirect("/admin/spins");

    } catch (err) {
        console.error(err);
        req.flash("error", "Failed to reset deducted amount");
        res.redirect("/admin/spins");
    }
});

module.exports = router;