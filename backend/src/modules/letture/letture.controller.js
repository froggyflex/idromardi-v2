const service = require("./letture.service");

exports.createOrLoadSession = async (req, res, next) => {
  try {
    const result = await service.createOrLoadSession(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

exports.getSessionGrid = async (req, res, next) => {
  try {
    const result = await service.getSessionGrid({
      sessionId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

exports.upsertSessionRowsBulk = async (req, res, next) => {
  try {
    const result = await service.upsertSessionRowsBulk({
      sessionId: req.params.id,
      rows: req.body.rows,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

exports.closeSession = async (req, res, next) => {
  try {
    const result = await service.closeSession({
      sessionId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
