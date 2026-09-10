# 验证记录：session_search 跨会话检索（2026-09-10）

## 结论

- host 半在**隔离影子环境实测通过**：`session_search` 正常注册；调官方 `sessionQuery.searchSessions` 正常；
  返回时间 / 工作区 / 标题 / 命中片段（标题走官方 `readTitleSnapshots` 批量快照）。索引没开时给可操作提示，不算错误。
- **官方索引有一处硬伤**：建库是**全量扫描**历史会话，**任何一条读不动的老日志都会让检索整体失败**（不是只挂那一条）。
  本机 150 条会话里 **27 条** v0 老格式日志会触发；把这 27 条移出 sessions 目录后检索恢复正常（实测返回命中）。

## 验证姿势（可复用，全程不碰在跑的宿主）

1. `/tmp` 搭影子 `DSH_HOME`：
   - `profiles/<名>/`：真文件复制（`cordis.yml` / `cordis.patch.yml` / `package.json`）+ `node_modules` 软链；
   - 插件包用**源码工作树**复制（`package.json` + `cordis.patch.yml` + `lib/`），它的 peer 依赖
     `@deepseek-ai/dsh-tools`、`schemastery` 从 `~/.dsh/profiles/node_modules/` 软链
     （**不要**指向 profile 自己的 `node_modules`——按铁律那里不该有 dsh-tools，指过去会 `ERR_MODULE_NOT_FOUND`）；
   - `sessions/` 用 `rsync -a --include='*/' --include='session*.jsonl.zstd' --exclude='*'` 拷真实日志；
     **别用软链**——宿主会往里写新会话，沙箱会拦（`EPERM: mkdir .../sessions/...`）。
2. profile 补丁层：`simple-memory`（记忆根指副本）+ `session-query-sqlite`（`openAt: first-search`、`path` 指 /tmp）
   + headless 补一个 `@deepseek-ai/dsh-host-webserver`（插件 inject 里有 webServer，不补会一直 pending 不激活）。
3. 跑：`env -u DSH_SHELL -u DSH_SESSION_ID -u DSH_WEB_URL DSH_HOME=/tmp/dsh-memtest dsh --profile memtest "<任务>"`
4. **零模型调用探针**（判"索引到底建不建得起来"最省事）：临时插件在 `apply` 里直接调官方接口后退出：

   ```js
   export const name = 'memtest-scan'
   export const inject = ['sessionQuery']
   export async function apply(ctx) {
     try {
       const page = await ctx.sessionQuery.searchSessions({ query: process.env.MEMTEST_QUERY || 'dsh', limit: 5 })
       console.log('[SCAN] OK items=' + ((page && page.items) || []).length)
     } catch (e) { console.log('[SCAN] FAIL ' + ((e && e.message) || e)) }
     process.exit(0)
   }
   ```
   用 profile 的 `cordis.patch.yml`（或 `--patch`）`insert` 挂上；headless 仍要求给个任务字符串（占位即可）。
5. 不进宿主的配置检查：影子 profile + `dsh --profile web --dump-config`（它会**回写** profile 的 `cordis.yml`，所以要影子目录）。

坑：会话目录名以 `--` 开头，脚本里别用 `dirname`/`mkdir` 直接吃这些路径（会被当选项解析），一律用 `${var%/*}`。

## 坏日志清单（27 条 / 三类）

| 失败信息 | 条数 | 说明 |
|---|---|---|
| `subagent/descriptor N uses unsupported descriptor version 2` | 24 | v0 老格式（8 月子代理会话居多）：`dsh-session-format-v0-to-v1` 只接受 descriptor version 3，version 2 直接拒 |
| `assistant/message NNN chunk provenance is not one complete ordered attempt` | 2 | 手工修过 seq 的 v0 日志（8-19"修坏日志"那批） |
| `Session migration from v0 to v3 refuses the transformed artifact: turn/start 33 does not open expected turn 32` | 1 | 同上，另一个手工修过的会话 |

