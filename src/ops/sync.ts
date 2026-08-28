import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { AssetKind, CollectionAsset } from "./catalog.ts";

/**
 * Unified diff between the collection's copy (a/) and the project's copy (b/),
 * via `git diff --no-index` — which exits 1 when the paths differ, so only
 * exit codes above 1 are real failures. Empty output means identical content.
 */
export function diffPaths(args: { collectionPath: string; projectPath: string; color?: boolean }): string {
  const result = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      ...(args.color === true ? ["--color=always"] : []),
      "--",
      args.collectionPath,
      args.projectPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status === null || result.status > 1) {
    throw new Error(`git diff failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * Keeps the project version of a differing asset by writing it over the
 * collection's copy. Allowed only for assets I own — a vendor copy must never
 * take write-back, because the next upstream pull would steamroll it; that
 * path is adoptIntoMine (fork-to-mine) instead.
 */
export function writeBackToCollection(args: { asset: CollectionAsset; projectPath: string }): string {
  const { asset, projectPath } = args;
  if (asset.owner.kind !== "mine") {
    throw new Error(
      `${asset.name} is vendor-sourced (${asset.owner.source}) — fork it into your own collection instead of writing back`,
    );
  }
  rmSync(asset.path, { recursive: true, force: true });
  cpSync(projectPath, asset.path, { recursive: true });
  return asset.path;
}

/**
 * Copies a project copy into my own collection area. Serves both
 * fork-to-mine (keeping project edits to a vendor-sourced asset) and adopting
 * a project-only asset; the vendored copy, if any, is left untouched and the
 * project now tracks the fork via mine-first attribution.
 */
export function adoptIntoMine(args: {
  collectionRoot: string;
  kind: AssetKind;
  name: string;
  projectPath: string;
}): string {
  const { collectionRoot, kind, name, projectPath } = args;
  const dest =
    kind === "skill"
      ? path.join(collectionRoot, "skills", name)
      : path.join(collectionRoot, "agents", `${name}.md`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(projectPath, dest, { recursive: true });
  return dest;
}
