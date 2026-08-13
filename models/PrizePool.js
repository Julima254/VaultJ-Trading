const mongoose = require("mongoose");

const prizePoolSchema = new mongoose.Schema(
  {
    balance: { type: Number, required: true, default: 0, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Enforce a single prize pool document
prizePoolSchema.statics.getPool = async function () {
  let pool = await this.findOne();
  if (!pool) {
    pool = await this.create({ balance: 0 });
  }
  return pool;
};

module.exports = mongoose.model("PrizePool", prizePoolSchema);