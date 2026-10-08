# AGENTS.md

Instructions for Codex and other coding agents. Claude Code reads `CLAUDE.md`; the project conventions live there, so read [CLAUDE.md](CLAUDE.md) first and follow it. This file adds only the workflow rules every agent shares.

## Workflow

- Work on a branch and open a pull request for every change. **Push your branch before you stop**, even if the work is unfinished, so nothing lives only on one laptop.
- Scott switches between Codex and Claude, one at a time. Before starting, pull `main` and check open PRs so you build on the latest work.
- CI (`.github/workflows/ci.yml`) must pass: lint, typecheck, unit tests, build and the browser tests. Run them locally first:
  ```bash
  npm run lint && npm run typecheck && npm test && npm run build
  npm run start -- -p 3100 &   # then, in another shell:
  npm run test:e2e
  ```
- Address every review comment before merging: fix it, or reply saying why not, then resolve the thread.
- Keep `TODO.md` in sync: tick off or update the roadmap item a PR delivers.
