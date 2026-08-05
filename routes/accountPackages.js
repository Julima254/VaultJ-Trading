const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Transaction = require('../models/transaction');
const VaultCoin = require('../models/vaultCoin'); 

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash('error', 'Please login first');
    res.redirect('/login');
}

const packages = [
    { name: 'Starter', cost: 100 },
    { name: 'Bronze', cost: 200 },
    { name: 'Silver', cost: 500 },
    { name: 'Gold', cost: 1000 },
    { name: 'Platinum', cost: 2000 }
];

const referralRates = {
    Starter: 0.2,
    Bronze: 0.25,
    Silver: 0.3,
    Gold: 0.4,
    Platinum: 0.5
};

const coinsForPackage = {
    Starter: 0.5,
    Bronze: 1,
    Silver: 2.5,
    Gold: 5,
    Platinum: 10
};

router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        res.render('account-packages', { packages, user });
    } catch (err) {
        console.log(err);
        req.flash('error', 'Unable to load packages');
        res.redirect('/home');
    }
});

router.post("/purchase/:packageName", isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const packageCostMap = {
            Starter: 100,
            Bronze: 200,
            Silver: 500,
            Gold: 1000,
            Platinum: 2000
        };

        const packageName = req.params.packageName;
        const cost = packageCostMap[packageName];

        if (!cost) {
            req.flash("error", "Invalid package");
            return res.redirect("/account-packages");
        }

        // First-ever purchase: user is not active yet, so their only money is depositBalance.
        // Any purchase after that (switching/upgrading package): user is already active,
        // so their money has been landing in walletBalance since activation.
        const sourceField = user.isActive ? "walletBalance" : "depositBalance";
        const availableBalance = user[sourceField] || 0;

        if (availableBalance < cost) {
            req.flash("error", `You need at least KES ${cost} in your ${user.isActive ? "wallet" : "deposit"} balance to purchase this package`);
            return res.redirect("/account-packages");
        }

        // Deduct cost from the correct balance and assign package
        user[sourceField] -= cost;
        user.package = packageName;
        user.isActive = true;

        // --- VaultJ Coins Integration ---
        const coinsToAdd = coinsForPackage[packageName] || 0;
        user.coinsBalance = (user.coinsBalance || 0) + coinsToAdd;

        let vaultCoin = await VaultCoin.findOne();
        if (!vaultCoin) {
            vaultCoin = await VaultCoin.create({});
        }
        vaultCoin.totalSupply += coinsToAdd;

        await user.save();
        await vaultCoin.save();

        // --- Referral Commission Logic ---
        if (user.referrer) {
            const referrer = await User.findById(user.referrer);
            if (referrer) {
                const commissionRate = referralRates[packageName];
                const commission = Math.floor(cost * commissionRate);

                referrer.walletBalance += commission;
                referrer.referralEarnings = (referrer.referralEarnings || 0) + commission;
                await referrer.save();

                await Transaction.create({
                    user: referrer._id,
                    type: "bonus",
                    amount: commission,
                    status: "completed",
                    code: `REF-${user.username}-${Date.now()}`
                });
            }
        }

        req.flash("success", `You purchased the ${packageName} package and received ${coinsToAdd} VaultJ Coins!`);
        res.redirect("/account-packages");

    } catch (err) {
        console.error(err);
        req.flash("error", "Something went wrong");
        res.redirect("/account-packages");
    }
});

module.exports = router;