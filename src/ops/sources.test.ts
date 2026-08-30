import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { addSource, listSources, parseUpstreamUrl, pullSource, readSources, removeSource } from "./sources.ts";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function fixtureRepo(files: Record<string, string>): {
  url: string;
  /** The owner/repo name addSource derives from the fixture's path. */
  repoName: string;
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
  return { url: dir, repoName: `${path.basename(path.dirname(dir))}/${path.basename(dir)}`, sha, commit };
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

test("a subtree takes the nearest license above it, not the repo root's", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "LICENSE": "MIT License",
    "team-kit/LICENSE": "Apache License 2.0",
    "team-kit/skills/tdd/SKILL.md": "# tdd",
  });

  const added = addSource({ collectionRoot: collection, url: upstream.url, subpath: "team-kit/skills" });

  expect(added.license).toEqual({ kind: "found", file: "LICENSE", summary: "Apache License 2.0" });
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

test("two subpaths of one repo vendor side by side, each pinned on its own", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "pstack/uv/SKILL.md": "# uv",
    "team-kit/skills/tdd/SKILL.md": "# tdd",
  });

  const first = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });
  const second = addSource({
    collectionRoot: collection,
    url: upstream.url,
    subpath: "team-kit/skills",
  });

  expect(first.source.name).toBe(`${upstream.repoName}/pstack`);
  expect(second.source.name).toBe(`${upstream.repoName}/team-kit/skills`);
  expect(readFileSync(path.join(first.vendorDir, "uv", "SKILL.md"), "utf8")).toBe("# uv");
  expect(readFileSync(path.join(second.vendorDir, "tdd", "SKILL.md"), "utf8")).toBe("# tdd");
  expect(readSources(collection)).toHaveLength(2);
});

test("a subpath nested in an already-vendored source is refused, and vice versa", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "pstack/uv/SKILL.md": "# uv" });

  addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });
  expect(() =>
    addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack/uv" }),
  ).toThrow(/already sits inside/);
  expect(() => addSource({ collectionRoot: collection, url: upstream.url })).toThrow(
    /would contain/,
  );
  expect(readSources(collection)).toHaveLength(1);
});

test("removing a source deletes its vendored tree and the directories that only held it", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({
    "pstack/uv/SKILL.md": "# uv",
    "team-kit/skills/tdd/SKILL.md": "# tdd",
  });
  const kept = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });
  const doomed = addSource({
    collectionRoot: collection,
    url: upstream.url,
    subpath: "team-kit/skills",
  });

  const removed = removeSource({ collectionRoot: collection, name: doomed.source.name });

  expect(removed.source).toEqual(doomed.source);
  expect(existsSync(doomed.vendorDir)).toBe(false);
  expect(existsSync(path.dirname(doomed.vendorDir))).toBe(false);
  expect(existsSync(kept.vendorDir)).toBe(true);
  expect(readSources(collection)).toEqual([kept.source]);
});

test("removing frees the name, so the same subtree can be vendored again", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "pstack/uv/SKILL.md": "# uv" });
  addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });

  removeSource({ collectionRoot: collection, name: `${upstream.repoName}/pstack` });
  const readded = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });

  expect(readFileSync(path.join(readded.vendorDir, "uv", "SKILL.md"), "utf8")).toBe("# uv");
  expect(readSources(collection)).toHaveLength(1);
});

test("removing an unknown source throws and leaves sources.json alone", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "SKILL.md": "# solo" });
  const added = addSource({ collectionRoot: collection, url: upstream.url });

  expect(() => removeSource({ collectionRoot: collection, name: "nobody/nothing" })).toThrow(/Unknown source/);
  expect(readSources(collection)).toEqual([added.source]);
});

test("a source name survives a hand-edited sources.json because it is derived", () => {
  const collection = tempDir("polskills-collection-");
  const upstream = fixtureRepo({ "pstack/uv/SKILL.md": "# uv" });
  const added = addSource({ collectionRoot: collection, url: upstream.url, subpath: "pstack" });

  writeFileSync(
    path.join(collection, "sources.json"),
    JSON.stringify([{ name: "stale/name", url: upstream.url, subpath: "pstack", sha: added.source.sha }]),
  );

  expect(readSources(collection)[0]?.name).toBe(added.source.name);
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
