# agents-setup

My coding agents setup. 

## Layout

The collection holds everything installable. Each directory under `vendor/` mirrors one entry in `sources.json`, fetched at the pinned sha.

```text
agents-setup/
├── skills/              # my skills, one directory each
├── agents/              # my subagents, one .md each
├── sources.json                    # upstream url, sha, and optional subpath
└── vendor/
    └── <owner>/<repo>[/<subpath>]/ # fetched content, never edited in place
```

Tracking a subpath puts it under that subpath inside the repo's directory, so several subtrees of one
repo (`cursor/plugins/pstack` and `cursor/plugins/cursor-team-kit/skills`) are separate sources with
their own pinned shas. Only overlapping subtrees are refused.

A project gets copies under `.agents/`, plus two directory symlinks that `polskills` creates once.

```text
my-project/
├── .agents/
│   ├── skills/<name>/
│   └── agents/<name>.md
└── .claude/
    ├── skills -> ../.agents/skills
    └── agents -> ../.agents/agents
```

Because each asset is a copy, a project can drift from the collection. You can write a changed copy back into `skills/` or `agents/`. A changed vendor copy has to be adopted into `skills/` or `agents/` first, since `vendor/` stays as fetched.

## Install and update

One command, in the project you want to set up:

```bash
curl -fsSL https://raw.githubusercontent.com/polskiTran/agents-setup/main/bin/polskills | sh
```

It needs `git` and Node 22.18+. The first run clones this repo into `~/.polskills`, builds it, and links
`~/.local/bin/polskills`. After that, run `polskills` from any project. Each run fast-forwards
`~/.polskills` first, and rebuilds only if the commit changed. So the menu always shows the latest collection.

Writes back to the collection (Keep the project version, Copy into my collection, upstream changes) land
in `~/.polskills`. Commit and push them from there, or the next environment won't have them.

To use a clone you already work in, point the launcher at it:

```bash
export POLSKILLS_HOME=~/src/agents-setup
```

The launcher only fast-forwards. If the clone has diverged, it warns and runs the clone as it is.

## Uninstall

```bash
rm ~/.local/bin/polskills
rm -rf ~/.polskills
```

## Skills upstreams
- https://github.com/mattpocock/skills
- https://github.com/cursor/plugins/tree/main/pstack
- https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills
- https://github.com/emilkowalski/skills
- https://github.com/jakubkrehel/skills
- https://github.com/humanlayer/skills
