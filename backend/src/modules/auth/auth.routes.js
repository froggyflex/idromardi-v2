const express = require("express");
const controller = require("./auth.controller");
const { requireAuth, requireRole } = require("./auth.middleware");

const router = express.Router();

router.post("/login", controller.login);
router.get("/me", requireAuth, controller.me);
router.post("/change-password", requireAuth, controller.changePassword);
router.get("/users", requireAuth, requireRole("ADMIN"), controller.listUsers);
router.post("/users", requireAuth, requireRole("ADMIN"), controller.createUser);
router.get("/condomini", requireAuth, requireRole("ADMIN"), controller.listAssignableCondomini);
router.put("/users/:id/condomini", requireAuth, requireRole("ADMIN"), controller.updateAssignments);
router.post("/users/:id/impersonate", requireAuth, requireRole("ADMIN"), controller.startImpersonation);
router.post("/impersonation/end", requireAuth, controller.endImpersonation);

module.exports = router;
