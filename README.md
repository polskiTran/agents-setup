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

## Bootstrap

```bash
git clone https://github.com/polskiTran/agents-setup.git
cd agents-setup
pnpm i
pnpm add -g link:.   # pnpm 11 replacement for the removed `pnpm link --global`
```

Then run `polskills` from any project directory.

Or you can run directly without the global link

```bash
cd ~/my-project
pnpm i
node ~/src/agents-setup/dist/cli.js
```

## Update

```bash
cd agents-setup
git pull
pnpm i   # the prepare hook rebuilds dist/
```

Every install method above runs `dist/` from this clone, so the rebuild takes effect at once.

## Uninstall

If you linked the package globally, unlink it.

```bash
pnpm remove -g polskills
```

Otherwise remove the symlink or the alias. Then delete the clone.

## Skills upstreams
- https://github.com/mattpocock/skills
- https://github.com/cursor/plugins/tree/main/pstack
- https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills
- https://github.com/emilkowalski/skills
- https://github.com/jakubkrehel/skills
- https://github.com/humanlayer/skills
