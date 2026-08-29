# agents-setup
My coding agents setup

personal under `skills/` and `agents/`, third-party upstreams vendored under `vendor/` and pinned in `sources.json` - managed by **polskills**, an interactive CLI that provisions them into any project's `.agents/` directory (with `.claude/` symlinks for Claude Code).

## Bootstrap

```bash
git clone https://github.com/polskiTran/agents-setup.git
cd agents-setup
pnpm i
pnpm add -g link:.   # pnpm 11 replacement for the removed `pnpm link --global`
```

Then run `polskills` from any project directory.

## Update

```bash
cd agents-setup
git pull
pnpm i   # prepare hook rebuilds dist; the global bin links into this clone, so it's current immediately
```

## Uninstall

```bash
pnpm remove -g polskills
```

Then delete the clone 

## Skills upstreams
- https://github.com/mattpocock/skills
- https://github.com/cursor/plugins/tree/main/pstack
- https://github.com/emilkowalski/skills
- https://github.com/jakubkrehel/skills
- https://github.com/humanlayer/skills

## Agents upstreams
Listed here as they are collected.
- https://github.com/cursor/plugins/tree/main/pstack/agents - covered by the vendored pstack subtree above
