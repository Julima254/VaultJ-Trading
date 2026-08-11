// routes/admin.js
const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

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
    // Adjust this formula to match your actual business logic
    // (e.g. subtract referral payouts, spin payouts, package costs, etc.)
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

module.exports = router;