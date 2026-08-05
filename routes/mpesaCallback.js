const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");

// POST /mpesa/callback — Daraja STK Push result
router.post("/callback", async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });

    try {
        const stkCallback = req.body &&
            req.body.Body &&
            req.body.Body.stkCallback;

        if (!stkCallback) {
            console.error("M-Pesa callback: unexpected payload shape", JSON.stringify(req.body));
            return;
        }

        const {
            CheckoutRequestID,
            ResultCode,
            ResultDesc
        } = stkCallback;

        if (!CheckoutRequestID) {
            console.error("M-Pesa callback: missing CheckoutRequestID");
            return;
        }

        const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID });

        if (!transaction) {
            console.error("M-Pesa callback: no matching transaction for", CheckoutRequestID);
            return;
        }

        if (transaction.status === "completed" || transaction.status === "failed") {
            console.log("M-Pesa callback: transaction already resolved, skipping", CheckoutRequestID);
            return;
        }

        if (ResultCode !== 0) {
            transaction.status = "failed";
            await transaction.save();
            console.log(`M-Pesa callback: transaction ${CheckoutRequestID} failed — ${ResultDesc}`);
            return;
        }

        const items = (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) || [];
        const getItem = (name) => {
            const found = items.find(i => i.Name === name);
            return found ? found.Value : null;
        };

        const mpesaReceipt = getItem("MpesaReceiptNumber");
        const amountPaid = getItem("Amount");

        transaction.status = "completed";
        if (mpesaReceipt) transaction.code = mpesaReceipt;
        await transaction.save();

        const user = await User.findById(transaction.user);
        if (user) {
            const creditAmount = amountPaid != null ? Number(amountPaid) : transaction.amount;

            // Core rule: inactive users (no package yet) get credited to depositBalance.
            // Once active (has purchased a package), all future deposits go to walletBalance.
            if (user.isActive) {
                user.walletBalance = (user.walletBalance || 0) + creditAmount;
            } else {
                user.depositBalance = (user.depositBalance || 0) + creditAmount;
            }

            await user.save();
            console.log(`M-Pesa callback: credited ${creditAmount} to user ${user._id} (${user.isActive ? "wallet" : "deposit"}), receipt ${mpesaReceipt}`);
        } else {
            console.error("M-Pesa callback: transaction has no matching user", transaction.user);
        }

    } catch (err) {
        console.error("M-Pesa callback processing error:", err);
    }
});

module.exports = router;