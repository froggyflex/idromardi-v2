const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { module: { exports: {} }, process, __dirname, require(name) {
  if (name === "../../config/db" || name === "../../utils/puppeteer") return {};
  return require(name);
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"prospetti.service.js"),"utf8"), sandbox);

test("prospetto and replacement list show surname first without changing ID order", () => {
  const html = sandbox.module.exports.buildHtml({session:{}, rows:[
    {id_user:2, Cognome:"De Luca", Nome:"Anna", stato_attuale:"Y"},
    {id_user:1, Cognome:"Rossi", Nome:"Mario", stato_attuale:"K"},
    {id_user:3, Cognome:"D'Amato & Figli", Nome:"", stato_attuale:"K"},
  ]});
  assert(html.includes("Cognome e nome"));
  assert(html.includes("Rossi Mario"));
  assert.equal((html.match(/De Luca Anna/g)||[]).length,2);
  assert(html.indexOf("Rossi Mario") < html.indexOf("De Luca Anna"));
  assert(html.includes("D'Amato &amp; Figli"));
  assert(!html.includes("Mario Rossi"));
});
