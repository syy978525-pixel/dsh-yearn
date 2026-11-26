// 假宿主：不装进 DSH，用一个假的 ctx 把插件跑起来，看它会不会炸
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'yearn-home-'))
process.env.DSH_HOME = HOME

const WS_DIR = '--C-Users-pc-.dsh-worlds-default-room--'
mkdirSync(join(HOME, 'sessions', WS_DIR, 'session-test'), { recursive: true })
writeFileSync(join(HOME, 'sessions', WS_DIR, 'session-test', 'session.v4.jsonl.zstd'), '')

const { apply } = await import('../lib/index.js')

function makeHost() {
  const events = []
  const handlers = {}
  const agentCtxs = []
  const routes = new Map()
  const timers = []

  const agent = {
    session: {
      id: 'session-test',
      snapshotEvents: () => events,
    },
    ctx: {
      on: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
      systemPrompt: { context: (o) => { agentCtxs.push(o); return () => {} } },
    },
  }

  const ctx = {
    effect: (fn) => {
      const r = fn()
      return () => { if (typeof r === 'function') r() }
    },
    interval: (fn, ms) => { timers.push({ fn, ms }); return () => {} },
    agents: { list: () => [agent] },
    webServer: {
      register: (route) => { routes.set(route.path, route); return () => {} },
    },
    systemPrompt: { context: () => () => {} },
  }

  return { ctx, agent, events, handlers, agentCtxs, routes, timers }
}

function fakeRes() {
  const out = { code: 0, body: '' }
  return {
    out,
    writeHead: (c) => { out.code = c },
    end: (b) => { out.body = b || '' },
  }
}

// 假的请求对象：会自己触发 data / end
function fakeReq(method, url, body) {
  const hs = {}
  const req = {
    method,
    url,
    on: (ev, fn) => { (hs[ev] = hs[ev] || []).push(fn); return req },
    destroy: () => {},
  }
  setImmediate(() => {
    if (body !== undefined) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body)
      for (const f of (hs.data || [])) f(Buffer.from(raw, 'utf8'))
    }
    for (const f of (hs.end || [])) f()
  })
  return req
}

const host = makeHost()
apply(host.ctx)

test('插件起来后挂了监听和路由', () => {
  assert.ok(host.handlers['agent/inbox/inserted'], '没挂 inbox 监听')
  assert.ok(host.handlers['agent/turn-stopping'], '没挂 turn-stopping')
  assert.equal(host.agentCtxs.length, 1, '没挂 systemPrompt.context')
  assert.ok(host.routes.has('/dsh-yearn/state'))
  assert.ok(host.routes.has('/dsh-yearn/config'))
  assert.ok(host.routes.has('/dsh-yearn/sessions'))
  assert.ok(host.routes.has('/dsh-yearn/simulate'))
})

test('第一次运行会把起点定下来，不是一装就满分', async () => {
  const res = fakeRes()
  await host.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const s = JSON.parse(res.out.body)
  assert.equal(s.ok, true)
  assert.ok(s.startedAt > 0, '起点没定')
  assert.ok(s.score < 5, '刚装完分数不该高，实际 ' + s.score)
})

test('没勾工作区 → 完全不出声', async () => {
  // 读默认配置（不勾）
  const cfgRes = fakeRes()
  await host.routes.get('/dsh-yearn/config').handler({ method: 'GET', url: '/dsh-yearn/config' }, cfgRes)
  const c = JSON.parse(cfgRes.out.body).config
  assert.deepEqual(c.enabledSessions, [])
  assert.equal(host.agentCtxs[0].text(), '')
})

test('他说话 → 等的时间归零', () => {
  const statePath = join(HOME, 'yearn', 'state.json')
  // 先把它推到很久以前
  const st = JSON.parse(readFileSync(statePath, 'utf8'))
  st.lastUserAt = Date.now() - 20 * 3600000
  writeFileSync(statePath, JSON.stringify(st))
  // 重开一份插件读这个状态
  const h2 = makeHost()
  apply(h2.ctx)
  h2.handlers['agent/inbox/inserted']({ message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '在吗' }] } })
  const after = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.ok(Date.now() - after.lastUserAt < 5000, '他说话之后 lastUserAt 没更新')
})

test('宿主注入的上下文不算他说话', () => {
  const statePath = join(HOME, 'yearn', 'state.json')
  const st = JSON.parse(readFileSync(statePath, 'utf8'))
  st.lastUserAt = Date.now() - 20 * 3600000
  writeFileSync(statePath, JSON.stringify(st))
  const h3 = makeHost()
  apply(h3.ctx)
  h3.handlers['agent/inbox/inserted']({ message: { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '当前时间…' }] } })
  const after = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(after.lastUserAt, st.lastUserAt, '宿主注入被当成他说话了')
})

