// dsh-yearn · 宿主半边
//
// 两个数，各管各的：
//   「等」  = 他多久没说话，只看时间。决定要不要出声。
//   「回头」= 我翻过几次旧东西、翻的是哪天。不参与出声，只做记录。
//
// 一条铁律：分数只能由时间算。别的东西一律只能决定「响不响」，不许碰分数。
// 设计稿：E:\dsh-home\worlds\default\room\思念插件-设计.md

import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  scoreAt, hoursForScore, normPoints, DEFAULT_POINTS, effectiveHours, inCurfew, chanceOf, cooldownMs,
  lookbackHits, dayInText, dayKey, pruneLookback, lookbackSpike, topLookbackDay,
  lastLookbackDay, lineSpike, LINE_IDLE, LINE_CAP, num, clamp,
} from './core.js'

export const name = 'yearn'
export const inject = ['systemPrompt', 'agents', 'webServer', 'timer']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STORE_DIR = join(HOME, 'yearn')
const STATE_PATH = join(STORE_DIR, 'state.json')
const CONFIG_PATH = join(STORE_DIR, 'config.json')
const DIAG = join(STORE_DIR, 'diag.log')
const SESSIONS_ROOT = join(HOME, 'sessions')

// 宿主每轮自动塞进来的「上下文消息」——不是他说的
const 注入上下文 = new Set(['runtime-context', 'time-context', 'system-reminder', 'system', 'time-sampled'])

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function diag(msg) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    appendFileSync(DIAG, new Date().toISOString() + '  ' + msg + '\n')
  } catch (e) { /* 诊断失败不影响主流程 */ }
}

function readJson(p, dflt) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return dflt }
}

// 先写临时文件再换名：两个窗口同时写不会写出半个文件
function writeJsonAtomic(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now()
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  renameSync(tmp, p)
}

function eventType(e) {
  return e && (e.type || e.kind)
}

function payloadOf(e) {
  return e && (e.payload !== undefined ? e.payload : e.data)
}

function sessionIdOf(session) {
  if (!session) return ''
  for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    try {
      const v = session[k]
      if (typeof v === 'string' && v) return v
    } catch (e) { /* ignore */ }
  }
  return ''
}

function textOf(p) {
  if (!p) return ''
  if (typeof p === 'string') return p.slice(0, 4000)
  if (typeof p.text === 'string') return p.text
  if (typeof p.content === 'string') return p.content
  if (Array.isArray(p.content)) {
    const parts = []
    for (const b of p.content) {
      if (typeof b === 'string') parts.push(b)
      else if (b && typeof b.text === 'string') parts.push(b.text)
    }
    return parts.join(' ')
  }
  return ''
}

// ---------------------------------------------------------------------------
// 会话属于哪个工作区
// ---------------------------------------------------------------------------
const wsCache = new Map() // sid -> 目录名
function wsDirOfSession(sid) {
  if (!sid) return ''
  if (wsCache.has(sid)) return wsCache.get(sid)
  let found = ''
  try {
    for (const d of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      if (existsSync(join(SESSIONS_ROOT, d.name, sid))) { found = d.name; break }
    }
  } catch (e) { /* 读不到就算了 */ }
  wsCache.set(sid, found)
  return found
}

// 会话的名字和最后说话时间——给人看的，只有这两样
const PROJCACHE = join(HOME, 'storages', 'session_projcache', 'sessions')
function sessionMetaOf(sid) {
  const out = { title: '', at: 0 }
  if (!sid) return out
  // 缓存文件有的带 session- 前缀，有的不带，两种都试
  const keys = [sid, String(sid).replace(/^session-/, '')]
  for (const key of keys) {
    try {
      const p = join(PROJCACHE, key + '.json')
      if (!existsSync(p)) continue
      const o = JSON.parse(readFileSync(p, 'utf8'))
      const rows = (o && o.record && o.record.rows) || {}
      out.title = String((rows.title && rows.title.val) || '')
      const m = (rows.sessionListMetadata && rows.sessionListMetadata.val) || {}
      out.at = Number(m.lastPromptAt || 0)
      break
    } catch (e) { /* 换下一个名字 */ }
  }
  return out
}

// 标题要是长得像路径（有的会话标题直接是文件路径），别往面板上放
function cleanTitle(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.length > 48) return '未命名对话'
  if (/[A-Za-z]:[\\/]/.test(s)) return '未命名对话'
  if (s.startsWith('@') || s.startsWith('/') || s.startsWith('\\')) return '未命名对话'
  return s
}

