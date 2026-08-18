# 安装指南（dsh-simple-memory）

> 骨架阶段：仓库建好即可安装验证，功能尚未实现。

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

3. 在 `~/.dsh/cordis.patch.yml` 追加单 entry（示例见
   [`examples/cordis.patch.example.yml`](../examples/cordis.patch.example.yml)）：

   ```yaml
   - insert:
       - id: simple-memory
         name: 'dsh-simple-memory'
   ```

4. 重启 `dsh web`。

## 验证是否装好

- 骨架阶段：`dsh web` 能正常启动、日志无加载错误即可。
- 功能阶段（开发中）：输入框出现「记忆」按钮、记忆面板可打开。

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-simple-memory`，重启 `dsh web`。
- 手动挂载：删除 `~/.dsh/cordis.patch.yml` 里的 entry、删除软链，重启 `dsh web`。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境 |
| Linux / Windows | ⚠️ 未实测；架构上预期可用（纯文件操作，无平台依赖） |
