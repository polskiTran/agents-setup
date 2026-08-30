#!/usr/bin/env node
import { confirm, intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";

import { findCollectionRoot } from "./ops/collection-root.ts";
import {
  addSource,
  listSources,
  parseUpstreamUrl,
  pullSource,
  readSources,
  removeSource,
  type LicenseInfo,
} from "./ops/sources.ts";
import { collectionAssetStates, projectStatus, type AssetSyncState, type StatusEntry } from "./ops/status.ts";
import { addAssetToProject, initProject, removeAssetFromProject } from "./ops/provision.ts";
import { adoptIntoMine, diffPaths, writeBackToCollection } from "./ops/sync.ts";
import { discoverCollectionAssets, type AssetKind, type CollectionAsset, type Owner } from "./ops/catalog.ts";
import { spawnSync } from "node:child_process";

const collectionRoot = findCollectionRoot(import.meta.dirname);
const projectDir = process.cwd();

const stateSymbols: Record<StatusEntry["state"], { symbol: string; ansi: string }> = {
  differs: { symbol: "≠", ansi: "33" },
  "project-only": { symbol: "?", ansi: "36" },
  "in-sync": { symbol: "✓", ansi: "32" },
  "collection-only": { symbol: "○", ansi: "2" },
};

const MY_COLLECTION = "my collection";

const stateNames: Record<StatusEntry["state"], string> = {
  differs: "out of sync",
  "project-only": "only in this project",
  "in-sync": "in sync",
  "collection-only": "not in this project",
};

const addableDisplay: Record<Exclude<AssetSyncState, "in-sync">, { prefix: string; hint?: string }> = {
  absent: { prefix: "  " },
  differs: { prefix: `${stateGlyph("differs")} `, hint: "adding overwrites the project copy" },
};

const nfFaBook = "\uf02d";
const nfFaUsers = "\uf0c0";
const kindSymbols: Record<AssetKind, string> = { skill: nfFaBook, agent: nfFaUsers };

intro("polskills");
log.info(`Collection  ${collectionRoot}`);
log.info(`Project     ${projectDir}`);
renderStatus();

if (!process.stdin.isTTY) {
  outro("The menu needs an interactive terminal. Run polskills in one.");
  process.exit(0);
}

// Actions are grouped by what they touch: the project you are standing in, or
// the collection that feeds every project. Each group keeps its own cursor so
// running several actions in a row does not mean walking the menu each time.
const menus = {
  project: {
    label: "This project",
    hint: "what is here, and what to add, remove, or resolve",
    options: [
      { value: "status", label: "Project status", hint: "what this project has and how it compares" },
      { value: "all-assets", label: "Show everything", hint: "the same view, plus what is not added yet" },
      { value: "resolve", label: "Review differences", hint: "fix anything out of sync or only in this project" },
      { value: "add-assets", label: "Add to project", hint: "copy skills and agents from my collection" },
      { value: "remove-assets", label: "Remove from project", hint: "delete skills and agents from this project" },
      { value: "init", label: "Set up project", hint: "creates .agents/skills, .agents/agents, and the .claude symlinks" },
    ],
  },
  collection: {
    label: "My collection",
    hint: "the upstream repos it is built from",
    options: [
      { value: "add-upstream", label: "Add upstream", hint: "track a skills repo by URL" },
      { value: "pull-upstream", label: "Pull upstream", hint: "review and apply upstream changes" },
      { value: "remove-upstream", label: "Remove upstream", hint: "stop tracking a repo and delete its vendored copy" },
      { value: "list-sources", label: "List upstreams", hint: "tracked upstreams and their licenses" },
    ],
  },
} as const;

type Radius = keyof typeof menus;
type Action = (typeof menus)[Radius]["options"][number]["value"];

const run: Record<Action, () => void | Promise<void>> = {
  status: renderStatus,
  "all-assets": renderAllAssets,
  resolve: runResolve,
  "add-assets": runAddAssets,
  "remove-assets": runRemoveAssets,
  init: runInit,
  "add-upstream": runAddUpstream,
  "pull-upstream": runPullUpstream,
  "remove-upstream": runRemoveUpstream,
  "list-sources": runListSources,
};

let radiusCursor: Radius | "exit" = "project";
const actionCursor: Record<Radius, Action> = { project: "status", collection: "add-upstream" };

while (true) {
  // Annotated because `initialValue` reads a cursor this same statement writes.
  const radius: Radius | "exit" | symbol = await select<Radius | "exit">({
    message: "Actions",
    initialValue: radiusCursor,
    options: [
      ...Object.entries(menus).map(([value, menu]) => ({ value: value as Radius, label: menu.label, hint: menu.hint })),
      { value: "exit" as const, label: "Exit" },
    ],
  });
  if (isCancel(radius) || radius === "exit") break;
  radiusCursor = radius;

  const menu = menus[radius];
  while (true) {
    const action = await select<Action | "back">({
      message: menu.label,
      initialValue: actionCursor[radius],
      options: [...menu.options, { value: "back" as const, label: "Back" }],
    });
    if (isCancel(action) || action === "back") break;
    actionCursor[radius] = action;
    await run[action]();
  }
}

outro("Done.");

async function runAddUpstream(): Promise<void> {
  const rawUrl = await text({
    message: "Upstream URL (repo or GitHub tree link)",
    placeholder: "https://github.com/owner/repo",
    validate: (value) => (value.trim() === "" ? "A URL is required" : undefined),
  });
  if (isCancel(rawUrl)) return;
  const parsed = parseUpstreamUrl(rawUrl);

  const subpathInput = await text({
    message: "Subpath to track, or empty for the whole repo",
    initialValue: parsed.subpath ?? "",
    defaultValue: "",
  });
  if (isCancel(subpathInput)) return;
  const subpath = subpathInput.trim();

  const progress = spinner();
  progress.start(`Cloning ${parsed.url}`);
  try {
    const added = addSource({
      collectionRoot,
      url: parsed.url,
      ...(subpath === "" ? {} : { subpath }),
    });
    progress.stop(`Added ${added.source.name} at ${added.source.sha.slice(0, 7)}`);
    reportLicense(added.source.name, added.license);
  } catch (error) {
    progress.stop("Adding the upstream failed", 1);
    log.error(error instanceof Error ? error.message : String(error));
  }
}

async function runPullUpstream(): Promise<void> {
  const sources = readSources(collectionRoot);
  if (sources.length === 0) {
    log.info("No upstreams yet.");
    return;
  }
  const name = await select({
    message: "Pull which upstream?",
    options: sources.map((source) => ({ value: source.name, label: `${source.name}  @ ${source.sha.slice(0, 7)}` })),
  });
  if (isCancel(name)) return;

  const progress = spinner();
  progress.start(`Fetching ${name}`);
  let preview;
  try {
    preview = pullSource({ collectionRoot, name });
  } catch (error) {
    progress.stop("Pulling the upstream failed", 1);
    log.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (preview.kind === "up-to-date") {
    progress.stop(`${name} is already up to date at ${preview.source.sha.slice(0, 7)}`);
    return;
  }
  progress.stop(`${name}: ${preview.source.sha.slice(0, 7)} → ${preview.upstreamSha.slice(0, 7)}`);
  if (preview.diff === "") {
    log.info("The files are identical. Applying updates only the pinned commit.");
  } else {
    showDiff(preview.vendorDir, preview.contentRoot);
  }
  const approved = await confirm({ message: `Apply this update to ${name}?` });
  if (isCancel(approved) || !approved) {
    preview.discard();
    log.info("Nothing changed.");
    return;
  }
  const updated = preview.apply();
  log.info(`${name} updated to ${updated.sha.slice(0, 7)}.`);
}

async function runRemoveUpstream(): Promise<void> {
  const sources = readSources(collectionRoot);
  if (sources.length === 0) {
    log.info("No upstreams yet.");
    return;
  }
  const name = await select({
    message: "Remove which upstream?",
    options: [
      ...sources.map((source) => ({ value: source.name, label: source.name, hint: source.url })),
      { value: "", label: "Back" },
    ],
  });
  if (isCancel(name) || name === "") return;

  const vendored = discoverCollectionAssets(collectionRoot).filter(
    (asset) => asset.owner.kind === "vendor" && asset.owner.source === name,
  );
  const approved = await confirm({
    message:
      vendored.length === 0
        ? `Stop tracking ${name} and delete vendor/${name}?`
        : `Stop tracking ${name}? That deletes vendor/${name} and its ${countPhrase(vendored)}. Copies already in projects stay.`,
  });
  if (isCancel(approved) || !approved) {
    log.info("Nothing changed.");
    return;
  }
  try {
    removeSource({ collectionRoot, name });
    log.info(`${name} is no longer tracked.`);
    renderStatus();
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
  }
}

function runListSources(): void {
  const entries = listSources(collectionRoot);
  if (entries.length === 0) {
    log.info("No upstreams yet.");
    return;
  }
  for (const { source, license } of entries) {
    const subpath = source.subpath === undefined ? "" : `  /${source.subpath}`;
    const licenseText = license.kind === "found" ? license.summary : "no license found";
    log.message(
      `${source.name}  @ ${source.sha.slice(0, 7)}${subpath}\n${source.url}\n${licenseText}`,
    );
  }
}

function runInit(): void {
  const outcomes = initProject(projectDir);
  for (const { link, outcome } of outcomes) {
    if (outcome === "conflict") {
      log.warn(`${link} exists and is not the expected symlink. Left untouched.`);
    } else {
      log.info(`${link}: ${outcome === "created" ? "created" : "already linked"}`);
    }
  }
}

async function runAddAssets(): Promise<void> {
  const assets = discoverCollectionAssets(collectionRoot);
  if (assets.length === 0) {
    log.info("My collection is empty. Add an upstream, or write a skill in skills/.");
    return;
  }
  const states = collectionAssetStates({ projectDir, assets });
  const addable = assets.flatMap((asset) => {
    const state = states.get(asset);
    return state === undefined || state === "in-sync" ? [] : [{ asset, state }];
  });
  if (addable.length === 0) {
    log.info("This project already has every skill and agent in my collection.");
    return;
  }
  const bySource = new Map<string, typeof addable>();
  for (const candidate of addable) {
    const label = ownerLabel(candidate.asset.owner);
    bySource.set(label, [...(bySource.get(label) ?? []), candidate]);
  }

  while (true) {
    const source = await select({
      message: "Add from where?",
      options: [
        ...[...bySource.entries()].map(([label, list]) => ({
          value: label,
          label,
          hint: sourceHint(list),
        })),
        { value: "", label: "Back" },
      ],
    });
    if (isCancel(source) || source === "") return;
    const available = bySource.get(source);
    if (available === undefined) continue;

    if (available.some(({ state }) => state === "differs")) {
      log.info(`${stateGlyph("differs")} out of sync with my collection`);
    }
    const chosen = await multiselect<CollectionAsset>({
      message: `Choose what to add from ${source}. Space selects, enter confirms`,
      options: available.map(({ asset, state }) => {
        const { prefix, hint } = addableDisplay[state];
        return {
          value: asset,
          label: `${prefix}${asset.name}  (${asset.kind})`,
          ...(hint === undefined ? {} : { hint }),
        };
      }),
      maxItems: 12,
      required: false,
    });
    if (isCancel(chosen)) return;
    if (chosen.length === 0) continue;
    for (const asset of chosen) addAssetToProject({ projectDir, asset });
    log.info(`Added ${countPhrase(chosen)} from ${source}.`);
    renderStatus();
    return;
  }
}

async function runRemoveAssets(): Promise<void> {
  const entries = projectStatus({ collectionRoot, projectDir });
  const added = entries.filter((entry) => entry.state === "in-sync" || entry.state === "differs");
  const projectOnly = entries.filter((entry) => entry.state === "project-only");
  if (added.length === 0) {
    log.info(
      projectOnly.length === 0
        ? "This project has nothing to remove."
        : `Nothing here came from my collection. ${countPhrase(projectOnly)} exist only in this project, so they are not listed. Copy them into my collection first, from Review differences.`,
    );
    return;
  }
  if (projectOnly.length > 0) {
    log.info(
      `${countPhrase(projectOnly)} exist only in this project and are not listed. Copy them into my collection first, from Review differences.`,
    );
  }
  const chosen = await multiselect({
    message: "Choose what to remove from this project. Space selects, enter confirms",
    options: added.map((entry, index) => ({
      value: index,
      label: `${stateGlyph(entry.state)} ${entry.name}  (${entry.kind})`,
      hint:
        entry.state === "differs"
          ? "deleting also deletes the local changes"
          : "matches my collection",
    })),
    maxItems: 12,
    required: false,
  });
  if (isCancel(chosen) || chosen.length === 0) return;
  const removed = chosen.flatMap((index) => {
    const entry = added[index];
    if (entry === undefined) return [];
    removeAssetFromProject({ projectDir, kind: entry.kind, name: entry.name });
    return [entry];
  });
  log.info(`Removed ${countPhrase(removed)}.`);
  renderStatus();
}

async function runResolve(): Promise<void> {
  while (true) {
    const actionable = projectStatus({ collectionRoot, projectDir }).filter(
      (entry) => entry.state === "differs" || entry.state === "project-only",
    );
    if (actionable.length === 0) {
      log.info("Nothing to resolve. Everything here matches my collection.");
      return;
    }
    const index = await select({
      message: "Resolve which one?",
      options: [
        ...actionable.map((entry, i) => ({
          value: i,
          label: `${stateGlyph(entry.state)} ${entry.name}  (${entry.kind}, ${
            "asset" in entry ? ownerLabel(entry.asset.owner) : stateNames["project-only"]
          })`,
        })),
        { value: -1, label: "Back" },
      ],
    });
    if (isCancel(index) || index === -1) return;
    const entry = actionable[index];
    if (entry === undefined) continue;
    if (entry.state === "differs") await resolveDiffers(entry);
    else if (entry.state === "project-only") await resolveProjectOnly(entry);
  }
}

async function resolveDiffers(entry: StatusEntry & { state: "differs" }): Promise<void> {
  showDiff(entry.asset.path, entry.projectPath);
  const mine = entry.asset.owner.kind === "mine";
  const action = await select({
    message: `${entry.name}: which version do you keep?`,
    options: [
      {
        value: "overwrite",
        label: "Use the version from my collection",
        hint: "overwrites the project copy",
      },
      mine
        ? { value: "write-back", label: "Keep the project version", hint: "copies it back into my collection" }
        : {
            value: "fork",
            label: "Keep the project version",
            hint: `copies it into my collection. The ${ownerLabel(entry.asset.owner)} copy stays as it is`,
          },
      { value: "skip", label: "Skip" },
    ],
  });
  if (isCancel(action) || action === "skip") return;
  if (action === "overwrite") {
    addAssetToProject({ projectDir, asset: entry.asset });
    log.info(`${entry.name}: the project copy now matches my collection.`);
  } else if (action === "write-back") {
    writeBackToCollection({ asset: entry.asset, projectPath: entry.projectPath });
    log.info(`${entry.name}: my collection now matches the project copy.`);
  } else if (action === "fork") {
    adoptIntoMine({ collectionRoot, kind: entry.kind, name: entry.name, projectPath: entry.projectPath });
    log.info(`${entry.name}: copied into my collection. The project now tracks that copy.`);
  }
}

async function resolveProjectOnly(entry: StatusEntry & { state: "project-only" }): Promise<void> {
  const action = await select({
    message: `${entry.name} exists only in this project`,
    options: [
      { value: "adopt", label: "Copy into my collection", hint: "other projects can then add it" },
      { value: "skip", label: "Skip" },
    ],
  });
  if (isCancel(action) || action === "skip") return;
  adoptIntoMine({ collectionRoot, kind: entry.kind, name: entry.name, projectPath: entry.projectPath });
  log.info(`${entry.name}: copied into my collection.`);
}

function showDiff(collectionPath: string, projectPath: string): void {
  const plain = diffPaths({ collectionPath, projectPath });
  if (plain === "") {
    log.info("The files are identical.");
    return;
  }
  try {
    const result = spawnSync("hunk", [], { input: plain, stdio: ["pipe", "inherit", "inherit"] });
    if (result.status === 0) return;
  } catch {
  }
  process.stdout.write(diffPaths({ collectionPath, projectPath, color: process.stdout.isTTY === true }));
}

function renderStatus(): void {
  const entries = projectStatus({ collectionRoot, projectDir }).filter((entry) => entry.state !== "collection-only");
  if (entries.length === 0) {
    log.info("This project has no skills or agents yet. Choose Add to project.");
    return;
  }
  renderEntries(entries);
}

function renderAllAssets(): void {
  const entries = projectStatus({ collectionRoot, projectDir });
  if (entries.length === 0) {
    log.info("Nothing to show. My collection and this project are both empty.");
    return;
  }
  renderEntries(entries);
}

function renderEntries(entries: StatusEntry[]): void {
  const groups = new Map<string, StatusEntry[]>();
  for (const entry of entries) {
    const label = "asset" in entry ? ownerLabel(entry.asset.owner) : "this project";
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  const groupRank = (label: string) => (label === MY_COLLECTION ? 0 : label === "this project" ? 1 : 2);
  const lines = [...groups]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(
      ([label, group]) =>
        `${label}\n` +
        group.map((entry) => `  ${stateGlyph(entry.state)} ${kindSymbols[entry.kind]}  ${entry.name}`).join("\n"),
    );
  log.message(lines.join("\n\n"));
  log.info(legend(entries));
}

function sourceHint(candidates: { state: AssetSyncState }[]): string {
  const outOfSync = candidates.filter((candidate) => candidate.state === "differs").length;
  const fresh = candidates.length - outOfSync;
  return [
    ...(fresh === 0 ? [] : [`${fresh} new`]),
    ...(outOfSync === 0 ? [] : [`${outOfSync} out of sync`]),
  ].join(", ");
}

function countPhrase(items: { kind: AssetKind }[]): string {
  const skills = items.filter((item) => item.kind === "skill").length;
  const agents = items.length - skills;
  return [
    ...(skills === 0 ? [] : [counted("skill", skills)]),
    ...(agents === 0 ? [] : [counted("agent", agents)]),
  ].join(" and ");
}

function counted(kind: AssetKind, count: number): string {
  return `${count} ${count === 1 ? kind : `${kind}s`}`;
}

function stateGlyph(state: StatusEntry["state"]): string {
  const { symbol, ansi } = stateSymbols[state];
  return process.stdout.isTTY === true ? `\x1b[${ansi}m${symbol}\x1b[0m` : symbol;
}

function legend(entries: StatusEntry[]): string {
  const stateCounts = new Map<StatusEntry["state"], number>();
  const kindCounts = new Map<AssetKind, number>();
  for (const entry of entries) {
    stateCounts.set(entry.state, (stateCounts.get(entry.state) ?? 0) + 1);
    kindCounts.set(entry.kind, (kindCounts.get(entry.kind) ?? 0) + 1);
  }
  return [
    ...[...stateCounts].map(([state, count]) => `${stateGlyph(state)} ${count} ${stateNames[state]}`),
    ...[...kindCounts].map(([kind, count]) => `${kindSymbols[kind]} ${counted(kind, count)}`),
  ].join("   ");
}

function ownerLabel(owner: Owner): string {
  return owner.kind === "mine" ? MY_COLLECTION : owner.source;
}

function reportLicense(name: string, license: LicenseInfo): void {
  if (license.kind === "found") {
    log.info(`License: ${license.summary} (${license.file})`);
  } else {
    log.warn(`${name} ships no license file. It is tracked anyway, so attribution is on you.`);
  }
}
