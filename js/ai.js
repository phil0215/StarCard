/* ===== js/ai.js ===== */
/**
 * 闪星卡（StarCard）· 本地智能助手「小星」
 * ------------------------------------------------------------------
 * 纯离线运行：不联网、不上传、不调用任何外部接口。
 * 「智能」来自对本地数据的理解：词库检索、FSRS 学习状态、复习日志与
 * 规则式自然语言意图识别。所有回答都基于这台设备上的真实数据生成。
 * 暴露到 window.FC.AI，供 ui.js 渲染、app.js 调度。
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  if (!FC) return;

  // ---------------------------------------------------------------- 工具
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function stripTags(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  // 把卡片例句里的 ==word== 标记转成红色加粗 span（与渲染层一致）
  function markHl(s) {
    return esc(s == null ? '' : s).replace(/==([^=\n]+)==/g, '<span class="hl-word">$1</span>');
  }
  function cap(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  // ---------------------------------------------------------------- 数据读取
  function overview(app) {
    try { return FC.smartOverview ? FC.smartOverview(app.state) : null; } catch (e) { return null; }
  }
  function allCards(app) {
    const out = [];
    const decks = (app && app.state && app.state.decks) || [];
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      const cards = d.cards || [];
      for (let j = 0; j < cards.length; j++) out.push({ card: cards[j], deck: d });
    }
    return out;
  }
  // 把 back 文本解析成结构化块：释义 / 词根词缀 / 助记 / 例句
  function parseBack(back) {
    const out = { meaning: '', root: '', mnem: '', example: '', sound: '' };
    const lines = String(back || '').split(/\r?\n/);
    const labels = { '释义': 'meaning', '词根词缀': 'root', '词源': 'root', '注记': 'root',
      '助记': 'mnem', '用法': 'mnem', '例句': 'example' };
    let cur = '';
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (labels[t]) { cur = labels[t]; continue; }
      const sm = t.match(/^\[sound:([^\]]+)\]$/);
      if (sm) { out.sound = sm[1]; continue; }
      if (!t) continue;
      if (cur && !out[cur]) out[cur] = lines[i].trim();
    }
    if (!out.meaning) {
      // 兜底：取第一段非空文本当释义
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t && !labels[t] && !/^\[sound:/.test(t)) { out.meaning = t; break; }
      }
    }
    return out;
  }
  // 查词：按 front 精确 / 前缀 / 包含匹配。返回最相关的若干张。
  function findWords(q, app, limit) {
    limit = limit || 3;
    const raw = String(q || '').toLowerCase().trim();
    // 意图词、停用词过滤，提取可能的英文词/短语
    let phrase = raw
      .replace(/(什么|意思|释义|含义|翻译|单词|词根|词缀|助记|例句|怎么记|什么意思|查|一下|这个|那个)/g, ' ')
      .replace(/(what|meaning|mean|define|definition|the|word|of|for|to|is|are|does|do)/gi, ' ')
      .replace(/[?？。，,!！]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!phrase) phrase = raw.replace(/[?？。，,!！]/g, ' ').trim();
    if (!phrase) return [];
    const all = allCards(app);
    const scored = [];
    for (let i = 0; i < all.length; i++) {
      const f = stripTags(all[i].card.front).toLowerCase().trim();
      if (!f || f.length > 60) continue;
      let sc = 0;
      if (f === phrase) sc = 100;
      else if (f.indexOf(phrase) === 0) sc = 80;
      else if (f.indexOf(phrase) >= 0) sc = 60;
      else if (phrase.indexOf(f) >= 0 && f.length >= 3) sc = 45;
      if (sc) scored.push({ item: all[i], sc: sc });
    }
    scored.sort(function (a, b) { return b.sc - a.sc; });
    return scored.slice(0, limit).map(function (x) { return x.item; });
  }

  // ---------------------------------------------------------------- 回答生成器
  function bubble(iconName, tone, html) {
    return '<div class="ai-reply tone-' + esc(tone || 'brand') + '">' +
      '<span class="ai-reply-ico">' + (global.FCUI && global.FCUI.icon ? global.FCUI.icon(iconName || 'sparkles', 'i16') : '') + '</span>' +
      '<div class="ai-reply-body">' + html + '</div></div>';
  }
  function chip(label, act, extra) {
    return '<button class="ai-chip" data-act="' + esc(act) + '"' + (extra || '') + '>' + esc(label) + '</button>';
  }
  function greet() {
    return bubble('sparkles', 'brand',
      '<div>你好，我是 <strong>小星</strong> —— 你的离线学习搭档。我不联网，只懂你这台设备上的数据。</div>' +
      '<div class="ai-hint-title">试试这样问我</div>' +
      '<div class="ai-chips">' +
      chip('今天要学多少？', 'ai-prompt', ' data-q="今天要学多少"') +
      chip('帮我安排学习计划', 'ai-prompt', ' data-q="帮我安排今天的学习计划"') +
      chip('我哪些词总记不住？', 'ai-prompt', ' data-q="我哪些词总记不住"') +
      chip('查 auspicious', 'ai-prompt', ' data-q="查 auspicious"') +
      '</div>');
  }
  function capabilities() {
    return bubble('info', 'brand',
      '<div>我能做这些事（全部在本地完成）：</div>' +
      '<div class="ai-cap-list">' +
      '<div>' + (global.FCUI ? global.FCUI.icon('book', 'i14') : '') + '<span><b>查单词</b> —— 直接输入英文词，给你释义、词根词缀、助记、英文例句并朗读</span></div>' +
      '<div>' + (global.FCUI ? global.FCUI.icon('chart', 'i14') : '') + '<span><b>学习概况</b> —— 今日待学、到期、连续打卡、真实留存率</span></div>' +
      '<div>' + (global.FCUI ? global.FCUI.icon('target', 'i14') : '') + '<span><b>学习计划</b> —— 根据待办和你的节奏，安排今天先学什么</span></div>' +
      '<div>' + (global.FCUI ? global.FCUI.icon('flag', 'i14') : '') + '<span><b>难词分析</b> —— 用 FSRS 算出可提取度最低、最该攻克的词</span></div>' +
      '<div>' + (global.FCUI ? global.FCUI.icon('target', 'i14') : '') + '<span><b>复习优先级与时间</b> —— 算出哪些词要抓紧复习、大概需要多久</span></div>' +
      '<div>' + (global.FCUI ? global.FCUI.icon('zap', 'i14') : '') + '<span><b>快捷操作</b> —— 开始学习、打开数据、导入 / 导出、切换外观</span></div>' +
      '</div>' +
      '<div class="ai-hint-title">直接说，比如「哪些词要抓紧复习」「要学多久」</div>');
  }

  // 学习概况
  function answerOverview(app) {
    const ov = overview(app);
    if (!ov || !ov.hasData) {
      return bubble('book', 'amber', '<div>还没有学习数据。先到「词书」页导入一套词库，我就能帮你盯进度了。</div>' +
        '<div class="ai-chips">' + chip('去词书页', 'ai-cmd', ' data-key="tab-book"') + '</div>');
    }
    const html = '<div>今天还有 <strong>' + ov.planned + ' 张</strong>要学' +
      '（新卡 ' + ov.newLeft + ' · 到期 ' + ov.due + '），预计 <strong>' + ov.minutes + ' 分钟</strong>。</div>' +
      '<div>你已经连续学习 <strong>' + ov.streak + ' 天</strong>，当前真实留存 <strong>' +
      (ov.retention > 0 ? Math.round(ov.retention * 100) + '%' : '—') + '</strong>，共掌握 ' + ov.mastered + ' / ' + ov.total + ' 张。</div>' +
      '<div class="ai-sub">' + esc(ov.advice && ov.advice.desc ? ov.advice.desc : '') + '</div>' +
      '<div class="ai-chips">' + chip('开始学习', 'ai-cmd', ' data-key="study"') +
      chip('安排计划', 'ai-prompt', ' data-q="帮我安排今天的学习计划"') + '</div>';
    return bubble('chart', 'brand', html);
  }

  // 学习计划
  function answerPlan(app) {
    const ov = overview(app);
    if (!ov || !ov.hasData || ov.planned === 0) {
      return bubble('checkCircle', 'green', '<div>今天的任务已经清空，没有待学的卡片了。想加练的话，可以用「自定义学习」。</div>' +
        '<div class="ai-chips">' + chip('打开数据看看', 'ai-cmd', ' data-key="tab-chart"') + '</div>');
    }
    const steps = [];
    const a = reviewAnalysis(app);
    if (ov.due > 0) steps.push('<b>第 1 步 · 清到期</b>：先复习 ' + ov.due + ' 张到期卡，趁记忆还没滑坡，这是最优先的。');
    if (a.lowRCnt > 0) steps.push('<b>第 2 步 · 救低留存</b>：另有 ' + a.lowRCnt + ' 张可提取度已明显下降，建议一并复习，别等彻底忘了再补。');
    if (ov.newLeft > 0) steps.push('<b>第 ' + (steps.length + 1) + ' 步 · 学新卡</b>：再学 ' + ov.newLeft + ' 张新卡，按「交错」顺序不容易疲劳。');
    const weak = weakWords(app, 1);
    if (weak.length) steps.push('<b>最后 · 攻克难词</b>：「' + esc(cap(stripTags(weak[0].card.front), 16)) + '」本机算出可提取度仅 ' +
      weak[0].retention + '%、遗忘 ' + weak[0].lapses + ' 次，可用自定义学习单独拎出来练。');
    steps.push('<b>节奏建议</b>：本机按历史每题约 ' + a.avgSec + ' 秒估算，全程约 ' + ov.minutes + ' 分钟，中途累了就按 S 暂停，进度会自动保存。');
    return bubble('target', 'brand',
      '<div>按你现在的情况，我建议这样安排今天：</div>' +
      '<div class="ai-plan">' + steps.map(function (s, i) { return '<div class="ai-plan-step"><span>' + (i + 1) + '</span><div>' + s + '</div></div>'; }).join('') + '</div>' +
      '<div class="ai-chips">' + chip('照计划开始', 'ai-cmd', ' data-key="study"') + '</div>');
  }

  // ---------------------------------------------------------------- 本地算力：复习优先级分析
  // 完全在本机计算，不联网。综合 FSRS 可提取度、逾期天数、遗忘次数、难度与 Leech，
  // 算出「最该多复习的词」以及「大概要花多少时间」，供难词分析 / 学习计划 / 数据诊断共用。
  function reviewAnalysis(app) {
    const st = (app && app.state) || {};
    const settings = st.settings || {};
    const fsrs = new FC.Fsrs(settings);
    const now = Date.now();
    const all = allCards(app);
    const items = [];
    let dueCnt = 0, lowRCnt = 0, urgentSeconds = 0;
    // 每张卡的估算秒数：优先用本机历史平均答题耗时，缺省按 8 秒
    let avgSec = 8;
    if (st.stats && st.stats.length) {
      let tot = 0, cnt = 0;
      for (let k = 0; k < st.stats.length; k++) {
        const e = st.stats[k];
        if (e.reviews > 0) { tot += (e.timeMs || 0) / 1000; cnt += e.reviews; }
      }
      if (cnt > 0) avgSec = Math.max(2, Math.min(30, Math.round(tot / cnt)));
    }
    for (let i = 0; i < all.length; i++) {
      const c = all[i].card;
      const sch = c.scheduling || {};
      const reps = sch.reps || 0;
      if (c.suspended || reps === 0) continue; // 只看学过的卡
      const stability = sch.stability || 1;
      const difficulty = sch.difficulty || 5;
      const lapses = sch.lapses || 0;
      // 时间统一转毫秒：scheduling 里存的是 ISO 字符串，直接做减法会得到 NaN
      const lastMs = Date.parse(sch.lastReview || sch.due || '') || now;
      const elapsed = Math.max(0, (now - lastMs) / FC.DAY_MS);
      const R = fsrs.retrievability(elapsed, stability); // 当前可提取度 0-1
      const dueMs = Date.parse(sch.due || '') || lastMs;
      const overdue = Math.max(0, (now - dueMs) / FC.DAY_MS);
      const isDue = dueMs <= now;
      const leeched = !!c.leeched || lapses >= (settings.leechThreshold || 8);
      if (isDue) dueCnt++;
      if (R < (settings.requestRetention || 0.9) - 0.1) lowRCnt++;
      // 紧急度：可提取度越低越急；再做逾期 / 遗忘 / 难度 / Leech 加权
      let urgency = (1 - R) * 100;
      urgency += Math.min(overdue, 30) * 1.5;
      urgency += lapses * 4;
      urgency += Math.max(0, difficulty - 5) * 1.5;
      if (leeched) urgency += 20;
      items.push({
        card: c, deck: all[i].deck, R: R, retention: Math.round(R * 100),
        overdue: overdue, overdueDays: Math.floor(overdue), lapses: lapses,
        difficulty: difficulty, stability: stability, reps: reps,
        leeched: leeched, isDue: isDue, urgency: Math.round(urgency)
      });
    }
    items.sort(function (a, b) { return b.urgency - a.urgency; });
    // 预计复习时间：按到期卡 + 低留存紧急卡估算，扣除重复
    const focus = items.filter(function (x) { return x.isDue || x.R < (settings.requestRetention || 0.9) - 0.05; });
    urgentSeconds = focus.length * avgSec;
    const ov = overview(app);
    let minutes = focus.length ? Math.max(1, Math.round(urgentSeconds / 60)) : 0;
    if (ov && ov.minutes > minutes) minutes = ov.minutes; // 与今日概览取较大值，保守估计
    return {
      items: items, dueCnt: dueCnt, lowRCnt: lowRCnt,
      focusCount: focus.length, minutes: minutes, avgSec: avgSec,
      hasData: items.length > 0
    };
  }

  // 难词（强化：按复习优先级而非单纯遗忘次数）
  function weakWords(app, limit) {
    limit = limit || 5;
    const a = reviewAnalysis(app);
    if (!a.hasData) return [];
    // 取真正薄弱的（有遗忘或可提取度低）
    const weak = a.items.filter(function (x) {
      return x.lapses > 0 || x.R < 0.85 || x.leeched;
    });
    return weak.slice(0, limit).map(function (x) {
      return { card: x.card, deck: x.deck, lapses: x.lapses, leeched: x.leeched,
        retention: x.retention, overdueDays: x.overdueDays, urgency: x.urgency };
    });
  }
  function answerWeak(app) {
    const a = reviewAnalysis(app);
    const weak = weakWords(app, 6);
    if (!weak.length) {
      return bubble('checkCircle', 'green', '<div>目前没有反复遗忘或记忆不稳的词，记忆状态很健康。继续保持每日复习就好。</div>');
    }
    const rows = weak.map(function (w) {
      const why = w.overdueDays > 0 ? ('逾期 ' + w.overdueDays + ' 天') : ('可提取度 ' + w.retention + '%');
      return '<div class="ai-weak-row"><span class="ai-weak-w">' + esc(cap(stripTags(w.card.front), 20)) +
        (w.leeched ? '<em>难词</em>' : '') + '</span>' +
        '<span class="ai-weak-n">' + why + ' · 忘 ' + w.lapses + ' 次</span></div>';
    }).join('');
    return bubble('flag', 'amber',
      '<div>这些词最该多复习（按可提取度、逾期与遗忘综合算出）：</div>' +
      '<div class="ai-weak">' + rows + '</div>' +
      '<div class="ai-sub">本机算得：当前 ' + a.dueCnt + ' 张已到期、' + a.lowRCnt +
      ' 张可提取度偏低，集中复习约需 ' + a.minutes + ' 分钟。想集中练，用「自定义学习」按 Leeched 筛选。</div>' +
      '<div class="ai-chips">' + chip('打开浏览器', 'ai-cmd', ' data-key="browser"') +
      chip('看学习计划', 'ai-prompt', ' data-q="帮我安排今天的学习计划"') + '</div>');
  }

  // 复习优先级 / 时间预估（回答「哪些词要抓紧复习 / 要学多久」）
  function answerPriority(app) {
    const a = reviewAnalysis(app);
    if (!a.hasData) {
      return bubble('book', 'amber', '<div>还没有学习数据。导入一套词库并学过几张卡后，我就能算出哪些词最该复习、大概要花多久。</div>');
    }
    const top = a.items.slice(0, 5).map(function (x) {
      return '<div class="ai-weak-row"><span class="ai-weak-w">' + esc(cap(stripTags(x.card.front), 20)) +
        (x.leeched ? '<em>难词</em>' : '') + '</span>' +
        '<span class="ai-weak-n">可提取度 ' + x.retention + '%' +
        (x.overdueDays > 0 ? ' · 逾期 ' + x.overdueDays + ' 天' : '') + '</span></div>';
    }).join('');
    return bubble('target', 'brand',
      '<div>我用 FSRS 在本机算了一遍，结论是：</div>' +
      '<div class="ai-plan">' +
      '<div class="ai-plan-step"><span>1</span><div>当前 <b>' + a.dueCnt + ' 张</b>已到期，<b>' + a.lowRCnt + ' 张</b>记忆可提取度偏低——这些是最该优先复习的。</div></div>' +
      '<div class="ai-plan-step"><span>2</span><div>按每张卡约 ' + a.avgSec + ' 秒估算，集中复习约 <b>' + a.minutes + ' 分钟</b>能过一遍。</div></div>' +
      '<div class="ai-plan-step"><span>3</span><div>先把下面这几张可提取度最低的清掉，记忆会稳很多。</div></div>' +
      '</div>' +
      '<div class="ai-weak">' + top + '</div>' +
      '<div class="ai-chips">' + chip('照此安排计划', 'ai-prompt', ' data-q="帮我安排今天的学习计划"') +
      chip('开始学习', 'ai-cmd', ' data-key="study"') + '</div>');
  }

  // 查词结果
  function answerWord(hits, app, rawQuery) {
    if (!hits.length) {
      return bubble('search', 'amber', '<div>词库里没找到「' + esc(cap(rawQuery, 30)) + '」。</div>' +
        '<div class="ai-sub">目前只收录了已导入词库里的词。你可以导入新词库后再问我，或换个拼写试试。</div>');
    }
    let html = '<div>查到 ' + hits.length + ' 个结果：</div>';
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const f = stripTags(hit.card.front);
      const p = parseBack(hit.card.back);
      html += '<div class="ai-word">' +
        '<div class="ai-word-h"><b>' + esc(f) + '</b>' +
        '<button class="ai-speak" data-act="ai-speak" data-word="' + esc(f) + '" title="朗读">' +
        (global.FCUI ? global.FCUI.icon('speaker', 'i14') : '🔊') + '</button>' +
        '<span class="ai-word-src">' + esc(cap(hit.deck.name, 18)) + '</span></div>';
      if (p.meaning) html += '<div class="ai-wl"><span>释义</span><div>' + esc(p.meaning) + '</div></div>';
      if (p.root) html += '<div class="ai-wl"><span>词根词缀</span><div>' + esc(p.root) + '</div></div>';
      if (p.mnem) html += '<div class="ai-wl"><span>助记</span><div>' + esc(p.mnem) + '</div></div>';
      if (p.example) html += '<div class="ai-wl"><span>例句</span><div>' + markHl(p.example) + '</div></div>';
      html += '</div>';
    }
    return bubble('book', 'brand', html);
  }

  // 快速操作的关键词映射（按顺序命中）
  const ACTION_RULES = [
    { re: /(开始|继续).*(学习|复习)|学习吧|刷题|去学习/, key: 'study', label: '开始学习' },
    { re: /(打开|看|去).*(数据|统计|图表)|数据页|统计页/, key: 'tab-chart', label: '打开数据' },
    { re: /(打开|去).*(设置|偏好)/, key: 'tab-settings', label: '打开设置' },
    { re: /(词书页|去词书|内容中心)/, key: 'tab-book', label: '去词书页' },
    { re: /(卡片页|首页|去卡片)/, key: 'tab-cards', label: '去卡片页' },
    { re: /导入|添加词库|载入/, key: 'import', label: '导入词库' },
    { re: /导出|备份/, key: 'export', label: '导出备份' },
    { re: /外观|主题|深色|夜间|换肤/, key: 'theme', label: '切换外观' },
    { re: /快捷键|按键/, key: 'shortcuts', label: '快捷键' },
    { re: /浏览器|浏览卡片/, key: 'browser', label: '卡片浏览器' }
  ];

  // ---------------------------------------------------------------- 主入口
  // 返回 { html, speak?: '单词' }
  function answer(text, app) {
    const q = String(text || '').trim();
    if (!q) return { html: greet() };

    // 1) 操作意图
    for (let i = 0; i < ACTION_RULES.length; i++) {
      if (ACTION_RULES[i].re.test(q)) {
        const r = ACTION_RULES[i];
        return { html: bubble('zap', 'green', '<div>好的，正在为你<strong>' + esc(r.label) + '</strong>。</div>') + '', _action: r.key };
      }
    }
    // 2) 计划意图
    if (/(计划|安排|规划|先学|怎么学|节奏)/.test(q)) return { html: answerPlan(app) };
    // 3) 难词意图
    if (/(总记不住|记不住|总忘|老忘|遗忘|难词|薄弱|攻克|leeched)/i.test(q)) return { html: answerWeak(app) };
    // 4) 复习优先级 / 时间估算意图（本地算力）
    if (/(抓紧|优先|先复习|重点复习|哪些.*复习|复习.*多久|要多久|需要多久|花.*时间|要学多久|学.*多久|该复习)/.test(q)) return { html: answerPriority(app) };
    // 5) 概况意图
    if (/(今天|今日|待学|要学|多少|还剩|到期|连续|打卡|留存|正确率|进度|学得怎么样)/.test(q)) return { html: answerOverview(app) };
    // 6) 能力 / 帮助
    if (/(你能|会什么|能做什么|帮助|帮我|你好|hi|hello|功能)/i.test(q)) return { html: capabilities() };
    // 7) 查词：含明显英文词，或明确的查词动词
    const hasLatin = /[A-Za-z]/.test(q);
    const askWord = /(查|单词|什么意思|释义|翻译|词根|助记|例句|怎么记|define|mean)/i.test(q);
    if (hasLatin && (askWord || q.length <= 40)) {
      const hits = findWords(q, app, 3);
      if (hits.length) {
        const first = stripTags(hits[0].card.front);
        return { html: answerWord(hits, app, q), speak: first };
      }
      // 有英文但没匹配到 → 给查词无结果提示，而不是答非所问
      if (askWord || !/\s/.test(q)) return { html: answerWord([], app, q) };
    }
    // 8) 兜底
    return { html: bubble('sparkles', 'brand',
      '<div>我还没完全理解这句。换个说法试试——比如问「今天要学多少」「查一个单词」，或者说「开始学习」。</div>' +
      '<div class="ai-chips">' +
      chip('今天要学多少', 'ai-prompt', ' data-q="今天要学多少"') +
      chip('查单词', 'ai-prompt', ' data-q="查 auspicious"') +
      chip('我能做什么', 'ai-prompt', ' data-q="你能做什么"') +
      '</div>') };
  }

  // ---------------------------------------------------------------- 今日简报（卡片页用）
  function briefing(app) {
    const ov = overview(app);
    if (!ov || !ov.hasData) return '导入一套词库后，我会在每天开头帮你把要学的东西理清楚。';
    let s = '今天还有 ' + ov.planned + ' 张要学';
    if (ov.due > 0) s += '，其中 ' + ov.due + ' 张已到期，建议先清';
    s += '。';
    if (ov.streak > 0) s += '你已经连续学了 ' + ov.streak + ' 天，';
    if (ov.retention > 0) s += '真实留存 ' + Math.round(ov.retention * 100) + '，状态不错。';
    else s += '继续保持。';
    return s;
  }

  // ---------------------------------------------------------------- 数据诊断（数据页用）
  function diagnosis(app) {
    const ov = overview(app);
    const items = [];
    if (!ov || !ov.hasData) {
      return [{ icon: 'info', tone: 'brand', title: '等待数据', desc: '完成一次学习后，我会在这里给出针对性的建议。' }];
    }
    // 复习节奏
    if (ov.due >= 5) items.push({ icon: 'clock', tone: 'red', title: '到期有点积压',
      desc: '有 ' + ov.due + ' 张卡已到期。优先清完再学新卡，记忆更牢。' });
    else if (ov.due > 0) items.push({ icon: 'rotate', tone: 'amber', title: '今天有 ' + ov.due + ' 张到期',
      desc: '按计划复习即可，FSRS 已排好最优顺序。' });
    else items.push({ icon: 'checkCircle', tone: 'green', title: '到期已清空',
      desc: '没有积压的复习任务，节奏很稳。' });
    // 记忆健康
    if (ov.retention > 0) {
      const r = Math.round(ov.retention * 100);
      items.push({ icon: 'target', tone: r >= 85 ? 'green' : (r >= 70 ? 'amber' : 'red'),
        title: '真实留存 ' + r + '%',
        desc: r >= 85 ? '高于目标，可适当延长间隔、少复习一点。'
          : (r >= 70 ? '接近目标，保持当前节奏即可。' : '偏低，建议降低每日新卡量、优先复习。') });
    }
    // 坚持度
    if (ov.streak >= 3) items.push({ icon: 'zap', tone: 'amber', title: '连续 ' + ov.streak + ' 天',
      desc: '习惯正在形成，别断今天这一棒。' });
    return items;
  }

  // ---------------------------------------------------------------- 命令面板数据源
  // 每项：{ key, label, sub, icon, act, ...params }
  function commands(app) {
    const list = [
      { key: 'tab-cards', label: '卡片', sub: '学习 · 今日待办', icon: 'cards', act: 'tab', tab: 0 },
      { key: 'tab-book', label: '词书', sub: '词库 · 导入与制作', icon: 'book', act: 'tab', tab: 1 },
      { key: 'tab-chart', label: '数据', sub: '查看 · 学习统计', icon: 'chart', act: 'tab', tab: 5 },
      { key: 'tab-settings', label: '设置', sub: '查看 · 偏好与数据', icon: 'settings', act: 'tab', tab: 6 },
      { key: 'study', label: '开始今日学习', sub: '快速进入卡片学习', icon: 'play', act: 'study-all' },
      { key: 'import', label: '导入词库', sub: '.srcd / .apkg / CSV', icon: 'upload', act: 'import' },
      { key: 'export', label: '导出备份', sub: '导出 .srcd 文件', icon: 'download', act: 'export' },
      { key: 'browser', label: '卡片浏览器', sub: '搜索 / 管理所有卡片', icon: 'table', act: 'browser' },
      { key: 'shortcuts', label: '快捷键帮助', sub: '键盘操作一览', icon: 'keyboard', act: 'shortcuts' },
      { key: 'ai-plan', label: '让小星安排今天', sub: 'AI · 生成学习计划', icon: 'sparkles', act: 'ai-prompt', text: '帮我安排今天的学习计划' },
      { key: 'ai-weak', label: '让小星找难词', sub: 'AI ·遗忘与可提取度分析', icon: 'sparkles', act: 'ai-prompt', text: '我哪些词总记不住' },
      { key: 'ai-priority', label: '让小星算复习优先级', sub: 'AI ·哪些词要抓紧复习、要多久', icon: 'target', act: 'ai-prompt', text: '哪些词要抓紧复习，大概要学多久' }
    ];
    const decks = (app && app.state && app.state.decks) || [];
    for (let i = 0; i < decks.length && i < 12; i++) {
      const d = decks[i];
      list.push({ key: 'deck-' + d.id, label: d.name, sub: '牌组 · ' + (d.cards ? d.cards.length : 0) + ' 张',
        icon: 'layers', act: 'study-deck', id: d.id });
    }
    return list;
  }
  // 模糊匹配：按顺序子字符串打分
  function matchScore(text, q) {
    text = String(text || '').toLowerCase();
    q = String(q || '').toLowerCase().trim();
    if (!q) return 1;
    const idx = text.indexOf(q);
    if (idx === 0) return 100;
    if (idx > 0) return 70 - Math.min(idx, 30);
    // 逐字顺序匹配
    let ti = 0;
    for (let i = 0; i < q.length; i++) {
      ti = text.indexOf(q[i], ti);
      if (ti < 0) return 0;
      ti++;
    }
    return 20;
  }
  function filterCommands(app, q, limit) {
    const qq = String(q || '').trim();
    const all = commands(app);
    const scored = [];
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      const sc = Math.max(matchScore(c.label, qq), matchScore(c.sub, qq) * 0.6, matchScore(c.key, qq) * 0.5);
      if (sc > 0) scored.push({ c: c, sc: sc });
    }
    scored.sort(function (a, b) { return b.sc - a.sc; });
    const out = scored.slice(0, limit || 8).map(function (x) { return x.c; });

    // 单词 / 卡片搜索：命中词库卡片时，优先给出「问小星查词」与具体卡片
    if (qq) {
      const hits = findWords(qq, app, 4);
      if (hits.length) {
        const first = stripTags(hits[0].card.front);
        const merged = [{
          key: 'ai-ask', label: '查 ' + cap(first, 24), sub: 'AI · 释义 / 助记 / 例句',
          icon: 'sparkles', act: 'ai-prompt', text: '查 ' + first
        }];
        for (let i = 0; i < hits.length; i++) {
          const h = hits[i];
          const f = stripTags(h.card.front);
          merged.push({
            key: 'card-' + h.card.id, label: cap(f, 24), sub: '卡片 · ' + cap(h.deck.name, 18),
            icon: 'cards', act: 'browser-q', q: f
          });
        }
        return merged.concat(out).slice(0, limit || 8);
      }
    }
    return out;
  }

  FC.AI = {
    ANSWER: answer,
    BRIEFING: briefing,
    DIAGNOSIS: diagnosis,
    COMMANDS: commands,
    FILTER: filterCommands,
    GREET: greet,
    FIND: findWords,
    REVIEW_ANALYSIS: reviewAnalysis,
    PARSE_BACK: parseBack,
    STRIP: stripTags,
    MARK: markHl
  };
  global.FC = FC;
})(typeof window !== 'undefined' ? window : globalThis);


