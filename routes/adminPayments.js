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

router.post("/payments/verify/:id", async (req, res) => {
    try {
        const payment = await Transaction.findById(req.params.id).populate("user");
        if (!payment) {
            req.flash("error", "Payment not found");
            return res.redirect("/admin/payments");
        }

        payment.status = "completed";
        payment.code = req.body.receipt;
        await payment.save();

        // Update the user's balances
        const user = await User.findById(payment.user._id);
        user.depositBalance += payment.amount;
        user.walletBalance += payment.amount; // If wallet includes deposit
        await user.save();

        req.flash("success", `Deposit of KES ${payment.amount} verified`);
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

        if (payment.status !== 'pending') {
            req.flash('error', 'Only pending payments can be rejected');
            return res.redirect('/admin/payments');
        }

        // Update status to failed
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
