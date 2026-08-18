# dsh-simple-memory 🧠

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A **simple memory keeper** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web: retrieval-style memory with zero-code storage. No database, no vector store — just well-organized markdown files plus a thin plugin that handles the entry points. Normal work is never interrupted; memory accumulates as a **sidecar filesystem** beside your projects, and rules nudge you to record a note from time to time.

> **Status: core pipeline verified (0.2.0), real-world effect still under testing** — see [docs/verification-log](docs/全链路验证记录-2026-08-18.md) for the test run and [docs/design](docs/记忆系统设计说明.md) for how it works.

*Unofficial project: independently developed and maintained by a community member, not an official DeepSeek product.*

## Screenshot

**Memory button** (the bulb icon left of the input box): one click starts the memory flow — review → propose each item with a project/global scope and reason → confirm → write → show output → commit:

![Memory button triggers the memory flow](assets/memory-button.png)

**Memory management page** (Settings → Memory): status overview, memory-root config, flat per-project lists plus global, click to read:

![Memory management settings page](assets/memory-settings.png)

## Features

| Action | Effect |
|---|---|
| Open a session | Memory index (current project + global + loose root files) is injected once per session — the model "remembers" what exists |
| Click the memory button | A fixed memory-flow instruction is inserted — the model runs the standardized flow (review → propose with scope → confirm → write → show output → commit) |
| Write memory | The `memory-write` tool enforces the format (name `分类-主题.md`, ≤2KB, date header; scope = project/global) |
| Browse memory | Inline browser in the settings page: flat per-project lists + global common/, click to read |
| Initialize | One click creates the repo skeleton (common/projects/references/archive/staging) + `git init` |
| Relocate | Change the memory root from the settings page (writes patch config, takes effect after restart) |

## Install

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

Restart `dsh web`, then Settings → Memory → Initialize memory repo.
Manual install fallback: see [docs/install.md](docs/install.md).

## Usage

- **Memory button** (the bulb icon left of the input box) — one click inserts a fixed, self-contained memory-flow instruction; the model then runs the standardized flow (review → propose each item with a project/global scope and reason → confirm → write → show output → commit).
- **Settings → Memory** — status overview, memory-root config, one-click repo init, and an inline browser: flat per-project lists plus global, click to read.

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ development environment |
| Linux | ⚠️ expected to work (plain file operations), untested |
| Windows | ⚠️ expected to work (plain file operations), untested |

## Requirements

- DSH web
- git CLI (optional: without git, the memory repo is just a plain directory)

## How it works

A retrieval-style memory: files are the storage, the plugin only handles the entry points. Full design: [docs/记忆系统设计说明](docs/记忆系统设计说明.md).

- **Storage (zero code)** — everything lives in one memory root `~/Documents/DSH/memory/` (configurable from the settings page):
  ```
  memory/
  ├── common/          global experience (active zone, cross-project reuse)
  ├── projects/<name>/ per-project memory (auto-created on first write)
  ├── references/      cold zone: reference material (search-only)
  ├── archive/         cold zone: forgotten memory moved out of the index
  ├── staging.md       promotion pool (candidates for global reuse)
  └── .git/            one git repo for the whole root — rollback safety
  ```
  Per-project memory does NOT live inside the project directory: a `.gitignore`'d `memory/` would hide it from grep. Keeping it in the shared root keeps publication isolation automatic and search universal.

- **Index injection (remembers what exists)** — on the first step of every session (`agent/pre-step`), the plugin injects a **filename list** (never the content), grouped by category, covering the current project + global + loose root files. The model then reads a full note (≤2KB each) on demand. Cold zones are not injected — searched only when a topic hits.

- **Write tool (records it)** — `memory-write` enforces the format: filename `分类-主题.md`, first line `## date 分类-主题`, ≤2KB, category prefixes open (built-in: 踩坑/流程/决策/偏好/背景). `scope` picks project or global. Writing outside the workspace asks for approval (built-in confirmation).

- **Memory button (triggers the flow)** — the bulb icon in the input bar inserts a fixed, self-contained instruction: ① review the conversation ② propose each item with a scope (project/global) + reason ③ wait for user confirmation ④ write via `memory-write` ⑤ show the output ⑥ git commit (`mem: 记 xxx`).

- **Settings page (manage + browse)** — status line (active count, staging count), memory-root config, one-click repo skeleton init, and an inline browser listing every project flat plus global, click to read.

- **Search (finds it)** — no index files: the agent's grep scans the whole memory root (all projects + global + cold zones) in one pass, active zones first.

- **Promotion (cross-project reuse)** — project memory that looks reusable goes into `staging.md` (low friction, no instant decision); when the pool is non-empty the user is reminded, and after confirmation it is distilled into `common/` and removed from the pool.

- **Forgetting (fresh context)** — outdated notes move to `archive/` (soft delete: still on disk, just out of the index). Context stays lean, disk stays complete.

- **Rollback** — every memory operation is committed immediately (`mem: <action> <subject>`); a wrong write is one `git checkout` away.

## Notes

- Memory git repos are local-only, never pushed to a remote.
- Writing memory outside the workspace asks for approval (built-in confirmation, per the memory spec).
- The memory-flow instruction is self-contained and does not depend on the global AGENTS.md; the judgment rules there are only a reference.

## License

[MIT](LICENSE)
