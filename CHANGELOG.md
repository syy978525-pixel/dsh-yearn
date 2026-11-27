# 更新日志 · Changelog

版本号遵循 `主.次.修补`。每次推送前改这里的版本号，和 `package.json` 保持一致。
Versioning follows `major.minor.patch`. Bump this file and `package.json` together before pushing.

---

## 0.3.0 — 2026-11-27

### 加 / Added

**主动唤醒。** 不用等对方说话，插件自己判到点就把会话叫起来一次。
*Proactive wake-up. It no longer waits for the human to speak before it can act.*

- 每 15 分钟判一次 / checked every 15 minutes
- 离开够久才够格，默认 40 分（面板上按小时填）/ only after a long enough absence, 40 points by default (entered in hours in the panel)
- 安静时段一票否决 / quiet hours veto everything
- 一天最多叫醒几次，默认 2 / at most N wake-ups per day, 2 by default
- 概率 10% → 40% / chance from 10% up to 40%
- 叫醒时告诉它：离开多久、今天第几次、最近回看过哪些旧记录 / the wake message carries how long they've been away, how many times today, and which old logs were recently revisited
- 带 `yearn-wake` 标记，不会被当成对方说话，也不重置计时 / tagged `yearn-wake`, so it is never mistaken for the human speaking and never resets the timer
- 连着叫几次没人回，冷却翻倍 / repeated unanswered wake-ups double the cooldown

**提醒文字可以自己写。** 平时那句、满值那句都能改。
*Reminder lines are editable.* Both the everyday line and the at-cap line.

**面板补齐所有可调项。** 叫醒门槛、一天几次、积极程度、提醒门槛、刚聊完余温、回看冷却、保留天数、追问开关。
*The panel now exposes every tunable:* wake threshold, daily cap, eagerness, reminder threshold, post-conversation baseline, look-back cooldown, retention days, follow-up switch.

### 修 / Fixed

- **没勾选的会话里说话也会重置计时** —— 监听挂到了所有会话，但没判这个会话勾没勾
  *Talking in an unticked conversation reset the timer* — the listener was attached to every conversation without checking whether it was enabled
- **叫醒后冷却计数没递增** —— 永远停最短档，不会翻倍
  *The wake streak counter never incremented*, so the cooldown never doubled
- 提醒文字原来是只读展示，改不成 / the reminder line was read-only

### 测试 / Tests

50 项。新增六条场景演练，真的模拟时间流逝：
*50 tests. Six new scenario runs that actually simulate time passing:*

- 分数按点表爬（0/3/8/14/20 小时）/ score follows the point table
- 聊天期间往下掉（60 分聊 2 分钟 → 57）/ it bleeds while you talk
- 安静时段跨午夜 / quiet hours across midnight
- 分数不下限（永远不低于 2）/ never drops below 2
- 未勾选会话说话不影响计时 / unticked conversations don't affect the timer
- 状态文件缺 score 时按时间倒推 / missing score is back-derived from time, not zeroed

---

## 0.2.0 — 2026-11-27

**面板重做。分数从界面上撤了，改成「离开多久 → 我会怎样」。**
*Panel rebuilt: the score is gone from the UI. Users now see「how long you've been away → what I do about it」.*

### 改 / Changed

- 曲线从两个系数换成「几小时 → 几分」的点表，能加能删
  *The curve became an editable table of hours → score*
- 曲线只画给人看，不能拖 / the curve is display-only
- 纵轴换成状态词：暂时没什么感觉 / 开始想起你 / 经常想起你 / 很容易想起你
  *Y axis uses plain states instead of raw numbers*
- 生效范围按对话选，界面上只显示对话名，不再露路径
  *Scope is per-conversation; only names are shown, never paths*
- 「宵禁」改叫「安静时段」/「提醒冷却」改叫「两次提醒的最短间隔」
  *Renamed: quiet hours, minimum gap between reminders*
- 高级设置里的「最低触发分数」删掉，由曲线决定
  *Removed the raw-score threshold from settings*
- 清空 / 重置按钮加确认框 / destructive buttons now confirm

### 修 / Fixed

- 面板每 5 秒刷新会冲掉正在输入的值 / the 5-second refresh wiped in-progress input
- 数字框删到空会被当成 0 弹回去 / number inputs snapped back to 0 when cleared
- SVG 在 flex 容器里高度塌成 0，曲线不显示 / the SVG collapsed to 0 height inside flex
- 曲线拖动时监听器重复注册 / drag listeners were re-registered on every render
- 工具调用参数里的双反斜杠导致「回头」识别不到 / doubled backslashes broke look-back detection
- 用 `turn/end` 当一轮分界，整轮内容被切空 / `turn/end` as a boundary emptied the turn
- CSS 属性选择器掉了方括号，样式失效 / a malformed attribute selector killed a block of CSS

### 加 / Added

- 38 项测试 + 字段一致性检查 / 38 tests plus a field-consistency check
- 中英日三语 README / trilingual README

---

## 0.1.0 — 2026-11-27

**第一个跑起来的版本。**
*First working version.*

- 两个数：等（对方多久没说话）、回头（AI 自己回看旧记录的次数）
  *Two numbers: waiting, and looking back*
- 分数只由时间算，别的东西不许碰它 / the score is computed from time alone
- 涨到一定程度，往系统提示里塞一句话；低分段一声不响
  *Past a threshold it injects one line into the system prompt; below it, silence*
- 配置文件在 `~/.dsh/yearn/` / config lives in `~/.dsh/yearn/`
