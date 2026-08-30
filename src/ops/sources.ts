import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { diffPaths } from "./sync.ts";

export type Source = {
  /**
   * Identity and vendor/ location of the source: `owner/repo` for a whole repo,
   * `owner/repo/<subpath>` for a subtree. Derived from url + subpath, never stored,
   * so the recorded name can never drift from where the files actually live.
   */
  name: string;
  url: string;
  subpath?: string;
  sha: string;
};

/** What sources.json holds. The name is derived on read. */
type StoredSource = Omit<Source, "name">;

export type LicenseInfo =
  | { kind: "found"; file: string; summary: string }
  | { kind: "missing" };

export type AddedSource = { source: Source; vendorDir: string; license: LicenseInfo };

const SOURCES_FILE = "sources.json";

export function parseUpstreamUrl(input: string): { url: string; subpath?: string } {
  const trimmed = input.trim().replace(/\/+$/, "");
  const tree = trimmed.match(/^(?<base>https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/[^/]+\/(?<subpath>.+)$/);
  if (tree?.groups?.base !== undefined && tree.groups.subpath !== undefined) {
    return { url: tree.groups.base, subpath: tree.groups.subpath };
  }
  return { url: trimmed };
}

export function addSource(args: { collectionRoot: string; url: string; subpath?: string }): AddedSource {
  const { collectionRoot, url } = args;
  const subpath = normalizeSubpath(args.subpath);
  const name = sourceName(url, subpath);
  const sources = readSources(collectionRoot);
  rejectOverlap(sources, name);

  const checkout = mkdtempSync(path.join(tmpdir(), "polskills-clone-"));
  try {
    git(["clone", "--depth", "1", url, checkout]);
    const sha = git(["-C", checkout, "rev-parse", "HEAD"]).trim();
    const contentRoot = materializeContent(checkout, url, subpath);
    carryNearestLicenseInto(checkout, contentRoot);

    const vendorDir = vendorDirOf(collectionRoot, name);
    rmSync(vendorDir, { recursive: true, force: true });
    mkdirSync(path.dirname(vendorDir), { recursive: true });
    cpSync(contentRoot, vendorDir, { recursive: true });

    const source: Source = { name, url, sha, ...(subpath === undefined ? {} : { subpath }) };
    writeSources(collectionRoot, [...sources, source]);
    return { source, vendorDir, license: findLicense(vendorDir) };
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

/**
 * Two sources may share a repo, but not a vendor subtree: one nested inside the other
 * would mean vendoring the same files twice, under two pinned commits.
 */
function rejectOverlap(sources: Source[], name: string): void {
  for (const source of sources) {
    if (source.name === name) {
      throw new Error(`Source ${name} is already vendored — use pull to update it`);
    }
    if (name.startsWith(`${source.name}/`)) {
      throw new Error(`${name} already sits inside the vendored ${source.name} — pull ${source.name} instead`);
    }
    if (source.name.startsWith(`${name}/`)) {
      throw new Error(`${name} would contain the vendored ${source.name} — remove ${source.name} first`);
    }
  }
}

export type RemovedSource = { source: Source; vendorDir: string };

/** Stops tracking a source: its vendored tree goes, project copies of its assets stay. */
export function removeSource(args: { collectionRoot: string; name: string }): RemovedSource {
  const { collectionRoot, name } = args;
  const sources = readSources(collectionRoot);
  const source = sources.find((entry) => entry.name === name);
  if (source === undefined) {
    throw new Error(`Unknown source "${name}" — it is not recorded in sources.json`);
  }

  const vendorDir = vendorDirOf(collectionRoot, name);
  rmSync(vendorDir, { recursive: true, force: true });
  pruneEmptyDirsUpTo(path.dirname(vendorDir), path.join(collectionRoot, "vendor"));
  writeSources(
    collectionRoot,
    sources.filter((entry) => entry !== source),
  );
  return { source, vendorDir };
}

/** Removing a subtree leaves the owner and repo directories that only held it. */
function pruneEmptyDirsUpTo(dir: string, vendorRoot: string): void {
  for (let current = dir; current.startsWith(vendorRoot + path.sep); current = path.dirname(current)) {
    if (!existsSync(current) || readdirSync(current).length > 0) return;
    rmdirSync(current);
  }
}

export type PullPreview =
  | { kind: "up-to-date"; source: Source }
  | {
      kind: "changed";
      source: Source;
      upstreamSha: string;
      diff: string;
      vendorDir: string;
      contentRoot: string;
      apply: () => Source;
      discard: () => void;
    };

export function pullSource(args: { collectionRoot: string; name: string }): PullPreview {
  const { collectionRoot, name } = args;
  const source = readSources(collectionRoot).find((entry) => entry.name === name);
  if (source === undefined) {
    throw new Error(`Unknown source "${name}" — it is not recorded in sources.json`);
  }
  const vendorDir = vendorDirOf(collectionRoot, name);

  const checkout = mkdtempSync(path.join(tmpdir(), "polskills-pull-"));
  const discard = (): void => rmSync(checkout, { recursive: true, force: true });
  try {
    try {
      git(["clone", "--depth", "1", source.url, checkout]);
    } catch (error) {
      throw new Error(`Cannot reach upstream ${source.url} — vendored copy left untouched (${errorDetail(error)})`);
    }
    const upstreamSha = git(["-C", checkout, "rev-parse", "HEAD"]).trim();
    if (upstreamSha === source.sha) {
      discard();
      return { kind: "up-to-date", source };
    }
    const contentRoot = materializeContent(checkout, source.url, source.subpath);
    carryNearestLicenseInto(checkout, contentRoot);
    const diff = diffPaths({ collectionPath: vendorDir, projectPath: contentRoot });
    return {
      kind: "changed",
      source,
      upstreamSha,
      diff,
      vendorDir,
      contentRoot,
      apply: () => {
        rmSync(vendorDir, { recursive: true, force: true });
        mkdirSync(path.dirname(vendorDir), { recursive: true });
        cpSync(contentRoot, vendorDir, { recursive: true });
        const updated: Source = { ...source, sha: upstreamSha };
        writeSources(
          collectionRoot,
          readSources(collectionRoot).map((entry) => (entry.name === name ? updated : entry)),
        );
        discard();
        return updated;
      },
      discard,
    };
  } catch (error) {
    discard();
    throw error;
  }
}

function materializeContent(checkout: string, url: string, subpath: string | undefined): string {
  let contentRoot = checkout;
  if (subpath !== undefined) {
    contentRoot = path.resolve(checkout, subpath);
    const inCheckout = contentRoot.startsWith(checkout + path.sep);
    if (!inCheckout || !existsSync(contentRoot) || !statSync(contentRoot).isDirectory()) {
      throw new Error(`Subpath "${subpath}" is not a directory inside ${url}`);
    }
  }
  rmSync(path.join(checkout, ".git"), { recursive: true, force: true });
  return contentRoot;
}

/**
 * A vendored subtree rarely carries a license of its own — the nearest one above it governs it,
 * whether that is the plugin directory it belongs to or the repo root.
 */
function carryNearestLicenseInto(checkout: string, contentRoot: string): void {
  if (findLicense(contentRoot).kind !== "missing") return;
  for (let dir = path.dirname(contentRoot); dir.startsWith(checkout); dir = path.dirname(dir)) {
    const license = findLicense(dir);
    if (license.kind === "found") {
      cpSync(path.join(dir, license.file), path.join(contentRoot, license.file));
      return;
    }
    if (dir === checkout) return;
  }
}

function errorDetail(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim() !== ""
  ) {
    return error.stderr.trim().split("\n").at(-1) ?? "";
  }
  return error instanceof Error ? error.message : String(error);
}

export function listSources(collectionRoot: string): { source: Source; license: LicenseInfo }[] {
  return readSources(collectionRoot).map((source) => ({
    source,
    license: findLicense(vendorDirOf(collectionRoot, source.name)),
  }));
}

export function vendorDirOf(collectionRoot: string, name: string): string {
  return path.join(collectionRoot, "vendor", ...name.split("/"));
}

export function readSources(collectionRoot: string): Source[] {
  const file = path.join(collectionRoot, SOURCES_FILE);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isStoredSource)) {
    throw new Error(`${file} is malformed — fix or delete it before continuing`);
  }
  return parsed.map(({ url, subpath, sha }) => ({
    name: sourceName(url, subpath),
    url,
    ...(subpath === undefined ? {} : { subpath }),
    sha,
  }));
}

