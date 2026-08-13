const PACKAGES = require("../config/packages");
const User = require("../models/User"); // adjust path/name to match your project

exports.getAdminPackages = async (req, res) => {
  try {
    // Pull what we need from every user in one query
    const users = await User.find({}, "package packageActivatedAt name email")
      .lean();

    const totalUsers = users.length;

    const stats = {};
    Object.keys(PACKAGES).forEach((key) => {
      stats[key] = { activeUsers: 0, revenue: 0 };
    });

    let usersWithPackage = 0;

    users.forEach((u) => {
      if (u.package && stats[u.package]) {
        stats[u.package].activeUsers += 1;
        stats[u.package].revenue += PACKAGES[u.package].price || 0;
        usersWithPackage += 1;
      }
    });

    const usersWithNoPackage = totalUsers - usersWithPackage;
    const adoptionRate =
      totalUsers > 0
        ? ((usersWithPackage / totalUsers) * 100).toFixed(1)
        : "0.0";

    // Recent package activity: last 10 users who have a package,
    // sorted by when they activated it (falls back to _id if no timestamp field)
    const recentActivity = users
      .filter((u) => u.package && PACKAGES[u.package])
      .sort((a, b) => {
        const aDate = a.packageActivatedAt
          ? new Date(a.packageActivatedAt)
          : a._id.getTimestamp();
        const bDate = b.packageActivatedAt
          ? new Date(b.packageActivatedAt)
          : b._id.getTimestamp();
        return bDate - aDate;
      })
      .slice(0, 10)
      .map((u) => ({
        name: u.name || u.email || "Unknown user",
        packageKey: u.package,
        packageName: PACKAGES[u.package].name,
        date: u.packageActivatedAt
          ? new Date(u.packageActivatedAt)
          : u._id.getTimestamp(),
      }));

    res.render("admin/packages", {
      currentPage: "packages",
      packages: PACKAGES,
      stats,
      totalUsers,
      usersWithPackage,
      usersWithNoPackage,
      adoptionRate,
      recentActivity,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading admin packages:", err);
    res.status(500).send("Server error");
  }
};

exports.getPackageUsers = async (req, res) => {
  try {
    const { key } = req.params;
    const pkg = PACKAGES[key];

    if (!pkg) {
      return res.status(404).send("Package not found");
    }

    const users = await User.find({ package: key })
      .select("name email package packageActivatedAt createdAt")
      .sort({ packageActivatedAt: -1, createdAt: -1 })
      .lean();

    res.render("admin/packageUsers", {
      currentPage: "packages",
      packageKey: key,
      pkg,
      users,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading package users:", err);
    res.status(500).send("Server error");
  }
};