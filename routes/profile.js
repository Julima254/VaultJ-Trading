const express = require('express');
const router = express.Router();
const User = require('../models/user');
const passport = require('passport');

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

// ===== GET Profile Page =====
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        // Count total referrals
        const totalReferrals = await User.countDocuments({ referrer: user._id });

        res.render('profile', { user, totalReferrals });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load profile');
        res.redirect('/home');
    }
});

// ===== GET Edit Profile Page =====
router.get('/edit', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        res.render('edit-profile', { user });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load profile edit page');
        res.redirect('/profile');
    }
});

// ===== POST Edit Profile =====
router.post('/edit', isLoggedIn, async (req, res) => {
    try {
        const { email, phone, country } = req.body;
        const user = await User.findById(req.user._id);

        user.email = email;
        user.phone = phone;
        user.country = country;

        await user.save();
        req.flash('success', 'Profile updated successfully!');
        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update profile');
        res.redirect('/profile/edit');
    }
});

// ===== GET Change Password Page =====
router.get('/change-password', isLoggedIn, (req, res) => {
    res.render('change-password', { user: req.user });
});

// ===== POST Change Password =====
router.post('/change-password', isLoggedIn, async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/profile/change-password');
        }

        const user = await User.findById(req.user._id);

        await user.changePassword(oldPassword, newPassword); // passport-local-mongoose method
        req.flash('success', 'Password changed successfully!');
        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to change password. Make sure your old password is correct.');
        res.redirect('/profile/change-password');
    }
});

module.exports = router;