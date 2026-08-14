const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { b2cPayment, formatPhone } = require("../lib/daraja");

const MIN_WITHDRAW = 100;

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

async function getRecentWithdrawals(userId) {
  return Transaction.find({ userId, type: "withdraw" })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
}

router.get("/withdraw", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    const recentWithdrawals = await getRecentWithdrawals(req.session.userId);

    res.render("withdraw", {
      currentPage: "withdraw",
      minWithdraw: MIN_WITHDRAW,
      recentWithdrawals,
      user,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("GET /withdraw error:", err);
    res.status(500).render("withdraw", {
      currentPage: "withdraw",
      minWithdraw: MIN_WITHDRAW,
      recentWithdrawals: [],
      user: null,
      error: "Something went wrong loading your withdrawals.",
      success: null,
    });
  }
});

router.post("/withdraw", requireAuth, async (req, res) => {
  const amount = Math.round(Number(req.body.amount));
  const phone = req.body.phone;

  const renderWithError = async (message) => {
    const user = await User.findById(req.session.userId).lean();
    const recentWithdrawals = await getRecentWithdrawals(req.session.userId);
    return res.status(400).render("withdraw", {
      currentPage: "withdraw",
      minWithdraw: MIN_WITHDRAW,
      recentWithdrawals,
      user,
      error: message,
      success: null,
    });
  };

  if (!amount || isNaN(amount) || amount < MIN_WITHDRAW) {
    return renderWithError(`Minimum withdrawal is Ksh ${MIN_WITHDRAW}.`);
  }

  if (!phone || !/^(?:\+?254|0)?[71]\d{8}$/.test(phone.replace(/\s+/g, ""))) {
    return renderWithError("Enter a valid M-Pesa phone number.");
  }

  // Atomically deduct only if the user actually has enough balance,
  // preventing double-withdraw race conditions.
  const user = await User.findOneAndUpdate(
    { _id: req.session.userId, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true }
  );

  if (!user) {
    return renderWithError("Insufficient wallet balance.");
  }

  const tx = await Transaction.create({
    userId: user._id,
    type: "withdraw",
    method: "stk",
    amount,
    status: "pending",
    phone: formatPhone(phone),
    note: "B2C withdrawal request",
  });

  try {
    const result = await b2cPayment({
      phone,
      amount,
      remarks: "VaultJ Withdrawal",
      occasion: `WD-${tx._id}`,
    });

    if (result.ResponseCode !== "0") {
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: amount } });
      tx.status = "failed";
      tx.note = result.ResponseDescription || "B2C request rejected";
      await tx.save();
      return renderWithError("Withdrawal request was rejected. Your wallet was not charged.");
    }

    // Store IDs so the callback can match this transaction
    tx.merchantRequestId = result.ConversationID;
    tx.checkoutRequestId = result.OriginatorConversationID;
    await tx.save();

    const updatedUser = await User.findById(user._id).lean();
    const recentWithdrawals = await getRecentWithdrawals(user._id);

    return res.render("withdraw", {
      currentPage: "withdraw",
      minWithdraw: MIN_WITHDRAW,
      recentWithdrawals,
      user: updatedUser,
      error: null,
      success: "Withdrawal request sent. Funds will arrive via M-Pesa shortly.",
    });
  } catch (err) {
    console.error("B2C error:", err.response?.data || err.message);
    await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: amount } });
    tx.status = "failed";
    tx.note = "B2C API error";
    await tx.save();
    return renderWithError("Could not process withdrawal right now. Please try again later.");
  }
});

module.exports = router;