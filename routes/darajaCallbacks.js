const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const User = require("../models/User");

router.post("/api/daraja/b2c/result", async (req, res) => {
  try {
    const result = req.body.Result;
    console.log("B2C Result:", JSON.stringify(result));

    const tx = await Transaction.findOne({
      merchantRequestId: result.ConversationID,
      checkoutRequestId: result.OriginatorConversationID,
    });

    if (!tx) {
      console.error("B2C result: no matching transaction", result.ConversationID);
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    if (result.ResultCode === 0) {
      const params = result.ResultParameters?.ResultParameter || [];
      const getParam = (key) => params.find((p) => p.Key === key)?.Value;

      tx.status = "completed";
      tx.code = getParam("TransactionReceipt") || "";
      tx.note = "B2C payment completed";
      await tx.save();
    } else {
      tx.status = "failed";
      tx.note = result.ResultDesc || "B2C payment failed";
      await tx.save();
      await User.findByIdAndUpdate(tx.userId, { $inc: { walletBalance: tx.amount } });
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("B2C result callback error:", err);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

router.post("/api/daraja/b2c/timeout", async (req, res) => {
  try {
    console.log("B2C Timeout:", JSON.stringify(req.body));
    const result = req.body.Result;
    const tx = await Transaction.findOne({
      merchantRequestId: result?.ConversationID,
      checkoutRequestId: result?.OriginatorConversationID,
    });
    if (tx && tx.status === "pending") {
      tx.status = "failed";
      tx.note = "B2C request timed out";
      await tx.save();
      await User.findByIdAndUpdate(tx.userId, { $inc: { walletBalance: tx.amount } });
    }
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("B2C timeout callback error:", err);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

module.exports = router;