const express = require('express');
const router = express.Router();
const User = require('../models/user');
const VaultCoin = require('../models/vaultCoin');
const CoinOrder = require('../models/coinOrder');
const Trade = require('../models/trade');

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
    .sort({ createdAt: -1 }) // Show newest first
    .limit(20)
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
// ========================
// POST /coin/buy (Fixed for Liquidity Pool)
// ========================
router.post('/buy', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();
        const sellOrders = await CoinOrder.find({ type: "sell", status: "pending" }).sort({ price: 1 });

        if (sellOrders.length === 0) {
            const liquidityUser = await User.findOne({ isLiquidityProvider: true });
            const totalPrice = coinsAmount * coin.price;
            const totalCost = totalPrice + (totalPrice * 0.05);

            if (user.walletBalance < totalCost) throw new Error("Insufficient balance");

            // Execute Balances
            await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: -totalCost, coinsBalance: coinsAmount } });
            await User.findByIdAndUpdate(liquidityUser._id, { $inc: { walletBalance: totalPrice, coinsBalance: -coinsAmount } });

            // CRITICAL FIX: Create the order record so it shows in the table
            await CoinOrder.create({
                user: user._id,
                type: "buy",
                coinsAmount: coinsAmount,
                price: coin.price,
                status: "completed" // Mark as completed so it's a "History" item
            });

            return res.json({ success: true });
        }
        // ... rest of matching logic
    } catch (err) { res.json({ success: false, message: err.message }); }
});

// ========================
// POST /coin/sell (Fixed for Liquidity Pool)
// ========================
router.post('/sell', isLoggedIn, async (req, res) => {
    try {
        const coinsAmount = parseFloat(req.body.coinsAmount);
        const user = await User.findById(req.user._id);
        let coin = await VaultCoin.findOne();
        const buyOrders = await CoinOrder.find({ type: "buy", status: "pending" }).sort({ price: -1 });

        if (buyOrders.length === 0) {
            const liquidityUser = await User.findOne({ isLiquidityProvider: true });
            const totalPrice = coinsAmount * coin.price;
            const sellerReceives = totalPrice - (totalPrice * 0.05);

            // Execute Balances
            await User.findByIdAndUpdate(user._id, { $inc: { coinsBalance: -coinsAmount, walletBalance: sellerReceives } });
            await User.findByIdAndUpdate(liquidityUser._id, { $inc: { coinsBalance: coinsAmount, walletBalance: -totalPrice } });

            
            await CoinOrder.create({
                user: user._id,
                type: "sell",
                coinsAmount: coinsAmount,
                price: coin.price,
                status: "completed"
            });

            return res.json({ success: true });
        }
        // ... rest of matching logic
    } catch (err) { res.json({ success: false, message: err.message }); }
});

module.exports = router;