const User = require("../models/User");

exports.getMyTeam = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/login");

    const teamMembers = await User.find({ referredBy: user._id })
      .select("username email package isActive packagePrice createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const activeReferrals = teamMembers.filter((m) => m.isActive).length;

    res.render("my-team", {
      currentPage: "my-team",
      user,
      teamMembers,
      totalReferrals: teamMembers.length,
      activeReferrals,
      error: null,
    });
  } catch (err) {
    console.error("Error loading team:", err);
    res.status(500).send("Server error");
  }
};