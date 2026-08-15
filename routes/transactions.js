const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");

// Simple auth guard — adjust if you already have one elsewhere
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

router.get("/transactions", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { type, status, method, startDate, endDate, page = 1 } = req.query;

    // ---- Build filter query for the list ----
    const filter = { userId };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const limit = 15;
    const skip = (Number(page) - 1) * limit;

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(filter),
    ]);

    // ---- Stats (based on ALL of the user's transactions, not the filtered list) ----
    const stats = await Transaction.aggregate([
      { $match: { userId: req.session.userId ? new (require("mongoose").Types.ObjectId)(userId) : userId } },
      {
        $group: {
          _id: { type: "$type", status: "$status" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const sumWhere = (predicate) =>
      stats.filter(predicate).reduce((acc, s) => acc + s.total, 0);

    const totalDeposited = sumWhere((s) => s._id.type === "deposit" && s._id.status === "completed");
    const totalWithdrawn = sumWhere((s) => s._id.type === "withdraw" && s._id.status === "completed");
    const totalEarned = sumWhere(
      (s) => ["referral", "spin"].includes(s._id.type) && s._id.status === "completed"
    );
    const pendingAmount = sumWhere((s) => s._id.status === "pending");
    const pendingCount = stats
      .filter((s) => s._id.status === "pending")
      .reduce((acc, s) => acc + s.count, 0);

    res.render("transactions", {
      transactions,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: Number(page),
      filters: { type, status, method, startDate, endDate },
      summary: { totalDeposited, totalWithdrawn, totalEarned, pendingAmount, pendingCount },
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    console.error("Error loading transactions:", err);
    res.status(500).send("Error loading transactions");
  }
});

module.exports = router;