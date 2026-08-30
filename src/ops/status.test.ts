import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { discoverCollectionAssets } from "./catalog.ts";
import { collectionAssetStates, projectStatus } from "./status.ts";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): string {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

/** A vendored tree is only part of the collection when sources.json records it. */
function sourcesJson(...names: string[]): string {
  return JSON.stringify(names.map((name) => ({ url: `https://github.com/${name}`, sha: "0".repeat(40) })));
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("an identical project copy is in-sync, attributed to its owner", () => {
  const collection = writeTree(tempDir("col-"), { "skills/tdd/SKILL.md": "# tdd" });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd" });

  const [entry] = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entry).toMatchObject({ state: "in-sync", kind: "skill", name: "tdd", asset: { owner: { kind: "mine" } } });
});

test("a skill differs when any file's content or the file set changed", () => {
  const collection = writeTree(tempDir("col-"), { "skills/tdd/SKILL.md": "# tdd" });
  const edited = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd v2" });
  const extraFile = writeTree(tempDir("proj-"), {
    ".agents/skills/tdd/SKILL.md": "# tdd",
    ".agents/skills/tdd/notes.md": "local addition",
  });

  expect(projectStatus({ collectionRoot: collection, projectDir: edited })[0]?.state).toBe("differs");
  expect(projectStatus({ collectionRoot: collection, projectDir: extraFile })[0]?.state).toBe("differs");
});

test("a project asset unknown to the collection is project-only", () => {
  const collection = tempDir("col-");
  const project = writeTree(tempDir("proj-"), { ".agents/agents/helper.md": "# helper" });

  const [entry] = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entry).toMatchObject({ state: "project-only", kind: "agent", name: "helper" });
});

test("a project skill needs no SKILL.md — malformed skill dirs still surface", () => {
  const collection = tempDir("col-");
  const project = writeTree(tempDir("proj-"), { ".agents/skills/broken/notes.md": "no SKILL.md here" });

  const [entry] = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entry).toMatchObject({ state: "project-only", kind: "skill", name: "broken" });
});

test("a project without .agents/ is all collection-only, not an error", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "skills/tdd/SKILL.md": "# tdd",
    "vendor/matt/skills/uv/SKILL.md": "# uv",
    "agents/reviewer.md": "# reviewer",
  });
  const project = tempDir("proj-");

  const entries = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entries).toHaveLength(3);
  expect(entries.every((entry) => entry.state === "collection-only")).toBe(true);
});

test("with duplicate names across owners, an exact content match wins the attribution", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "skills/uv/SKILL.md": "# uv, my edited fork",
    "vendor/matt/skills/uv/SKILL.md": "# uv upstream",
  });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/uv/SKILL.md": "# uv upstream" });

  const [entry] = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entry).toMatchObject({ state: "in-sync", asset: { owner: { kind: "vendor", source: "matt/skills" } } });
});

test("add-menu states judge each owner's copy separately against the project", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "skills/uv/SKILL.md": "# uv, my edited fork",
    "vendor/matt/skills/uv/SKILL.md": "# uv upstream",
    "vendor/matt/skills/tdd/SKILL.md": "# tdd",
  });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/uv/SKILL.md": "# uv upstream" });

  const assets = discoverCollectionAssets(collection);
  const states = collectionAssetStates({ projectDir: project, assets });
  expect(
    assets.map((asset) => [`${ownerLabel(asset)}:${asset.name}`, states.get(asset)]),
  ).toEqual([
    ["mine:uv", "differs"],
    ["matt/skills:tdd", "absent"],
    ["matt/skills:uv", "in-sync"],
  ]);
});

function ownerLabel(asset: { owner: { kind: "mine" } | { kind: "vendor"; source: string } }): string {
  return asset.owner.kind === "mine" ? "mine" : asset.owner.source;
}

test("two subtrees of one repo are separate owners, each rooted at its own vendor dir", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": JSON.stringify([
      { url: "https://github.com/cursor/plugins", subpath: "pstack", sha: "0".repeat(40) },
      { url: "https://github.com/cursor/plugins", subpath: "team-kit/skills", sha: "0".repeat(40) },
    ]),
    "vendor/cursor/plugins/pstack/uv/SKILL.md": "# uv",
    "vendor/cursor/plugins/team-kit/skills/tdd/SKILL.md": "# tdd",
  });

  const assets = discoverCollectionAssets(collection);
  expect(assets.map((asset) => `${ownerLabel(asset)}:${asset.name}`)).toEqual([
    "cursor/plugins/pstack:uv",
    "cursor/plugins/team-kit/skills:tdd",
  ]);
});

test("a broken symlink in vendored content is skipped, not a crash", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "vendor/matt/skills/tdd/SKILL.md": "# tdd",
  });
  symlinkSync("CLAUDE.md", path.join(collection, "vendor/matt/skills/AGENTS.md"));

  const entries = projectStatus({ collectionRoot: collection, projectDir: tempDir("proj-") });
  expect(entries.map((entry) => entry.name)).toEqual(["tdd"]);
});

test("catalog finds nested vendor skills and agents, but not skill internals", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "vendor/matt/skills/deep/nested/tdd/SKILL.md": "# tdd",
    "vendor/matt/skills/deep/nested/tdd/references/guide.md": "internals, not an agent",
    "vendor/matt/skills/agents/reviewer.md": "# reviewer",
  });

  const assets = discoverCollectionAssets(collection);
  expect(assets.map(({ kind, name }) => ({ kind, name }))).toEqual([
    { kind: "agent", name: "reviewer" },
    { kind: "skill", name: "tdd" },
  ]);
});
