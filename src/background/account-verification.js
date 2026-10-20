(function initAccountVerificationModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText } = shared;

  class AccountVerificationError extends Error {
    constructor(reason) {
      super(`Collected data was not saved: ${reason}.`);
      this.name = "AccountVerificationError";
      this.code = "ACCOUNT_VERIFICATION_FAILED";
      this.reason = reason;
    }
  }

  // Data may only be written when the account the collecting tab reported (before
  // and after the pass), the expected account, and the repository's own binding
  // stamp all agree. The stored dashboard profile is never consulted here.
  async function verifyPayloadAccount(expectedAccountId, payload, repository) {
    const expected = normalizeText(expectedAccountId);
    const startId = normalizeText(payload?.account?.startId);
    const endId = normalizeText(payload?.account?.endId);
    const boundId = normalizeText((await repository.getMeta("accountBinding"))?.accountId);
    if (!expected || !startId || !endId) return { ok: false, reason: "account-unverified", expected, startId, endId };
    if (startId !== endId) return { ok: false, reason: "account-changed-during-collection", expected, startId, endId };
    if (startId !== expected) return { ok: false, reason: "account-mismatch", expected, startId, endId };
    if (boundId !== expected) return { ok: false, reason: "repository-mismatch", expected, startId, endId };
    return { ok: true };
  }

  // What D2L says the signed-in session is right now, asked of one tab.
  async function verifyTabAccount(tabId) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: "D2L_WHOAMI" }, { frameId: 0 });
      return reply?.ok ? normalizeText(reply.accountId) : "";
    } catch {
      return "";
    }
  }

  // Picks the destination archive for an export/crawl from the account D2L
  // verified (in the payloads, or live from one tab), never from the stored
  // profile. An expected account, when known, must match. Throws before any write.
  async function resolveExportRepository({ payloads = [], tabId = null, expectedAccountId = "" } = {}) {
    const withData = (payloads || []).filter(Boolean);
    const accountId = withData.length ? normalizeText(withData[0]?.account?.startId) : (tabId == null ? "" : await verifyTabAccount(tabId));
    const expected = normalizeText(expectedAccountId);
    if (!accountId) throw new AccountVerificationError("account-unverified");
    if (expected && expected !== accountId) throw new AccountVerificationError("account-mismatch");
    const repository = await background.repositoryForAccount(accountId);
    const checks = withData.length ? withData : [{ account: { startId: accountId, endId: accountId } }];
    for (const payload of checks) {
      const verdict = await verifyPayloadAccount(accountId, payload, repository);
      if (!verdict.ok) throw new AccountVerificationError(verdict.reason);
    }
    return { repository, accountId };
  }

  Object.assign(background, { AccountVerificationError, verifyPayloadAccount, verifyTabAccount, resolveExportRepository });
})(globalThis);
