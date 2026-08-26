const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INSTAGRAM_CREDENTIAL_MODES,
  detectInstagramCredentialMode,
  instagramApiTarget,
  missingScopes,
} = require("./meta.instagram");

test("detects the Page-linked Instagram credential model", () => {
  const scopes = ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"];
  assert.equal(
    detectInstagramCredentialMode(scopes),
    INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN
  );
  assert.deepEqual(missingScopes(scopes, scopes), []);
});

test("detects the Instagram Login credential model", () => {
  assert.equal(
    detectInstagramCredentialMode([
      "instagram_business_basic",
      "instagram_business_manage_messages",
    ]),
    INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN
  );
  assert.equal(detectInstagramCredentialMode(["instagram_basic"]), null);
});

test("uses the verified sender and host for Instagram replies", () => {
  assert.deepEqual(
    instagramApiTarget({
      credential_mode: "FACEBOOK_LOGIN",
      api_sender_id: "page-1",
      external_account_id: "ig-1",
    }),
    { host: "https://graph.facebook.com", senderId: "page-1" }
  );
  assert.deepEqual(
    instagramApiTarget({
      credential_mode: "INSTAGRAM_LOGIN",
      api_sender_id: "ig-1",
      external_account_id: "ig-1",
    }),
    { host: "https://graph.instagram.com", senderId: "ig-1" }
  );
  assert.equal(instagramApiTarget({ external_account_id: "ig-1" }), null);
});
