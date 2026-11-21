/* ===== js/core.js ===== */
/**
 * 闪星卡（StarCard）核心逻辑 · 浏览器 / Node 通用
 *
 * 与鸿蒙端核心模块（Fsrs / Model / 牌组编解码 / WordBooks）.ets 行为一致：
 *   - FSRS-5（19 权重）记忆模型与调度状态机
 *   - .srcd 开放牌组格式编解码与合并（兼容旧 .fscd）
 *   - 内置词书、状态迁移
 *
 * 以 UMD 风格导出：浏览器挂到 window.FC，Node 端 module.exports（用于自测）。
 */
(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // 老内核兼容：整个应用的事件委托都依赖 Element.closest，
  // 极旧的 WebView / 国产浏览器内核缺失时会让所有按钮「点了没反应」。
  // -------------------------------------------------------------------------
  if (typeof Element !== 'undefined') {
    const EP = Element.prototype;
    if (!EP.matches) {
      EP.matches = EP.msMatchesSelector || EP.webkitMatchesSelector || function (sel) {
        const p = (this.document || this.ownerDocument).querySelectorAll(sel);
        let i = p.length;
        while (i-- && p[i] !== this) { /* noop */ }
        return i > -1;
      };
    }
    if (!EP.closest) {
      EP.closest = function (sel) {
        let node = this;
        while (node && node.nodeType === 1) {
          if (node.matches(sel)) return node;
          node = node.parentNode;
        }
        return null;
      };
    }
    if (!EP.remove) {
      EP.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
    }
  }

  // -------------------------------------------------------------------------
  // 常量
  // -------------------------------------------------------------------------
  const DAY_MS = 86400000;
  const MINUTE_MS = 60000;

  const FSRS5_WEIGHTS = [
    0.40255, 1.18385, 3.173, 15.69105,
    7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605,
    2.2698, 0.2315, 2.9898,
    0.51655, 0.6621
  ];

  const FSRS_ALGORITHM = 'FSRS-5';
  const FSRS_WEIGHT_COUNT = 19;

  const S_MIN = 0.001;
  const S_MAX = 36500;
  const D_MIN = 1;
  const D_MAX = 10;
  const DECAY = -0.5;
  const FACTOR = 19 / 81;

  const STATE_NEW = 'new';
  const STATE_LEARNING = 'learning';
  const STATE_REVIEW = 'review';
  const STATE_RELEARNING = 'relearning';

  const SRCD_FORMAT = 'srcd';
  const SRCD_VERSION = 1;
  // 旧格式标识：.fscd 文件仍可导入，导入后统一按 .srcd 处理
  const LEGACY_FORMAT = 'fscd';
  const STATE_SCHEMA = 3;

  // 标记颜色（Anki 的 Flag）：0 无，1 红 2 橙 3 绿 4 蓝 5 紫 6 青 7 粉
  const FLAG_COLORS = ['', '#E5484D', '#F76808', '#30A46C', '#3E63DD', '#8E4EC6', '#0091FF', '#D6409F'];

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------
  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function makeId() {
    return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function dateKey(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return '' + y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // -------------------------------------------------------------------------
  // 数据模型构造函数 / 复制函数
  // -------------------------------------------------------------------------
  function defaultScheduling() {
    return {
      difficulty: 5, stability: 0, due: '', lastReview: '',
      reps: 0, lapses: 0, elapsedDays: 0, scheduledDays: 0, step: 0
    };
  }

  function newCard(front, back, extra, tags) {
    return {
      id: makeId(), front: front, back: back, extra: extra || '',
      tags: (tags || []).slice(), media: [], createdAt: nowIso(),
      state: STATE_NEW, scheduling: defaultScheduling(), reviewLog: [],
      // —— Anki 级扩展（对旧数据默认可推导）——
      noteId: '', ord: 0, notetype: 'basic',
      fields: null, cloze: '',
      flags: 0, suspended: false, buried: false, buriedAt: '',
      leeched: false, modifiedAt: nowIso()
    };
  }

  // 字段结构：Front 正面 / Back 背面 / Extra 补充 / Source 来源
  function normalizeFields(front, back, extra, fields) {
    const out = { Front: '', Back: '', Extra: '', Source: '' };
    if (fields !== null && typeof fields === 'object') {
      out.Front = str(fields.Front, '');
      out.Back = str(fields.Back, '');
      out.Extra = str(fields.Extra, '');
      out.Source = str(fields.Source, '');
    }
    if (out.Front === '' && out.Back === '') {
      out.Front = str(front, '');
      out.Back = str(back, '');
      out.Extra = str(extra, '');
    }
    return out;
  }


  function emptyCard() { return newCard('', '', '', []); }

  function newDeck(name, description) {
    const t = nowIso();
    return {
      id: makeId(), name: name, description: description || '',
      createdAt: t, modifiedAt: t, tags: [], cards: [],
      options: defaultDeckOptions()
    };
  }

  function defaultSettings() {
    return {
      requestRetention: 0.9, maximumInterval: 36500, weights: FSRS5_WEIGHTS.slice(),
      newCardsPerDay: 20, reviewCardsPerDay: 200,
      learningSteps: [1, 10], relearningSteps: [10],
      // —— Anki 行为设置 ——
      graduatingInterval: 1, easyInterval: 4,
      leechThreshold: 8, leechAction: 'tag',
      buryRelated: true, newOrder: 'mix', reviewOrder: 'due',
      showTimer: true, autoRevealSeconds: 0, theme: 'dark',
      studyFont: 'm', motion: 'calm',
      // 学习提示音（翻面 / 评分）与备份提醒频率（天，0 = 关闭提醒）
      sound: true, backupRemindDays: 14,
      accent: 'brand', bg: 'default', preset: 'default'
    };
  }

  function defaultParameters() {
    const s = defaultSettings();
    return {
      algorithm: FSRS_ALGORITHM, algorithmVersion: '5',
      requestRetention: s.requestRetention, maximumInterval: s.maximumInterval,
      weights: s.weights.slice(),
      newCardsPerDay: s.newCardsPerDay, reviewCardsPerDay: s.reviewCardsPerDay,
      learningSteps: s.learningSteps.slice(), relearningSteps: s.relearningSteps.slice(),
      graduatingInterval: s.graduatingInterval, easyInterval: s.easyInterval,
      leechThreshold: s.leechThreshold, leechAction: s.leechAction,
      buryRelated: s.buryRelated, newOrder: s.newOrder, reviewOrder: s.reviewOrder
    };
  }

  function defaultState() {
    return {
      schema: STATE_SCHEMA, settings: defaultSettings(), decks: [], stats: [],
      lastNewDate: '', newToday: 0, lastReviewDate: '', reviewToday: 0,
      wordBooks: [], wordProgress: [], classrooms: [], deskmates: [], battleRecords: [],
      savedSearches: [], removedSeries: [],
      // 动态系列：导入词库时自动生成一个系列（文件夹）收纳本批牌组；collapsedSeries 记住折叠状态
      series: [], collapsedSeries: []
    };
  }

  function copyScheduling(s) {
    return {
      difficulty: s.difficulty, stability: s.stability, due: s.due, lastReview: s.lastReview,
      reps: s.reps, lapses: s.lapses, elapsedDays: s.elapsedDays,
      scheduledDays: s.scheduledDays, step: s.step
    };
  }
  function copyCard(c) {
    const tags = c.tags.slice();
    const media = [];
    for (let i = 0; i < c.media.length; i++) {
      media.push({ name: c.media[i].name, mime: c.media[i].mime, data: c.media[i].data });
    }
    const log = [];
    for (let i = 0; i < c.reviewLog.length; i++) {
      const e = c.reviewLog[i];
      log.push({ rating: e.rating, reviewedAt: e.reviewedAt, elapsedDays: e.elapsedDays, scheduledDays: e.scheduledDays, state: e.state });
    }
    return {
      id: c.id, front: c.front, back: c.back, extra: c.extra, tags: tags, media: media,
      createdAt: c.createdAt, state: c.state, scheduling: copyScheduling(c.scheduling), reviewLog: log,
      noteId: c.noteId || c.id, ord: c.ord || 0, notetype: c.notetype || 'basic',
      fields: c.fields ? {
        Front: c.fields.Front || '', Back: c.fields.Back || '',
        Extra: c.fields.Extra || '', Source: c.fields.Source || ''
      } : null,
      cloze: c.cloze || '', flags: c.flags || 0,
      suspended: !!c.suspended, buried: !!c.buried, buriedAt: c.buriedAt || '',
      leeched: !!c.leeched, modifiedAt: c.modifiedAt || c.createdAt
    };
  }
  function copyDeck(d) {
    const cards = [];
    for (let i = 0; i < d.cards.length; i++) cards.push(copyCard(d.cards[i]));
    return {
      id: d.id, name: d.name, description: d.description,
      createdAt: d.createdAt, modifiedAt: d.modifiedAt, tags: d.tags.slice(), cards: cards,
      options: d.options ? copyDeckOptions(d.options) : null
    };
  }
  function copyDeckOptions(o) {
    return {
      newPerDay: o.newPerDay, reviewsPerDay: o.reviewsPerDay,
      learningSteps: o.learningSteps ? o.learningSteps.slice() : null,
      relearningSteps: o.relearningSteps ? o.relearningSteps.slice() : null,
      graduatingInterval: o.graduatingInterval, easyInterval: o.easyInterval,
      leechThreshold: o.leechThreshold, leechAction: o.leechAction,
      buryRelated: o.buryRelated, maxInterval: o.maxInterval,
      requestRetention: o.requestRetention, newOrder: o.newOrder, reviewOrder: o.reviewOrder
    };
  }
  function defaultDeckOptions() {
    return {
      newPerDay: null, reviewsPerDay: null, learningSteps: null, relearningSteps: null,
      graduatingInterval: null, easyInterval: null, leechThreshold: null, leechAction: '',
      buryRelated: null, maxInterval: null, requestRetention: null,
      newOrder: '', reviewOrder: ''
    };
  }
  function copySettings(s) {
    return {
      requestRetention: s.requestRetention, maximumInterval: s.maximumInterval, weights: s.weights.slice(),
      newCardsPerDay: s.newCardsPerDay, reviewCardsPerDay: s.reviewCardsPerDay,
      learningSteps: s.learningSteps.slice(), relearningSteps: s.relearningSteps.slice(),
      graduatingInterval: s.graduatingInterval, easyInterval: s.easyInterval,
      leechThreshold: s.leechThreshold, leechAction: s.leechAction,
      buryRelated: s.buryRelated, newOrder: s.newOrder, reviewOrder: s.reviewOrder,
      showTimer: s.showTimer, autoRevealSeconds: s.autoRevealSeconds, theme: s.theme,
      studyFont: s.studyFont || 'm', motion: (s.motion !== 'off' && s.motion !== false)
    };
  }

  // 词书 / 社交 / 比赛
  function newWordEntry(word, phonetic, meaning, example, exampleCn) {
    return { word: word, phonetic: phonetic, meaning: meaning, example: example, exampleCn: exampleCn };
  }
  function newWordBook(name, description, category, builtIn, words) {
    return { id: makeId(), name: name, description: description, category: category, builtIn: builtIn, words: words };
  }
  function emptyProgress(bookId, size) {
    const statuses = [];
    for (let i = 0; i < size; i++) statuses.push(0);
    return { bookId: bookId, statuses: statuses, cursor: 0, updatedAt: nowIso() };
  }
  function emptyBattle() {
    return {
      phase: 0, bookId: '', bookName: '', words: [], players: [], hands: [], scores: [],
      turn: 0, maxTurns: 10, current: 0, owner: 0, cardIdx: 0,
      options: [], correct: 0, picked: -1, lastGain: ''
    };
  }
  function progressCounts(p, size) {
    const c = [0, 0, 0];
    for (let i = 0; i < size; i++) {
      const v = p.statuses[i];
      if (v === 0) c[2] += 1;          // 未学
      else if (v === 1) c[1] += 1;     // 模糊
      else c[0] += 1;                   // 已掌握
    }
    return c;
  }

  // -------------------------------------------------------------------------
  // FSRS-5 记忆模型
  // -------------------------------------------------------------------------
  function Fsrs(settings) {
    this.w = (settings.weights && settings.weights.length === FSRS_WEIGHT_COUNT)
      ? settings.weights.slice() : FSRS5_WEIGHTS.slice();
    this.retention = clamp(settings.requestRetention, 0.70, 0.99);
    this.maxInterval = clamp(Math.round(settings.maximumInterval), 1, S_MAX);
  }
  Fsrs.prototype.clampS = function (v) { return clamp(v, S_MIN, S_MAX); };
  Fsrs.prototype.clampD = function (v) { return clamp(v, D_MIN, D_MAX); };
  Fsrs.prototype.retrievability = function (elapsedDays, s) {
    const ss = this.clampS(s);
    const t = Math.max(0, elapsedDays);
    const r = Math.pow(1 + (FACTOR * t) / ss, DECAY);
    return clamp(r, 0.000001, 1);
  };
  Fsrs.prototype.interval = function (s) {
    const ss = this.clampS(s);
    const raw = (ss / FACTOR) * (Math.pow(this.retention, 1 / DECAY) - 1);
    return clamp(Math.round(raw), 1, this.maxInterval);
  };
  Fsrs.prototype.initialStability = function (rating) { return this.clampS(this.w[rating - 1]); };
  Fsrs.prototype.initialDifficulty = function (rating) {
    return this.clampD(this.w[4] - Math.exp(this.w[5] * (rating - 1)) + 1);
  };
  Fsrs.prototype.nextDifficulty = function (d, rating) {
    const delta = -this.w[6] * (rating - 3);
    const dPrime = d + (delta * (10 - d)) / 9;
    const target = this.initialDifficulty(4);
    return this.clampD(this.w[7] * target + (1 - this.w[7]) * dPrime);
  };
  Fsrs.prototype.stabilityAfterSuccess = function (s, d, r, rating) {
    const ss = this.clampS(s);
    let inc = Math.exp(this.w[8]) * (11 - d) * Math.pow(ss, -this.w[9]) * (Math.exp(this.w[10] * (1 - r)) - 1);
    if (rating === 2) inc = inc * this.w[15];
    if (rating === 4) inc = inc * this.w[16];
    if (inc < 0) inc = 0;
    return this.clampS(ss * (1 + inc));
  };
  Fsrs.prototype.stabilityAfterFailure = function (s, d, r) {
    const ss = this.clampS(s);
    const f = this.w[11] * Math.pow(d, -this.w[12]) * (Math.pow(ss + 1, this.w[13]) - 1) * Math.exp(this.w[14] * (1 - r));
    const cap = ss / Math.exp(this.w[17] * this.w[18]);
    return clamp(Math.min(f, cap), S_MIN, S_MAX);
  };
  Fsrs.prototype.shortTermStability = function (s, rating) {
    const ss = this.clampS(s);
    const g = rating < 2 ? 3 : rating;
    let out = ss * Math.exp(this.w[17] * (g - 3 + this.w[18]));
    if (rating >= 2 && out < ss) out = ss;
    return this.clampS(out);
  };

  // -------------------------------------------------------------------------
  // 调度层
  // -------------------------------------------------------------------------
  function Scheduler(settings) {
    this.settings = settings;
    this.fsrs = new Fsrs(settings);
  }
  Scheduler.prototype.stepMinutes = function (steps, index) {
    if (steps.length === 0) return 10;
    const i = clamp(Math.floor(index), 0, steps.length - 1);
    return Math.max(1, Math.round(steps[i]));
  };
  // Anki 风格学习步骤间隔（分钟）：
  //   重来(1) = 回到第一步 steps[0]
  //   困难(2) = 当前步与下一步的中点（最后一步则维持当前步）
  //   良好(3) = 下一步 steps[index+1]
  // 与 Anki 的 _graded_steps 一致，默认 steps=[1,10] 时：重来1分 / 困难5分 / 良好10分。
  Scheduler.prototype._stepInterval = function (steps, index, rating) {
    if (!steps || steps.length === 0) return 10;
    const n = steps.length;
    const i = Math.max(0, Math.min(Math.floor(index), n - 1));
    if (rating === 1) return Math.max(1, Math.floor(steps[0]));
    if (rating === 2) {
      const mid = (i + 1 < n) ? (steps[i] + steps[i + 1]) / 2 : steps[i];
      return Math.max(1, Math.floor(mid));
    }
    const j = Math.min(i + 1, n - 1);
    return Math.max(1, Math.floor(steps[j]));
  };
  Scheduler.prototype.dueTimestamp = function (c) {
    if (c.scheduling.due === '') return 0;
    const t = Date.parse(c.scheduling.due);
    return isNaN(t) ? 0 : t;
  };
  Scheduler.prototype.simulate = function (card, rating, nowMs) {
    const src = card.scheduling;
    const next = copyScheduling(src);
    const state = card.state;
    const elapsedDays = src.lastReview === ''
      ? 0 : Math.max(0, (nowMs - Date.parse(src.lastReview)) / DAY_MS);
    const r = this.fsrs.retrievability(elapsedDays, src.stability);

    let dueMs = nowMs + DAY_MS;
    let scheduledDays = 1;
    let newState = state;
    let newStep = src.step;
    let newD = src.difficulty;
    let newS = src.stability;
    let lapses = src.lapses;

    if (state === STATE_NEW) {
      newD = this.fsrs.initialDifficulty(rating);
      newS = this.fsrs.initialStability(rating);
      const steps = this.settings.learningSteps;
      newS = this.fsrs.shortTermStability(newS, rating);
      if (rating === 4) {
        // 简单：直接毕业，用 easyInterval（Anki 行为）
        newState = STATE_REVIEW; newStep = 0;
        const iv = Math.max(this.fsrs.interval(newS), this.settings.easyInterval || 4);
        dueMs = nowMs + iv * DAY_MS; scheduledDays = iv;
      } else if (rating === 1) {
        // 重来：回到第一步（默认 1 分钟后重新出现）
        newState = STATE_LEARNING; newStep = 0;
        const minutes = this._stepInterval(steps, 0, 1);
        dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
      } else if (rating === 2) {
        // 困难：落在第一步与第二步之间（默认约 5 分钟）
        newState = STATE_LEARNING; newStep = 0;
        const minutes = this._stepInterval(steps, 0, 2);
        dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
      } else {
        // 良好：跳到下一步；只有一步时直接毕业
        if (steps.length > 1) {
          newState = STATE_LEARNING; newStep = 1;
          const minutes = this._stepInterval(steps, 0, 3);
          dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
        } else {
          newState = STATE_REVIEW; newStep = 0;
          const iv = Math.max(this.fsrs.interval(newS), this.settings.graduatingInterval || 1);
          dueMs = nowMs + iv * DAY_MS; scheduledDays = iv;
        }
      }
    } else if (state === STATE_LEARNING || state === STATE_RELEARNING) {
      newD = this.fsrs.nextDifficulty(src.difficulty, rating);
      newS = this.fsrs.shortTermStability(src.stability, rating);
      const steps = state === STATE_LEARNING ? this.settings.learningSteps : this.settings.relearningSteps;
      const cur = Math.max(0, Math.min(src.step, Math.max(0, steps.length - 1)));
      if (rating === 4) {
        // 简单：直接毕业（Anki 用 easyInterval，不是 graduatingInterval）
        newState = STATE_REVIEW; newStep = 0;
        const iv = Math.max(this.fsrs.interval(newS), this.settings.easyInterval || 4);
        dueMs = nowMs + iv * DAY_MS; scheduledDays = iv;
      } else if (rating === 3) {
        // 良好：进入下一步；已是最后一步则毕业
        if (cur + 1 < steps.length) {
          newState = state; newStep = cur + 1;
          const minutes = this._stepInterval(steps, cur, 3);
          dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
        } else {
          newState = STATE_REVIEW; newStep = 0;
          const iv = Math.max(this.fsrs.interval(newS), this.settings.graduatingInterval || 1);
          dueMs = nowMs + iv * DAY_MS; scheduledDays = iv;
        }
      } else if (rating === 2) {
        // 困难：留在当前步，取与下一步的中间值
        newState = state; newStep = cur;
        const minutes = this._stepInterval(steps, cur, 2);
        dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
      } else {
        // 重来：回到第一步，几分钟后重新出现
        newState = state; newStep = 0;
        const minutes = this._stepInterval(steps, 0, 1);
        dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
      }
    } else {
      newD = this.fsrs.nextDifficulty(src.difficulty, rating);
      if (rating === 1) {
        newS = this.fsrs.stabilityAfterFailure(src.stability, newD, r);
        newState = STATE_RELEARNING; newStep = 0; lapses = src.lapses + 1;
        const minutes = this._stepInterval(this.settings.relearningSteps, 0, 1);
        dueMs = nowMs + minutes * MINUTE_MS; scheduledDays = minutes / 1440;
      } else {
        newS = this.fsrs.stabilityAfterSuccess(src.stability, newD, r, rating);
        newState = STATE_REVIEW; newStep = 0;
        const iv = this.fsrs.interval(newS);
        dueMs = nowMs + iv * DAY_MS; scheduledDays = iv;
      }
    }
    next.difficulty = newD; next.stability = newS;
    next.due = new Date(dueMs).toISOString();
    next.lastReview = new Date(nowMs).toISOString();
    next.reps = src.reps + 1; next.lapses = lapses;
    next.elapsedDays = elapsedDays; next.scheduledDays = scheduledDays; next.step = newStep;
    return { scheduling: next, state: newState };
  };
  Scheduler.prototype.grade = function (card, rating, nowMs) {
    const out = this.simulate(card, rating, nowMs);
    const entry = {
      rating: rating, reviewedAt: new Date(nowMs).toISOString(),
      elapsedDays: out.scheduling.elapsedDays, scheduledDays: out.scheduling.scheduledDays, state: out.state
    };
    const updated = copyCard(card);
    updated.state = out.state;
    updated.scheduling = out.scheduling;
    updated.reviewLog.push(entry);
    // Leech：遗忘达到阈值后标记，或按设置自动暂停
    const threshold = this.settings.leechThreshold || 8;
    if (updated.scheduling.lapses >= threshold) {
      updated.leeched = true;
      if ((this.settings.leechAction || 'tag') === 'suspend') updated.suspended = true;
    }
    return updated;
  };
  Scheduler.prototype.formatInterval = function (dueIso, nowMs) {
    const diff = Date.parse(dueIso) - nowMs;
    const minutes = Math.round(diff / MINUTE_MS);
    if (minutes < 60) return Math.max(1, minutes) + '分钟';
    const hours = Math.round(diff / 3600000);
    if (hours < 24) return hours + '小时';
    const days = Math.round(diff / DAY_MS);
    if (days < 30) return days + '天';
    if (days < 365) return Math.round(days / 30) + '个月';
    return (days / 365).toFixed(1) + '年';
  };
  Scheduler.prototype.preview = function (card, nowMs) {
    const labels = [];
    for (let rating = 1; rating <= 4; rating++) {
      const out = this.simulate(card, rating, nowMs);
      labels.push(this.formatInterval(out.scheduling.due, nowMs));
    }
    return labels;
  };
  Scheduler.prototype.isDue = function (card, nowMs) {
    if (card.state === STATE_NEW) return false;
    if (card.scheduling.due === '') return true;
    return this.dueTimestamp(card) <= nowMs;
  };
  Scheduler.prototype.deckCounts = function (deck, nowMs) {
    let fresh = 0, due = 0;
    const today = dateKey(nowMs);
    for (let i = 0; i < deck.cards.length; i++) {
      const c = deck.cards[i];
      if (c.suspended === true) continue;
      if (c.buried === true && !(c.buriedAt && c.buriedAt < today)) continue;
      if (c.state === STATE_NEW) fresh += 1;
      else if (this.isDue(c, nowMs)) due += 1;
    }
    return [fresh, due, deck.cards.length];
  };
  Scheduler.prototype.sortByDue = function (list) {
    const self = this;
    list.sort(function (a, b) {
      return self.dueTimestamp(a) - self.dueTimestamp(b);
    });
  };
  Scheduler.prototype.buildQueue = function (decks, nowMs, deckId, newRemaining, reviewRemaining) {
    const learning = [], reviews = [], fresh = [];
    const today = dateKey(nowMs);
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      if (deckId !== '' && d.id !== deckId) continue;
      for (let j = 0; j < d.cards.length; j++) {
        const c = d.cards[j];
        if (c.suspended === true) continue;
        if (c.buried === true && !(c.buriedAt && c.buriedAt < today)) continue;
        if (c.state === STATE_NEW) fresh.push(c);
        else if (c.state === STATE_LEARNING || c.state === STATE_RELEARNING) {
          if (this.isDue(c, nowMs)) learning.push(c);
        } else if (this.isDue(c, nowMs)) reviews.push(c);
      }
    }
    this.sortByDue(learning);
    this.sortByDue(reviews);
    const queue = [];
    for (let i = 0; i < learning.length; i++) queue.push(learning[i].id);
    let usedReviews = 0;
    for (let i = 0; i < reviews.length; i++) {
      if (usedReviews >= reviewRemaining) break;
      queue.push(reviews[i].id); usedReviews += 1;
    }
    let usedNew = 0;
    for (let i = 0; i < fresh.length; i++) {
      if (usedNew >= newRemaining) break;
      queue.push(fresh[i].id); usedNew += 1;
    }
    return queue;
  };
  Scheduler.prototype.forecast = function (decks, nowMs, days) {
    const out = [];
    for (let i = 0; i < days; i++) out.push(0);
    const end = nowMs + days * DAY_MS;
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      for (let j = 0; j < d.cards.length; j++) {
        const c = d.cards[j];
        if (c.state === STATE_NEW || c.scheduling.due === '') continue;
        const t = this.dueTimestamp(c);
        if (t <= nowMs) { out[0] += 1; continue; }
        if (t >= end) continue;
        const idx = Math.floor((t - nowMs) / DAY_MS);
        if (idx >= 0 && idx < days) out[idx] += 1;
      }
    }
    return out;
  };
  Scheduler.prototype.retentionFromLogs = function (decks) {
    let total = 0, passed = 0;
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      for (let j = 0; j < d.cards.length; j++) {
        const log = d.cards[j].reviewLog;
        for (let k = 0; k < log.length; k++) {
          total += 1;
          if (log[k].rating >= 2) passed += 1;
        }
      }
    }
    return total === 0 ? 0 : passed / total;
  };

  // -------------------------------------------------------------------------
  // .srcd 编解码（兼容旧 .fscd）
  // -------------------------------------------------------------------------
  function str(v, fallback) { return typeof v === 'string' ? v : fallback; }
  function num(v, fallback) {
    return (typeof v === 'number' && !isNaN(v) && isFinite(v)) ? v : fallback;
  }
  function nonNegInt(v, fallback) { return Math.max(0, Math.round(num(v, fallback))); }
  function strArray(v) {
    const out = [];
    if (v !== undefined && v !== null && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (typeof v[i] === 'string') out.push(v[i]);
    }
    return out;
  }
  function numArray(v, fallback) {
    const out = [];
    if (v !== undefined && v !== null && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) out.push(num(v[i], 0));
    }
    return out.length > 0 ? out : fallback.slice();
  }
  function contains(list, value) { return list.indexOf(value) >= 0; }
  function validState(v) {
    const s = str(v, STATE_NEW);
    if (s === STATE_NEW || s === STATE_LEARNING || s === STATE_REVIEW || s === STATE_RELEARNING) return s;
    return STATE_NEW;
  }
  function normalizeMedia(v) {
    const out = [];
    if (v !== undefined && v !== null && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const m = v[i];
        if (m === undefined || m === null) continue;
        out.push({ name: str(m.name, 'media-' + i), mime: str(m.mime, 'application/octet-stream'), data: str(m.data, '') });
      }
    }
    return out;
  }
  function normalizeReviewLog(v) {
    const out = [];
    if (v !== undefined && v !== null && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e = v[i];
        if (e === undefined || e === null) continue;
        out.push({
          rating: clamp(Math.round(num(e.rating, 3)), 1, 4),
          reviewedAt: str(e.reviewedAt, nowIso()),
          elapsedDays: Math.max(0, num(e.elapsedDays, 0)),
          scheduledDays: Math.max(0, num(e.scheduledDays, 0)),
          state: validState(e.state)
        });
      }
    }
    return out;
  }
  function normalizeScheduling(v) {
    let s = {};
    if (v !== undefined && v !== null) s = v;
    return {
      difficulty: clamp(num(s.difficulty, 5), D_MIN, D_MAX),
      stability: clamp(num(s.stability, S_MIN), S_MIN, S_MAX),
      due: str(s.due, ''), lastReview: str(s.lastReview, ''),
      reps: nonNegInt(s.reps, 0), lapses: nonNegInt(s.lapses, 0),
      elapsedDays: Math.max(0, num(s.elapsedDays, 0)),
      scheduledDays: Math.max(0, num(s.scheduledDays, 0)),
      step: nonNegInt(s.step, 0)
    };
  }
  function normalizeCard(v) {
    let c = {};
    if (v !== undefined && v !== null) c = v;
    const card = emptyCard();
    card.id = str(c.id, card.id);
    card.front = str(c.front, '');
    card.back = str(c.back, '');
    card.extra = str(c.extra, '');
    card.tags = strArray(c.tags);
    card.media = normalizeMedia(c.media);
    card.createdAt = str(c.createdAt, nowIso());
    card.state = validState(c.state);
    card.scheduling = normalizeScheduling(c.scheduling);
    card.reviewLog = normalizeReviewLog(c.reviewLog);
    card.fields = normalizeFields(card.front, card.back, card.extra, c.fields);
    card.noteId = str(c.noteId, card.id);
    card.ord = nonNegInt(c.ord, 0);
    card.notetype = str(c.notetype, 'basic');
    card.cloze = str(c.cloze, '');
    card.flags = clamp(Math.round(num(c.flags, 0)), 0, 7);
    card.suspended = c.suspended === true;
    card.buried = c.buried === true;
    card.buriedAt = str(c.buriedAt, '');
    card.leeched = c.leeched === true;
    card.modifiedAt = str(c.modifiedAt, card.createdAt);
    return card;
  }
  function normalizeDeckOptions(v) {
    const out = defaultDeckOptions();
    if (v === undefined || v === null || typeof v !== 'object') return out;
    const nullableInt = function (x) {
      return (typeof x === 'number' && !isNaN(x) && isFinite(x)) ? Math.max(0, Math.round(x)) : null;
    };
    out.newPerDay = nullableInt(v.newPerDay);
    out.reviewsPerDay = nullableInt(v.reviewsPerDay);
    if (v.learningSteps !== undefined && v.learningSteps !== null && Array.isArray(v.learningSteps) && v.learningSteps.length) {
      out.learningSteps = numArray(v.learningSteps, [1, 10]);
    }
    if (v.relearningSteps !== undefined && v.relearningSteps !== null && Array.isArray(v.relearningSteps) && v.relearningSteps.length) {
      out.relearningSteps = numArray(v.relearningSteps, [10]);
    }
    out.graduatingInterval = nullableInt(v.graduatingInterval);
    out.easyInterval = nullableInt(v.easyInterval);
    out.leechThreshold = nullableInt(v.leechThreshold);
    out.leechAction = str(v.leechAction, '');
    out.buryRelated = (typeof v.buryRelated === 'boolean') ? v.buryRelated : null;
    out.maxInterval = nullableInt(v.maxInterval);
    out.requestRetention = (typeof v.requestRetention === 'number' && isFinite(v.requestRetention))
      ? clamp(v.requestRetention, 0.7, 0.99) : null;
    out.newOrder = str(v.newOrder, '');
    out.reviewOrder = str(v.reviewOrder, '');
    return out;
  }
  function normalizeDeck(v) {
    let d = {};
    if (v !== undefined && v !== null) d = v;
    const t = nowIso();
    const cards = [];
    if (d.cards !== undefined && d.cards !== null && Array.isArray(d.cards)) {
      for (let i = 0; i < d.cards.length; i++) cards.push(normalizeCard(d.cards[i]));
    }
    return {
      id: str(d.id, makeId()), name: str(d.name, '未命名牌组'), description: str(d.description, ''),
      createdAt: str(d.createdAt, t), modifiedAt: str(d.modifiedAt, t),
      tags: strArray(d.tags), cards: cards,
      options: normalizeDeckOptions(d.options)
    };
  }
  function normalizeParameters(p) {
    const def = defaultParameters();
    let q = {};
    if (p !== undefined && p !== null) q = p;
    let weights = numArray(q.weights, FSRS5_WEIGHTS);
    if (weights.length < FSRS_WEIGHT_COUNT) {
      for (let i = weights.length; i < FSRS_WEIGHT_COUNT; i++) weights.push(FSRS5_WEIGHTS[i]);
    } else if (weights.length > FSRS_WEIGHT_COUNT) {
      weights = weights.slice(0, FSRS_WEIGHT_COUNT);
    }
    return {
      algorithm: str(q.algorithm, FSRS_ALGORITHM),
      algorithmVersion: str(q.algorithmVersion, '5'),
      requestRetention: clamp(num(q.requestRetention, def.requestRetention), 0.7, 0.99),
      maximumInterval: clamp(Math.round(num(q.maximumInterval, def.maximumInterval)), 1, S_MAX),
      weights: weights,
      newCardsPerDay: nonNegInt(q.newCardsPerDay, def.newCardsPerDay),
      reviewCardsPerDay: nonNegInt(q.reviewCardsPerDay, def.reviewCardsPerDay),
      learningSteps: numArray(q.learningSteps, def.learningSteps),
      relearningSteps: numArray(q.relearningSteps, def.relearningSteps),
      graduatingInterval: clamp(Math.round(num(q.graduatingInterval, def.graduatingInterval)), 1, 365),
      easyInterval: clamp(Math.round(num(q.easyInterval, def.easyInterval)), 1, 3650),
      leechThreshold: clamp(Math.round(num(q.leechThreshold, def.leechThreshold)), 1, 100),
      leechAction: str(q.leechAction, def.leechAction) === 'suspend' ? 'suspend' : 'tag',
      buryRelated: q.buryRelated !== false,
      newOrder: (str(q.newOrder, '') === 'random') ? 'random' : (str(q.newOrder, '') === 'order' ? 'order' : 'mix'),
      reviewOrder: (str(q.reviewOrder, '') === 'random') ? 'random' : 'due',
      showTimer: q.showTimer !== false,
      autoRevealSeconds: clamp(Math.round(num(q.autoRevealSeconds, 0)), 0, 60),
      theme: (str(q.theme, '') === 'dark') ? 'dark' : (str(q.theme, '') === 'auto' ? 'auto' : 'light')
    };
  }

  const SrcdCodec = {
    encode: function (decks, settings, generator) {
      const params = {
        algorithm: FSRS_ALGORITHM, algorithmVersion: '5',
        requestRetention: settings.requestRetention, maximumInterval: settings.maximumInterval,
        weights: settings.weights.slice(),
        newCardsPerDay: settings.newCardsPerDay, reviewCardsPerDay: settings.reviewCardsPerDay,
        learningSteps: settings.learningSteps.slice(), relearningSteps: settings.relearningSteps.slice(),
        graduatingInterval: settings.graduatingInterval, easyInterval: settings.easyInterval,
        leechThreshold: settings.leechThreshold, leechAction: settings.leechAction,
        buryRelated: settings.buryRelated, newOrder: settings.newOrder, reviewOrder: settings.reviewOrder
      };
      const out = {
        format: SRCD_FORMAT, version: SRCD_VERSION,
        generator: generator, exportedAt: nowIso(),
        parameters: params, decks: decks
      };
      return JSON.stringify(out);
    },
    decode: function (text) {
      let raw = {};
      try { raw = JSON.parse(text); }
      catch (err) { throw new Error('文件不是合法的 JSON：' + String(err)); }
      if (raw === null || raw === undefined) throw new Error('文件内容为空');
      if (raw.format !== SRCD_FORMAT && raw.format !== LEGACY_FORMAT) {
        throw new Error('format 不是 "srcd"/"fscd"，实际为 ' + String(raw.format));
      }
      if (raw.version !== SRCD_VERSION) throw new Error('不支持的 .srcd 版本 ' + String(raw.version) + '（当前仅支持 v1）');
      if (raw.decks === undefined || raw.decks === null || !Array.isArray(raw.decks)) throw new Error('缺少 decks 数组');
      const rawDecks = raw.decks;
      const decks = [];
      for (let i = 0; i < rawDecks.length; i++) decks.push(normalizeDeck(rawDecks[i]));
      return {
        format: SRCD_FORMAT, version: SRCD_VERSION,
        generator: str(raw.generator, 'unknown'),
        exportedAt: str(raw.exportedAt, nowIso()),
        parameters: normalizeParameters(raw.parameters),
        decks: decks
      };
    },
    merge: function (state, srcd, adoptParameters) {
      const merged = copyState(state);
      const existingDeckIds = [];
      const existingCardIds = [];
      for (let i = 0; i < merged.decks.length; i++) {
        existingDeckIds.push(merged.decks[i].id);
        for (let j = 0; j < merged.decks[i].cards.length; j++) existingCardIds.push(merged.decks[i].cards[j].id);
      }
      // 按牌组名建索引：重新导入同一词库时「同名更新」而非堆叠重复牌组。
      // 这样用户拿到更新版（如 SAT800 新增 5 组）后重新导入，旧牌组会被就地升级、
      // 学习进度按卡片正面文本匹配迁移，不会变成两份。
      const nameToDeck = {};
      for (let i = 0; i < merged.decks.length; i++) nameToDeck[merged.decks[i].name] = merged.decks[i];

      const imported = [];
      let cards = 0, media = 0, updated = 0, added = 0;
      for (let i = 0; i < srcd.decks.length; i++) {
        const src = srcd.decks[i];
        const target = nameToDeck[src.name];
        const deckId = target ? target.id
          : (src.id && !contains(existingDeckIds, src.id) ? src.id : makeId());
        if (!contains(existingDeckIds, deckId)) existingDeckIds.push(deckId);

        // 旧卡按正面文本索引，用于保留已学进度
        const oldByFront = {};
        if (target) for (let k = 0; k < target.cards.length; k++) {
          const f = String(target.cards[k].front || '').trim();
          if (f) oldByFront[f] = target.cards[k];
        }
        const newCards = [];
        const noteMap = {};
        for (let j = 0; j < src.cards.length; j++) {
          const c = src.cards[j];
          const f = String(c.front || '').trim();
          const old = oldByFront[f];
          let cardId;
          if (old) cardId = old.id; // 同名同词：复用卡片 ID 与进度
          else {
            cardId = c.id;
            if (!cardId || contains(existingCardIds, cardId)) cardId = makeId();
          }
          existingCardIds.push(cardId);
          const copy = copyCard(c);
          copy.id = cardId;
          if (old) {
            copy.scheduling = JSON.parse(JSON.stringify(old.scheduling || {}));
            copy.state = old.state;
            copy.flags = old.flags;
            copy.suspended = old.suspended;
            copy.buried = old.buried;
            copy.leeched = old.leeched;
            copy.reviewLog = (old.reviewLog || []).map(function (r) { return JSON.parse(JSON.stringify(r)); });
            copy.createdAt = old.createdAt;
          }
          // 同一笔记的多张卡保持同组，避免导入后失去模板关联
          const srcNote = c.noteId || c.id;
          if (!noteMap[srcNote]) noteMap[srcNote] = (old && old.noteId) || makeId();
          copy.noteId = noteMap[srcNote];
          newCards.push(copy);
          cards += 1;
          media += copy.media.length;
        }
        const deckObj = {
          id: deckId, name: src.name, description: src.description,
          createdAt: (target && target.createdAt) || src.createdAt, modifiedAt: src.modifiedAt,
          tags: src.tags.slice(), cards: newCards,
          options: src.options ? copyDeckOptions(src.options)
            : (target && target.options ? copyDeckOptions(target.options) : defaultDeckOptions())
        };
        if (target) {
          merged.decks[merged.decks.indexOf(target)] = deckObj;
          nameToDeck[src.name] = deckObj;
          updated += 1;
        } else {
          merged.decks.push(deckObj);
          nameToDeck[src.name] = deckObj;
          added += 1;
        }
        imported.push(deckObj);
      }
      if (adoptParameters) {
        const p = srcd.parameters;
        merged.settings.requestRetention = p.requestRetention;
        merged.settings.maximumInterval = p.maximumInterval;
        merged.settings.weights = p.weights.slice();
        merged.settings.newCardsPerDay = p.newCardsPerDay;
        merged.settings.reviewCardsPerDay = p.reviewCardsPerDay;
        merged.settings.learningSteps = p.learningSteps.slice();
        merged.settings.relearningSteps = p.relearningSteps.slice();
      }
      return { state: merged, summary: { decks: imported.length, cards: cards, media: media, updated: updated, added: added } };
    },
    parseBatchText: function (text) {
      const out = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/\r$/, '').trim();
        if (line === '' || line.charAt(0) === '#') continue;
        let pos = line.indexOf('\t');
        if (pos < 0) {
          pos = line.indexOf('::');
          if (pos >= 0) { out.push(emptyCardWith(line.substring(0, pos).trim(), line.substring(pos + 2).trim())); continue; }
        }
        if (pos < 0) pos = line.indexOf('|');
        if (pos < 0) { out.push(emptyCardWith(line, '')); continue; }
        out.push(emptyCardWith(line.substring(0, pos).trim(), line.substring(pos + 1).trim()));
      }
      return out;
    }
  };
  function emptyCardWith(front, back) { const c = emptyCard(); c.front = front; c.back = back; return c; }

  // -------------------------------------------------------------------------
  // 状态复制 / 迁移（对应 StateStore.load）
  // -------------------------------------------------------------------------
  function copyState(s) {
    const decks = [];
    for (let i = 0; i < s.decks.length; i++) decks.push(copyDeck(s.decks[i]));
    return {
      schema: s.schema, settings: copySettings(s.settings), decks: decks, stats: copyStats(s.stats || []),
      lastNewDate: s.lastNewDate, newToday: s.newToday, lastReviewDate: s.lastReviewDate, reviewToday: s.reviewToday,
      wordBooks: s.wordBooks.slice(), wordProgress: s.wordProgress.slice(),
      classrooms: s.classrooms.slice(), deskmates: s.deskmates.slice(), battleRecords: s.battleRecords.slice(),
      savedSearches: (s.savedSearches || []).slice(), removedSeries: (s.removedSeries || []).slice(),
      series: JSON.parse(JSON.stringify(s.series || [])), collapsedSeries: (s.collapsedSeries || []).slice()
    };
  }
  function copyStats(stats) {
    const out = [];
    for (let i = 0; i < stats.length; i++) {
      out.push({
        date: stats[i].date, reviews: stats[i].reviews, passed: stats[i].passed,
        timeMs: stats[i].timeMs || 0, newCount: stats[i].newCount || 0, reviewCount: stats[i].reviewCount || 0
      });
    }
    return out;
  }
  function copyWordProgress(p) {
    return { bookId: p.bookId, statuses: p.statuses.slice(), cursor: p.cursor, updatedAt: p.updatedAt };
  }
  function copyClassroom(c) {
    const members = [];
    for (let i = 0; i < c.members.length; i++) {
      const m = c.members[i];
      members.push({ id: m.id, name: m.name, score: m.score });
    }
    return { id: c.id, name: c.name, description: c.description, code: c.code, members: members, createdAt: c.createdAt };
  }
  function copyDeskmate(d) { return { id: d.id, name: d.name, note: d.note, score: d.score, days: d.days }; }
  function copyBattleRecord(r) {
    return { id: r.id, bookName: r.bookName, players: r.players.slice(), scores: r.scores.slice(), winner: r.winner, playedAt: r.playedAt };
  }

  function loadState(raw) {
    if (raw === undefined || raw === null || typeof raw !== 'object') return defaultState();
    const state = defaultState();
    state.schema = STATE_SCHEMA;
    if (raw.settings && typeof raw.settings === 'object') {
      const s = raw.settings;
      const d = defaultSettings();
      state.settings.requestRetention = num(s.requestRetention, d.requestRetention);
      state.settings.maximumInterval = num(s.maximumInterval, d.maximumInterval);
      state.settings.weights = (s.weights && Array.isArray(s.weights)) ? numArray(s.weights, d.weights) : d.weights.slice();
      state.settings.newCardsPerDay = nonNegInt(s.newCardsPerDay, d.newCardsPerDay);
      state.settings.reviewCardsPerDay = nonNegInt(s.reviewCardsPerDay, d.reviewCardsPerDay);
      state.settings.learningSteps = numArray(s.learningSteps, d.learningSteps);
      state.settings.relearningSteps = numArray(s.relearningSteps, d.relearningSteps);
      state.settings.graduatingInterval = Math.max(1, Math.round(num(s.graduatingInterval, d.graduatingInterval)));
      state.settings.easyInterval = Math.max(1, Math.round(num(s.easyInterval, d.easyInterval)));
      state.settings.leechThreshold = Math.max(1, Math.round(num(s.leechThreshold, d.leechThreshold)));
      state.settings.leechAction = str(s.leechAction, d.leechAction) === 'suspend' ? 'suspend' : 'tag';
      state.settings.buryRelated = s.buryRelated !== false;
      state.settings.newOrder = (str(s.newOrder, '') === 'random') ? 'random' : (str(s.newOrder, '') === 'order' ? 'order' : 'mix');
      state.settings.reviewOrder = (str(s.reviewOrder, '') === 'random') ? 'random' : 'due';
      state.settings.showTimer = s.showTimer !== false;
      state.settings.autoRevealSeconds = Math.max(0, Math.round(num(s.autoRevealSeconds, 0)));
      state.settings.theme = (str(s.theme, '') === 'dark') ? 'dark' : (str(s.theme, '') === 'auto' ? 'auto' : 'light');
      state.settings.studyFont = (str(s.studyFont, '') === 's') ? 's' : (str(s.studyFont, '') === 'l' ? 'l' : 'm');
      const mo = s.motion === false ? 'off' : str(s.motion, '');
      state.settings.motion = (mo === 'off' || mo === 'full') ? mo : 'calm';
      state.settings.sound = s.sound !== false;
      state.settings.backupRemindDays = Math.max(0, Math.round(num(s.backupRemindDays, d.backupRemindDays)));
      state.settings.accent = ['brand', 'green', 'teal', 'amber', 'red', 'rose'].indexOf(str(s.accent, '')) >= 0 ? s.accent : 'brand';
      state.settings.bg = ['default', 'grid', 'mist', 'paper', 'dots', 'aurora'].indexOf(str(s.bg, '')) >= 0 ? s.bg : 'default';
      state.settings.preset = str(s.preset, '') || 'default';
    }
    if (raw.decks !== undefined && raw.decks !== null && Array.isArray(raw.decks)) {
      const decks = [];
      for (let i = 0; i < raw.decks.length; i++) decks.push(normalizeDeck(raw.decks[i]));
      state.decks = decks;
    }
    if (raw.stats !== undefined && raw.stats !== null && Array.isArray(raw.stats)) {
      const stats = [];
      for (let i = 0; i < raw.stats.length; i++) {
        const e = raw.stats[i];
        if (e && typeof e.date === 'string') stats.push({
          date: e.date, reviews: nonNegInt(e.reviews, 0), passed: nonNegInt(e.passed, 0),
          timeMs: Math.max(0, num(e.timeMs, 0)), newCount: nonNegInt(e.newCount, 0), reviewCount: nonNegInt(e.reviewCount, 0)
        });
      }
      state.stats = stats;
    }
    state.lastNewDate = str(raw.lastNewDate, '');
    state.newToday = nonNegInt(raw.newToday, 0);
    state.lastReviewDate = str(raw.lastReviewDate, '');
    state.reviewToday = nonNegInt(raw.reviewToday, 0);
    if (raw.wordBooks !== undefined && raw.wordBooks !== null && Array.isArray(raw.wordBooks)) {
      const books = [];
      for (let i = 0; i < raw.wordBooks.length; i++) {
        const b = raw.wordBooks[i];
        if (!b || typeof b.id !== 'string') continue;
        const words = [];
        if (b.words !== undefined && b.words !== null && Array.isArray(b.words)) {
          for (let k = 0; k < b.words.length; k++) {
            const w = b.words[k];
            if (!w || typeof w.word !== 'string') continue;
            words.push(newWordEntry(w.word, str(w.phonetic, ''), str(w.meaning, ''), str(w.example, ''), str(w.exampleCn, '')));
          }
        }
        const nb = newWordBook(b.name || '未命名词书', str(b.description, ''), str(b.category, ''), !!b.builtIn, words);
        nb.id = str(b.id, nb.id);
        books.push(nb);
      }
      state.wordBooks = books;
    }
    if (raw.wordProgress !== undefined && raw.wordProgress !== null && Array.isArray(raw.wordProgress)) {
      const list = [];
      for (let i = 0; i < raw.wordProgress.length; i++) {
        const p = raw.wordProgress[i];
        if (!p || typeof p.bookId !== 'string') continue;
        list.push({ bookId: p.bookId, statuses: numArray(p.statuses, []), cursor: nonNegInt(p.cursor, 0), updatedAt: str(p.updatedAt, nowIso()) });
      }
      state.wordProgress = list;
    }
    if (raw.classrooms !== undefined && raw.classrooms !== null && Array.isArray(raw.classrooms)) {
      const list = [];
      for (let i = 0; i < raw.classrooms.length; i++) list.push(copyClassroom(raw.classrooms[i]));
      state.classrooms = list;
    }
    if (raw.deskmates !== undefined && raw.deskmates !== null && Array.isArray(raw.deskmates)) {
      const list = [];
      for (let i = 0; i < raw.deskmates.length; i++) list.push(copyDeskmate(raw.deskmates[i]));
      state.deskmates = list;
    }
    if (raw.battleRecords !== undefined && raw.battleRecords !== null && Array.isArray(raw.battleRecords)) {
      const list = [];
      for (let i = 0; i < raw.battleRecords.length; i++) list.push(copyBattleRecord(raw.battleRecords[i]));
      state.battleRecords = list;
    }
    state.savedSearches = strArray(raw.savedSearches);
    state.removedSeries = strArray(raw.removedSeries);
    state.collapsedSeries = strArray(raw.collapsedSeries);
    if (raw.series !== undefined && raw.series !== null && Array.isArray(raw.series)) {
      const sl = [];
      for (let i = 0; i < raw.series.length; i++) {
        const se = raw.series[i];
        if (se && typeof se === 'object' && se.id && se.name && se.tagKey) sl.push(se);
      }
      state.series = sl;
    }
    return state;
  }

  // -------------------------------------------------------------------------
  // 内置词书已移除：所有学习卡片一律由用户导入，运行时零内置。
  // -------------------------------------------------------------------------
  const FC = {
    DAY_MS: DAY_MS, MINUTE_MS: MINUTE_MS,
    FSRS5_WEIGHTS: FSRS5_WEIGHTS, FSRS_WEIGHT_COUNT: FSRS_WEIGHT_COUNT,
    S_MIN: S_MIN, S_MAX: S_MAX, D_MIN: D_MIN, D_MAX: D_MAX, DECAY: DECAY, FACTOR: FACTOR,
    STATE_NEW: STATE_NEW, STATE_LEARNING: STATE_LEARNING, STATE_REVIEW: STATE_REVIEW, STATE_RELEARNING: STATE_RELEARNING,
    SRCD_FORMAT: SRCD_FORMAT, SRCD_VERSION: SRCD_VERSION, STATE_SCHEMA: STATE_SCHEMA,
    makeId: makeId, nowIso: nowIso, dateKey: dateKey, clamp: clamp,
    defaultScheduling: defaultScheduling, newCard: newCard, emptyCard: emptyCard, newDeck: newDeck,
    defaultSettings: defaultSettings, defaultParameters: defaultParameters, defaultState: defaultState,
    copyState: copyState, copyDeck: copyDeck, copyCard: copyCard, copySettings: copySettings,
    newWordEntry: newWordEntry, newWordBook: newWordBook, emptyProgress: emptyProgress,
    emptyBattle: emptyBattle, progressCounts: progressCounts,
    Fsrs: Fsrs, Scheduler: Scheduler, SrcdCodec: SrcdCodec, loadState: loadState,
    FLAG_COLORS: FLAG_COLORS, defaultDeckOptions: defaultDeckOptions,
    copyDeckOptions: copyDeckOptions, normalizeFields: normalizeFields
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FC;
  else global.FC = FC;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


