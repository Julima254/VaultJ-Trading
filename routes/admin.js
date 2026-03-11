const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");
const VaultCoin = require("../models/vaultCoin");
const CoinOrder = require("../models/coinOrder");
const { b2cPayment } = require("../services/daraja");

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
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // 1. Basic Counts
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ isActive: true });
        const pendingOrders = await CoinOrder.countDocuments({ status: "pending" });

        // 2. Coin Metrics
        const coin = await VaultCoin.findOne();
        const totalCoinsCreated = coin?.totalSupply || 0;
        const currentPrice = coin?.price || 0;
        const dailyVolume = coin?.dailyVolume || 0;
        const revenueFromFees = coin?.platformRevenue || 0;

        const coinsInCirculationAgg = await User.aggregate([
            { $group: { _id: null, totalCoins: { $sum: "$coinsBalance" } } }
        ]);
        const coinsInCirculation = coinsInCirculationAgg[0]?.totalCoins || 0;

        // 3. Transactions
        const transactions = await Transaction.find().populate("user", "username").sort({ createdAt: -1 });

        // Calculate Totals
        const totalDepositsToday = transactions
            .filter(tx => tx.type === "deposit" && tx.status === "completed" && tx.createdAt >= startOfToday)
            .reduce((sum, tx) => sum + tx.amount, 0);

        const totalDepositsWeek = transactions
            .filter(tx => tx.type === "deposit" && tx.status === "completed" && tx.createdAt >= startOfWeek)
            .reduce((sum, tx) => sum + tx.amount, 0);

        const totalDepositsMonth = transactions
            .filter(tx => tx.type === "deposit" && tx.status === "completed" && tx.createdAt >= startOfMonth)
            .reduce((sum, tx) => sum + tx.amount, 0);

        const totalPayouts = transactions
            .filter(tx => tx.type === "withdrawal" && tx.status === "completed")
            .reduce((sum, tx) => sum + tx.amount, 0);

        const pendingWithdrawals = transactions
            .filter(tx => tx.type === "withdrawal" && tx.status === "pending")
            .reduce((sum, tx) => sum + tx.amount, 0);

        const platformProfit = (transactions.filter(tx => tx.type === "deposit" && tx.status === "completed").reduce((s, t) => s + t.amount, 0)) - totalPayouts;

        // 4. Chart Data Generation (Dummy data for price, real for deposits)
        // In a real app, you'd store price history in a separate model
        const dailyDepositLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const dailyDepositData = [0, 0, 0, 0, 0, 0, totalDepositsToday]; // Example logic
        
        const dailyWithdrawalLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const dailyWithdrawalData = [0, 0, 0, 0, 0, 0, 0];

        const coinPriceLabels = ["12:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
        const coinPriceData = [currentPrice * 0.9, currentPrice * 0.95, currentPrice, currentPrice * 1.02, currentPrice];

        // 5. RENDER
        res.render("admin", {
            totalUsers,
            activeUsers,
            totalCoinsIssued: totalCoinsCreated,
            coinsInCirculation,
            currentPrice,
            dailyVolume,
            revenueFromFees,
            pendingOrders,
            platformProfit,
            totalDeposits: { 
                today: totalDepositsToday,
                week: totalDepositsWeek,
                month: totalDepositsMonth
            },
            totalPayouts,
            pendingWithdrawals,
            recentTransactions: transactions.slice(0, 10),
            // Chart Variables needed by admin.ejs
            dailyDepositLabels,
            dailyDepositData,
            dailyWithdrawalLabels,
            dailyWithdrawalData,
            coinPriceLabels,
            coinPriceData,
            success: req.flash("success"),
            error: req.flash("error")
        });

    } catch (err) {
        console.error("Admin Dashboard Error:", err);
        req.flash("error", "Cannot load admin dashboard");
        res.redirect("/home");
    }
});
// ===== APPROVE WITHDRAWAL =====
router.post("/withdrawals/:id/approve", isAdmin, async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id).populate("user");
        if (!transaction || transaction.status !== "pending") {
            req.flash("error", "Transaction not found or already processed.");
            return res.redirect("/admin/withdrawals");
        }

        const result = await b2cPayment(transaction.phone, transaction.amount);

        transaction.status = "completed";
        transaction.b2cReceipt = result.MpesaReceiptNumber;
        await transaction.save();

        req.flash("success", `Payment sent to ${transaction.user.username}`);
        res.redirect("/admin/withdrawals");
    } catch (err) {
        console.error(err);
        req.flash("error", "B2C payment failed.");
        res.redirect("/admin/withdrawals");
    }
});

// ===== REJECT WITHDRAWAL =====
router.post("/withdrawals/:id/reject", isAdmin, async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id).populate("user");
        if (!transaction || transaction.status !== "pending") {
            req.flash("error", "Transaction not found or already processed.");
            return res.redirect("/admin/withdrawals");
        }

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

// ===== COIN DASHBOARD (ADMIN) =====
router.get("/coin", async (req, res) => {
    try {
        const coin = await VaultCoin.findOne();
        const totalCoinsCreated = coin?.totalSupply || 0;

        const coinsInCirculationAgg = await User.aggregate([
            { $group: { _id: null, total: { $sum: "$coinsBalance" } } }
        ]);
        const coinsInCirculation = coinsInCirculationAgg[0]?.total || 0;

        const dailyVolume = coin?.dailyVolume || 0;
        const revenueFromFees = coin?.platformRevenue || 0;

        const pendingOrders = await CoinOrder.countDocuments({ status: "pending" });

        // Get the logged-in user
        const user = req.user; // Make sure your auth middleware sets req.user
        // Fetch user's recent orders
        const recentOrders = await CoinOrder.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);

        res.render("admin/coin", {
            user, // <-- now available in ejs
            coin,
            totalCoinsCreated,
            coinsInCirculation,
            currentPrice: coin?.price || 0,
            dailyVolume,
            revenueFromFees,
            pendingOrders,
            recentOrders, // <-- for recent orders table
            success: req.flash("success"),
            error: req.flash("error")
        });
    } catch (err) {
        console.error(err);
        req.flash("error", "Cannot load coin dashboard");
        res.redirect("/admin");
    }
});
module.exports = router;