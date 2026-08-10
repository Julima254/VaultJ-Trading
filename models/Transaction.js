const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["deposit", "withdraw", "upgrade", "referral", "spin"],
      required: true,
    },
    method: {
      type: String,
      enum: ["stk", "manual"],
      default: "stk",
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    note: { type: String, default: "" },
    code: { type: String }, // M-Pesa receipt number (auto for STK, user-submitted for manual)
    phone: { type: String },
    checkoutRequestId: { type: String, index: true },
    merchantRequestId: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // admin who approved/rejected a manual deposit
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);