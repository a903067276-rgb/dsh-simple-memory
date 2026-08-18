# dsh-simple-memory 🧠

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A **simple memory keeper** for DeepSeek Harness: retrieval-style memory with
zero-code storage. No database, no vector store — just well-organized markdown
files plus a thin plugin that handles the entry points.

> **Status: design finalized, development in progress** (dynamic Cordis
> prototype first, static bundle next).

*Unofficial project: independently developed and maintained by a community
member, not an official DeepSeek product.*

## Features

| Action | Effect |
|---|---|
| Open a session | Memory index (project + global) is injected once — the model "remembers" what exists |
| Click the memory button | A fixed memory-flow instruction is inserted — the model runs the standardized flow (propose → confirm → write → show output → commit) |
| Browse memory | Settings card opens a browser panel: list active memories, click to read |
| Write memory | The `memory-write` tool enforces the format (name `分类-主题.md`, ≤2KB, date header) — content stays free |
| Initialize | Settings card creates the repo skeleton and `git init` in one click |

## How it works

- **Storage (zero code)**: `~/Documents/DSH/memory/` (global: `common/` active,
  `references/` + `archive/` cold, `staging.md` promotion pool) and
  `<project>/memory/` (flat active + `archive/`). Rules: file = topic,
  ≤2KB per file, promote via staging pool, all operations user-confirmed,
  every operation committed with `mem: <action> <subject>`.
- **Plugin (thin entry points)**: Host injects the index via
  `systemPrompt.section` (first turn only) and registers the `memory-write`
  tool; Client adds the memory button (`conversation.input.left`), the
  settings card (`settings.plugin.item`), and the memory browser
  (`shell.overlay`). All official DSH APIs, zero runtime dependencies.

## Install

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

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
- Full memory spec lives in the global AGENTS.md "记忆规范" section.