分布：chat 12 · plugin-dev 11 · plugin-dev/dsh-perm-guard 2 · plugin-dev/dsh-simple-memory 1 · another-dsh 1。

### 清单（便于事后隔离）

```
--Users-xinbanzhuan-Documents-DSH-another-dsh--/session-355188b1-bce6-47ca-9973-a4c731d9bd41
--Users-xinbanzhuan-Documents-DSH-chat--/020b25cf-8d7d-4319-af88-7ab63b157194
--Users-xinbanzhuan-Documents-DSH-chat--/10427e9e-1225-4979-a55f-a4359e862131
--Users-xinbanzhuan-Documents-DSH-chat--/24fd76aa-e314-4dda-b634-21f3723b02f8
--Users-xinbanzhuan-Documents-DSH-chat--/2f5c43b1-7f5f-4e21-b533-22529ccb5971
--Users-xinbanzhuan-Documents-DSH-chat--/921309be-b3e9-4cee-9b20-c2a4639a66c6
--Users-xinbanzhuan-Documents-DSH-chat--/a77d3c4b-7a5b-4d76-9c11-df4f1f2f1c48
--Users-xinbanzhuan-Documents-DSH-chat--/c1714628-a3f1-4f16-b3b7-961ec888cfb9
--Users-xinbanzhuan-Documents-DSH-chat--/cbcf17dc-eb8e-4782-9d1b-25dd06da3724
--Users-xinbanzhuan-Documents-DSH-chat--/d018d590-b4a3-4f9b-a66d-a6142937e962
--Users-xinbanzhuan-Documents-DSH-chat--/dbef60f6-8a4e-4401-af60-fad52e69305f
--Users-xinbanzhuan-Documents-DSH-chat--/e1693094-6fb3-4767-bd72-9103602e73a8
--Users-xinbanzhuan-Documents-DSH-chat--/f57f2e2c-f940-42f4-ae7b-61f567cc7fef
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/2e9f4d33-55a9-4447-b85b-6400bf1d28ce
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/3c393393-5d5e-4bfc-8393-3325bf52dad7
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/57e3d4c4-0bc0-47c4-935c-b2cc2c670709
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/5be0696e-613c-4ad3-a295-8b38580817e4
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/5d3a15f9-f95d-4ae3-9e98-1f46be11a71e
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/8e0e6760-25c2-42dd-98ba-db10f9d03b22
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/b2038529-7ed0-4877-9fb8-70ee576710b6
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/e02aafba-457f-4863-abed-9b343c34a111
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/ebf8aa86-da5e-4933-84f8-39f724573106
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/session-3da2ed90-889c-41a5-b3b7-88c0876084d1
--Users-xinbanzhuan-Documents-DSH-plugin-dev--/session-3fcbedcc-9297-4e24-bdf5-e553e97aa00e
--Users-xinbanzhuan-Documents-DSH-plugin-dev-dsh-perm-guard--/b4e1d717-b679-4268-9775-d3812aa33aab
--Users-xinbanzhuan-Documents-DSH-plugin-dev-dsh-perm-guard--/eb2ced32-a1b4-4e45-80ea-29c662a24103
--Users-xinbanzhuan-Documents-DSH-plugin-dev-dsh-simple-memory--/737425ca-3d09-4fe5-a408-0126ae01c176
```

## 建议（上游反馈两点）

1. 单条坏日志不应让整个检索失败——应跳过并计数（现在报 `source v0 artifact remains unchanged`，每次全量重扫，永远建不起来）。
2. v0→v1 迁移拒绝 `subagent/descriptor` version 2，而那是 DSH 自己写出来的格式；建议兼容或给明确修复路径。

## 影响面 / 待办

- 要让 `session_search` 在真机可用：先把这 27 条日志移出 `~/.dsh/sessions/`（另存备份），再开索引（`openAt: first-search`）。
- 配置先行也不会坏事：索引没开 / 建不起来时，工具只回一句可操作提示，不影响其它功能。
