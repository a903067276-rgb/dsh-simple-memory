# dsh-simple-memory

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

DSH 的**简单记忆管家**：半自动积累 markdown、分层加载（全局 / 项目）、跨项目搜索。
不建数据库、不搞向量检索——就是"md 文件 + 自动加载"。

> **状态：骨架** — 仓库与工程脚手架已就位；功能开发进行中（先走动态 Cordis 原型）。

## 设计（一张图）

```
┌─ 积累层（半自动）─────────────────────┐
│  agent 提议 → 你确认 → 写入             │
│  按项目分目录 md（超 200 行拆分）         │
└──────────────┬───────────────────────┘
               │ 升级（你确认 + 抽象化）
┌──────────────▼───────────────────────┐
│  规则层（自动加载）                     │
│  L0 全局 AGENTS.md   ← 每次会话都带    │
│  L1 项目 AGENTS.md   ← 进项目才带      │
│  搜索：跨全部记忆，无边界               │
└──────────────────────────────────────┘
```

三层两平面：**积累层**（半自动笔记）与**规则层**（自动加载，全局 vs 项目），
由**升级机制**连接（项目经验 → 全局规则，永远用户确认）。

## 安装

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

详见 [docs/install.md](docs/install.md)（含手动挂载兜底）。

## 开发

- 源码：`lib/index.js`（服务端）、`lib/client.js`（Web 注入）
- 流程：本地改 → 推 `main` → `pnpm update` 验证安装
- 先动态 Cordis 插件原型，再落静态 bundle

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境 |
| Linux / Windows | ⚠️ 预期可用（纯文件操作，无平台依赖），未实测 |
