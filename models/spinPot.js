const mongoose = require("mongoose");

const spinPotSchema = new mongoose.Schema({
    totalAmount: { type: Number, default: 0 } // funds available for payouts
}, { timestamps: true });

module.exports = mongoose.model("SpinPot", spinPotSchema);