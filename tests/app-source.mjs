import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboard = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "dashboard");
const appFiles = fs.readdirSync(dashboard).filter((file) => /^app-.*\.js$/.test(file)).sort();

export function appSource() {
  return ["app-state.js", ...appFiles, "app.js"]
    .map((file) => fs.readFileSync(path.join(dashboard, file), "utf8"))
    .join("\n");
}
