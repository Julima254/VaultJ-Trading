const mongoose = require("mongoose");

const vaultTransactionSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "VaultOrder", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    coinsTraded: { type: Number, required: true },
    executionPrice: { type: Number, required: true }, // live price at execution
    baselinePrice: { type: Number, required: true },
    buyerPaidCash: { type: Number, required: true },
    buyerReceivedCoins: { type: Number, required: true },
    sellerReceivedCash: { type: Number, required: true },
    feeCoins: { type: Number, required: true },
    spreadCash: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VaultTransaction", vaultTransactionSchema);