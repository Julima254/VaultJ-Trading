const express = require('express');
const router = express.Router();
const User = require('../models/user');
const VaultCoin = require('../models/vaultCoin');
const CoinOrder = require('../models/coinOrder');
const Trade = require('../models/trade'); // Make sure this exists

// Middleware
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

// ========================
// GET /coin - User Dashboard
// ========================
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        // Ensure VaultCoin exists
        let vaultCoin = await VaultCoin.findOne();
        if (!vaultCoin) {
            vaultCoin = await VaultCoin.create({
                price: 10,
                totalSupply: 0,
                stepSize: 0.2,
                dailyMaxChangePercent: 10,
                dailyVolume: 0,
                platformRevenue: 0
            });
        }

        const orders = await CoinOrder.find({})
            .sort({ createdAt: 1 })
            .limit(50)
            .populate('user', 'username');

        res.render('coin', { user, vaultCoin, orders, success: req.flash('success'), error: req.flash('error') });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load coin dashboard');
        res.redirect('/home');
    }
});

// ========================
// POST /coin/buy
// ========================
router.post('/buy', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        if (coinsAmount <= 0) throw new Error("Invalid amount");

        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();
        const buyFeeRate = 0.05;

        let remaining = coinsAmount;

        // Fetch available sell orders (lowest price first)
        const sellOrders = await CoinOrder.find({ type: "sell", status: "pending" }).sort({ price: 1, createdAt: 1 });

        // ===== No sellers? Use liquidity pool =====
        if (sellOrders.length === 0) {
            const liquidityUser = await User.findOne({ isLiquidityProvider: true });
            if (!liquidityUser || liquidityUser.coinsBalance < coinsAmount) throw new Error("No sellers and liquidity pool insufficient");

            const totalPrice = coinsAmount * coin.price;
            const buyFee = totalPrice * buyFeeRate;
            const totalCost = totalPrice + buyFee;

            if (user.walletBalance < totalCost) throw new Error("Insufficient wallet balance");

            // Execute trade
            user.walletBalance -= totalCost;
            user.coinsBalance += coinsAmount;

            liquidityUser.walletBalance += totalPrice;
            liquidityUser.coinsBalance -= coinsAmount;

            await user.save();
            await liquidityUser.save();

            return res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });
        }

        // ===== Match with sellers =====
        for (let order of sellOrders) {
            if (remaining <= 0) break;

            const tradeAmount = Math.min(order.remainingAmount || order.coinsAmount, remaining);
            const tradePrice = order.price;
            const totalPrice = tradeAmount * tradePrice;
            const buyFee = totalPrice * buyFeeRate;
            const totalCost = totalPrice + buyFee;

            if (user.walletBalance < totalCost) break;

            const seller = await User.findById(order.user);

            // Update balances
            user.walletBalance -= totalCost;
            user.coinsBalance += tradeAmount;

            seller.walletBalance += totalPrice * (1 - buyFeeRate);
            seller.coinsBalance -= tradeAmount;

            await user.save();
            await seller.save();

            // Update order
            order.remainingAmount = (order.remainingAmount || order.coinsAmount) - tradeAmount;
            if (order.remainingAmount <= 0) order.status = "completed";
            await order.save();

            // Record trade
            await Trade.create({
                buyer: user._id,
                seller: seller._id,
                coinsAmount: tradeAmount,
                price: tradePrice
            });

            remaining -= tradeAmount;
            coin.price = tradePrice; // update current price
        }

        // ===== Place remaining as pending order =====
        if (remaining > 0) {
            await CoinOrder.create({
                user: user._id,
                type: "buy",
                coinsAmount,
                remainingAmount: remaining,
                price: coin.price,
                status: "pending"
            });
        }

        await coin.save();

        res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ========================
// POST /coin/sell
// ========================
router.post('/sell', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        if (coinsAmount <= 0) throw new Error("Invalid amount");

        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();
        const sellFeeRate = 0.05;

        if (user.coinsBalance < coinsAmount) throw new Error("Insufficient coins");

        let remaining = coinsAmount;

        // Fetch available buy orders (highest price first)
        const buyOrders = await CoinOrder.find({ type: "buy", status: "pending" }).sort({ price: -1, createdAt: 1 });

        // ===== No buyers? Use liquidity pool =====
        if (buyOrders.length === 0) {
            const liquidityUser = await User.findOne({ isLiquidityProvider: true });
            if (!liquidityUser || liquidityUser.walletBalance < coinsAmount * coin.price) throw new Error("No buyers and liquidity pool insufficient");

            const totalPrice = coinsAmount * coin.price;
            const sellFee = totalPrice * sellFeeRate;
            const sellerReceives = totalPrice - sellFee;

            // Execute trade
            user.coinsBalance -= coinsAmount;
            user.walletBalance += sellerReceives;

            liquidityUser.coinsBalance += coinsAmount;
            liquidityUser.walletBalance -= totalPrice;

            await user.save();
            await liquidityUser.save();

            return res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });
        }

        // ===== Match with buyers =====
        for (let order of buyOrders) {
            if (remaining <= 0) break;

            const tradeAmount = Math.min(order.remainingAmount || order.coinsAmount, remaining);
            const tradePrice = order.price;
            const totalPrice = tradeAmount * tradePrice;
            const sellFee = totalPrice * sellFeeRate;
            const sellerReceives = totalPrice - sellFee;

            const buyer = await User.findById(order.user);

            // Update balances
            buyer.coinsBalance += tradeAmount;
            buyer.walletBalance -= totalPrice + (totalPrice * sellFeeRate);

            user.coinsBalance -= tradeAmount;
            user.walletBalance += sellerReceives;

            await buyer.save();
            await user.save();

            // Update order
            order.remainingAmount = (order.remainingAmount || order.coinsAmount) - tradeAmount;
            if (order.remainingAmount <= 0) order.status = "completed";
            await order.save();

            // Record trade
            await Trade.create({
                buyer: buyer._id,
                seller: user._id,
                coinsAmount: tradeAmount,
                price: tradePrice
            });

            remaining -= tradeAmount;
            coin.price = tradePrice;
        }

        // ===== Place remaining as pending sell order =====
        if (remaining > 0) {
            await CoinOrder.create({
                user: user._id,
                type: "sell",
                coinsAmount,
                remainingAmount: remaining,
                price: coin.price,
                status: "pending"
            });
        }

        await coin.save();

        res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

module.exports = router;