import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks, loadContentHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
const token = "d2l-local-dev-8f6c2a1e";
const listenerRows = [];
const backgroundHooks = loadBackgroundHooks({
  chrome: {
    tabs: {
      sendMessage: async () => ({ ok: true, accountId: "private-id", diagnostic: { ok: true, reason: "verified", status: 200, fields: ["ProfileIdentifier"] } }),
      query: async () => [{ id: 7, url: "https://kennesaw.view.usg.edu/d2l/home" }]
    },
    runtime: {
      id: "test-extension-id",
      onMessage: { addListener(listener) { listenerRows.push(listener); } }
    }
  }
});
backgroundHooks.configureAccountRegistry({
  describe: async () => ({ accounts: [{ accountKey: "https://kennesaw.view.usg.edu|private-id" }] })
});
if (listenerRows.length !== 1) throw new Error("Production background listener was not installed");

function ask(listener, message, sender) {
  return new Promise((resolve) => listener(message, sender, resolve));
}

const validSender = { frameId: 0, tab: { id: 7, url: "https://kennesaw.view.usg.edu/d2l/home" } };
const request = { type: "D2L_DEV_RUNTIME_CHECK", token, contentVersion: manifest.version };
const response = await ask(listenerRows[0], request, validSender);
if (!response?.ok || !response.backgroundAlive || !response.contentAlive) throw new Error("Runtime health response did not prove both sides are alive");
if (response.extensionVersion !== manifest.version || response.contentVersion !== manifest.version || !response.versionsMatch) throw new Error("Runtime health response did not match the manifest and content build");
if (response.extensionId !== "test-extension-id") throw new Error("Runtime health response omitted the extension ID");
if (response.accountCheck?.ok !== true || response.accountCheck?.reasonCode !== "verified") throw new Error("Runtime health response did not expose the production verifier result");
if (JSON.stringify(response.accountCheck).includes("private-id")) throw new Error("Runtime health response exposed the student's account identifier");
const diagnosticTab = response.accountCheck.tabs?.[0];
if (response.accountCheck.candidateCount !== 1 || diagnosticTab?.tabId !== 7 || diagnosticTab?.url !== "https://kennesaw.view.usg.edu/d2l/home") throw new Error("Runtime health response did not identify the exact D2L tab considered");
if (!diagnosticTab.contentScriptResponds || diagnosticTab.whoami.status !== 200 || !diagnosticTab.registryEntryExists || !diagnosticTab.productionHelperVerified || diagnosticTab.reasonCode !== "verified") throw new Error("Runtime health response omitted a verification or registry result");

for (const [name, message, sender] of [
  ["wrong token", { ...request, token: "wrong" }, validSender],
  ["wrong origin", request, { frameId: 0, tab: { url: "https://example.com/d2l/home" } }],
  ["subframe", request, { ...validSender, frameId: 2 }]
]) {
  const rejected = await ask(listenerRows[0], message, sender);
  if (rejected?.ok !== false || !/rejected/.test(rejected.error || "")) throw new Error(`Runtime check accepted ${name}`);
}

const productionListeners = [];
loadBackgroundHooks({
  chrome: {
    runtime: {
      id: "production-extension-id",
      getManifest: () => ({ ...manifest, update_url: "https://updates.example.test" }),
      onMessage: { addListener(listener) { productionListeners.push(listener); } }
    }
  }
});
const productionRejected = await ask(productionListeners[0], request, validSender);
if (productionRejected?.ok !== false) throw new Error("Packaged extension accepted the development runtime check");

let sent;
const liveResponse = {
  ok: true,
  backgroundAlive: true,
  contentAlive: true,
  extensionVersion: manifest.version,
  contentVersion: manifest.version,
  versionsMatch: true,
  extensionId: "test-extension-id",
  accountCheck: { ok: true, reasonCode: "verified", currentTabId: 7, candidateCount: 1, registryEntryCount: 1, registryAvailable: true, tabs: [{ tabId: 7, url: "https://kennesaw.view.usg.edu/d2l/home", contentScriptResponds: true, whoami: { ok: true, status: 200, reason: "verified", identity: "…ate-id" }, registryEntryExists: true, productionHelperVerified: true, productionIdentity: "…ate-id", reasonCode: "verified" }] }
};
const contentHooks = loadContentHooks({
  href: `https://kennesaw.view.usg.edu/d2l/home#d2l-extractor-dev-runtime-check=${token}`,
  chrome: {
    runtime: {
      sendMessage: async (message) => { sent = message; return liveResponse; }
    }
  }
});
await new Promise((resolve) => setImmediate(resolve));
if (sent?.type !== "D2L_DEV_RUNTIME_CHECK" || sent.token !== token || sent.contentVersion !== manifest.version) throw new Error("D2L hash bridge sent an incomplete runtime check");
const escapedVersion = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (!new RegExp(`background ${escapedVersion}; page script ${escapedVersion} \\(match\\)`).test(contentHooks.devRuntimeStatus())) throw new Error("Runtime result was not exposed as readable page status text");
if (!/Account check: verified/.test(contentHooks.devRuntimeStatus()) || !/WHOAMI=HTTP 200/.test(contentHooks.devRuntimeStatus()) || !/registry=match/.test(contentHooks.devRuntimeStatus()) || !/production-helper=verified/.test(contentHooks.devRuntimeStatus())) throw new Error("Detailed sanitized account-verification result was not exposed as readable page status text");

console.log("Development runtime check proves background/content versions, exposes accessible status, and rejects unauthorized or packaged callers.");
