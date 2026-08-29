import { readFileSync } from "node:fs";
import path from "node:path";

import { discoverCollectionAssets, type AssetKind, type CollectionAsset } from "./catalog.ts";
import { entriesOf } from "./dir.ts";

export type StatusEntry =
  | { state: "in-sync"; kind: AssetKind; name: string; asset: CollectionAsset; projectPath: string }
  | { state: "differs"; kind: AssetKind; name: string; asset: CollectionAsset; projectPath: string }
  | { state: "collection-only"; kind: AssetKind; name: string; asset: CollectionAsset }
  | { state: "project-only"; kind: AssetKind; name: string; projectPath: string };

export function projectStatus(args: { collectionRoot: string; projectDir: string }): StatusEntry[] {
  const assets = byOwnerPrecedence(discoverCollectionAssets(args.collectionRoot));
  const projectAssets = discoverProjectAssets(args.projectDir);
  const states = compareToProject(assets, projectAssets);

  const candidatesByKey = new Map<string, CollectionAsset[]>();
  for (const asset of assets) {
    candidatesByKey.set(keyOf(asset), [...(candidatesByKey.get(keyOf(asset)) ?? []), asset]);
  }

  const entries: StatusEntry[] = [];

  for (const { kind, name, path: projectPath } of projectAssets) {
    const candidates = candidatesByKey.get(keyOf({ kind, name }));
    if (candidates === undefined) {
      entries.push({ state: "project-only", kind, name, projectPath });
      continue;
    }
    candidatesByKey.delete(keyOf({ kind, name }));
    const matched = candidates.find((candidate) => states.get(candidate) === "in-sync");
    if (matched !== undefined) {
      entries.push({ state: "in-sync", kind, name, asset: matched, projectPath });
      continue;
    }
    const first = candidates[0];
    if (first !== undefined) entries.push({ state: "differs", kind, name, asset: first, projectPath });
  }

  for (const candidates of candidatesByKey.values()) {
    const first = candidates[0];
    if (first !== undefined) {
      entries.push({ state: "collection-only", kind: first.kind, name: first.name, asset: first });
    }
  }

  const stateOrder: Record<StatusEntry["state"], number> = {
    differs: 0,
    "project-only": 1,
    "in-sync": 2,
    "collection-only": 3,
  };
  return entries.sort(
    (a, b) => stateOrder[a.state] - stateOrder[b.state] || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}

export type AssetSyncState = "absent" | "in-sync" | "differs";

export function collectionAssetStates(args: {
  projectDir: string;
  assets: CollectionAsset[];
}): Map<CollectionAsset, AssetSyncState> {
  return compareToProject(args.assets, discoverProjectAssets(args.projectDir));
}

function compareToProject(
  assets: CollectionAsset[],
  projectAssets: ProjectAsset[],
): Map<CollectionAsset, AssetSyncState> {
  const projectPaths = new Map(projectAssets.map((asset) => [keyOf(asset), asset.path]));
  return new Map(
    assets.map((asset) => {
      const projectPath = projectPaths.get(keyOf(asset));
      if (projectPath === undefined) return [asset, "absent"];
      return [asset, assetContentEqual(asset.kind, asset.path, projectPath) ? "in-sync" : "differs"];
    }),
  );
}

function byOwnerPrecedence(assets: CollectionAsset[]): CollectionAsset[] {
  const rank = (asset: CollectionAsset): number => (asset.owner.kind === "mine" ? 0 : 1);
  return [...assets].sort((a, b) => rank(a) - rank(b));
}

function keyOf(asset: { kind: AssetKind; name: string }): string {
  return `${asset.kind}:${asset.name}`;
}

type ProjectAsset = { kind: AssetKind; name: string; path: string };

function discoverProjectAssets(projectDir: string): ProjectAsset[] {
  const assets: ProjectAsset[] = [];
  for (const entry of entriesOf(path.join(projectDir, ".agents", "skills"))) {
    if (entry.type === "dir") assets.push({ kind: "skill", name: entry.name, path: entry.path });
  }
  for (const entry of entriesOf(path.join(projectDir, ".agents", "agents"))) {
    if (entry.type === "file" && entry.name.endsWith(".md")) {
      assets.push({ kind: "agent", name: path.basename(entry.name, ".md"), path: entry.path });
    }
  }
  return assets;
}

function assetContentEqual(kind: AssetKind, a: string, b: string): boolean {
  if (kind === "agent") return readFileSync(a).equals(readFileSync(b));
  const filesA = listFiles(a);
  const filesB = listFiles(b);
  if (filesA.length !== filesB.length) return false;
  return filesA.every(
    (file, i) => file === filesB[i] && readFileSync(path.join(a, file)).equals(readFileSync(path.join(b, file))),
  );
}

function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of entriesOf(dir)) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.type === "dir") files.push(...listFiles(entry.path, relative));
    else files.push(relative);
  }
  return files;
}
