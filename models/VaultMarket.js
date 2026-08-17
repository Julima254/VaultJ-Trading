const mongoose = require("mongoose");

const vaultMarketSchema = new mongoose.Schema(
  {
    currentPrice: { type: Number, default: 10 }, // KSh per VaultJ Coin
    treasuryCash: { type: Number, default: 0 },   // accumulated spread revenue
    treasuryCoins: { type: Number, default: 0 },  // accumulated 5% fee coins
    priceHistory: [
      {
        price: Number,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
  },
  { timestamps: true }
);

vaultMarketSchema.statics.getSingleton = async function () {
  let market = await this.findOne();
  if (!market) {
    market = await this.create({
      currentPrice: 10,
      priceHistory: [{ price: 10 }],
    });
  }
  return market;
};

module.exports = mongoose.model("VaultMarket", vaultMarketSchema);