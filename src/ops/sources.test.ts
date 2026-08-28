import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { addSource, listSources, parseUpstreamUrl, readSources } from "./sources.ts";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A local git repo usable as an upstream URL: committed files, real HEAD sha. */
function fixtureRepo(files: Record<string, string>): { url: string; sha: string } {
  const dir = tempDir("polskills-upstream-");
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe", encoding: "utf8" });
  git("init");
  git("add", "-A");
  git("-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", "init");
  return { url: dir, sha: git("rev-parse", "HEAD").trim() };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("vendors a whole repo: stripped copy, pinned sha, license surfaced", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "LICENSE": "MIT License\n\nPermission is hereby granted...",
    "tdd/SKILL.md": "# tdd",
  });

  const added = addSource({ collectionRoot: collection, url: upstream.url });

  expect(readFileSync(path.join(added.vendorDir, "tdd", "SKILL.md"), "utf8")).toBe("# tdd");
  expect(existsSync(path.join(added.vendorDir, ".git"))).toBe(false);
  expect(added.source.sha).toBe(upstream.sha);
  expect(added.license).toEqual({ kind: "found", file: "LICENSE", summary: "MIT License" });
  expect(readSources(collection)).toEqual([added.source]);
});

test("vendors only the subpath subtree and copies the repo-root license in", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "LICENSE": "Apache License 2.0",
    "pstack/uv/SKILL.md": "# uv",
    "unrelated/README.md": "not vendored",
  });

  const added = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });

  expect(existsSync(path.join(added.vendorDir, "uv", "SKILL.md"))).toBe(true);
  expect(existsSync(path.join(added.vendorDir, "unrelated"))).toBe(false);
  expect(added.license).toEqual({ kind: "found", file: "LICENSE", summary: "Apache License 2.0" });
  expect(readSources(collection)[0]?.subpath).toBe("pstack");
});

test("a subpath that is not a directory in the upstream fails without recording anything", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "README.md": "hi" });

  expect(() =>
    addSource({ collectionRoot: collection, url: upstream.url, subpath: "missing" }),
  ).toThrow(/not a directory/);
  expect(readSources(collection)).toEqual([]);
});

test("adding an already-vendored source throws", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "SKILL.md": "# solo" });

  addSource({ collectionRoot: collection, url: upstream.url });
  expect(() => addSource({ collectionRoot: collection, url: upstream.url })).toThrow(
    /already vendored/,
  );
});

test("a source without a license lists as missing, not as an error", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "tdd/SKILL.md": "# tdd" });

  addSource({ collectionRoot: collection, url: upstream.url });

  const [entry] = listSources(collection);
  expect(entry?.license).toEqual({ kind: "missing" });
});

test("parseUpstreamUrl splits a GitHub tree link into repo URL and subpath", () => {
  expect(parseUpstreamUrl("https://github.com/cursor/plugins/tree/main/pstack")).toEqual({
    url: "https://github.com/cursor/plugins",
    subpath: "pstack",
  });
  expect(parseUpstreamUrl("https://github.com/mattpocock/skills ")).toEqual({
    url: "https://github.com/mattpocock/skills",
  });
});
