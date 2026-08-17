const mongoose = require("mongoose");
const User = require("../models/User");
const VaultMarket = require("../models/VaultMarket");
const VaultOrder = require("../models/VaultOrder");
const VaultTransaction = require("../models/VaultTransaction");

// ---------- helper: compute direction + high/low/change stats from history ----------
function computeMarketStats(market) {
  const hist = market.priceHistory;

  let priceDirection = "flat";
  if (hist.length >= 2) {
    const prev = hist[hist.length - 2].price;
    if (market.currentPrice > prev) priceDirection = "up";
    else if (market.currentPrice < prev) priceDirection = "down";
  }

  const priceValues = hist.map(h => h.price);
  const high = priceValues.length ? Math.max(...priceValues) : market.currentPrice;
  const low = priceValues.length ? Math.min(...priceValues) : market.currentPrice;
  const first = priceValues.length ? priceValues[0] : market.currentPrice;
  const changePct = first ? (((market.currentPrice - first) / first) * 100).toFixed(2) : "0.00";

  return { priceDirection, high, low, changePct };
}

// ---------- GET /vault-coin ----------
exports.getVaultCoin = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const user = await User.findById(req.session.userId);
    const market = await VaultMarket.getSingleton();
    const { priceDirection, high, low, changePct } = computeMarketStats(market);

    const openOrders = await VaultOrder.find({
      status: { $in: ["active", "partial"] },
      seller: { $ne: user._id },
    })
      .populate("seller", "username")
      .sort({ createdAt: -1 })
      .lean();

    const myOrders = await VaultOrder.find({
      seller: user._id,
      status: { $in: ["active", "partial"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    const recentTrades = await VaultTransaction.find({
      $or: [{ buyer: user._id }, { seller: user._id }],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.render("vault-coin", {
      currentPage: "vault-coin",
      user,
      market,
      priceDirection,
      high,
      low,
      changePct,
      openOrders,
      myOrders,
      recentTrades,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error loading vault-coin:", err);
    res.status(500).send("Server error");
  }
};

async function rerender(req, res, overrides) {
  const user = await User.findById(req.session.userId);
  const market = await VaultMarket.getSingleton();
  const { priceDirection, high, low, changePct } = computeMarketStats(market);

  const openOrders = await VaultOrder.find({
    status: { $in: ["active", "partial"] },
    seller: { $ne: user._id },
  })
    .populate("seller", "username")
    .sort({ createdAt: -1 })
    .lean();
  const myOrders = await VaultOrder.find({
    seller: user._id,
    status: { $in: ["active", "partial"] },
  })
    .sort({ createdAt: -1 })
    .lean();
  const recentTrades = await VaultTransaction.find({
    $or: [{ buyer: user._id }, { seller: user._id }],
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return res.render("vault-coin", {
    currentPage: "vault-coin",
    user,
    market,
    priceDirection,
    high,
    low,
    changePct,
    openOrders,
    myOrders,
    recentTrades,
    error: null,
    success: null,
    ...overrides,
  });
}

// ---------- POST /vault-coin/sell ----------
exports.createSellOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const coinsAmount = parseFloat(req.body.coinsAmount);
    const user = await User.findById(req.session.userId);
    const market = await VaultMarket.getSingleton();

    if (!coinsAmount || coinsAmount <= 0) {
      return rerender(req, res, { error: "Enter a valid coin amount to sell." });
    }
    if (user.coinBalance < coinsAmount) {
      return rerender(req, res, {
        error: `Insufficient VaultJ Coin balance. You have ${user.coinBalance} coins.`,
      });
    }

    // Lock coins into escrow immediately
    user.coinBalance -= coinsAmount;
    await user.save();

    await VaultOrder.create({
      seller: user._id,
      coinsAmount,
      coinsRemaining: coinsAmount,
      baselinePrice: market.currentPrice,
      status: "active",
    });

    return rerender(req, res, {
      success: `Sell order listed: ${coinsAmount} VaultJ Coin(s) at Ksh ${market.currentPrice} baseline. Coins are now locked in escrow.`,
    });
  } catch (err) {
    console.error("Error creating sell order:", err);
    res.status(500).send("Server error");
  }
};

// ---------- POST /vault-coin/cancel/:orderId ----------
exports.cancelSellOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const order = await VaultOrder.findById(req.params.orderId);
    const user = await User.findById(req.session.userId);

    if (!order || String(order.seller) !== String(user._id)) {
      return rerender(req, res, { error: "Order not found." });
    }
    if (!["active", "partial"].includes(order.status)) {
      return rerender(req, res, { error: "This order can no longer be cancelled." });
    }

    // Release remaining escrowed coins back to seller
    user.coinBalance += order.coinsRemaining;
    await user.save();

    order.status = "cancelled";
    order.coinsRemaining = 0;
    await order.save();

    return rerender(req, res, { success: "Sell order cancelled. Coins returned to your wallet." });
  } catch (err) {
    console.error("Error cancelling order:", err);
    res.status(500).send("Server error");
  }
};

// ---------- POST /vault-coin/buy/:orderId ----------
exports.buyCoins = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const session = await mongoose.startSession();
  try {
    let result = null;

    await session.withTransaction(async () => {
      const order = await VaultOrder.findById(req.params.orderId).session(session);
      const market = await VaultMarket.findOne().session(session);
      const buyer = await User.findById(req.session.userId).session(session);

      if (!order || !["active", "partial"].includes(order.status)) {
        throw new Error("This order is no longer available.");
      }
      if (String(order.seller) === String(buyer._id)) {
        throw new Error("You cannot buy your own sell order.");
      }

      const coinsAmount = parseFloat(req.body.coinsAmount);
      if (!coinsAmount || coinsAmount <= 0 || coinsAmount > order.coinsRemaining) {
        throw new Error("Invalid coin amount.");
      }

      const seller = await User.findById(order.seller).session(session);
      const pLive = market.currentPrice;
      const baseline = order.baselinePrice;

      const buyerPaidCash = coinsAmount * pLive;
      const feeCoins = coinsAmount * 0.05;
      const buyerReceivedCoins = coinsAmount * 0.95;
      const sellerReceivedCash = pLive >= baseline ? coinsAmount * baseline : coinsAmount * pLive;
      const spreadCash = pLive > baseline ? coinsAmount * (pLive - baseline) : 0;

      if (buyer.walletBalance < buyerPaidCash) {
        throw new Error(
          `Insufficient wallet balance. You need Ksh ${buyerPaidCash.toFixed(2)} to buy ${coinsAmount} coin(s) at Ksh ${pLive}/coin.`
        );
      }

      // Atomic settlement
      buyer.walletBalance -= buyerPaidCash;
      buyer.coinBalance += buyerReceivedCoins;
      seller.walletBalance += sellerReceivedCash;

      market.treasuryCoins += feeCoins;
      market.treasuryCash += spreadCash;

      order.coinsRemaining -= coinsAmount;
      order.status = order.coinsRemaining <= 0 ? "completed" : "partial";

      await buyer.save({ session });
      await seller.save({ session });
      await market.save({ session });
      await order.save({ session });

      await VaultTransaction.create(
        [
          {
            order: order._id,
            seller: seller._id,
            buyer: buyer._id,
            coinsTraded: coinsAmount,
            executionPrice: pLive,
            baselinePrice: baseline,
            buyerPaidCash,
            buyerReceivedCoins,
            sellerReceivedCash,
            feeCoins,
            spreadCash,
          },
        ],
        { session }
      );

      result = { coinsAmount, pLive };
    });

    session.endSession();
    return rerender(req, res, {
      success: `Purchase complete: you bought ${result.coinsAmount} coin(s) at Ksh ${result.pLive}/coin.`,
    });
  } catch (err) {
    session.endSession();
    console.error("Error executing buy order:", err.message);
    return rerender(req, res, { error: err.message || "Transaction failed." });
  }
};

// ---------- POST /vault-coin/admin/price ----------
exports.setMarketPrice = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) {
      return rerender(req, res, { error: "Not authorized." });
    }

    const newPrice = parseFloat(req.body.price);
    if (!newPrice || newPrice <= 0) {
      return rerender(req, res, { error: "Enter a valid price." });
    }

    const market = await VaultMarket.getSingleton();
    market.currentPrice = newPrice;
    market.priceHistory.push({ price: newPrice, changedBy: user._id });
    await market.save();

    return rerender(req, res, { success: `Market price updated to Ksh ${newPrice}/coin.` });
  } catch (err) {
    console.error("Error updating market price:", err);
    res.status(500).send("Server error");
  }
};