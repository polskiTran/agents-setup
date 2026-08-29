import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type DirEntry = { name: string; path: string; type: "dir" | "file" };

/** Vendored upstreams ship broken symlinks; statSync throws on those, so the walk skips them. */
export function entriesOf(dir: string): DirEntry[] {
  if (!existsSync(dir)) return [];
  const entries: DirEntry[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, dirent.name);
    let type: DirEntry["type"];
    if (dirent.isDirectory()) type = "dir";
    else if (dirent.isFile()) type = "file";
    else if (dirent.isSymbolicLink()) {
      try {
        type = statSync(full).isDirectory() ? "dir" : "file";
      } catch {
        continue;
      }
    } else continue;
    entries.push({ name: dirent.name, path: full, type });
  }
  return entries;
}
