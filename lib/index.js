/**
 * dsh-simple-memory — Host 半
 *
 * DSH 记忆系统入口：存储零代码（md 文件分层 + 约定），插件只管入口。
 * 1. agent/pre-step 首步注入记忆索引（项目 projects/<项目>/ + docs/ + 全局 common/）
 * 2. memory-write 工具：强制格式写入（分类-主题.md / ≤2KB / 日期首行）
 * 3. webServer HTTP RPC（client 设置页/浏览器用）：status / init / list / read
 *    （静态 bundle 的浏览器半无 harness.handle 配对，走 /api/dsh-simple-memory 前缀路由）
 *
 * 存储布局（2026-08-18 改）：记忆统一收在全局记忆根，项目经验记 projects/<项目名>/，
 * 不落项目目录——避免 .gitignore 隔离 memory/ 导致 grep 搜不到（发布隔离天然成立）。
 * 跨平台：路径 node:path join；家目录 os.homedir；记忆根目录为配置项
 * （config.globalMemoryDir，默认 ~/Documents/DSH/memory）。
 */
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-simple-memory'
export const inject = ['fs', 'tools', 'webServer', 'sessions', 'shell']

const DEFAULT_MEMORY_DIR = join(homedir(), 'Documents', 'DSH', 'memory')

