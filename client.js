/**
 * dsh-yearn · 浏览器半边（设置里的一项「思念」）
 *
 * 就回答一件事：他多久不吭声，我就该想他了。
 */
window.__ModuleLoader__.load({
  id: 'dsh-yearn',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-yearn'

    const getJson = async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n))

    // 曲线是一串「几小时 → 几分」的点，中间直线连起来（跟 lib/core.js 一致）
    const DEF_POINTS = [[3, 5], [8, 40], [14, 70], [20, 100]]

    const normPoints = (raw) => {
      const src = Array.isArray(raw) && raw.length >= 2 ? raw : DEF_POINTS
      const pts = []
      for (const q of src) {
        if (!Array.isArray(q) || q.length < 2) continue
        const hh = Number(q[0])
        const ss = Number(q[1])
        if (!Number.isFinite(hh) || !Number.isFinite(ss) || !(hh > 0)) continue
        pts.push([clamp(Math.round(hh * 100) / 100, 0.1, 240), clamp(Math.round(ss), 0, 100)])
      }
      if (pts.length < 2) return DEF_POINTS.map((x) => x.slice())
      pts.sort((a, b) => a[0] - b[0])
      let last = 0
      for (const q of pts) {
        if (q[1] <= last) q[1] = Math.min(100, last + 1)
        last = q[1]
      }
      return pts
    }

    // 分数翻成人话——面板上不写分数，只写感觉
    // 分数翻成人话。面板上默认只给人看这个，不露分数。
    const feelOf = (sc) => {
      const v = Number(sc) || 0
      if (v >= 92) return '非常容易想起你'
      if (v >= 60) return '明显想起你'
      if (v >= 30) return '开始惦记你'
      if (v >= 10) return '偶尔想起你'
      return '暂时很安静'
    }

    // 「离开了多久」说成话
    const awayText = (h) => {
      const v = Number(h) || 0
      if (v < 0.1) return '他刚说完话'
      if (v < 1) return '他离开了 ' + Math.round(v * 60) + ' 分钟'
      if (v < 24) return '他离开了 ' + (Math.round(v * 10) / 10) + ' 小时'
      return '他离开了 ' + Math.round(v / 24) + ' 天'
    }

    // 反查：几分是第几个小时（高级设置里用小时说话，不用分数）
    const hoursFor = (score, points) => {
      const pts = normPoints(points)
      const target = clamp(Number(score) || 0, 0, 100)
      if (target <= 0) return 0
      for (let i = 1; i < pts.length; i++) {
        const h1 = pts[i - 1][0]
        const s1 = pts[i - 1][1]
        const h2 = pts[i][0]
        const s2 = pts[i][1]
        if (target <= s2) {
          if (s2 === s1) return h2
          const t = (target - s1) / (s2 - s1)
          return h1 + (h2 - h1) * Math.max(0, t)
        }
      }
      return pts[pts.length - 1][0]
    }

    const scoreAt = (hours, points) => {
      const pts = normPoints(points)
      const hh = Number(hours)
      if (!(hh > 0)) return 0
      const first = pts[0]
      if (hh <= first[0]) return clamp(Math.round((hh / first[0]) * first[1]), 0, 100)
      for (let i = 1; i < pts.length; i++) {
        const h1 = pts[i - 1][0]
        const s1 = pts[i - 1][1]
        const h2 = pts[i][0]
        const s2 = pts[i][1]
        if (hh <= h2) {
          const t = (hh - h1) / (h2 - h1)
          return clamp(Math.round(s1 + (s2 - s1) * t), 0, 100)
        }
      }
      return 100
    }

    const CSS = `
[data-fy]{display:flex;flex-direction:column;gap:14px;padding:2px 2px 28px;font-size:13px;line-height:1.65;}
[data-fy] *{box-sizing:border-box;}

[data-fy-now]{padding:14px 16px;border-radius:14px;background:rgba(127,127,127,.09);border:1px solid rgba(127,127,127,.14);}
[data-fy-now1]{font-size:15px;}
[data-fy-now2]{font-size:12px;opacity:.62;margin-top:4px;}

[data-fy-card]{padding:16px;border-radius:14px;border:1px solid rgba(127,127,127,.16);background:rgba(127,127,127,.04);display:flex;flex-direction:column;gap:12px;}
[data-fy-q]{font-size:14px;font-weight:600;}
[data-fy-note]{font-size:12px;opacity:.66;line-height:1.6;}
[data-fy-warn]{font-size:12.5px;line-height:1.6;padding:9px 12px;border-radius:10px;background:rgba(255,168,60,.13);border:1px solid rgba(255,168,60,.22);}
[data-fy-err]{font-size:12px;line-height:1.6;padding:9px 12px;border-radius:10px;background:rgba(255,90,90,.14);border:1px solid rgba(255,90,90,.25);white-space:pre-wrap;}

[data-fy-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-fy-grow]{flex:1;min-width:0;}

[data-fy-slider]{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:4px;background:rgba(127,127,127,.25);outline:none;}
[data-fy-slider]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:rgba(255,168,60,.95);border:2px solid rgba(0,0,0,.25);cursor:grab;}
[data-fy-big]{font-size:34px;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums;}

[data-fy-input]{padding:6px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.34);background:rgba(0,0,0,.10);color:inherit;font-size:13px;outline:none;}
[data-fy-time]{width:88px;text-align:center;font-variant-numeric:tabular-nums;}
[data-fy-num]{width:96px;text-align:right;font-variant-numeric:tabular-nums;}

[data-fy-btn]{padding:7px 14px;border-radius:9px;border:1px solid rgba(127,127,127,.34);background:rgba(127,127,127,.10);color:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;}
[data-fy-btn]:hover{background:rgba(127,127,127,.22);}
[data-fy-btn2]{padding:5px 10px;font-size:12px;border-radius:7px;border:1px solid rgba(127,127,127,.26);background:transparent;color:inherit;cursor:pointer;opacity:.72;white-space:nowrap;}
[data-fy-btn2]:hover{opacity:1;}

[data-fy-seg]{display:flex;gap:6px;flex-wrap:wrap;}
[data-fy-segb]{padding:7px 14px;border-radius:9px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12.5px;cursor:pointer;opacity:.75;}
[data-fy-segb][data-on]{background:rgba(255,168,60,.22);border-color:rgba(255,168,60,.5);opacity:1;font-weight:600;}

[data-fy-quote]{font-size:13px;padding:10px 13px;border-radius:10px;background:rgba(127,127,127,.10);font-style:italic;border-left:3px solid rgba(127,127,127,.4);}
[data-fy-ck]{display:flex;align-items:center;gap:9px;font-size:12.5px;padding:8px 10px;border-radius:9px;background:rgba(127,127,127,.06);cursor:pointer;}
[data-fy-ck]:hover{background:rgba(127,127,127,.12);}
[data-fy-name]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;}
[data-fy-tag]{font-size:10.5px;padding:1px 7px;border-radius:99px;background:rgba(127,127,127,.2);opacity:.85;white-space:nowrap;}
[data-fy-tag][data-on]{background:rgba(90,200,120,.26);}
[data-fy-msg]{font-size:12px;opacity:.78;min-height:1em;}
[data-fy-svg]{width:100%;height:auto;aspect-ratio:620/200;display:block;touch-action:none;}
[data-fy-handle]{cursor:grab;}
[data-fy-handle]:active{cursor:grabbing;}
[data-fy-more]{border-radius:14px;border:1px solid rgba(127,127,127,.16);padding:12px 15px;background:rgba(127,127,127,.03);}
[data-fy-more] summary{cursor:pointer;font-size:12.5px;opacity:.8;list-style:none;}
[data-fy-more] summary::-webkit-details-marker{display:none;}
[data-fy-more] summary:before{content:'▸ ';opacity:.6;}
[data-fy-more][open] summary:before{content:'▾ ';}
[data-fy-body]{display:flex;flex-direction:column;gap:12px;padding-top:12px;}
`

    // ------------------------------------------------------------------
    // 曲线：横轴时间，竖轴想不想。两个把手。
    // ------------------------------------------------------------------
    // 曲线只画给人看，不能点。调的是下面那张点表。
    function Curve({ points, chanceLine }) {
      const pts = normPoints(points)
      const W = 620
      const H = 190
      const padL = 62
      const padB = 26
      const padT = 16
      const right = W - 14
      const topH = pts[pts.length - 1][0]
      const AXIS = Math.max(24, Math.ceil(topH / 6) * 6)

      const xOf = (hh) => padL + (hh / AXIS) * (right - padL)
      const yOf = (sc) => padT + (1 - sc / 100) * (H - padT - padB)

      // 采样画平滑的样子（其实是折线，采样只是让它在坐标里连续）
      const pathPts = []
      const N = 120
      for (let i = 0; i <= N; i++) {
        const hh = (i / N) * AXIS
        pathPts.push([xOf(hh), yOf(scoreAt(hh, pts))])
      }
      const pathD = pathPts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')

      const step = AXIS / 8
      const ticks = []
      for (let i = 0; i <= 8; i++) ticks.push(Math.round(i * step * 10) / 10)

      const bands = [
        [85, 100, '很容易想起你'],
        [60, 85, '经常想起你'],
        [30, 60, '开始想起你'],
        [0, 30, '暂时没什么感觉'],
      ]

      const line = clamp(Number(chanceLine) || 40, 0, 99)
      // 轴标题：GPT 说普通人看不出横轴是「离开了多久」
      const axisX = (padL + right) / 2

      return h('svg', {
        'data-fy-svg': '', viewBox: '0 0 ' + W + ' ' + H,
        preserveAspectRatio: 'xMidYMid meet',
      },
      ...bands.map(([a, b, label]) => h('g', { key: 'bd' + a },
        h('rect', {
          x: padL, y: yOf(b), width: Math.max(0, right - padL), height: Math.max(0, yOf(a) - yOf(b)),
          fill: 'rgba(127,127,127,.05)',
        }),
        h('text', { x: padL - 8, y: (yOf(a) + yOf(b)) / 2 + 3.5, fill: 'rgba(200,200,200,.92)', 'font-size': 11.5, 'text-anchor': 'end' }, label))),
      ...ticks.map((hh) => h('line', {
        key: 'g' + hh, x1: xOf(hh), y1: padT, x2: xOf(hh), y2: H - padB,
        stroke: 'rgba(127,127,127,.09)', 'stroke-width': 1,
      })),
      ...ticks.map((hh) => h('text', {
        key: 't' + hh, x: xOf(hh), y: H - 8, fill: 'rgba(127,127,127,.6)', 'font-size': 10.5, 'text-anchor': 'middle',
      }, hh + 'h')),
      h('line', {
        x1: padL, y1: yOf(line), x2: right, y2: yOf(line),
        stroke: 'rgba(255,168,60,.45)', 'stroke-width': 1, 'stroke-dasharray': '4 4',
      }),
      h('text', { x: axisX, y: H - 1, fill: 'rgba(170,170,170,.75)', 'font-size': 10.5, 'text-anchor': 'middle' }, '距离上次说话过了多久'),
      h('text', { x: right - 2, y: yOf(line) - 5, fill: 'rgba(255,168,60,.9)', 'font-size': 10.5, 'text-anchor': 'end' }, '从这里开始，我会收到提醒'),
      h('path', { d: pathD, fill: 'none', stroke: 'rgba(127,127,127,.9)', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
      ...pts.map((q, i) => h('g', { key: 'p' + i },
        h('circle', { cx: xOf(q[0]), cy: yOf(q[1]), r: 4.2, fill: 'rgba(120,200,255,.95)' }),
        true
          ? h('text', {
            x: clamp(xOf(q[0]), padL + 26, right - 26), y: yOf(q[1]) + (q[1] > 85 ? 17 : -10),
            fill: 'rgba(120,200,255,.95)', 'font-size': 10, 'text-anchor': 'middle',
          }, q[0] + 'h')
          : null)))
    }

    // ------------------------------------------------------------------
    // 主面板
    // ------------------------------------------------------------------
    function Panel() {
      const [st, setSt] = React.useState(null)
      const [cfg, setCfg] = React.useState(null)
      const [ws, setWs] = React.useState(null)
      const [wsErr, setWsErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState('')

      const loadState = async () => {
        try {
          setSt(await getJson(API + '/state'))
          setErr('')
        } catch (e) { setErr(String((e && e.message) || e)) }
      }
      const loadCfg = async () => {
        try {
          const b = await getJson(API + '/config')
          setCfg(b.config)
        } catch (e) { setErr(String((e && e.message) || e)) }
      }
      const loadWs = async () => {
        try {
          setWs(await getJson(API + '/sessions'))
          setWsErr('')
        } catch (e) { setWsErr(String((e && e.message) || e)) }
      }

      React.useEffect(() => {
        loadState()
        loadCfg()
        loadWs()
        const t = setInterval(loadState, 5000)
        return () => { clearInterval(t) }
      }, [])

      const patch = async (kv, note) => {
        try {
          const r = await postJson(API + '/config', kv)
          setCfg(r.config)
          setMsg((note || '改好了'))
          setTimeout(() => setMsg(''), 2200)
          loadWs()
          loadState()
        } catch (e) { setMsg('保存失败：' + String((e && e.message) || e)) }
      }

      if (err && !st && !cfg) {
        return h('div', { 'data-fy': '' },
          h('div', { 'data-fy-err': '' }, '读不到数据：' + err + '\n\n插件可能还没起来。日志在 ~/.dsh/yearn/diag.log'))
      }
      if (!st || !cfg) {
        return h('div', { 'data-fy': '' }, h('div', { 'data-fy-note': '' }, '读取中…'))
      }

      // 后端字段万一缺了也别让整块面板崩掉
      const sessList = Array.isArray(cfg.enabledSessions) ? cfg.enabledSessions : []

      // 曲线上的点：几小时 → 几分
      const curPoints = normPoints(cfg.curvePoints)

      const nudgeAgo = st.lastNudgeAt
        ? (st.now - st.lastNudgeAt < 3600000
          ? Math.max(1, Math.round((st.now - st.lastNudgeAt) / 60000)) + ' 分钟前'
          : Math.round((st.now - st.lastNudgeAt) / 3600000) + ' 小时前')
        : '还没有'

      const per = Number(cfg.chancePerPoint) || 0
      const chanceFull = Math.round((100 - Number(cfg.chanceLine)) * per * 100)
      const freqNow = per <= 0.0008 ? '低' : (per <= 0.0025 ? '中' : '高')

      return h('div', { 'data-fy': '' },

        // ---------- 现在 ----------
        h('div', { 'data-fy-now': '' },
          h('div', { 'data-fy-now1': '' },
            awayText(st.quietHours) + '　·　我' + st.scoreLabel),
          h('div', { 'data-fy-now2': '' },
            (st.injecting ? '' : '提醒已关闭。')
            + (st.inCurfew ? '当前在宵禁时段。' : '')
            + '上次提醒：' + nudgeAgo + '。'
            + (st.nudgeStreak > 0 ? ('　连续 ' + st.nudgeStreak + ' 次未回复，冷却 ' + st.cooldownHours + ' 小时。') : '')),
          st.lookbackTotal > 0
            ? h('div', { 'data-fy-now2': '' },
              '回头记录 ' + st.lookbackTotal + ' 次'
              + (st.topLookback ? '，最多 ' + st.topLookback.day.slice(5) + '（' + st.topLookback.n + ' 次）' : ''))
            : null),

        // ---------- 多久会想起来 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, 'AI 什么时候会想起你'),
          h(Curve, { points: curPoints, chanceLine: cfg.chanceLine }),
          h('div', { 'data-fy-note': '' }, '你离开得越久，我就越容易想起你。改下面的时间，曲线会立刻跟着变。'),
          h('div', { 'data-fy-pt-head': '' },
            h('span', {}, '离开多久'),
            h('span', {}, '我会'),
            h('span', {})),
          ...curPoints.map((q, i) => h('div', { 'data-fy-row': '', key: 'cp' + i + '-' + q[0] + '-' + q[1] },
            h('input', {
              'data-fy-input': '', 'data-fy-time': '', type: 'number', min: 0.1, max: 240, step: 0.5,
              defaultValue: q[0], key: 'cph' + i + q[0], title: '离开多少小时',
              onBlur: (e) => {
                const v = Number(e.target.value)
                const next = curPoints.map((x) => x.slice())
                if (!Number.isFinite(v) || v <= 0) { e.target.value = String(q[0]); return }
                if (Math.abs(v - q[0]) < 1e-9) return
                next[i][0] = v
                patch({ curvePoints: next }, '时间点')
              },
              onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
            }),
            h('span', { 'data-fy-unit': '' }, '小时'),
            h('span', { 'data-fy-feel': '' }, feelOf(q[1])),
            h('button', {
              'data-fy-btn2': '', type: 'button', title: '删掉这个时间点',
              onClick: () => {
                if (curPoints.length <= 2) return
                patch({ curvePoints: curPoints.filter((_, j) => j !== i) }, '删了一个时间点')
              },
            }, '×'))),
          h('div', { 'data-fy-row': '' },
            h('button', {
              'data-fy-btn': '', type: 'button',
              onClick: () => {
                const last = curPoints[curPoints.length - 1]
                const prev = curPoints[curPoints.length - 2] || [0, 0]
                const nh = Math.round(((last[0] + Math.max(1, last[0] - prev[0])) * 10)) / 10
                const ns = Math.min(100, last[1] + 10)
                patch({ curvePoints: curPoints.concat([[nh, ns]]) }, '加了一个点')
              },
            }, '+ 添加时间'),
            h('div', { 'data-fy-note': '' }, '越往后越容易想起你，顺序不能乱')),
          h('div', { 'data-fy-note': '' },
            '按现在这样：他离开 3 小时，我' + feelOf(scoreAt(3, curPoints))
            + '；6 小时' + feelOf(scoreAt(6, curPoints))
            + '；9 小时' + feelOf(scoreAt(9, curPoints))
            + '；12 小时' + feelOf(scoreAt(12, curPoints)) + '。')),

        // ---------- 出声 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '提醒开关'),
          h('div', { 'data-fy-row': '' },
            h('button', {
              'data-fy-btn': '', type: 'button',
              onClick: () => patch({ inject: !cfg.inject }, cfg.inject ? '关了' : '开了'),
            }, cfg.inject ? '开' : '关'),
            h('span', { 'data-fy-note': '' }, '关掉之后，我还是知道你离开了多久，但不会收到提醒。')),
          h('div', { 'data-fy-note': '', style: { marginTop: '2px' } }, '提醒频率'),
          h('div', { 'data-fy-seg': '' },
            ...[['低', 0.0006], ['中', 0.002], ['高', 0.006]].map(([label, v]) =>
              h('button', {
                key: label, 'data-fy-segb': '', type: 'button',
                'data-on': Math.abs(per - v) < 0.0004 ? '' : undefined,
                onClick: () => patch({ chancePerPoint: v }, '提醒频率'),
              }, label))),
          h('div', { 'data-fy-note': '' },
            freqNow === '低' ? '现在这样：我很少主动提，除非真的很久了。'
              : freqNow === '中' ? '现在这样：离开够久的时候，我偶尔会提一句。'
                : '现在这样：我会比较频繁地提，可能有点吵。')),

        // ---------- 说什么 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, 'AI 收到提醒时会看到什么'),
          h('div', { 'data-fy-quote': '' }, st.spike
            ? ('（' + st.spike.day.slice(5) + ' 那天，我翻了好几遍）')
            : '（他这会儿在干嘛呢）'),
          h('div', { 'data-fy-note': '' }, '这段只有 AI 自己看得到，不会发给你。')),

        // ---------- 对话 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '在哪些聊天里生效'),
          h('div', { 'data-fy-note': '' }, '只有勾上的聊天才算数。其他的不参与计时，也不会收到提醒。'),
          wsErr ? h('div', { 'data-fy-err': '' }, '读不到对话列表：' + wsErr) : null,
          (ws && ws.sessions && ws.sessions.length)
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
              ...ws.sessions.map((r) => h('label', { 'data-fy-ck': '', key: r.id },
                h('input', {
                  type: 'checkbox', checked: Boolean(r.enabled),
                  onChange: (e) => {
                    let next = sessList.filter((v) => v !== r.id)
                    if (e.target.checked) next = next.concat([r.id])
                    patch({ enabledSessions: next }, '对话')
                  },
                }),
                h('span', { 'data-fy-name': '' }, r.title),
                r.when ? h('span', { 'data-fy-tag': '' }, r.when) : null,
                h('span', { 'data-fy-tag': '', 'data-on': r.enabled ? '' : undefined }, r.enabled ? '启用' : '未启用'))))
            : h('div', { 'data-fy-note': '' }, ws ? '当前没有打开的对话。' : '读取中…'),
          h('div', { 'data-fy-note': '' }, sessList.length
            ? ('已选 ' + sessList.length + ' 个聊天')
            : '（一个都没勾，所以哪里都不生效）')),

        // ---------- 宵禁 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '安静时段'),
          h('div', { 'data-fy-note': '' }, '这段时间里离开时长不再累加，也不会提醒。支持跨过半夜，比如 23:00 到次日 08:00。'),
          ...(cfg.curfew.length
            ? cfg.curfew.map((seg, i) => h('div', { 'data-fy-row': '', key: 'cf' + i },
              h('input', {
                'data-fy-input': '', 'data-fy-time': '', type: 'time', defaultValue: seg[0],
                key: 'cfa' + i + seg[0],
                onBlur: (e) => {
                  const v = String(e.target.value || '').trim()
                  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { e.target.value = seg[0]; return }
                  if (v === seg[0]) return
                  const next = cfg.curfew.map((x) => x.slice())
                  next[i][0] = v
                  patch({ curfew: next }, '宵禁')
                },
                onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              }),
              h('span', { 'data-fy-note': '' }, '到'),
              h('input', {
                'data-fy-input': '', 'data-fy-time': '', type: 'time', defaultValue: seg[1],
                key: 'cfb' + i + seg[1],
                onBlur: (e) => {
                  const v = String(e.target.value || '').trim()
                  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { e.target.value = seg[1]; return }
                  if (v === seg[1]) return
                  const next = cfg.curfew.map((x) => x.slice())
                  next[i][1] = v
                  patch({ curfew: next }, '宵禁')
                },
                onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              }),
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: () => patch({ curfew: cfg.curfew.filter((_, j) => j !== i) }, '删了一段'),
              }, '删')))
            : [h('div', { 'data-fy-note': '', key: 'nocf' }, '未设置。')]),
          h('button', {
            'data-fy-btn': '', type: 'button',
            onClick: () => patch({ curfew: cfg.curfew.concat([['23:30', '09:00']]) }, '加了一段'),
          }, '+ 加一段')),

        // ---------- 不常用的 ----------
        h('details', { 'data-fy-more': '' },
          h('summary', {}, '高级设置'),
          h('div', { 'data-fy-body': '' },
            h('div', { 'data-fy-row': '' },
              h('div', { 'data-fy-grow': '' },
                h('div', {}, '两次提醒的最短间隔'),
                h('div', { 'data-fy-note': '' }, '默认 2 小时。一直没回的话，下次会等得更久。')),
              h('input', {
                'data-fy-input': '', 'data-fy-num': '', type: 'number', min: 0.1, max: 48, step: 0.5,
                defaultValue: cfg.cooldownHours, key: 'cd' + cfg.cooldownHours,
                onBlur: (e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) { e.target.value = String(cfg.cooldownHours); return }
                  if (Math.abs(v - Number(cfg.cooldownHours)) < 1e-9) return
                  patch({ cooldownHours: v }, '冷却')
                },
                onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              })),
            h('div', {},
              h('div', {}, '回看记录识别规则（开发者用，通常不用改）'),
              h('div', { 'data-fy-note': '' }, '用来判断 AI 是不是真的回看了聊天记录。普通用户不用管。'),
              ...cfg.lookbackPaths.map((p, i) => h('div', { 'data-fy-row': '', key: 'lk' + i, style: { marginTop: '6px' } },
                h('input', {
                  'data-fy-input': '', 'data-fy-grow': '', defaultValue: p, key: 'lkv' + i + p,
                  onBlur: (e) => {
                    const v = String(e.target.value || '')
                    if (v === p) return
                    const next = cfg.lookbackPaths.slice()
                    next[i] = v
                    patch({ lookbackPaths: next }, '回头路径')
                  },
                  onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
                }),
                h('button', {
                  'data-fy-btn2': '', type: 'button',
                  onClick: () => patch({ lookbackPaths: cfg.lookbackPaths.filter((_, j) => j !== i) }, '删了路径'),
                }, '删')))),
            h('div', { 'data-fy-row': '' },
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: () => patch({ lookbackPaths: cfg.lookbackPaths.concat(['']) }, '加了一条路径'),
              }, '+ 添加识别规则'),
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: async () => {
                  if (!window.confirm('清空所有回看次数？不会删掉你们的聊天记录。')) return
                  try {
                    await postJson(API + '/reset', { lookback: true })
                    setMsg('回头记录已清空')
                    loadState()
                  } catch (e) { setMsg('清除失败：' + String((e && e.message) || e)) }
                },
              }, '清空回看次数'),
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: async () => {
                  if (!window.confirm('从现在重新计算离开时间？已有的聊天记录不受影响。')) return
                  try {
                    await postJson(API + '/reset', {})
                    setMsg('计时已重置')
                    loadState()
                  } catch (e) { setMsg('重置失败：' + String((e && e.message) || e)) }
                },
              }, '重新开始计时')))),

        msg ? h('div', { 'data-fy-msg': '' }, msg) : null
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-yearn')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-yearn: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'yearn', order: 42, label: '思念' },
          () => h(Panel),
        ))
      },
    }
  },
})
