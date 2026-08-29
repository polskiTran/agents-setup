#!/usr/bin/env node
import { confirm, intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";

import { findCollectionRoot } from "./ops/collection-root.ts";
import { addSource, listSources, parseUpstreamUrl, pullSource, readSources, type LicenseInfo } from "./ops/sources.ts";
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

const addableDisplay: Record<Exclude<AssetSyncState, "in-sync">, { prefix: string; hint?: string }> = {
  absent: { prefix: "  " },
  differs: { prefix: `${stateGlyph("differs")} `, hint: "project copy differs \u2014 adding overwrites it" },
};

const nfFaBook = "\uf02d";
const nfFaUsers = "\uf0c0";
const kindSymbols: Record<AssetKind, string> = { skill: nfFaBook, agent: nfFaUsers };

intro("polskills");
log.info(`Collection  ${collectionRoot}`);
log.info(`Project     ${projectDir}`);
renderStatus();

if (!process.stdin.isTTY) {
  outro("The menu needs an interactive terminal — run polskills directly in one.");
  process.exit(0);
}

while (true) {
  const action = await select({
    message: "Actions:",
    options: [
      { value: "status", label: "Project status", hint: "sync view of this project's assets" },
      { value: "all-assets", label: "Show all assets", hint: "status including collection-only assets" },
      { value: "resolve", label: "Diff & resolve", hint: "handle differing and project-only assets" },
      { value: "add-assets", label: "Add assets", hint: "provision skills/agents into this project" },
      { value: "remove-assets", label: "Remove assets", hint: "delete provisioned assets from this project" },
      { value: "init", label: "Init project", hint: ".agents/ areas + .claude symlinks" },
      { value: "add-upstream", label: "Add upstream", hint: "vendor a skills repo by URL" },
      { value: "pull-upstream", label: "Pull upstream", hint: "review and apply upstream changes" },
      { value: "list-sources", label: "List sources", hint: "vendored upstreams and licenses" },
      { value: "exit", label: "Exit" },
    ],
  });
  if (isCancel(action) || action === "exit") break;
  if (action === "status") renderStatus();
  if (action === "all-assets") renderAllAssets();
  if (action === "resolve") await runResolve();
  if (action === "add-assets") await runAddAssets();
  if (action === "remove-assets") await runRemoveAssets();
  if (action === "init") runInit();
  if (action === "add-upstream") await runAddUpstream();
  if (action === "pull-upstream") await runPullUpstream();
  if (action === "list-sources") runListSources();
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
    message: "Subpath to vendor (leave empty for the whole repo)",
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
    progress.stop(`Vendored ${added.source.name} @ ${added.source.sha.slice(0, 7)}`);
    reportLicense(added.source.name, added.license);
  } catch (error) {
    progress.stop("Add failed", 1);
    log.error(error instanceof Error ? error.message : String(error));
  }
}

async function runPullUpstream(): Promise<void> {
  const sources = readSources(collectionRoot);
  if (sources.length === 0) {
    log.info("No sources vendored yet.");
    return;
  }
  const name = await select({
    message: "Pull which source?",
    options: sources.map((source) => ({ value: source.name, label: `${source.name}  @ ${source.sha.slice(0, 7)}` })),
  });
  if (isCancel(name)) return;

  const progress = spinner();
  progress.start(`Fetching ${name}`);
  let preview;
  try {
    preview = pullSource({ collectionRoot, name });
  } catch (error) {
    progress.stop("Pull failed", 1);
    log.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (preview.kind === "up-to-date") {
    progress.stop(`${name} is already up to date @ ${preview.source.sha.slice(0, 7)}`);
    return;
  }
  progress.stop(`${name}: ${preview.source.sha.slice(0, 7)} → ${preview.upstreamSha.slice(0, 7)}`);
  if (preview.diff === "") {
    log.info("No content changes — applying only bumps the pinned sha.");
  } else {
    showDiff(preview.vendorDir, preview.contentRoot);
  }
  const approved = await confirm({ message: `Apply this update to ${name}?` });
  if (isCancel(approved) || !approved) {
    preview.discard();
    log.info("Declined — nothing changed.");
    return;
  }
  const updated = preview.apply();
  log.info(`${name} updated to ${updated.sha.slice(0, 7)}.`);
}

function runListSources(): void {
  const entries = listSources(collectionRoot);
  if (entries.length === 0) {
    log.info("No sources vendored yet.");
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
      log.warn(`${link} already exists and is not the expected symlink — left untouched`);
    } else {
      log.info(`${link}: ${outcome}`);
    }
  }
}