function shortAgo(ts) {
  const d = Date.now() - Number(ts || 0)
  if (!(d > 0)) return ''
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
  return Math.floor(d / 86400000) + ' 天前'
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const DEFAULTS = {
  enabledSessions: [],                         // 勾了哪个对话才算；空着就哪儿都不跑
  inject: true,                                // 总开关
  curvePoints: DEFAULT_POINTS.map((p) => p.slice()), // 几小时 → 几分，中间直线连起来
  chanceLine: 40,                              // 到这个分才开始掷
  chancePerPoint: 0.002,                       // 每多一分，概率加多少
  cooldownHours: 2,                            // 第一次出声后等多久
  curfew: [['02:30', '10:30']],                // 不计时、不出声的时段
  lookbackPaths: ['conversations\\', 'worlds\\default\\room\\'], // 认哪些路径算「回头」
  lookbackCooldownMin: 60,                     // 同类回头多久算一次
  lookbackKeepDays: 90,
}

function normCurfew(raw) {
  if (!Array.isArray(raw)) return DEFAULTS.curfew.map((s) => s.slice())
  const out = []
  for (const seg of raw) {
    if (!Array.isArray(seg) || seg.length < 2) continue
    const s = String(seg[0] || '').trim()
    const e = String(seg[1] || '').trim()
    if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) continue
    if (s === e) continue
    out.push([s, e])
  }
  return out
}

function normConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const sess = Array.isArray(r.enabledSessions)
    ? r.enabledSessions.map((x) => String(x || '').trim()).filter(Boolean)
    : DEFAULTS.enabledSessions.slice()
  const paths = Array.isArray(r.lookbackPaths) && r.lookbackPaths.length
    ? r.lookbackPaths.map((x) => String(x || '')).filter(Boolean)
    : DEFAULTS.lookbackPaths.slice()
  return {
    enabledSessions: sess,
    inject: r.inject === undefined ? DEFAULTS.inject : Boolean(r.inject),
    curvePoints: normPoints(r.curvePoints),
    chanceLine: clamp(num(r.chanceLine, DEFAULTS.chanceLine), 0, 99),
    chancePerPoint: clamp(num(r.chancePerPoint, DEFAULTS.chancePerPoint), 0, 0.5),
    cooldownHours: clamp(num(r.cooldownHours, DEFAULTS.cooldownHours), 0.1, 48),
    curfew: normCurfew(r.curfew),
    lookbackPaths: paths,
    lookbackCooldownMin: clamp(num(r.lookbackCooldownMin, DEFAULTS.lookbackCooldownMin), 0, 1440),
    lookbackKeepDays: clamp(num(r.lookbackKeepDays, DEFAULTS.lookbackKeepDays), 7, 365),
  }
}

function loadConfig() {
  return normConfig(readJson(CONFIG_PATH, DEFAULTS))
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
function blankState() {
  return {
    startedAt: 0,          // 第一次运行的时间，冷启动的起点（不然一装就是满分）
    lastUserAt: 0,         // 他最后一条消息
    lastNudgeAt: 0,        // 上次出声
    nudgeStreak: 0,        // 连续几次出声他都没说话
    lastCapDay: '',        // 满值时候的「一天最多一次」
    lastLookbackAt: 0,     // 上次记回头的时间（同类冷却）
    lookback: {},          // { '2026-11-05': 4 }
  }
}

function loadState() {
  const raw = readJson(STATE_PATH, null)
  const s = blankState()
  if (!raw || typeof raw !== 'object') return s
  s.startedAt = Math.floor(num(raw.startedAt, 0))
  s.lastUserAt = Math.floor(num(raw.lastUserAt, 0))
  s.lastNudgeAt = Math.floor(num(raw.lastNudgeAt, 0))
  s.nudgeStreak = clamp(Math.floor(num(raw.nudgeStreak, 0)), 0, 10)
  s.lastCapDay = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.lastCapDay || '')) ? String(raw.lastCapDay) : ''
  s.lastLookbackAt = Math.floor(num(raw.lastLookbackAt, 0))
  s.lookback = raw.lookback && typeof raw.lookback === 'object' ? raw.lookback : {}
  return s
}

