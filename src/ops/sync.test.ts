import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { discoverCollectionAssets } from "./catalog.ts";
import { projectStatus } from "./status.ts";
import { adoptIntoMine, diffPaths, writeBackToCollection } from "./sync.ts";

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

test("diffPaths shows the change between collection and project copies, empty when identical", () => {
  const collection = writeTree(tempDir("col-"), { "skills/tdd/SKILL.md": "# tdd\nold line\n" });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd\nnew line\n" });
  const collectionPath = path.join(collection, "skills", "tdd");
  const projectPath = path.join(project, ".agents", "skills", "tdd");

  const diff = diffPaths({ collectionPath, projectPath });
  expect(diff).toContain("-old line");
  expect(diff).toContain("+new line");

  expect(diffPaths({ collectionPath, projectPath: collectionPath })).toBe("");
});

test("write-back updates my collection copy and the asset returns to in-sync", () => {
  const collection = writeTree(tempDir("col-"), { "skills/tdd/SKILL.md": "# tdd" });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd, edited in project" });
  const [asset] = discoverCollectionAssets(collection);
  if (asset === undefined) throw new Error("fixture broke");

  writeBackToCollection({ asset, projectPath: path.join(project, ".agents", "skills", "tdd") });

  expect(readFileSync(path.join(collection, "skills", "tdd", "SKILL.md"), "utf8")).toBe("# tdd, edited in project");
  expect(projectStatus({ collectionRoot: collection, projectDir: project })[0]?.state).toBe("in-sync");
});

test("write-back to a vendor-sourced asset throws and changes nothing", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "vendor/matt/skills/tdd/SKILL.md": "# tdd upstream",
  });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd edited" });
  const [asset] = discoverCollectionAssets(collection);
  if (asset === undefined) throw new Error("fixture broke");

  expect(() =>
    writeBackToCollection({ asset, projectPath: path.join(project, ".agents", "skills", "tdd") }),
  ).toThrow(/fork it into your own collection/);
  expect(readFileSync(path.join(collection, "vendor/matt/skills/tdd/SKILL.md"), "utf8")).toBe("# tdd upstream");
});

test("fork-to-mine keeps the project version as mine and leaves the vendored copy untouched", () => {
  const collection = writeTree(tempDir("col-"), {
    "sources.json": sourcesJson("matt/skills"),
    "vendor/matt/skills/tdd/SKILL.md": "# tdd upstream",
  });
  const project = writeTree(tempDir("proj-"), { ".agents/skills/tdd/SKILL.md": "# tdd, my edits" });

  adoptIntoMine({
    collectionRoot: collection,
    kind: "skill",
    name: "tdd",
    projectPath: path.join(project, ".agents", "skills", "tdd"),
  });

  expect(readFileSync(path.join(collection, "skills", "tdd", "SKILL.md"), "utf8")).toBe("# tdd, my edits");
  expect(readFileSync(path.join(collection, "vendor/matt/skills/tdd/SKILL.md"), "utf8")).toBe("# tdd upstream");
  const [entry] = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entry).toMatchObject({ state: "in-sync", asset: { owner: { kind: "mine" } } });
});

test("a project-only agent can be adopted into my collection", () => {
  const collection = tempDir("col-");
  const project = writeTree(tempDir("proj-"), { ".agents/agents/helper.md": "# helper" });

  adoptIntoMine({
    collectionRoot: collection,
    kind: "agent",
    name: "helper",
    projectPath: path.join(project, ".agents", "agents", "helper.md"),
  });

  expect(readFileSync(path.join(collection, "agents", "helper.md"), "utf8")).toBe("# helper");
  expect(projectStatus({ collectionRoot: collection, projectDir: project })[0]?.state).toBe("in-sync");
});
