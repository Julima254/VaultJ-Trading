const mongoose = require("mongoose");

const vaultOrderSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    coinsAmount: { type: Number, required: true },     // original listed amount
    coinsRemaining: { type: Number, required: true },  // still escrowed/unsold
    baselinePrice: { type: Number, required: true },   // KSh/coin locked at listing time
    status: {
      type: String,
      enum: ["active", "partial", "completed", "cancelled"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VaultOrder", vaultOrderSchema);