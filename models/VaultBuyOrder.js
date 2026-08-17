const mongoose = require("mongoose");

const vaultBuyOrderSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    coinsWanted: { type: Number, required: true },
    coinsFilled: { type: Number, default: 0 },
    baselinePrice: { type: Number, required: true }, // KSh/coin locked at order placement
    cashEscrowed: { type: Number, required: true },  // original amount reserved
    cashRemaining: { type: Number, required: true }, // still held in escrow, unspent
    status: {
      type: String,
      enum: ["active", "partial", "completed", "cancelled"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VaultBuyOrder", vaultBuyOrderSchema);