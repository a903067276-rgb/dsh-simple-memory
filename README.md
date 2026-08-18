# dsh-simple-memory 🧠

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A **simple memory keeper** for DeepSeek Harness: retrieval-style memory with
zero-code storage. No database, no vector store — just well-organized markdown
files plus a thin plugin that handles the entry points. Normal work is never
interrupted; memory accumulates as a **sidecar filesystem** beside your
projects, and rules nudge you to record a note from time to time.

> **Status: core pipeline verified (0.2.0), real-world effect still under
> testing** — see [docs/verification-log](docs/全链路验证记录-2026-08-18.md)
> for the test run and [docs/design](docs/记忆系统设计说明.md) for how it works.

*Unofficial project: independently developed and maintained by a community
member, not an official DeepSeek product.*

## Preview

**Memory button** (the bulb icon left of the input box): one click starts the
memory flow — review → propose each item with a project/global scope and
reason → confirm → write → show output → commit:

![Memory button triggers the memory flow](assets/memory-button.png)

**Memory management page** (Settings → Memory): status overview, memory-root
config, flat per-project lists plus global, click to read:

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

## How it works

- **Storage (zero code)**: memory lives in one root `~/Documents/DSH/memory/`
  (configurable): `common/` (global active) + `projects/<name>/` (per-project,
  auto-created) + `references/` + `archive/` (cold zones) + `staging.md`
  (promotion pool). The whole root is a single git repo; every memory
  operation is committed as `mem: <action> <subject>` and can be rolled back.
- **Plugin (thin entry points)**: Host injects the index via `agent/pre-step`
  (once per session, filenames only — never the content) and registers the
  `memory-write` tool plus HTTP RPC (status/list/read/init/config); Client
  adds the memory button (`conversation.input.left`) and the settings page
  (`settings.section`, browse + config). All official DSH APIs, zero runtime
  dependencies.
- **Search**: no index files — the agent's grep scans the whole memory root
  (all projects + global + cold zones), active before cold.
- **Design choice**: project memory does NOT live inside the project dir
  (a `.gitignore`'d `memory/` would hide it from grep); publication isolation
  is automatic instead.

## Install

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

Restart `dsh web`, then Settings → Memory → Initialize memory repo.
See [docs/install.md](docs/install.md) for details and the manual fallback.

## Requirements

- DSH web, git CLI (optional: memory repos are plain dirs without git)

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ development environment |
| Linux / Windows | ⚠️ expected to work (plain file operations), untested |

## Notes

- Memory git repos are local-only, never pushed to a remote.
- Writing memory outside the workspace asks for approval (built-in
  confirmation, per the memory spec).
- The memory-flow instruction is self-contained and does not depend on the
  global AGENTS.md; the judgment rules there are only a reference.
