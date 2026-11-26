// dsh-yearn · 核心算法
//
// 这里只有纯函数，不碰文件、不碰宿主，能单独跑测试。
// 设计稿：E:\dsh-home\worlds\default\room\思念插件-设计.md
//
// 一条铁律：**分数只能由时间算。** 别的东西一律只决定「响不响」，不许改分数。

const HOUR = 3600000
const DAY = 86400000

export function num(v, dflt) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

// ---------------------------------------------------------------------------
// 分数：只由时间算
// ---------------------------------------------------------------------------
// 曲线：分数 = 100 × (t / T) ^ p
//   t = 距今有效小时数（已经扣掉宵禁）
//   T = 到顶时长，默认 14
//   p = 形状。1 是直线；大于 1 是前段趴着、后段冲；小于 1 是前面就起得快
//
// ⚠ 2026-11-27 换的：原来用指数式 (e^(k·t)−1)/(e^(k·T)−1)，
//   它在 t = T/2 时最多只能到 50 分（k 再大也到不了），面板上那个蓝点往上拖是拖不动的。
//   换成幂函数后，一半时间的分数能到任意值：p = ln(100/s)/ln2。
export function scoreAt(hours, cfg = {}) {
  const T = Math.max(0.1, num(cfg.topHours, 14))
  const p = clamp(num(cfg.curveK, 1.5), 0.05, 6)
  const h = num(hours, 0)
  if (!(h > 0)) return 0
  if (h >= T) return 100
  return clamp(Math.round(100 * Math.pow(h / T, p)), 0, 100)
}

// 反过来：要到某个分数，需要多少小时（面板的模拟框和测试用）
export function hoursForScore(score, cfg = {}) {
  const T = Math.max(0.1, num(cfg.topHours, 14))
  const p = clamp(num(cfg.curveK, 1.5), 0.05, 6)
  const s = clamp(num(score, 0), 0, 100)
  if (s <= 0) return 0
  if (s >= 100) return T
  return T * Math.pow(s / 100, 1 / p)
}

// 给定「一半时间要有几分」，反推 p
export function pForMidScore(score) {
  const s = clamp(num(score, 50), 2, 98)
  return clamp(Math.log(100 / s) / Math.log(2), 0.05, 6)
}

// ---------------------------------------------------------------------------
// 宵禁
// ---------------------------------------------------------------------------
// 段格式：["02:30","10:30"]。start > end 表示跨午夜。
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!(h >= 0 && h <= 24) || !(mi >= 0 && mi <= 59)) return null
  if (h === 24 && mi !== 0) return null
  return h * 60 + mi
}