export function apply(ctx, config) {
  const fs = ctx.get('fs')
  if (fs === undefined) return
  const webServer = ctx.get('webServer')
  const sessions = ctx.get('sessions')
  const shell = ctx.get('shell')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const approval = ctx.get('approval')

  const GLOBAL_MEMORY_DIR = (config && typeof config.globalMemoryDir === 'string' && config.globalMemoryDir !== '')
    ? config.globalMemoryDir
    : DEFAULT_MEMORY_DIR
  // 已注入索引的会话集合（按会话记，不再是进程级一次性开关——2026-08-18 修）
  const injectedSessions = new Set()

  async function statOk(path, cwd) {
    try {
      const t = await fs.resolve(path, { cwd })
      const info = await fs.stat(t)
      return { target: t, info }
    } catch (e) { return { target: undefined, info: undefined } }
  }

  async function findProjectRoot(startCwd) {
    let dir = startCwd
    for (let i = 0; i < 12; i++) {
      const { info } = await statOk('.git', dir)
      if (info !== undefined) return dir
      try {
        const parent = await fs.resolve('..', { cwd: dir })
        const parentPath = fs.processPath(parent)
        if (parentPath === dir) return dir
        dir = parentPath
      } catch (e) { return dir }
    }
    return startCwd
  }

  async function listMdFiles(dirPath) {
    try {
      const dirTarget = await fs.resolve(dirPath)
      const info = await fs.stat(dirTarget)
      if (info === undefined) return []
      const entries = await fs.listDir(dirTarget)
      const out = []
      for (const e of entries) {
        if (e.type === 'file' && /^[^/\\]*\.md$/i.test(e.name) && !e.name.startsWith('.')) out.push(e.name)
      }
      return out
    } catch (e) { return [] }
  }

  // 记忆条目过滤：仅收 分类-主题 格式（排除 README/staging/AGENTS.bak 辅助文件）
  function isMemoryEntry(name) {
    const base = name.toLowerCase()
    if (base === 'readme.md' || base === 'staging.md' || base === 'agents.bak.md') return false
    return name.indexOf('-') > 0
  }

  function groupByCategory(names) {
    const groups = []
    const map = {}
    for (const n of names) {
      const idx = n.indexOf('-')
      const cat = idx > 0 ? n.slice(0, idx) : '其他'
      if (!map[cat]) { map[cat] = []; groups.push(cat) }
      map[cat].push(n)
    }
    groups.sort()
    return groups.map((cat) => cat + '类：' + map[cat].join('、'))
  }

  async function buildIndex(cwd) {
    const root = await findProjectRoot(cwd)
    const lines = []
    const projMem = (await listMdFiles(projectMemDir(root))).filter(isMemoryEntry)
    const projDocs = (await listMdFiles(join(root, 'docs'))).filter(isMemoryEntry)
    const gMem = (await listMdFiles(join(GLOBAL_MEMORY_DIR, 'common'))).filter(isMemoryEntry)
    // 记忆根目录游离 md（历史遗留直接放根目录的，如 决策-记忆系统架构.md）
    const gRoot = (await listMdFiles(GLOBAL_MEMORY_DIR)).filter(isMemoryEntry)
    if (projMem.length > 0) lines.push('本项目记忆 projects/' + basename(root) + '/：' + groupByCategory(projMem).join('；'))
    if (projDocs.length > 0) lines.push('本项目文档 docs/：' + projDocs.join('、'))
    if (gMem.length > 0) lines.push('全局通用经验 common/：' + groupByCategory(gMem).join('；'))
    if (gRoot.length > 0) lines.push('记忆根目录游离：' + gRoot.join('、'))
    if (lines.length === 0) return ''
    return '【记忆索引】相关时按需读全文（单文件 ≤2KB），先活跃后冷区（references/、archive/ 命中搜索才读）：\n' + lines.join('\n')
  }

  // 项目记忆目录：全局根 projects/<项目名>/（方案 A，2026-08-18 定）
  function projectMemDir(projectRoot) {
    return join(GLOBAL_MEMORY_DIR, 'projects', basename(projectRoot))
  }

  // ── 忆的入口：每会话首步注入索引（waterfall 必须 next()）──
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    // 按会话记：同一会话只注入一次；新会话独立获得注入（进程级开关已废弃）
    const sessionId = agent && agent.session ? agent.session.id : undefined
    if (typeof sessionId !== 'string' || injectedSessions.has(sessionId)) return decision
    if (decision.kind === 'reject') return decision
    try {
      const cwd = agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined
      if (typeof cwd !== 'string') return decision
      const text = await buildIndex(cwd)
      if (!text) return decision
      injectedSessions.add(sessionId)
      const msg = { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name } }
      const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m))
      return { kind: 'enter', messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, msg) }
    } catch (e) {
      console.error('[dsh-simple-memory] index inject failed:', e)
      return decision
    }
  })

  // ── memory-write 工具：强制格式写入 ──
  // 沙箱策略：与官方 write 工具同款——每次执行 resolve 会话策略（含工作区根），
  // 全局记忆在工作区外 → workspace-write 拒绝 → 模型带 sandbox_permissions 重试 → 弹审批。
  const WIDER_MODES = {
    'read-only': ['workspace-write', 'danger-full-access'],
    'workspace-write': ['danger-full-access'],
  }
  async function resolveWritePolicy(exec, args) {
    if (sandboxPolicy === undefined) return undefined // 无沙箱后端（未启用沙箱时）
    const standing = sandboxPolicy.resolve(exec && exec.agent ? { session: exec.agent.session } : {})
    const sp = args && args.sandbox_permissions
    const just = args && args.justification
    if (sp === undefined && just === undefined) return standing
    if (sp === undefined || just === undefined) throw new Error('sandbox_permissions 与 justification 必须成对提供（仅作为沙箱拒绝后的一次性重试）')
    if (!(WIDER_MODES[standing.mode] || []).includes(sp)) {
      throw new Error(`sandbox escalation to "${sp}" is not strictly wider than this call's current "${standing.mode}" mode`)
    }
    if (approval === undefined || !exec || !exec.agent) throw new Error('当前环境无法走提权审批')
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: 'memory-write',
      callId: exec.callId,
      reason: `escalate sandbox to ${sp}: ${just}`,
      ...(exec.signal ? { signal: exec.signal } : {}),
    })
    if (outcome !== 'allowed-once') throw new Error('提权未获批准（' + String(outcome) + '）')
    return { ...standing, mode: sp }
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory-write',
    description: '按记忆规范强制格式写入一条记忆：文件名必须为 分类-主题.md（分类自造，内置踩坑/流程/决策/偏好/背景），内容 ≤2KB，首行 ## 日期 分类-主题。scope=project 写入 <项目>/memory/，scope=global 写入全局 common/。写入前必须已获用户确认。沙箱拒绝后可用 sandbox_permissions+justification 一次性提权重试（global 写工作区外必弹审批）。',
    parameters: {
      scope: { type: 'string', required: true, enum: ['project', 'global'], description: 'project=项目记忆；global=全局通用经验' },
      category: { type: 'string', required: true, description: '分类前缀，如 踩坑/流程/决策/偏好/背景 或自造' },
      topic: { type: 'string', required: true, description: '主题词，与分类组成文件名 分类-主题.md' },
      content: { type: 'string', required: true, description: '记忆正文（骨架：日期+结论+来龙去脉），≤2KB' },
      sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'], description: '更宽的沙箱模式，仅作为沙箱拒绝后的一次性重试；需 justification 并弹用户审批' },
      justification: { type: 'string', description: '配合 sandbox_permissions 的一句话理由' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string' },
          bytes: { type: 'number' },
          error: { type: 'string' },
        },
      },
      render: (args, value) => [{ type: 'text', text: 'memory-write: ' + (value && value.ok ? '已写入 ' + value.path : '失败 ' + (value && value.error)) }],
    },
    execute: async (args, exec) => {
      const a = args || {}
      const cat = String(a.category || '').trim()
      const topic = String(a.topic || '').trim()
      const content = String(a.content || '').trim()
      const fail = (error) => ({ ok: false, error, path: '', bytes: 0 })
      if (!cat || !topic || !content) return fail('category/topic/content 均必填')
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}$/.test(cat)) return fail('分类前缀非法（1-24 位中文/字母/数字/-_）')
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{1,48}$/.test(topic)) return fail('主题词非法（1-48 位中文/字母/数字/-_）')
      if (content.length > 2048) return fail('内容超过 2KB 上限（' + content.length + ' 字符），请拆姊妹文件')
      const fileName = cat + '-' + topic + '.md'
      const now = new Date()
      const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
      const body = '## ' + date + ' ' + cat + '-' + topic + '\n\n' + content + '\n'
      try {
        let dirPath
        if (a.scope === 'global') {
          dirPath = join(GLOBAL_MEMORY_DIR, 'common')
        } else {
          const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined
          const root = typeof cwd === 'string' ? await findProjectRoot(cwd) : undefined
          if (!root) return fail('无法定位项目根')
          dirPath = projectMemDir(root)
          if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
        }
        const fileTarget = await fs.resolve(join(dirPath, fileName))
        const policy = await resolveWritePolicy(exec, a)
        await fs.writeText(fileTarget, body, undefined, undefined, policy)
        return { ok: true, path: fs.processPath(fileTarget), bytes: body.length, error: '' }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e)
        // 沙箱拒绝 → 附加提权指引（与官方 [sandbox: …] 标记同义）
        if (e && e.code === 'FS_SANDBOX_DENIED' && a && a.sandbox_permissions === undefined) {
          return fail(msg + '\n[sandbox: 写入被沙箱拒绝] 可带 sandbox_permissions+justification 重试本次写入（会弹用户审批）')
        }
        return fail(msg)
      }
    },
  })), 'dsh-simple-memory.memory-write')

  // ── webServer RPC：client 设置页/浏览器用（status / init / list / read）──
  // 静态 bundle 的浏览器半没有 harness.handle 配对，改用 HTTP 前缀路由
  // （与 dsh-hud / dsh-perm-guard 同款模式：host 注册路由，client fetch JSON）。
  function writeJson(res, status, body) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  // 读文件内容（相对 memory 根或 common/ 下）
  async function readFileText(relPath) {
    const target = await fs.resolve(relPath)
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') return undefined
    return fs.readText(target)
  }

  async function stagingCount() {
    try {
      const text = await readFileText(join(GLOBAL_MEMORY_DIR, 'staging.md'))
      if (text === undefined) return 0
      // 条目行：`- YYYY-MM-DD ...`（跳过标题/说明/格式样板）
      const lines = text.split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l))
      return lines.length
    } catch (e) { return 0 }
  }

  // ── 记忆根目录配置（读写 web profile 的 cordis.patch.yml，改后需重启生效）──
  // 路径：$DSH_HOME/profiles/web/cordis.patch.yml（找不到 DSH_HOME 时退 ~/.dsh）
  const PATCH_PATH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml')

  function readPatchText() {
    try { return readFileSync(PATCH_PATH, 'utf8') } catch (e) { return undefined }
  }

  // 在 patch 里查找 simple-memory 条目块（从 `- id: simple-memory` 到下一个 `- id:` 或结尾）
  function findSimpleMemoryBlock(text) {
    const lines = text.split('\n')
    let start = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^- id:\s*simple-memory\s*$/.test(lines[i])) { start = i; break }
    }
    if (start === -1) return { start: -1, end: -1, block: '' }
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^- id:/.test(lines[i])) { end = i; break }
    }
    return { start, end, block: lines.slice(start, end).join('\n') }
  }

  // 更新 patch 里的 globalMemoryDir：有条目则替换值，无条目则追加
  function updatePatchGlobalMemoryDir(newDir) {
    let text = readPatchText()
    if (text === undefined) {
      text = '# dsh-simple-memory: 记忆根目录配置（设置页可改，重启生效）\n'
    }
    const { start, end, block } = findSimpleMemoryBlock(text)
    const lines = text.split('\n')
    const quoted = JSON.stringify(newDir)
    if (start === -1) {
      // 无条目：追加（保持 YAML 数组结构）
      const trimmed = text.trimEnd()
      const entry = '\n- id: simple-memory\n  name: \'dsh-simple-memory\'\n  config:\n    globalMemoryDir: ' + quoted + '\n'
      if (trimmed === '[]' || trimmed === '') {
        return text.replace(trimmed, '[]\n' + entry)
      }
      return text + entry
    }
    // 有条目：替换 config.globalMemoryDir 行（无则插入）
    const blockLines = block.split('\n')
    const gIdx = blockLines.findIndex((l) => /^\s+globalMemoryDir:/.test(l))
    const indent = '    '
    if (gIdx >= 0) {
      blockLines[gIdx] = indent + 'globalMemoryDir: ' + quoted
    } else {
      // 在 name 行后插入 config 块
      const nameIdx = blockLines.findIndex((l) => /^\s+name:/.test(l))
      if (nameIdx >= 0) {
        blockLines.splice(nameIdx + 1, 0, '  config:', indent + 'globalMemoryDir: ' + quoted)
      } else {
        blockLines.push('  config:', indent + 'globalMemoryDir: ' + quoted)
      }
    }
    const newLines = [...lines.slice(0, start), ...blockLines, ...lines.slice(end)]
    return newLines.join('\n')
  }

  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-simple-memory',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.local')
          const pathname = url.pathname.replace(/\/+$/, '')
          const q = url.searchParams
          const sessionId = q.get('session')
          const cwdOf = () => {
            if (typeof sessionId !== 'string' || sessions === undefined) return undefined
            const session = sessions.get(sessionId)
            const cwd = session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : undefined
            return cwd
          }

          if (pathname === '/api/dsh-simple-memory/config') {
            if (req.method === 'POST' || req.method === 'PUT') {
              // 读请求体
              let bodyText = ''
              for await (const chunk of req) bodyText += chunk
              let dir
              try { dir = JSON.parse(bodyText || '{}').globalMemoryDir } catch (e) { /* 解析失败走下方校验 */ }
              if (typeof dir !== 'string' || dir.trim() === '') {
                writeJson(res, 400, { ok: false, error: 'globalMemoryDir 必填' })
                return
              }
              const target = dir.trim()
              if (!target.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(target)) {
                writeJson(res, 400, { ok: false, error: '必须是绝对路径（如 /Users/xxx/Documents/DSH/memory）' })
                return
              }
              try {
                const next = updatePatchGlobalMemoryDir(target)
                writeFileSync(PATCH_PATH, next)
                writeJson(res, 200, { ok: true, globalMemoryDir: target, message: '已保存，重启 dsh web 后生效' })
              } catch (e) {
                writeJson(res, 500, { ok: false, error: '写入配置失败：' + String(e && e.message ? e.message : e) })
              }
              return
            }
            writeJson(res, 200, { ok: true, globalMemoryDir: GLOBAL_MEMORY_DIR, patchPath: PATCH_PATH, restartRequired: true })
            return
          }

          if (pathname === '/api/dsh-simple-memory/status') {
            const gMem = (await listMdFiles(join(GLOBAL_MEMORY_DIR, 'common'))).filter(isMemoryEntry)
            writeJson(res, 200, { ok: true, globalIndexCount: gMem.length, stagingCount: await stagingCount() })
            return
          }

          if (pathname === '/api/dsh-simple-memory/init') {
            // 一键初始化全局记忆仓库骨架（幂等：已存在则跳过）
            const created = []
            for (const sub of ['common', 'references', 'archive', 'projects']) {
              const dir = join(GLOBAL_MEMORY_DIR, sub)
              if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(sub + '/') }
            }
            const readmePath = join(GLOBAL_MEMORY_DIR, 'README.md')
            if (!existsSync(readmePath)) {
              await fs.writeText(await fs.resolve(readmePath), [
                '# 记忆根目录',
                '',
                '记忆系统由 dsh-simple-memory 插件维护：',
                '- common/：全局通用经验（分类-主题.md，≤2KB）',
                '- projects/：项目经验（按项目名分目录，如 projects/dsh-simple-memory/）',
                '- references/：冷区参考资料（命中搜索才读）',
                '- archive/：归档（整理后移入）',
                '- staging.md：升格暂存池（跨项目复用候选）',
                '',
              ].join('\n'))
              created.push('README.md')
            }
            const stagingPath = join(GLOBAL_MEMORY_DIR, 'staging.md')
            if (!existsSync(stagingPath)) {
              await fs.writeText(await fs.resolve(stagingPath), [
                '# 升格暂存池（staging）',
                '',
                '可跨项目复用的经验先低摩擦捞到这里（无需当场确认）；池子非空时提醒用户批量整理，用户点头才提炼入 common/。',
                '',
                '## 条目格式',
                '',
                '- 日期 [来源：项目] 经验：xxx 依据：xxx',
                '',
              ].join('\n'))
              created.push('staging.md')
            }
            // git init（失败不阻塞，记忆文件本身已落盘）
            if (shell !== undefined && !existsSync(join(GLOBAL_MEMORY_DIR, '.git'))) {
              try {
                await shell.run(shell.resolve({
                  command: 'git init -q && git add -A && git commit -q -m "init: memory repo skeleton"',
                  workdir: GLOBAL_MEMORY_DIR,
                  timeoutMs: 15000,
                  stdoutMaxBytes: 65536,
                }))
                created.push('git 仓库')
              } catch (e) { /* git 不可用时跳过 */ }
            }
            writeJson(res, 200, { ok: true, message: created.length > 0 ? '已创建：' + created.join('、') : '仓库已就绪（无需初始化）' })
            return
          }

          if (pathname === '/api/dsh-simple-memory/list') {
            // 项目全部平级：projects = 所有有记忆的项目（含当前项目），按项目名排序
            const cwd = cwdOf()
            const projects = []
            const projectsDir = join(GLOBAL_MEMORY_DIR, 'projects')
            try {
              const dirTarget = await fs.resolve(projectsDir)
              const info = await fs.stat(dirTarget)
              if (info !== undefined) {
                const entries = await fs.listDir(dirTarget)
                for (const e of entries) {
                  if (e.type !== 'directory' || e.name.startsWith('.')) continue
                  const files = (await listMdFiles(join(projectsDir, e.name))).filter(isMemoryEntry)
                  if (files.length > 0) projects.push({ name: e.name, files })
                }
              }
            } catch (e) { /* projects 目录不存在时忽略 */ }
            projects.sort((a, b) => a.name.localeCompare(b.name))
            const global = (await listMdFiles(join(GLOBAL_MEMORY_DIR, 'common'))).filter(isMemoryEntry)
            writeJson(res, 200, { ok: true, projects, global })
            return
          }

          if (pathname === '/api/dsh-simple-memory/read') {
            const name = q.get('name')
            if (typeof name !== 'string' || name === '') {
              writeJson(res, 400, { ok: false, error: 'name 参数必填' })
              return
            }
            // name 兼容四种形态：`memory/xxx.md`（当前项目，需 session 定位根）、
            // `project/<项目名>/xxx.md`（其他项目）、`common/xxx.md`（全局 common/）、
            // `~/...`（全局绝对展开，旧版兼容）
            let text
            if (name.startsWith('memory/')) {
              const cwd = cwdOf()
              if (typeof cwd === 'string') {
                const root = await findProjectRoot(cwd)
                text = await readFileText(join(projectMemDir(root), name.slice('memory/'.length)))
              }
            } else if (name.startsWith('project/')) {
              const rest = name.slice('project/'.length)
              const slash = rest.indexOf('/')
              if (slash > 0) {
                const projName = rest.slice(0, slash)
                text = await readFileText(join(GLOBAL_MEMORY_DIR, 'projects', projName, rest.slice(slash + 1)))
              }
            } else if (name.startsWith('common/')) {
              text = await readFileText(join(GLOBAL_MEMORY_DIR, name))
            } else if (name.startsWith('~/')) {
              text = await readFileText(join(homedir(), name.slice(2)))
            } else {
              text = await readFileText(join(GLOBAL_MEMORY_DIR, 'common', name))
            }
            if (text === undefined) {
              writeJson(res, 404, { ok: false, error: '文件不存在或不可读：' + name })
              return
            }
            writeJson(res, 200, { ok: true, content: text })
            return
          }

          writeJson(res, 404, { ok: false, error: 'unknown endpoint: ' + pathname })
        } catch (e) {
          writeJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
        }
      },
    }), 'dsh-simple-memory.webServer')
  }

  console.log('[dsh-simple-memory] host loaded')
}
