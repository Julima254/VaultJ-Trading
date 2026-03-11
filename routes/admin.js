const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");
const VaultCoin = require("../models/vaultCoin");
const CoinOrder = require("../models/coinOrder");

// ===== ADMIN GUARD =====
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user?.isAdmin) {
        return next();
    }
    req.flash("error", "Access denied");
    res.redirect("/home");
}

// ===== ADMIN DASHBOARD =====
router.get("/", isAdmin, async (req, res) => {
    try {
        // ===== USERS =====
        const totalUsers = await User.countDocuments();
        const starterUsers = await User.countDocuments({ package: "Starter" });
        const bronzeUsers = await User.countDocuments({ package: "Bronze" });
        const silverUsers = await User.countDocuments({ package: "Silver" });
        const goldUsers = await User.countDocuments({ package: "Gold" });
        const platinumUsers = await User.countDocuments({ package: "Platinum" });
        const activeUsers = await User.countDocuments({ isActive: true });

        // ===== TRANSACTIONS =====
        const transactions = await Transaction.find().populate("user", "username").sort({ createdAt: -1 });

        // ===== TOTAL DEPOSITS =====
        const now = new Date();
        const totalDeposits = {
            today: transactions
                .filter(tx => tx.type === "deposit" && tx.status === "completed" &&
                              new Date(tx.createdAt).toDateString() === now.toDateString())
                .reduce((sum, tx) => sum + tx.amount, 0),

            week: transactions
                .filter(tx => tx.type === "deposit" && tx.status === "completed" &&
                              (now - new Date(tx.createdAt)) / (1000 * 60 * 60 * 24) <= 7)
                .reduce((sum, tx) => sum + tx.amount, 0),

            month: transactions
                .filter(tx => tx.type === "deposit" && tx.status === "completed" &&
                              new Date(tx.createdAt).getMonth() === now.getMonth() &&
                              new Date(tx.createdAt).getFullYear() === now.getFullYear())
                .reduce((sum, tx) => sum + tx.amount, 0)
        };

        // ===== TOTAL PAYOUTS =====
        const totalPayoutsAgg = await Transaction.aggregate([
            { $match: { type: "withdrawal", status: "completed" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalPayouts = totalPayoutsAgg[0]?.total || 0;

        // ===== PENDING WITHDRAWALS =====
        const pendingWithdrawalsAgg = await Transaction.aggregate([
            { $match: { type: "withdrawal", status: "pending" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const pendingWithdrawals = pendingWithdrawalsAgg[0]?.total || 0;

        // ===== TOTAL COINS ISSUED (bonuses/referral earnings) =====
        const totalCoinsAgg = await Transaction.aggregate([
            { $match: { type: "bonus" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalCoinsIssued = totalCoinsAgg[0]?.total || 0;

        // ===== PLATFORM PROFIT =====
        // Profit = total deposits completed - total payouts completed
        const totalDepositAgg = await Transaction.aggregate([
            { $match: { type: "deposit", status: "completed" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalDepositsCompleted = totalDepositAgg[0]?.total || 0;
        const platformProfit = totalDepositsCompleted - totalPayouts;

        // ===== CHART DATA (dummy for now) =====
        const dailyDepositLabels = Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`);
        const dailyDepositData = [500, 1000, 750, 1200, 900, 1300, 700];

        const dailyWithdrawalLabels = Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`);
        const dailyWithdrawalData = [200, 400, 350, 300, 500, 450, 600];

        const coinPriceLabels = Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`);
        const coinPriceData = [1.2, 1.3, 1.25, 1.28, 1.35, 1.4, 1.38];

        // ===== RENDER ADMIN DASHBOARD =====
        res.render("admin", {
            totalUsers,
            activeUsers,
            starterUsers,
            bronzeUsers,
            silverUsers,
            goldUsers,
            platinumUsers,
            totalDeposits,
            totalPayouts,
            pendingWithdrawals,
            totalCoinsIssued,
            platformProfit,
            dailyDepositLabels,
            dailyDepositData,
            dailyWithdrawalLabels,
            dailyWithdrawalData,
            coinPriceLabels,
            coinPriceData,
            recentTransactions: transactions
        });

    } catch (err) {
        console.error(err);
        req.flash("error", "Cannot load admin dashboard");
        res.redirect("/home");
    }
});

// ===== GET ALL WITHDRAWALS =====
router.get("/withdrawals", isAdmin, async (req, res) => {
    try {
        const withdrawals = await Transaction.find({ type: "withdrawal" })
            .populate("user", "username phone walletBalance") // bring user info
            .sort({ createdAt: -1 });

       res.render("admin/adminWithdrawals", {
    withdrawals,
    success: req.flash("success"),
    error: req.flash("error")
});
    } catch (err) {
        console.error(err);
        req.flash("error", "Cannot load withdrawals");
        res.redirect("/admin");
    }
});

// APPROVE
const { b2cPayment } = require("../services/daraja"); // new B2C function

router.post("/withdrawals/:id/approve", isAdmin, async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id).populate("user");
        if (!transaction || transaction.status !== "pending") {
            req.flash("error", "Transaction not found or already processed.");
            return res.redirect("/admin/withdrawals");
        }

        // Call B2C API here
        const result = await b2cPayment(transaction.phone, transaction.amount);

        transaction.status = "completed";
        transaction.b2cReceipt = result.MpesaReceiptNumber; // save receipt number
        await transaction.save();

        req.flash("success", `Payment sent to ${transaction.user.username}`);
        res.redirect("/admin/withdrawals");
    } catch (err) {
        console.error(err);
        req.flash("error", "B2C payment failed.");
        res.redirect("/admin/withdrawals");
    }
});

// REJECT
router.post("/withdrawals/:id/reject", isAdmin, async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id).populate("user");
        if (!transaction) {
            req.flash("error", "Transaction not found.");
            return res.redirect("/admin/withdrawals");
        }

        if (transaction.status !== "pending") {
            req.flash("error", "Already processed");
            return res.redirect("/admin/withdrawals");
        }

        // Refund user wallet first
        transaction.user.walletBalance += transaction.amount;
        await transaction.user.save();

        transaction.status = "failed";
        await transaction.save();

        req.flash("success", `Withdrawal rejected and KES ${transaction.amount} refunded to ${transaction.user.username}`);
        res.redirect("/admin/withdrawals");
    } catch (err) {
        console.error(err);
        req.flash("error", "Could not reject withdrawal.");
        res.redirect("/admin/withdrawals");
    }
});

// Fetch coin metrics
router.get("/coin-dashboard", isAdmin, async (req, res) => {
    const coin = await VaultCoin.findOne();
    const totalCoinsCreated = coin.totalSupply;
    const coinsInCirculation = await User.aggregate([
        { $group: { _id: null, total: { $sum: "$coinsBalance" } } }
    ]);
    const dailyVolume = coin.dailyVolume;
    const orders = await CoinOrder.find({ status: "pending" });

    res.render("admin/coinDashboard", {
        totalCoinsCreated,
        coinsInCirculation: coinsInCirculation[0]?.total || 0,
        currentPrice: coin.price,
        dailyVolume,
        pendingOrders: orders.length
    });
});

module.exports = router;