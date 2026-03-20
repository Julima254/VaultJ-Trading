const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Transaction = require("../models/transaction");
const VaultCoin = require("../models/vaultCoin");
const CoinOrder = require("../models/coinOrder");
const bcrypt = require("bcryptjs");

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
        const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        // 1. Parallel Fetch for performance
        const [allTxs, totalUsers, activeUsers, coin] = await Promise.all([
            Transaction.find({}).populate('user', 'username').sort({ createdAt: -1 }),
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            VaultCoin.findOne()
        ]);

        const completedTxs = allTxs.filter(tx => tx.status === "completed");
        const deposits = completedTxs.filter(tx => tx.type === "deposit");

        // 2. Dashboard Statistics
        const totalToday = deposits.filter(tx => tx.createdAt >= startOfToday).reduce((s, tx) => s + tx.amount, 0);
        const totalWeek = deposits.filter(tx => tx.createdAt >= startOfWeek).reduce((s, tx) => s + tx.amount, 0);
        const totalMonth = deposits.filter(tx => tx.createdAt >= startOfMonth).reduce((s, tx) => s + tx.amount, 0);
        const totalPayouts = completedTxs.filter(tx => tx.type === "withdrawal").reduce((s, tx) => s + tx.amount, 0);
        const totalDepositsAllTime = deposits.reduce((s, tx) => s + tx.amount, 0);

        // 3. CHART LOGIC: Grouping data by date for the last 7 days
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(d.toISOString().split('T')[0]);
        }

        const depositChartData = last7Days.map(date => {
            return deposits
                .filter(tx => tx.createdAt.toISOString().split('T')[0] === date)
                .reduce((sum, tx) => sum + tx.amount, 0);
        });

        const withdrawalChartData = last7Days.map(date => {
            return completedTxs
                .filter(tx => tx.type === "withdrawal" && tx.createdAt.toISOString().split('T')[0] === date)
                .reduce((sum, tx) => sum + tx.amount, 0);
        });

        // 4. Inject into res.locals
        res.locals.totalUsers = totalUsers;
        res.locals.activeUsers = activeUsers;
        res.locals.totalDeposits = { today: totalToday, week: totalWeek, month: totalMonth };
        res.locals.totalPayouts = totalPayouts;
        res.locals.pendingWithdrawals = allTxs.filter(tx => tx.type === "withdrawal" && tx.status === "pending").reduce((s, tx) => s + tx.amount, 0);
        res.locals.platformProfit = totalDepositsAllTime - totalPayouts;
        res.locals.totalCoinsIssued = coin?.totalSupply || 0;
        res.locals.currentPrice = coin?.price || 0;
        res.locals.recentTransactions = allTxs.slice(0, 10);

        // Pass Chart Data to Frontend
        res.locals.dailyDepositLabels = last7Days;
        res.locals.dailyDepositData = depositChartData;
        res.locals.dailyWithdrawalLabels = last7Days;
        res.locals.dailyWithdrawalData = withdrawalChartData;
        res.locals.coinPriceLabels = last7Days;
        res.locals.coinPriceData = last7Days.map(() => coin?.price || 0);

        next();
    } catch (err) {
        console.error("Admin Middleware Error:", err);
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

// ===== USER MANAGEMENT =====
router.get("/users", async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        res.render("admin/users", {
            users,
            success: req.flash("success"),
            error: req.flash("error")
        });
    } catch (err) {
        console.error(err);
        res.redirect("/admin");
    }
});

// GET Detailed User View
router.get("/users/:id", async (req, res) => {
    try {
        const [user, transactions, referrals] = await Promise.all([
            User.findById(req.params.id),
            Transaction.find({ user: req.params.id }).sort({ createdAt: -1 }),
            User.find({ referredBy: req.params.id }) 
        ]);

        if (!user) {
            req.flash("error", "User not found");
            return res.redirect("/admin/users");
        }

        res.render("admin/userDetails", { 
            user, transactions, referrals,
            success: req.flash("success"),
            error: req.flash("error")
        });
    } catch (err) {
        res.redirect("/admin/users");
    }
});

// Balance Adjustment (Consolidated for both Coin and User views)
router.post("/users/:id/adjust-balance", async (req, res) => {
    try {
        const { walletAmount, coinAmount } = req.body;
        const incWallet = parseFloat(walletAmount) || 0;
        const incCoins = parseFloat(coinAmount) || 0;

        const user = await User.findByIdAndUpdate(req.params.id, {
            $inc: { walletBalance: incWallet, coinsBalance: incCoins }
        }, { new: true });

        if (incWallet !== 0) {
            await Transaction.create({
                user: user._id,
                type: "admin_adjustment",
                amount: incWallet,
                status: "completed",
                phone: user.phone || "SYSTEM"
            });
        }

        req.flash("success", `Balances updated for ${user.username}`);
        // Redirect back to referring page or default to users
        res.redirect(req.headers.referer || "/admin/users");
    } catch (err) {
        req.flash("error", "Failed to update balances.");
        res.redirect("/admin/users");
    }
});

router.post("/users/:id/toggle-status", async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        user.isActive = !user.isActive;
        await user.save();
        req.flash("success", `${user.username} has been ${user.isActive ? 'activated' : 'suspended'}`);
        res.redirect("/admin/users");
    } catch (err) {
        res.redirect("/admin/users");
    }
});

router.post("/users/:id/reset-password", async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        const tempPassword = Math.random().toString(36).slice(-8); 

        await user.setPassword(tempPassword); // Assumes passport-local-mongoose
        await user.save();

        const [referrals, transactions] = await Promise.all([
            User.find({ referredBy: user._id }),
            Transaction.find({ user: user._id }).sort({ createdAt: -1 })
        ]);

        res.render("admin/userDetails", {
            user, referrals, transactions,
            success: [`Password reset successfully: ${tempPassword}`],
            error: []
        });
    } catch (err) {
        res.redirect("/admin/users");
    }
});

// ===== WITHDRAWAL MANAGEMENT =====
router.get("/withdrawals", async (req, res) => {
    try {
        const withdrawals = await Transaction.find({ type: "withdrawal" })
            .populate("user", "username")
            .sort({ createdAt: -1 });

        res.render("admin/withdrawals", {
            withdrawals,
            success: req.flash("success"),
            error: req.flash("error")
        });
    } catch (err) {
        res.redirect("/admin");
    }
});

router.post("/withdrawals/:id/approve", async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (tx && tx.status === "pending") {
            tx.status = "completed";
            await tx.save();
            req.flash("success", "Withdrawal approved.");
        }
        res.redirect("/admin/withdrawals");
    } catch (err) {
        res.redirect("/admin/withdrawals");
    }
});

router.post("/withdrawals/:id/reject", async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (tx && tx.status === "pending") {
            await User.findByIdAndUpdate(tx.user, { $inc: { walletBalance: tx.amount } });
            tx.status = "failed";
            await tx.save();
            req.flash("success", "Withdrawal rejected and refunded.");
        }
        res.redirect("/admin/withdrawals");
    } catch (err) {
        res.redirect("/admin/withdrawals");
    }
});

module.exports = router;