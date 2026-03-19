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

// ===== GLOBAL ADMIN DATA MIDDLEWARE =====
router.use(isAdmin, async (req, res, next) => {
    try {
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        // 1. Parallel Fetch for high performance
        const [allTxs, totalUsers, activeUsers, coin] = await Promise.all([
            Transaction.find({}).populate('user', 'username').sort({ createdAt: -1 }),
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            VaultCoin.findOne()
        ]);

        // 2. Transaction Logic
        const completedTxs = allTxs.filter(tx => tx.status === "completed");
        
        // Deposits Logic (Today, Week, Month)
        const deposits = completedTxs.filter(tx => tx.type === "deposit");
        const totalToday = deposits.filter(tx => tx.createdAt >= startOfToday).reduce((s, tx) => s + tx.amount, 0);
        const totalWeek  = deposits.filter(tx => tx.createdAt >= startOfWeek).reduce((s, tx) => s + tx.amount, 0);
        const totalMonth = deposits.filter(tx => tx.createdAt >= startOfMonth).reduce((s, tx) => s + tx.amount, 0);

        // Payouts & Profit Logic
        const totalPayouts = completedTxs.filter(tx => tx.type === "withdrawal").reduce((s, tx) => s + tx.amount, 0);
        const totalDepositsAllTime = deposits.reduce((s, tx) => s + tx.amount, 0);

        // 3. Inject into res.locals (EXACT match for admin.ejs)
        res.locals.totalUsers = totalUsers;
        res.locals.activeUsers = activeUsers;
        res.locals.totalDeposits = { 
            today: totalToday, 
            week: totalWeek, 
            month: totalMonth 
        };
        res.locals.totalPayouts = totalPayouts;
        res.locals.pendingWithdrawals = allTxs.filter(tx => tx.type === "withdrawal" && tx.status === "pending").reduce((s, tx) => s + tx.amount, 0);
        res.locals.platformProfit = totalDepositsAllTime - totalPayouts;
        res.locals.totalCoinsIssued = coin?.totalSupply || 0;
        res.locals.currentPrice = coin?.price || 0;
        res.locals.recentTransactions = allTxs.slice(0, 10); // Show last 10 for the table

        // Chart Placeholders (Prevents Chart.js from breaking)
        res.locals.dailyDepositLabels = []; 
        res.locals.dailyDepositData = [];
        res.locals.dailyWithdrawalLabels = [];
        res.locals.dailyWithdrawalData = [];
        res.locals.coinPriceLabels = [];
        res.locals.coinPriceData = [];

        next();
    } catch (err) {
        console.error(err);
        res.locals.recentTransactions = [];
        res.locals.totalDeposits = { today: 0, week: 0, month: 0 };
        next();
    }
});

// ===== ADMIN DASHBOARD (Main) =====
router.get("/", async (req, res) => {
    res.render("admin", {
        success: req.flash("success"),
        error: req.flash("error")
    });
});

// ===== COIN & LIQUIDITY TERMINAL =====
router.get("/coin", async (req, res) => {
    try {
        const coin = await VaultCoin.findOne();
        const liquidityUser = await User.findOne({ isLiquidityProvider: true });
        const recentOrders = await CoinOrder.find().sort({ createdAt: -1 }).limit(20).populate('user', 'username');
        const circulationData = await User.aggregate([{ $group: { _id: null, total: { $sum: "$coinsBalance" } } }]);

        res.render("admin/coin", {
            coin,
            liquidityUser,
            recentOrders,
            revenueFromFees: coin?.platformRevenue || 0,
            coinsInCirculation: circulationData[0]?.total || 0,
            pendingOrders: await CoinOrder.countDocuments({ status: "pending" }),
            success: req.flash("success"),
            error: req.flash("error")
        });
    } catch (err) {
        res.redirect("/admin");
    }
});

// ===== LIQUIDITY ADJUSTMENT ROUTE =====
router.post("/users/:id/adjust-balance", isAdmin, async (req, res) => {
    try {
        const { walletAmount, coinAmount } = req.body;
        
        // Convert inputs to numbers, defaulting to 0 if empty
        const incWallet = parseFloat(walletAmount) || 0;
        const incCoins = parseFloat(coinAmount) || 0;

      await User.findByIdAndUpdate(req.params.id, {
            $inc: { 
                walletBalance: incWallet, 
                coinsBalance: incCoins 
            }
        });

        req.flash("success", `Liquidity updated: KES ${incWallet}, VTC ${incCoins}`);
        
        // FIX: Redirect to the specific admin coin route instead of "back"
        res.redirect("/admin/coin"); 

    } catch (err) {
        console.error("Liquidity Update Error:", err);
        req.flash("error", "Failed to update liquidity balances.");
        res.redirect("/admin/coin"); // FIX: Keep it consistent here too
    }
});

module.exports = router;