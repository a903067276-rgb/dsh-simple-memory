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
import { basename, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

import z from '@deepseek-ai/schemastery'

export const name = 'dsh-simple-memory'
export const inject = ['fs', 'tools', 'webServer', 'sessions', 'shell', 'sandboxPolicy', 'approval']

/** 设置命名空间（与客户端卡片 key 一致；官方"插件配置"页只派发宿主已登记的命名空间） */
const NS = 'simple-memory'

const DEFAULT_MEMORY_DIR = join(homedir(), 'Documents', 'DSH', 'memory')

export function apply(ctx, config) {
  // 注册设置命名空间（2026-08-21 补）：客户端 settings.plugin.item 卡片已注册，
  // 但宿主未登记命名空间时官方"插件配置"页不会派发它——登记后卡片才会显示。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      NS,
      z.object({ globalMemoryDir: z.string().required(false) }),
    )
  })

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

  // ── 模块能力（2026-09-10 v3）：进度区 / mtime / 关键词检索 ──────────────
  // 说明：官方 fs 服务不暴露 mtime（FsInfo 只有 version/type/size），
  // 而"最近动过的记忆"必须按时间排序 → 这里用 node:fs 直读记忆根目录。
  const PROGRESS_DIR = join(GLOBAL_MEMORY_DIR, 'progress')
  const RECENT_LIMIT = 6      // ② 段"最近动过"取几条
  const STALE_DAYS = 14       // 进度/mtime 超过多少天算滞后

  /** 目录下的 md + mtime（不存在返回空）。 */
  function mdFilesWithMtime(dirPath) {
    try {
      return readdirSync(dirPath)
        .filter((n) => /\.md$/i.test(n) && !n.startsWith('.'))
        .map((n) => {
          const full = join(dirPath, n)
          let mtime = 0
          try { mtime = statSync(full).mtimeMs } catch (e) { /* ignore */ }
          return { name: n, path: full, mtime }
        })
    } catch (e) { return [] }
  }

  /** 首行结论（跳过 `## 日期 分类-主题` 标题行；检索/摘要复用同一口径）。 */
  function firstMeaningfulLine(filePath) {
    try {
      const lines = readFileSync(filePath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '')
      const body = lines.filter((l) => !l.startsWith('#'))
      return (body[0] !== undefined ? body[0] : '').slice(0, 140)
    } catch (e) { return '' }
  }

  /** "3 天前" 口径（索引里给人看的相对时间）。 */
  function ago(ms) {
    if (!ms) return '时间未知'
    const diff = Date.now() - ms
    // 当天内给到分钟/小时：只写"今天"看不出滞后，而进度滞后正是这套机制要防的病
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
    if (diff < 21600000) return Math.floor(diff / 3600000) + ' 小时前'
    const days = Math.floor(diff / 86400000)
    if (days <= 0) return '今天早些时候'
    if (days === 1) return '昨天'
    return days + ' 天前'
  }

  function progressFileFor(projectRoot) {
    return join(PROGRESS_DIR, basename(projectRoot) + '.md')
  }

  /** 当前项目进度（全文 + mtime）；没有则 null。 */
  function readProgress(projectRoot) {
    const file = progressFileFor(projectRoot)
    if (!existsSync(file)) return null
    try {
      let mtime = 0
      try { mtime = statSync(file).mtimeMs } catch (e) { /* ignore */ }
      return { text: readFileSync(file, 'utf8').trim(), mtime }
    } catch (e) { return null }
  }

  /** 其他项目的进度一览（项目名 + 时间 + 首行结论），按时间倒序。 */
  function listOtherProgress(excludeProject) {
    return mdFilesWithMtime(PROGRESS_DIR)
      .map((f) => ({ project: f.name.replace(/\.md$/i, ''), mtime: f.mtime, headline: firstMeaningfulLine(f.path) }))
      .filter((x) => x.project !== excludeProject)
      .sort((a, b) => b.mtime - a.mtime)
  }

  /** 其他项目的记忆条数（只有本项目注入明细，别的项目给一行存在感，细节靠 memory_search）。 */
  function otherProjectMemory(excludeProject) {
    let entries
    try { entries = readdirSync(join(GLOBAL_MEMORY_DIR, 'projects'), { withFileTypes: true }) } catch (e) { return [] }
    const out = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === excludeProject) continue
      const files = mdFilesWithMtime(join(GLOBAL_MEMORY_DIR, 'projects', entry.name)).filter((f) => isMemoryEntry(f.name))
      if (files.length > 0) out.push({ name: entry.name, count: files.length, mtime: Math.max(...files.map((f) => f.mtime)) })
    }
    return out.sort((a, b) => b.mtime - a.mtime)
  }

  /** staging 暂存池条目数（池子非空 → 索引尾部提醒整理）。 */
  function stagingCount() {
    try {
      const text = readFileSync(join(GLOBAL_MEMORY_DIR, 'staging.md'), 'utf8')
      return text.split('\n').filter((l) => /^\s*-\s+\d{4}-\d{2}-\d{2}/.test(l)).length
    } catch (e) { return 0 }
  }

  /** 递归收集记忆库 md（深度 ≤3，跳过隐藏目录）。 */
  function walkMd(dirPath, out, depth) {
    if (depth > 3) return
    let entries
    try { entries = readdirSync(dirPath, { withFileTypes: true }) } catch (e) { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dirPath, entry.name)
      if (entry.isDirectory()) { walkMd(full, out, depth + 1); continue }
      if (!/\.md$/i.test(entry.name)) continue
      let mtime = 0
      try { mtime = statSync(full).mtimeMs } catch (e) { /* ignore */ }
      out.push({ path: full, name: entry.name, mtime })
    }
  }

  /** 关键词检索：命中文件名或正文行 → 只回摘要（文件名 + 首行结论 + 命中行），不读全文。 */
  function searchMemory(query, limit) {
    const q = String(query || '').trim().toLowerCase()
    if (q === '') return []
    const files = []
    walkMd(GLOBAL_MEMORY_DIR, files, 0)
    const hits = []
    for (const f of files) {
      const nameHit = f.name.toLowerCase().includes(q)
      let matched = []
      let text = ''
      try { text = readFileSync(f.path, 'utf8') } catch (e) { continue }
      if (!nameHit) {
        const lines = text.split('\n')
        for (let i = 0; i < lines.length && matched.length < 3; i += 1) {
          if (lines[i].toLowerCase().includes(q)) matched.push(lines[i].trim().slice(0, 160))
        }
        if (matched.length === 0) continue
      }
      hits.push({ rel: relative(GLOBAL_MEMORY_DIR, f.path), mtime: f.mtime, first: firstMeaningfulLine(f.path), matched, nameHit })
    }
    hits.sort((a, b) => b.mtime - a.mtime)
    return hits.slice(0, Math.max(1, Math.min(30, limit || 8)))
  }

  // docs/ 宽松过滤：任何非 README/隐藏的 .md 都算（docs 文档不一定带 "分类-主题" 命名）
  function isDocEntry(name) {
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') return false
    return /\.md$/i.test(name)
  }

  async function buildIndex(cwd) {
    const root = await findProjectRoot(cwd)
    const projectName = basename(root)
    const parts = []

    // ── ① 当前项目进度：注入正文（不是文件名）——解决"接续项目状态滞后" ──
    const progress = readProgress(root)
    if (progress !== null) {
      const stale = progress.mtime > 0 && Date.now() - progress.mtime > STALE_DAYS * 86400000
      parts.push('▶ 当前项目进度 progress/' + projectName + '.md（' + ago(progress.mtime)
        + (stale ? ' · ⚠️ 已滞后：与仓库实际不符时以实际为准，并顺手更新它' : '') + '）：\n'
        + progress.text.slice(0, 1200))
    } else {
      parts.push('▶ 当前项目进度：progress/' + projectName + '.md 未建立——掌握现状后（或本轮收尾时）用 memory-progress 建一份')
    }

    // ── ② 最近动过的记忆：标题 + 首行结论（跨项目 + 全局，省 token 但保证"最近踩的坑"自动浮现）──
    const projMemAll = mdFilesWithMtime(projectMemDir(root)).filter((f) => isMemoryEntry(f.name))
    const gMemAll = mdFilesWithMtime(join(GLOBAL_MEMORY_DIR, 'common')).filter((f) => isMemoryEntry(f.name))
    const recent = projMemAll.concat(gMemAll).sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_LIMIT)
    if (recent.length > 0) {
      parts.push('▶ 最近动过的记忆：\n' + recent.map((f) =>
        '- ' + f.name.replace(/\.md$/i, '') + '（' + ago(f.mtime) + '）：' + firstMeaningfulLine(f.path)).join('\n'))
    }

    // ── ③ 其余索引：只给统计，明细走 memory_search 按需检索（不通读）──
    const projDocs = (await listMdFiles(join(root, 'docs'))).filter(isDocEntry)
    const gRoot = mdFilesWithMtime(GLOBAL_MEMORY_DIR).filter((f) => isMemoryEntry(f.name))
    const others = listOtherProgress(projectName)
    const staging = stagingCount()
    const rest = []
    if (projMemAll.length > 0) {
      rest.push('本项目记忆 projects/' + projectName + '/：' + projMemAll.length + ' 条（'
        + groupByCategory(projMemAll.map((f) => f.name)).join('；') + '）')
    }
    if (projDocs.length > 0) {
      rest.push('本项目文档 docs/：' + projDocs.length + ' 个（' + projDocs.slice(0, 8).join('、')
        + (projDocs.length > 8 ? ' 等' : '') + '）')
    }
    if (gMemAll.length > 0) {
      rest.push('全局通用经验 common/：' + gMemAll.length + ' 条（' + groupByCategory(gMemAll.map((f) => f.name)).join('；') + '）')
    }
    if (gRoot.length > 0) rest.push('记忆根目录游离：' + gRoot.length + ' 条')
    if (others.length > 0) {
      rest.push('其他项目进度：' + others.slice(0, 8).map((o) =>
        o.project + '（' + ago(o.mtime) + '）' + (o.headline ? '：' + o.headline.slice(0, 60) : '')).join('；'))
    }
    const otherProj = otherProjectMemory(projectName)
    if (otherProj.length > 0) {
      rest.push('其他项目记忆（要细节用 memory_search）：' + otherProj.map((o) => o.name + ' ' + o.count + ' 条').join('、'))
    }
    if (staging > 0) rest.push('staging 待整理：' + staging + ' 条')
    if (rest.length > 0) parts.push('▶ 全量清单（不要通读；用 memory_search 关键词检索，只回摘要）：\n' + rest.join('\n'))

    if (parts.length === 0) return ''
    return '【记忆索引】下面是你过去踩过的坑、做过的决定（不是普通资料）。动手前花一秒扫一眼：'
      + '凡"最近踩过 + 和现在要做的沾边 + 可能改变做法"的，先读全文再动手；无关的跳过，读完自然用在回答里，不必单独汇报。'
      + '\n' + parts.join('\n')
      + '\n【首次收尾必做一次】本会话第一次收尾（或用户喊停/切换方向这类暂停节点）时，列一次记忆候选并等用户点头——'
      + '哪怕为空也说一句"本次无值得沉淀的内容"。候选两类：①经验/决策/踩坑 → memory-write；'
      + '②换个项目也会遇到的 → 先扔 staging.md（低摩擦，不必当场确认）。**其余各轮不要重复提醒**（由你判断时机）。'
      + '\n【项目进度】做完一件事 / 换方向 / 收尾时，用 memory-progress 更新 progress/<项目>.md。'
      + '**收尾时对照一次**：本次会话推进了什么？上面那份进度（看它的时间）没记的就补上——它是临时态，宁可勤更新，'
      + '落后了下次接续（或别的会话提到这个项目）就会照着过期状态干活。'
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
    description: '按记忆规范强制格式写入一条记忆：文件名必须为 分类-主题.md（分类自造，内置踩坑/流程/决策/偏好/背景），内容 ≤2KB，首行 ## 日期 分类-主题。scope=project 写入 <项目>/memory/，scope=global 写入全局 common/。写入前必须已获用户确认。**写前先扫一眼同分类**：这条和已有的是不是同一件事？同一件就更新/合并旧的（同名即覆盖），全新的才新建，被替代的移 archive/。跨项目也能复用的经验，先追加进 staging.md（低摩擦，不必当场确认）。沙箱拒绝后可用 sandbox_permissions+justification 一次性提权重试（global 写工作区外必弹审批）。调用时请带上 path 参数（目标路径，权限申报用，可让 perm-guard 自动放行免弹窗）。',
    parameters: {
      scope: { type: 'string', required: true, enum: ['project', 'global'], description: 'project=项目记忆；global=全局通用经验' },
      category: { type: 'string', required: true, description: '分类前缀，如 踩坑/流程/决策/偏好/背景 或自造' },
      topic: { type: 'string', required: true, description: '主题词，与分类组成文件名 分类-主题.md' },
      content: { type: 'string', required: true, description: '记忆正文（骨架：日期+结论+来龙去脉），≤2KB' },
      path: { type: 'string', description: '目标路径（相对记忆根，如 common/踩坑-xxx.md 或 projects/<项目名>/xxx.md），权限申报用，须与 scope 一致；写入位置以插件计算为准' },
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
          hint: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'memory-write: ' + (value && value.ok ? '已写入 ' + value.path : '失败 ' + (value && value.error))
          + (value && value.hint ? '\n⚠️ 整理提示：' + value.hint : ''),
      }],
    },
    execute: async (args, exec) => {
      const a = args || {}
      const cat = String(a.category || '').trim()
      const topic = String(a.topic || '').trim()
      const content = String(a.content || '').trim()
      const fail = (error) => ({ ok: false, error, path: '', bytes: 0 })
      if (!cat || !topic || !content) return fail('category/topic/content 均必填')
      // path 申报与 scope 一致性校验（2026-08-18）：path 仅用于权限申报（perm-guard 按路径判定），
      // 写入位置仍以插件计算为准；不一致说明模型填错，提示修正
      const pathArg = typeof a.path === 'string' ? a.path.trim() : ''
      if (pathArg !== '') {
        const p0 = pathArg.split('/')[0]
        if (a.scope === 'global' && p0 !== 'common') return fail('path 与 scope 不一致：scope=global 时 path 应以 common/ 开头，如 common/踩坑-xxx.md')
        if (a.scope === 'project' && p0 !== 'projects') return fail('path 与 scope 不一致：scope=project 时 path 应以 projects/ 开头，如 projects/<项目名>/xxx.md')
      }
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
          // path 声明的项目必须与当前会话项目一致（2026-09-10 修）：不一致时此前会静默写到当前项目，
          // 让人以为记到了别处——现在直接报错，要求在该项目的会话里写。
          const declaredProject = pathArg !== '' ? pathArg.split('/')[1] : ''
          if (typeof declaredProject === 'string' && declaredProject !== '' && declaredProject !== basename(root)) {
            return fail('path 声明的项目「' + declaredProject + '」与当前会话项目「' + basename(root)
              + '」不一致——项目记忆只能写当前项目；要记别的项目请在那个项目的会话里写')
          }
          dirPath = projectMemDir(root)
          if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
        }
        const fullPath = join(dirPath, fileName)
        // ── 写入即治理（2026-09-10 v3）：同名覆盖 / 同分类邻近 / staging 积压，三条提示回给模型 ──
        const existedBefore = existsSync(fullPath)
        const siblings = mdFilesWithMtime(dirPath)
          .filter((f) => f.name !== fileName && f.name.startsWith(cat + '-'))
          .sort((x, y) => y.mtime - x.mtime)
        const fileTarget = await fs.resolve(fullPath)
        const policy = await resolveWritePolicy(exec, a)
        await fs.writeText(fileTarget, body, undefined, undefined, policy)
        const hints = []
        if (existedBefore) hints.push('该文件此前已存在，本次是覆盖——确认是"更新同一条"而非"该换主题另起一条"')
        if (siblings.length > 0 && !existedBefore) {
          hints.push('同分类「' + cat + '」已有 ' + siblings.length + ' 条：'
            + siblings.slice(0, 3).map((f) => f.name.replace(/\.md$/i, '')).join('、')
            + (siblings.length > 3 ? ' 等' : '') + '（若说的是同一件事，考虑合并成一条）')
        }
        const pendingStaging = stagingCount()
        if (pendingStaging > 0) hints.push('staging 暂存池还有 ' + pendingStaging + ' 条待整理（攒够一次提炼进 common/）')
        return { ok: true, path: fs.processPath(fileTarget), bytes: body.length, error: '', hint: hints.join('；') }
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

  // ── memory_search：按需检索（替代"通读索引"，只回摘要不回全文）──────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory_search',
    description: '在记忆库里按关键词检索（记忆根目录下全部 md：项目记忆 / 全局经验 / 进度 / docs），只回摘要——命中文件、首行结论、命中行；命中后再按需读整篇。用于替代"通读索引"省 token：不确定记过什么时先搜一次。',
    parameters: {
      query: { type: 'string', required: true, description: '关键词（中英文均可，大小写不敏感；命中文件名或正文行都算）' },
      limit: { type: 'number', description: '最多返回几条（默认 8，上限 30）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          text: { type: 'string' },
        },
      },
      render: (args, value) => [{ type: 'text', text: (value && value.text) ? value.text : 'memory_search: 无命中' }],
    },
    execute: async (args) => {
      const query = String((args && args.query) || '').trim()
      if (query === '') return { count: 0, text: 'memory_search: query 必填' }
      const hits = searchMemory(query, args && args.limit)
      if (hits.length === 0) return { count: 0, text: 'memory_search「' + query + '」没有命中（换个关键词，或确认这条经验还没记过）' }
      const lines = hits.map((h, i) => (i + 1) + '. ' + h.rel + '（' + ago(h.mtime) + (h.nameHit ? ' · 文件名命中' : '') + '）'
        + (h.first ? '\n   ' + h.first : '')
        + (h.matched.length > 0 ? '\n   命中行：' + h.matched.join(' ｜ ') : ''))
      return { count: hits.length, text: 'memory_search「' + query + '」命中 ' + hits.length + ' 条（只给摘要，需要就看全文）：\n' + lines.join('\n') }
    },
  })), 'dsh-simple-memory.memory_search')

  // ── memory-progress：项目进度（临时态，独立区域 progress/）──────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory-progress',
    description: '覆盖写入当前项目的进度记忆 progress/<项目名>.md（临时态，独立于经验记忆）：做完一件事 / 换方向 / 收尾这类关键节点调用，让下次接续或别的会话提到这个项目时看到的是真实状态而不是滞后状态。正文建议四行骨架：现在做到哪 / 下一步 / 卡在哪 / 相关文档。文件头（日期时间）由插件自动加，正文 ≤1200 字符。',
    parameters: {
      content: { type: 'string', required: true, description: '进度正文（≤1200 字符；四行骨架：现在做到哪 / 下一步 / 卡在哪 / 相关文档）' },
      path: { type: 'string', description: '目标路径申报（progress/<项目名>.md），权限申报用，可让 perm-guard 自动放行免弹窗' },
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
      render: (args, value) => [{ type: 'text', text: 'memory-progress: ' + (value && value.ok ? '已更新 ' + value.path : '失败 ' + (value && value.error)) }],
    },
    execute: async (args, exec) => {
      const a = args || {}
      const content = String(a.content || '').trim()
      const fail = (error) => ({ ok: false, error, path: '', bytes: 0 })
      if (content === '') return fail('content 必填（四行骨架：现在做到哪 / 下一步 / 卡在哪 / 相关文档）')
      if (content.length > 1200) return fail('进度正文超过 1200 字符（' + content.length + '）——进度是临时态，请精简')
      const pathArg = typeof a.path === 'string' ? a.path.trim() : ''
      if (pathArg !== '' && pathArg.split('/')[0] !== 'progress') {
        return fail('path 应以 progress/ 开头，如 progress/<项目名>.md')
      }
      try {
        const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined
        const root = typeof cwd === 'string' ? await findProjectRoot(cwd) : undefined
        if (!root) return fail('无法定位项目根')
        if (!existsSync(PROGRESS_DIR)) mkdirSync(PROGRESS_DIR, { recursive: true })
        // 目标文件（2026-09-10 修）：声明了 path 就按它写——允许更新"别的项目"的进度；
        // 未声明才落到当前项目。此前无论声明什么都会静默写到当前项目，会把当前项目的进度覆盖掉。
        const declared = /^progress\/(.+)\.md$/.exec(pathArg)
        const targetProject = declared !== null && declared[1].trim() !== '' ? declared[1].trim() : basename(root)
        const fileTarget = await fs.resolve(join(PROGRESS_DIR, targetProject + '.md'))
        const policy = await resolveWritePolicy(exec, a)
        const now = new Date()
        const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
        const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
        const body = '## ' + date + ' ' + time + ' ' + basename(root) + '\n\n' + content + '\n'
        await fs.writeText(fileTarget, body, undefined, undefined, policy)
        return { ok: true, path: fs.processPath(fileTarget), bytes: body.length, error: '' }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e)
        if (e && e.code === 'FS_SANDBOX_DENIED' && a.sandbox_permissions === undefined) {
          return fail(msg + '\n[sandbox: 写入被沙箱拒绝] 可带 sandbox_permissions+justification 重试本次写入（会弹用户审批）')
        }
        return fail(msg)
      }
    },
  })), 'dsh-simple-memory.memory-progress')

  // ── session_search：跨会话检索（2026-09-10 v3）──────────────────────────
  // 官方 ctx.sessionQuery 是可选的（sdk-minimal 之类精简组合没有），所以用子注入而非顶层 inject。
  // 全文检索默认关（dsh-base 把 session-query-sqlite 配成 openAt: never），未开启时调用会抛
  // SESSION_QUERY_SEARCH_DISABLED —— 这里回一句可操作的提示，不当作错误。
  ctx.inject(['sessionQuery'], (qctx) => {
    const sessionQuery = qctx.sessionQuery
    qctx.effect(() => qctx.tools.register(defineTool({
      name: 'session_search',
      description: '跨会话检索过去的对话（按关键词搜历史会话正文），返回命中的会话（时间 / 工作区 / 标题）+ 命中片段。用来回答"上次聊 XXX 是哪一次、当时的结论是什么"。不读全量日志：标题走官方的批量快照接口。需要官方会话索引已开启（profile 的 cordis.patch.yml 把 session-query-sqlite 的 openAt 覆盖为 first-search 或 startup）。',
      parameters: {
        query: { type: 'string', required: true, description: '关键词（中英文均可；官方按全文索引匹配，不是正则）' },
        limit: { type: 'number', description: '最多返回几个会话（默认 6，上限 20）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            count: { type: 'number', required: true },
            text: { type: 'string' },
          },
        },
        render: (args, value) => [{ type: 'text', text: (value && value.text) ? value.text : 'session_search: 无结果' }],
      },
      execute: async (args) => {
        const query = String((args && args.query) || '').trim()
        if (query === '') return { count: 0, text: 'session_search: query 必填' }
        const rawLimit = args && typeof args.limit === 'number' ? args.limit : 6
        const limit = Math.max(1, Math.min(20, rawLimit))
        try {
          const page = await sessionQuery.searchSessions({ query, limit })
          const items = page && Array.isArray(page.items) ? page.items : []
          if (items.length === 0) return { count: 0, text: 'session_search「' + query + '」没有命中历史会话（换个关键词，或确认这条内容确实聊过）' }
          // 批量取标题：官方一次折叠多个会话的标题，不解析全量日志
          const titles = new Map()
          try {
            const observations = await sessionQuery.readTitleSnapshots(items.map((it) => it.header.id))
            for (const o of observations) {
              const t = o && o.status === 'fulfilled' && o.value ? o.value.title : undefined
              if (t && typeof t.title === 'string' && t.title !== '') titles.set(o.sessionId, t.title)
            }
          } catch (e) { /* 标题拿不到就用 id 兜底，不影响检索 */ }
          const lines = items.map((it, i) => {
            const header = it.header || {}
            const at = it.bestMatch && typeof it.bestMatch.time === 'number' ? it.bestMatch.time
              : (typeof header.createdAt === 'number' ? header.createdAt : 0)
            const stamp = at > 0 ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
            const project = typeof header.cwd === 'string' && header.cwd !== '' ? basename(header.cwd) : '(未知工作区)'
            const title = titles.get(header.id) || header.id
            const snippet = it.bestMatch && typeof it.bestMatch.snippet === 'string'
              ? it.bestMatch.snippet.replace(/\s+/g, ' ').trim().slice(0, 180) : ''
            return (i + 1) + '. ' + stamp + ' · ' + project + ' · 《' + title + '》' + (snippet !== '' ? '\n   ' + snippet : '')
          })
          return { count: items.length, text: 'session_search「' + query + '」命中 ' + items.length + ' 次会话：\n' + lines.join('\n') }
        } catch (e) {
          const code = e && e.code !== undefined ? String(e.code) : ''
          const msg = String(e && e.message !== undefined ? e.message : e)
          if (code.indexOf('SESSION_QUERY_SEARCH_DISABLED') >= 0 || msg.indexOf('SESSION_QUERY_SEARCH_DISABLED') >= 0) {
            return { count: 0, text: 'session_search 暂不可用：本机未开启官方会话全文索引。开启方式：在 profile 的 cordis.patch.yml 里把 session-query-sqlite 的 openAt 覆盖为 first-search（可配持久 path），重启 dsh 后生效。' }
          }
          return { count: 0, text: 'session_search 失败：' + msg }
        }
      },
    })), 'dsh-simple-memory.session_search')
  })

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

  // 记忆根内安全解析（2026-08-18 修，P1/P2）：resolve 规范化后再校验前缀。
  // join 不规范化、靠"文件不存在"兜底是伪防御——`../` 穿越到真实文件即可读。
  // 这里任何 `../` 逃逸、`~` 展开、绝对路径出根都归一化为根外 → 返回 null（拒绝）。
  function safeResolveIn(base, rel) {
    if (typeof rel !== 'string' || rel.includes('\0') || rel.startsWith('~')) return null
    const root = resolve(base)
    const candidate = resolve(root, rel)
    if (candidate !== root && !candidate.startsWith(root + sep)) return null
    return candidate
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

  // 在 patch 里查找 simple-memory 条目块（从列首 `- id: simple-memory` 到下一个列首 `- id:` 或结尾）
  // 严格匹配（2026-08-18 加固）：块首必须精确为 `- id: simple-memory`（`^` 锚定列首、`\s*$` 拒绝
  // 多余内容），块边界只认列首的列表项行——缩进的 config 子项不算新块。
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

  // 更新 patch 里的 globalMemoryDir：有条目则行级替换，无条目则追加。
  // 2026-08-18 加固：只改 config.globalMemoryDir 一行并保留原行缩进（不重建整个块、
  // 不硬编码缩进层级，避免把 2/4 空格混排写坏 YAML）；值一律 JSON.stringify 转义
  // （输出为合法 YAML 双引号标量，值含引号/反斜杠时安全）。零依赖，不引 yaml 库。
  function updatePatchGlobalMemoryDir(newDir) {
    let text = readPatchText()
    if (text === undefined) {
      text = '# dsh-simple-memory: 记忆根目录配置（设置页可改，重启生效）\n'
    }
    const { start, end, block } = findSimpleMemoryBlock(text)
    const quoted = JSON.stringify(newDir)
    if (start === -1) {
      // 无条目：追加（保持 YAML 顶层数组结构）
      const trimmed = text.trimEnd()
      const entry = '\n- id: simple-memory\n  name: \'dsh-simple-memory\'\n  config:\n    globalMemoryDir: ' + quoted + '\n'
      if (trimmed === '[]' || trimmed === '') {
        return text.replace(trimmed, '[]\n' + entry)
      }
      return text + entry
    }
    // 有条目：只在块内做行级操作
    const lines = text.split('\n')
    const blockLines = block.split('\n')
    const gIdx = blockLines.findIndex((l) => /^\s+globalMemoryDir:/.test(l))
    if (gIdx >= 0) {
      // 保留原行缩进，仅替换键值（行内注释一并丢弃，可接受）
      const origIndent = blockLines[gIdx].match(/^\s*/)[0]
      blockLines[gIdx] = origIndent + 'globalMemoryDir: ' + quoted
    } else {
      // 无 globalMemoryDir 行：在 name 行后插入 config 块，缩进跟随现有 name 行
      const nameIdx = blockLines.findIndex((l) => /^\s+name:/.test(l))
      const cfgIndent = nameIdx >= 0 && blockLines[nameIdx].match(/^\s*/)[0] !== '' ? blockLines[nameIdx].match(/^\s*/)[0] : '  '
      const valIndent = cfgIndent + '  '
      if (nameIdx >= 0) {
        blockLines.splice(nameIdx + 1, 0, cfgIndent + 'config:', valIndent + 'globalMemoryDir: ' + quoted)
      } else {
        blockLines.push(cfgIndent + 'config:', valIndent + 'globalMemoryDir: ' + quoted)
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
            if (name.includes('\0')) {
              writeJson(res, 400, { ok: false, error: 'name 参数非法' })
              return
            }
            // name 兼容四种形态：`memory/xxx.md`（当前项目，需 session 定位根）、
            // `project/<项目名>/xxx.md`（其他项目）、`common/xxx.md`（全局 common/）、
            // `~/...`（旧版兼容，2026-08-18 加固：仅映射到记忆根目录内，不再展开家目录）
            // 安全（P1/P2）：各分支先定位记忆根内的基准目录，再经 safeResolveIn
            // 规范化 + 前缀校验；`../` 逃逸/~ 展开出根 → 400；文件不存在 → 404（不回显路径）。
            let base = undefined
            let rel = undefined
            if (name.startsWith('memory/')) {
              const cwd = cwdOf()
              if (typeof cwd === 'string') {
                const root = await findProjectRoot(cwd)
                base = projectMemDir(root)
                rel = name.slice('memory/'.length)
              }
            } else if (name.startsWith('project/')) {
              const rest = name.slice('project/'.length)
              const slash = rest.indexOf('/')
              if (slash > 0) {
                base = join(GLOBAL_MEMORY_DIR, 'projects', rest.slice(0, slash))
                rel = rest.slice(slash + 1)
              }
            } else if (name.startsWith('common/')) {
              base = join(GLOBAL_MEMORY_DIR, 'common')
              rel = name.slice('common/'.length)
            } else if (name.startsWith('~/')) {
              base = GLOBAL_MEMORY_DIR
              rel = name.slice(2)
            } else {
              base = join(GLOBAL_MEMORY_DIR, 'common')
              rel = name
            }
            if (base === undefined) {
              writeJson(res, 400, { ok: false, error: '无法定位记忆根（memory/ 前缀需带 session 参数）' })
              return
            }
            const target = safeResolveIn(base, rel)
            if (target === null) {
              writeJson(res, 400, { ok: false, error: '路径越界：只允许读取记忆根目录内的文件' })
              return
            }
            const text = await readFileText(target)
            if (text === undefined) {
              writeJson(res, 404, { ok: false, error: '文件不存在或不可读' })
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
