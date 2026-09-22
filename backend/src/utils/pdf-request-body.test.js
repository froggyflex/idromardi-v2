const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { PDF_EXPORT_PATHS, parsePdfExportJson } = require("./pdf-request-body");

test("only authenticated PDF exports accept more than the default JSON limit", async (t) => {
  const app = express();
  let exportsReached = 0;
  app.post(PDF_EXPORT_PATHS, (req,res,next) => {
    if (req.headers.authorization !== "Bearer test") return res.sendStatus(401);
    next();
  }, parsePdfExportJson);
  app.use(express.json());
  app.post(PDF_EXPORT_PATHS, (req,res) => { exportsReached++; res.json({size:req.body.data.length}); });
  app.post("/ordinary", (req,res) => res.sendStatus(200));
  app.use((err,req,res,next) => res.status(err.status || 500).json({type:err.type}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = (path, size, authorized = true) => fetch(url + path, {
    method:"POST", headers:{"content-type":"application/json", ...(authorized ? {authorization:"Bearer test"} : {})},
    body:JSON.stringify({data:"x".repeat(size)}),
  });
  for (const path of PDF_EXPORT_PATHS) {
    const response = await send(path, 250000);
    assert.equal(response.status,200);
    assert.equal((await response.json()).size,250000);
  }
  assert.equal((await send(PDF_EXPORT_PATHS[0], 250000, false)).status,401);
  assert.equal((await send("/ordinary", 250000)).status,413);
  assert.equal((await send(PDF_EXPORT_PATHS[1], 6 * 1024 * 1024)).status,413);
  assert.equal(exportsReached,2);
});
