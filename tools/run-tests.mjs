import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const testDirectory = resolve("test");
const tests = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => resolve(testDirectory, name));

if (tests.length === 0) {
  console.error("No test files were found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
