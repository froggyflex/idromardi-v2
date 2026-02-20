const service = require("./tariffe.service");

exports.listProviders = async(req, res, next) => {
  try {
    res.json(await service.listProviders());
  } catch (e) {
    next(e);
  }
}

exports.createProvider = async (req, res, next) => {
  try {
    res.json(await service.createProvider(req.body));
  } catch (e) {
    next(e);
  }
}

exports.getProvider = async (req, res, next) => {
  try {
    res.json(await service.getProvider({ providerId: req.params.providerId }));
  } catch (e) {
    next(e);
  }
}

exports.listVersionsByProvider = async(req, res, next) => {
  try {
    res.json(await service.listVersionsByProvider({ providerId: req.params.providerId }));
  } catch (e) {
    next(e);
  }
}

exports.createVersion = async (req, res, next) => {
  try {
    res.json(await service.createVersion({
      providerId: req.params.providerId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.updateVersion = async (req, res, next) => {
  try {
    res.json(await service.updateVersion({
      versionId: req.params.versionId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.getVersionFull = async (req, res, next) => {
  try {
    res.json(await service.getVersionFull({ versionId: req.params.versionId }));
  } catch (e) {
    next(e);
  }
}

exports.upsertCategory = async (req, res, next) => {
  try {
    res.json(await service.upsertCategory({
      versionId: req.params.versionId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.createScaglione = async (req, res, next) => {
  try {
    res.json(await service.createScaglione({
      categoryId: req.params.categoryId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.updateScaglione = async (req, res, next) => {
  try {
    res.json(await service.updateScaglione({
      scaglioneId: req.params.scaglioneId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.deleteScaglione = async (req, res, next) => {
  try {
    res.json(await service.deleteScaglione({ scaglioneId: req.params.scaglioneId }));
  } catch (e) {
    next(e);
  }
}

exports.createQuotaFissa = async (req, res, next) => {
  try {
    res.json(await service.createQuotaFissa({
      categoryId: req.params.categoryId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.updateQuotaFissa = async (req, res, next) => {
  try {
    res.json(await service.updateQuotaFissa({
      quotaId: req.params.quotaId,
      ...req.body,
    }));
  } catch (e) {
    next(e);
  }
}

exports.deleteQuotaFissa = async (req, res, next) => {
  try {
    res.json(await service.deleteQuotaFissa({ quotaId: req.params.quotaId }));
  } catch (e) {
    next(e);
  }
}
exports.createComponenteMC = async (req, res, next) => {
  try {
    res.json(await service.createComponenteMC({
      categoryId: req.params.categoryId,
      ...req.body,
    }));
  } catch (e) { next(e); }
}

exports.updateComponenteMC = async (req, res, next) => {
  try {
    res.json(await service.updateComponenteMC({
      componenteId: req.params.componenteId,
      ...req.body,
    }));
  } catch (e) { next(e); }
}

exports.deleteComponenteMC = async (req, res, next) => {
  try {
    res.json(await service.deleteComponenteMC({
      componenteId: req.params.componenteId,
    }));
  } catch (e) { next(e); }
}
