const express = require("express");
const router = express.Router();
const controller = require("../dashboard/dashboard.controller");

router.get("/stats", controller.getStats);
router.get("/map", controller.getMapData);

module.exports = router;
