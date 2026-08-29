import { readFileSync } from "node:fs";
import path from "node:path";

import { discoverCollectionAssets, type AssetKind, type CollectionAsset } from "./catalog.ts";
import { entriesOf } from "./dir.ts";

export type StatusEntry =
  | { state: "in-sync"; kind: AssetKind; name: string; asset: CollectionAsset; projectPath: string }
  | { state: "differs"; kind: AssetKind; name: string; asset: CollectionAsset; projectPath: string }
  | { state: "collection-only"; kind: AssetKind; name: string; asset: CollectionAsset }
  | { state: "project-only"; kind: AssetKind; name: string; projectPath: string };

/**
 * The four-state sync view: every asset name known to the collection or
 * present in the project's .agents/ areas, compared purely by content — no
 * manifest anywhere. When several owners provide the same name, an exact
 * content match wins the attribution; otherwise the first candidate
 * (mine before vendors) is the comparator. A project without .agents/ is
 * simply all collection-only.
 */
export function projectStatus(args: { collectionRoot: string; projectDir: string }): StatusEntry[] {
  const candidatesByKey = new Map<string, CollectionAsset[]>();
  for (const asset of discoverCollectionAssets(args.collectionRoot)) {
    const key = `${asset.kind}:${asset.name}`;
    candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), asset]);
  }

  const projectAssets = discoverProjectAssets(args.projectDir);
  const entries: StatusEntry[] = [];

  for (const project of projectAssets) {
    const candidates = candidatesByKey.get(`${project.kind}:${project.name}`);
    if (candidates === undefined) {
      entries.push({ state: "project-only", kind: project.kind, name: project.name, projectPath: project.path });
      continue;
    }
    candidatesByKey.delete(`${project.kind}:${project.name}`);
    const match = candidates.find((candidate) => assetContentEqual(candidate.kind, candidate.path, project.path));
    const first = candidates[0];
    if (match !== undefined) {
      entries.push({ state: "in-sync", kind: project.kind, name: project.name, asset: match, projectPath: project.path });
    } else if (first !== undefined) {
      entries.push({ state: "differs", kind: project.kind, name: project.name, asset: first, projectPath: project.path });
    }
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
