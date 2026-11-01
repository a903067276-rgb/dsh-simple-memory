// 回合收尾自动提交（commitIfDirty）离线测试
//
// 目标：把 lib/index.js 里的 commitIfDirty 函数切出来，用假 shell/commitMemory 覆盖：
//   ① 仓库干净 → 不产生 commit
//   ② 有改动 → 调 commitMemory（action=自动收尾）
//   ③ git status 非零 → 返回 failed，不 commit
//   ④ shell 抛错 → 返回 failed，不 commit
// 不碰真实记忆库；不做 git 集成测试（那部分由 web 3080 真机验收）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = new URL('../lib/index.js', import.meta.url)
const source = readFileSync(SRC, 'utf8')

function extractFunction(src, signature) {
  const start = src.indexOf(signature)
  if (start < 0) throw new Error(`找不到函数：${signature}`)
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`函数不完整：${signature}`)
}

const fnSrc = extractFunction(source, 'async function commitIfDirty(')

function makeSweep({ statusResult, statusThrows = false, calls }) {
  const factory = new Function(
    'autoCommitOn', 'shell', 'memDir', 'existsSync', 'join', 'runShellOnce', 'commitMemory',
    `return (${fnSrc})`,
  )
  return factory(
    () => true,
    { fake: true },
    () => '/tmp/mem',
    () => true,
    (a, b) => `${a}/${b}`,
    async (_shell, req) => {
      calls.push({ kind: 'status', req })
      if (statusThrows) throw new Error('sandbox denied')
      return statusResult
    },
    async (action, subject, policy) => {
      calls.push({ kind: 'commit', action, subject, policy })
      return 'ok'
    },
  )
}

test('仓库干净：不 commit', async () => {
  const calls = []
  const sweep = makeSweep({ calls, statusResult: { exitCode: 0, stdout: { text: '' } } })
  const out = await sweep('自动收尾', 'plugin-dev', { mode: 'danger-full-access' })
  assert.equal(out, 'clean')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].kind, 'status')
  assert.equal(calls[0].req.command, 'git status --porcelain')
  assert.equal(calls[0].req.sandboxPolicy.mode, 'danger-full-access')
})

test('有改动：调 commitMemory 收尾', async () => {
  const calls = []
  const sweep = makeSweep({ calls, statusResult: { exitCode: 0, stdout: { text: ' M progress/plugin-dev.md\n' } } })
  const policy = { mode: 'danger-full-access' }
  const out = await sweep('自动收尾', 'plugin-dev', policy)
  assert.equal(out, 'ok')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], { kind: 'commit', action: '自动收尾', subject: 'plugin-dev', policy })
})

test('git status 非零：failed，不 commit', async () => {
  const calls = []
  const sweep = makeSweep({ calls, statusResult: { exitCode: 128, stderr: { text: 'not a git repository' } } })
  const out = await sweep('自动收尾', 'plugin-dev', undefined)
  assert.match(out, /^failed:status exit 128/)
  assert.equal(calls.length, 1)
})

test('shell 抛错：failed，不 commit', async () => {
  const calls = []
  const sweep = makeSweep({ calls, statusThrows: true })
  const out = await sweep('自动收尾', 'plugin-dev', undefined)
  assert.match(out, /^failed:sandbox denied/)
  assert.equal(calls.length, 1)
})
