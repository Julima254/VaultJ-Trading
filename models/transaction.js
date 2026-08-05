const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    type: {
        type: String,
        enum: ["deposit", "withdrawal", "bonus"],
        required: true
    },

    amount: {
        type: Number,
        required: true
    },

    phone: {
        type: String
    },

    code: {
        type: String // MPESA receipt number (filled on callback, or pasted in manually for paybill deposits)
    },

    method: {
        type: String,
        enum: ["stk", "paybill"],
        default: "stk"
    },

    checkoutRequestID: {
        type: String // Daraja STK push tracking ID
    },

    status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "pending"
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Transaction", transactionSchema);