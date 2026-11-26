import test from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreAt, hoursForScore, pForMidScore, curfewMs, effectiveHours, inCurfew, nextCurfewEnd,
  chanceOf, cooldownMs, lookbackHits, dayKey, pruneLookback, lookbackSpike,
  topLookbackDay, dayStartOf, lineSpike, LINE_IDLE,
} from '../lib/core.js'

const H = 3600000

test('分数曲线：表上的数和算出来的一样（默认 p=1.5）', () => {
  assert.equal(scoreAt(0), 0)
  assert.equal(scoreAt(1), 2)
  assert.equal(scoreAt(3), 10)
  assert.equal(scoreAt(6), 28)
  assert.equal(scoreAt(9), 52)
  assert.equal(scoreAt(12), 79)
  assert.equal(scoreAt(14), 100)
  assert.equal(scoreAt(30), 100)
  assert.equal(scoreAt(-5), 0)
})

test('反过来推：到 52 分要多少小时', () => {
  const h = hoursForScore(52)
  assert.ok(Math.abs(h - 9) < 0.15, '应为 9 小时，实际 ' + h)
  assert.equal(hoursForScore(0), 0)
  assert.equal(hoursForScore(100), 14)
})

test('改到顶时长，曲线跟着变', () => {
  assert.equal(scoreAt(7, { topHours: 7 }), 100)
  assert.equal(scoreAt(3, { topHours: 7 }), 28)
})

test('曲线能两头弯：一半时间可以低到 20 分，也可以高到 70 分', () => {
  // 前慢后快
  const pSlow = pForMidScore(20)
  assert.ok(scoreAt(7, { curveK: pSlow }) <= 22, '一半时间该在 20 分附近')
  assert.ok(pSlow > 2, 'p 应该大于 2，实际 ' + pSlow)
  // 前快后慢
  const pFast = pForMidScore(70)
  assert.ok(scoreAt(7, { curveK: pFast }) >= 68, '一半时间该在 70 分附近')
  assert.ok(pFast < 1, 'p 应该小于 1，实际 ' + pFast)
  // 直线
  assert.ok(Math.abs(pForMidScore(50) - 1) < 0.01, '一半时间 50 分就是直线')
})

test('p 的边界不会算出 NaN', () => {
  for (const s of [0, 1, 99, 100, -5, NaN]) {
    const v = pForMidScore(s)
    assert.ok(Number.isFinite(v) && v > 0, 's=' + s + ' 算出 ' + v)
  }
})

test('宵禁：同一天里的一段', () => {
  const base = new Date('2026-11-27T00:00:00').getTime()
  // 02:30 – 10:30，正好 8 小时
  const got = curfewMs(base + 2.5 * H, base + 10.5 * H, [['02:30', '10:30']])
  assert.equal(got, 8 * H)
})

test('宵禁：跨午夜', () => {
  const base = new Date('2026-11-27T00:00:00').getTime()
  // 22:00 – 08:00，10 小时；从 20:00 到次日 09:00 共 13 小时，扣掉 10
  const got = curfewMs(base + 20 * H, base + 33 * H, [['22:00', '08:00']])
  assert.equal(got, 10 * H)
})

test('宵禁：没填就是 0', () => {
  const a = Date.now()
  assert.equal(curfewMs(a - 5 * H, a, []), 0)
  assert.equal(curfewMs(a - 5 * H, a, null), 0)
  assert.equal(curfewMs(a - 5 * H, a, [['02:00', '02:00']]), 0)
})

test('宵禁：段重叠也不会超过总时长', () => {
  const base = new Date('2026-11-27T00:00:00').getTime()
  const got = curfewMs(base, base + 5 * H, [['00:00', '10:00'], ['01:00', '03:00']])
  assert.equal(got, 5 * H)
})

test('有效小时数 = 总时长减宵禁', () => {
  const base = new Date('2026-11-27T00:00:00').getTime()
  const h = effectiveHours(base + 2.5 * H, base + 10.5 * H, { curfew: [['02:30', '10:30']] })
  assert.equal(h, 0)
  const h2 = effectiveHours(base + 10.5 * H, base + 20.5 * H, { curfew: [['02:30', '10:30']] })
  assert.equal(h2, 10)
})

