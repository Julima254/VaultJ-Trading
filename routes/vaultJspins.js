const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const PrizePool = require("../models/PrizePool");
const SpinLog = require("../models/SpinLog");
const { resolveSpin, round2 } = require("../utils/spinEngine");

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// ---- GET: render the spin page ----
router.get("/vault-jspins", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    const pool = await PrizePool.getPool();

    res.render("vault-jspins", {
      currentPage: "vault-jspins",
      walletBalance: user.walletBalance,
      poolBalance: pool.balance,
      poolAvailable: pool.balance > 0, // <-- add this
    });
  } catch (err) {
    console.error("Error loading vault-jspins page:", err);
    res.status(500).send("Something went wrong loading the game.");
  }
});

// ---- POST: execute a spin ----
router.post("/vault-jspins/spin", requireLogin, async (req, res) => {
  const stake = Number(req.body.stake);

  if (!Number.isFinite(stake) || stake <= 0) {
    return res.status(400).json({ ok: false, message: "Enter a valid stake amount." });
  }

  const session = await mongoose.startSession();

  try {
    let responsePayload;

    await session.withTransaction(async () => {
      const user = await User.findById(req.session.userId).session(session);
      if (!user) throw Object.assign(new Error("User not found"), { code: "NO_USER" });

      if (user.walletBalance < stake) {
        throw Object.assign(new Error("Insufficient wallet balance."), { code: "INSUFFICIENT_WALLET" });
      }

      const pool = await PrizePool.findOne().session(session);
      if (!pool) throw Object.assign(new Error("Prize pool not configured."), { code: "NO_POOL" });

      // Backend is the sole source of truth for the outcome
      const { multiplier, payout, eligibleMultipliers } = resolveSpin(stake, pool.balance);

      const walletBefore = user.walletBalance;
      const poolBefore = pool.balance;

      user.walletBalance = round2(user.walletBalance - stake + payout);
      pool.balance = round2(pool.balance - payout);

      await user.save({ session });
      await pool.save({ session });

      await SpinLog.create(
        [{
          user: user._id,
          stake,
          multiplier,
          payout,
          poolBefore,
          poolAfter: pool.balance,
          walletBefore,
          walletAfter: user.walletBalance,
          eligibleMultipliers,
        }],
        { session }
      );

      responsePayload = {
        ok: true,
        multiplier,
        payout,
        stake,
        walletBalance: user.walletBalance,
        poolBalance: pool.balance,
      };
    });

    res.json(responsePayload);
  } catch (err) {
    const knownErrors = {
      INSUFFICIENT_WALLET: 400,
      POOL_INSUFFICIENT: 400,
      NO_POOL: 500,
      NO_USER: 401,
    };
    const status = knownErrors[err.code] || 500;
    if (!knownErrors[err.code]) console.error("Spin error:", err);
    res.status(status).json({ ok: false, code: err.code || "DEFAULT", message: err.message || "Spin failed." });
  } finally {
    session.endSession();
  }
});

module.exports = router;