const mongoose = require("mongoose");
const User = require("../models/User");
const VaultMarket = require("../models/VaultMarket");
const VaultOrder = require("../models/VaultOrder");
const VaultBuyOrder = require("../models/VaultBuyOrder");
const VaultTransaction = require("../models/VaultTransaction");

// ---------- helpers ----------
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const PRICE_IMPACT = {
  buyPct: 0.35,    // % price increase per coin actually bought (demand)
  buyCap: 10,      // max % move from a single trade chunk
  listPct: 0.2,    // % price decrease per coin newly listed for sale (supply)
  listCap: 6,
  cancelPct: 0.15, // % price move when supply/demand is pulled off the market
  cancelCap: 5,
  minPrice: 0.5,
};

function applyPriceImpact(market, coins, direction, pctPerCoin, cap) {
  if (!coins || coins <= 0) return;
  const impactPct = Math.min(coins * pctPerCoin, cap);
  const multiplier = direction === "up" ? 1 + impactPct / 100 : 1 - impactPct / 100;
  const newPrice = Math.max(round2(market.currentPrice * multiplier), PRICE_IMPACT.minPrice);
  market.currentPrice = newPrice;
  market.priceHistory.push({ price: newPrice });
}

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

// ---------- core matching: one chunk between one sell order and one buy order ----------
async function executeTrade(session, market, sellOrder, buyOrder, seller, buyer) {
  const tradeAmount = round2(
    Math.min(sellOrder.coinsRemaining, buyOrder.coinsWanted - buyOrder.coinsFilled)
  );
  if (tradeAmount <= 0) return 0;

  const livePrice = market.currentPrice;

  // Buyer always pays the current live price at the moment their coins actually fill —
  // if price rose since they placed the order, they pay more (extra pulled from wallet
  // below); if price fell, they pay less (refunded below).
  const buyerExecPrice = livePrice;

  // Seller always gets the lower of what they listed at vs. the current live price —
  // they don't benefit from a price rise above their ask, but they do bear a price drop.
  const sellerExecPrice = livePrice >= sellOrder.baselinePrice ? sellOrder.baselinePrice : livePrice;

  const buyerPays = round2(tradeAmount * buyerExecPrice);
  const reservedForChunk = round2(tradeAmount * buyOrder.baselinePrice);

  // Positive refund = buyer gets cash back (price fell).
  // Negative refund = extra cash is pulled from the buyer's wallet (price rose).
  const refund = round2(reservedForChunk - buyerPays);

  const feeCoins = round2(tradeAmount * 0.05);
  const buyerReceivedCoins = round2(tradeAmount - feeCoins);
  const sellerReceivedCash = round2(tradeAmount * sellerExecPrice);
  const spreadCash = round2(buyerPays - sellerReceivedCash); // system profit (or loss) on this chunk

  buyer.walletBalance = round2(buyer.walletBalance + refund);
  buyer.coinBalance = round2(buyer.coinBalance + buyerReceivedCoins);
  seller.walletBalance = round2(seller.walletBalance + sellerReceivedCash);

  market.treasuryCoins = round2(market.treasuryCoins + feeCoins);
  market.treasuryCash = round2(market.treasuryCash + spreadCash);

  sellOrder.coinsRemaining = round2(sellOrder.coinsRemaining - tradeAmount);
  sellOrder.status = sellOrder.coinsRemaining <= 0 ? "completed" : "partial";

  buyOrder.coinsFilled = round2(buyOrder.coinsFilled + tradeAmount);
  buyOrder.cashRemaining = round2(buyOrder.cashRemaining - reservedForChunk);
  buyOrder.status = buyOrder.coinsFilled >= buyOrder.coinsWanted ? "completed" : "partial";

  await buyer.save({ session });
  await seller.save({ session });

  await VaultTransaction.create(
    [
      {
        order: sellOrder._id,
        seller: seller._id,
        buyer: buyer._id,
        coinsTraded: tradeAmount,
        executionPrice: livePrice,
        baselinePrice: sellOrder.baselinePrice,
        buyerPaidCash: buyerPays,
        buyerReceivedCoins,
        sellerReceivedCash,
        feeCoins,
        spreadCash,
      },
    ],
    { session }
  );

  // A completed trade is demand being satisfied — nudge price up for the next chunk
  applyPriceImpact(market, tradeAmount, "up", PRICE_IMPACT.buyPct, PRICE_IMPACT.buyCap);

  return tradeAmount;
}

