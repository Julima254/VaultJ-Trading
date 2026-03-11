const mongoose = require("mongoose");

const vaultCoinSchema = new mongoose.Schema({
    totalSupply: { type: Number, default: 0 },        // total coins ever created
    price: { type: Number, default: 10 },            // current price per coin
    dailyVolume: { type: Number, default: 0 },       // coins traded today
    lastPriceUpdate: { type: Date, default: Date.now },
    stepSize: { type: Number, default: 0.2 },
    dailyMaxChangePercent: { type: Number, default: 10 } // % max price move per day
});

module.exports = mongoose.model("VaultCoin", vaultCoinSchema);