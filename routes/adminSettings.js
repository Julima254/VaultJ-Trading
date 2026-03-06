const express = require('express');
const router = express.Router();
const User = require('../models/user');

// Admin guard middleware
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user?.isAdmin) return next();
    req.flash('error', 'Access denied');
    res.redirect('/home');
}

// GET all users
// GET /admin/settings
router.get('/', isAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.render('admin/settings', { users });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load settings');
        res.redirect('/admin');
    }
});

// POST /admin/settings/users/:id/remove-admin
router.post('/users/:id/remove-admin', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/settings');
        }

        user.isAdmin = false;
        await user.save();

        req.flash('success', `${user.username} is no longer an admin`);
        res.redirect('/admin/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Something went wrong');
        res.redirect('/admin/settings');
    }
});
module.exports = router;