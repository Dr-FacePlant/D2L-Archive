import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/dashboard/checklist-state.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "checklist-state.js" });
const helper = context.D2LDashboardChecklist;
const values = { dashboardChecklistState: { "task-old": true } };
const storage = {
  get: async (key) => ({ [key]: values[key] }),
  set: async (records) => Object.assign(values, records)
};

const firstAccount = await helper.loadChecklistState(storage, {
  keyPrefix: "dashboardChecklistState", legacyKey: "dashboardChecklistState", ownerKey: "dashboardChecklistOwner", accountId: "account-a"
});
if (firstAccount.key !== "dashboardChecklistState:account-a" || firstAccount.state["task-old"] !== true || values.dashboardChecklistOwner !== "account-a") {
  throw new Error("Legacy checklist state was not safely assigned to the first verified account.");
}

const secondAccount = await helper.loadChecklistState(storage, {
  keyPrefix: "dashboardChecklistState", legacyKey: "dashboardChecklistState", ownerKey: "dashboardChecklistOwner", accountId: "account-b"
});
if (secondAccount.state["task-old"] || Object.keys(secondAccount.state).length) throw new Error("Checklist completion state leaked between accounts.");

const failed = await helper.persistChecklistState({ set: async () => { throw new Error("quota exceeded"); } }, firstAccount.key, firstAccount.state, { "task-new": true });
if (failed.ok || failed.state["task-old"] !== true || failed.error !== "quota exceeded") throw new Error("Checklist storage failure did not preserve prior state and surface the error.");

console.log("Checklist state is account-scoped, migrates legacy state once, and reports persistence failures.");
