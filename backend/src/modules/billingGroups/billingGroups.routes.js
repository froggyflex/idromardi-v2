const express = require("express");
const router = express.Router();
const controller = require("./billingGroups.controller");

// GET all billing groups for a condominio
router.get(
  "/condomini/:condominioId/billing-groups",
  controller.getByCondominio
);

// CREATE billing group
router.post(
  "/condomini/:condominioId/billing-groups",
  controller.create
);

// DELETE billing group
router.delete(
  "/billing-groups/:id",
  controller.remove
);

module.exports = router;