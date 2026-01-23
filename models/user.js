const mongoose = require("mongoose");
const passportLocalMongoose = require("passport-local-mongoose");

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    invitationCode: { type: String },
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isAdmin: { type: Boolean, default: false }
});

userSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model("User", userSchema);
