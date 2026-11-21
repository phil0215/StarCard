/* ===== js/anki.js ===== */
/**
 * 闪星卡（StarCard）· Anki 核心能力扩展
 * 依赖 core.js（window.FC），在 ui.js 之前加载。
 *
 * 覆盖：
 *  - 笔记类型 / 卡片模板（基础、含反向、填空）
 *  - 填空语法 {{c1::答案::提示}}
 *  - 牌组级选项覆盖
 *  - Anki 搜索语法
 *  - 学习统计聚合
 *  - CSV 导入导出
 *  - 安全字段渲染（图片 / 音频 / 轻量标记）
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  if (!FC) throw new Error('anki.js 需要先加载 core.js');

  const DAY = FC.DAY_MS;

  // -------------------------------------------------------------------------
  // 笔记类型
  // -------------------------------------------------------------------------
  const NOTETYPES = [
    {
      id: 'basic', name: '基础', desc: '一张卡：正面 → 背面',
      fields: ['Front', 'Back', 'Extra', 'Source'], cards: 1
    },
    {
      id: 'basic-reverse', name: '基础（含反向）', desc: '两张卡：正 → 反、反 → 正',
      fields: ['Front', 'Back', 'Extra', 'Source'], cards: 2
    },
    {
      id: 'cloze', name: '填空', desc: '每个 {{c1::空}} 生成一张卡',
      fields: ['Front', 'Extra', 'Source'], cards: -1
    }
  ];

  function notetypeById(id) {
    for (let i = 0; i < NOTETYPES.length; i++) if (NOTETYPES[i].id === id) return NOTETYPES[i];
    return NOTETYPES[0];
  }

  // -------------------------------------------------------------------------
  // 填空解析
  // {{c1::答案}} / {{c1::答案::提示}} / 同号多个空共用一张卡
  // -------------------------------------------------------------------------
  const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/g;

  function parseCloze(text) {
    const src = typeof text === 'string' ? text : '';
    const nums = [];
    const map = {};
    let m;
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(src)) !== null) {
      const n = parseInt(m[1], 10);
      if (!isFinite(n) || n <= 0) continue;
      if (!map[n]) { map[n] = []; nums.push(n); }
      map[n].push({ answer: m[2], hint: m[3] || '' });
    }
    nums.sort(function (a, b) { return a - b; });
    return { nums: nums, map: map, source: src };
  }

  function clozeNumbers(text) {
    return parseCloze(text).nums;
  }

  function renderCloze(text, num, reveal) {
    const src = typeof text === 'string' ? text : '';
    return src.replace(CLOZE_RE, function (all, n, answer, hint) {
      if (parseInt(n, 10) !== num) return reveal ? answer : (hint ? '[' + hint + ']' : '[...]');
      if (reveal) return answer;
      return hint ? '[' + hint + ']' : '[...]';
    });
  }

  // 把填空原文转成纯文本（用于列表预览）
  function clozePlain(text, reveal) {
    return String(text || '').replace(CLOZE_RE, function (all, n, answer, hint) {
      return reveal ? answer : (hint ? '[' + hint + ']' : '[...]');
    });
  }

  function hasCloze(text) {
    CLOZE_RE.lastIndex = 0;
    const ok = CLOZE_RE.test(String(text || ''));
    CLOZE_RE.lastIndex = 0;
    return ok;
  }

  // -------------------------------------------------------------------------
  // 生成 / 重建笔记（一组卡片）
  // -------------------------------------------------------------------------
  function normalizeIncomingFields(input) {
    const f = input || {};
    return {
      Front: String(f.Front || '').trim(),
      Back: String(f.Back || '').trim(),
      Extra: String(f.Extra || '').trim(),
      Source: String(f.Source || '').trim()
    };
  }

  function makeCardFrom(noteId, ord, notetype, fields, front, back, tags, clozeText) {
    const c = FC.newCard(front, back, fields.Extra, tags);
    c.noteId = noteId;
    c.ord = ord;
    c.notetype = notetype;
    c.fields = {
      Front: fields.Front, Back: fields.Back,
      Extra: fields.Extra, Source: fields.Source
    };
    c.cloze = clozeText || '';
    return c;
  }

  /** 由字段生成一组卡片（首次创建） */
  function buildCards(opts) {
    const type = notetypeById(opts.notetype || 'basic').id;
    const fields = normalizeIncomingFields(opts.fields);
    const tags = (opts.tags || []).slice();
    const noteId = opts.noteId || FC.makeId();
    const out = [];

    if (type === 'cloze') {
      const parsed = parseCloze(fields.Front);
      if (parsed.nums.length === 0) {
        // 没写填空语法时按普通卡处理，避免用户丢内容
        out.push(makeCardFrom(noteId, 0, 'basic', fields, fields.Front, fields.Back, tags, ''));
        return out;
      }
      for (let i = 0; i < parsed.nums.length; i++) {
        const n = parsed.nums[i];
        out.push(makeCardFrom(
          noteId, i, 'cloze', fields,
          renderCloze(fields.Front, n, false),
          renderCloze(fields.Front, n, true),
          tags, fields.Front
        ));
      }
      return out;
    }

    if (!fields.Front && !fields.Back) return out;

    out.push(makeCardFrom(noteId, 0, type, fields, fields.Front, fields.Back, tags, ''));
    if (type === 'basic-reverse' && fields.Back) {
      out.push(makeCardFrom(noteId, 1, type, fields, fields.Back, fields.Front, tags, ''));
    }
    return out;
  }

  /** 重建已有笔记：保留同名模板的调度，缺失的补新卡，多余的删除 */
  function rebuildNote(deck, noteId, opts) {
    const type = notetypeById(opts.notetype || 'basic').id;
    const fields = normalizeIncomingFields(opts.fields);
    const tags = (opts.tags || []).slice();

    const existing = [];
    for (let i = 0; i < deck.cards.length; i++) {
      if ((deck.cards[i].noteId || deck.cards[i].id) === noteId) existing.push(deck.cards[i]);
    }
    const keepByOrd = {};
    for (let i = 0; i < existing.length; i++) keepByOrd[existing[i].ord || 0] = existing[i];

    const fresh = buildCards({ notetype: type, fields: fields, tags: tags, noteId: noteId });
    const result = [];
    for (let i = 0; i < fresh.length; i++) {
      const c = fresh[i];
      const old = keepByOrd[c.ord];
      if (old) {
        old.notetype = c.notetype;
        old.fields = c.fields;
        old.cloze = c.cloze;
        old.front = c.front;
        old.back = c.back;
        old.extra = c.extra;
        old.tags = c.tags;
        old.modifiedAt = FC.nowIso();
        result.push(old);
      } else {
        result.push(c);
      }
    }

    const others = [];
    for (let i = 0; i < deck.cards.length; i++) {
      const c = deck.cards[i];
      const sameNote = (c.noteId || c.id) === noteId;
      if (!sameNote) others.push(c);
    }
    deck.cards = others.concat(result);
    return result;
  }

  /** 同笔记的兄弟卡（用于 buryRelated） */
  function siblingCards(deck, card) {
    const nid = card.noteId || card.id;
    const out = [];
    for (let i = 0; i < deck.cards.length; i++) {
      const c = deck.cards[i];
      if (c.id !== card.id && (c.noteId || c.id) === nid) out.push(c);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 牌组选项合并
  // -------------------------------------------------------------------------
  function pick(v, fallback) {
    return (v === null || v === undefined || v === '') ? fallback : v;
  }

  function settingsFor(deck, globalSettings) {
    const g = globalSettings || FC.defaultSettings();
    const o = (deck && deck.options) || FC.defaultDeckOptions();
    return {
      requestRetention: pick(o.requestRetention, g.requestRetention),
      maximumInterval: pick(o.maxInterval, g.maximumInterval),
      weights: g.weights,
      // 全局「统一设置」为保底上限：牌组旧值/残留值不得把全局调大的上限压回去。
      // 牌组可以设得比全局更大（单独放宽），但绝不能更小。
      newCardsPerDay: Math.max(g.newCardsPerDay, pick(o.newPerDay, 0)),
      reviewCardsPerDay: Math.max(g.reviewCardsPerDay, pick(o.reviewsPerDay, 0)),
      learningSteps: (o.learningSteps && o.learningSteps.length) ? o.learningSteps : g.learningSteps,
      relearningSteps: (o.relearningSteps && o.relearningSteps.length) ? o.relearningSteps : g.relearningSteps,
      graduatingInterval: pick(o.graduatingInterval, g.graduatingInterval || 1),
      easyInterval: pick(o.easyInterval, g.easyInterval || 4),
      leechThreshold: pick(o.leechThreshold, g.leechThreshold || 8),
      leechAction: pick(o.leechAction, g.leechAction || 'tag'),
      buryRelated: (o.buryRelated === null || o.buryRelated === undefined) ? g.buryRelated !== false : o.buryRelated,
      newOrder: pick(o.newOrder, g.newOrder || 'mix'),
      reviewOrder: pick(o.reviewOrder, g.reviewOrder || 'due'),
      showTimer: g.showTimer !== false,
      autoRevealSeconds: g.autoRevealSeconds || 0,
      theme: g.theme || 'light'
    };
  }

  // -------------------------------------------------------------------------
  // 搜索语法
  // 支持: deck: tag: is: flag: note: prop: added: rated:，- 取反，OR，引号
  // -------------------------------------------------------------------------
  const IS_VALUES = ['new', 'learning', 'review', 'relearning', 'suspended', 'buried', 'leeched', 'due', 'marked'];

  function tokenize(q) {
    const tokens = [];
    const re = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;
    let m;
    while ((m = re.exec(q)) !== null) {
      const neg = m[1] === '-';
      const key = (m[2] || '').toLowerCase();
      const value = (m[3] !== undefined ? m[3] : m[4]) || '';
      if (key === '' && value === '') continue;
      if (key === '' && value.toUpperCase() === 'OR') { tokens.push({ or: true }); continue; }
      tokens.push({ neg: neg, key: key, value: value });
    }
    return tokens;
  }

  function wildcard(text, pattern) {
    const t = String(text || '').toLowerCase();
    const p = String(pattern || '').toLowerCase();
    if (p.indexOf('*') < 0) return t.indexOf(p) >= 0;
    const parts = p.split('*');
    let idx = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      const found = t.indexOf(parts[i], idx);
      if (found < 0) return false;
      idx = found + parts[i].length;
    }
    return true;
  }

  function propMatch(card, expr) {
    const m = /^([a-zA-Z]+)\s*(>=|<=|>|<|=)\s*(-?[\d.]+)$/.exec(expr || '');
    if (!m) return false;
    const field = m[1].toLowerCase();
    const op = m[2];
    const target = parseFloat(m[3]);
    let actual = 0;
    if (field === 'lapses') actual = card.scheduling.lapses;
    else if (field === 'reps') actual = card.scheduling.reps;
    else if (field === 'due') actual = card.scheduling.scheduledDays;
    else if (field === 'ivl') actual = card.scheduling.scheduledDays;
    else if (field === 'ease' || field === 'difficulty') actual = card.scheduling.difficulty;
    else if (field === 'stability') actual = card.scheduling.stability;
    else return false;
    if (op === '>=') return actual >= target;
    if (op === '<=') return actual <= target;
    if (op === '>') return actual > target;
    if (op === '<') return actual < target;
    return Math.abs(actual - target) < 0.0001;
  }

  function cardDue(card, now) {
    if (card.state === FC.STATE_NEW) return false;
    if (!card.scheduling.due) return true;
    return Date.parse(card.scheduling.due) <= now;
  }

  function matchTerm(term, card, deck, now) {
    const v = term.value;
    const lv = String(v).toLowerCase();
    let hit = false;

    if (term.key === 'deck') {
      hit = wildcard(deck.name, v);
    } else if (term.key === 'tag') {
      hit = false;
      if (lv === 'none' || lv === '') hit = card.tags.length === 0;
      else for (let i = 0; i < card.tags.length; i++) if (wildcard(card.tags[i], v)) { hit = true; break; }
    } else if (term.key === 'is') {
      if (lv === 'new') hit = card.state === FC.STATE_NEW;
      else if (lv === 'learning') hit = card.state === FC.STATE_LEARNING;
      else if (lv === 'review') hit = card.state === FC.STATE_REVIEW;
      else if (lv === 'relearning') hit = card.state === FC.STATE_RELEARNING;
      else if (lv === 'suspended') hit = card.suspended === true;
      else if (lv === 'buried') hit = card.buried === true;
      else if (lv === 'leeched') hit = card.leeched === true;
      else if (lv === 'marked') hit = (card.flags || 0) > 0;
      else if (lv === 'due') hit = cardDue(card, now);
      else hit = false;
    } else if (term.key === 'flag') {
      if (lv === 'none' || lv === '0') hit = (card.flags || 0) === 0;
      else if (lv === 'marked') hit = (card.flags || 0) > 0;
      else {
        const n = parseInt(lv, 10);
        hit = isFinite(n) && (card.flags || 0) === n;
      }
    } else if (term.key === 'note') {
      hit = wildcard(card.notetype || 'basic', v);
    } else if (term.key === 'prop') {
      hit = propMatch(card, v);
    } else if (term.key === 'added') {
      const days = parseFloat(lv);
      if (isFinite(days)) {
        const t = Date.parse(card.createdAt);
        hit = !isNaN(t) && (now - t) <= days * DAY;
      }
    } else if (term.key === 'rated') {
      const days = parseFloat(lv);
      if (isFinite(days)) {
        const limit = now - days * DAY;
        for (let i = card.reviewLog.length - 1; i >= 0; i--) {
          if (Date.parse(card.reviewLog[i].reviewedAt) >= limit) { hit = true; break; }
        }
      }
    } else if (term.key === '') {
      const hay = (card.front + ' ' + card.back + ' ' + card.extra + ' ' +
        (card.fields ? (card.fields.Front + ' ' + card.fields.Back + ' ' + card.fields.Extra + ' ' + card.fields.Source) : '') + ' ' +
        card.tags.join(' ') + ' ' + deck.name).toLowerCase();
      hit = hay.indexOf(lv) >= 0;
    } else {
      // 未知字段当作普通文本
      hit = (card.front + ' ' + card.back).toLowerCase().indexOf(lv) >= 0;
    }
    return term.neg ? !hit : hit;
  }

  function matchQuery(query, card, deck, now) {
    const q = String(query || '').trim();
    if (q === '') return true;
    const tokens = tokenize(q);
    if (tokens.length === 0) return true;
    // OR 优先：只要有一组全部满足
    let group = [];
    const groups = [group];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].or) { group = []; groups.push(group); continue; }
      group.push(tokens[i]);
    }
    for (let g = 0; g < groups.length; g++) {
      let all = true;
      for (let i = 0; i < groups[g].length; i++) {
        if (!matchTerm(groups[g][i], card, deck, now)) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  }

  function runSearch(decks, query, now) {
    const out = [];
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      for (let j = 0; j < d.cards.length; j++) {
        if (matchQuery(query, d.cards[j], d, now)) out.push({ deck: d, card: d.cards[j] });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 统计聚合
  // -------------------------------------------------------------------------
  function intervalBucket(days) {
    if (days < 1) return 0;
    if (days < 3) return 1;
    if (days < 7) return 2;
    if (days < 14) return 3;
    if (days < 30) return 4;
    if (days < 90) return 5;
    if (days < 180) return 6;
    if (days < 365) return 7;
    return 8;
  }
  const INTERVAL_LABELS = ['<1 天', '1-3 天', '3-7 天', '1-2 周', '2-4 周', '1-3 月', '3-6 月', '6-12 月', '>1 年'];

  function analytics(state, nowMs) {
    const now = nowMs || Date.now();
    const today = FC.dateKey(now);
    const out = {
      total: 0, newCount: 0, learning: 0, review: 0, relearning: 0,
      suspended: 0, buried: 0, leech: 0, due: 0, overdue: 0, marked: 0,
      ratings: [0, 0, 0, 0], ratingsToday: [0, 0, 0, 0],
      reviewsToday: 0, timeToday: 0, retention: 0, retentionToday: 0,
      avgDifficulty: 0, avgStability: 0,
      intervals: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      statuses: [0, 0, 0, 0],
      forecast: [], daily: [], decks: [], tags: []
    };
    const diffSum = { v: 0, n: 0 };
    const stabSum = { v: 0, n: 0 };
    const tagCount = {};
    let passedAll = 0, totalAll = 0;
    let passedToday = 0, totalToday = 0;

    for (let i = 0; i < state.decks.length; i++) {
      const deck = state.decks[i];
      let deckDue = 0, deckNew = 0;
      for (let j = 0; j < deck.cards.length; j++) {
        const c = deck.cards[j];
        out.total += 1;
        if (c.suspended) out.suspended += 1;
        if (c.buried) out.buried += 1;
        if (c.leeched) out.leech += 1;
        if ((c.flags || 0) > 0) out.marked += 1;

        if (c.state === FC.STATE_NEW) { out.newCount += 1; deckNew += 1; }
        else if (c.state === FC.STATE_LEARNING) out.learning += 1;
        else if (c.state === FC.STATE_REVIEW) out.review += 1;
        else if (c.state === FC.STATE_RELEARNING) out.relearning += 1;

        if (c.state !== FC.STATE_NEW && !c.suspended) {
          const due = c.scheduling.due ? Date.parse(c.scheduling.due) : 0;
          if (due && due <= now) {
            out.due += 1; deckDue += 1;
            if (now - due > DAY) out.overdue += 1;
          }
          if (c.scheduling.scheduledDays > 0) {
            out.intervals[intervalBucket(c.scheduling.scheduledDays)] += 1;
          }
        }

        if (c.state === FC.STATE_REVIEW || c.state === FC.STATE_RELEARNING) {
          diffSum.v += c.scheduling.difficulty; diffSum.n += 1;
          stabSum.v += c.scheduling.stability; stabSum.n += 1;
        }

        for (let k = 0; k < c.tags.length; k++) {
          const t = c.tags[k];
          tagCount[t] = (tagCount[t] || 0) + 1;
        }

        for (let k = 0; k < c.reviewLog.length; k++) {
          const e = c.reviewLog[k];
          const r = Math.max(1, Math.min(4, Math.round(e.rating)));
          out.ratings[r - 1] += 1;
          totalAll += 1;
          if (r >= 2) passedAll += 1;
          if (String(e.reviewedAt).slice(0, 10) === today) {
            out.ratingsToday[r - 1] += 1;
            totalToday += 1;
            if (r >= 2) passedToday += 1;
          }
        }
      }
      out.decks.push({
        id: deck.id, name: deck.name, total: deck.cards.length,
        due: deckDue, newCount: deckNew
      });
    }

    out.statuses = [out.newCount, out.learning, out.review, out.relearning];
    out.retention = totalAll ? passedAll / totalAll : 0;
    out.retentionToday = totalToday ? passedToday / totalToday : 0;
    out.avgDifficulty = diffSum.n ? diffSum.v / diffSum.n : 0;
    out.avgStability = stabSum.n ? stabSum.v / stabSum.n : 0;

    for (let i = 0; i < state.stats.length; i++) {
      if (state.stats[i].date === today) {
        out.reviewsToday = state.stats[i].reviews;
        out.timeToday = state.stats[i].timeMs || 0;
      }
    }

    // 未来 30 天
    const sched = new FC.Scheduler(state.settings);
    out.forecast = sched.forecast(state.decks, now, 30);

    // 最近 14 天
    const byDate = {};
    for (let i = 0; i < state.stats.length; i++) byDate[state.stats[i].date] = state.stats[i];
    for (let i = 13; i >= 0; i--) {
      const t = now - i * DAY;
      const key = FC.dateKey(t);
      const st = byDate[key];
      out.daily.push({
        date: key,
        label: (i === 0 ? '今天' : (i === 1 ? '昨天' : (new Date(t).getMonth() + 1) + '/' + new Date(t).getDate())),
        reviews: st ? st.reviews : 0,
        passed: st ? st.passed : 0,
        timeMs: st ? (st.timeMs || 0) : 0
      });
    }

    // 学习热力图：最近 140 天（20 周）
    out.heatmap = [];
    for (let i = 139; i >= 0; i--) {
      const t = now - i * DAY;
      const key = FC.dateKey(t);
      const st = byDate[key];
      const reviews = st ? st.reviews : 0;
      let level = 0;
      if (reviews > 0) level = 1;
      if (reviews >= 10) level = 2;
      if (reviews >= 30) level = 3;
      if (reviews >= 60) level = 4;
      out.heatmap.push({ date: key, reviews: reviews, level: level });
    }

    // 标签 Top
    const tagList = [];
    for (const k in tagCount) if (Object.prototype.hasOwnProperty.call(tagCount, k)) {
      tagList.push({ tag: k, count: tagCount[k] });
    }
    tagList.sort(function (a, b) { return b.count - a.count; });
    out.tags = tagList.slice(0, 20);

    return out;
  }

  function allTags(decks) {
    const map = {};
    for (let i = 0; i < decks.length; i++) {
      const cards = decks[i].cards;
      for (let j = 0; j < cards.length; j++) {
        for (let k = 0; k < cards[j].tags.length; k++) map[cards[j].tags[k]] = true;
      }
    }
    const out = [];
    for (const t in map) if (Object.prototype.hasOwnProperty.call(map, t)) out.push(t);
    out.sort();
    return out;
  }

  // -------------------------------------------------------------------------
  // 字段渲染（安全子集）
  // -------------------------------------------------------------------------
  function escHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function mediaMap(card) {
    const map = {};
    if (!card || !card.media) return map;
    // 媒体解析优先级：
    //  ① 卡片自带 base64（外部导入的 .apkg 媒体）
    //  ② 全局 BAI_MEDIA 池（兼容旧版内联资源）
    //  ③ 卡片自带媒体：外部导入的 .apkg 媒体以 base64 内置在卡片里，<img> 直接读取。
    //     Cloudflare 精简版不依赖外部媒体目录，避免大量散装文件。
    const pool = (typeof window !== 'undefined' && window.BAI_MEDIA) ||
      (typeof globalThis !== 'undefined' && globalThis.BAI_MEDIA) || {};
    for (let i = 0; i < card.media.length; i++) {
      const m = card.media[i];
      if (!m || !m.name) continue;
      const data = m.data || pool[m.name];
      if (data) {
        map[m.name] = 'data:' + (m.mime || 'application/octet-stream') + ';base64,' + data;
      } else {
        // Cloudflare 精简版：媒体已随词库以 base64 内置，不依赖外部媒体目录。
        // 保留根路径兜底（若用户自行为某卡补了同名媒体文件，放在网页同目录即可读取）。
        map[m.name] = FC.assetUrl(encodeURIComponent(m.name));
      }
    }
    return map;
  }

  function renderRich(text, card) {
    let html = escHtml(text);
    const media = mediaMap(card);
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (all, alt, src) {
      const name = String(src).replace(/^media:/, '');
      if (!media[name]) return all;
      return '<img class="field-img" alt="' + escHtml(alt) + '" src="' + media[name] + '">';
    });
    // 用户要求：卡片里不要任何发音。彻底移除 [sound:] 标签，不渲染 audio。
    html = html.replace(/\[sound:[^\]]+\]/g, '');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    // 目标词标红加粗：==word== → 红色粗体（用于纯英文例句中的目标单词）
    html = html.replace(/==([^=\n]+)==/g, '<span class="hl-word">$1</span>');
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  }

  /** 学习卡正反面：把填空挖空 / 高亮 */
  function renderCardFace(card, side) {
    const reveal = side === 'back';
    let text = '';
    if (card.notetype === 'cloze' && card.cloze) {
      const parsed = parseCloze(card.cloze);
      // 找到当前卡对应的空号（ord → nums[ord]）
      const num = parsed.nums[card.ord] || parsed.nums[0] || 1;
      text = renderCloze(card.cloze, num, reveal);
    } else {
      text = reveal ? card.back : card.front;
    }
    return text;
  }

  // 结构化释义：把「释义 / 词根词缀 / 助记 / 例句」分段文本拆成区块。
  // 仅当文本里出现这些中文小标题时才启用；普通卡片仍走 renderRich。
  const BACK_LABELS = ['释义', '词根词缀', '助记', '例句', '词源', '搭配', '用法', '辨析', '近义', '反义'];
  function parseStructuredBack(text) {
    const src = String(text == null ? '' : text);
    let sound = '';
    const sm = src.match(/\[sound:([^\]]+)\]/);
    if (sm) sound = sm[1];
    const raw = src.replace(/\[sound:[^\]]+\]/g, '').trim();
    const blocks = [];
    let cur = null;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const label = line.trim();
      if (BACK_LABELS.indexOf(label) >= 0) {
        cur = { label: label, lines: [] };
        blocks.push(cur);
      } else if (cur) {
        cur.lines.push(line);
      } else {
        // 标题之前的内容（如「释义」写在第一行之前）也归入首个块
        if (!blocks.length) { cur = { label: '释义', lines: [] }; blocks.push(cur); }
        cur.lines.push(line);
      }
    }
    return { blocks: blocks, sound: sound };
  }

  function isStructuredBack(text) {
    const src = String(text == null ? '' : text);
    for (let i = 0; i < BACK_LABELS.length; i++) {
      if (new RegExp('(^|\\n)\\s*' + BACK_LABELS[i] + '\\s*\\n').test(src)) return true;
    }
    return false;
  }

  function renderStructuredBack(text, card) {
    const parsed = parseStructuredBack(text);
    const media = mediaMap(card);
    const blocks = parsed.blocks;
    // 主释义：找「释义」块；没有则取第一个块
    let main = null, mainIdx = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].label === '释义') { main = blocks[i]; mainIdx = i; break; }
    }
    if (!main && blocks.length) { main = blocks[0]; mainIdx = 0; }
    let html = '<div class="st-card">';
    if (main) {
      const meaning = renderRich(main.lines.join('\n').trim(), card);
      html += '<div class="st-meaning">' + meaning + '</div>';
      // 用户要求：卡片里不要任何发音。不再渲染「播放美音」按钮。
    }
    const rest = blocks.filter(function (_, i) { return i !== mainIdx; });
    if (rest.length) {
      html += '<div class="st-blocks">';
      for (let i = 0; i < rest.length; i++) {
        const b = rest[i];
        const body = b.lines.join('\n').trim();
        if (!body) continue;
        html += '<div class="st-block"><div class="st-label">' + escHtml(b.label) + '</div>' +
          '<div class="st-body">' + renderRich(body, card) + '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderCardHtml(card, side) {
    const text = renderCardFace(card, side);
    // 结构化背面（如 SAT800 词库）：中文释义置顶、词根词缀/助记/例句分区在下
    if (side === 'back' && card.notetype !== 'cloze' && isStructuredBack(text)) {
      return renderStructuredBack(text, card);
    }
    let html = renderRich(text, card);
    if (card.notetype === 'cloze' && side === 'back') {
      const parsed = parseCloze(card.cloze || '');
      const num = parsed.nums[card.ord] || parsed.nums[0] || 1;
      const answers = parsed.map[num] || [];
      for (let i = 0; i < answers.length; i++) {
        const a = escHtml(answers[i].answer);
        if (a) html = html.split(a).join('<mark class="cloze-ans">' + a + '</mark>');
      }
    }
    return html;
  }

  // -------------------------------------------------------------------------
  // CSV
  // -------------------------------------------------------------------------
  function detectDelimiter(text) {
    const firstLine = String(text || '').split(/\r?\n/)[0] || '';
    if (firstLine.indexOf('\t') >= 0) return '\t';
    if (firstLine.indexOf(';') >= 0 && firstLine.indexOf(',') < 0) return ';';
    return ',';
  }

  function parseCsv(text, delimiter) {
    const src = String(text || '').replace(/^\uFEFF/, '');
    const d = delimiter || detectDelimiter(src);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === d) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (ch === '\r') {
        // 忽略
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 0 && r.join('').trim() !== ''; });
  }

  const CSV_HEADERS = {
    front: ['front', '正面', '问题', 'front field'],
    back: ['back', '背面', '答案', 'back field'],
    tags: ['tags', '标签'],
    deck: ['deck', '牌组', '牌组名'],
    extra: ['extra', '补充', '备注']
  };

  function csvHeaderIndex(headers) {
    const map = { front: -1, back: -1, tags: -1, deck: -1, extra: -1 };
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const key in CSV_HEADERS) {
        if (!Object.prototype.hasOwnProperty.call(CSV_HEADERS, key)) continue;
        if (CSV_HEADERS[key].indexOf(h) >= 0 && map[key] < 0) map[key] = i;
      }
    }
    return map;
  }

  /** CSV → 分组卡片计划（不直接写状态） */
  function csvToPlan(text, defaultDeckName) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { items: [], hasHeader: false };
    const head = csvHeaderIndex(rows[0]);
    const hasHeader = head.front >= 0 || head.back >= 0;
    const start = hasHeader ? 1 : 0;
    const fi = hasHeader ? head.front : 0;
    const bi = hasHeader ? head.back : 1;
    const ti = hasHeader ? head.tags : 2;
    const di = hasHeader ? head.deck : -1;
    const ei = hasHeader ? head.extra : 3;

    const items = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const front = String(r[fi] || '').trim();
      const back = String(r[bi] || '').trim();
      if (!front && !back) continue;
      const tagsRaw = ti >= 0 ? String(r[ti] || '') : '';
      const tags = tagsRaw.split(/[,;\s]+/).filter(function (x) { return x !== ''; });
      items.push({
        front: front, back: back,
        extra: ei >= 0 ? String(r[ei] || '').trim() : '',
        tags: tags,
        deck: (di >= 0 && String(r[di] || '').trim()) || defaultDeckName || '导入牌组'
      });
    }
    return { items: items, hasHeader: hasHeader };
  }

  function csvEscape(v, d) {
    const s = String(v === undefined || v === null ? '' : v);
    if (s.indexOf('"') >= 0 || s.indexOf(d) >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function encodeCsv(decks, onlyIds) {
    const d = ',';
    const lines = [['Front', 'Back', 'Tags', 'Deck', 'Extra'].join(d)];
    const filter = onlyIds && onlyIds.length ? (function () { const m = {}; for (let i = 0; i < onlyIds.length; i++) m[onlyIds[i]] = true; return m; })() : null;
    for (let i = 0; i < decks.length; i++) {
      const deck = decks[i];
      for (let j = 0; j < deck.cards.length; j++) {
        const c = deck.cards[j];
        if (filter && !filter[c.id]) continue;
        lines.push([
          csvEscape(c.front, d), csvEscape(c.back, d),
          csvEscape(c.tags.join(' '), d), csvEscape(deck.name, d),
          csvEscape(c.extra || '', d)
        ].join(d));
      }
    }
    return '\uFEFF' + lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // 队列构建（支持模式 / 自定义筛选 / 牌组选项）
  // -------------------------------------------------------------------------
  function buildQueue(state, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const mode = o.mode || 'all';
    const deckId = o.deckId || '';
    const query = o.query || '';
    const limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : 0;
    const today = FC.dateKey(now);

    const learning = [], reviews = [], fresh = [];
    for (let i = 0; i < state.decks.length; i++) {
      const deck = state.decks[i];
      if (deckId !== '' && deck.id !== deckId) continue;
      const settings = settingsFor(deck, state.settings);
      for (let j = 0; j < deck.cards.length; j++) {
        const c = deck.cards[j];
        if (c.suspended === true) continue;
        if (c.buried === true && !(c.buriedAt && c.buriedAt < today)) continue;
        if (query && !matchQuery(query, c, deck, now)) continue;
        const due = c.state !== FC.STATE_NEW &&
          (!c.scheduling.due || Date.parse(c.scheduling.due) <= now);
        if (c.state === FC.STATE_NEW) {
          if (mode === 'all' || mode === 'new' || mode === 'cram') fresh.push({ card: c, deck: deck, settings: settings });
        } else if (c.state === FC.STATE_LEARNING || c.state === FC.STATE_RELEARNING) {
          if (mode === 'cram' || (due && (mode === 'all' || mode === 'due' || mode === 'learning'))) {
            learning.push({ card: c, deck: deck, settings: settings });
          }
        } else if (mode === 'cram' || (due && (mode === 'all' || mode === 'due' || mode === 'review'))) {
          reviews.push({ card: c, deck: deck, settings: settings });
        }
      }
    }

    learning.sort(function (a, b) {
      return Date.parse(a.card.scheduling.due || 0) - Date.parse(b.card.scheduling.due || 0);
    });
    if ((state.settings.reviewOrder || 'due') === 'random') shuffle(reviews);
    else reviews.sort(function (a, b) {
      return Date.parse(a.card.scheduling.due || 0) - Date.parse(b.card.scheduling.due || 0);
    });
    if ((state.settings.newOrder || 'mix') === 'random') shuffle(fresh);
    else if ((state.settings.newOrder || 'mix') === 'order') {
      fresh.sort(function (a, b) { return Date.parse(a.card.createdAt || 0) - Date.parse(b.card.createdAt || 0); });
    } else {
      // mix：各牌组交错，避免一次全是一个牌组
      fresh.sort(function (a, b) {
        const da = Date.parse(a.card.createdAt || 0), db = Date.parse(b.card.createdAt || 0);
        return da - db;
      });
      interleaveByDeck(fresh);
    }

    const out = [];
    for (let i = 0; i < learning.length; i++) out.push(learning[i]);

    let newRemaining = 999999, reviewRemaining = 999999;
    if (mode === 'all' && deckId) {
      const deck = findDeck(state.decks, deckId);
      if (deck) {
        const s = settingsFor(deck, state.settings);
        newRemaining = Math.max(0, s.newCardsPerDay - state.newToday);
        reviewRemaining = Math.max(0, s.reviewCardsPerDay - state.reviewToday);
      }
    } else if (mode === 'all') {
      newRemaining = Math.max(0, state.settings.newCardsPerDay - state.newToday);
      reviewRemaining = Math.max(0, state.settings.reviewCardsPerDay - state.reviewToday);
    }

    let usedNew = 0, usedReview = 0;
    for (let i = 0; i < reviews.length; i++) {
      if (usedReview >= reviewRemaining) break;
      out.push(reviews[i]); usedReview += 1;
    }
    for (let i = 0; i < fresh.length; i++) {
      if (usedNew >= newRemaining) break;
      out.push(fresh[i]); usedNew += 1;
    }

    if (limit > 0 && out.length > limit) out.length = limit;
    return out;
  }

  function interleaveByDeck(list) {
    // 按牌组名分组后轮流取，保持稳定顺序
    const groups = [];
    const index = {};
    for (let i = 0; i < list.length; i++) {
      const key = list[i].deck.id;
      if (index[key] === undefined) { index[key] = groups.length; groups.push([]); }
      groups[index[key]].push(list[i]);
    }
    list.length = 0;
    let more = true;
    let round = 0;
    while (more) {
      more = false;
      for (let i = 0; i < groups.length; i++) {
        if (groups[i][round]) { list.push(groups[i][round]); more = true; }
      }
      round += 1;
    }
  }

  function findDeck(decks, id) {
    for (let i = 0; i < decks.length; i++) if (decks[i].id === id) return decks[i];
    return null;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // -------------------------------------------------------------------------
  // 暴露
  // -------------------------------------------------------------------------
  FC.NOTETYPES = NOTETYPES;
  FC.notetypeById = notetypeById;
  FC.parseCloze = parseCloze;
  FC.clozeNumbers = clozeNumbers;
  FC.renderCloze = renderCloze;
  FC.clozePlain = clozePlain;
  FC.hasCloze = hasCloze;
  FC.buildCards = buildCards;
  FC.rebuildNote = rebuildNote;
  FC.siblingCards = siblingCards;
  FC.settingsFor = settingsFor;
  FC.Search = {
    parse: tokenize,
    match: matchQuery,
    run: runSearch
  };
  FC.matchQuery = matchQuery;
  // 今日概览：数据驱动的待办、预计用时、连续打卡与一条可执行建议。
  // 纯函数，不改动任何状态；供首页 Hero 使用，也可在 Node 中直接验证。
  function smartOverview(state, nowMs) {
    const now = nowMs || Date.now();
    const a = analytics(state, now);
    const S = state.settings || FC.defaultSettings();
    const cap = Math.max(0, Math.round(S.newCardsPerDay != null ? S.newCardsPerDay : 20));
    const newToday = state.newToday || 0;
    const reviewToday = state.reviewToday || 0;
    const newLeft = Math.max(0, Math.min(Math.max(0, cap - newToday), a.newCount));
    const due = a.due;
    const planned = newLeft + due;

    // 平均每张用时（秒）：用历史 stats 加权，缺省 12 秒，限制在 6~30 秒
    let secSum = 0, revSum = 0;
    const stats = state.stats || [];
    for (let i = 0; i < stats.length; i++) {
      const r = stats[i].reviews || 0;
      if (r > 0) { secSum += (stats[i].timeMs || 0) / 1000; revSum += r; }
    }
    const avgSec = revSum > 0 ? FC.clamp(secSum / revSum, 6, 30) : 12;
    const minutes = Math.round(planned * avgSec / 60);

    // 连续打卡：标准由 FC.checkinStreak 统一判定（每天 10 分钟 + 100 词，含补签）
    const streak = FC.checkinStreak ? FC.checkinStreak(state, now).days : 0;

    const mastered = a.review;                       // 已毕业进入复习态
    const learning = a.learning + a.relearning;      // 学习中 / 重学中
    const unlearned = a.newCount;
    const masteredPct = a.total ? Math.round(mastered / a.total * 100) : 0;
    const doneToday = newToday + reviewToday;
    // 今日进度 = 今天已学 / (今天已学 + 仍待学)；全清空时为 100%
    const goalPct = planned > 0 ? Math.min(100, Math.round(doneToday / (doneToday + planned) * 100)) : (a.total > 0 ? 100 : 0);

    let advice;
    if (a.total === 0) {
      advice = { icon: 'book', tone: 'brand', title: '暂无学习内容',
        desc: '到「词书」页导入 Anki / .SRCD / CSV，或新建牌组。', cta: '前往词书页', act: 'tab', tab: 1 };
    } else if (a.overdue >= 5) {
      advice = { icon: 'clock', tone: 'red', title: a.overdue + ' 张卡已逾期',
        desc: '建议先清理到期卡片，避免继续积压。', cta: '开始复习', act: 'study-all' };
    } else if (due > 0) {
      advice = { icon: 'rotate', tone: 'amber', title: '今天有 ' + due + ' 张卡到期',
        desc: a.relearning > 0
          ? ('其中 ' + a.relearning + ' 张处于巩固期。')
          : '预计约 ' + minutes + ' 分钟。', cta: '开始复习', act: 'study-all' };
    } else if (newLeft > 0 && doneToday === 0) {
      advice = { icon: 'cards', tone: 'brand', title: '今天有 ' + newLeft + ' 张新卡待学',
        desc: (streak >= 2 ? '已连续学习 ' + streak + ' 天。' : '') + '预计约 ' + minutes + ' 分钟。', cta: '开始学习', act: 'study-all' };
    } else if (newLeft > 0) {
      advice = { icon: 'checkCircle', tone: 'green', title: '今日计划已完成',
        desc: '另有 ' + newLeft + ' 张新卡可选学。', cta: '继续学习', act: 'study-all' };
    } else if (planned === 0) {
      advice = { icon: 'checkCircle', tone: 'green', title: '今日任务已完成',
        desc: streak > 0 ? ('已连续学习 ' + streak + ' 天。') : '可使用自定义学习加练。', cta: '自定义学习', act: 'custom-study' };
    } else {
      advice = { icon: 'zap', tone: 'brand', title: '继续今天的学习',
        desc: '还有 ' + planned + ' 张待办，约 ' + minutes + ' 分钟。', cta: '开始学习', act: 'study-all' };
    }

    return {
      total: a.total, newLeft: newLeft, due: due, planned: planned,
      minutes: minutes, avgSec: avgSec, streak: streak,
      retention: a.retention, mastered: mastered, learning: learning, unlearned: unlearned,
      masteredPct: masteredPct, doneToday: doneToday, goalPct: goalPct,
      overdue: a.overdue, advice: advice, hasData: a.total > 0
    };
  }

  FC.analytics = analytics;
  FC.smartOverview = smartOverview;
  FC.allTags = allTags;
  FC.escHtml = escHtml;
  FC.mediaMap = mediaMap;
  FC.renderRich = renderRich;
  FC.renderCardFace = renderCardFace;
  FC.renderCardHtml = renderCardHtml;
  FC.parseStructuredBack = parseStructuredBack;
  FC.isStructuredBack = isStructuredBack;
  FC.renderStructuredBack = renderStructuredBack;
  FC.Csv = {
    parse: parseCsv,
    toPlan: csvToPlan,
    encode: encodeCsv,
    headers: CSV_HEADERS
  };
  FC.buildStudyQueue = buildQueue;
  FC.INTERVAL_LABELS = INTERVAL_LABELS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


