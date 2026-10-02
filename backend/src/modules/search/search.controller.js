const service = require("./search.service");

exports.search = async (req, res, next) => {
  try {
    const result = await service.search({
      query: req.query.q,
      scope: req.query.scope,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};
