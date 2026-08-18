# dsh-simple-memory 🧠

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

DSH 的**简单记忆管家**：检索式记忆，存储零代码。不建数据库、不搞向量检索——就是"组织好的 md 文件 + 一个只管入口的薄插件"。正常干活不受打扰，记忆作为**外挂文件系统**在旁边积累，规则时不时提醒你记一笔。

> **状态：核心链路已通（0.2.0），真实使用效果待长期测试**——测试流程与结果见 [docs/全链路验证记录](docs/全链路验证记录-2026-08-18.md)，设计原理见 [docs/记忆系统设计说明](docs/记忆系统设计说明.md)。

*非官方项目：社区成员独立开发维护，非 DeepSeek 官方产品。*

## 效果预览

**记忆按钮**（输入框左侧灯泡）：一键触发记忆流程——回顾 → 逐条提议（标明记项目还是全局）→ 确认 → 写入 → 贴产出物 → commit：

![记忆按钮触发记忆流程](assets/memory-button.png)

**记忆管理页**（设置 → 记忆）：状态总览、记忆根目录配置、平级项目列表 + 全局，点开即读：

![记忆管理设置页](assets/memory-settings.png)

## 功能

| 操作 | 效果 |
|---|---|
| 开会话 | 自动注入记忆索引（当前项目 + 全局 + 记忆根游离，每会话首轮一次）——模型"想得起"有什么 |
| 点记忆按钮 | 输入框插入固定"记忆流程指令"——模型走规范流程（回顾→提议标 scope→确认→写入→贴产出物→commit） |
| 写记忆 | `memory-write` 工具强制格式（文件名 `分类-主题.md`、≤2KB、日期首行；scope=项目/全局） |
| 浏览记忆 | 设置页内嵌浏览：所有项目平级列表 + 全局 common/，点开即读全文 |
| 初始化 | 设置页一键建目录骨架（common/projects/references/archive/staging）+ `git init` |
| 改位置 | 设置页改记忆根目录（写 patch 配置，重启生效） |

## 工作原理

- **存储（零代码）**：记忆统一收在记忆根 `~/Documents/DSH/memory/`（可配置）：
  `common/`（全局活跃）+ `projects/<项目名>/`（项目经验，自动建目录）+ `references/` + `archive/`（冷区）+ `staging.md`（升格暂存池）。
  整个记忆根一个 git 仓库，每次记忆操作即提交 `mem: <操作> <对象>`，可回滚。
- **插件（薄入口）**：Host 经 `agent/pre-step` 每会话首轮注入索引（文件名清单，不灌内容）+ 注册 `memory-write` 工具 + HTTP RPC（status/list/read/init/config）；Client 加记忆按钮（`conversation.input.left`）、设置页（`settings.section`，含浏览/配置）。全部官方 DSH 接口，零运行时依赖。
- **检索**：不建索引文件，agent 的 grep 直接搜整个记忆根（所有项目 + 全局 + 冷区），先活跃后冷区。
- **设计取舍**：项目记忆不落项目目录（避免 .gitignore 隔离导致 grep 搜不到），发布隔离天然成立。

## 安装

```bash
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

装完重启 `dsh web`，设置 → 记忆 → 初始化记忆仓库。详见 [docs/install.md](docs/install.md)（含手动兜底）。

## 依赖

- DSH web；git CLI（可选：没有 git 记忆目录就是普通文件夹）

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境 |
| Linux / Windows | ⚠️ 预期可用（纯文件操作），未实测 |

## 注意事项

- 记忆 git 仓库仅本地，不推远端
- 写记忆在工作区外会弹审批（= 写入前确认，符合记忆规范）
- 记忆流程指令自包含，不依赖全局 AGENTS.md；AGENTS.md 里的判断标准仅作参考
