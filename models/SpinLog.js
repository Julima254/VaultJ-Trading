const mongoose = require("mongoose");

const spinLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    stake: { type: Number, required: true },
    multiplier: { type: Number, required: true },
    payout: { type: Number, required: true },
    poolBefore: { type: Number, required: true },
    poolAfter: { type: Number, required: true },
    walletBefore: { type: Number, required: true },
    walletAfter: { type: Number, required: true },
    eligibleMultipliers: { type: [Number], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SpinLog", spinLogSchema);