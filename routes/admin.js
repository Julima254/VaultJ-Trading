// routes/admin.js
const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const PrizePool = require("../models/PrizePool");
const PACKAGES = require("../config/packages");
const SpinLog = require("../models/SpinLog");


router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // ---- Last 7 days range (including today) ----
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // ---- Basic user stats ----
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });

    // ---- Users' funds (money the platform "owes" users) ----
    const userFundsAgg = await User.aggregate([
      {
        $group: {
          _id: null,
          totalWallet: { $sum: "$walletBalance" },
          totalDepositBalance: { $sum: "$depositBalance" },
        },
      },
    ]);
    const usersFunds =
      (userFundsAgg[0]?.totalWallet || 0) + (userFundsAgg[0]?.totalDepositBalance || 0);

    // ---- Total deposits (completed) ----
    const totalDepositsAgg = await Transaction.aggregate([
      { $match: { type: "deposit", status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]);
    const totalDeposits = totalDepositsAgg[0]?.sum || 0;

    // ---- Total withdrawals (completed) ----
    const totalWithdrawalsAgg = await Transaction.aggregate([
      { $match: { type: "withdraw", status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]);
    const totalWithdrawals = totalWithdrawalsAgg[0]?.sum || 0;

    // ---- Deposits this month ----
    const depositsThisMonthAgg = await Transaction.aggregate([
      {
        $match: {
          type: "deposit",
          status: "completed",
          createdAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]);
    const depositsThisMonth = depositsThisMonthAgg[0]?.sum || 0;

    // ---- Withdrawals this month ----
    const withdrawalsThisMonthAgg = await Transaction.aggregate([
      {
        $match: {
          type: "withdraw",
          status: "completed",
          createdAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]);
    const withdrawalsThisMonth = withdrawalsThisMonthAgg[0]?.sum || 0;

    // ---- Pending deposits & withdrawals ----
    const pendingDepositsAgg = await Transaction.aggregate([
      { $match: { type: "deposit", status: "pending" } },
      { $group: { _id: null, sum: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    const pendingDeposits = {
      sum: pendingDepositsAgg[0]?.sum || 0,
      count: pendingDepositsAgg[0]?.count || 0,
    };

    const pendingWithdrawalsAgg = await Transaction.aggregate([
      { $match: { type: "withdraw", status: "pending" } },
      { $group: { _id: null, sum: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    const pendingWithdrawals = {
      sum: pendingWithdrawalsAgg[0]?.sum || 0,
      count: pendingWithdrawalsAgg[0]?.count || 0,
    };

    // ---- Platform profit (simple model: deposits - withdrawals) ----
    const platformProfit = totalDeposits - totalWithdrawals;

    // ---- Chart data: deposits vs withdrawals per day (last 7 days) ----
    const dailyAgg = await Transaction.aggregate([
      {
        $match: {
          status: "completed",
          type: { $in: ["deposit", "withdraw"] },
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
            type: "$type",
          },
          sum: { $sum: "$amount" },
        },
      },
    ]);

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const chartLabels = [];
    const depositSeries = [];
    const withdrawalSeries = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);

      const label = dayNames[d.getDay()];
      chartLabels.push(label);

      const depositMatch = dailyAgg.find(
        (m) =>
          m._id.year === d.getFullYear() &&
          m._id.month === d.getMonth() + 1 &&
          m._id.day === d.getDate() &&
          m._id.type === "deposit"
      );
      const withdrawalMatch = dailyAgg.find(
        (m) =>
          m._id.year === d.getFullYear() &&
          m._id.month === d.getMonth() + 1 &&
          m._id.day === d.getDate() &&
          m._id.type === "withdraw"
      );

      depositSeries.push(depositMatch?.sum || 0);
      withdrawalSeries.push(withdrawalMatch?.sum || 0);
    }

    // ---- Recent transactions (all users, all types) ----
    const recentTransactions = await Transaction.find()
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // ---- Recent users ----
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select("username email package isActive walletBalance createdAt")
      .lean();

    res.render("admin/dashboard", {
      currentPage: "admin-dashboard",
      stats: {
        totalUsers,
        activeUsers,
        usersFunds,
        totalDeposits,
        totalWithdrawals,
        depositsThisMonth,
        withdrawalsThisMonth,
        pendingDeposits,
        pendingWithdrawals,
        platformProfit,
      },
      chart: {
        labels: chartLabels,
        deposits: depositSeries,
        withdrawals: withdrawalSeries,
      },
      recentTransactions,
      recentUsers,
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).send("Something went wrong loading the admin dashboard.");
  }
});

router.get("/admin/packages", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, "package username email createdAt").lean();

    const totalUsers = users.length;

    // Build a lookup so we can match a user's stored package value
    // (which may be the package NAME, e.g. "Gold") back to its config KEY (e.g. "gold").
    const nameToKey = {};
    Object.entries(PACKAGES).forEach(([key, pkg]) => {
      if (pkg.name) {
        nameToKey[pkg.name.trim().toLowerCase()] = key;
      }
    });

    function resolvePackageKey(rawValue) {
      if (!rawValue) return null;
      // Case 1: value is already a valid key (e.g. "gold")
      if (PACKAGES[rawValue]) return rawValue;
      // Case 2: value is the display name (e.g. "Gold") - match case-insensitively
      const match = nameToKey[rawValue.trim().toLowerCase()];
      return match || null;
    }

    // ---- Per-package stats ----
    const stats = {};
    Object.keys(PACKAGES).forEach((key) => {
      stats[key] = { activeUsers: 0, revenue: 0 };
    });

    let usersWithPackage = 0;

    users.forEach((u) => {
      const key = resolvePackageKey(u.package);
      if (key) {
        stats[key].activeUsers += 1;
        stats[key].revenue += PACKAGES[key].price || 0;
        usersWithPackage += 1;
      }
    });

    const usersWithNoPackage = totalUsers - usersWithPackage;
    const adoptionRate =
      totalUsers > 0
        ? ((usersWithPackage / totalUsers) * 100).toFixed(1)
        : "0.0";

    // ---- Recent package activity: last 10 users with a resolvable package ----
    const recentActivity = users
      .map((u) => ({ ...u, resolvedKey: resolvePackageKey(u.package) }))
      .filter((u) => u.resolvedKey)
      .sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt) : a._id.getTimestamp();
        const bDate = b.createdAt ? new Date(b.createdAt) : b._id.getTimestamp();
        return bDate - aDate;
      })
      .slice(0, 10)
      .map((u) => ({
        name: u.username || u.email || "Unknown user",
        packageKey: u.resolvedKey,
        packageName: PACKAGES[u.resolvedKey].name,
        date: u.createdAt ? new Date(u.createdAt) : u._id.getTimestamp(),
      }));

    res.render("admin/packages", {
      currentPage: "packages",
      packages: PACKAGES,
      stats,
      totalUsers,
      usersWithPackage,
      usersWithNoPackage,
      adoptionRate,
      recentActivity,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading admin packages:", err);
    res.status(500).send("Server error");
  }
});

router.get("/admin/packages/:key/users", requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const pkg = PACKAGES[key];

    if (!pkg) {
      return res.status(404).send("Package not found");
    }

    // Match users whose `package` field equals either the key itself
    // or the package's display name (case-insensitive), covering both storage styles.
    const users = await User.find({
      package: { $regex: new RegExp(`^(${key}|${pkg.name})$`, "i") },
    })
      .select("username email package walletBalance isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    res.render("admin/packageUsers", {
      currentPage: "packages",
      packageKey: key,
      pkg,
      users,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading package users:", err);
    res.status(500).send("Server error");
  }
});

// ---- Vault Jspins: prize pool management ----

router.get("/admin/vault-jspins/pool", requireAdmin, async (req, res) => {
  try {
    const pool = await PrizePool.getPool();
    res.json({ ok: true, balance: pool.balance });
  } catch (err) {
    console.error("Error fetching prize pool:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/admin/vault-jspins/pool", requireAdmin, async (req, res) => {
  try {
    const amount = Number(req.body.balance);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ ok: false, message: "Enter a valid pool amount." });
    }

    const pool = await PrizePool.getPool();
    pool.balance = amount;
    pool.updatedBy = req.session.userId;
    await pool.save();

    res.json({ ok: true, balance: pool.balance });
  } catch (err) {
    console.error("Error updating prize pool:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});


// ---- Vault Jspins: spin history page ----
router.get("/admin/spins", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const range = req.query.range || "all";
    const search = (req.query.search || "").trim();

    // ---- Date range filter ----
    let dateFilter = {};
    const now = new Date();
    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: start } };
    } else if (range === "7d") {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: start } };
    } else if (range === "30d") {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: start } };
    }

    // ---- User search (username/email) ----
    let userFilter = {};
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();
      userFilter = { user: { $in: matchedUsers.map((u) => u._id) } };
    }

    const query = { ...dateFilter, ...userFilter };

    const [spins, totalSpins, pool] = await Promise.all([
      SpinLog.find(query)
        .populate("user", "username email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SpinLog.countDocuments(query),
      PrizePool.getPool(),
    ]);

    const summaryAgg = await SpinLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalStaked: { $sum: "$stake" },
          totalPayout: { $sum: "$payout" },
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {
      totalStaked: summaryAgg[0]?.totalStaked || 0,
      totalPayout: summaryAgg[0]?.totalPayout || 0,
      count: summaryAgg[0]?.count || 0,
      netToPool:
        (summaryAgg[0]?.totalStaked || 0) - (summaryAgg[0]?.totalPayout || 0),
    };

    const totalPages = Math.max(Math.ceil(totalSpins / limit), 1);

    res.render("admin/spins", {
      currentPage: "spins",
      spins,
      summary,
      poolBalance: pool.balance,
      filters: { range, search },
      pagination: { currentPage: page, totalPages },
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading spins admin page:", err);
    res.status(500).send("Server error");
  }
});

router.get("/admin/referrals", requireAdmin, async (req, res) => {
  try {
    // ---- Overview stats ----
    const totalReferredUsers = await User.countDocuments({ referredBy: { $ne: null } });
    const usersWithReferrals = await User.countDocuments({ totalReferrals: { $gt: 0 } });

    const earningsAgg = await User.aggregate([
      { $group: { _id: null, totalEarnings: { $sum: "$referralEarnings" } } },
    ]);
    const totalCommissionsPaid = earningsAgg[0]?.totalEarnings || 0;

    // ---- Top referrers, ranked by earnings ----
    const topReferrers = await User.find({ totalReferrals: { $gt: 0 } })
      .select("username referralCode totalReferrals referralEarnings walletBalance")
      .sort({ referralEarnings: -1 })
      .limit(10)
      .lean();

    // ---- Most recent referral signups (who referred whom) ----
    const recentReferrals = await User.find({ referredBy: { $ne: null } })
      .populate("referredBy", "username referralCode")
      .select("username package isActive createdAt referredBy")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.render("admin/referrals", {
      currentPage: "referrals",
      stats: {
        totalReferredUsers,
        usersWithReferrals,
        totalCommissionsPaid,
      },
      topReferrers,
      recentReferrals,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading admin referrals:", err);
    res.status(500).send("Server error");
  }
});

// ---- Withdrawals overview page ----
router.get("/admin/withdrawals", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const status = req.query.status || "all";
    const search = (req.query.search || "").trim();

    const query = { type: "withdraw" };
    if (status !== "all") query.status = status;

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();

      query.$or = [
        { userId: { $in: matchedUsers.map((u) => u._id) } },
        { code: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const [withdrawals, totalCount] = await Promise.all([
      Transaction.find(query)
        .populate("userId", "username email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    // ---- Summary stats (overall totals, unaffected by filters) ----
    const summaryAgg = await Transaction.aggregate([
      { $match: { type: "withdraw" } },
      {
        $group: {
          _id: "$status",
          sum: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {
      totalRequestedSum: 0,
      totalRequestedCount: 0,
      completedSum: 0,
      completedCount: 0,
      pendingSum: 0,
      pendingCount: 0,
      failedSum: 0,
      failedCount: 0,
    };

    summaryAgg.forEach((s) => {
      summary.totalRequestedSum += s.sum;
      summary.totalRequestedCount += s.count;
      if (s._id === "completed") {
        summary.completedSum = s.sum;
        summary.completedCount = s.count;
      } else if (s._id === "pending") {
        summary.pendingSum = s.sum;
        summary.pendingCount = s.count;
      } else if (s._id === "failed") {
        summary.failedSum = s.sum;
        summary.failedCount = s.count;
      }
    });

    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);

    res.render("admin/withdrawals", {
      currentPage: "withdrawals",
      withdrawals,
      summary,
      filters: { status, search },
      pagination: { currentPage: page, totalPages },
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading admin withdrawals:", err);
    res.status(500).send("Server error");
  }
});


module.exports = router;