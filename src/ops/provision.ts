import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import type { AssetKind, CollectionAsset } from "./catalog.ts";

export type InitOutcome = { link: string; outcome: "created" | "already-linked" | "conflict" };

/**
 * Creates the canonical committed areas (.agents/skills, .agents/agents) and
 * the relative .claude symlinks Claude Code reads through. Safe to re-run:
 * correct links are left alone, and anything unexpected already sitting at a
 * link path is reported as a conflict, never clobbered.
 */
export function initProject(projectDir: string): InitOutcome[] {
  mkdirSync(path.join(projectDir, ".agents", "skills"), { recursive: true });
  mkdirSync(path.join(projectDir, ".agents", "agents"), { recursive: true });
  mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
  return (["skills", "agents"] as const).map((area) => ensureLink(projectDir, area));
}

function ensureLink(projectDir: string, area: "skills" | "agents"): InitOutcome {
  const linkPath = path.join(projectDir, ".claude", area);
  const target = path.join("..", ".agents", area);
  const link = `.claude/${area}`;
  if (!existsSync(linkPath) && !isSymlink(linkPath)) {
    symlinkSync(target, linkPath);
    return { link, outcome: "created" };
  }
  if (isSymlink(linkPath) && readlinkSync(linkPath) === target) {
    return { link, outcome: "already-linked" };
  }
  return { link, outcome: "conflict" };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Copies an asset from the collection into the project's .agents/ areas,
 * replacing any existing copy of the same name — this is also the
 * collection→project overwrite used to resolve drift. Returns the
 * destination path.
 */
export function addAssetToProject(args: { projectDir: string; asset: CollectionAsset }): string {
  const { projectDir, asset } = args;
  const dest =
    asset.kind === "skill"
      ? path.join(projectDir, ".agents", "skills", asset.name)
      : path.join(projectDir, ".agents", "agents", `${asset.name}.md`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(asset.path, dest, { recursive: true });
  return dest;
}

/** Deletes a provisioned asset from the project. Throws if it isn't there. */
export function removeAssetFromProject(args: { projectDir: string; kind: AssetKind; name: string }): void {
  const { projectDir, kind, name } = args;
  const target =
    kind === "skill"
      ? path.join(projectDir, ".agents", "skills", name)
      : path.join(projectDir, ".agents", "agents", `${name}.md`);
  if (!existsSync(target)) {
    throw new Error(`${kind} "${name}" is not provisioned in this project`);
  }
  rmSync(target, { recursive: true });
}
