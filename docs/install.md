# 安装指南（dsh-simple-memory）

> 2026-08-18 更新至 0.2.0 现状（记忆根目录可在设置页改，patch 条目带 config）。

## 功能概览（装完即用）

- **记忆索引**：每个新会话第一步自动注入记忆文件名清单（本项目记忆 / 本项目文档 / 全局通用经验），相关时按需读全文
- **记忆按钮**：输入框左侧灯泡图标，点击塞入规范记忆流程指令（自包含，不依赖外部文件）
- **memory-write 工具**：强制格式写入（`分类-主题.md` / ≤2KB / 首行日期），scope 分项目/全局
- **设置页**：记忆状态、记忆根目录配置、一键初始化记忆仓库、浏览全部记忆

## 安装（推荐：官方 bundle 一行安装）

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-simple-memory#main"
```

装完**重启 `dsh web`**。更新时 `dsh plugin --profile web update dsh-simple-memory`，重启生效。

> **需要 pnpm**：`dsh plugin` 是 pnpm 转发器，PATH 里没有 pnpm 会直接失败。

## 安装（兜底：手动挂载，macOS 实测路径）

1. 把仓库放到本地，例如 `~/Documents/DSH/plugin-dev/dsh-simple-memory`。
2. 让 web profile 能按包名解析到它：

   ```bash
   ln -s ~/Documents/DSH/plugin-dev/dsh-simple-memory ~/.dsh/profiles/web/node_modules/dsh-simple-memory
   ```

3. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加条目（示例见
   [`examples/cordis.patch.example.yml`](../examples/cordis.patch.example.yml)）：

   ```yaml
   - id: simple-memory
     name: 'dsh-simple-memory'
     config:
       globalMemoryDir: "/Users/<你的用户名>/Documents/DSH/memory"  # 记忆根目录，可省略（默认同路径）
   ```

4. 重启 `dsh web`。

## 记忆根目录

- 默认 `~/Documents/DSH/memory`（一个独立 git 仓库）：
  - `common/`：全局通用经验（活跃）
  - `projects/<项目名>/`：项目经验（自动建目录）
  - `references/`、`archive/`：冷区（命中搜索才读）
  - `staging.md`：升格暂存池
- **改位置**：设置页「记忆根目录」输入路径 → 保存 → 重启生效（写入 `~/.dsh/profiles/web/cordis.patch.yml` 的 simple-memory 条目 config）。
- 换目录后需在设置页重新点「初始化记忆仓库」建骨架（幂等）。

## 验证是否装好

- 新会话第一步出现【记忆索引】注入（含"本项目记忆 / 本项目文档 / 全局通用经验"文件名清单）
- 输入框左侧出现灯泡记忆按钮，点击会塞入记忆流程指令
- 设置页有记忆系统状态行（全局条数 / staging 条数）、可浏览记忆
- 日志出现 `[dsh-simple-memory] host loaded`

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-simple-memory`，重启 `dsh web`。
- 手动挂载：删除 `~/.dsh/profiles/web/cordis.patch.yml` 里的条目、删除软链，重启 `dsh web`。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境 |
| Linux / Windows | ⚠️ 未实测；架构上预期可用（纯文件操作，无平台依赖） |
