const express = require("express");
const router = express.Router();
const daraja = require("../lib/daraja");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// Credit a user's deposit: goes to depositBalance while inactive,
// walletBalance once the user is active.
//
// Atomic: uses a single findOneAndUpdate with isActive in the query filter,
// so there's no read-then-write gap where the user could activate in between
// (which was causing the same deposit to land in BOTH fields).
async function creditDeposit(userId, amount) {
  const creditedInactive = await User.findOneAndUpdate(
    { _id: userId, isActive: false },
    { $inc: { depositBalance: amount } }
  );

  if (!creditedInactive) {
    // Either user doesn't exist, or isActive was true — try crediting wallet instead
    await User.findOneAndUpdate(
      { _id: userId, isActive: true },
      { $inc: { walletBalance: amount } }
    );
  }
}

// GET /deposit — show the deposit page
router.get("/deposit", requireLogin, (req, res) => {
  res.render("deposit", {
    currentPage: "deposit",
    paybillNumber: process.env.PAYBILL_NUMBER,
    paybillInstructions: process.env.PAYBILL_INSTRUCTIONS,
  });
});

// POST /deposit/stk — initiate STK push
router.post("/deposit/stk", requireLogin, async (req, res) => {
  const { phone, amount } = req.body;
  const amt = Number(amount);

  if (!phone || !amt || amt < 1) {
    return res.status(400).json({ success: false, message: "Enter a valid phone number and amount." });
  }

  try {
    const result = await daraja.stkPush({
      phone,
      amount: amt,
      accountReference: `VJ-${req.session.userId}`,
      transactionDesc: "VaultJ Wallet Deposit",
    });

    if (result.ResponseCode !== "0") {
      return res.status(502).json({
        success: false,
        fallbackToPaybill: true,
        message: result.ResponseDescription || "Could not start M-Pesa payment.",
      });
    }

    await Transaction.create({
      userId: req.session.userId,
      type: "deposit",
      amount: amt,
      phone: daraja.formatPhone(phone),
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID,
      status: "pending",
    });

    res.json({
      success: true,
      checkoutRequestId: result.CheckoutRequestID,
      message: "Check your phone and enter your M-Pesa PIN.",
    });
  } catch (err) {
    console.error("STK push error:", err.response?.data || err.message);
    res.status(502).json({
      success: false,
      fallbackToPaybill: true,
      message: "Unable to reach M-Pesa right now.",
    });
  }
});

// GET /deposit/status/:checkoutRequestId — frontend polls this
router.get("/deposit/status/:checkoutRequestId", requireLogin, async (req, res) => {
  try {
    const tx = await Transaction.findOne({
      checkoutRequestId: req.params.checkoutRequestId,
      userId: req.session.userId,
    });

    if (!tx) return res.status(404).json({ status: "not_found" });
    res.json({ status: tx.status, code: tx.code, amount: tx.amount });
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ status: "error" });
  }
});

// POST /daraja/callback — Safaricom calls this (no auth, no login — it's not the user's browser)
router.post("/daraja/callback", express.json(), async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0, ResultDesc: "Ignored" });

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

    // Atomically claim this transaction for processing — flips status away from
    // "pending" in the same operation that reads it, so if Safaricom retries the
    // same callback (which it does on timeout), the second call finds status is
    // no longer "pending" and does nothing. This is what was causing the same
    // deposit to be credited twice (once to depositBalance, once to walletBalance
    // after the user activated in between).
    const tx = await Transaction.findOneAndUpdate(
      { checkoutRequestId: CheckoutRequestID, status: "pending" },
      { $set: { status: "processing" } },
      { new: true }
    );

    if (!tx) {
      // Either no such transaction, or it was already processed/claimed —
      // safe to just ack and stop.
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const get = (name) => items.find((i) => i.Name === name)?.Value;

      tx.status = "completed";
      tx.code = get("MpesaReceiptNumber");
      tx.amount = get("Amount") || tx.amount;
      await tx.save();

      await creditDeposit(tx.userId, tx.amount);
    } else {
      tx.status = "failed";
      tx.note = ResultDesc;
      await tx.save();
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("Daraja callback error:", err);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" }); // always ack so Safaricom stops retrying
  }
});

function requireAdmin(req, res, next) {
  if (!res.locals.user || !res.locals.user.isAdmin) {
    return res.status(403).send("Forbidden");
  }
  next();
}

// POST /deposit/manual — user submits M-Pesa code + amount after paying via Paybill
router.post("/deposit/manual", requireLogin, async (req, res) => {
  const { code, amount, phone } = req.body;
  const amt = Number(amount);

  if (!code || !code.trim() || !amt || amt < 1) {
    return res.status(400).json({ success: false, message: "Enter the M-Pesa code and amount paid." });
  }

  try {
    // Prevent the same M-Pesa code being submitted twice
    const existing = await Transaction.findOne({ code: code.trim().toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "This M-Pesa code has already been submitted." });
    }

    await Transaction.create({
      userId: req.session.userId,
      type: "deposit",
      method: "manual",
      amount: amt,
      code: code.trim().toUpperCase(),
      phone: phone ? daraja.formatPhone(phone) : undefined,
      status: "pending",
      note: "Awaiting admin review",
    });

    res.json({
      success: true,
      message: "Submitted for review. Your wallet will be credited once approved.",
    });
  } catch (err) {
    console.error("Manual deposit submit error:", err);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// GET /admin/deposits/pending — list manual deposits awaiting review
router.get("/admin/deposits/pending", requireLogin, requireAdmin, async (req, res) => {
  try {
    const deposits = await Transaction.find({ method: "manual", status: "pending" })
      .populate("userId", "name phone email")
      .sort({ createdAt: -1 })
      .lean();

    res.render("admin-deposits", { currentPage: "admin-deposits", deposits });
  } catch (err) {
    console.error("Admin deposits list error:", err);
    res.status(500).send("Something went wrong.");
  }
});

// POST /admin/deposits/:id/approve
router.post("/admin/deposits/:id/approve", requireLogin, requireAdmin, async (req, res) => {
  try {
    // Atomically claim the transaction the same way the callback does, so a
    // double-click or duplicate request can't run creditDeposit twice.
    const tx = await Transaction.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      {
        $set: {
          status: "completed",
          reviewedBy: req.session.userId,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!tx) {
      return res.status(400).json({ success: false, message: "Transaction not found or already reviewed." });
    }

    await creditDeposit(tx.userId, tx.amount);

    res.json({ success: true });
  } catch (err) {
    console.error("Approve deposit error:", err);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

// POST /admin/deposits/:id/reject
router.post("/admin/deposits/:id/reject", requireLogin, requireAdmin, async (req, res) => {
  try {
    const tx = await Transaction.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      {
        $set: {
          status: "failed",
          reviewedBy: req.session.userId,
          reviewedAt: new Date(),
          note: req.body.reason || "Rejected by admin",
        },
      },
      { new: true }
    );

    if (!tx) {
      return res.status(400).json({ success: false, message: "Transaction not found or already reviewed." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject deposit error:", err);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

module.exports = router;
module.exports.creditDeposit = creditDeposit;