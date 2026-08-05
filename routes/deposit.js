const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");
const { stkPush } = require("../services/daraja");

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash("error", "Please login first");
    res.redirect("/login");
}

// GET /deposit — show deposit page + history
router.get("/", isLoggedIn, async (req, res) => {
    try {
        const deposits = await Transaction.find({
            user: req.user._id,
            type: "deposit"
        }).sort({ createdAt: -1 });

        res.render("deposit", {
            user: req.user,
            deposits: deposits
        });
    } catch (err) {
        console.error("Error loading deposits:", err);
        req.flash("error", "Could not load transaction history.");
        res.redirect("/home");
    }
});

// POST /deposit — STK Push request
router.post("/", isLoggedIn, async (req, res) => {
    try {
        const { amount, phone } = req.body;
        const user = await User.findById(req.user._id);

        if (!amount || amount < 1) {
            req.flash("error", "Minimum deposit is KES 1");
            return res.redirect("/deposit");
        }

        let formattedPhone = phone.trim();
        if (formattedPhone.startsWith("0")) {
            formattedPhone = "254" + formattedPhone.slice(1);
        } else if (formattedPhone.startsWith("+")) {
            formattedPhone = formattedPhone.slice(1);
        }

        // 1. Attempt the STK push
        let stkResponse;
        let stkFailed = false;
        let failureReason = "";

        try {
            stkResponse = await stkPush(formattedPhone, parseFloat(amount));
        } catch (stkErr) {
            console.error("STK Push request failed:", stkErr.response?.data || stkErr.message);
            stkFailed = true;
            failureReason = stkErr.response?.data?.errorMessage || "Could not reach M-Pesa";
        }

        let checkoutRequestID = null;

        if (!stkFailed) {
            const { ResponseCode, CheckoutRequestID, ResponseDescription } = stkResponse.data;

            if (ResponseCode !== "0" && ResponseCode !== 0) {
                stkFailed = true;
                failureReason = ResponseDescription || "M-Pesa declined the request";
            } else {
                checkoutRequestID = CheckoutRequestID;
            }
        }

        // 2. Always create a transaction record — pending on success, failed on any error.
        // This guarantees every attempt shows up in recent transactions and admin payments,
        // even ones that never reached the user's phone.
        const newTx = await Transaction.create({
            user: user._id,
            amount: parseFloat(amount),
            phone: formattedPhone,
            type: "deposit",
            status: stkFailed ? "failed" : "pending",
            method: "stk",
            checkoutRequestID: checkoutRequestID, // null if the push never got a real one
            code: stkFailed ? failureReason.slice(0, 100) : undefined // stash the reason for visibility in admin panel
        });

        if (stkFailed) {
            req.flash("error", `Deposit failed: ${failureReason}`);
        } else {
            req.flash("success", "STK Push sent to your phone. Enter PIN to complete.");
        }

        res.redirect("/deposit");

    } catch (err) {
        console.error("Deposit Error:", err);
        req.flash("error", "Something went wrong. Please try again.");
        res.redirect("/deposit");
    }
});

// POST /deposit/manual — Paybill manual confirmation submission
router.post("/manual", isLoggedIn, async (req, res) => {
    try {
        const { amount, mpesaCode, phone } = req.body;
        const depositAmount = parseFloat(amount);

        if (!depositAmount || depositAmount < 1) {
            req.flash("error", "Please enter a valid amount.");
            return res.redirect("/deposit");
        }

        if (!mpesaCode || mpesaCode.trim().length < 5) {
            req.flash("error", "Please enter a valid M-Pesa confirmation code.");
            return res.redirect("/deposit");
        }

        await Transaction.create({
            user: req.user._id,
            amount: depositAmount,
            phone: phone || req.user.phone,
            type: "deposit",
            status: "pending",
            method: "paybill",
            code: mpesaCode.trim().toUpperCase()
        });

        req.flash("success", "Your Paybill deposit was submitted and is awaiting admin confirmation.");
        res.redirect("/deposit");

    } catch (err) {
        console.error("Manual Deposit Error:", err);
        req.flash("error", "Something went wrong. Please try again.");
        res.redirect("/deposit");
    }
});

module.exports = router;