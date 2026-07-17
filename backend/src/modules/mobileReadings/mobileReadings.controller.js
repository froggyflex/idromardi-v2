const service = require("./mobileReadings.service");

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || "Errore mobile readings",
    code: error.code || "MOBILE_READINGS_ERROR",
  });
}

exports.createAssignment = async (req, res) => {
  try {
    res.status(201).json(await service.createAssignment(req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.listAssignments = async (req, res) => {
  try {
    res.json(await service.listAssignments(req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.getAssignment = async (req, res) => {
  try {
    res.json(
      await service.getAssignmentPackage(req.params.id, req.user, { markDownloaded: true })
    );
  } catch (error) {
    sendError(res, error);
  }
};

exports.createSubmission = async (req, res) => {
  try {
    const result = await service.createSubmission(req.body || {}, req.user);
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (error) {
    sendError(res, error);
  }
};

exports.uploadPhoto = async (req, res) => {
  try {
    const result = await service.attachPhoto(
      {
        submissionId: req.params.id,
        buffer: req.file?.buffer,
        mimeType: req.file?.mimetype,
        expectedSha256: req.headers["x-photo-sha256"],
      },
      req.user
    );
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
};

exports.syncStatus = async (req, res) => {
  try {
    res.json(await service.reconcileSubmissionStatuses(req.body?.ids, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.listReviewQueue = async (req, res) => {
  try {
    res.json(await service.listReviewQueue(req.query));
  } catch (error) {
    sendError(res, error);
  }
};

exports.acceptSubmission = async (req, res) => {
  try {
    res.json(
      await service.acceptSubmission(
        {
          submissionId: req.params.id,
          replaceExisting: req.body?.replaceExisting === true,
          reviewNote: req.body?.reviewNote,
        },
        req.user
      )
    );
  } catch (error) {
    sendError(res, error);
  }
};

exports.rejectSubmission = async (req, res) => {
  try {
    res.json(
      await service.rejectSubmission(
        { submissionId: req.params.id, reviewNote: req.body?.reviewNote },
        req.user
      )
    );
  } catch (error) {
    sendError(res, error);
  }
};

exports.viewPhoto = async (req, res) => {
  try {
    const photo = await service.readSubmissionPhoto(req.params.id);
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(photo.buffer);
  } catch (error) {
    sendError(res, error);
  }
};