export function dayStartOf(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// [from, to] 里落在宵禁内的毫秒数
export function curfewMs(from, to, curfew) {
  if (!(to > from)) return 0
  if (!Array.isArray(curfew) || !curfew.length) return 0
  const segs = []
  for (const seg of curfew) {
    if (!Array.isArray(seg) || seg.length < 2) continue
    const s = parseHM(seg[0])
    const e = parseHM(seg[1])
    if (s == null || e == null) continue
    if (s === e) continue // 空段
    segs.push([s, e])
  }
  if (!segs.length) return 0

  let total = 0
  const MAX_DAYS = 400
  let day = dayStartOf(from)
  for (let i = 0; i < MAX_DAYS && day <= to; i++, day += DAY) {
    for (const [s, e] of segs) {
      const a = day + s * 60000
      const b = e > s ? day + e * 60000 : day + DAY + e * 60000
      const lo = Math.max(a, from)
      const hi = Math.min(b, to)
      if (hi > lo) total += hi - lo
    }
  }
  // 段之间如果写了重叠，夹回总时长
  return clamp(total, 0, to - from)
}

// 有效小时数 = 总时长 − 宵禁
export function effectiveHours(from, to, cfg = {}) {
  if (!(to > from)) return 0
  const busy = curfewMs(from, to, cfg.curfew)
  return Math.max(0, (to - from - busy) / HOUR)
}

// 现在在不在宵禁里（半开区间：[开始, 结束)，所以 10:30:00 整已经不在了）
export function inCurfew(ts, curfew) {
  if (!Array.isArray(curfew) || !curfew.length) return false
  const off = ts - dayStartOf(ts) // 今天过了多少毫秒
  for (const seg of curfew) {
    if (!Array.isArray(seg) || seg.length < 2) continue
    const s = parseHM(seg[0])
    const e = parseHM(seg[1])
    if (s == null || e == null || s === e) continue
    const sMs = s * 60000
    const eMs = e * 60000
    if (e > s) {
      if (off >= sMs && off < eMs) return true
    } else {
      // 跨午夜：从 s 到当天结束，或者从当天开始到 e
      if (off >= sMs || off < eMs) return true
    }
  }
  return false
}

// 下一个宵禁结束的时刻（不在宵禁里就返回 ts 本身）
export function nextCurfewEnd(ts, curfew) {
  if (!inCurfew(ts, curfew)) return ts
  const MAX = 48
  for (let i = 1; i <= MAX * 60; i++) {
    const t = ts + i * 60000
    if (!inCurfew(t, curfew)) return t
  }
  return ts
}

// ---------------------------------------------------------------------------
// 出声概率
// ---------------------------------------------------------------------------
// p = (分数 − 起跑线) × 每分概率。起跑线以下一律 0。
export function chanceOf(score, cfg = {}) {
  const line = num(cfg.chanceLine, 40)
  const per = num(cfg.chancePerPoint, 0.002)
  const s = num(score, 0)
  if (s < line) return 0
  return clamp((s - line) * per, 0, 1)
}

// ---------------------------------------------------------------------------
// 冷却：每响一次他没说话就翻倍
// ---------------------------------------------------------------------------
export function cooldownMs(streak, cfg = {}) {
  const base = Math.max(0.1, num(cfg.cooldownHours, 2))
  const n = clamp(Math.floor(num(streak, 0)), 0, 10)
  const hours = Math.min(24, base * Math.pow(2, n))
  return hours * HOUR
}

// ---------------------------------------------------------------------------
// 回头：我读了哪些旧东西
// ---------------------------------------------------------------------------
const DEF_LOOKBACK = ['conversations\\', 'worlds\\default\\room\\']

// 从一次工具调用的参数里认出来
//   arguments 是 JSON 字符串，Windows 路径在里头写作 \\ ，实际是单反斜杠
export function lookbackHits(argsRaw, cfg = {}) {
  const keys = (Array.isArray(cfg.lookbackPaths) && cfg.lookbackPaths.length)
    ? cfg.lookbackPaths
    : DEF_LOOKBACK
  let s = ''
  if (typeof argsRaw === 'string') s = argsRaw
  else if (argsRaw && typeof argsRaw === 'object') {
    try { s = JSON.stringify(argsRaw) } catch (e) { s = '' }
  }
  if (!s) return []
  // ⭐ 工具参数是 JSON 字符串，Windows 路径在里头是双反斜杠；先归一成单反斜杠再比
  const low = s.replace(/\\{2,}/g, '\\').toLowerCase()
  const hits = []
  for (const k of keys) {
    const kk = String(k || '').toLowerCase()
    if (kk && low.includes(kk) && !hits.includes(kk)) hits.push(kk)
  }
  return hits
}

// 路径里有没有具体某一天（yyyy-mm-dd）
export function dayInText(argsRaw) {
  const s = typeof argsRaw === 'string' ? argsRaw : (() => {
    try { return JSON.stringify(argsRaw) } catch (e) { return '' }
  })()
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || '')
  return m ? m[1] + '-' + m[2] + '-' + m[3] : ''
}

// 本地日期键
export function dayKey(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// 回头表：{ '2026-11-05': 4 }，只留最近 N 天
export function pruneLookback(map, nowTs, keepDays = 90) {
  const out = {}
  const edge = dayKey(nowTs - keepDays * DAY)
  for (const k of Object.keys(map || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue
    if (k < edge) continue
    const v = Math.floor(num(map[k], 0))
    if (v > 0) out[k] = v
  }
  return out
}

// 「今天回头次数冒头了」——今天 >= 过去 7 天日均的 3 倍，且至少 3 次（今天不算在基准里）
export function lookbackSpike(lookback, nowTs) {
  const today = dayKey(nowTs)
  const todayN = Math.floor(num(lookback && lookback[today], 0))
  if (todayN < 3) return null
  let sum = 0
  let days = 0
  for (let i = 1; i <= 7; i++) {
    const k = dayKey(nowTs - i * DAY)
    if (Object.prototype.hasOwnProperty.call(lookback || {}, k)) {
      sum += Math.floor(num(lookback[k], 0))
      days++
    }
  }
  const base = days > 0 ? sum / days : 0
  if (todayN >= Math.max(3, base * 3)) return { day: today, n: todayN, base }
  return null
}

// 这个月最常翻的那一天（不含今天）
export function topLookbackDay(lookback, nowTs) {
  const today = dayKey(nowTs)
  let best = ''
  let bestN = 0
  for (const [k, v] of Object.entries(lookback || {})) {
    if (k === today) continue
    const n = Math.floor(num(v, 0))
    if (n > bestN) { best = k; bestN = n }
  }
  return best ? { day: best, n: bestN } : null
}

// 最近一次翻过的是哪一天
export function lastLookbackDay(lookback, nowTs) {
  const keys = Object.keys(lookback || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= dayKey(nowTs))
  if (!keys.length) return ''
  keys.sort()
  return keys[keys.length - 1]
}

// ---------------------------------------------------------------------------
// 说哪句话
// ---------------------------------------------------------------------------
// 平时的：轻，不催
export const LINE_IDLE = '（他这会儿在干嘛呢）'
// 有发现时：只说看见的事实
export function lineSpike(spike) {
  if (!spike) return LINE_IDLE
  const [, m, d] = String(spike.day).split('-')
  const md = m + '-' + d
  if (spike.n >= 3) return '（' + md + ' 那天，我翻了好几遍）'
  return '（这阵子我老往 ' + md + ' 那天跑）'
}
// 到头了，又没回头可看
export const LINE_CAP = '（攒着的话快装不下了）'
