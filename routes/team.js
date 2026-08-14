const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const teamController = require("../controllers/teamController");

router.get("/my-team", requireAuth, teamController.getMyTeam);

module.exports = router;