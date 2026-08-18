/**
 * dsh-simple-memory — Host 半
 *
 * DSH 记忆系统入口：存储零代码（md 文件分层 + 约定），插件只管入口。
 * 1. agent/pre-step 首步注入记忆索引（项目 memory/ + docs/ + 全局 common/）
 * 2. memory-write 工具：强制格式写入（分类-主题.md / ≤2KB / 日期首行）
 * 3. harness.handle RPC（client 设置页/浏览器用）：status / init / list / read
 *
 * 跨平台：路径 node:path join；家目录 os.homedir；记忆根目录为配置项
 * （config.globalMemoryDir，默认 ~/Documents/DSH/memory）。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-simple-memory'
export const inject = ['fs', 'tools']

const DEFAULT_MEMORY_DIR = join(homedir(), 'Documents', 'DSH', 'memory')

export function apply(ctx, config) {
  const fs = ctx.get('fs')
  if (fs === undefined) return

  const GLOBAL_MEMORY_DIR = (config && typeof config.globalMemoryDir === 'string' && config.globalMemoryDir !== '')
    ? config.globalMemoryDir
    : DEFAULT_MEMORY_DIR
  let injected = false

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
    const projMem = (await listMdFiles(join(root, 'memory'))).filter(isMemoryEntry)
    const projDocs = (await listMdFiles(join(root, 'docs'))).filter(isMemoryEntry)
    const gMem = (await listMdFiles(join(GLOBAL_MEMORY_DIR, 'common'))).filter(isMemoryEntry)
    if (projMem.length > 0) lines.push('本项目记忆 memory/：' + groupByCategory(projMem).join('；'))
    if (projDocs.length > 0) lines.push('本项目文档 docs/：' + projDocs.join('、'))
    if (gMem.length > 0) lines.push('全局通用经验 common/：' + groupByCategory(gMem).join('；'))
    if (lines.length === 0) return ''
    return '【记忆索引】相关时按需读全文（单文件 ≤2KB），先活跃后冷区（references/、archive/ 命中搜索才读）：\n' + lines.join('\n')
  }

  // ── 忆的入口：首步注入索引（waterfall 必须 next()）──
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (injected) return decision
    injected = true
    if (decision.kind === 'reject') return decision
    try {
      const cwd = agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined
      if (typeof cwd !== 'string') return decision
      const text = await buildIndex(cwd)
      if (!text) return decision
      const msg = { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name } }
      const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m))
      return { kind: 'enter', messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, msg) }
    } catch (e) {
      console.error('[dsh-simple-memory] index inject failed:', e)
      return decision
    }
  })

  // ── memory-write 工具：强制格式写入 ──
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory-write',
    description: '按记忆规范强制格式写入一条记忆：文件名必须为 分类-主题.md（分类自造，内置踩坑/流程/决策/偏好/背景），内容 ≤2KB，首行 ## 日期 分类-主题。scope=project 写入 <项目>/memory/，scope=global 写入全局 common/。写入前必须已获用户确认。',
    parameters: {
      scope: { type: 'string', required: true, enum: ['project', 'global'], description: 'project=项目记忆；global=全局通用经验' },
      category: { type: 'string', required: true, description: '分类前缀，如 踩坑/流程/决策/偏好/背景 或自造' },
      topic: { type: 'string', required: true, description: '主题词，与分类组成文件名 分类-主题.md' },
      content: { type: 'string', required: true, description: '记忆正文（骨架：日期+结论+来龙去脉），≤2KB' },
    },
    output: {
      schema: {
        type: 'object',
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
          dirPath = join(root, 'memory')
        }
        const fileTarget = await fs.resolve(join(dirPath, fileName))
        await fs.writeText(fileTarget, body)
        return { ok: true, path: fs.processPath(fileTarget), bytes: body.length, error: '' }
      } catch (e) {
        return fail(String(e && e.message ? e.message : e))
      }
    },
  })), 'dsh-simple-memory.memory-write')

  console.log('[dsh-simple-memory] host loaded')
}
