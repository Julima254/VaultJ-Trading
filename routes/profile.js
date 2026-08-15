const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Swap this out for your existing auth middleware if you have one
// (e.g. require("../middleware/auth")). This is just a safe inline fallback.
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

// GET /profile — render the profile page
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();

    if (!user) {
      req.session.destroy(() => {});
      return res.redirect("/login");
    }

    res.locals.currentPage = "profile";
    res.render("profile", { user });
  } catch (err) {
    console.error("Error loading profile:", err);
    res.status(500).send("Something went wrong loading your profile.");
  }
});

// POST /profile/update — update personal details
router.post("/profile/update", requireAuth, async (req, res) => {
  try {
    const { username, email, phone, country } = req.body;

    if (!username || !email || !phone || !country) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Make sure the new username/email isn't already taken by someone else
    const existing = await User.findOne({
      _id: { $ne: req.session.userId },
      $or: [{ username: cleanUsername }, { email: cleanEmail }],
    }).lean();

    if (existing) {
      return res.status(400).json({
        success: false,
        message:
          existing.username === cleanUsername
            ? "That username is already taken."
            : "That email is already in use.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      {
        username: cleanUsername,
        email: cleanEmail,
        phone: phone.trim(),
        country: country.trim(),
      },
      { new: true, runValidators: true }
    ).lean();

    res.json({ success: true, message: "Profile updated successfully.", user });
  } catch (err) {
    console.error("Error updating profile:", err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Username or email already in use." });
    }
    res.status(500).json({ success: false, message: "Failed to update profile." });
  }
});

// POST /profile/change-password — change password
router.post("/profile/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters." });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "New passwords do not match." });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }

    user.password = newPassword; // pre-save hook in User.js hashes this
    await user.save();

    res.json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    console.error("Error changing password:", err);
    res.status(500).json({ success: false, message: "Failed to change password." });
  }
});

module.exports = router;