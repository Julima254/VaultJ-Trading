const express = require('express');
const router = express.Router();
const User = require('../models/user');

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

router.get('/', isLoggedIn, async (req, res) => {
    try {
        const team = await User.find({ referrer: req.user._id });
        const totalReferrals = team.length;
        const totalEarnings = team.reduce((sum, u) => sum + (u.referralEarnings || 0), 0);

        // Pass the logged-in user to EJS
        res.render('team', { team, totalReferrals, totalEarnings, user: req.user });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load your team');
        res.redirect('/home');
    }
});

module.exports = router;