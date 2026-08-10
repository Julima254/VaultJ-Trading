const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    country: { type: String, required: true },
    invitationCode: { type: String, default: null },
    password: { type: String, required: true },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },

    // ---- New fields for home dashboard ----
    package: { type: String, default: "No Active Package" },
    walletBalance: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    totalReferrals: { type: Number, default: 0 },
    depositBalance: { type: Number, default: 0 },
    spinningBalance: { type: Number, default: 0 },
    coinBalance: { type: Number, default: 0 },

    // ---- New fields for home dashboard ----
    package: { type: String, default: "No Active Package" },
    packagePrice: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false }, // becomes true after first package purchase
    walletBalance: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    totalReferrals: { type: Number, default: 0 },
    depositBalance: { type: Number, default: 0 },
    spinningBalance: { type: Number, default: 0 },
    coinBalance: { type: Number, default: 0 },

    // ---- Referral linkage ----
    referralCode: { type: String, unique: true, sparse: true }, // this user's own shareable code
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ---- Admin ----
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with hashed password
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);