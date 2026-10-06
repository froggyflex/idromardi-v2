const router = require("express").Router();
const service = require("./template.service");
const { validateOverrides, resolveTemplate } = require("./template-model");
const { previewHtml } = require("./template-preview");
const route = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
router.get("/condomini", route(async (req, res) => res.json({ items: await service.listCondomini(req.query.search) })));
router.get("/:scope", route(async (req, res) => res.json(await service.getTemplate(req.params.scope))));
router.put("/:scope", route(async (req, res) => res.json(await service.saveTemplate(req.params.scope, req.body, req.user?.username))));
router.post("/:scope/preview", route(async (req, res) => {
  const current = await service.getTemplate(req.params.scope);
  const template = resolveTemplate(current.base, validateOverrides(req.body.template));
  res.json({ html: previewHtml(template, current.condominio) });
}));
module.exports = router;