test('在不在宵禁里', () => {
  const c = [['02:30', '10:30']]
  assert.equal(inCurfew(new Date('2026-11-27T03:00:00').getTime(), c), true)
  assert.equal(inCurfew(new Date('2026-11-27T12:00:00').getTime(), c), false)
  assert.equal(inCurfew(new Date('2026-11-27T02:29:00').getTime(), c), false)
})

test('宵禁结束那一刻', () => {
  const c = [['02:30', '10:30']]
  const t = new Date('2026-11-27T03:00:00').getTime()
  const end = nextCurfewEnd(t, c)
  assert.equal(new Date(end).getHours(), 10)
  assert.equal(new Date(end).getMinutes(), 30)
})

test('概率：40 分以下一律 0，往上线性', () => {
  assert.equal(chanceOf(39), 0)
  assert.equal(chanceOf(40), 0)
  assert.equal(chanceOf(50), 0.02)
  assert.equal(chanceOf(100), 0.12)
})

test('冷却：每响一次没回就翻倍，封顶一天', () => {
  assert.equal(cooldownMs(0), 2 * H)
  assert.equal(cooldownMs(1), 4 * H)
  assert.equal(cooldownMs(2), 8 * H)
  assert.equal(cooldownMs(3), 16 * H)
  assert.equal(cooldownMs(4), 24 * H)
  assert.equal(cooldownMs(9), 24 * H)
})

test('回头：认得出来是翻旧东西', () => {
  const conv = JSON.stringify({ file_path: 'E:\\dsh-home\\worlds\\default\\conversations\\2026-11-05.jsonl' })
  assert.deepEqual(lookbackHits(conv), ['conversations\\'])
  const room = JSON.stringify({ file_path: 'E:\\dsh-home\\worlds\\default\\room\\房间全貌·透视.png' })
  assert.deepEqual(lookbackHits(room), ['worlds\\default\\room\\'])
  const other = JSON.stringify({ command: 'ls E:\\dsh-home\\tmp' })
  assert.deepEqual(lookbackHits(other), [])
  // 大小写不敏感
  assert.deepEqual(lookbackHits('E:\\DSH-HOME\\WORLDS\\DEFAULT\\CONVERSATIONS\\x.jsonl'), ['conversations\\'])
})

test('回头表：只留最近 90 天', () => {
  const now = new Date('2026-11-27T12:00:00').getTime()
  const m = { '2026-11-26': 2, '2026-08-01': 9, '2026-11-01': 1, 'garbage': 5 }
  const out = pruneLookback(m, now, 90)
  assert.deepEqual(out, { '2026-11-01': 1, '2026-11-26': 2 })
})

test('回头冒头：今天三次，平时零次', () => {
  const now = new Date('2026-11-27T20:00:00').getTime()
  const m = { '2026-11-27': 3 }
  const spike = lookbackSpike(m, now)
  assert.ok(spike)
  assert.equal(spike.n, 3)
})

test('回头冒头：今天两次不算', () => {
  const now = new Date('2026-11-27T20:00:00').getTime()
  assert.equal(lookbackSpike({ '2026-11-27': 2 }, now), null)
})

test('回头冒头：平时也天天翻，就不算冒头', () => {
  const now = new Date('2026-11-27T20:00:00').getTime()
  const m = { '2026-11-27': 3 }
  for (let i = 1; i <= 6; i++) m[dayKey(now - i * 86400000)] = 2
  assert.equal(lookbackSpike(m, now), null)
})

test('这个月最常翻哪天', () => {
  const now = new Date('2026-11-27T20:00:00').getTime()
  const top = topLookbackDay({ '2026-11-05': 4, '2026-11-20': 1, '2026-11-27': 9 }, now)
  assert.equal(top.day, '2026-11-05')
  assert.equal(top.n, 4)
})

test('说哪句话', () => {
  assert.equal(lineSpike(null), LINE_IDLE)
  assert.equal(lineSpike({ day: '2026-11-05', n: 3 }), '（11-05 那天，我翻了好几遍）')
})

test('dayStartOf 落在零点', () => {
  const t = new Date('2026-11-27T15:33:21').getTime()
  const d = new Date(dayStartOf(t))
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(dayKey(t), '2026-11-27')
})
