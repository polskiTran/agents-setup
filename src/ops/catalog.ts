import { existsSync } from "node:fs";
import path from "node:path";

import { entriesOf } from "./dir.ts";

export type AssetKind = "skill" | "agent";

export type Owner = { kind: "mine" } | { kind: "vendor"; source: string };

/** One provisionable asset: a skill directory or a subagent .md file. */
export type CollectionAsset = {
  kind: AssetKind;
  name: string;
  owner: Owner;
  path: string;
};

/**
 * Everything provisionable from the collection, mine first, then vendors in
 * sorted order — status resolution relies on that precedence. Skills are
 * directories containing SKILL.md (searched recursively under vendor copies,
 * so any upstream layout works, including whole-repo-is-one-skill). Subagents
 * are .md files directly inside a directory named "agents".
 */
export function discoverCollectionAssets(collectionRoot: string): CollectionAsset[] {
  const assets: CollectionAsset[] = [];
  const mine: Owner = { kind: "mine" };

  for (const entry of entriesOf(path.join(collectionRoot, "skills"))) {
    if (entry.type === "dir" && existsSync(path.join(entry.path, "SKILL.md"))) {
      assets.push({ kind: "skill", name: entry.name, owner: mine, path: entry.path });
    }
  }
  for (const file of agentFilesIn(path.join(collectionRoot, "agents"))) {
    assets.push({ kind: "agent", name: path.basename(file, ".md"), owner: mine, path: file });
  }

  const vendorRoot = path.join(collectionRoot, "vendor");
  for (const owner of entriesOf(vendorRoot)) {
    if (owner.type !== "dir") continue;
    for (const repo of entriesOf(owner.path)) {
      if (repo.type !== "dir") continue;
      scanVendorTree(repo.path, { kind: "vendor", source: `${owner.name}/${repo.name}` }, assets);
    }
  }
  return assets;
}

function scanVendorTree(dir: string, owner: Owner, out: CollectionAsset[]): void {
  if (existsSync(path.join(dir, "SKILL.md"))) {
    out.push({ kind: "skill", name: path.basename(dir), owner, path: dir });
    return; // everything below a SKILL.md is that skill's internals
  }
  if (path.basename(dir) === "agents") {
    for (const file of agentFilesIn(dir)) {
      out.push({ kind: "agent", name: path.basename(file, ".md"), owner, path: file });
    }
    return;
  }
  for (const entry of entriesOf(dir)) {
    if (entry.type !== "dir" || entry.name === ".git" || entry.name === "node_modules") continue;
    scanVendorTree(entry.path, owner, out);
  }
}

function agentFilesIn(dir: string): string[] {
  return entriesOf(dir)
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .map((entry) => entry.path);
}
