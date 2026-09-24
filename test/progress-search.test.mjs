// 记忆 v3 离线冒烟测试（2026-09-10 新增）
//
// 覆盖本轮新增的三块能力：
//   ① 进度区：progress/<项目>.md 的读写与"其他项目一览"
//   ② 检索：memory_search 的关键词命中（文件名 / 正文行）+ 只回摘要不回全文
//   ③ 时间口径：ago() 与 mtime 排序
// 做法与 perm-guard 的离线测试一致：从 lib/index.js 文本里切出助手函数段，
// 注入 node:fs / node:path 与记忆根目录，在临时目录上跑断言（不碰真实记忆库）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'

const SRC = new URL('../lib/index.js', import.meta.url)
const source = readFileSync(SRC, 'utf8')
const start = source.indexOf('  // ── 模块能力（2026-09-10 v3）')
const end = source.indexOf('  // docs/ 宽松过滤')
if (start < 0 || end < 0 || end <= start) throw new Error('助手段标记未找到')
const helpers = source.slice(start, end)

/**
 * 在受控作用域里实例化助手函数（记忆根目录由测试注入）。
 * 2026-09-24（DSH 0.1.7 迁移）：lib 里记忆根目录不再是常量 GLOBAL_MEMORY_DIR，而是
 * 每次现读的 memDir()（配置热改即时生效），所以这里注入的是**返回临时目录的函数**；
 * 同时修掉两处陈旧引用：stagingCount → stagingCountSync（2026-09-12 改名后测试没跟上，
 * 本次迁移前 3 个用例即因此全红）、PROGRESS_DIR → progressDir()（同一次迁移）。
 */
function makeHelpers(memoryDir) {
  const factory = new Function('memDir', 'fsMod', 'pathMod', `"use strict";
    const { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } = fsMod;
    const { join, basename, relative } = pathMod;
    ${helpers}
    return { mdFilesWithMtime, firstMeaningfulLine, ago, progressFileFor, readProgress, listOtherProgress, stagingCountSync, searchMemory, progressDir };
  `)
  return factory(() => memoryDir, nodeFs, nodePath)
}

function makeMemoryDir() {
  const root = join(tmpdir(), 'mem-v3-test-' + Math.random().toString(36).slice(2, 8))
  mkdirSync(join(root, 'projects', 'demo'), { recursive: true })
  mkdirSync(join(root, 'common'), { recursive: true })
  mkdirSync(join(root, 'progress'), { recursive: true })
  return root
}

const ago = (days) => new Date(Date.now() - days * 86400000)

test('进度区：读写当前项目进度 + 其他项目一览', () => {
  const root = makeMemoryDir()
  try {
    const h = makeHelpers(root)

    // 无进度文件 → null
    assert.equal(h.readProgress(join(root, 'projects', 'demo')), null)

    // 写入 demo 进度
    const demoFile = h.progressFileFor(join(root, 'projects', 'demo'))
    assert.equal(demoFile, join(root, 'progress', 'demo.md'))
    writeFileSync(demoFile, '## 2026-09-10 13:00 demo\n\n现在做到哪：X\n下一步：Y\n', 'utf8')
    utimesSync(demoFile, ago(2), ago(2))

    const cur = h.readProgress(join(root, 'projects', 'demo'))
    assert.ok(cur !== null && cur.text.includes('下一步：Y'), '当前项目进度应能读出正文')
    assert.ok(Date.now() - cur.mtime > 86400000, 'mtime 应被读到（用于滞后判断）')

    // 另一个项目
    writeFileSync(join(root, 'progress', 'other.md'), '## 2026-09-09 10:00 other\n\n现在做到哪：Z\n', 'utf8')
    utimesSync(join(root, 'progress', 'other.md'), ago(5), ago(5))

    const others = h.listOtherProgress('demo')
    assert.equal(others.length, 1, '不应包含当前项目自己')
    assert.equal(others[0].project, 'other')
    assert.ok(others[0].headline.includes('现在做到哪：Z'), '一览要带首行结论（跳过标题行）')
    assert.ok(others[0].mtime > 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('检索：文件名命中 + 正文命中，只回摘要', () => {
  const root = makeMemoryDir()
  try {
    const h = makeHelpers(root)
    writeFileSync(join(root, 'common', '踩坑-端口占用.md'),
      '## 2026-09-01 踩坑-端口占用\n\n结论：3000 端口被占时先 lsof 再 kill。\n来龙去脉：…\n', 'utf8')
    writeFileSync(join(root, 'projects', 'demo', '决策-构建方案.md'),
      '## 2026-09-05 决策-构建方案\n\n结论：用 pnpm 不用 npm。\n备注：端口占用时的处理见别处。\n', 'utf8')
    writeFileSync(join(root, 'common', '流程-无关条目.md'), '## 2026-09-02 流程-无关条目\n\n结论：别的。\n', 'utf8')

    // 文件名命中（注意：另一条决策的正文也提到"端口"，所以这里应是 2 条命中，
    // 其中文件名命中的那条要带 nameHit 标记）
    const byName = h.searchMemory('端口', 8)
    assert.equal(byName.length, 2, '文件名命中 + 正文命中各一条')
    const nameHit = byName.find((x) => x.nameHit === true)
    assert.ok(nameHit, '应有一条是文件名命中')
    assert.ok(nameHit.first.includes('结论：3000 端口'), '要带首行结论（跳过标题行）')
    const bodyHit = byName.find((x) => x.nameHit === false)
    assert.ok(bodyHit && bodyHit.matched.some((l) => l.includes('端口占用时的处理')), '正文命中要回命中行')

    // 正文命中（文件名不含关键词）
    const byBody = h.searchMemory('pnpm', 8)
    assert.equal(byBody.length, 1, '正文含 pnpm 的那条应命中')
    assert.equal(byBody[0].nameHit, false)
    assert.ok(byBody[0].matched.length > 0 && byBody[0].matched[0].includes('pnpm'), '要回命中行')

    // 不该命中的不出现
    assert.equal(h.searchMemory('绝对不存在的词xyz', 8).length, 0)
    // 空查询不返回任何东西（避免把整库倒出来）
    assert.equal(h.searchMemory('   ', 8).length, 0)
    // limit 生效
    writeFileSync(join(root, 'common', '踩坑-端口占用-补充.md'), '## 2026-09-03 补充\n\n端口另注。\n', 'utf8')
    assert.equal(h.searchMemory('端口', 1).length, 1, 'limit=1 应只回 1 条')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('staging 池计数与时间口径', () => {
  const root = makeMemoryDir()
  try {
    const h = makeHelpers(root)
    writeFileSync(join(root, 'staging.md'), [
      '# 升格暂存池（staging）',
      '',
      '- 2026-09-01 [来源：demo] 经验：A',
      '  - 说明行不算条目',
      '- 2026-09-02 [来源：demo] 经验：B',
      '',
    ].join('\n'), 'utf8')
    assert.equal(h.stagingCountSync(), 2, '只数 "- 日期" 开头的条目')

    // 当天内给到分钟/小时——滞后要看得出来（只写"今天"等于没信号）
    assert.equal(h.ago(Date.now()), '刚刚')
    assert.equal(h.ago(Date.now() - 5 * 60000), '5 分钟前')
    assert.equal(h.ago(Date.now() - 2 * 3600000), '2 小时前')
    assert.equal(h.ago(Date.now() - 8 * 3600000), '今天早些时候')
    assert.equal(h.ago(Date.now() - 86400000), '昨天')
    assert.equal(h.ago(Date.now() - 3 * 86400000), '3 天前')
    assert.equal(h.ago(0), '时间未知')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
