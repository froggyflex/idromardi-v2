const express = require("express");
const multer = require("multer");
const controller = require("./mobileReadings.controller");
const { requireRole } = require("../auth/auth.middleware");

const router = express.Router();
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      const error = new Error("Sono ammesse solo immagini JPEG, PNG o WEBP");
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

router.post(
  "/assignments",
  requireRole("ADMIN", "REVIEWER"),
  controller.createAssignment
);
router.get(
  "/assignments",
  requireRole("ADMIN", "METER_READER"),
  controller.listAssignments
);
router.get(
  "/catalog",
  requireRole("ADMIN", "METER_READER"),
  controller.listCondominiumCatalog
);
router.post(
  "/workspace/prepare",
  requireRole("ADMIN", "METER_READER"),
  controller.prepareWorkspace
);
router.get(
  "/assignments/:id",
  requireRole("ADMIN", "METER_READER"),
  controller.getAssignment
);
router.post(
  "/submissions",
  requireRole("ADMIN", "METER_READER"),
  controller.createSubmission
);
router.post(
  "/submissions/:id/photo",
  requireRole("ADMIN", "METER_READER"),
  photoUpload.single("photo"),
  controller.uploadPhoto
);
router.post(
  "/sync/status",
  requireRole("ADMIN", "METER_READER"),
  controller.syncStatus
);
router.get(
  "/review",
  requireRole("ADMIN", "REVIEWER"),
  controller.listReviewQueue
);
router.post(
  "/review/:id/accept",
  requireRole("ADMIN", "REVIEWER"),
  controller.acceptSubmission
);
router.post(
  "/review/:id/reject",
  requireRole("ADMIN", "REVIEWER"),
  controller.rejectSubmission
);
router.get(
  "/review/:id/photo",
  requireRole("ADMIN", "REVIEWER"),
  controller.viewPhoto
);

module.exports = router;
