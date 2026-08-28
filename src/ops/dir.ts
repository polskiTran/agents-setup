import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type DirEntry = { name: string; path: string; type: "dir" | "file" };

/**
 * Sorted entries of a directory, safe for arbitrary vendored content:
 * symlinks are classified by what they resolve to, and broken symlinks are
 * skipped instead of crashing the walk (real upstreams ship them).
 * A missing directory is just empty.
 */
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