function writeSources(collectionRoot: string, sources: Source[]): void {
  const stored: StoredSource[] = sources.map(({ url, subpath, sha }) => ({
    url,
    ...(subpath === undefined ? {} : { subpath }),
    sha,
  }));
  writeFileSync(path.join(collectionRoot, SOURCES_FILE), `${JSON.stringify(stored, null, 2)}\n`);
}

function isStoredSource(value: unknown): value is StoredSource {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "sha" in value &&
    typeof value.sha === "string" &&
    (!("subpath" in value) || typeof value.subpath === "string")
  );
}

function sourceName(url: string, subpath: string | undefined): string {
  const segments = url
    .replace(/\.git$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.endsWith(":"));
  const repo = segments.at(-1);
  const owner = segments.at(-2);
  if (repo === undefined || owner === undefined) {
    throw new Error(`Cannot derive an owner/repo name from "${url}"`);
  }
  return subpath === undefined ? `${owner}/${repo}` : `${owner}/${repo}/${subpath}`;
}

/** Subpaths are relative and slash-separated, so that they compose into a source name. */
function normalizeSubpath(subpath: string | undefined): string | undefined {
  if (subpath === undefined) return undefined;
  const segments = subpath.split(/[/\\]+/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return undefined;
  if (segments.includes("..")) {
    throw new Error(`Subpath "${subpath}" must stay inside the repo`);
  }
  return segments.join("/");
}

function findLicense(dir: string): LicenseInfo {
  if (!existsSync(dir)) return { kind: "missing" };
  const file = readdirSync(dir).find(
    (entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry) && statSync(path.join(dir, entry)).isFile(),
  );
  if (file === undefined) return { kind: "missing" };
  const firstLine = readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return { kind: "found", file, summary: (firstLine ?? "").slice(0, 80) };
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
}
