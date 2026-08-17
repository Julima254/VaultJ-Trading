const express = require("express");
const router = express.Router();
const vaultCoinController = require("../controllers/vaultCoinController");

router.get("/vault-coin", vaultCoinController.getVaultCoin);
router.post("/vault-coin/sell", vaultCoinController.createSellOrder);
router.post("/vault-coin/cancel/:orderId", vaultCoinController.cancelSellOrder);
router.post("/vault-coin/buy", vaultCoinController.createBuyOrder);
router.post("/vault-coin/buy-order/cancel/:orderId", vaultCoinController.cancelBuyOrder);

module.exports = router;