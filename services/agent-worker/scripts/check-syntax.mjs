import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = new URL("../src/", import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith(".js")).sort();
for (const file of files) {
  const checked = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(file, directory))], { stdio: "inherit" });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status || 1);
}
console.log(`Checked syntax of ${files.length} worker JavaScript files`);
