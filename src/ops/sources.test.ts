import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { addSource, listSources, parseUpstreamUrl, pullSource, readSources } from "./sources.ts";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A local git repo usable as an upstream URL: committed files, real HEAD sha, and commit() to advance it. */
function fixtureRepo(files: Record<string, string>): {
  url: string;
  sha: string;
  commit: (files: Record<string, string>) => string;
} {
  const dir = tempDir("polskills-upstream-");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe", encoding: "utf8" });
  const commit = (more: Record<string, string>): string => {
    for (const [file, content] of Object.entries(more)) {
      mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    git("add", "-A");
    git("-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", "change");
    return git("rev-parse", "HEAD").trim();
  };
  git("init");
  const sha = commit(files);
  return { url: dir, sha, commit };
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

test("pull previews the upstream diff before writing, applies on approval, bumps the sha", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "tdd/SKILL.md": "# tdd v1" });
  const added = addSource({ collectionRoot: collection, url: upstream.url });
  const newSha = upstream.commit({ "tdd/SKILL.md": "# tdd v2" });

  const preview = pullSource({ collectionRoot: collection, name: added.source.name });
  if (preview.kind !== "changed") throw new Error("expected a changed preview");
  expect(preview.upstreamSha).toBe(newSha);
  expect(preview.diff).toContain("-# tdd v1");
  expect(preview.diff).toContain("+# tdd v2");
  // nothing written until apply
  expect(readFileSync(path.join(added.vendorDir, "tdd", "SKILL.md"), "utf8")).toBe("# tdd v1");
  expect(readSources(collection)[0]?.sha).toBe(upstream.sha);

  preview.apply();
  expect(readFileSync(path.join(added.vendorDir, "tdd", "SKILL.md"), "utf8")).toBe("# tdd v2");
  expect(readSources(collection)[0]?.sha).toBe(newSha);
});

test("declining a pull changes nothing, including the pinned sha", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "SKILL.md": "# v1" });
  const added = addSource({ collectionRoot: collection, url: upstream.url });
  upstream.commit({ "SKILL.md": "# v2" });

  const preview = pullSource({ collectionRoot: collection, name: added.source.name });
  if (preview.kind !== "changed") throw new Error("expected a changed preview");
  preview.discard();

  expect(readFileSync(path.join(added.vendorDir, "SKILL.md"), "utf8")).toBe("# v1");
  expect(readSources(collection)[0]?.sha).toBe(upstream.sha);
});

test("pulling an unchanged upstream reports up-to-date", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "SKILL.md": "# same" });
  const added = addSource({ collectionRoot: collection, url: upstream.url });

  expect(pullSource({ collectionRoot: collection, name: added.source.name }).kind).toBe("up-to-date");
});

test("a subpath source pulls only its subtree and keeps the copied-in license", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "LICENSE": "MIT License",
    "pstack/uv/SKILL.md": "# uv v1",
    "unrelated/README.md": "outside",
  });
  const added = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });
  upstream.commit({ "pstack/uv/SKILL.md": "# uv v2", "unrelated/README.md": "outside v2" });

  const preview = pullSource({ collectionRoot: collection, name: added.source.name });
  if (preview.kind !== "changed") throw new Error("expected a changed preview");
  expect(preview.diff).toContain("+# uv v2");
  expect(preview.diff).not.toContain("outside v2");
  preview.apply();

  expect(readFileSync(path.join(added.vendorDir, "uv", "SKILL.md"), "utf8")).toBe("# uv v2");
  expect(existsSync(path.join(added.vendorDir, "unrelated"))).toBe(false);
  expect(readFileSync(path.join(added.vendorDir, "LICENSE"), "utf8")).toBe("MIT License");
});

test("an unreachable upstream fails cleanly, leaving the vendored copy and sources.json intact", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "SKILL.md": "# v1" });
  const added = addSource({ collectionRoot: collection, url: upstream.url });
  rmSync(upstream.url, { recursive: true, force: true });

  expect(() => pullSource({ collectionRoot: collection, name: added.source.name })).toThrow(
    /Cannot reach upstream/,
  );
  expect(readFileSync(path.join(added.vendorDir, "SKILL.md"), "utf8")).toBe("# v1");
  expect(readSources(collection)).toEqual([added.source]);
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