async function matchNewBuyOrder(session, market, buyOrder, buyer) {
  const openSells = await VaultOrder.find({
    status: { $in: ["active", "partial"] },
    seller: { $ne: buyer._id },
  })
    .sort({ baselinePrice: 1, createdAt: 1 })
    .session(session);

  for (const sellOrder of openSells) {
    if (buyOrder.coinsFilled >= buyOrder.coinsWanted) break;
    const seller = await User.findById(sellOrder.seller).session(session);
    const traded = await executeTrade(session, market, sellOrder, buyOrder, seller, buyer);
    if (traded > 0) await sellOrder.save({ session });
  }

  await buyOrder.save({ session });
  await market.save({ session });
}

async function matchNewSellOrder(session, market, sellOrder, seller) {
  const pendingBuys = await VaultBuyOrder.find({
    status: { $in: ["active", "partial"] },
    buyer: { $ne: seller._id },
  })
    .sort({ createdAt: 1 })
    .session(session);

  for (const buyOrder of pendingBuys) {
    if (sellOrder.coinsRemaining <= 0) break;
    const buyer = await User.findById(buyOrder.buyer).session(session);
    const traded = await executeTrade(session, market, sellOrder, buyOrder, seller, buyer);
    if (traded > 0) await buyOrder.save({ session });
  }

  await sellOrder.save({ session });
  await market.save({ session });
}

// ---------- shared render data ----------
async function buildViewData(userId, overrides) {
  const user = await User.findById(userId);
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

  const myBuyOrders = await VaultBuyOrder.find({
    buyer: user._id,
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

  return {
    currentPage: "vault-coin",
    user,
    market,
    priceDirection,
    high,
    low,
    changePct,
    openOrders,
    myOrders,
    myBuyOrders,
    recentTrades,
    error: null,
    success: null,
    ...overrides,
  };
}

// ---------- GET /vault-coin ----------
exports.getVaultCoin = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    const data = await buildViewData(req.session.userId, {});
    res.render("vault-coin", data);
  } catch (err) {
    console.error("Error loading vault-coin:", err);
    res.status(500).send("Server error");
  }
};

async function rerender(req, res, overrides) {
  const data = await buildViewData(req.session.userId, overrides);
  return res.render("vault-coin", data);
}

// ---------- POST /vault-coin/sell ----------
exports.createSellOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  await VaultMarket.getSingleton(); // ensure the singleton exists before the transaction
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const coinsAmount = round2(parseFloat(req.body.coinsAmount));
      if (!coinsAmount || coinsAmount <= 0) {
        throw new Error("Enter a valid coin amount to sell.");
      }

      const seller = await User.findById(req.session.userId).session(session);
      const market = await VaultMarket.findOne().session(session);

      if (seller.coinBalance < coinsAmount) {
        throw new Error(`Insufficient VaultJ Coin balance. You have ${seller.coinBalance.toFixed(2)} coins.`);
      }

      seller.coinBalance = round2(seller.coinBalance - coinsAmount);
      await seller.save({ session });

      const [sellOrder] = await VaultOrder.create(
        [
          {
            seller: seller._id,
            coinsAmount,
            coinsRemaining: coinsAmount,
            baselinePrice: market.currentPrice,
            status: "active",
          },
        ],
        { session }
      );

      // New supply on the market nudges price down
      applyPriceImpact(market, coinsAmount, "down", PRICE_IMPACT.listPct, PRICE_IMPACT.listCap);

      // Immediately try to fill any pending buy orders against this new listing
      await matchNewSellOrder(session, market, sellOrder, seller);
    });

    session.endSession();
    return rerender(req, res, {
      success: "Sell order listed and coins locked in escrow. Any matching buy orders were filled automatically.",
    });
  } catch (err) {
    session.endSession();
    console.error("Error creating sell order:", err.message);
    return rerender(req, res, { error: err.message || "Server error" });
  }
};

