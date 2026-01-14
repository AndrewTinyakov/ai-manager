# AI Manager

AI Manager is a CLI that generates and maintains AI harness files and skill instructions for a repo. It ships with a built-in registry of skills and harnesses, renders deterministic output, and always overwrites files (optional backups available).

## Install and start

Install dependencies and run the CLI from this repo:

```sh
pnpm install
pnpm run build
pnpm --filter ai-manager exec ai-manager status
```

If you want to run the CLI directly during development:

```sh
pnpm --filter ai-manager exec ai-manager init
```

## Project layout

- `packages/ai-manager`: CLI binary.
- `packages/core`: registry loaders, schemas, renderer, and file utilities.
- `registry/skills`: built-in skills.
- `registry/harnesses`: built-in harnesses.

## CLI commands

- `ai-manager` or `ai-manager status`: show current status and selected skills/harnesses.
- `ai-manager init`: initialize a project (renders `/ai/*` plus harness files).
- `ai-manager skills add|remove|list`: manage skills.
- `ai-manager harnesses add|remove|list`: manage harnesses.
- `ai-manager doctor`: validate required files.

## Outputs in a managed repo

Always generated/overwritten:

- `ai/agents.md`
- `ai/skills/<skill-id>-skill.md`
- `ai/ai-manager.json`

Harness files (depending on selection):

- `CLAUDE.md`
- `.cursor/rules/ai-manager.mdc`
- `AGENTS.md`

## Development

Run checks:

```sh
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm test
```
