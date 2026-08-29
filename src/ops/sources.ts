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

import { diffPaths } from "./sync.ts";

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

export function parseUpstreamUrl(input: string): { url: string; subpath?: string } {
  const trimmed = input.trim().replace(/\/+$/, "");
  const tree = trimmed.match(/^(?<base>https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/[^/]+\/(?<subpath>.+)$/);
  if (tree?.groups?.base !== undefined && tree.groups.subpath !== undefined) {
    return { url: tree.groups.base, subpath: tree.groups.subpath };
  }
  return { url: trimmed };
}

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
    const contentRoot = materializeContent(checkout, url, subpath);
    carryRepoLicenseInto(checkout, contentRoot);

    const vendorDir = path.join(collectionRoot, "vendor", name);
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
  const vendorDir = path.join(collectionRoot, "vendor", name);

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
    carryRepoLicenseInto(checkout, contentRoot);
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

function carryRepoLicenseInto(checkout: string, contentRoot: string): void {
  if (contentRoot === checkout || findLicense(contentRoot).kind !== "missing") return;
  const license = findLicense(checkout);
  if (license.kind === "found") {
    cpSync(path.join(checkout, license.file), path.join(contentRoot, license.file));
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
