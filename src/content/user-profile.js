// Saves the signed-in student's Brightspace display name and profile image so
// the local dashboard can show the same identity affordance while offline.
(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const STORAGE_KEY = "dashboardProfile";
  const LP_VERSION = "1.49";
  const MAX_BYTES = 400 * 1024;
  const IMAGE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function displayName(user) {
    return String(user?.DisplayName || `${user?.FirstName || ""} ${user?.LastName || ""}` || "").trim();
  }

  function accountIdFromUser(user) {
    return String(user?.ProfileIdentifier || user?.Identifier || user?.UserId || user?.Id || "");
  }

  // The account D2L says this session belongs to right now (read-only whoami).
  async function fetchVerifiedAccountId({ fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") return "";
    const response = await fetchImpl(`/d2l/api/lp/${LP_VERSION}/users/whoami`, { credentials: "include" });
    return response.ok ? accountIdFromUser(await response.json()) : "";
  }

  async function inspectVerifiedAccount({ fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") return { ok: false, reason: "fetch-unavailable" };
    try {
      const response = await fetchImpl(`/d2l/api/lp/${LP_VERSION}/users/whoami`, { credentials: "include" });
      if (!response.ok) return { ok: false, reason: "http-error", status: response.status, accountId: "" };
      const user = await response.json();
      const fields = ["ProfileIdentifier", "Identifier", "UserId", "Id"].filter((field) => Boolean(user?.[field]));
      const accountId = accountIdFromUser(user);
      return { ok: Boolean(accountId), reason: accountId ? "verified" : "identity-field-missing", status: response.status, fields, accountId };
    } catch (error) {
      return { ok: false, reason: "request-error", errorName: String(error?.name || "Error").slice(0, 50), accountId: "" };
    }
  }

  async function captureUserProfile({ fetchImpl = globalThis.fetch, storage, toDataUrl = blobToDataUrl, now = () => new Date() } = {}) {
    if (!storage || typeof fetchImpl !== "function") return null;
    const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    const identityResponse = await fetchImpl(`/d2l/api/lp/${LP_VERSION}/users/whoami`, { credentials: "include" });
    if (!identityResponse.ok) return saved || null;
    const user = await identityResponse.json();
    const name = displayName(user);
    let dataUrl = saved?.dataUrl || "";
    let imageCapturedAt = saved?.imageCapturedAt || "";

    if (!imageCapturedAt || now().getTime() - Date.parse(imageCapturedAt) >= IMAGE_REFRESH_MS) {
      try {
        const imageResponse = await fetchImpl(`/d2l/api/lp/${LP_VERSION}/profile/myProfile/image?size=96`, { credentials: "include" });
        if (imageResponse.ok) {
          const blob = await imageResponse.blob();
          if (/^image\//.test(blob.type) && blob.size <= MAX_BYTES) dataUrl = await toDataUrl(blob);
        }
      } catch {}
      imageCapturedAt = now().toISOString();
    }

    try {
      const record = {
        displayName: name,
        accountId: accountIdFromUser(user),
        dataUrl,
        imageCapturedAt,
        capturedAt: now().toISOString()
      };
      await storage.set({ [STORAGE_KEY]: record });
      return record;
    } catch {
      return saved || null;
    }
  }

  function scheduleCapture() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage || globalThis.window?.top !== globalThis.window?.self) return;
    setTimeout(() => captureUserProfile({ storage }).catch(() => {}), 1000);
  }

  Object.assign(content, { captureUserProfile, fetchVerifiedAccountId, inspectVerifiedAccount, USER_PROFILE_KEY: STORAGE_KEY });
  scheduleCapture();
})();
