# dsh-simple-memory 🧠

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

DSH 的**简单记忆管家**：检索式记忆，存储零代码。不建数据库、不搞向量检索——就是"组织好的 md 文件 + 一个只管入口的薄插件"。

> **状态：设计定稿，开发进行中**（先动态 Cordis 原型，后静态 bundle）。

*非官方项目：社区成员独立开发维护，非 DeepSeek 官方产品。*

## 功能

| 操作 | 效果 |
|---|---|
| 开会话 | 自动注入记忆索引（项目 + 全局，仅首轮）——模型"想得起"有什么 |
| 点记忆按钮 | 输入框插入固定"记忆流程指令"——模型走规范流程（回顾→提议→确认→写入→贴产出物→提交） |
| 浏览记忆 | 设置卡片打开浏览面板：列活跃记忆，点开即读 |
| 写记忆 | `memory-write` 工具强制格式（文件名 `分类-主题.md`、≤2KB、日期首行）——内容自由 |
| 初始化 | 设置卡片一键建目录骨架 + `git init` |

## 工作原理

- **存储（零代码）**：全局 `~/Documents/DSH/memory/`（`common/` 活跃，`references/` + `archive/` 冷区，`staging.md` 升格暂存池）与 `<项目>/memory/`（活跃平铺 + `archive/`）。规则：文件=主题、单文件 ≤2KB、升格走暂存池、操作全要用户确认、每次操作即提交 `mem: <操作> <对象>`。
- **插件（薄入口）**：Host 经 `systemPrompt.section` 首轮注入索引 + 注册 `memory-write` 工具；Client 加记忆按钮（`conversation.input.left`）、设置卡片（`settings.plugin.item`）、记忆浏览器（`shell.overlay`）。全部官方 DSH 接口，零运行时依赖。

## 安装

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

详见 [docs/install.md](docs/install.md)（含手动兜底）。

## 依赖

- DSH web；git CLI（可选：没有 git 记忆目录就是普通文件夹）

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境 |
| Linux / Windows | ⚠️ 预期可用（纯文件操作），未实测 |

## 注意事项

- 记忆 git 仓库仅本地，不推远端
- 完整记忆规范在全局 AGENTS.md「记忆规范」段落
