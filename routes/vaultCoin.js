const express = require("express");
const router = express.Router();
const vaultCoinController = require("../controllers/vaultCoinController");

router.get("/vault-coin", vaultCoinController.getVaultCoin);
router.post("/vault-coin/sell", vaultCoinController.createSellOrder);
router.post("/vault-coin/cancel/:orderId", vaultCoinController.cancelSellOrder);
router.post("/vault-coin/buy/:orderId", vaultCoinController.buyCoins);
router.post("/vault-coin/admin/price", vaultCoinController.setMarketPrice);

module.exports = router;