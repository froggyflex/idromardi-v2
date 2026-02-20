const express = require("express");
const router = express.Router();
const controller = require("./admin.controller");

router.post("/geocode-condomini", controller.batchGeocodeCondomini);


module.exports = router;
