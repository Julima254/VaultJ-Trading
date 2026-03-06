// models/spin.js
const mongoose = require("mongoose");

const spinSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    betAmount: { type: Number, required: true },
    multiplier: { type: Number, required: true },
    reward: { type: Number, required: true },
    status: { type: String, enum: ["pending", "claimed"], default: "pending" }
}, { timestamps: true });

module.exports = mongoose.model("Spin", spinSchema);