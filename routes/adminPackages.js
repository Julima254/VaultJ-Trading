const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { isAdmin } = require('../middleware/auth');

// static packages
const packages = [
    { name: 'Starter', cost: 100 },
    { name: 'Bronze', cost: 200 },
    { name: 'Silver', cost: 500 },
    { name: 'Gold', cost: 1000 },
    { name: 'Platinum', cost: 2000 }
];

// GET /admin/packages
router.get('/packages', isAdmin, async (req, res) => {

    try {

        const packageStats = [];

        for (let pkg of packages) {

            const users = await User.find({ package: pkg.name });

            const totalUsers = users.length;

            const totalInvested = totalUsers * pkg.cost;

            packageStats.push({
                name: pkg.name,
                price: pkg.cost,
                totalUsers,
                totalInvested
            });

        }

        res.render('admin/packages', { packages: packageStats });

    } catch (err) {

        console.log(err);
        res.redirect('/admin');

    }

});

module.exports = router;