const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");

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

module.exports = router;