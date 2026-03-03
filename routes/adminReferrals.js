const express = require('express');
const router = express.Router();
const User = require('../models/user');

// ===== ADMIN GUARD =====
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user?.isAdmin) return next();
    req.flash('error', 'Access denied');
    res.redirect('/home');
}

// ===== ADMIN REFERRALS DASHBOARD =====
router.get('/', isAdmin, async (req, res) => {
    try {
        // Fetch all users who have referred at least 1 person
        const users = await User.find({ referrer: { $exists: true } }).populate('referrer');

        // Build referral data
        const referralData = await Promise.all(users.map(async user => {
            // Count how many users this user referred
            const totalReferrals = await User.countDocuments({ referrer: user._id });

            return {
                username: user.username,
                package: user.package,
                totalReferrals,
                referralEarnings: user.referralEarnings || 0,
                walletBalance: user.walletBalance || 0,
                lastReferral: user.createdAt
            };
        }));

        // Sort by totalReferrals descending
        referralData.sort((a, b) => b.totalReferrals - a.totalReferrals);

        res.render('admin/referrals', { referralData });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Cannot load referrals');
        res.redirect('/admin');
    }
});

module.exports = router;