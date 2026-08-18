# dsh-simple-memory

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A **simple memory keeper** for DeepSeek Harness: semi-automatic markdown
accumulation, layered loading (global / per-project), cross-project search.
No database, no vector store — just markdown files + automatic loading.

> **Status: skeleton** — repository and project scaffolding are in place;
> feature development is in progress (dynamic Cordis prototype first).

## Design (in one picture)

```
┌─ Accumulation (semi-automatic) ───────────┐
│  agent proposes → you confirm → write      │
│  per-project markdown (split at 200 lines)  │
└──────────────┬───────────────────────────┘
               │ promote (you confirm + abstract)
┌──────────────▼───────────────────────────┐
│  Rules (auto-loaded)                      │
│  L0 global AGENTS.md   ← every session    │
│  L1 project AGENTS.md  ← on project entry │
│  search: cross-project, no boundary       │
└──────────────────────────────────────────┘
```

Three layers, two planes: **accumulation** (semi-auto notes) and **rules**
(auto-loaded, global vs project), joined by a **promotion** mechanism
(project experience → global rules, always confirmed by the user).

## Install

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

See [docs/install.md](docs/install.md) for details and the manual fallback.

## Development

- Source: `lib/index.js` (server side), `lib/client.js` (web injection)
- Workflow: edit locally → push to `main` → `pnpm update` to verify the install
- Prototype first as a dynamic Cordis plugin, then land as a static bundle

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ development environment |
| Linux / Windows | ⚠️ expected to work (plain file operations), untested |