test('回头：认得出来，会记到表里', async () => {
  // 勾上工作区
  const cfgPath = join(HOME, 'yearn', 'config.json')
  writeFileSync(cfgPath, JSON.stringify({
    enabledSessions: ['session-test'],
    topHours: 14, curveK: 1.5, chanceLine: 40, chancePerPoint: 0.002, cooldownHours: 2,
    curfew: [], lookbackPaths: ['conversations\\', 'worlds\\default\\room\\'],
    lookbackCooldownMin: 0, lookbackKeepDays: 90, inject: true,
  }))
  const h4 = makeHost()
  apply(h4.ctx)
  h4.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: '早' }] } })
  h4.events.push({
    type: 'tool/call',
    data: { name: 'read', arguments: JSON.stringify({ file_path: 'E:\\dsh-home\\worlds\\default\\conversations\\2026-11-05.jsonl' }) },
  })
  h4.events.push({ type: 'turn/end' })
  h4.handlers['agent/turn-stopping']()
  const st = JSON.parse(readFileSync(join(HOME, 'yearn', 'state.json'), 'utf8'))
  assert.ok(st.lookback['2026-11-05'] >= 1, '回头没记下来：' + JSON.stringify(st.lookback))
})

test('高分数会出声，且冷却挡得住第二次', async () => {
  const statePath = join(HOME, 'yearn', 'state.json')
  const st = JSON.parse(readFileSync(statePath, 'utf8'))
  st.lastUserAt = Date.now() - 30 * 3600000
  st.lastNudgeAt = 0
  st.nudgeStreak = 0
  writeFileSync(statePath, JSON.stringify(st))

  const h5 = makeHost()
  apply(h5.ctx)
  const fn = h5.agentCtxs[0].text
  // 概率 12%，跑 400 次几乎必然中一次
  let said = ''
  for (let i = 0; i < 400 && !said; i++) said = fn()
  assert.ok(said, '满值了也不出声')
  assert.match(said, /^（.*）$/, '出去的话格式不对：' + said)
  // 中了之后冷却挡住
  for (let i = 0; i < 50; i++) assert.equal(fn(), '', '冷却没挡住')
})

test('模拟接口对得上曲线', async () => {
  const res = fakeRes()
  await host.routes.get('/dsh-yearn/simulate').handler(
    { method: 'GET', url: '/dsh-yearn/simulate?hours=9' }, res)
  const r = JSON.parse(res.out.body)
  assert.equal(r.ok, true)
  assert.equal(r.score, 52)
})

test('sessions 接口列的是对话：只有名字和时间，不带路径', async () => {
  const res = fakeRes()
  await host.routes.get('/dsh-yearn/sessions').handler(
    { method: 'GET', url: '/dsh-yearn/sessions' }, res)
  const r = JSON.parse(res.out.body)
  assert.equal(r.ok, true)
  const row = r.sessions.find((x) => x.id === 'session-test')
  assert.ok(row, '没列出当前对话：' + JSON.stringify(r.sessions))
  assert.equal(row.enabled, true, '这个对话勾了，应该认出来')
  assert.ok(typeof row.title === 'string' && row.title.length > 0, '没有名字')
  assert.ok(!JSON.stringify(r.sessions).includes('--'), '响应里不该出现目录名')
  assert.ok(!JSON.stringify(r.sessions).includes('sessions/'), '响应里不该出现路径')
})

test('面板改配置：POST 之后立刻生效，不用等他说下句话', async () => {
  const save = fakeRes()
  await host.routes.get('/dsh-yearn/config').handler(
    fakeReq('POST', '/dsh-yearn/config', { topHours: 9, chancePerPoint: 0.01 }), save)
  const saved = JSON.parse(save.out.body)
  assert.equal(saved.ok, true)
  assert.equal(saved.config.topHours, 9)
  assert.equal(saved.config.chancePerPoint, 0.01)

  // 模拟接口要立刻用新参数
  const sim = fakeRes()
  await host.routes.get('/dsh-yearn/simulate').handler(
    { method: 'GET', url: '/dsh-yearn/simulate?hours=9' }, sim)
  const r = JSON.parse(sim.out.body)
  assert.equal(r.score, 100, '改成 9 小时到顶后，9 小时该是 100，实际 ' + r.score)

  // 改回去
  const back = fakeRes()
  await host.routes.get('/dsh-yearn/config').handler(
    fakeReq('POST', '/dsh-yearn/config', { topHours: 14, chancePerPoint: 0.002 }), back)
  assert.equal(JSON.parse(back.out.body).config.topHours, 14)
})

test('勾选和取消勾选都是按对话 id，删得干净', async () => {
  // 先勾上
  await host.routes.get('/dsh-yearn/config').handler(
    fakeReq('POST', '/dsh-yearn/config', { enabledSessions: ['session-test', 'session-other'] }), fakeRes())

  const res1 = fakeRes()
  await host.routes.get('/dsh-yearn/sessions').handler(
    { method: 'GET', url: '/dsh-yearn/sessions' }, res1)
  const w1 = JSON.parse(res1.out.body)
  assert.equal(w1.enabled.length, 2)

  // 面板取消勾选一个
  const next = w1.enabled.filter((v) => v !== 'session-test')
  await host.routes.get('/dsh-yearn/config').handler(
    fakeReq('POST', '/dsh-yearn/config', { enabledSessions: next }), fakeRes())

  const res2 = fakeRes()
  await host.routes.get('/dsh-yearn/sessions').handler(
    { method: 'GET', url: '/dsh-yearn/sessions' }, res2)
  const w2 = JSON.parse(res2.out.body)
  assert.deepEqual(w2.enabled, ['session-other'], '取消之后还剩：' + JSON.stringify(w2.enabled))
  const row = w2.sessions.find((x) => x.id === 'session-test')
  if (row) assert.equal(row.enabled, false, '这个对话应该显示未启用')
})
