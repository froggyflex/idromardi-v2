const INSTAGRAM_CREDENTIAL_MODES = Object.freeze({
  FACEBOOK_LOGIN: "FACEBOOK_LOGIN",
  INSTAGRAM_LOGIN: "INSTAGRAM_LOGIN",
});

const INSTAGRAM_SCOPE_REQUIREMENTS = Object.freeze({
  [INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN]: Object.freeze([
    "instagram_basic",
    "instagram_manage_messages",
    "pages_manage_metadata",
  ]),
  [INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN]: Object.freeze([
    "instagram_business_basic",
    "instagram_business_manage_messages",
  ]),
});

function missingScopes(scopes, requiredScopes) {
  const available = new Set((scopes || []).map(String));
  return requiredScopes.filter((scope) => !available.has(scope));
}

function detectInstagramCredentialMode(scopes) {
  for (const mode of [
    INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN,
    INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN,
  ]) {
    if (!missingScopes(scopes, INSTAGRAM_SCOPE_REQUIREMENTS[mode]).length) return mode;
  }
  return null;
}

function instagramApiTarget(channel) {
  const mode = String(channel?.credential_mode || "").toUpperCase();
  if (mode === INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN) {
    const senderId = String(channel?.api_sender_id || "").trim();
    if (!senderId) return null;
    return { host: "https://graph.facebook.com", senderId };
  }
  if (mode === INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN) {
    const senderId = String(channel?.api_sender_id || channel?.external_account_id || "").trim();
    if (!senderId) return null;
    return { host: "https://graph.instagram.com", senderId };
  }
  return null;
}

module.exports = {
  INSTAGRAM_CREDENTIAL_MODES,
  INSTAGRAM_SCOPE_REQUIREMENTS,
  detectInstagramCredentialMode,
  instagramApiTarget,
  missingScopes,
};
