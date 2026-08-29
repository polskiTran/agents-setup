import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { AssetKind, CollectionAsset } from "./catalog.ts";

/** `git diff --no-index` exits 1 when the paths differ, so only status > 1 is a real failure. */
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
