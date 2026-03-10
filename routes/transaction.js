const express = require('express');
const router = express.Router();
const Transaction = require('../models/transaction');
const User = require('../models/user');

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please login first');
  res.redirect('/login');
}

// GET /transactions
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });

    // Calculate totals
    const totalDeposits = transactions
      .filter(tx => tx.type === 'deposit' && tx.status === 'completed')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const totalWithdrawals = transactions
      .filter(tx => tx.type === 'withdrawal' && tx.status === 'completed')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const totalBonuses = transactions
      .filter(tx => tx.type === 'bonus' && tx.status === 'completed')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const walletBalance = (user.depositBalance || 0) + (user.referralEarnings || 0);

    res.render('transaction', {
      user,
      transactions,
      totalDeposits,
      totalWithdrawals,
      totalBonuses,
      walletBalance
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Unable to load transactions');
    res.redirect('/home');
  }
});


router.post("/withdraw", isLoggedIn, async (req, res) => {
    try {
        const { amount } = req.body;
        const user = await User.findById(req.user._id);

        if (amount < 100) {
            req.flash("error", "Minimum withdrawal is KES 100");
            return res.redirect("/home");
        }

        if (user.walletBalance < amount) {
            req.flash("error", "Insufficient wallet balance");
            return res.redirect("/home");
        }

        // Deduct from wallet and create a pending transaction
        user.walletBalance -= amount;
        await user.save();

        await Transaction.create({
            user: user._id,
            type: "withdrawal",
            amount: amount,
            phone: user.phone,
            status: "pending"
        });

        req.flash("success", "Withdrawal request submitted. Awaiting admin approval.");
        res.redirect("/home");
    } catch (err) {
        console.error(err);
        res.redirect("/home");
    }
});

module.exports = router;