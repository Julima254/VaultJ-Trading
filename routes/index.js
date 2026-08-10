const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

// ---------- GET routes ----------

router.get("/", (req, res) => {
  res.render("landing");
});

router.get("/landing", (req, res) => {
  res.render("landing");
});

router.get("/register", (req, res) => {
  res.render("register", { error: null });
});

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { error: null, success: null });
});

// Old /dashboard link forwards to /home so nothing breaks if it's still referenced anywhere
router.get("/dashboard", requireAuth, (req, res) => {
  res.redirect("/home");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ---------- POST routes ----------

router.post("/register", async (req, res) => {
  try {
    const { username, email, phone, country, invitationCode, password, confirmPassword } = req.body;

    if (!username || !email || !phone || !country || !password || !confirmPassword) {
      return res.render("register", { error: "Please fill in all required fields." });
    }

    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match." });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.render("register", { error: "Username or email already in use." });
    }

    // ---- Link this user to whoever referred them (if a valid code was entered) ----
    let referredBy = null;
    if (invitationCode) {
      const referrer = await User.findOne({ referralCode: invitationCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    const newUser = new User({
      username,
      email,
      phone,
      country,
      invitationCode: invitationCode || null,
      referredBy,
      referralCode: username, // this user's own shareable code — others enter this as their invitationCode
      password, // hashed automatically by the pre-save hook
    });

    await newUser.save();

    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.render("register", { error: "Something went wrong. Please try again." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.render("login", { error: "Please enter your username/email and password." });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
    });

    if (!user) {
      return res.render("login", { error: "Invalid credentials." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render("login", { error: "Invalid credentials." });
    }

    req.session.userId = user._id;
    req.session.username = user.username;

    res.redirect("/home");
  } catch (err) {
    console.error(err);
    res.render("login", { error: "Something went wrong. Please try again." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { username, email } = req.body;

    if (!username || !email) {
      return res.render("forgot-password", { error: "Please enter both username and email.", success: null });
    }

    const user = await User.findOne({ username, email: email.toLowerCase() });

    // Always show the same success message whether or not the user exists,
    // so attackers can't use this form to check which emails are registered
    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      user.resetToken = resetToken;
      user.resetTokenExpires = Date.now() + 1000 * 60 * 30; // 30 mins
      await user.save();

      // TODO: send an email to user.email containing a link like:
      // https://yourdomain.com/reset-password/${resetToken}
      // Use nodemailer or a transactional email service (SendGrid, Mailgun, etc.)
    }

    res.render("forgot-password", {
      error: null,
      success: "If the details match an account, password reset instructions have been sent to your email.",
    });
  } catch (err) {
    console.error(err);
    res.render("forgot-password", { error: "Something went wrong. Please try again.", success: null });
  }
});

module.exports = router;