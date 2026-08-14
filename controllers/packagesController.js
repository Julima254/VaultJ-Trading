const User = require("../models/User");
const PACKAGES = require("../config/packages");

exports.getPackages = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const user = await User.findById(req.session.userId);
    res.render("packages", {
      currentPage: "packages",
      packages: PACKAGES,
      user,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading packages:", err);
    res.status(500).send("Server error");
  }
};

exports.buyPackage = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const { packageKey } = req.body;
  const selected = PACKAGES[packageKey];

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/login");

    if (!selected) {
      return res.render("packages", {
        currentPage: "packages",
        packages: PACKAGES,
        user,
        error: "Invalid package selected.",
        success: null,
      });
    }

    const price = selected.price;
    const isFirstPurchase = !user.isActive;

    if (isFirstPurchase) {
      // First ever purchase: pay from deposit balance
      if (user.depositBalance < price) {
        return res.render("packages", {
          currentPage: "packages",
          packages: PACKAGES,
          user,
          error: `Insufficient deposit balance. You need Ksh ${price} in your deposit balance to activate the ${selected.name} package.`,
          success: null,
        });
      }

      user.depositBalance -= price;

      // Whatever is left in deposit balance moves to wallet balance
      if (user.depositBalance > 0) {
        user.walletBalance += user.depositBalance;
        user.depositBalance = 0;
      }
    } else {
      // Every purchase after the first: pay from wallet balance
      if (user.walletBalance < price) {
        return res.render("packages", {
          currentPage: "packages",
          packages: PACKAGES,
          user,
          error: `Insufficient wallet balance. You need Ksh ${price} in your wallet to purchase the ${selected.name} package.`,
          success: null,
        });
      }

      user.walletBalance -= price;
    }

    user.package = selected.name;
    user.packagePrice = price;
    user.isActive = true;

    await user.save();

    // ---- Referral commission: ONLY on this user's first-ever activation ----
    // Prevents the referrer from being paid again on repeat/upgrade purchases.
    if (isFirstPurchase && user.referredBy) {
      const referrer = await User.findById(user.referredBy);
      if (referrer) {
        const commission = price * selected.referral;
        referrer.walletBalance += commission;
        referrer.referralEarnings += commission;
        referrer.totalReferrals += 1;

        await referrer.save();
      }
    }

    res.render("packages", {
      currentPage: "packages",
      packages: PACKAGES,
      user,
      error: null,
      success: `You have successfully activated the ${selected.name} package!`,
    });
  } catch (err) {
    console.error("Error purchasing package:", err);
    res.status(500).send("Server error");
  }
};