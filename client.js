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

    // 分数 = 100 × (t / T) ^ p。p = 1 是直线，大于 1 是前慢后快。
    const scoreAt = (hours, T, k) => {
      const TT = Math.max(0.1, Number(T) || 14)
      const pp = Math.min(6, Math.max(0.05, Number(k) || 1.5))
      if (!(hours > 0)) return 0
      if (hours >= TT) return 100
      return clamp(Math.round(100 * Math.pow(hours / TT, pp)), 0, 100)
    }

    // 「一半时间要有几分」→ p
    const pForMid = (score) => {
      const sv = Math.max(2, Math.min(98, Number(score) || 50))
      return Math.min(6, Math.max(0.05, Math.log(100 / sv) / Math.log(2)))
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
    function Curve({ T, k, onDrag }) {
      const svgRef = React.useRef(null)
      const [draft, setDraft] = React.useState(null)
      const draftRef = React.useRef(null)
      const dragRef = React.useRef('')
      // 拖动结束要调最新的 onDrag，但监听器只注册一次
      const onDragRef = React.useRef(onDrag)
      onDragRef.current = onDrag

      const W = 620
      const H = 200
      const padL = 58
      const padB = 26
      const padT = 16
      const right = W - 14
      // 轴至少画到 24 小时；到顶时间更长就把轴拉长，别把曲线截断
      const AXIS = Math.max(24, Math.ceil((Number(T) || 14) / 6) * 6)

      const cur = draft || { T, k }
      const cT = clamp(Number(cur.T) || 14, 0.5, AXIS)
      const cK = clamp(Number(cur.k) || 1.5, 0.05, 6)

      const xOf = (hh) => padL + (hh / AXIS) * (right - padL)
      const yOf = (s) => padT + (1 - s / 100) * (H - padT - padB)
      const hOfX = (px) => clamp(((px - padL) / (right - padL)) * AXIS, 0.5, AXIS)
      const sOfY = (py) => clamp((1 - (py - padT) / (H - padT - padB)) * 100, 3, 97)

      const pts = []
      for (let i = 0; i <= 90; i++) {
        const hh = (i / 90) * AXIS
        pts.push([xOf(hh), yOf(scoreAt(hh, cT, cK))])
      }
      const pathD = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')

      const midT = cT / 2
      const midX = xOf(midT)
      const midY = yOf(scoreAt(midT, cT, cK))

      const start = (kind) => (e) => {
        e.preventDefault()
        e.stopPropagation()
        dragRef.current = kind
        draftRef.current = { T: cT, k: cK }
        setDraft({ T: cT, k: cK })
      }

      // 监听器只注册一次（以前每次渲染都重注册，拖着拖着会断）
      React.useEffect(() => {
        const move = (e) => {
          const kind = dragRef.current
          if (!kind || !svgRef.current) return
          const rect = svgRef.current.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          const px = ((e.clientX - rect.left) / rect.width) * W
          const py = ((e.clientY - rect.top) / rect.height) * H
          const base = draftRef.current || { T: cT, k: cK }
          if (kind === 'end') {
            const t = Math.round(hOfX(px) * 2) / 2
            draftRef.current = { T: t, k: base.k }
            setDraft({ T: t, k: base.k })
          } else if (kind === 'mid') {
            const s = sOfY(py)
            const t = Math.max(0.5, base.T)
            const pp = pForMid(s)
            draftRef.current = { T: t, k: pp }
            setDraft({ T: t, k: pp })
          }
        }
        const up = () => {
          if (!dragRef.current) return
          dragRef.current = ''
          const nx = draftRef.current
          setDraft(null)
          draftRef.current = null
          if (nx && typeof onDragRef.current === 'function') onDragRef.current(nx.T, nx.k)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        return () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
      }, [])

      const step = AXIS / 8
      const ticks = []
      for (let i = 0; i <= 8; i++) ticks.push(Math.round(i * step * 10) / 10)

      const bands = [
        [85, 100, '85-100'],
        [60, 85, '60-85'],
        [30, 60, '30-60'],
        [0, 30, '0-30'],
      ]

      const midLabelY = Math.max(12, midY - 13)

      return h('div', {},
        h('svg', { 'data-fy-svg': '', ref: svgRef, viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' },
          ...bands.map(([a, b, label]) => h('g', { key: 'bd' + a },
            h('rect', {
              x: padL, y: yOf(b), width: Math.max(0, right - padL), height: Math.max(0, yOf(a) - yOf(b)),
              fill: 'rgba(127,127,127,.05)',
            }),
            h('text', { x: padL - 8, y: (yOf(a) + yOf(b)) / 2 + 3.5, fill: 'rgba(127,127,127,.65)', 'font-size': 11, 'text-anchor': 'end' }, label))),
          ...ticks.map((hh) => h('line', {
            key: 'g' + hh, x1: xOf(hh), y1: padT, x2: xOf(hh), y2: H - padB,
            stroke: 'rgba(127,127,127,.09)', 'stroke-width': 1,
          })),
          ...ticks.map((hh) => h('text', {
            key: 't' + hh, x: xOf(hh), y: H - 8, fill: 'rgba(127,127,127,.6)', 'font-size': 10.5, 'text-anchor': 'middle',
          }, hh + 'h')),
          h('path', { d: pathD, fill: 'none', stroke: 'rgba(127,127,127,.9)', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
          h('line', {
            x1: xOf(cT), y1: yOf(100), x2: xOf(cT), y2: H - padB,
            stroke: 'rgba(255,168,60,.5)', 'stroke-width': 1, 'stroke-dasharray': '3 4',
          }),
          h('circle', {
            'data-fy-handle': '', cx: xOf(cT), cy: yOf(100), r: 9,
            fill: 'rgba(255,168,60,.95)', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1.5,
            onMouseDown: start('end'), onPointerDown: start('end'),
          }),
          h('text', {
            x: clamp(xOf(cT), padL + 46, right - 46), y: yOf(100) + 22,
            fill: 'rgba(255,168,60,.95)', 'font-size': 11.5, 'text-anchor': 'middle',
          }, cT + 'h 到顶'),
          h('circle', {
            'data-fy-handle': '', cx: midX, cy: midY, r: 8,
            fill: 'rgba(120,200,255,.95)', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1.5,
            onMouseDown: start('mid'), onPointerDown: start('mid'),
          }),
          h('text', {
            x: clamp(midX, padL + 34, right - 34), y: midLabelY,
            fill: 'rgba(120,200,255,.95)', 'font-size': 11, 'text-anchor': 'middle',
          }, Math.round(midT) + 'h ' + scoreAt(midT, cT, cK) + ' 分')),
        h('div', { 'data-fy-note': '', style: { marginTop: '8px' } },
          '橙点：左右拖，改多久到顶。蓝点：上下拖，改一半时间有多少分——往上拖前面起得快，往下拖前面趴着。'),
        h('div', { 'data-fy-note': '' },
          '当前：3h ' + scoreAt(3, cT, cK) + ' 分，6h ' + scoreAt(6, cT, cK)
          + ' 分，12h ' + scoreAt(12, cT, cK) + ' 分。'))
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
      const [slide, setSlide] = React.useState(null)
      const slideTimer = React.useRef(null)

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
        return () => {
          clearInterval(t)
          if (slideTimer.current) clearTimeout(slideTimer.current)
        }
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

      const T = Number(cfg.topHours) || 14
      const k = Number(cfg.curveK) || 1.5
      // 显示用：滑块最多 24，超了就夹住
      const shownT = slide === null ? clamp(T, 1, 24) : slide
      const outOfRange = slide === null && Math.abs(T - shownT) > 1e-9

      // ⭐ 滑块停手 300ms 就存，不依赖 mouseup（拖出控件外松手时 mouseup 不一定来）
      const onSlide = (v) => {
        setSlide(v)
        if (slideTimer.current) clearTimeout(slideTimer.current)
        slideTimer.current = setTimeout(() => {
          setSlide(null)
          if (Math.abs(v - T) > 1e-9) patch({ topHours: v }, '多久到顶')
        }, 300)
      }

      const nudgeAgo = st.lastNudgeAt
        ? (st.now - st.lastNudgeAt < 3600000
          ? Math.max(1, Math.round((st.now - st.lastNudgeAt) / 60000)) + ' 分钟前'
          : Math.round((st.now - st.lastNudgeAt) / 3600000) + ' 小时前')
        : '还没有'

      // 多少小时（有效时长）能到 60 分
      const hToSixty = (() => {
        for (let i = 1; i <= 200; i++) {
          const hh = i * 0.25
          if (hh >= shownT) return shownT
          if (scoreAt(hh, shownT, k) >= 60) return hh
        }
        return shownT
      })()

      const per = Number(cfg.chancePerPoint) || 0
      const chanceFull = Math.round((100 - Number(cfg.chanceLine)) * per * 100)
      const freqNow = per <= 0.0008 ? '低' : (per <= 0.0025 ? '中' : '高')

      return h('div', { 'data-fy': '' },

        // ---------- 现在 ----------
        h('div', { 'data-fy-now': '' },
          h('div', { 'data-fy-now1': '' },
            '距上条消息 ' + st.quietHours + ' 小时　·　分数 ' + st.score + '（' + st.scoreLabel + '）'),
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

        // ---------- 滑块 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '多少小时没有新消息？'),
          h('div', { 'data-fy-row': '' },
            h('div', { 'data-fy-big': '' }, String(shownT)),
            h('div', { 'data-fy-note': '', style: { paddingBottom: '8px' } }, '小时'),
            h('input', {
              type: 'range', 'data-fy-slider': '', min: '1', max: '24', step: '0.5',
              value: shownT,
              onChange: (e) => onSlide(Number(e.target.value)),
            })),
          h('div', { 'data-fy-note': '' },
            '满 ' + hToSixty + ' 小时，分数到 60。'
            + (outOfRange ? '（当前 ' + T + ' 小时，超出滑块范围，请用数字框修改。）' : '')),
          outOfRange
            ? h('div', { 'data-fy-row': '' },
              h('input', {
                'data-fy-input': '', 'data-fy-num': '', type: 'number', min: 0.5, max: 240, step: 0.5,
                defaultValue: T, key: 'tp' + T,
                onBlur: (e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) { e.target.value = String(T); return }
                  if (Math.abs(v - T) < 1e-9) return
                  patch({ topHours: v }, '多久到顶')
                },
                onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              }))
            : null),

        // ---------- 曲线 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '分数曲线'),
          h(Curve, {
            T: T,
            k,
            onDrag: (t, kk) => patch({ topHours: t, curveK: kk }, '曲线'),
          }),
          h('div', { 'data-fy-row': '' },
            h('div', { 'data-fy-grow': '' }, '到顶小时'),
            h('input', {
              'data-fy-input': '', 'data-fy-num': '', type: 'number', min: 0.5, max: 240, step: 0.5,
              defaultValue: T, key: 'cT' + T,
              onBlur: (e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) { e.target.value = String(T); return }
                if (Math.abs(v - T) < 1e-9) return
                patch({ topHours: v }, '到顶时间')
              },
              onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
            })),
          h('div', { 'data-fy-row': '' },
            h('div', { 'data-fy-grow': '' }, '陡度'),
            h('input', {
              'data-fy-input': '', 'data-fy-num': '', type: 'number', min: 0.05, max: 6, step: 0.05,
              defaultValue: k, key: 'cK' + k,
              onBlur: (e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) { e.target.value = String(k); return }
                if (Math.abs(v - k) < 1e-9) return
                patch({ curveK: v }, '陡度')
              },
              onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
            }))),

        // ---------- 出声 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '提醒开关'),
          h('div', { 'data-fy-row': '' },
            h('button', {
              'data-fy-btn': '', type: 'button',
              onClick: () => patch({ inject: !cfg.inject }, cfg.inject ? '关了' : '开了'),
            }, cfg.inject ? '开' : '关'),
            h('span', { 'data-fy-note': '' }, '关闭后只记录分数，不注入提示。')),
          h('div', { 'data-fy-note': '', style: { marginTop: '2px' } }, '提醒频率'),
          h('div', { 'data-fy-seg': '' },
            ...[['低', 0.0006], ['中', 0.002], ['高', 0.006]].map(([label, v]) =>
              h('button', {
                key: label, 'data-fy-segb': '', type: 'button',
                'data-on': Math.abs(per - v) < 0.0004 ? '' : undefined,
                onClick: () => patch({ chancePerPoint: v }, '提醒频率'),
              }, label))),
          h('div', { 'data-fy-note': '' },
            '当前：' + freqNow + '。满分时每轮提醒概率约 ' + chanceFull + '%。')),

        // ---------- 说什么 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '提醒文字'),
          h('div', { 'data-fy-quote': '' }, st.spike
            ? ('（' + st.spike.day.slice(5) + ' 那天，我翻了好几遍）')
            : '（他这会儿在干嘛呢）'),
          h('div', { 'data-fy-note': '' }, '只注入系统提示，不发送。回头次数异常时换成带日期的那句。')),

        // ---------- 对话 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '在哪个对话里生效'),
          h('div', { 'data-fy-note': '' }, '只有勾上的对话会计分。其他对话不读、不记、不提醒。'),
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
            ? ('已勾选 ' + sessList.length + ' 个对话')
            : '（一个都没勾，所以哪儿都不跑）')),

        // ---------- 宵禁 ----------
        h('div', { 'data-fy-card': '' },
          h('div', { 'data-fy-q': '' }, '宵禁'),
          h('div', { 'data-fy-note': '' }, '这段时间不算分，也不会提醒。跨半夜也行。'),
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

        h('div', { 'data-fy-warn': '' }, '低分只表示这段时间没有新消息。'),

        // ---------- 不常用的 ----------
        h('details', { 'data-fy-more': '' },
          h('summary', {}, '高级设置'),
          h('div', { 'data-fy-body': '' },
            h('div', { 'data-fy-row': '' },
              h('div', { 'data-fy-grow': '' },
                h('div', {}, '最低触发分数'),
                h('div', { 'data-fy-note': '' }, '低于此分数不提醒。默认 40。')),
              h('input', {
                'data-fy-input': '', 'data-fy-num': '', type: 'number', min: 0, max: 99,
                defaultValue: cfg.chanceLine, key: 'cl' + cfg.chanceLine,
                onBlur: (e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) { e.target.value = String(cfg.chanceLine); return }
                  if (Math.abs(v - Number(cfg.chanceLine)) < 1e-9) return
                  patch({ chanceLine: v }, '起跑线')
                },
                onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              })),
            h('div', { 'data-fy-row': '' },
              h('div', { 'data-fy-grow': '' },
                h('div', {}, '提醒冷却'),
                h('div', { 'data-fy-note': '' }, '默认 2 小时。未回复则每次翻倍。')),
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
              h('div', {}, '回头记录路径'),
              h('div', { 'data-fy-note': '' }, '工具调用参数包含这些字符串时计一次。'),
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
              }, '+ 加一条'),
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: async () => {
                  try {
                    await postJson(API + '/reset', { lookback: true })
                    setMsg('回头记录已清空')
                    loadState()
                  } catch (e) { setMsg('清除失败：' + String((e && e.message) || e)) }
                },
              }, '清空回头记录'),
              h('button', {
                'data-fy-btn2': '', type: 'button',
                onClick: async () => {
                  try {
                    await postJson(API + '/reset', {})
                    setMsg('计时已重置')
                    loadState()
                  } catch (e) { setMsg('重置失败：' + String((e && e.message) || e)) }
                },
              }, '重置计时')))),

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
