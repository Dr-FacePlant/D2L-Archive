import { loadBackgroundHooks } from "./test-production-loader.mjs";

const hooks = loadBackgroundHooks();
const adapter = hooks.createMemoryArchiveAdapter();
const repository = hooks.createArchiveRepository(adapter, { now: () => "2026-10-02T12:00:00.000Z" });

const saved = await repository.recordActivity({
  operation: "checklist.toggle",
  category: "local-change",
  status: "saved",
  itemId: "task-1",
  details: { checked: true, token: "must-not-persist", body: "private", nested: [{ credentials: "private", url: "https://d2l.test/?access_token=secret-value&view=1" }] },
  error: "https://d2l.test/?session=secret-error"
});
if (saved.details.token || saved.details.body || saved.details.nested[0].credentials || saved.details.nested[0].url.includes("secret-value") || saved.error.includes("secret-error") || saved.status !== "saved") throw new Error("Activity redaction or normalization failed");

for (let index = 0; index < 1005; index += 1) {
  await repository.recordActivity({ timestamp: `2026-10-02T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`, operation: "sync.progress", category: "sync", status: index % 2 ? "completed" : "started", correlationId: "sync-1" });
}
const events = await repository.listActivity({ limit: 500 });
if (events.length !== 500) throw new Error(`Activity limit query returned ${events.length}`);
if ((await adapter.runTransaction(["activity"], "readonly", ({ activity }) => activity.getAll())).length !== 1000) throw new Error("Activity retention limit failed");
const summary = await repository.getActivitySummary({});
if (summary.total !== 500 || !summary.byCategory.sync || !summary.latest) throw new Error("Activity summary failed");

console.log("Activity history persists, redacts sensitive fields, enforces retention, filters, and summarizes.");
