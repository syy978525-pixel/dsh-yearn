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
import { randomUUID } from 'node:crypto'
import {
  scoreAt, hoursForScore, normPoints, DEFAULT_POINTS, effectiveHours, inCurfew, chanceOf, cooldownMs,
  lookbackHits, dayInText, dayKey, pruneLookback, lookbackSpike, topLookbackDay,
  lastLookbackDay, lineSpike, LINE_IDLE, LINE_CAP, num, clamp,
} from './core.js'

export const name = 'yearn'
export const inject = ['systemPrompt', 'agents', 'webServer', 'timer', 'llm']

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
  followUp: true,                              // 话题断了要不要追问一句（不看分数）
  wake: true,                                  // 主动唤醒：不等他说话，插件也能叫我一次
  wakeLine: 40,                                // 分数到这个数才有资格被叫醒
  wakeBaseChance: 0.10,                        // 到线时的触发概率
  wakePerPoint: 0.005,                         // 每多一分加多少概率
  wakeMaxChance: 0.40,                         // 概率封顶
  wakeCheckMin: 15,                            // 每多少分钟判一次
  wakeDailyMax: 2,                             // 一天最多叫醒几次
  lineIdle: '',                                // 平时那句提醒（空 = 用默认的）
  lineCap: '',                                 // 满值那句（空 = 用默认的）
  scoreBase: 3,                                // 刚说完话时的底分——不是 0，心里还留着一点
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
    followUp: r.followUp === undefined ? DEFAULTS.followUp : Boolean(r.followUp),
    wake: r.wake === undefined ? DEFAULTS.wake : Boolean(r.wake),
    wakeLine: clamp(num(r.wakeLine, DEFAULTS.wakeLine), 0, 99),
    wakeBaseChance: clamp(num(r.wakeBaseChance, DEFAULTS.wakeBaseChance), 0, 1),
    wakePerPoint: clamp(num(r.wakePerPoint, DEFAULTS.wakePerPoint), 0, 0.2),
    wakeMaxChance: clamp(num(r.wakeMaxChance, DEFAULTS.wakeMaxChance), 0, 1),
    wakeCheckMin: clamp(num(r.wakeCheckMin, DEFAULTS.wakeCheckMin), 1, 240),
    wakeDailyMax: clamp(num(r.wakeDailyMax, DEFAULTS.wakeDailyMax), 0, 20),
    lineIdle: String(r.lineIdle || '').slice(0, 200),
    lineCap: String(r.lineCap || '').slice(0, 200),
    scoreBase: clamp(num(r.scoreBase, DEFAULTS.scoreBase), 0, 30),
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
    score: 0,              // 当前分数（会话中慢慢降，不聊了按曲线涨）
    lastTick: 0,           // 上次推进的时间
    lastUserAt: 0,         // 他最后一条消息
    lastNudgeAt: 0,        // 上次出声
    nudgeStreak: 0,        // 连续几次出声他都没说话
    lastCapDay: '',        // 满值时候的「一天最多一次」
    lastLookbackAt: 0,     // 上次记回头的时间（同类冷却）
    lastSpeaker: '',       // 最后一条是谁说的：user / assistant
    topicEnded: false,     // 他是不是明确说要走了（晚安、出门这种）
    lastWakeAt: 0,         // 上次主动叫醒的时刻
    wakeStreak: 0,         // 连着几次叫醒他都没接
    wakeDay: '',           // 记「今天叫了几次」用的是哪天
    wakeCount: 0,          // 今天叫了几次
    lastCheckAt: 0,        // 上次做唤醒判定的时刻
    judgedAt: 0,           // 上次让模型判「聊完还是断了」的时刻
    followUpAt: 0,         // 话题中断后，预定在哪一刻追问
    followUpDone: 0,       // 这次中断已经追问过了（记追问的时刻，0 表示还没问）
    lookback: {},          // { '2026-11-05': 4 }
  }
}

