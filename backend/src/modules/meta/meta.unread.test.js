const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadService(db) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("./meta.service"), "utf8"), {
    module,
    exports: module.exports,
    Buffer,
    Date,
    console,
    process: { env: {} },
    setTimeout,
    require: (name) => {
      if (name === "../../config/db") return db;
      if (name === "./meta.crypto") {
        return { decryptSecret: () => "", encryptSecret: () => ({}) };
      }
      return require(name);
    },
  });
  return module.exports;
}

test("unread summary is numeric and split by Meta channel", async () => {
  const service = loadService({
    query: async () => [[{
      total: "7",
      conversations: "3",
      whatsapp: "4",
      messenger: "2",
      instagram: "1",
    }]],
  });
  const summary = await service.getUnreadSummary();
  assert.equal(summary.total, 7);
  assert.equal(summary.conversations, 3);
  assert.equal(summary.byChannel.whatsapp, 4);
  assert.equal(summary.byChannel.messenger, 2);
  assert.equal(summary.byChannel.instagram, 1);
});

test("message history loads the latest page and restores chronological order", async () => {
  const calls = [];
  const service = loadService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[{ id: "newest" }, { id: "older" }]];
    },
  });
  const result = await service.listMessages("conversation-1", { limit: 25 });
  assert.equal(result.messages.length, 2);
  assert.match(calls[0].sql, /ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT \?/);
  assert.match(calls[0].sql, /ORDER BY recent\.occurred_at ASC/);
  assert.equal(calls[0].params[0], "conversation-1");
  assert.equal(calls[0].params[1], 26);
});

test("opening a conversation marks it read in the same locked transaction", async () => {
  const calls = [];
  const state = { began: false, committed: false, rolledBack: false, released: false };
  const connection = {
    beginTransaction: async () => { state.began = true; },
    commit: async () => { state.committed = true; },
    rollback: async () => { state.rolledBack = true; },
    release: () => { state.released = true; },
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM meta_conversations/.test(sql)) return [[{ id: "conversation-1" }]];
      if (/SELECT recent\.\*/.test(sql)) return [[{ id: "message-1" }]];
      return [{ affectedRows: 1 }];
    },
  };
  const service = loadService({ getConnection: async () => connection });
  const result = await service.readConversation("conversation-1", { limit: 50 });
  assert.equal(result.messages[0].id, "message-1");
  assert.equal(state.began, true);
  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
  assert.equal(state.released, true);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[2].sql, /SET unread_count = 0/);
});
