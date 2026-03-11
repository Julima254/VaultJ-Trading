const mongoose = require("mongoose");

const coinOrderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["buy", "sell"] },
    coinsAmount: Number,
    price: Number,        // price per coin for this order
    status: { type: String, enum: ["pending", "completed", "cancelled"], default: "pending" },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CoinOrder", coinOrderSchema);