#!/usr/bin/env node
import { intro, isCancel, log, outro, select, spinner, text } from "@clack/prompts";

import { findCollectionRoot } from "./ops/collection-root.ts";
import { addSource, listSources, parseUpstreamUrl, type LicenseInfo } from "./ops/sources.ts";

const collectionRoot = findCollectionRoot(import.meta.dirname);
const projectDir = process.cwd();

intro("polskills");
log.info(`Collection  ${collectionRoot}`);
log.info(`Project     ${projectDir}`);

if (!process.stdin.isTTY) {
  outro("The menu needs an interactive terminal — run polskills directly in one.");
  process.exit(0);
}

while (true) {
  const action = await select({
    message: "What do you want to do?",
    options: [
      { value: "add-upstream", label: "Add upstream", hint: "vendor a skills repo by URL" },
      { value: "list-sources", label: "List sources", hint: "vendored upstreams and licenses" },
      { value: "exit", label: "Exit" },
    ],
  });
  if (isCancel(action) || action === "exit") break;
  if (action === "add-upstream") await runAddUpstream();
  if (action === "list-sources") runListSources();
}

outro("Done.");

async function runAddUpstream(): Promise<void> {
  const rawUrl = await text({
    message: "Upstream URL (repo or GitHub tree link)",
    placeholder: "https://github.com/owner/repo",
    validate: (value) => (value.trim() === "" ? "A URL is required" : undefined),
  });
  if (isCancel(rawUrl)) return;
  const parsed = parseUpstreamUrl(rawUrl);

  const subpathInput = await text({
    message: "Subpath to vendor (leave empty for the whole repo)",
    initialValue: parsed.subpath ?? "",
    defaultValue: "",
  });
  if (isCancel(subpathInput)) return;
  const subpath = subpathInput.trim();

  const progress = spinner();
  progress.start(`Cloning ${parsed.url}`);
  try {
    const added = addSource({
      collectionRoot,
      url: parsed.url,
      ...(subpath === "" ? {} : { subpath }),
    });
    progress.stop(`Vendored ${added.source.name} @ ${added.source.sha.slice(0, 7)}`);
    reportLicense(added.source.name, added.license);
  } catch (error) {
    progress.stop("Add failed", 1);
    log.error(error instanceof Error ? error.message : String(error));
  }
}

function runListSources(): void {
  const entries = listSources(collectionRoot);
  if (entries.length === 0) {
    log.info("No sources vendored yet.");
    return;
  }
  for (const { source, license } of entries) {
    const subpath = source.subpath === undefined ? "" : `  /${source.subpath}`;
    const licenseText = license.kind === "found" ? license.summary : "no license found";
    log.message(
      `${source.name}  @ ${source.sha.slice(0, 7)}${subpath}\n${source.url}\n${licenseText}`,
    );
  }
}

function reportLicense(name: string, license: LicenseInfo): void {
  if (license.kind === "found") {
    log.info(`License: ${license.summary} (${license.file})`);
  } else {
    log.warn(`${name} ships no license file — vendored anyway, attribution is on you`);
  }
}
