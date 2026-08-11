const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const PAGE_SIZE = 20;

// GET /admin/payments — unified deposits + withdrawals list with filters
router.get("/admin/payments", requireAdmin, async (req, res) => {
  try {
    const {
      type = "all",
      status = "all",
      method = "all",
      search = "",
      page = 1,
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);

    const filter = {};
    if (type !== "all") filter.type = type;
    if (status !== "all") filter.status = status;
    if (method !== "all") filter.method = method;

    if (search.trim()) {
      const term = search.trim();
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: term, $options: "i" } },
          { email: { $regex: term, $options: "i" } },
        ],
      }).select("_id");

      filter.$or = [
        { code: { $regex: term, $options: "i" } },
        { userId: { $in: matchedUsers.map((u) => u._id) } },
      ];
    }

    const totalCount = await Transaction.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const transactions = await Transaction.find(filter)
      .populate("userId", "username email phone")
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();

    // ---- Summary cards ----
    const [pendingAgg, completedDepositAgg, completedWithdrawAgg, failedCount] =
      await Promise.all([
        Transaction.aggregate([
          { $match: { status: "pending" } },
          { $group: { _id: null, sum: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
        Transaction.aggregate([
          { $match: { status: "completed", type: "deposit" } },
          { $group: { _id: null, sum: { $sum: "$amount" } } },
        ]),
        Transaction.aggregate([
          { $match: { status: "completed", type: "withdraw" } },
          { $group: { _id: null, sum: { $sum: "$amount" } } },
        ]),
        Transaction.countDocuments({ status: "failed" }),
      ]);

    const summary = {
      pendingSum: pendingAgg[0]?.sum || 0,
      pendingCount: pendingAgg[0]?.count || 0,
      completedDepositSum: completedDepositAgg[0]?.sum || 0,
      completedWithdrawSum: completedWithdrawAgg[0]?.sum || 0,
      failedCount,
    };

    res.render("admin/payments", {
      currentPage: "admin-payments",
      transactions,
      filters: { type, status, method, search },
      pagination: { currentPage, totalPages, totalCount },
      summary,
    });
  } catch (err) {
    console.error("Admin payments error:", err);
    res.status(500).send("Something went wrong loading payments.");
  }
});

// POST /admin/payments/:id/approve
router.post("/admin/payments/:id/approve", requireAdmin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, message: "Transaction not found or already reviewed." });
    }

    tx.status = "completed";
    tx.reviewedBy = req.session.userId;
    tx.reviewedAt = new Date();
    await tx.save();

    // Deposits: credit the user on approval.
    if (tx.type === "deposit") {
      await User.findByIdAndUpdate(tx.userId, {
        $inc: { walletBalance: tx.amount, depositBalance: tx.amount },
      });
    }
    // Withdrawals: assumes balance was already deducted when the withdrawal
    // was requested, so approval here just confirms payout — no balance change.

    res.json({ success: true });
  } catch (err) {
    console.error("Approve payment error:", err);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

// POST /admin/payments/:id/reject
router.post("/admin/payments/:id/reject", requireAdmin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, message: "Transaction not found or already reviewed." });
    }

    tx.status = "failed";
    tx.reviewedBy = req.session.userId;
    tx.reviewedAt = new Date();
    tx.note = req.body.reason || "Rejected by admin";
    await tx.save();

    // Withdrawals: refund the held amount back to the wallet on rejection.
    if (tx.type === "withdraw") {
      await User.findByIdAndUpdate(tx.userId, {
        $inc: { walletBalance: tx.amount },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject payment error:", err);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

module.exports = router;