import { loadBackgroundHooks } from "./test-production-loader.mjs";

const listeners = [];
loadBackgroundHooks({
  chrome: {
    runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } },
    storage: { local: { get: async () => ({ dashboardProfile: { accountId: "acct-1" } }) } }
  }
});
const listener = listeners[0];
const d2lSender = { frameId: 0, tab: { url: "https://kennesaw.view.usg.edu/d2l/home" } };

function ask(message, sender) {
  return new Promise((resolve) => {
    const keep = listener(message, sender, resolve);
    if (keep === false) resolve(undefined);
  });
}
const rejected = [
  ["wrong token", { type: "D2L_DEV_SYNC_DIAGNOSTICS", token: "wrong" }, d2lSender],
  ["no token", { type: "D2L_DEV_SYNC_DIAGNOSTICS" }, d2lSender],
  ["non-D2L page", { type: "D2L_DEV_SYNC_DIAGNOSTICS", token: "d2l-local-dev-8f6c2a1e" }, { frameId: 0, tab: { url: "https://example.com/d2l/home" } }],
  ["sub-frame", { type: "D2L_DEV_SYNC_DIAGNOSTICS", token: "d2l-local-dev-8f6c2a1e" }, { ...d2lSender, frameId: 3 }]
];
for (const [name, message, sender] of rejected) {
  const response = await ask(message, sender);
  if (response?.ok !== false || !/rejected/.test(response?.error || "")) throw new Error(`Diagnostics accepted: ${name}`);
}

// A caller cannot pick the method or ask for a mutation: the relay ignores them.
const response = await ask({
  type: "D2L_DEV_SYNC_DIAGNOSTICS", token: "d2l-local-dev-8f6c2a1e",
  method: "archive.ingestRows", params: { rows: [{}] }, methods: ["organizer.rebuildAll"]
}, d2lSender);
if (response?.ok === true) {
  for (const key of ["queue", "syncState", "activitySummary", "activity"]) {
    if (!(key in response)) throw new Error(`Diagnostics missing ${key}`);
  }
  if (response.accountId !== "acct-1") throw new Error("Diagnostics did not use the stored account");
}
console.log("accepted-path ok:", response?.ok, response?.error || "");
if (response && response.ok !== true && !response.error) throw new Error("Diagnostics failure had no error");
console.log("Sync diagnostics relay rejects bad token, origin, frame, and ignores caller-chosen methods.");
