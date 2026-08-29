import { readFileSync } from "node:fs";
import path from "node:path";

export function findCollectionRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (isPolskillsPackage(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No polskills package.json found in or above ${startDir} — the bin must run from inside a polskills checkout`,
      );
    }
    dir = parent;
  }
}

function isPolskillsPackage(packageJsonPath: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "name" in parsed &&
    parsed.name === "polskills"
  );
}