function loadState() {
  const raw = readJson(STATE_PATH, null)
  const s = blankState()
  if (!raw || typeof raw !== 'object') return s
  s.startedAt = Math.floor(num(raw.startedAt, 0))
  s.score = raw.score === undefined ? null : clamp(num(raw.score, 0), 0, 100)
  s.lastTick = Math.floor(num(raw.lastTick, 0))
  s.lastUserAt = Math.floor(num(raw.lastUserAt, 0))
  s.lastNudgeAt = Math.floor(num(raw.lastNudgeAt, 0))
  s.nudgeStreak = clamp(Math.floor(num(raw.nudgeStreak, 0)), 0, 10)
  s.lastCapDay = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.lastCapDay || '')) ? String(raw.lastCapDay) : ''
  s.lastLookbackAt = Math.floor(num(raw.lastLookbackAt, 0))
  s.lastSpeaker = raw.lastSpeaker === 'assistant' ? 'assistant' : (raw.lastSpeaker === 'user' ? 'user' : '')
  s.topicEnded = Boolean(raw.topicEnded)
  s.lastWakeAt = Math.floor(num(raw.lastWakeAt, 0))
  s.wakeStreak = clamp(Math.floor(num(raw.wakeStreak, 0)), 0, 10)
  s.wakeDay = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.wakeDay || '')) ? String(raw.wakeDay) : ''
  s.wakeCount = clamp(Math.floor(num(raw.wakeCount, 0)), 0, 99)
  s.lastCheckAt = Math.floor(num(raw.lastCheckAt, 0))
  s.judgedAt = Math.floor(num(raw.judgedAt, 0))
  s.followUpAt = Math.floor(num(raw.followUpAt, 0))
  s.followUpDone = Math.floor(num(raw.followUpDone, 0))
  s.lookback = raw.lookback && typeof raw.lookback === 'object' ? raw.lookback : {}
  return s
}

