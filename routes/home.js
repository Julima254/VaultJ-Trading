const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const Transaction = require("../models/Transaction");

router.get("/home", requireAuth, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.render("home", {
      currentPage: "home",
      transactions,
    });
  } catch (err) {
    console.error(err);
    res.render("home", {
      currentPage: "home",
      transactions: [],
    });
  }
});

module.exports = router;