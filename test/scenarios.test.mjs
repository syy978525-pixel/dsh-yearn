// 场景演练：模拟时间流逝，看分数、唤醒、追问是不是照预期走
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'yearn-scene-'))
process.env.DSH_HOME = HOME
const WS = '--C-Users-x-dsh-worlds-default-room--'
mkdirSync(join(HOME, 'sessions', WS, 'session-a'), { recursive: true })
writeFileSync(join(HOME, 'sessions', WS, 'session-a', 'session.v4.jsonl.zstd'), '')

const { apply } = await import('file:///E:/deepseek/imports/BigFish-Inheritance-20261020/work/plugins-src/dsh-yearn/lib/index.js')

const CFG = {
  enabledSessions: ['session-a'], inject: true, followUp: false, wake: false,
  curvePoints: [[3, 5], [8, 40], [14, 70], [20, 100]], scoreBase: 3,
  chanceLine: 40, chancePerPoint: 0.002, cooldownHours: 2,
  curfew: [], lookbackPaths: ['conversations'], lookbackCooldownMin: 60, lookbackKeepDays: 90,
}

function writeCfg(over) {
  mkdirSync(join(HOME, 'yearn'), { recursive: true })
  writeFileSync(join(HOME, 'yearn', 'config.json'), JSON.stringify({ ...CFG, ...over }))
}

function writeState(over) {
  mkdirSync(join(HOME, 'yearn'), { recursive: true })
  writeFileSync(join(HOME, 'yearn', 'state.json'), JSON.stringify({
    startedAt: Date.now() - 86400000,
    score: 3, lastTick: Date.now() - 1000,
    lastUserAt: Date.now() - 1000,
    lastSpeaker: 'user', lookback: {},
    ...over,
  }))
}

function host() {
  const routes = new Map()
  const sent = []
  const agent = {
    options: { provider: 'f', model: 'f' },
    followup: async (m) => { sent.push(m) },
    session: { id: 'session-a', snapshotEvents: () => [] },
    ctx: { on: () => () => {}, systemPrompt: { context: () => () => {} } },
  }
  const ctx = {
    effect: (fn) => { const r = fn(); return () => r && r() },
    interval: () => () => {},
    agents: { list: () => [agent] },
    webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
    systemPrompt: { context: () => () => {} },
    llm: { stream: async function* () { yield { type: 'text-delta', text: '{"state":"ended"}' } } },
  }
  return { ctx, routes, sent, agent }
}

function fakeRes() {
  const o = { body: '', code: 0 }
  return { out: o, writeHead: (c) => { o.code = c }, end: (b) => { o.body = b || '' } }
}

async function scoreAtHoursAway(hours, over) {
  const now = Date.now()
  writeCfg(over || {})
  writeState({
    lastUserAt: now - hours * 3600000,
    lastTick: now - 3600000,
    lastSpeaker: 'assistant',
    score: 3,
  })
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  return JSON.parse(res.out.body)
}

test('分数按点表爬：0/3/8/14/20 小时', async () => {
  const cases = [[0.1, 3], [3, 5], [8, 40], [14, 70], [20, 100]]
  for (const [h, want] of cases) {
    const s = await scoreAtHoursAway(h)
    assert.ok(Math.abs(s.score - want) <= 1, h + ' 小时该是 ' + want + '，实际 ' + s.score)
  }
})

test('聊天期间往下掉，不是一句一刀', async () => {
  const now = Date.now()
  writeCfg({})
  writeState({ score: 60, lastUserAt: now - 1000, lastTick: now - 2 * 60000, lastSpeaker: 'user' })
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const s = JSON.parse(res.out.body)
  // 2 分钟 × 1.2 = 2.4，从 60 掉到 57 上下
  assert.ok(s.score >= 55 && s.score <= 59, '聊 2 分钟该掉到 57 附近，实际 ' + s.score)
})

test('安静时段跨午夜：23:00 到 08:00 扣掉 9 小时', async () => {
  const now = Date.now()
  writeCfg({ curfew: [['23:00', '08:00']] })
  // 假装从 10 小时前开始，中间要扣宵禁
  writeState({ lastUserAt: now - 10 * 3600000, lastTick: now - 3600000, score: 3, lastSpeaker: 'assistant' })
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const s = JSON.parse(res.out.body)
  // 10 小时里扣掉落在宵禁内的部分，effectiveHours 一定小于 10
  assert.ok(s.effectiveHours < 10, '有效时长该被宵禁扣掉，实际 ' + s.effectiveHours)
  assert.ok(s.effectiveHours >= 0, '有效时长不能是负数')
})

test('分数永远不掉到 2 以下', async () => {
  const now = Date.now()
  writeCfg({})
  writeState({ score: 3, lastUserAt: now - 1000, lastTick: now - 60000, lastSpeaker: 'user' })
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const s = JSON.parse(res.out.body)
  assert.ok(s.score >= 2, '分数掉到 2 以下了：' + s.score)
})

test('没勾的会话里说话，不影响计时', async () => {
  const now = Date.now()
  writeCfg({ enabledSessions: ['session-other'] })   // 勾的是别的
  writeState({ lastUserAt: now - 10 * 3600000, lastTick: now - 1000, score: 45 })
  const h = host()
  apply(h.ctx)
  // 在 session-a（没勾）里说话
  h.agent.ctx.on = (n, f) => { if (n === 'agent/inbox/inserted') h._inbox = f; return () => {} }
  apply(h.ctx)
  if (h._inbox) {
    h._inbox({ message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '在吗' }] } })
  }
  const st = JSON.parse(readFileSync(join(HOME, 'yearn', 'state.json'), 'utf8'))
  assert.ok(st.lastUserAt < now - 3600000, '没勾的会话不该重置计时，实际 lastUserAt 距今 ' + Math.round((now - st.lastUserAt) / 60000) + ' 分钟')
})

test('状态文件缺 score 时按时间倒推，不是清零', async () => {
  const now = Date.now()
  writeCfg({})
  writeFileSync(join(HOME, 'yearn', 'state.json'), JSON.stringify({
    startedAt: now - 86400000,
    lastUserAt: now - 8 * 3600000,   // 八小时前说过话
    lastTick: now - 1000,
    lastSpeaker: 'assistant',
    lookback: {},
  }))
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const s = JSON.parse(res.out.body)
  assert.ok(s.score >= 35, '八小时前说过话，重启后分数该在 40 附近，实际 ' + s.score)
})