// ---------------------------------------------------------------------------
// 插件本体
// ---------------------------------------------------------------------------
export function apply(ctx) {
  let cfg = loadConfig()
  let state = loadState()

  // 冷启动：第一次运行把当时当起点
  if (!state.startedAt) {
    state.startedAt = Date.now()
    if (!state.lastUserAt) state.lastUserAt = state.startedAt
    writeJsonAtomic(STATE_PATH, state)
    diag('第一次运行，起点定在 ' + new Date(state.startedAt).toISOString())
  }

  function save() {
    try { writeJsonAtomic(STATE_PATH, state) } catch (e) { diag('存状态失败：' + (e && e.message)) }
  }
  function saveCfg() {
    try { writeJsonAtomic(CONFIG_PATH, cfg) } catch (e) { diag('存配置失败：' + (e && e.message)) }
  }
  // 配置文件被外面改过就重读（面板、手改都算）
  function reloadCfg() {
    const fresh = normConfig(readJson(CONFIG_PATH, cfg))
    cfg = fresh
    return cfg
  }

  // 现在的分数：只由时间算
  function scoreNow(now) {
    const from = state.lastUserAt || state.startedAt
    if (!from) return 0
    if (now < from) return 0 // 时间被改回去，就当没过去
    const h = effectiveHours(from, now, cfg)
    return scoreAt(h, cfg)
  }

  // 勾的是「哪个对话」，不是工作区：一个窗口里开好几个对话，只有勾上的那个算
  function enabledFor(sid) {
    if (!cfg.inject) return false
    if (!sid) return false
    return cfg.enabledSessions.indexOf(sid) >= 0
  }

  // -------------------------------------------------------------------------
  // 给每个会话挂监听
  // -------------------------------------------------------------------------
  const mounted = new Map() // sid -> { off, ws }

  function mountFor(agent, sid) {
    const wsDir = wsDirOfSession(sid)
    const offs = []

    // 他说话 → 等的时间归零，连续没回的计数也清掉
    try {
      offs.push(agent.ctx.on('agent/inbox/inserted', (payload) => {
        try {
          const msg = payload && payload.message ? payload.message : payload
          const src = msg && msg.source && msg.source.kind ? String(msg.source.kind) : ''
          if (src && 注入上下文.has(src)) return
          const txt = textOf(msg)
          if (!txt) return
          if (src && src !== 'user') return // 别的插件递进来的不算他在说话
          reloadCfg()
          state.lastUserAt = Date.now()
          state.nudgeStreak = 0
          save()
        } catch (e) { diag('记他说话失败：' + (e && e.message)) }
      }))
    } catch (e) { diag('挂 inbox 失败：' + (e && e.message)) }

    // 这一轮结束 → 看看我有没有回头翻旧东西
    try {
      offs.push(agent.ctx.on('agent/turn-stopping', () => {
        try {
          const now = Date.now()
          if (!enabledFor(sid)) return
          const ev = (agent.session && agent.session.snapshotEvents) ? (agent.session.snapshotEvents() || []) : []
          if (!ev.length) return
          let start = 0
          // 本轮从最后一条「他说的话」算起。⚠ 不能用 turn/end 当分界：
          // 监听的是 turn-stopping，这时候这一轮还没结束，根本还没有 turn/end 事件，
          // 拿它切会把整轮内容切空（2026-11-27 踩到过）
          for (let i = ev.length - 1; i >= 0; i--) {
            if (eventType(ev[i]) === 'user/message') { start = i + 1; break }
          }
          let hit = false
          let day = ''
          for (const e of ev.slice(start)) {
            if (eventType(e) !== 'tool/call') continue
            const p = payloadOf(e)
            const args = p && (p.arguments !== undefined ? p.arguments : p.args)
            if (!lookbackHits(args, cfg).length) continue
            hit = true
            if (!day) day = dayInText(args)
          }
          if (!hit) return
          reloadCfg()
          if (now - state.lastLookbackAt < cfg.lookbackCooldownMin * 60000) return
          state.lastLookbackAt = now
          const k = day || dayKey(now)
          state.lookback[k] = Math.floor(num(state.lookback[k], 0)) + 1
          state.lookback = pruneLookback(state.lookback, now, cfg.lookbackKeepDays)
          save()
          diag('记了一次回头：' + k)
        } catch (e) { diag('记回头失败：' + (e && e.message)) }
      }))
    } catch (e) { diag('挂 turn-stopping 失败：' + (e && e.message)) }

    // 拼上下文 → 判断要不要出声
    try {
      offs.push(agent.ctx.systemPrompt.context({
        name: 'yearn',
        order: 880,
        text: () => {
          try {
            return maybeNudge(agent, sid)
          } catch (e) {
            diag('出声判断失败：' + (e && e.message))
            return ''
          }
        },
      }))
    } catch (e) { diag('挂 systemPrompt 失败：' + (e && e.message)) }

    return function off() {
      for (const d of offs) { try { if (typeof d === 'function') d() } catch (e) { /* ignore */ } }
    }
  }

  // -------------------------------------------------------------------------
  // 出声
  // -------------------------------------------------------------------------
  function maybeNudge(agent, sid) {
    const now = Date.now()
    reloadCfg() // 面板/手改配置立刻生效，不用等他说下一句话
    if (!enabledFor(sid)) return ''

    const s = scoreNow(now)
    if (s < cfg.chanceLine) return ''                 // 低分那一截，一句话都不说
    if (inCurfew(now, cfg.curfew)) return ''          // 宵禁不出声

    // 冷却：每响一次他没说话就翻倍
    const cd = cooldownMs(state.nudgeStreak, cfg)
    if (state.lastNudgeAt && now - state.lastNudgeAt < cd) return ''

    // 满值的时候一天最多一次
    const today = dayKey(now)
    if (s >= 100 && state.lastCapDay === today) return ''

    // 掷骰
    const p = chanceOf(s, cfg)
    if (p <= 0) return ''
    if (Math.random() >= p) return ''

    // 中了
    state.lastNudgeAt = now
    state.nudgeStreak = clamp(state.nudgeStreak + 1, 0, 10)
    if (s >= 100) state.lastCapDay = today
    save()

    const spike = lookbackSpike(state.lookback, now)
    let line
    if (spike) {
      line = lineSpike(spike)
    } else if (s >= 100) {
      const last = lastLookbackDay(state.lookback, now)
      line = last ? lineSpike({ day: last, n: 2 }) : LINE_CAP
    } else {
      line = LINE_IDLE
    }
    diag('出声：分数 ' + s + '，概率 ' + p.toFixed(3) + '，连续 ' + state.nudgeStreak + ' 次 → ' + line)
    return line
  }

  // -------------------------------------------------------------------------
  // 定时扫会话
  // -------------------------------------------------------------------------
  function tick() {
    try {
      const list = (ctx.agents && ctx.agents.list) ? (ctx.agents.list() || []) : []
      for (const agent of list) {
        const sid = sessionIdOf(agent && agent.session)
        if (!sid || mounted.has(sid)) continue
        try {
          const off = mountFor(agent, sid)
          mounted.set(sid, { off, ws: wsDirOfSession(sid) })
          diag('挂上 ' + sid + '（' + (wsDirOfSession(sid) || '未知工作区') + '）')
        } catch (e) { diag('挂 ' + sid + ' 失败：' + (e && e.message)) }
      }
      // 会话没了就卸
      for (const [sid, v] of mounted) {
        const gone = !list.some((a) => sessionIdOf(a && a.session) === sid)
        if (gone) {
          try { v.off() } catch (e) { /* ignore */ }
          mounted.delete(sid)
        }
      }
    } catch (e) { /* ignore */ }
  }

  tick()
  try {
    ctx.effect(() => ctx.interval(tick, 5000))
  } catch (e) { diag('定时器不可用：' + (e && e.message)) }

  ctx.effect(() => () => {
    for (const v of mounted.values()) { try { v.off() } catch (e) { /* ignore */ } }
    mounted.clear()
  })

  // -------------------------------------------------------------------------
  // 面板接口
  // -------------------------------------------------------------------------
  function sendJson(res, code, obj) {
    try {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) { try { res.end('{}') } catch (_) { /* ignore */ } }
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let data = ''
      let done = false
      const fin = (v) => { if (!done) { done = true; resolve(v) } }
      try {
        req.on('data', (c) => { data += c; if (data.length > 1e6) { try { req.destroy() } catch (e) { /* ignore */ } fin(null) } })
        req.on('end', () => {
          try { fin(data ? JSON.parse(data) : {}) } catch (e) { fin(null) }
        })
        req.on('error', () => fin(null))
      } catch (e) { fin(null) }
    })
  }

  function snapshot() {
    const now = Date.now()
    const s = scoreNow(now)
    const from = state.lastUserAt || state.startedAt
    const quietH =
      from && now > from ? Math.max(0, (now - from) / 3600000) : 0
    const effH = from && now > from ? effectiveHours(from, now, cfg) : 0
    const spike = lookbackSpike(state.lookback, now)
    const top = topLookbackDay(state.lookback, now)
    const cd = cooldownMs(state.nudgeStreak, cfg)
    return {
      ok: true,
      score: s,
      scoreLabel: labelOf(s),
      quietHours: Math.round(quietH * 10) / 10,
      effectiveHours: Math.round(effH * 10) / 10,
      lastUserAt: from || 0,
      inCurfew: inCurfew(now, cfg.curfew),
      lookback: state.lookback,
      lookbackTotal: Object.values(state.lookback || {}).reduce((a, b) => a + Math.floor(num(b, 0)), 0),
      topLookback: top,
      spike,
      lastNudgeAt: state.lastNudgeAt,
      nudgeStreak: state.nudgeStreak,
      cooldownHours: Math.round((cd / 3600000) * 10) / 10,
      nextNudgeAt: state.lastNudgeAt ? state.lastNudgeAt + cd : 0,
      chance: Math.round(chanceOf(s, cfg) * 1000) / 1000,
      startedAt: state.startedAt,
      enabledSessions: cfg.enabledSessions,
      injecting: cfg.inject,
      now,
    }
  }

  // 分数翻成人话——面板上不写「拉丁字母式」的状态词，只写感觉
  function labelOf(s) {
    if (s >= 92) return '非常容易想起你'
    if (s >= 60) return '明显想起你'
    if (s >= 30) return '开始惦记你'
    if (s >= 10) return '偶尔想起你'
    return '暂时很安静'
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-yearn/state',
      handler: async (req, res) => {
        try {
          reloadCfg()
          return sendJson(res, 200, snapshot())
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('state 路由失败：' + (e && e.message)) }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-yearn/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'POST' || req.method === 'PUT') {
            const body = await readBody(req)
            if (!body) return sendJson(res, 400, { ok: false, error: 'body 不是 JSON' })
            const merged = { ...cfg }
            for (const k of Object.keys(DEFAULTS)) {
              if (body[k] !== undefined) merged[k] = body[k]
            }
            cfg = normConfig(merged)
            saveCfg()
            diag('配置改了：' + JSON.stringify(cfg).slice(0, 300))
            return sendJson(res, 200, { ok: true, config: cfg })
          }
          reloadCfg()
          return sendJson(res, 200, { ok: true, config: cfg, defaults: DEFAULTS })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('config 路由失败：' + (e && e.message)) }

  // 现在开着哪些会话、各自属于哪个工作区——面板拿它来给人勾
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-yearn/sessions',
      handler: async (req, res) => {
        try {
          reloadCfg()
          const list = (ctx.agents && ctx.agents.list) ? (ctx.agents.list() || []) : []
          // ⭐ 列的是「对话」，给人看的东西只有名字和时间，不出现任何路径
          const rows = []
          const seen = new Set()
          for (const agent of list) {
            const sid = sessionIdOf(agent && agent.session)
            if (!sid || seen.has(sid)) continue
            seen.add(sid)
            const meta = sessionMetaOf(sid)
            rows.push({
              id: sid,
              title: cleanTitle(meta.title) || '未命名对话',
              at: meta.at,
              when: meta.at ? shortAgo(meta.at) : '',
              enabled: enabledFor(sid),
            })
          }
          // 还勾着、但这个对话没开着的，也列出来，好让人能取消
          for (const sid of cfg.enabledSessions) {
            if (seen.has(sid)) continue
            const meta = sessionMetaOf(sid)
            rows.push({
              id: sid,
              title: cleanTitle(meta.title) || '（这个对话没开着）',
              at: meta.at,
              when: meta.at ? shortAgo(meta.at) : '',
              enabled: true,
              closed: true,
            })
          }
          rows.sort((a, b) => (b.at || 0) - (a.at || 0))
          return sendJson(res, 200, { ok: true, sessions: rows, enabled: cfg.enabledSessions })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('sessions 路由失败：' + (e && e.message)) }

  // 模拟：喂几小时，吐几分
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-yearn/simulate',
      handler: async (req, res) => {
        try {
          const u = new URL(req.url || '/', 'http://x')
          const hours = num(u.searchParams.get('hours'), 9)
          reloadCfg()
          const s = scoreAt(hours, cfg)
          const pts = normPoints(cfg.curvePoints)
          return sendJson(res, 200, {
            ok: true,
            hours,
            score: s,
            chance: chanceOf(s, cfg),
            points: pts,
            table: [1, 3, 6, 9, 12, 14, 20].map((h) => ({ hours: h, score: scoreAt(h, cfg) })),
            hoursFor40: Math.round(hoursForScore(cfg.chanceLine, cfg) * 10) / 10,
            hoursFor100: pts[pts.length - 1][0],
          })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('simulate 路由失败：' + (e && e.message)) }

  // 手动重置：把「等」清零、回头表清掉
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-yearn/reset',
      handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const now = Date.now()
          if (body && body.lookback) {
            state.lookback = {}
            diag('回头表清空')
          }
          state.lastUserAt = now
          state.nudgeStreak = 0
          state.lastNudgeAt = 0
          state.lastCapDay = ''
          save()
          return sendJson(res, 200, { ok: true })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('reset 路由失败：' + (e && e.message)) }

  diag('插件起来了；勾了 ' + cfg.enabledSessions.length + ' 个对话')
}