// ---------- POST /vault-coin/cancel/:orderId ----------
exports.cancelSellOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await VaultOrder.findById(req.params.orderId).session(session);
      const user = await User.findById(req.session.userId).session(session);
      const market = await VaultMarket.findOne().session(session);

      if (!order || String(order.seller) !== String(user._id)) {
        throw new Error("Order not found.");
      }
      if (!["active", "partial"].includes(order.status)) {
        throw new Error("This order can no longer be cancelled.");
      }

      user.coinBalance = round2(user.coinBalance + order.coinsRemaining);
      await user.save({ session });

      // Removing supply from the market nudges price back up
      applyPriceImpact(market, order.coinsRemaining, "up", PRICE_IMPACT.cancelPct, PRICE_IMPACT.cancelCap);
      await market.save({ session });

      order.status = "cancelled";
      order.coinsRemaining = 0;
      await order.save({ session });
    });

    session.endSession();
    return rerender(req, res, { success: "Sell order cancelled. Coins returned to your wallet." });
  } catch (err) {
    session.endSession();
    console.error("Error cancelling order:", err.message);
    return rerender(req, res, { error: err.message || "Server error" });
  }
};

// ---------- POST /vault-coin/buy ----------
// Places (and immediately tries to fill) a buy order. No specific seller is targeted —
// the engine matches against the cheapest open sell orders first.
exports.createBuyOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  await VaultMarket.getSingleton();
  const session = await mongoose.startSession();
  try {
    let placedAmount = 0;

    await session.withTransaction(async () => {
      const coinsAmount = round2(parseFloat(req.body.coinsAmount));
      if (!coinsAmount || coinsAmount <= 0) {
        throw new Error("Enter a valid coin amount to buy.");
      }

      const buyer = await User.findById(req.session.userId).session(session);
      const market = await VaultMarket.findOne().session(session);

      const baselinePrice = market.currentPrice;
      const cashNeeded = round2(coinsAmount * baselinePrice);

      if (buyer.walletBalance < cashNeeded) {
        throw new Error(
          `Insufficient wallet balance. You need Ksh ${cashNeeded.toFixed(2)} to place this buy order at Ksh ${baselinePrice}/coin.`
        );
      }

      buyer.walletBalance = round2(buyer.walletBalance - cashNeeded);
      await buyer.save({ session });

      const [buyOrder] = await VaultBuyOrder.create(
        [
          {
            buyer: buyer._id,
            coinsWanted: coinsAmount,
            coinsFilled: 0,
            baselinePrice,
            cashEscrowed: cashNeeded,
            cashRemaining: cashNeeded,
            status: "active",
          },
        ],
        { session }
      );

      await matchNewBuyOrder(session, market, buyOrder, buyer);
      placedAmount = coinsAmount;
    });

    session.endSession();
    return rerender(req, res, {
      success: `Buy order placed for ${placedAmount.toFixed(2)} VJC. Available coins were purchased immediately at the best price; any remainder will fill automatically as new sell orders come in.`,
    });
  } catch (err) {
    session.endSession();
    console.error("Error placing buy order:", err.message);
    return rerender(req, res, { error: err.message || "Transaction failed." });
  }
};

// ---------- POST /vault-coin/buy-order/cancel/:orderId ----------
exports.cancelBuyOrder = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await VaultBuyOrder.findById(req.params.orderId).session(session);
      const user = await User.findById(req.session.userId).session(session);
      const market = await VaultMarket.findOne().session(session);

      if (!order || String(order.buyer) !== String(user._id)) {
        throw new Error("Order not found.");
      }
      if (!["active", "partial"].includes(order.status)) {
        throw new Error("This order can no longer be cancelled.");
      }

      user.walletBalance = round2(user.walletBalance + order.cashRemaining);
      await user.save({ session });

      const unfilledCoins = round2(order.coinsWanted - order.coinsFilled);
      // Removing demand from the market nudges price back down
      applyPriceImpact(market, unfilledCoins, "down", PRICE_IMPACT.cancelPct, PRICE_IMPACT.cancelCap);
      await market.save({ session });

      order.status = "cancelled";
      order.cashRemaining = 0;
      await order.save({ session });
    });

    session.endSession();
    return rerender(req, res, { success: "Buy order cancelled. Remaining cash returned to your wallet." });
  } catch (err) {
    session.endSession();
    console.error("Error cancelling buy order:", err.message);
    return rerender(req, res, { error: err.message || "Server error" });
  }
};