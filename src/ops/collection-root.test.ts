import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { findCollectionRoot } from "./collection-root.ts";

const roots: string[] = [];

function tempTree(): string {
  const root = mkdtempSync(path.join(tmpdir(), "polskills-root-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("finds the collection root from a nested module directory", () => {
  const root = tempTree();
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "polskills" }));
  const nested = path.join(root, "src", "ops");
  mkdirSync(nested, { recursive: true });

  expect(findCollectionRoot(nested)).toBe(root);
});

test("walks past package.json files that belong to other packages", () => {
  const root = tempTree();
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "polskills" }));
  const dependency = path.join(root, "node_modules", "somedep");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "somedep" }));

  expect(findCollectionRoot(dependency)).toBe(root);
});

test("throws when no polskills package exists above the start directory", () => {
  const root = tempTree();
  const orphan = path.join(root, "just", "a", "dir");
  mkdirSync(orphan, { recursive: true });

  expect(() => findCollectionRoot(orphan)).toThrow(/polskills package\.json/);
});