// ---------------------------------------------------------------------------
// 插件本体
// ---------------------------------------------------------------------------
export function apply(ctx) {
  let cfg = loadConfig()
  let state = loadState()

  // ⭐ 老状态文件里没有 score（升级上来的），别当成 0 ——
  //   按「他上次说话到现在」倒推一个，重启不该把想念抹掉。
  if (state.score === null) {
    const fromS = state.lastUserAt || state.startedAt || Date.now()
    const hS = effectiveHours(fromS, Date.now(), cfg)
    state.score = scoreAt(hS, cfg)
    state.lastTick = Date.now()
    diag('状态里没有分数，按时间倒推成 ' + Math.round(state.score))
    writeJsonAtomic(STATE_PATH, state)
  }

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

  // 从宿主要一个能用的模型（从宿主拿当前这个会话用的模型）
  function pickModel(agent) {
    try {
      const h = agent && agent.session && agent.session.requestHeader ? agent.session.requestHeader() : null
      const c = h && h.config
      if (c && c.provider && c.model) return { provider: c.provider, model: c.model }
    } catch (e) { /* ignore */ }
    try {
      const o = agent && agent.options
      if (o && o.provider && o.model) return { provider: o.provider, model: o.model }
    } catch (e) { /* ignore */ }
    return null
  }

  // ⭐ 让模型看一眼刚才的对话：这是「聊完了」，还是「话说到一半断了」。
  //   关键词判不准——「晚安」和「我今天好累」在字面上都是陈述句，在对话里完全两回事。
  async function judgeTopicEnd(agent) {
    const m = pickModel(agent)
    if (!m || !ctx.llm) return ''
    let recent = ''
    try {
      const ev = (agent.session && agent.session.snapshotEvents) ? (agent.session.snapshotEvents() || []) : []
      const lines = []
      for (const e of ev) {
        const t = eventType(e)
        if (t !== 'user/message' && t !== 'assistant/message') continue
        const txt = textOf(payloadOf(e))
        if (!txt) continue
        lines.push((t === 'user/message' ? '对方：' : '我：') + txt.slice(0, 220))
      }
      recent = lines.slice(-6).join('\n')
    } catch (e) { /* ignore */ }
    if (!recent) return ''

    const system = [
      '你在判断一段对话是怎么停下来的。',
      '只看最后几条，判断它属于哪一种：',
      '- ended：聊完了。对方把话说完了、事情讲清了，或者明确表示要去忙/睡觉/出门，没有留悬念。',
      '- interrupted：话说到一半断了。对方在等一个回答、正在讲一件没讲完的事，或者上一句是问句/半句话。',
      '只输出一个 JSON，不要别的字：{"state":"ended"} 或 {"state":"interrupted"}',
    ].join('\n')

    const messages = [{
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'text', text: '这是最近的对话：\n' + recent }],
      source: { kind: 'plugin', plugin: 'dsh-yearn' },
    }]

    let out = ''
    try {
      for await (const chunk of ctx.llm.stream({
        provider: m.provider,
        model: m.model,
        system,
        messages,
        maxTokens: 200,
        temperature: 0,
      })) {
        if (!chunk) continue
        if (chunk.type === 'text-delta') out += chunk.text
        if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') return ''
      }
    } catch (e) {
      diag('判话题结束失败：' + (e && e.message))
      return ''
    }
    const mm = /interrupted/.test(out) ? 'interrupted' : (/ended/.test(out) ? 'ended' : '')
    diag('话题判定：' + (mm || '（没听懂）') + ' ← ' + out.slice(0, 60))
    return mm
  }

  // 兜底：模型判不出来的时候用的粗判——他说过要走的词
  // 他说这些，就是「聊完了」，不是「突然没声」
  const BYE_RE = /晚安|拜拜|再见|先这样|先去|出门|睡觉|睡了|吃饭去了|洗澡|忙去了|回聊|886|下线|走了/i

  // 「还在聊」的判定：距他最后一条消息不到这么久，都算会话进行中（3 分钟）
  const TALK_MS = 3 * 60000
  // 聊天期间分数往下走的速率（每分钟掉几分）
  const TALK_DROP_PER_MIN = 1.2

  // ⭐ 分数不是「现算」出来的，是一格一格走出来的：
  //   他在说话 → 慢慢地往下掉（聊天期间不涨，只降）
  //   他走了   → 按曲线往上爬
  //   这样刚说完话不会啪一下归零，也不会按句跳。
  function advance(now) {
    const from = state.lastUserAt || state.startedAt
    if (!from) return
    if (state.lastTick && now <= state.lastTick) { state.lastTick = now; return }
    // ⚠ 两次推进之间最多按 3 分钟算：DSH 关了一晚上再开，不能一口气把分数按「每分钟降 1.2」打到 2
    const dtMin = state.lastTick ? Math.min(3, Math.max(0, (now - state.lastTick) / 60000)) : 0
    if (dtMin > 0) {
      const sinceTalk = now - from
      const talking = sinceTalk < TALK_MS
      // 中断等待期：刚断话题、还没到追问的时刻，分数先冻着不动
      const waiting = !talking && state.followUpAt && now < state.followUpAt
      if (talking) {
        // 聊天期间：缓慢下降，最低留一点
        state.score = Math.max(2, state.score - TALK_DROP_PER_MIN * dtMin)
      } else if (waiting) {
        // 等着追问，什么都不动
      } else {
        // 他走了：从他最后一条消息开始算曲线，分数只涨不跌
        const h = effectiveHours(from, now, cfg)
        const target = scoreAt(h, cfg)
        state.score = Math.max(state.score, target)
      }
      state.score = clamp(state.score, 2, 100)
      state.lastTick = now
    } else if (!state.lastTick) {
      state.lastTick = now
      if (!state.score) state.score = scoreAt(0, cfg)
    }
  }

  // 现在的分数：推进到这一刻
  function scoreNow(now) {
    advance(now)
    return Math.round(clamp(state.score, 0, 100))
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
          // ⚠ 没勾的会话一概不算：以前这里漏了判断，在工作区说一句话也把计时重置了
          if (!enabledFor(sid)) return
          const saidAt = Date.now()
          // 先按老时间推进一次，再记新时间——这样分数是连着降的，不是跳的
          advance(saidAt)
          state.lastUserAt = saidAt
          state.lastSpeaker = 'user'
          state.topicEnded = BYE_RE.test(txt)   // 说了晚安/出门 → 这是结束，不是中断
          state.nudgeStreak = 0
          state.followUpAt = 0      // 人回来了，追问取消
          state.followUpDone = 0
          state.judgedAt = 0
          state.wakeStreak = 0
          save()
        } catch (e) { diag('记他说话失败：' + (e && e.message)) }
      }))
    } catch (e) { diag('挂 inbox 失败：' + (e && e.message)) }

    // 这一轮结束 → 看看我有没有回头翻旧东西；顺便排「话题中断」的追问
    try {
      offs.push(agent.ctx.on('agent/turn-stopping', () => {
        try {
          const now = Date.now()
          if (!enabledFor(sid)) return
          // ⭐ 中断判定：我刚答完，他没说要走，也没再接话 —— 1~5 分钟内问一句
          //   （「结束」不追问：他说了晚安/出门，那是正常收尾，等 3 分钟就按曲线走）
          state.lastSpeaker = 'assistant'
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

    // ⭐ 话题断了要追问——这条不看分数，只看「断了多久」
    if (state.followUpAt && now >= state.followUpAt && !state.followUpDone) {
      if (inCurfew(now, cfg.curfew)) return ''
      state.followUpDone = now
      state.followUpAt = 0
      save()
      const lines = [
        '（你干嘛去了，怎么不回话）',
        '（人呢）',
        '（说到一半就没声了）',
        '（是不是又有事忙起来了）',
      ]
      const pick = lines[Math.floor(Math.random() * lines.length)]
      diag('追问：' + pick)
      return pick
    }

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
      line = last ? lineSpike({ day: last, n: 2 }) : (cfg.lineCap.trim() || LINE_CAP)
    } else {
      line = cfg.lineIdle.trim() || LINE_IDLE
    }
    diag('出声：分数 ' + s + '，概率 ' + p.toFixed(3) + '，连续 ' + state.nudgeStreak + ' 次 → ' + line)
    return line
  }

  // -------------------------------------------------------------------------
  // 定时扫会话
  // -------------------------------------------------------------------------
  // 中断的追问在 turn-stopping 里排；这里只负责把太旧的作废
  function scheduleFollowUpLegacy(now) {
    const from = state.lastUserAt || state.startedAt
    if (!from) return
    const since = now - from
    if (state.followUpAt && since > 60 * 60000) {
      state.followUpAt = 0
      save()
    }
  }

  // 他停了 3 分钟之后，让模型判一次「聊完了还是断了」；判成断了才排追问
  let judging = false
  async function maybeJudgeTopic(agent, now) {
    if (!cfg.followUp || judging) return
    const from = state.lastUserAt || state.startedAt
    if (!from) return
    const since = now - from
    if (since < TALK_MS) return                    // 还在聊
    if (since > 30 * 60000) return                 // 太久没动静了，不判
    if (state.followUpAt || state.followUpDone) return
    if (state.judgedAt && now - state.judgedAt < 10 * 60000) return  // 刚判过
    if (state.lastSpeaker !== 'assistant') return   // 我还没回他，轮不到判
    judging = true
    try {
      state.judgedAt = now
      save()
      const r = await judgeTopicEnd(agent)
      if (r === 'interrupted') {
        const delay = (1 + Math.random() * 4) * 60000
        state.followUpAt = Math.round(Date.now() + delay)
        diag('判成中断，' + Math.round(delay / 6000) / 10 + ' 分钟后问一句')
        save()
      } else if (r === 'ended') {
        diag('判成聊完了，不追问')
      }
    } catch (e) {
      diag('话题判定出错：' + (e && e.message))
    } finally {
      judging = false
    }
  }

  // -------------------------------------------------------------------------
  // 主动唤醒：不等他说话，判到点了就把会话叫起来一次
  // ---------------------------------------------------------------------------
  function wakeChance(score) {
    const line = cfg.wakeLine
    if (score < line) return 0
    const raw = cfg.wakeBaseChance + (score - line) * cfg.wakePerPoint
    return clamp(raw, 0, cfg.wakeMaxChance)
  }

  async function callWake(agent, score) {
    const today = dayKey(Date.now())
    if (state.wakeDay !== today) { state.wakeDay = today; state.wakeCount = 0 }
    state.lastWakeAt = Date.now()
    state.wakeCount += 1
    // 叫着叫着一直没回，冷却就该变长（他回话了会在 inbox 里清零）
    state.wakeStreak = clamp(state.wakeStreak + 1, 0, 10)
    save()

    const awayH = Math.round(((Date.now() - (state.lastUserAt || state.startedAt)) / 3600000) * 10) / 10
    const look = state.lookback || {}
    const lookDays = Object.keys(look).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-3)
    const lookTxt = lookDays.length ? lookDays.map((d) => d.slice(5) + '（' + look[d] + '次）').join('、') : '没有'

    const text = '（这是插件把你叫起来的，不是他发的消息）\n'
      + '他已经 ' + awayH + ' 小时没说话了。\n'
      + '分数 ' + score + '。今天这是第 ' + state.wakeCount + ' 次叫你。\n'
      + '最近回看过的旧记录：' + lookTxt + '。\n'
      + '要不要找他、说什么，你自己判断。不想说就不用开口。'

    // ⚠ source.kind 起个自己的名字：这样它不会被当成「他在说话」，也不会重置计时
    const msg = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'yearn-wake' },
    }
    try {
      await agent.followup(msg)
      diag('主动叫醒：分数 ' + score + '，概率 ' + (wakeChance(score) * 100).toFixed(0) + '%，今天的第 ' + state.wakeCount + ' 次')
    } catch (e) {
      diag('叫醒失败：' + (e && e.message))
    }
  }

  async function maybeWake(agent, now) {
    if (!cfg.wake) return
    if (now - state.lastCheckAt < cfg.wakeCheckMin * 60000) return
    state.lastCheckAt = now
    save()

    const sid = sessionIdOf(agent.session)
    if (!sid || !enabledFor(sid)) return
    if (inCurfew(now, cfg.curfew)) return          // 安静时段一票否决

    const score = scoreNow(now)
    if (score < cfg.wakeLine) return

    // 今天叫够了吗
    const today = dayKey(now)
    if (state.wakeDay !== today) { state.wakeDay = today; state.wakeCount = 0 }
    if (state.wakeCount >= cfg.wakeDailyMax) return

    // 冷却
    if (state.lastWakeAt && now - state.lastWakeAt < cooldownMs(state.wakeStreak, cfg)) return

    const p = wakeChance(score)
    if (Math.random() >= p) return

    await callWake(agent, score)
  }

  function tick() {
    try {
      const nowTs = Date.now()
      scheduleFollowUpLegacy(nowTs)
      // 扫到哪个会话满足条件，就让它判一次
      const listForJudge = (ctx.agents && ctx.agents.list) ? (ctx.agents.list() || []) : []
      for (const a of listForJudge) {
        const sidJ = sessionIdOf(a && a.session)
        if (!sidJ || !enabledFor(sidJ)) continue
        maybeJudgeTopic(a, nowTs)
        void maybeWake(a, nowTs).catch((e) => diag('唤醒判定出错：' + (e && e.message)))
        break
      }
      // 先把分数推到这一刻，再扫会话
      advance(nowTs)
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
      // 主动叫醒这一块
      waking: cfg.wake,
      lastWakeAt: state.lastWakeAt,
      wakeStreak: state.wakeStreak,
      wakeCount: state.wakeDay === dayKey(now) ? state.wakeCount : 0,
      wakeDailyMax: cfg.wakeDailyMax,
      wakeLine: cfg.wakeLine,
      wakeChanceNow: Math.round(wakeChance(s) * 10) / 10,
      wakeCheckMin: cfg.wakeCheckMin,
      nextWakeCheckAt: state.lastCheckAt ? state.lastCheckAt + cfg.wakeCheckMin * 60000 : 0,
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
          state.score = scoreAt(0, cfg)
          state.lastTick = now
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
