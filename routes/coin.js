const express = require('express');
const router = express.Router();
const User = require('../models/user');
const VaultCoin = require('../models/vaultCoin');
const CoinOrder = require('../models/coinOrder');

// Middleware
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

// GET /coin - Dashboard
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

        // Last 50 orders for charts
        const orders = await CoinOrder.find({})
            .sort({ createdAt: 1 }) // oldest to newest
            .limit(50)
            .populate('user', 'username');

        res.render('coin', { user, vaultCoin, orders, success: req.flash('success'), error: req.flash('error') });

    } catch (err) {
        console.error(err);
        req.flash('error', 'Unable to load coin dashboard');
        res.redirect('/home');
    }
});

// POST /coin/buy
router.post('/buy', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        if (coinsAmount > 50) throw new Error("Max 50 coins per transaction");

        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();

        // Daily limit
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
        const userDailyBuys = await CoinOrder.aggregate([
            { $match: { user: user._id, type: "buy", createdAt: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, total: { $sum: "$coinsAmount" } } }
        ]);
        if ((userDailyBuys[0]?.total || 0) + coinsAmount > 200)
            throw new Error("Daily coin buy limit exceeded");

        // Fee & price
        const buyFeeRate = 0.05;
        const totalPrice = coinsAmount * coin.price;
        const buyFee = totalPrice * buyFeeRate;
        const totalCost = totalPrice + buyFee;

        if (user.walletBalance < totalCost) throw new Error("Insufficient wallet balance");

        user.walletBalance -= totalCost;
        user.coinsBalance += coinsAmount;
        await user.save();

        await CoinOrder.create({
            user: user._id,
            type: "buy",
            coinsAmount,
            price: coin.price,
            status: "completed"
        });

        // Update coin price
        const steps = Math.floor(coinsAmount / 20);
        const maxPrice = coin.price * (1 + coin.dailyMaxChangePercent/100);
        coin.price = Math.min(coin.price + steps * coin.stepSize, maxPrice);

        coin.dailyVolume += coinsAmount;
        coin.platformRevenue = (coin.platformRevenue || 0) + buyFee;
        await coin.save();

        res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /coin/sell
router.post('/sell', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        if (coinsAmount > 50) throw new Error("Max 50 coins per transaction");

        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();
        if (!coin) throw new Error("VaultCoin not initialized");
        if (user.coinsBalance < coinsAmount) throw new Error("Insufficient coins");

        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
        const userDailySells = await CoinOrder.aggregate([
            { $match: { user: user._id, type: "sell", createdAt: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, total: { $sum: "$coinsAmount" } } }
        ]);
        if ((userDailySells[0]?.total || 0) + coinsAmount > 200)
            throw new Error("Daily coin sell limit exceeded");

        // Fee & payout
        const sellFeeRate = 0.05;
        const totalPrice = coinsAmount * coin.price;
        const sellFee = totalPrice * sellFeeRate;
        const sellerReceives = totalPrice - sellFee;

        user.coinsBalance -= coinsAmount;
        user.walletBalance += sellerReceives;
        await user.save();

        await CoinOrder.create({
            user: user._id,
            type: "sell",
            coinsAmount,
            price: coin.price,
            status: "completed"
        });

        const steps = Math.floor(coinsAmount / 20);
        const minPrice = coin.price * (1 - coin.dailyMaxChangePercent/100);
        coin.price = Math.max(coin.price - steps * coin.stepSize, minPrice);

        coin.dailyVolume += coinsAmount;
        coin.platformRevenue = (coin.platformRevenue || 0) + sellFee;
        await coin.save();

        res.json({ success: true, coinsBalance: user.coinsBalance, walletBalance: user.walletBalance });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

module.exports = router;