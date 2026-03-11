const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema({
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    coinsAmount: Number,
    price: Number,

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Trade", tradeSchema);