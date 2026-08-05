const express = require('express');
const router = express.Router();
const Transaction = require('../models/transaction');
const { isAdmin } = require('../middleware/auth');
const User = require('../models/user');

// GET admin payments page
router.get('/payments', isAdmin, async (req, res) => {
  try {
    const { from, to, phone, amount, status, type } = req.query;

    let query = {};

    if (phone) query.phone = phone;
    if (amount) query.amount = Number(amount);
    if (status) query.status = status;
    if (type) query.type = type;

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const payments = await Transaction.find(query)
      .populate('user', 'username email')
      .sort({ createdAt: -1 });

    res.render('admin/payments', { payments });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post("/payments/verify/:id", isAdmin, async (req, res) => {
    try {
        const payment = await Transaction.findById(req.params.id).populate("user");
        if (!payment) {
            req.flash("error", "Payment not found");
            return res.redirect("/admin/payments");
        }

        // STK deposits are resolved automatically by the M-Pesa callback.
        // Admins must never manually verify these — doing so risks double-crediting
        // the user if the real callback arrives after this manual action.
        if (payment.method === "stk") {
            req.flash("error", "STK Push deposits are verified automatically by M-Pesa and cannot be manually approved.");
            return res.redirect("/admin/payments");
        }

        // Guard against double-verification (e.g. admin double-clicking, or re-submitting the form)
        if (payment.status !== "pending") {
            req.flash("error", "This payment has already been processed");
            return res.redirect("/admin/payments");
        }

        const user = await User.findById(payment.user._id);
        if (!user) {
            req.flash("error", "User for this payment no longer exists");
            return res.redirect("/admin/payments");
        }

        payment.status = "completed";
        payment.code = req.body.receipt;
        await payment.save();

        // Same rule as the STK callback: inactive users (no package) get credited to
        // depositBalance; active users' deposits go to walletBalance. Never both.
        if (user.isActive) {
            user.walletBalance += payment.amount;
        } else {
            user.depositBalance += payment.amount;
        }
        await user.save();

        req.flash("success", `Deposit of KES ${payment.amount} verified and credited to ${user.isActive ? "wallet" : "deposit"} balance`);
        res.redirect("/admin/payments");

    } catch (err) {
        console.error(err);
        req.flash("error", "Something went wrong");
        res.redirect("/admin/payments");
    }
});

// --- Reject a deposit ---
router.post('/payments/reject/:id', isAdmin, async (req, res) => {
    try {
        const payment = await Transaction.findById(req.params.id);
        if (!payment) {
            req.flash('error', 'Payment not found');
            return res.redirect('/admin/payments');
        }

        // Same rule as verify: STK deposits resolve themselves via the M-Pesa callback
        // (ResultCode !== 0 already marks them "failed" automatically). No manual reject needed.
        if (payment.method === "stk") {
            req.flash("error", "STK Push deposits are resolved automatically by M-Pesa and cannot be manually rejected.");
            return res.redirect("/admin/payments");
        }

        if (payment.status !== 'pending') {
            req.flash('error', 'Only pending payments can be rejected');
            return res.redirect('/admin/payments');
        }

        payment.status = 'failed';
        await payment.save();

        req.flash('success', 'Payment rejected successfully');
        res.redirect('/admin/payments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Something went wrong');
        res.redirect('/admin/payments');
    }
});

module.exports = router;