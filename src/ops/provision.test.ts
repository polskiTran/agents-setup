import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { discoverCollectionAssets } from "./catalog.ts";
import { addAssetToProject, initProject, removeAssetFromProject } from "./provision.ts";
import { projectStatus } from "./status.ts";

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

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("init creates canonical areas and relative .claude symlinks", () => {
  const project = tempDir("proj-");

  const outcomes = initProject(project);

  expect(outcomes).toEqual([
    { link: ".claude/skills", outcome: "created" },
    { link: ".claude/agents", outcome: "created" },
  ]);
  expect(readlinkSync(path.join(project, ".claude", "skills"))).toBe(path.join("..", ".agents", "skills"));
  expect(readlinkSync(path.join(project, ".claude", "agents"))).toBe(path.join("..", ".agents", "agents"));
  // the links resolve: content written to .agents is readable at the .claude path
  writeFileSync(path.join(project, ".agents", "skills", "probe"), "x");
  expect(readFileSync(path.join(project, ".claude", "skills", "probe"), "utf8")).toBe("x");
});

test("init is idempotent on an already-initialized project", () => {
  const project = tempDir("proj-");
  initProject(project);

  expect(initProject(project).map((o) => o.outcome)).toEqual(["already-linked", "already-linked"]);
});

test("init reports a conflict for a pre-existing real .claude/skills and leaves it untouched", () => {
  const project = writeTree(tempDir("proj-"), { ".claude/skills/existing/SKILL.md": "# precious" });

  const outcomes = initProject(project);

  expect(outcomes[0]).toEqual({ link: ".claude/skills", outcome: "conflict" });
  expect(readFileSync(path.join(project, ".claude", "skills", "existing", "SKILL.md"), "utf8")).toBe("# precious");
});

test("adding a skill and an agent flips them to in-sync, readable through .claude", () => {
  const collection = writeTree(tempDir("col-"), {
    "skills/tdd/SKILL.md": "# tdd",
    "skills/tdd/references/guide.md": "guide",
    "agents/reviewer.md": "# reviewer",
  });
  const project = tempDir("proj-");
  initProject(project);

  for (const asset of discoverCollectionAssets(collection)) {
    addAssetToProject({ projectDir: project, asset });
  }

  const entries = projectStatus({ collectionRoot: collection, projectDir: project });
  expect(entries.map((entry) => entry.state)).toEqual(["in-sync", "in-sync"]);
  expect(existsSync(path.join(project, ".claude", "skills", "tdd", "references", "guide.md"))).toBe(true);
  expect(existsSync(path.join(project, ".claude", "agents", "reviewer.md"))).toBe(true);
});

test("removing a provisioned asset returns it to collection-only", () => {
  const collection = writeTree(tempDir("col-"), { "skills/tdd/SKILL.md": "# tdd" });
  const project = tempDir("proj-");
  initProject(project);
  const [asset] = discoverCollectionAssets(collection);
  if (asset === undefined) throw new Error("fixture broke");
  addAssetToProject({ projectDir: project, asset });

  removeAssetFromProject({ projectDir: project, kind: "skill", name: "tdd" });

  expect(projectStatus({ collectionRoot: collection, projectDir: project })[0]?.state).toBe("collection-only");
});

test("removing something not provisioned throws", () => {
  const project = tempDir("proj-");
  initProject(project);

  expect(() => removeAssetFromProject({ projectDir: project, kind: "skill", name: "ghost" })).toThrow(
    /not provisioned/,
  );
});
