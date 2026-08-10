const express = require("express");
const router = express.Router();
const packagesController = require("../controllers/packagesController");

router.get("/packages", packagesController.getPackages);
router.post("/packages/buy", packagesController.buyPackage);

module.exports = router;