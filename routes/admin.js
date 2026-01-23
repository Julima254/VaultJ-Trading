const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");

// ===== ADMIN GUARD =====
function isAdmin(req, res, next) {
    if (req.isAuthenticated && req.user?.isAdmin) {
        return next();
    }
    req.flash("error", "Access denied");
    res.redirect("/home");
}

// ===== ADMIN DASHBOARD =====
router.get("/", isAdmin, async (req, res) => {
    try {
        // Total users
        const totalUsers = await User.countDocuments();
        const starterUsers = await User.countDocuments({ package: "Starter" });
        const bronzeUsers = await User.countDocuments({ package: "Bronze" });
        const silverUsers = await User.countDocuments({ package: "Silver" });
        const goldUsers = await User.countDocuments({ package: "Gold" });
        const platinumUsers = await User.countDocuments({ package: "Platinum" });
        const activeUsers = await User.countDocuments({ isActive: true });

        // Transactions
        const transactions = await Transaction.find();

        // ===== STATS PLACEHOLDERS =====
        // Total deposits today, week, month
        const totalDeposits = {
            today: transactions.filter(tx => {
                const todayDate = new Date();
                const txDate = new Date(tx.createdAt);
                return txDate.toDateString() === todayDate.toDateString();
            }).reduce((sum, tx) => sum + tx.amount, 0),

            week: transactions.filter(tx => {
                const today = new Date();
                const txDate = new Date(tx.createdAt);
                const diff = (today - txDate) / (1000 * 60 * 60 * 24);
                return diff <= 7;
            }).reduce((sum, tx) => sum + tx.amount, 0),

            month: transactions.filter(tx => {
                const today = new Date();
                const txDate = new Date(tx.createdAt);
                return txDate.getMonth() === today.getMonth() && txDate.getFullYear() === today.getFullYear();
            }).reduce((sum, tx) => sum + tx.amount, 0)
        };

        // Placeholder numbers
        const totalPayouts = 50000;           // replace with real query if needed
        const pendingWithdrawals = 12000;     // replace with real query if needed
        const totalCoinsIssued = 100000;      // replace with real query if needed
        const platformProfit = 35000;         // replace with real calculation

        // Charts (last 7 days dummy data)
        const dailyDepositLabels = Array.from({ length: 7 }, (_, i) => `Day ${i+1}`);
        const dailyDepositData = [500, 1000, 750, 1200, 900, 1300, 700];

        const dailyWithdrawalLabels = Array.from({ length: 7 }, (_, i) => `Day ${i+1}`);
        const dailyWithdrawalData = [200, 400, 350, 300, 500, 450, 600];

        const coinPriceLabels = Array.from({ length: 7 }, (_, i) => `Day ${i+1}`);
        const coinPriceData = [1.2, 1.3, 1.25, 1.28, 1.35, 1.4, 1.38];

        // Render admin page
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