async function runAddAssets(): Promise<void> {
  const assets = discoverCollectionAssets(collectionRoot);
  if (assets.length === 0) {
    log.info("The collection has no assets yet — add an upstream or write a skill first.");
    return;
  }
  const states = collectionAssetStates({ projectDir, assets });
  const addable = assets.flatMap((asset) => {
    const state = states.get(asset);
    return state === undefined || state === "in-sync" ? [] : [{ asset, state }];
  });
  if (addable.length === 0) {
    log.info("Every collection asset is already provisioned here and identical — nothing to add.");
    return;
  }
  const bySource = new Map<string, typeof addable>();
  for (const candidate of addable) {
    const label = ownerLabel(candidate.asset.owner);
    bySource.set(label, [...(bySource.get(label) ?? []), candidate]);
  }

  while (true) {
    const source = await select({
      message: "Add assets from which source?",
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
      log.info(`${stateGlyph("differs")} ${addableDisplay.differs.hint}`);
    }
    const chosen = await multiselect<CollectionAsset>({
      message: `Assets to add from ${source} (space to toggle, enter to confirm)`,
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
    log.info(`Added ${chosen.length} asset(s) from ${source}.`);
    renderStatus();
    return;
  }
}

async function runRemoveAssets(): Promise<void> {
  const entries = projectStatus({ collectionRoot, projectDir });
  const provisioned = entries.filter((entry) => entry.state === "in-sync" || entry.state === "differs");
  const projectOnly = entries.filter((entry) => entry.state === "project-only").length;
  if (provisioned.length === 0) {
    log.info(
      projectOnly === 0
        ? "Nothing is provisioned in this project."
        : `Nothing from the collection is provisioned here — ${projectOnly} project-only asset(s) hidden; adopt them via Diff & resolve to manage them.`,
    );
    return;
  }
  if (projectOnly > 0) {
    log.info(`${projectOnly} project-only asset(s) hidden — adopt them via Diff & resolve first.`);
  }
  const chosen = await multiselect({
    message: "Assets to remove from this project",
    options: provisioned.map((entry, index) => ({
      value: index,
      label: `${stateGlyph(entry.state)} ${entry.name}  (${entry.kind})`,
      hint: entry.state === "differs" ? "project copy differs — local edits go with it" : "identical to the collection",
    })),
    maxItems: 12,
    required: false,
  });
  if (isCancel(chosen) || chosen.length === 0) return;
  for (const index of chosen) {
    const entry = provisioned[index];
    if (entry !== undefined) removeAssetFromProject({ projectDir, kind: entry.kind, name: entry.name });
  }
  log.info(`Removed ${chosen.length} asset(s).`);
  renderStatus();
}

async function runResolve(): Promise<void> {
  while (true) {
    const actionable = projectStatus({ collectionRoot, projectDir }).filter(
      (entry) => entry.state === "differs" || entry.state === "project-only",
    );
    if (actionable.length === 0) {
      log.info("Nothing to resolve — no differing or project-only assets.");
      return;
    }
    const index = await select({
      message: "Resolve which asset?",
      options: [
        ...actionable.map((entry, i) => ({
          value: i,
          label: `${entry.name}  (${entry.kind}, ${entry.state}${
            "asset" in entry ? `, ${ownerLabel(entry.asset.owner)}` : ""
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
    message: `${entry.name}: which version wins?`,
    options: [
      { value: "overwrite", label: `Use collection version`, hint: "overwrite the project copy" },
      mine
        ? { value: "write-back", label: "Keep project version", hint: "write back into my collection" }
        : { value: "fork", label: "Keep project version", hint: `fork to mine — ${ownerLabel(entry.asset.owner)}'s copy stays untouched` },
      { value: "skip", label: "Skip" },
    ],
  });
  if (isCancel(action) || action === "skip") return;
  if (action === "overwrite") {
    addAssetToProject({ projectDir, asset: entry.asset });
    log.info(`${entry.name}: project copy replaced with the collection version.`);
  } else if (action === "write-back") {
    writeBackToCollection({ asset: entry.asset, projectPath: entry.projectPath });
    log.info(`${entry.name}: my collection copy now matches the project.`);
  } else if (action === "fork") {
    adoptIntoMine({ collectionRoot, kind: entry.kind, name: entry.name, projectPath: entry.projectPath });
    log.info(`${entry.name}: forked into my collection; the project now tracks your fork.`);
  }
}

async function resolveProjectOnly(entry: StatusEntry & { state: "project-only" }): Promise<void> {
  const action = await select({
    message: `${entry.name} exists only in this project`,
    options: [
      { value: "adopt", label: "Adopt into my collection", hint: "make it reusable everywhere" },
      { value: "skip", label: "Skip" },
    ],
  });
  if (isCancel(action) || action === "skip") return;
  adoptIntoMine({ collectionRoot, kind: entry.kind, name: entry.name, projectPath: entry.projectPath });
  log.info(`${entry.name}: adopted into my collection.`);
}

function showDiff(collectionPath: string, projectPath: string): void {
  const plain = diffPaths({ collectionPath, projectPath });
  if (plain === "") {
    log.info("No content difference.");
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
    log.info("Nothing provisioned in this project yet — use Add assets to get started.");
    return;
  }
  renderEntries(entries);
}

function renderAllAssets(): void {
  const entries = projectStatus({ collectionRoot, projectDir });
  if (entries.length === 0) {
    log.info("Nothing to show yet — the collection and this project have no assets.");
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
  const groupRank = (label: string) => (label === "mine" ? 0 : label === "this project" ? 1 : 2);
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
  const differs = candidates.filter((candidate) => candidate.state === "differs").length;
  const addable = `${candidates.length} addable`;
  return differs === 0 ? addable : `${addable} · ${differs} differ(s)`;
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
    ...[...stateCounts].map(([state, count]) => `${stateGlyph(state)} ${count} ${state}`),
    ...[...kindCounts].map(([kind, count]) => `${kindSymbols[kind]} ${count} ${kind}`),
  ].join("   ");
}

function ownerLabel(owner: Owner): string {
  return owner.kind === "mine" ? "mine" : owner.source;
}

function reportLicense(name: string, license: LicenseInfo): void {
  if (license.kind === "found") {
    log.info(`License: ${license.summary} (${license.file})`);
  } else {
    log.warn(`${name} ships no license file — vendored anyway, attribution is on you`);
  }
}
