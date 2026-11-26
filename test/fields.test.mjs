// 字段一致性检查：前端用到的东西，后端必须真的有
//
// 2026-11-27 踩过：前端改成读 cfg.enabledSessions，后端还在给 enabledWorkspaces，
// 前端读到 undefined，一取 .length 整块面板就渲染不出来了。
// 这个测试就是为了让这种事没法再偷偷发生。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const HOME = mkdtempSync(join(tmpdir(), 'yearn-fields-'))
process.env.DSH_HOME = HOME

const WS = '--C-Users-x-dsh-worlds-default-room--'
mkdirSync(join(HOME, 'sessions', WS, 'session-a'), { recursive: true })
writeFileSync(join(HOME, 'sessions', WS, 'session-a', 'session.v4.jsonl.zstd'), '')

const { apply } = await import('../lib/index.js')

function host() {
  const routes = new Map()
  const events = []
  const agentCtxs = []
  const agent = {
    session: { id: 'session-a', snapshotEvents: () => events },
    ctx: {
      on: () => () => {},
      systemPrompt: { context: (o) => { agentCtxs.push(o); return () => {} } },
    },
  }
  const ctx = {
    effect: (fn) => { const r = fn(); return () => { if (typeof r === 'function') r() } },
    interval: () => () => {},
    agents: { list: () => [agent] },
    webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
    systemPrompt: { context: () => () => {} },
  }
  return { ctx, routes, events, agentCtxs, agent }
}

function fakeRes() {
  const out = { code: 0, body: '' }
  return { out, writeHead: (c) => { out.code = c }, end: (b) => { out.body = b || '' } }
}

const CLIENT = readFileSync(join(PKG, 'client.js'), 'utf8')

function namesUsedInClient(prefix) {
  const re = new RegExp('\\b' + prefix + '\\.([A-Za-z_$][\\w$]*)', 'g')
  const out = new Set()
  let m
  while ((m = re.exec(CLIENT))) out.add(m[1])
  return out
}

test('前端用到的 cfg 字段，后端配置里都得有', async () => {
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/config').handler({ method: 'GET', url: '/dsh-yearn/config' }, res)
  const cfg = JSON.parse(res.out.body).config
  const have = new Set(Object.keys(cfg))
  const allow = new Set()
  const used = namesUsedInClient('cfg')
  const missing = [...used].filter((k) => !have.has(k) && !allow.has(k))
  assert.deepEqual(missing, [], '前端读了后端没有的配置字段：' + missing.join(', '))
})

test('前端用到的 state 字段，后端 /state 里都得有', async () => {
  const h = host()
  apply(h.ctx)
  const res = fakeRes()
  await h.routes.get('/dsh-yearn/state').handler({ method: 'GET', url: '/dsh-yearn/state' }, res)
  const st = JSON.parse(res.out.body)
  const have = new Set(Object.keys(st))
  const used = namesUsedInClient('st')
  const missing = [...used].filter((k) => !have.has(k))
  assert.deepEqual(missing, [], '前端读后端没有的 state 字段：' + missing.join(', '))
})

test('前端请求的接口，后端都注册了', async () => {
  const h = host()
  apply(h.ctx)
  const paths = [...h.routes.keys()].map((p) => p.replace('/dsh-yearn', ''))
  const re = /API \+ '(\/[a-z]+)'/g
  const asked = new Set()
  let m
  while ((m = re.exec(CLIENT))) asked.add(m[1])
  const missing = [...asked].filter((p) => !paths.includes(p))
  assert.deepEqual(missing, [], '前端请求了没注册的接口：' + missing.join(', '))
})

test('配置里没有旧的字段名残留', () => {
  const idx = readFileSync(join(PKG, 'lib', 'index.js'), 'utf8')
  assert.ok(!/enabledWorkspaces/.test(idx), '后端还有 enabledWorkspaces 残留')
  assert.ok(!/dsh-feiyu-yearn/.test(idx + CLIENT), '还有旧插件名残留')
  assert.ok(!/feiyu-mood/.test(idx), '不该提到别的插件')
})

test('CSS 里每个属性选择器的方括号都配平', () => {
  const cssStart = CLIENT.indexOf('const CSS = `')
  const cssEnd = CLIENT.indexOf('`', cssStart + 15)
  assert.ok(cssStart > 0 && cssEnd > cssStart, '没找到 CSS 段')
  const css = CLIENT.slice(cssStart + 13, cssEnd)
  let depth = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '[') depth++
    else if (css[i] === ']') depth--
    if (depth < 0) assert.fail('CSS 第 ' + i + ' 个字符处 ] 多了一个')
  }
  assert.equal(depth, 0, 'CSS 里有 ' + depth + ' 个 [ 没闭合')

  // 属性选择器里不该出现后代选择器（[a b] 这种是写错了）
  const bad = css.match(/\[[a-zA-Z-]+ [a-zA-Z-]+/g) || []
  assert.deepEqual(bad, [], '属性选择器里混进了空格/后代选择器：' + bad.join(', '))
})
