import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** One vendored upstream, as recorded in sources.json at the collection root. */
export type Source = {
  name: string;
  url: string;
  subpath?: string;
  sha: string;
};

export type LicenseInfo =
  | { kind: "found"; file: string; summary: string }
  | { kind: "missing" };

export type AddedSource = { source: Source; vendorDir: string; license: LicenseInfo };

const SOURCES_FILE = "sources.json";

/**
 * Splits a pasted upstream reference into a cloneable URL and an optional
 * subpath. GitHub tree links (https://github.com/o/r/tree/<ref>/<dir>) become
 * the repo URL plus that dir; anything else passes through untouched.
 */
export function parseUpstreamUrl(input: string): { url: string; subpath?: string } {
  const trimmed = input.trim().replace(/\/+$/, "");
  const tree = trimmed.match(/^(?<base>https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/[^/]+\/(?<subpath>.+)$/);
  if (tree?.groups?.base !== undefined && tree.groups.subpath !== undefined) {
    return { url: tree.groups.base, subpath: tree.groups.subpath };
  }
  return { url: trimmed };
}

/**
 * Vendors an upstream into the collection: shallow-clones it, strips .git,
 * keeps only `subpath` when given, copies the result into vendor/<name>/, and
 * records the pinned sha in sources.json. When a subpath is vendored, the
 * upstream's repo-root LICENSE is copied into the vendored dir so attribution
 * travels with the copy. Throws if the source is already vendored.
 */
export function addSource(args: { collectionRoot: string; url: string; subpath?: string }): AddedSource {
  const { collectionRoot, url, subpath } = args;
  const name = repoNameFrom(url);
  const sources = readSources(collectionRoot);
  if (sources.some((source) => source.name === name)) {
    throw new Error(`Source ${name} is already vendored — use pull to update it`);
  }

  const checkout = mkdtempSync(path.join(tmpdir(), "polskills-clone-"));
  try {
    git(["clone", "--depth", "1", url, checkout]);
    const sha = git(["-C", checkout, "rev-parse", "HEAD"]).trim();

    let contentRoot = checkout;
    if (subpath !== undefined) {
      contentRoot = path.resolve(checkout, subpath);
      const inCheckout = contentRoot.startsWith(checkout + path.sep);
      if (!inCheckout || !existsSync(contentRoot) || !statSync(contentRoot).isDirectory()) {
        throw new Error(`Subpath "${subpath}" is not a directory inside ${url}`);
      }
    }
    rmSync(path.join(checkout, ".git"), { recursive: true, force: true });

    const vendorDir = path.join(collectionRoot, "vendor", name);
    rmSync(vendorDir, { recursive: true, force: true });
    mkdirSync(path.dirname(vendorDir), { recursive: true });
    cpSync(contentRoot, vendorDir, { recursive: true });

    let license = findLicense(vendorDir);
    if (license.kind === "missing" && subpath !== undefined) {
      const repoRoot = findLicense(checkout);
      if (repoRoot.kind === "found") {
        cpSync(path.join(checkout, repoRoot.file), path.join(vendorDir, repoRoot.file));
        license = findLicense(vendorDir);
      }
    }

    const source: Source = { name, url, sha, ...(subpath === undefined ? {} : { subpath }) };
    writeSources(collectionRoot, [...sources, source]);
    return { source, vendorDir, license };
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

/** Every recorded source joined with the license found in its vendored copy. */
export function listSources(collectionRoot: string): { source: Source; license: LicenseInfo }[] {
  return readSources(collectionRoot).map((source) => ({
    source,
    license: findLicense(path.join(collectionRoot, "vendor", source.name)),
  }));
}

export function readSources(collectionRoot: string): Source[] {
  const file = path.join(collectionRoot, SOURCES_FILE);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isSource)) {
    throw new Error(`${file} is malformed — fix or delete it before continuing`);
  }
  return parsed;
}

function writeSources(collectionRoot: string, sources: Source[]): void {
  writeFileSync(path.join(collectionRoot, SOURCES_FILE), `${JSON.stringify(sources, null, 2)}\n`);
}

function isSource(value: unknown): value is Source {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "sha" in value &&
    typeof value.sha === "string" &&
    (!("subpath" in value) || typeof value.subpath === "string")
  );
}

/** "<owner>/<repo>" from the last two path segments of a URL or local path. */
function repoNameFrom(url: string): string {
  const segments = url
    .replace(/\.git$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.endsWith(":"));
  const repo = segments.at(-1);
  const owner = segments.at(-2);
  if (repo === undefined || owner === undefined) {
    throw new Error(`Cannot derive an owner/repo name from "${url}"`);
  }
  return `${owner}/${repo}`;
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
