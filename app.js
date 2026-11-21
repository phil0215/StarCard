
    // 启动异常可视化：脚本出错时不再白屏，而是把原因显示出来，便于反馈
    window.addEventListener('error', function (e) {
      var b = document.getElementById('bootErr');
      if (!b || !b.style) return;
      var msg = (e && e.message) || '未知错误';
      var where = '';
      if (e && e.filename) {
        var parts = String(e.filename).split('/');
        where = ' @ ' + parts[parts.length - 1] + ':' + (e.lineno || 0);
      }
      b.style.display = 'block';
      b.textContent = '启动失败：' + msg + where;
    });



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
      showTimer: true, autoRevealSeconds: 0, theme: 'light',
      studyFont: 'm', motion: true,
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
      studyFont: s.studyFont || 'm', motion: s.motion !== false
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
      state.settings.motion = s.motion !== false;
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


/* ===== js/arkui.js ===== */
/* ============================================================
 * arkui.js · ArkUI 风格声明式 UI 框架（网页运行时）
 * ------------------------------------------------------------
 * 让闪星卡的界面代码以接近鸿蒙 ArkTS/ArkUI 的声明式、组件化
 * 形式编写，最终仍渲染为浏览器 DOM。界面逻辑与渲染方式对齐
 * ArkUI（Column/Row/Stack/Text/Button、build()、响应式 state、
 * 链式通用属性），为日后把本项目迁移到鸿蒙原生应用铺路。
 *
 * 用法示例：
 *   class Counter extends ArkUI.Component {
 *     build() {
 *       return ArkUI.Column({ space: 12 }).padding(16).children([
 *         ArkUI.Text(String(this.state.count)).fontSize(28).fontWeight(600),
 *         ArkUI.Button('+1', { type: 'primary' })
 *           .onClick(() => { this.state.count += 1; })
 *       ]);
 *     }
 *   }
 *   new Counter().mount(document.getElementById('app'));
 * ============================================================ */
(function (global) {
  'use strict';

  // ------------------------------------------------------------ 工具
  function isStr(v) { return typeof v === 'string'; }
  function isNum(v) { return typeof v === 'number'; }
  function toCssNum(v) { return isNum(v) ? v + 'px' : v; }

  function flatten(arr) {
    const out = [];
    (function walk(a) {
      if (a == null || a === false) return;
      if (Array.isArray(a)) { a.forEach(walk); return; }
      out.push(a);
    })(arr);
    return out;
  }

  // padding / margin：单值 | '12px 16px' | {top,right,bottom,left}
  function spacing(v) {
    if (isNum(v)) return v + 'px';
    if (isStr(v)) return v;
    if (v && typeof v === 'object') {
      const t = v.top != null ? toCssNum(v.top) : '0';
      const r = v.right != null ? toCssNum(v.right) : '0';
      const b = v.bottom != null ? toCssNum(v.bottom) : '0';
      const l = v.left != null ? toCssNum(v.left) : '0';
      return t + ' ' + r + ' ' + b + ' ' + l;
    }
    return '';
  }

  // ------------------------------------------------------------ 元素节点
  class El {
    constructor(tag, text) {
      this.tag = tag;
      this._style = {};
      this._attrs = {};
      this._events = {};
      this._children = [];
      this._html = null;
      this._text = text != null ? String(text) : null;
    }

    // ---- 尺寸 / 间距（对齐 ArkUI 通用属性）----
    width(v) { this._style.width = toCssNum(v); return this; }
    height(v) { this._style.height = toCssNum(v); return this; }
    minWidth(v) { this._style['min-width'] = toCssNum(v); return this; }
    maxWidth(v) { this._style['max-width'] = toCssNum(v); return this; }
    minHeight(v) { this._style['min-height'] = toCssNum(v); return this; }
    maxHeight(v) { this._style['max-height'] = toCssNum(v); return this; }
    padding(v) { this._style.padding = spacing(v); return this; }
    paddingTop(v) { this._style['padding-top'] = toCssNum(v); return this; }
    paddingRight(v) { this._style['padding-right'] = toCssNum(v); return this; }
    paddingBottom(v) { this._style['padding-bottom'] = toCssNum(v); return this; }
    paddingLeft(v) { this._style['padding-left'] = toCssNum(v); return this; }
    margin(v) { this._style.margin = spacing(v); return this; }
    marginTop(v) { this._style['margin-top'] = toCssNum(v); return this; }
    marginRight(v) { this._style['margin-right'] = toCssNum(v); return this; }
    marginBottom(v) { this._style['margin-bottom'] = toCssNum(v); return this; }
    marginLeft(v) { this._style['margin-left'] = toCssNum(v); return this; }
    gap(v) { this._style.gap = toCssNum(v); return this; }

    // ---- 弹性布局 ----
    display(v) { this._style.display = v; return this; }
    flex(v) { this._style.flex = v; return this; }
    flexGrow(v) { this._style['flex-grow'] = v; return this; }
    flexShrink(v) { this._style['flex-shrink'] = v; return this; }
    flexBasis(v) { this._style['flex-basis'] = toCssNum(v); return this; }
    flexDirection(v) { this._style['flex-direction'] = v; return this; }
    flexWrap(v) { this._style['flex-wrap'] = v; return this; }
    alignItems(v) { this._style['align-items'] = v; return this; }
    alignSelf(v) { this._style['align-self'] = v; return this; }
    justifyContent(v) { this._style['justify-content'] = v; return this; }

    // ---- 外观 ----
    backgroundColor(v) { this._style['background-color'] = v; return this; }
    color(v) { this._style.color = v; return this; }
    borderRadius(v) { this._style['border-radius'] = toCssNum(v); return this; }
    border(v) { this._style.border = v; return this; }
    borderTop(v) { this._style['border-top'] = v; return this; }
    borderBottom(v) { this._style['border-bottom'] = v; return this; }
    borderLeft(v) { this._style['border-left'] = v; return this; }
    borderRight(v) { this._style['border-right'] = v; return this; }
    boxShadow(v) { this._style['box-shadow'] = v; return this; }
    opacity(v) { this._style.opacity = v; return this; }
    cursor(v) { this._style.cursor = v; return this; }
    overflow(v) { this._style.overflow = v; return this; }
    overflowX(v) { this._style['overflow-x'] = v; return this; }
    overflowY(v) { this._style['overflow-y'] = v; return this; }
    objectFit(v) { this._style['object-fit'] = v; return this; }
    background(v) { this._style.background = v; return this; }
    backgroundImage(v) { this._style['background-image'] = v; return this; }
    backgroundSize(v) { this._style['background-size'] = v; return this; }
    backgroundPosition(v) { this._style['background-position'] = v; return this; }
    position(v) { this._style.position = v; return this; }
    top(v) { this._style.top = toCssNum(v); return this; }
    right(v) { this._style.right = toCssNum(v); return this; }
    bottom(v) { this._style.bottom = toCssNum(v); return this; }
    left(v) { this._style.left = toCssNum(v); return this; }
    zIndex(v) { this._style['z-index'] = v; return this; }
    inset(v) { this._style.inset = toCssNum(v); return this; }

    // ---- 文本 ----
    fontSize(v) { this._style['font-size'] = toCssNum(v); return this; }
    fontColor(v) { this._style.color = v; return this; }
    fontWeight(v) { this._style['font-weight'] = v; return this; }
    textAlign(v) { this._style['text-align'] = v; return this; }
    lineHeight(v) { this._style['line-height'] = toCssNum(v); return this; }
    letterSpacing(v) { this._style['letter-spacing'] = toCssNum(v); return this; }
    whiteSpace(v) { this._style['white-space'] = v; return this; }
    textOverflow(v) { this._style['text-overflow'] = v; return this; }
    wordBreak(v) { this._style['word-break'] = v; return this; }
    textDecoration(v) { this._style['text-decoration'] = v; return this; }

    // ---- 属性 ----
    id(v) { this._attrs.id = v; return this; }
    cls(v) { if (v) this._attrs.class = v; return this; }
    title(v) { if (v != null) this._attrs.title = String(v); return this; }
    role(v) { this._attrs.role = v; return this; }
    tabindex(v) { this._attrs.tabindex = v; return this; }
    type(v) { this._attrs.type = v; return this; }
    name(v) { this._attrs.name = v; return this; }
    src(v) { this._attrs.src = v; return this; }
    alt(v) { this._attrs.alt = v; return this; }
    href(v) { this._attrs.href = v; return this; }
    target(v) { this._attrs.target = v; return this; }
    placeholder(v) { if (v != null) this._attrs.placeholder = String(v); return this; }
    value(v) { if (v != null) this._attrs.value = String(v); return this; }
    checked(v) { this._attrs.checked = v ? true : false; return this; }
    disabled(v) { this._attrs.disabled = v ? true : false; return this; }
    readonly(v) { this._attrs.readonly = v ? true : false; return this; }
    autofocus(v) { this._attrs.autofocus = v ? true : false; return this; }
    maxlength(v) { this._attrs.maxlength = v; return this; }
    accept(v) { this._attrs.accept = v; return this; }
    rows(v) { this._attrs.rows = v; return this; }
    cols(v) { this._attrs.cols = v; return this; }
    for_(v) { this._attrs.for = v; return this; }
    // data-* 委托属性（事件委托核心：data-act / data-i / data-rating / data-src ...）
    attr(name, value) {
      if (value == null || value === false) delete this._attrs['data-' + name];
      else this._attrs['data-' + name] = String(value);
      return this;
    }
    act(v) { return this.attr('act', v); }
    // 任意内联样式
    style(k, v) { this._style[k] = v; return this; }

    // ---- 事件 ----
    onClick(fn) { this._events.click = fn; return this; }
    onInput(fn) { this._events.input = fn; return this; }
    onChange(fn) { this._events.change = fn; return this; }
    onFocus(fn) { this._events.focus = fn; return this; }
    onBlur(fn) { this._events.blur = fn; return this; }
    onKeydown(fn) { this._events.keydown = fn; return this; }
    onKeyup(fn) { this._events.keyup = fn; return this; }
    onMouseenter(fn) { this._events.mouseenter = fn; return this; }
    onMouseleave(fn) { this._events.mouseleave = fn; return this; }

    // ---- 内容 ----
    children(list) { this._children = flatten(list); return this; }
    child(v) { this._children.push(v); return this; }
    html(h) { this._html = h; this._children = []; this._text = null; return this; }
    text(t) { this._text = String(t); this._children = []; this._html = null; return this; }

    // 渲染为真实 DOM
    toNode() {
      // svg 必须用 SVG 命名空间创建，否则 innerHTML 里的 <path> 无法渲染（声明式图标全靠它）
      const node = this.tag === 'svg'
        ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        : document.createElement(this.tag);
      for (const k in this._attrs) {
        const v = this._attrs[k];
        if (v == null || v === false) continue;
        node.setAttribute(k, v === true ? '' : v);
      }
      let css = '';
      for (const k in this._style) { if (this._style[k] != null && this._style[k] !== '') css += k + ':' + this._style[k] + ';'; }
      if (css) node.setAttribute('style', css);
      for (const k in this._events) node.addEventListener(k, this._events[k]);
      if (this._html != null) {
        node.innerHTML = this._html;
      } else if (this._text != null) {
        node.textContent = this._text;
      } else {
        for (let i = 0; i < this._children.length; i++) node.appendChild(toNode(this._children[i]));
      }
      return node;
    }
  }

  // ------------------------------------------------------------ 通用属性注入
  function applyOpts(e, opts) {
    if (!opts) return e;
    if (opts.space != null) e.gap(opts.space);
    if (opts.gap != null) e.gap(opts.gap);
    if (opts.padding != null) e.padding(opts.padding);
    if (opts.margin != null) e.margin(opts.margin);
    if (opts.alignItems != null) e.alignItems(opts.alignItems);
    if (opts.justifyContent != null) e.justifyContent(opts.justifyContent);
    if (opts.align != null) e.alignItems(opts.align);
    if (opts.justify != null) e.justifyContent(opts.justify);
    if (opts.flex != null) e.flex(opts.flex);
    if (opts.flexGrow != null) e.flexGrow(opts.flexGrow);
    if (opts.width != null) e.width(opts.width);
    if (opts.height != null) e.height(opts.height);
    if (opts.minWidth != null) e.minWidth(opts.minWidth);
    if (opts.maxWidth != null) e.maxWidth(opts.maxWidth);
    if (opts.bg != null) e.backgroundColor(opts.bg);
    if (opts.background != null) e.background(opts.background);
    if (opts.color != null) e.color(opts.color);
    if (opts.radius != null) e.borderRadius(opts.radius);
    if (opts.border != null) e.border(opts.border);
    if (opts.shadow != null) e.boxShadow(opts.shadow);
    if (opts.opacity != null) e.opacity(opts.opacity);
    if (opts.overflow != null) e.overflow(opts.overflow);
    if (opts.position != null) e.position(opts.position);
    if (opts.top != null) e.top(opts.top);
    if (opts.right != null) e.right(opts.right);
    if (opts.bottom != null) e.bottom(opts.bottom);
    if (opts.left != null) e.left(opts.left);
    if (opts.zIndex != null) e.zIndex(opts.zIndex);
    if (opts.fontSize != null) e.fontSize(opts.fontSize);
    if (opts.fontColor != null) e.fontColor(opts.fontColor);
    if (opts.fontWeight != null) e.fontWeight(opts.fontWeight);
    if (opts.textAlign != null) e.textAlign(opts.textAlign);
    if (opts.lineHeight != null) e.lineHeight(opts.lineHeight);
    if (opts.cursor != null) e.cursor(opts.cursor);
    if (opts.cls) e.cls(opts.cls);
    if (opts.id) e.id(opts.id);
    if (opts.title != null) e.title(opts.title);
    if (opts.onClick) e.onClick(opts.onClick);
    if (opts.onInput) e.onInput(opts.onInput);
    if (opts.onChange) e.onChange(opts.onChange);
    if (opts.act) e.act(opts.act);
    if (opts.attr) { for (const k in opts.attr) e.attr(k, opts.attr[k]); }
    if (opts.style) { for (const k in opts.style) e.style(k, opts.style[k]); }
    return e;
  }

  // ------------------------------------------------------------ 内置组件
  function Column(opts) { return applyOpts(new El('div').display('flex').flexDirection('column'), opts); }
  function Row(opts) { return applyOpts(new El('div').display('flex').flexDirection('row').alignItems('center'), opts); }
  function Stack(opts) { return applyOpts(new El('div').position('relative'), opts); }
  function Flex(opts) { return applyOpts(new El('div').display('flex'), opts); }
  function Text(content, opts) { return applyOpts(new El('span', content), opts); }
  function Span(content, opts) { return applyOpts(new El('span', content), opts); }
  function Paragraph(content, opts) { return applyOpts(new El('p', content), opts); }

  function Button(label, opts) {
    opts = opts || {};
    const type = opts.type || 'default';
    let cls = 'btn';
    if (type === 'primary') cls += ' btn-primary';
    else if (type === 'danger') cls += ' btn-danger';
    else if (type === 'ghost') cls += ' btn-ghost';
    else if (type === 'text') cls += ' btn-text';
    else if (type === 'soft') cls += ' btn-soft';
    const e = new El('button', label).cls(cls);
    return applyOpts(e, opts);
  }

  function Image(src, opts) { const e = new El('img').src(src).alt(''); return applyOpts(e, opts); }
  function Divider(opts) { const e = new El('div').cls('divider'); return applyOpts(e, opts); }
  function Spacer(opts) { const e = new El('div').cls('spacer'); return applyOpts(e, opts); }
  function List(opts) { const e = new El('div').cls('ark-list').display('flex').flexDirection('column'); return applyOpts(e, opts); }
  function ListItem(opts) { return applyOpts(new El('div').cls('ark-list-item'), opts); }
  function Badge(content, opts) { return applyOpts(new El('span', content).cls('badge'), opts); }
  function Chip(content, opts) { return applyOpts(new El('span', content).cls('chip'), opts); }
  function Input(opts) { const e = new El('input'); return applyOpts(e, opts); }
  function TextArea(opts) { const e = new El('textarea'); return applyOpts(e, opts); }
  function Select(opts) { const e = new El('select'); return applyOpts(e, opts); }
  function Option(content, opts) { return applyOpts(new El('option', content), opts); }
  function Label(content, opts) { return applyOpts(new El('label', content), opts); }

  // 原始 HTML 片段（SVG 图标、头像等；注意内容需可信）
  function Html(html) { return new El('span').html(html); }
  function RawNode(node) { return node; }

  // ------------------------------------------------------------ 条件 / 循环
  function If(cond, a, b) { return cond ? a : (b == null ? null : b); }
  function ForEach(arr, fn) {
    if (!arr) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) out.push(fn(arr[i], i));
    return flatten(out);
  }

  // ------------------------------------------------------------ 组件基类
  class Component {
    constructor(props) {
      this.props = props || {};
      this.state = this._reactive({});
      this._host = null;
      this._root = null;
      this._pending = false;
      this._disposed = false;
    }

    _reactive(obj) {
      const self = this;
      return new Proxy(obj, {
        set: function (t, k, v) {
          if (t[k] === v) return true;
          t[k] = v;
          self._schedule();
          return true;
        },
        deleteProperty: function (t, k) { delete t[k]; self._schedule(); return true; }
      });
    }

    _schedule() {
      if (this._pending || this._disposed) return;
      this._pending = true;
      const self = this;
      Promise.resolve().then(function () { self._pending = false; self.invalidate(); });
    }

    // 子类覆写：返回 El / Component / 字符串 / 数组
    build() { return null; }

    render() { return this.build(); }

    mount(container) {
      this._host = container;
      this._renderInto();
      this._mounted = true;
      return this;
    }

    _renderInto() {
      if (!this._host) return;
      const vnode = this.render();
      this._host.innerHTML = '';
      this._host.appendChild(toNode(vnode));
    }

    invalidate() {
      if (!this._host || this._disposed) return;
      this._renderInto();
    }

    dispose() {
      this._disposed = true;
      if (this._host) this._host.innerHTML = '';
      this._host = null;
    }
  }

  // ------------------------------------------------------------ 树 → DOM
  function toNode(vnode) {
    if (vnode == null || vnode === false) return document.createTextNode('');
    if (Array.isArray(vnode)) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < vnode.length; i++) frag.appendChild(toNode(vnode[i]));
      return frag;
    }
    if (isStr(vnode)) return document.createTextNode(vnode);
    if (isNum(vnode)) return document.createTextNode(String(vnode));
    if (vnode instanceof El) return vnode.toNode();
    if (vnode instanceof Component) {
      const host = document.createElement('div');
      vnode.mount(host);
      return host.firstChild || host;
    }
    if (vnode instanceof Node) return vnode;
    return document.createTextNode(String(vnode));
  }

  // ------------------------------------------------------------ 导出
  const ArkUI = {
    Component: Component,
    El: El,
    Column: Column, Row: Row, Stack: Stack, Flex: Flex,
    Text: Text, Span: Span, Paragraph: Paragraph,
    Button: Button, Image: Image, Divider: Divider, Spacer: Spacer,
    List: List, ListItem: ListItem, Badge: Badge, Chip: Chip,
    Input: Input, TextArea: TextArea, Select: Select, Option: Option, Label: Label,
    Html: Html, RawNode: RawNode,
    If: If, ForEach: ForEach,
    toNode: toNode, spacing: spacing, flatten: flatten
  };

  global.ArkUI = ArkUI;
})(window);


/* ===== js/cloud-config.js ===== */
/* ============================================================
 * 闪星卡（StarCard）· 云服务公开配置
 * 由 WorkBuddy Cloud Service 提供，仅含可安全下发到前端的公开字段：
 *  - endpoint / publishableKey / oauthRelayBaseUrl
 * publishableKey 本身不含权限，服务端按「已发布域名」精确校验 Origin。
 * 敏感的环境 ID 与各 Provider 密钥都留在服务端，不写入前端。
 * 注意：本应用学习数据仍保存在本机；云端用于「邮箱 / 手机号验证码登录」与「小星在线 AI 问答」。
 *       这些云能力需要联网 + 通过在线网址访问（file:// 打开时 Origin 为空会被服务端拒绝），
 *       离线或本地打开时app自动回退到本地规则引擎，学习功能不受影响。
 * ============================================================ */
(function () {
  'use strict';
  var FC = window.FC || (window.FC = {});

  FC.CLOUD_CONFIG = {
    resourceId: 'wbcs_sKTWmxYTWQTpQfV1eUycbr',
    endpoint: 'https://starcard-55345.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_pY1yCE6VBekvjG7kBKZ5xx_WcUAFHSudhEZcY2faPf5Kavk1jITAiyN',
    // 登录能力开关（云端 Provider 需在 WorkBuddy 管理面板开启；关闭时这里用于给出友好提示）
    emailEnabled: true,
    phoneEnabled: true
  };

  // 是否处于「可调用云端」的环境：必须是通过 http(s) 网址访问，file:// 下不支持
  FC.cloudAvailable = function () {
    return /^https?:$/.test((window.location && window.location.protocol) || '');
  };

  // 分享链接鉴权：本发布平台要求「每个静态资源请求」都带 sharecode，
  // 否则返回 403「链接不完整」。页面查询串里的 sharecode 不会自动继承到
  // fetch / <img> / <audio> 的相对路径请求，这里统一补上。
  // 本地 file:// 或自建服务器（无 sharecode）时原样返回，不影响离线使用。
  FC.assetUrl = function (path) {
    if (!path) return path;
    var search = (window.location && window.location.search) || '';
    var m = /(?:^|[?&])sharecode=([^&#]+)/.exec(search);
    if (!m) return path;
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return path + sep + 'sharecode=' + encodeURIComponent(m[1]);
  };
})();


/* ===== js/cloud-auth.js ===== */
/* ============================================================
 * 闪星卡（StarCard）· 云端登录封装（FC.Auth）
 * 仅用于「邮箱 / 手机号验证码登录」；学习数据与词库仍全部保存在本机。
 *
 * SDK 采用 CDN 形式，且按需懒加载：
 *  - 离线学习、复习、导入词库等所有本地功能都不会触发网络请求；
 *  - 只有用户主动点「获取验证码 / 登录 / 退出」时才加载 SDK 并请求云端。
 *
 * API 全部来自 @tencent-ai/workbuddy-cloud-sdk 的公开契约，见：
 *   cloud-service/references/auth/code-generation.md
 * 初始化只用一个 cloud 实例，endpoint 与 publishableKey 全部取自 FC.CLOUD_CONFIG。
 * ============================================================ */
(function () {
  'use strict';
  var FC = window.FC || (window.FC = {});

  // CDN IIFE 全局为 WorkBuddyCloud；用 @dev 通道（latest 未维护）
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
  var _sdkPromise = null;
  var _cloud = null;

  function cfg() { return FC.CLOUD_CONFIG || {}; }

  // 统一的错误文案映射：按稳定的 error.kind，不依赖后端文案
  function friendlyError(err) {
    if (!err) return '操作失败，请稍后重试';
    var kind = err.kind || err.type || '';
    var map = {
      invalid_grant: '验证码错误或已过期，请重新获取',
      unauthenticated: '请先登录',
      'network': '网络不可用，请检查联网后重试',
      'network-error': '网络不可用，请检查联网后重试',
      'backend-unavailable': '登录服务暂不可用，请稍后再试',
      too_many_requests: '操作太频繁，请稍后再试',
      rate_limited: '操作太频繁，请稍后再试',
      quota_exceeded: '免费额度已用完，请稍后再试',
      invalid_phone: '请输入正确的 11 位手机号'
    };
    if (map[kind]) return map[kind];
    if (typeof err.message === 'string' && err.message) return err.message;
    return '操作失败，请稍后重试';
  }

  // 懒加载 SDK 脚本（失败时缓存结果，不无限重试）
  function loadSdk() {
    if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) {
      return Promise.resolve(true);
    }
    if (_sdkPromise) return _sdkPromise;
    if (!FC.cloudAvailable || !FC.cloudAvailable()) {
      return Promise.resolve(false);
    }
    _sdkPromise = new Promise(function (resolve) {
      try {
        var s = document.createElement('script');
        s.src = SDK_URL; // 动态注入，源码里不出现外链属性（保持离线 HTML 无外链）
        s.async = true;
        s.charset = 'utf-8';
        var done = false;
        s.onload = function () {
          done = true;
          resolve(!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud));
        };
        s.onerror = function () { done = true; resolve(false); };
        (document.head || document.body).appendChild(s);
        // 15 秒超时兜底
        setTimeout(function () { if (!done) resolve(false); }, 15000);
      } catch (e) {
        resolve(false);
      }
    });
    return _sdkPromise;
  }

  // 获取（或首次初始化）唯一的 cloud 客户端
  function getCloud() {
    if (_cloud) return Promise.resolve(_cloud);
    return loadSdk().then(function (ok) {
      if (!ok) return null;
      var C = cfg();
      if (!C.endpoint || !C.publishableKey) return null;
      try {
        _cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: C.endpoint,
          oauthRelayBaseUrl: C.oauthRelayBaseUrl,
          publishableKey: C.publishableKey
        });
      } catch (e) {
        _cloud = null;
      }
      return _cloud;
    });
  }

  function withCloud(fn) {
    return getCloud().then(function (c) {
      if (!c) return { data: null, error: { kind: 'network', message: '登录服务不可用' } };
      try { return fn(c); }
      catch (e) { return { data: null, error: { kind: 'client', message: friendlyError(e) } }; }
    });
  }

  // —— 对外 API —— 每个方法返回 Promise<{ data, error }>，error 已转为中文友好文案 ——

  // 邮箱：发送验证码。新邮箱 isExistingUser=false，登录/注册需带密码
  function sendEmailCode(email) {
    return withCloud(function (c) { return c.auth.sendOtp({ email: email }); })
      .then(normalize);
  }
  // 邮箱：校验验证码并提交（新用户 password 必填）
  function verifyEmail(email, verificationId, isExistingUser, token, password) {
    var payload = {
      email: email, verificationId: verificationId,
      isExistingUser: !!isExistingUser, token: token
    };
    if (!isExistingUser && password) payload.password = password;
    return withCloud(function (c) { return c.auth.verifyOtp(payload); }).then(normalize);
  }
  // 手机号：发送验证码（手机号由 app.js 做 11 位校验后原样传入）
  function sendPhoneCode(phone) {
    return withCloud(function (c) { return c.auth.sendOtp({ phone: phone }); })
      .then(normalize);
  }
  // 手机号：校验验证码并提交（短信注册通常无密码）
  function verifyPhone(phone, verificationId, isExistingUser, token) {
    var payload = {
      phone: phone, verificationId: verificationId,
      isExistingUser: !!isExistingUser, token: token
    };
    return withCloud(function (c) { return c.auth.verifyOtp(payload); }).then(normalize);
  }
  function getSession() {
    return withCloud(function (c) { return c.auth.getSession(); }).then(normalize);
  }
  function getUser() {
    return withCloud(function (c) { return c.auth.getUser(); }).then(normalize);
  }
  function signOut() {
    return withCloud(function (c) { return c.auth.signOut(); }).then(normalize);
  }
  function onAuthStateChange(cb) {
    return getCloud().then(function (c) {
      if (!c || !c.auth.onAuthStateChange) return function () {};
      return c.auth.onAuthStateChange(cb);
    });
  }

  // 统一把 { data, error } 的 error 字段转成中文 message，data 原样透传
  function normalize(result) {
    if (!result || typeof result !== 'object') return { data: null, error: { message: '操作失败' } };
    if (result.error) {
      return {
        data: result.data || null,
        error: {
          kind: result.error.kind || '',
          message: friendlyError(result.error),
          raw: result.error
        }
      };
    }
    return { data: result.data, error: null };
  }

  FC.Auth = {
    available: function () { return !!(FC.cloudAvailable && FC.cloudAvailable()); },
    friendlyError: friendlyError,
    sendEmailCode: sendEmailCode,
    verifyEmail: verifyEmail,
    sendPhoneCode: sendPhoneCode,
    verifyPhone: verifyPhone,
    getSession: getSession,
    getUser: getUser,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,
    // 供测试 / 调试：是否已初始化 cloud（不暴露敏感值）
    _initialized: function () { return !!_cloud; }
  };

  /* ------------------------------------------------------------
   * FC.CloudLLM —— 小星「在线 AI 问答」
   * 复用与登录同一个 cloud 客户端（不重复初始化、不重复加载 SDK）。
   * 仅联网且 SDK 就绪时才会真正请求云端；失败通过 error 交回调用方，
   * 由 aiSend 回退到本地规则引擎，保证离线学习零影响。
   * API 契约见 cloud-service/references/llm/code-generation.md：
   *   cloud.llm.models.list() → cloud.llm.chat.completions.create({ stream:true, messages:[system,...] })
   * ------------------------------------------------------------ */
  var _modelId = null;          // 缓存选中的模型 id（首次 list 后固定）
  var _modelsTried = false;
  var SYS_PROMPT = '你是「小星」，闪星卡 StarCard 内置的英语词汇学习助手，_service面向备考 SAT / 托福的中国学生。' +
    '回答简洁、友好、鼓励式，用中文为主；讲解英语单词时给出准确释义、词根词缀、助记与英文例句。' +
    '不编造不确定的事实，不确定就直说。不要输出任何 HTML 标签或脚本。';

  function pickModel(cloud) {
    if (_modelId) return Promise.resolve(_modelId);
    if (!cloud.llm || !cloud.llm.models || !cloud.llm.models.list) return Promise.resolve(null);
    return Promise.resolve(cloud.llm.models.list()).then(function (list) {
      _modelsTried = true;
      var arr = Array.isArray(list) ? list : (list && list.data) || [];
      // 只选启用的模型；优先自动模型，其次任意可用模型。禁用项不作兜底。
      var usable = arr.filter(function (m) { return m && m.disabled !== true && m.enabled !== false; });
      var auto = usable.filter(function (m) { return m.id === 'auto'; })[0];
      var chosen = auto || usable[0];
      _modelId = chosen ? chosen.id : null;
      return _modelId;
    }).catch(function () { _modelsTried = true; return null; });
  }

  // 把应用侧的对话历史转成 SDK messages；system 必须是第一条。
  function buildMessages(history, question) {
    var msgs = [{ role: 'system', content: SYS_PROMPT }];
    var src = Array.isArray(history) ? history.slice(-6) : [];
    for (var i = 0; i < src.length; i++) {
      var m = src[i] || {};
      var role = m.role === 'user' ? 'user' : (m.role === 'ai' ? 'assistant' : null);
      var txt = String(m.text || (m.html ? String(m.html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '') || '');
      if (role && txt) msgs.push({ role: role, content: txt.slice(0, 2000) });
    }
    msgs.push({ role: 'user', content: String(question || '').slice(0, 4000) });
    return msgs;
  }

  // 返回 Promise<string>（累积的完整回答）；失败 reject({kind,message}) 由调用方回退。
  function askLLM(question, history) {
    return getCloud().then(function (cloud) {
      if (!cloud || !cloud.llm || !cloud.llm.chat || !cloud.llm.chat.completions) {
        throw { kind: 'network', message: 'AI 服务暂不可用' };
      }
      return pickModel(cloud).then(function (model) {
        if (!model) throw { kind: 'model-empty', message: '当前没有可用的 AI 模型' };
        var params = {
          model: model,
          messages: buildMessages(history, question),
          stream: true,
          temperature: 0.7
        };
        return new Promise(function (resolve, reject) {
          var full = '';
          var settled = false;
          try {
            var iterator = cloud.llm.chat.completions.create(params);
            // SDK 返回 async iterable；用 for-await 的等价迭代收集文本
            (async function () {
              try {
                for await (var chunk of iterator) {
                  var delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
                  if (delta && delta.content) full += delta.content;
                  if (delta && delta.refusal) full += '\n（模型拒绝回答该内容）';
                }
                settled = true;
                resolve(full.trim());
              } catch (e) {
                settled = true;
                var code = (e && e.error && e.error.code) || '';
                var kind = /^quota_/.test(code) ? 'quota'
                  : (/^auth_/.test(code) ? 'auth'
                  : (/^gateway_|^model_|^internal_/.test(code) ? 'backend' : 'network'));
                reject({ kind: kind, message: friendlyError({ kind: kind }), code: code });
              }
            })();
          } catch (e) {
            if (!settled) reject({ kind: 'client', message: 'AI 请求发起失败' });
          }
        });
      });
    });
  }

  FC.CloudLLM = {
    // 是否具备在线问答条件：必须 http(s) 访问 + 有 publishableKey
    available: function () {
      var C = cfg();
      return !!(FC.cloudAvailable && FC.cloudAvailable() && C.endpoint && C.publishableKey);
    },
    ask: askLLM,
    // 供调试：是否已选中模型（不暴露 key）
    _model: function () { return _modelId; }
  };
})();


/* ===== js/series.js ===== */
/**
 * 闪星卡（StarCard）· 系列（Series）
 * ------------------------------------------------------------------
 * "系列"是把若干牌组按主题收进同一个文件夹式容器的内容组织层。
 * 全部学习卡片都由用户导入，运行时零内置：每导入一个词库文件，
 * 就自动生成一个系列（文件夹）收纳本批牌组。系列是运行时动态数据，
 * 存在 state.series 中，可增删改、可折叠、可整体系列导出 / 学习 / 删除。
 * 牌组通过 tagKey（series_xxx 标签）归属系列。
 * 纯数据 / 工具，不依赖 app.js。
 */
(function (global) {
  'use strict';
  const FC = global.FC || {};

  // 兼容旧接口：运行时系列一律取自 state.series，此常量恒为空（不再预置任何词库）。
  const SERIES = [];
  // 最近一次被查询的 state，供 seriesById 在未显式传 state 时兜底。
  let LAST_STATE = null;
  function remember(state) { if (state) LAST_STATE = state; }

  const ACCENTS = ['brand', 'green', 'amber', 'red', 'blue', 'pink', 'cyan', 'orange'];

  function hashStr(x) {
    let h = 0;
    for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // 从牌组名提取分册编号。核心词形如「01List」（数字在前），
  // 增补词形如「List 13」（数字在后）——两者都要识别，避免增补 13-17 被误读成 01-05。
  function deckNumber(d) {
    const name = String(d.name || '');
    let m = name.match(/(\d+)\s*List/i);        // 数字在前：01List
    if (!m) m = name.match(/List\s*(\d+)/i);    // 数字在后：List 13
    return m ? parseInt(m[1], 10) : 9999;
  }

  // 该系列已导入的真实牌组（按分册编号排序）
  function decksOf(state, series) {
    if (!state || !state.decks) return [];
    const key = series.tagKey;
    const out = state.decks.filter(function (d) {
      return (d.tags || []).indexOf(key) >= 0;
    });
    out.sort(function (a, b) { return deckNumber(a) - deckNumber(b); });
    return out;
  }

  function isLoaded(state, series) { return decksOf(state, series).length > 0; }

  // 系列是否被用户从词书中移除（动态系列一般直接物理删除，此字段保留兼容旧数据）
  function isRemoved(state, series) {
    return !!(state && state.removedSeries && state.removedSeries.indexOf(series.id) >= 0);
  }
  // 在词书/学习页可见的系列
  function visible(state) {
    remember(state);
    const list = (state && state.series) || SERIES;
    return list.filter(function (s) { return !isRemoved(state, s); });
  }
  // 被用户移除的系列（供词书页「恢复」入口使用）
  function removed(state) {
    remember(state);
    const list = (state && state.series) || SERIES;
    return list.filter(function (s) { return isRemoved(state, s); });
  }

  // 按 id 查系列（显式传 state 优先；否则用最近一次查询的 state 兜底）
  function seriesById(id, state) {
    const st = state || LAST_STATE;
    const list = (st && st.series) || SERIES;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---- 动态系列：导入词库时创建 / 复用一个系列，并把本批牌组归入 ----
  // name 一般来自文件名去后缀；同名复用，保证"重新导入"归回原系列、不堆叠重复文件夹。
  function registerSeries(state, name, file) {
    if (!state.series) state.series = [];
    name = String(name || '').trim() || '导入词库';
    file = String(file || '');
    for (let i = 0; i < state.series.length; i++) {
      if (state.series[i].name === name) {
        if (file) { state.series[i].file = file; state.series[i].source = file; }
        return state.series[i];
      }
    }
    let base = 's_' + hashStr(name);
    let id = base, n = 1;
    while (state.series.some(function (x) { return x.id === id; })) { id = base + '_' + (n++); }
    const se = {
      id: id, name: name, subtitle: '', description: '',
      icon: 'layers', accent: ACCENTS[state.series.length % ACCENTS.length],
      tagKey: 'series_' + id, file: file, source: file,
      volCount: 0, cardCount: 0, builtIn: false, createdAt: Date.now()
    };
    state.series.push(se);
    return se;
  }

  // 给本次导入的牌组（按名字集合）打上该系列的归属标签。
  // 先清掉任何旧的 series_ 标签，避免同一牌组同时属于多个系列；
  // 也解决"同名重新导入时 merge 用文件 tags 覆盖、冲掉归属"的问题。
  function tagSeriesDecks(state, series, deckNames) {
    const set = {};
    (deckNames || []).forEach(function (n) { set[n] = true; });
    const key = series.tagKey;
    (state.decks || []).forEach(function (d) {
      if (!set[d.name]) return;
      let tags = (d.tags || []).filter(function (t) {
        return !(typeof t === 'string' && t.indexOf('series_') === 0);
      });
      if (tags.indexOf(key) < 0) tags.push(key);
      d.tags = tags;
    });
  }

  // 刷新系列的分册数 / 卡数静态元数据（供未导入引导与文件夹卡片使用）
  function updateSeriesMeta(state, series) {
    const ds = decksOf(state, series);
    series.volCount = ds.length;
    let cc = 0;
    for (let i = 0; i < ds.length; i++) cc += ds[i].cards.length;
    series.cardCount = cc;
  }

  // 旧数据迁移：老版本没有 state.series，牌组按「系列名 › 分册名」命名。
  // 对没有任何 series_ 标签、且名字带 › 的牌组，按前缀自动重建系列。
  // 幂等：已打标的牌组会被跳过；自建牌组（无 ›）保持平铺，不强行归系列。
  function ensureSeriesForLegacy(state) {
    if (!state || !state.decks || !state.decks.length) return 0;
    const groups = {};
    for (let i = 0; i < state.decks.length; i++) {
      const d = state.decks[i];
      const tags = d.tags || [];
      let hasSeries = false;
      for (let j = 0; j < tags.length; j++) {
        if (typeof tags[j] === 'string' && tags[j].indexOf('series_') === 0) { hasSeries = true; break; }
      }
      if (hasSeries) continue;
      const parts = String(d.name || '').split('›');
      if (parts.length < 2) continue;
      const name = parts[0].trim();
      if (!name) continue;
      (groups[name] = groups[name] || []).push(d);
    }
    let made = 0;
    Object.keys(groups).forEach(function (name) {
      const se = registerSeries(state, name, '');
      tagSeriesDecks(state, se, groups[name].map(function (d) { return d.name; }));
      updateSeriesMeta(state, se);
      made++;
    });
    return made;
  }

  // 词库一律外部导入，不再有内置预览数据
  function previewVolumes(series) { return []; }

  // 系列聚合概览：分册进度、掌握口径与建议。已导入读真实牌组，未导入读预览。
  function overview(state, series, nowMs) {
    const now = nowMs || Date.now();
    const loaded = isLoaded(state, series);
    const s = new FC.Scheduler(state.settings);
    const S = state.settings || FC.defaultSettings();
    const cap = Math.max(0, Math.round(S.newCardsPerDay != null ? S.newCardsPerDay : 20));
    const newToday = state.newToday || 0;

    const volumes = [];
    let total = 0, fresh = 0, due = 0, learning = 0, mastered = 0;

    if (loaded) {
      const decks = decksOf(state, series);
      for (let i = 0; i < decks.length; i++) {
        const d = decks[i];
        const counts = s.deckCounts(d, now); // [fresh, due, total]
        let inProgress = 0;
        for (let k = 0; k < d.cards.length; k++) {
          const cc = d.cards[k];
          if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
        }
        const no = deckNumber(d);
        const volTotal = d.cards.length;
        const volMastered = Math.max(0, volTotal - counts[0] - inProgress);
        const volPct = volTotal ? Math.round(volMastered / volTotal * 100) : 0;
        let status = 'new';
        if (volMastered >= volTotal && volTotal > 0) status = 'mastered';
        else if (inProgress > 0) status = 'learning';
        else if (volMastered > 0) status = 'progress';
        volumes.push({
          no: no, label: (no < 10 ? '0' + no : no) + ' List', name: d.name, id: d.id,
          cards: volTotal, fresh: counts[0], due: counts[1], learning: inProgress,
          mastered: volMastered, pct: volPct, status: status
        });
        total += volTotal; fresh += counts[0]; due += counts[1]; learning += inProgress; mastered += volMastered;
      }
    } else {
      const pv = previewVolumes(series);
      for (let i = 0; i < pv.length; i++) {
        volumes.push({
          no: pv[i].no, label: pv[i].label, name: pv[i].name, id: '',
          cards: pv[i].cards, fresh: pv[i].cards, due: 0, learning: 0,
          mastered: 0, pct: 0, status: 'locked'
        });
        total += pv[i].cards; fresh += pv[i].cards;
      }
    }

    const pct = total ? Math.round(mastered / total * 100) : 0;
    const newLeft = Math.max(0, Math.min(Math.max(0, cap - newToday), fresh));
    const planned = newLeft + due;
    let secSum = 0, revSum = 0;
    const stats = state.stats || [];
    for (let i = 0; i < stats.length; i++) {
      const r = stats[i].reviews || 0;
      if (r > 0) { secSum += (stats[i].timeMs || 0) / 1000; revSum += r; }
    }
    const avgSec = revSum > 0 ? FC.clamp(secSum / revSum, 6, 30) : 12;
    const minutes = Math.round(planned * avgSec / 60);

    let next = null;
    for (let i = 0; i < volumes.length; i++) {
      if (volumes[i].status !== 'mastered') { next = volumes[i]; break; }
    }
    let advice;
    if (!loaded) {
      advice = { icon: 'download', tone: 'brand', title: '导入词库卡片',
        desc: '请选择 decks / ' + (series.file || '对应 .srcd') + '（' + (series.volCount || 0) + ' 分册 · ' + (series.cardCount || 0) + ' 卡）。',
        cta: '导入卡片', act: 'series-import', sid: series.id };
    } else if (total === 0) {
      advice = { icon: 'info', tone: 'brand', title: '系列暂时没有卡片',
        desc: '可到「词书」页为这些分册添加卡片。', cta: '前往词书', act: 'tab', tab: 1 };
    } else if (planned === 0) {
      advice = { icon: 'checkCircle', tone: 'green', title: '今日任务已完成',
        desc: '已掌握 ' + mastered + ' / ' + total + ' 张（' + pct + '%）。',
        cta: '自定义学习', act: 'custom-study' };
    } else if (due > 0 && newLeft === 0) {
      advice = { icon: 'rotate', tone: 'amber', title: '有 ' + due + ' 张卡到期复习',
        desc: '预计约 ' + minutes + ' 分钟。', cta: '开始复习', act: 'series-study', sid: series.id };
    } else {
      advice = { icon: 'layers', tone: 'brand',
        title: (next ? ('从 ' + next.label + ' 继续') : '继续学习本系列'),
        desc: '待学 ' + planned + ' 张（新 ' + newLeft + ' · 复习 ' + due + '），已掌握 ' + pct + '%，约 ' + minutes + ' 分钟。',
        cta: planned > 0 ? '开始学习' : '查看分册', act: 'series-study', sid: series.id };
    }

    return {
      loaded: loaded, volumes: volumes, total: total, fresh: fresh, due: due,
      learning: learning, mastered: mastered, pct: pct, newLeft: newLeft,
      planned: planned, minutes: minutes, advice: advice, next: next
    };
  }

  FC.SERIES = SERIES;
  FC.seriesById = seriesById;
  FC.seriesDecksOf = decksOf;
  FC.seriesIsLoaded = isLoaded;
  FC.seriesIsRemoved = isRemoved;
  FC.visibleSeries = visible;
  FC.removedSeries = removed;
  FC.seriesPreviewVolumes = previewVolumes;
  FC.seriesOverview = overview;
  // 动态系列 API
  FC.registerSeries = registerSeries;
  FC.tagSeriesDecks = tagSeriesDecks;
  FC.updateSeriesMeta = updateSeriesMeta;
  FC.ensureSeriesForLegacy = ensureSeriesForLegacy;
  global.FC = FC;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


/* ===== js/zip.js ===== */
/**
 * 闪星卡（StarCard）· ZIP / DEFLATE 解压（纯前端，零外部依赖）
 *
 * 用途：直接读取 Anki 导出的 .apkg / .colpkg（本质是 ZIP 包），
 * 取出里面的 collection.anki2 / collection.anki21（SQLite）与媒体文件。
 * 支持 stored(0) 与 deflate(8, raw) 两种方式，含 fixed / dynamic Huffman。
 * 之所以自己实现而不引入 JS 库，是为了保持「单文件、双击即用、无外链」。
 */
(function (global) {
  'use strict';

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /** 解压 raw DEFLATE（ZIP 内使用的格式），返回 Uint8Array */
  function inflateRaw(input) {
    const src = input instanceof Uint8Array ? input : new Uint8Array(input);
    let pos = 0, bb = 0, bc = 0;

    function bits(n) {
      while (bc < n) {
        if (pos >= src.length) throw new Error('DEFLATE 数据意外结束');
        bb |= src[pos++] << bc;
        bc += 8;
      }
      const v = bb & ((1 << n) - 1);
      bb >>>= n;
      bc -= n;
      return v;
    }
    function alignByte() {
      pos -= Math.floor(bc / 8);
      bb = 0; bc = 0;
    }

    // canonical Huffman：按码长分桶，桶内用对象按码值 O(1) 查找
    function makeTree(lengths) {
      const max = 15;
      const count = new Int32Array(max + 1);
      for (let i = 0; i < lengths.length; i++) {
        const l = lengths[i] | 0;
        if (l > max) throw new Error('DEFLATE 码长非法');
        count[l]++;
      }
      count[0] = 0;
      const first = new Int32Array(max + 1);
      let code = 0;
      for (let i = 1; i <= max; i++) {
        code = (code + count[i - 1]) << 1;
        first[i] = code;
      }
      const buckets = [];
      for (let i = 0; i <= max; i++) buckets.push(Object.create(null));
      for (let sym = 0; sym < lengths.length; sym++) {
        const l = lengths[sym];
        if (l) buckets[l][first[l]++] = sym;
      }
      return buckets;
    }
    function decode(tree) {
      let code = 0;
      for (let len = 1; len <= 15; len++) {
        code = (code << 1) | bits(1);
        const hit = tree[len][code];
        if (hit !== undefined) return hit;
      }
      throw new Error('DEFLATE 无效 Huffman 编码');
    }

    let out = new Uint8Array(Math.max(1024, src.length * 3));
    let outLen = 0;
    function put(b) {
      if (outLen >= out.length) {
        const bigger = new Uint8Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[outLen++] = b;
    }
    function copyBack(dist, len) {
      if (dist > outLen) throw new Error('DEFLATE 回溯距离超出范围');
      for (let i = 0; i < len; i++) put(out[outLen - dist]);
    }

    const fixedLit = makeTree((function () {
      const a = new Uint8Array(288);
      for (let i = 0; i <= 143; i++) a[i] = 8;
      for (let i = 144; i <= 255; i++) a[i] = 9;
      for (let i = 256; i <= 279; i++) a[i] = 7;
      for (let i = 280; i <= 287; i++) a[i] = 8;
      return a;
    })());
    const fixedDist = makeTree((function () {
      const a = new Uint8Array(32);
      for (let i = 0; i < 32; i++) a[i] = 5;
      return a;
    })());

    let distTree = fixedDist;
    let last = false;
    while (!last) {
      last = bits(1) === 1;
      const type = bits(2);

      if (type === 0) {
        alignByte();
        if (pos + 4 > src.length) throw new Error('DEFLATE 存储块损坏');
        const len = src[pos] | (src[pos + 1] << 8);
        const nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('DEFLATE 存储块长度校验失败');
        for (let i = 0; i < len; i++) {
          if (pos >= src.length) throw new Error('DEFLATE 数据意外结束');
          put(src[pos++]);
        }
      } else if (type === 1 || type === 2) {
        let litTree = fixedLit;
        distTree = fixedDist;
        if (type === 2) {
          const hlit = bits(5) + 257;
          const hdist = bits(5) + 1;
          const hclen = bits(4) + 4;
          const clen = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clen[CL_ORDER[i]] = bits(3);
          const clTree = makeTree(clen);
          const lens = new Uint8Array(hlit + hdist);
          let idx = 0;
          while (idx < lens.length) {
            const s = decode(clTree);
            if (s < 16) {
              lens[idx++] = s;
            } else if (s === 16) {
              if (idx === 0) throw new Error('DEFLATE 重复码长非法');
              const prev = lens[idx - 1], r = bits(2) + 3;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = prev;
            } else if (s === 17) {
              const r = bits(3) + 3;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = 0;
            } else {
              const r = bits(7) + 11;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = 0;
            }
          }
          litTree = makeTree(lens.subarray(0, hlit));
          distTree = makeTree(lens.subarray(hlit, hlit + hdist));
        }
        for (;;) {
          const sym = decode(litTree);
          if (sym === 256) break;
          if (sym < 256) { put(sym); continue; }
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error('DEFLATE 长度符号非法');
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const ds = decode(distTree);
          if (ds >= DIST_BASE.length) throw new Error('DEFLATE 距离符号非法');
          const dist = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          copyBack(dist, len);
        }
      } else {
        throw new Error('DEFLATE 保留块类型非法');
      }
    }
    return out.subarray(0, outLen);
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* 回退 */ }
    }
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); continue; }
      let cp, n;
      if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
      else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
      else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
      else { out += '\ufffd'; continue; }
      for (let j = 1; j <= n && i + j < bytes.length; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
      i += n;
      out += String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    }
    return out;
  }

  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    if (typeof btoa === 'function') return btoa(bin);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bin.length; i += 3) {
      const a = bin.charCodeAt(i), b = i + 1 < bin.length ? bin.charCodeAt(i + 1) : -1, c = i + 2 < bin.length ? bin.charCodeAt(i + 2) : -1;
      out += chars[a >> 2] + chars[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)] + (b < 0 ? '=' : chars[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)]) + (c < 0 ? '=' : chars[c & 63]);
    }
    return out;
  }

  function isZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  /** 解包。返回 { entries: { 文件名: Uint8Array }, names: string[] } */
  function unzip(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (u8.length < 22) throw new Error('文件太小，不是有效的 .apkg / ZIP');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const min = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('找不到 ZIP 结束标记，文件可能不是 .apkg');

    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = Object.create(null);

    for (let i = 0; i < total; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
        throw new Error('ZIP 中央目录损坏');
      }
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = utf8Decode(u8.subarray(p + 46, p + 46 + nameLen));

      if (localOff + 30 > u8.length || dv.getUint32(localOff, true) !== 0x04034b50) {
        throw new Error('ZIP 本地文件头损坏：' + name);
      }
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) {
        data = comp;
      } else if (method === 8) {
        data = inflateRaw(comp);
      } else {
        throw new Error('不支持的 ZIP 压缩方式（' + method + '）：' + name);
      }
      if (uncompSize && data.length !== uncompSize) {
        throw new Error('ZIP 解压大小不符：' + name);
      }
      entries[name] = data;
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries, names: Object.keys(entries) };
  }

  const API = { inflateRaw: inflateRaw, unzip: unzip, isZip: isZip, utf8Decode: utf8Decode, toBase64: toBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCZip = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


/* ===== js/sqlite.js ===== */
/**
 * 闪星卡（StarCard）· 精简 SQLite 只读解析器（纯前端，零外部依赖）
 *
 * 只实现读取 .apkg 内 collection.anki2 / anki21 所需的部分：
 *   - 文件头 / 页大小 / 文本编码
 *   - Table B-Tree（leaf 0x0D / interior 0x05）遍历
 *   - 记录的 varint / serial type 解码（含整型、浮点、文本、BLOB）
 *   - Overflow 页链（Anki 的长字段 / 模板 JSON 会用到）
 *   - sqlite_master 解析表结构
 *
 * 不做写入、索引、表达式、WAL —— 这些对读取 Anki 导出包不是必需的。
 */
(function (global) {
  'use strict';

  function open(bytes) { return new SQLite(bytes); }

  function SQLite(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    if (this.b.length < 100) throw new Error('SQLite 文件过小');
    let sig = '';
    for (let i = 0; i < 15; i++) sig += String.fromCharCode(this.b[i]);
    if (sig !== 'SQLite format 3') throw new Error('不是 SQLite 数据库（collection.anki2 损坏）');
    let ps = this.dv.getUint16(16);
    if (ps === 1) ps = 65536;
    if (!ps || ps < 512 || (ps & (ps - 1)) !== 0) throw new Error('SQLite 页大小非法：' + ps);
    this.pageSize = ps;
    this.reserved = this.b[20] || 0;
    this.usable = ps - this.reserved;
    const enc = this.dv.getUint32(56);
    this.enc = enc === 2 ? 'utf-16le' : (enc === 3 ? 'utf-16be' : 'utf-8');
    this._master = null;
  }

  /** 从指定字节数组读取 SQLite varint，返回 [值, 占用字节数] */
  SQLite.prototype.varintAt = function (bytes, off) {
    let n = 0;
    for (let i = 0; i < 8; i++) {
      if (off + i >= bytes.length) throw new Error('SQLite varint 越界');
      const v = bytes[off + i];
      n = n * 128 + (v & 0x7f);
      if ((v & 0x80) === 0) return [n, i + 1];
    }
    n = n * 256 + bytes[off + 8];
    return [n, 9];
  };
  /** 从整库字节流读取 varint */
  SQLite.prototype.varint = function (off) { return this.varintAt(this.b, off); };

  SQLite.prototype.text = function (bytes) {
    if (this.enc === 'utf-8') {
      if (typeof TextDecoder !== 'undefined') {
        try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* 走手动回退 */ }
      }
      // 手动 UTF-8 解码（部分老浏览器 / 沙箱没有 TextDecoder）
      let s = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80) { s += String.fromCharCode(b); continue; }
        let cp, n;
        if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
        else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
        else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
        else { s += '\ufffd'; continue; }
        for (let j = 1; j <= n && i + j < bytes.length; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
        i += n;
        s += String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      }
      return s;
    }
    const le = this.enc === 'utf-16le';
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(dv.getUint16(i, le));
    return s;
  };

  /** 取完整 payload（自动跟随 overflow 页链） */
  SQLite.prototype.payload = function (cellPayloadPos, payloadLen) {
    const usable = this.usable;
    const maxLocal = usable - 35;
    const minLocal = Math.floor((usable - 12) * 32 / 255) - 23;
    let local = payloadLen;
    if (payloadLen > maxLocal) {
      const surplus = minLocal + ((payloadLen - minLocal) % (usable - 4));
      local = surplus <= maxLocal ? surplus : minLocal;
    }
    const out = new Uint8Array(payloadLen);
    if (this.b.length < cellPayloadPos + local) throw new Error('SQLite 记录内容越界');
    out.set(this.b.subarray(cellPayloadPos, cellPayloadPos + local), 0);
    let got = local;
    if (local < payloadLen) {
      let next = this.dv.getUint32(cellPayloadPos + local, false);
      const seen = Object.create(null);
      while (next && got < payloadLen) {
        if (seen[next]) throw new Error('SQLite overflow 页链出现循环');
        seen[next] = 1;
        const off = (next - 1) * this.pageSize;
        if (off + 4 > this.b.length) throw new Error('SQLite overflow 页越界');
        const take = Math.min(usable - 4, payloadLen - got);
        out.set(this.b.subarray(off + 4, off + 4 + take), got);
        got += take;
        next = this.dv.getUint32(off, false);
      }
    }
    return out;
  };

  /** 解析一条记录：返回按列顺序排列的值数组 */
  SQLite.prototype.record = function (payload) {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const hdr = this.varintAt(payload, 0);
    const headerSize = hdr[0];
    if (headerSize > payload.length) throw new Error('SQLite 记录头越界');
    const types = [];
    let p = hdr[1];
    while (p < headerSize) {
      const v = this.varintAt(payload, p);
      types.push(v[0]);
      p += v[1];
    }
    const vals = [];
    let d = headerSize;
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      let v = null;
      if (t === 0) {
        v = null;
      } else if (t >= 1 && t <= 6) {
        const len = [0, 1, 2, 3, 4, 6, 8][t];
        if (d + len > payload.length) throw new Error('SQLite 整型列越界');
        if (t === 1) v = dv.getInt8(d);
        else if (t === 2) v = dv.getInt16(d);
        else if (t === 3) v = (dv.getInt16(d) << 8) | payload[d + 2];
        else if (t === 4) v = dv.getInt32(d);
        else if (t === 5) {
          // 6 字节：高 2 字节有符号，低 4 字节无符号
          const hi = dv.getInt16(d), lo = dv.getUint32(d + 2);
          v = hi * 4294967296 + lo;
        } else {
          // 8 字节：高 4 字节有符号，低 4 字节无符号
          const hi = dv.getInt32(d), lo = dv.getUint32(d + 4);
          v = hi * 4294967296 + lo;
        }
        d += len;
      } else if (t === 7) {
        if (d + 8 > payload.length) throw new Error('SQLite 浮点列越界');
        v = dv.getFloat64(d); d += 8;
      } else if (t === 8) {
        v = 0;
      } else if (t === 9) {
        v = 1;
      } else if (t === 10 || t === 11) {
        v = null;
      } else if ((t & 1) === 0) {
        const len = (t - 12) / 2;
        if (d + len > payload.length) throw new Error('SQLite BLOB 列越界');
        v = payload.subarray(d, d + len); d += len;
      } else {
        const len = (t - 13) / 2;
        if (d + len > payload.length) throw new Error('SQLite 文本列越界');
        v = this.text(payload.subarray(d, d + len)); d += len;
      }
      vals.push(v);
    }
    return vals;
  };

  /** 直接遍历某个 B-Tree 根页，按给定列名产出对象数组 */
  SQLite.prototype._rawRows = function (rootPage, cols, sql) {
    const self = this;
    const rows = [];
    const visited = Object.create(null);
    if (!rootPage) return rows;

    function isPk(col) {
      if (!sql) return col === 'id';
      const c = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 允许 NOT NULL / UNSIGNED 等修饰词夹在 INTEGER 与 PRIMARY KEY 之间：
      // Anki 新版 notetypes 表写作 `id integer NOT NULL PRIMARY KEY`。
      const re = new RegExp('["`\\[]?' + c + '["`\\]]?\\s+INTEGER\\b[\\s\\S]{0,40}?PRIMARY\\s+KEY', 'i');
      return re.test(sql) || (col === 'id' && /\bid\b[\s\S]{0,80}INTEGER\s+PRIMARY\s+KEY/i.test(sql));
    }
    // WITHOUT ROWID 表的 cell 里没有 rowid varint，payload 紧跟在 payloadLen 之后。
    // Anki 新版 schema 的 fields / templates 表就是 WITHOUT ROWID；若误读会整体错位一列。
    const withoutRowid = !!sql && /WITHOUT\s+ROWID/i.test(sql);

    /** 计算一条 cell 里 record 的起始位置与 rowid。对 WITHOUT ROWID 做特殊处理。 */
    function cellRowidAndPayloadOff(cell, pl) {
      if (withoutRowid) {
        // 无 rowid：payload 从 pl 字节后直接开始；rowid 取主键首列（解析后回填）
        return { rowid: null, payloadOff: cell + pl[1] };
      }
      const rl = self.varint(cell + pl[1]);
      return { rowid: rl[0], payloadOff: cell + pl[1] + rl[1] };
    }

    function walk(pgno) {
      if (pgno <= 0 || visited[pgno]) return;
      visited[pgno] = 1;
      const off = (pgno - 1) * self.pageSize;
      if (off + 12 > self.b.length) throw new Error('SQLite 页越界：' + pgno);
      const base = off + (pgno === 1 ? 100 : 0);
      if (base + 12 > self.b.length) throw new Error('SQLite 页头越界：' + pgno);
      const type = self.b[base];
      const n = self.dv.getUint16(base + 3);
      const interior = (type === 0x05 || type === 0x02);
      const ptrBase = base + (interior ? 12 : 8);

      if (interior) {
        for (let i = 0; i < n; i++) {
          const cp = self.dv.getUint16(ptrBase + i * 2);
          walk(self.dv.getUint32(off + cp, false));
        }
        walk(self.dv.getUint32(base + 8, false));
        return;
      }
      if (type !== 0x0d && type !== 0x0a) return;

      for (let i = 0; i < n; i++) {
        const cp = self.dv.getUint16(ptrBase + i * 2);
        const cell = off + cp;
        const pl = self.varint(cell);
        const rp = cellRowidAndPayloadOff(cell, pl);
        let rowid = rp.rowid;
        const payload = self.payload(rp.payloadOff, pl[0]);
        const vals = self.record(payload);
        const row = Object.create(null);
        for (let c = 0; c < cols.length; c++) {
          let v = (c < vals.length ? vals[c] : null);
          // WITHOUT ROWID 表：主键首列（INTEGER PRIMARY KEY）用 record 里的实际值；
          // 普通表：id 为 rowid 别名时若 record 里是 null 则用 rowid 回填。
          if (withoutRowid) {
            if (isPk(cols[c]) && rowid === null) rowid = v;
          } else if (v === null && isPk(cols[c])) {
            v = rowid;
          }
          row[cols[c]] = v;
        }
        row.__rowid = rowid;
        rows.push(row);
      }
    }

    walk(rootPage);
    return rows;
  };

  /** 从 CREATE TABLE 语句里提取列名（忽略括号/引号内的逗号） */
  function parseColumns(sql) {
    if (!sql) return [];
    const open = sql.indexOf('(');
    const close = sql.lastIndexOf(')');
    if (open < 0 || close <= open) return [];
    // 去掉 SQL 注释：Anki 导出的表结构常在列后带 /* 0 */ 之类注释，
    // 不剥离会让注释吞掉后面的列名，最终只解析出第一列。
    const body = sql.substring(open + 1, close)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    const parts = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (quote) {
        if (c === quote && body[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) { parts.push(body.substring(start, i)); start = i + 1; }
    }
    parts.push(body.substring(start));
    const cols = [];
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim();
      if (!t || /^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)\b/i.test(t)) continue;
      const m = t.match(/^["'`\[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/);
      if (m) cols.push(m[1]);
    }
    return cols;
  }

  /** 解析 sqlite_master */
  SQLite.prototype.tables = function () {
    if (this._master) return this._master;
    const rows = this._rawRows(1, ['type', 'name', 'tbl_name', 'rootpage', 'sql']);
    this._master = rows.map(function (r) {
      return {
        type: r.type || '', name: r.name || '', tblName: r.tbl_name || '',
        rootpage: Number(r.rootpage) || 0, sql: r.sql || ''
      };
    });
    return this._master;
  };

  /** 按表名读取所有行 */
  SQLite.prototype.rows = function (name) {
    const meta = null;
    const all = this.tables();
    let found = null;
    for (let i = 0; i < all.length; i++) {
      if (all[i].type === 'table' && all[i].name === name) { found = all[i]; break; }
    }
    if (!found || !found.rootpage) return [];
    return this._rawRows(found.rootpage, parseColumns(found.sql), found.sql);
  };

  SQLite.prototype.tableNames = function () {
    return this.tables().filter(function (t) { return t.type === 'table'; }).map(function (t) { return t.name; });
  };

  const API = { open: open, SQLite: SQLite, parseColumns: parseColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCSqlite = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


/* ===== js/apkg.js ===== */
/**
 * 闪星卡（StarCard）· Anki .apkg / .colpkg 解析器（纯前端）
 *
 * 流程：ZIP 解包 → 找到 collection.anki2 / anki21 → 精简 SQLite 读取
 *       notes / cards / models / decks / col → 映射成 StarCard 牌组结构。
 * 映射策略：
 *   - 标准笔记按模板（qfmt/afmt）渲染正反面；含 Back 模板且 ord=1 的识别为反向卡
 *   - Cloze 笔记直接沿用 {{c1::答案}} 语法（StarCard 原生支持）
 *   - 标签 / 标记 / 暂停 / 搁置 / Leech / 复习次数与到期时间一并迁移
 *   - 媒体从 media JSON + 数字文件读出，转成内联 base64 并只挂在引用到它的卡片上
 */
(function (global) {
  'use strict';

  const Zip = global.BCZip || (typeof require !== 'undefined' ? require('./zip.js') : null);
  const Sqlite = global.BCSqlite || (typeof require !== 'undefined' ? require('./sqlite.js') : null);
  const FC = global.FC || (typeof require !== 'undefined' ? require('./core.js') : null);

  function parseJson(text, fallback) {
    try {
      const v = JSON.parse(text);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }

  function decodeEntities(s) {
    return String(s == null ? '' : s)
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&').replace(/&#x([0-9a-f]+);/gi, function (a, h) {
        try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return a; }
      })
      .replace(/&#(\d+);/g, function (a, d) {
        try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return a; }
      });
  }

  /** 把 Anki 字段 HTML 转成 StarCard renderRich 能安全渲染的轻量标记 */
  function htmlToText(html) {
    let s = String(html == null ? '' : html);
    s = s.replace(/<br\s*\/?\s*>/gi, '\n');
    s = s.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (all, src) {
      return '![](media:' + decodeEntities(src) + ')';
    });
    s = s.replace(/\[sound:([^\]]+)\]/gi, '[sound:$1]');
    s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '$2');
    s = s.replace(/<li\b[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '');
    s = s.replace(/<(div|p|tr|h[1-6]|section)\b[^>]*>/gi, '\n').replace(/<\/(div|p|tr|h[1-6]|section)>/gi, '\n');
    s = s.replace(/<hr\b[^>]*>/gi, '\n');
    s = s.replace(/<[^>]*>/g, '');
    s = decodeEntities(s);
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.replace(/^[ \t]+|[ \t]+$/gm, '');
  }

  function mimeOf(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
      txt: 'text/plain', json: 'application/json', pdf: 'application/pdf'
    };
    return map[ext] || 'application/octet-stream';
  }

  function splitFields(flds) {
    return String(flds == null ? '' : flds).split('\x1f');
  }

  function splitTags(tags) {
    return String(tags == null ? '' : tags).trim().split(/\s+/).filter(function (t) { return t !== ''; });
  }

  // 内置填空渲染，避免依赖 anki.js 的加载顺序（apkg.js 也可单独使用）
  const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/g;
  function clozeNums(text) {
    const nums = [], seen = Object.create(null);
    let m;
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(String(text || ''))) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && !seen[n]) { seen[n] = 1; nums.push(n); }
    }
    nums.sort(function (a, b) { return a - b; });
    return nums;
  }
  function renderClozeLocal(text, num, reveal) {
    return String(text || '').replace(CLOZE_RE, function (all, n, answer, hint) {
      return reveal ? answer : (hint ? '[' + hint + ']' : '[...]');
    });
  }

  /** 把 Anki 模型字段映射到 StarCard 的 Front / Back / Extra / Source */
  function mapFields(model, values) {
    const defs = (model && Array.isArray(model.flds)) ? model.flds : [];
    const raw = {};
    const lower = {};
    for (let i = 0; i < defs.length; i++) {
      const name = defs[i].name || ('Field' + (i + 1));
      const val = htmlToText(values[i]);
      raw[name] = val;
      lower[name.toLowerCase()] = val;
    }
    function pick() {
      for (let i = 0; i < arguments.length; i++) {
        const k = String(arguments[i]).toLowerCase();
        if (lower[k] !== undefined && lower[k] !== '') return lower[k];
      }
      return '';
    }
    const names = defs.map(function (d) { return String(d.name || '').toLowerCase(); });
    let Front = pick('Front', '正面', 'Question', '问题', 'Word', 'Term', 'Expression', 'Prompts', 'Front Side');
    let Back = pick('Back', '背面', 'Answer', '答案', 'Meaning', 'Definition', 'Translation', 'Definition & Example', 'Back Side');
    let Extra = pick('Extra', '补充', 'Notes', 'Note', '备注', 'Example', '例句', 'Sentence', 'Comments');
    let Source = pick('Source', '来源', 'Source Sentence', 'Reference');
    if (!Front && defs.length) Front = raw[defs[0].name] || '';
    if (!Back && defs.length > 1) Back = raw[defs[1].name] || '';
    if (!Extra && defs.length > 2) Extra = raw[defs[2].name] || '';
    if (!Source && defs.length > 3) Source = raw[defs[3].name] || '';

    let clozeText = '';
    for (let i = 0; i < defs.length; i++) {
      const v = raw[defs[i].name] || '';
      if (/\{\{c\d+::/.test(v)) { clozeText = v; break; }
    }
    if (!clozeText && defs.length) clozeText = raw[defs[0].name] || '';
    return { raw: raw, names: names, fields: { Front: Front, Back: Back, Extra: Extra, Source: Source }, clozeText: clozeText };
  }

  /** 用模板渲染 Anki 卡片正反面 */
  function renderTemplate(tpl, fields) {
    const qRaw = String((tpl && tpl.qfmt) || '');
    const aRaw = String((tpl && tpl.afmt) || '');
    function conditions(s) {
      return s
        .replace(/\{\{#([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (all, key, body) {
          return (fields[key] || '').trim() ? body : '';
        })
        .replace(/\{\{\^([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (all, key, body) {
          return (fields[key] || '').trim() ? '' : body;
        });
    }
    function fill(s, frontSide) {
      return s.replace(/\{\{([^{}]+)\}\}/g, function (all, expr0) {
        const expr = String(expr0).trim();
        if (/^FrontSide$/i.test(expr)) return frontSide || '';
        if (/^(Tags|Deck|Subdeck|Card|Type|c\d+)$/i.test(expr)) return '';
        const mc = expr.match(/^(cloze|text):\s*(.+)$/i);
        const key = mc ? mc[2].trim() : expr;
        return fields[key] !== undefined ? fields[key] : '';
      });
    }
    const qRendered = fill(conditions(qRaw), '');
    const aRendered = fill(conditions(aRaw), qRendered);
    return { front: htmlToText(qRendered), back: htmlToText(aRendered) };
  }

  /** Anki 调度信息 → StarCard 调度字段（fsrs 为 cards.data 里解析出的真实 FSRS 参数） */
  function mapScheduling(card, crtSec, fsrs) {
    const q = Number(card.queue);
    const reps = Math.max(0, Math.round(Number(card.reps) || 0));
    const lapses = Math.max(0, Math.round(Number(card.lapses) || 0));
    const ivl = Math.max(0, Math.round(Number(card.ivl) || 0));
    const now = Date.now();
    const baseMs = (Number(crtSec) > 0 ? Number(crtSec) * 1000 : now);
    let state = FC ? FC.STATE_NEW : 'new';
    let due = '';

    if (q === -1 || q === -2 || q === -3) {
      state = reps === 0 ? (FC ? FC.STATE_NEW : 'new') : (ivl >= 1 ? (FC ? FC.STATE_REVIEW : 'review') : (FC ? FC.STATE_LEARNING : 'learning'));
    } else if (q === 0 || reps === 0) {
      state = FC ? FC.STATE_NEW : 'new';
    } else if (q === 2) {
      state = FC ? FC.STATE_REVIEW : 'review';
      const day = Number(card.due) || 0;
      // Anki 2.1 复习卡的 due 是「自 Unix epoch 起的天数」，不是相对牌组的偏移；
      // 极少数旧数据可能存的是相对 col.crt 的小天数，早于 2000 年时按相对值兜底。
      let ms = day * 86400000;
      if (ms < 946684800000) ms = baseMs + day * 86400000;
      due = new Date(ms).toISOString();
    } else {
      state = q === 3 ? (FC ? FC.STATE_RELEARNING : 'relearning') : (FC ? FC.STATE_LEARNING : 'learning');
      const dm = Number(card.due) || 0;
      // 学习中 due 可能是「绝对分钟时间戳」或「绝对秒时间戳」，也可能是相对分钟偏移。
      // 用合理年份区间（2000–2100）区分，避免把 2960 万分钟误算到 2083 年。
      const minMs = dm * 60000, secMs = dm * 1000;
      const sane = function (ms) { return ms > 946684800000 && ms < 4102444800000; };
      const dueMs = sane(minMs) ? minMs : (sane(secMs) ? secMs : now + (dm > 0 ? dm * 60000 : 0));
      due = new Date(dueMs).toISOString();
    }

    const factor = Number(card.factor) || 2500;
    let difficulty = Math.max(1, Math.min(10, 10 - (factor - 1300) / 170));
    let stability = ivl >= 1 ? Math.min(36500, ivl) : 0.001;
    // 新版 Anki（FSRS）把真实排程参数写在 cards.data 的 {s,d,...} 里，
    // factor 此时常为 0，必须优先采用，否则难度/稳定性全错。
    if (fsrs) {
      difficulty = fsrs.difficulty;
      stability = fsrs.stability;
    }
    return {
      state: state, due: due,
      difficulty: Math.round(difficulty * 100) / 100,
      stability: Math.round(stability * 1000) / 1000, reps: reps, lapses: lapses,
      scheduledDays: ivl,
      suspended: q === -1,
      buried: q === -2 || q === -3,
      leeched: lapses >= 8
    };
  }

  function findDbEntry(entries, names) {
    for (let i = 0; i < names.length; i++) if (entries[names[i]]) return names[i];
    for (let i = 0; i < names.length; i++) {
      for (const n in entries) {
        if (new RegExp('\\.' + names[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(n)) return n;
      }
    }
    return null;
  }

  // ---- Anki 新版 schema（ver 18+，"FSRS" 数据库）支持 --------------------
  // 新版把牌组 / 笔记类型从 col.decks / col.models 的 JSON 迁到了独立表：
  //   decks(notetypes/fields/templates) 表的 config 列是 protobuf BLOB。
  // 这里不写完整 protobuf 解析器，只做两件可靠的事：
  //   1) 明文列名（name）直接用；
  //   2) 从 BLOB 里提取连续可打印 ASCII 串，从中认出模板 qfmt/afmt 里的 {{字段}} 与 <hr id=answer>。
  // 对外产出与老版 col.models 相同形状的对象，让后续渲染逻辑无需改动。

  /** 把 Uint8Array / Array / string 的 protobuf BLOB 提取成可打印文本片段 */
  function blobTexts(v) {
    let s = '';
    if (v instanceof Uint8Array || Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const b = v[i];
        s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '\n';
      }
    } else if (v != null) {
      s = String(v);
    }
    return s.split(/[\n\r]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
  }

  /** 去掉 protobuf 长度前缀噪声：模板文本开头的孤立标点（% # ) 等） */
  function cleanTpl(s) {
    return String(s || '').replace(/^[\s%#)@&\d]{1,4}(?=(\{\{|<|[A-Za-z\u4e00-\u9fff]))/, '');
  }

  /** 从模板 config BLOB 的文本片段里拼出 qfmt / afmt（Anki 新版） */
  function templateFromBlob(config) {
    const parts = blobTexts(config);
    let qfmt = '', afmt = '';
    for (let i = 0; i < parts.length; i++) {
      const p = cleanTpl(parts[i]);
      // qfmt 段：含 {{字段}} 且不含 FrontSide / <hr ... answer
      if (!qfmt && /\{\{/.test(p) && !/FrontSide/i.test(p)) qfmt = p;
      // afmt 段：含 FrontSide 或 answer 分隔符
      if (!afmt && (/FrontSide/i.test(p) || /hr[^>]*id\s*=\s*answer/i.test(p))) afmt = p;
    }
    if (!afmt && qfmt) afmt = '{{FrontSide}}<hr id="answer">{{Back}}';
    return { qfmt: qfmt, afmt: afmt };
  }

  /**
   * 当 col.models 为空（新版库）时，从 notetypes + fields + templates 表重建 models。
   * 返回与老版 col.models 同形状：{ [id]: { id, name, type, flds:[{name}], tmpls:[{name,qfmt,afmt}] } }
   */
  function rebuildModelsFromTables(rows) {
    const nt = rows('notetypes') || [];
    const flds = rows('fields') || [];
    const tmpls = rows('templates') || [];
    if (!nt.length) return null;
    const models = Object.create(null);
    nt.forEach(function (m) {
      const id = String(m.id);
      models[id] = { id: m.id, name: String(m.name || ''), type: 0, flds: [], tmpls: [], css: '' };
    });
    flds.forEach(function (f) {
      const m = models[String(f.ntid)];
      if (m) m.flds[Math.max(0, Math.round(Number(f.ord) || 0))] = { name: String(f.name || '') };
    });
    tmpls.forEach(function (t) {
      const m = models[String(t.ntid)];
      if (!m) return;
      const tpl = templateFromBlob(t.config);
      m.tmpls[Math.max(0, Math.round(Number(t.ord) || 0))] = {
        name: String(t.name || ''), qfmt: tpl.qfmt, afmt: tpl.afmt
      };
    });
    Object.keys(models).forEach(function (k) {
      const m = models[k];
      // 去掉 flds/tmpls 因 ord 空洞产生的 undefined
      m.flds = (m.flds || []).filter(Boolean);
      m.tmpls = (m.tmpls || []).filter(Boolean);
      // cloze 判定：模板里含 {{cN:: 或类型名含 cloze
      if (/cloze/i.test(m.name) || m.tmpls.some(function (t) { return /\{\{c\d+::/.test(t.qfmt || ''); })) m.type = 1;
    });
    return models;
  }

  /** 解析 Anki 新版 cards.data 里的 FSRS 参数：{s, d, dr, decay, ...} */
  function parseFsrs(data) {
    if (!data) return null;
    const obj = parseJson(typeof data === 'string' ? data : '', null);
    if (!obj || obj.s === undefined || obj.d === undefined) return null;
    return { stability: Math.max(0, Number(obj.s) || 0), difficulty: Math.max(1, Number(obj.d) || 1) };
  }

  /** 把 Anki revlog 行转成 StarCard reviewLog 条目（按 cid 分组） */
  function buildReviewLogs(rows) {
    const map = Object.create(null);
    (rows('revlog') || []).forEach(function (r) {
      const key = String(r.cid);
      if (!map[key]) map[key] = [];
      const ivl = Number(r.ivl) || 0;
      map[key].push({
        rating: Math.max(1, Math.min(4, Math.round(Number(r.ease) || 3))),
        reviewedAt: new Date(Number(r.id) > 1e12 ? Number(r.id) : Date.now()).toISOString(),
        elapsedDays: Math.max(0, Math.round((Number(r.lastIvl) || 0) * (Number(r.lastIvl) < 0 ? -1 : 1))),
        scheduledDays: Math.max(0, Math.abs(Math.round(ivl))),
        state: ivl >= 1 ? 'review' : 'learning'
      });
    });
    return map;
  }

  /** 主解析入口：接受 ArrayBuffer / Uint8Array，返回 StarCard 可合并的牌组与统计 */
  function parse(input) {
    if (!Zip || !Sqlite || !FC) throw new Error('解析器依赖未加载');
    const zip = Zip.unzip(input);
    const dbName = findDbEntry(zip.entries, ['anki21b', 'anki21', 'anki2', 'anki']);
    if (!dbName) throw new Error('未在 .apkg 中找到 collection.anki2 / collection.anki21');

    // Anki 2.1.60+ 的 collection.anki21b 是 zstd 压缩的 SQLite，且媒体也是 zstd +
    // protobuf 映射。浏览器没有原生 zstd 解压，纯 JS 解 FSE/Huffman 风险高；若这个包
    // 仅含 anki21b（anki2 是 1 张卡的空壳），明确提示，避免误导入空壳或读乱码崩溃。
    const zstdBytes = zip.entries[dbName];
    const isZstd = zstdBytes && zstdBytes[0] === 0x28 && zstdBytes[1] === 0xb5 &&
      zstdBytes[2] === 0x2f && zstdBytes[3] === 0xfd;
    if (isZstd) {
      const legacy = zip.entries['collection.anki2'] || zip.entries['collection.anki'];
      let legacyCards = 0;
      try {
        const legacyDb = Sqlite.open(legacy);
        if (legacyDb.tableNames().indexOf('cards') >= 0) legacyCards = legacyDb.rows('cards').length;
      } catch (e) { /* 读不到就当空壳 */ }
      if (legacyCards <= 1) {
        // 结构化信号：让 UI 能弹出「一键载入」对话框，而不是把一大段说明塞进 toast。
        // SAT800 美音已随发布包提供为外置 .srcd（与网页同目录），可一步载入，无需用户手动找文件。
        const e = new Error('这是 Anki 新版（zstd 压缩）的词库，浏览器无法直接解析。');
        e.code = 'ZSTD_BUILTIN';
        e.deckFile = 'SAT800美音.srcd';
        e.deckName = 'SAT800 美音';
        throw e;
      }
      const e2 = new Error('这是 Anki 新版（zstd 压缩）的词库，浏览器暂不支持直接解析。');
      e2.code = 'ZSTD_UNSUPPORTED';
      throw e2;
    }

    const db = Sqlite.open(zip.entries[dbName]);
    const tables = db.tableNames();
    function rows(name) { return tables.indexOf(name) >= 0 ? db.rows(name) : []; }

    const colRow = rows('col')[0] || {};
    const colDecks = parseJson(colRow.decks, {});
    const colModels = parseJson(colRow.models, {});
    const crtSec = Number(colRow.crt) || 0;
    const colVer = Number(colRow.ver) || 0;

    // 牌组名：优先 col.decks，其次 decks 表（新版库 col.decks 为空，全靠 decks 表）
    const deckNames = {};
    const deckMeta = {};
    Object.keys(colDecks).forEach(function (k) {
      const d = colDecks[k] || {};
      if (d.name) deckNames[String(k)] = String(d.name);
      deckMeta[String(k)] = d;
    });
    rows('decks').forEach(function (d) {
      if (d.id !== undefined && d.name) {
        // Anki 新版牌组层级用 \x1f 分隔（如 TOEFL\x1f大组01\x1fList01），转成 :: 便于阅读
        deckNames[String(d.id)] = String(d.name).replace(/\x1f/g, '::');
        deckMeta[String(d.id)] = d;
      }
    });

    // 模型：优先 col.models，其次 models 表；两者都空时用新版 notetypes/fields/templates 表重建
    const models = {};
    Object.keys(colModels).forEach(function (k) { models[String(k)] = colModels[k] || {}; });
    rows('models').forEach(function (m) {
      const id = String(m.id);
      if (!models[id]) models[id] = m;
      else {
        if (!models[id].flds && m.flds) models[id].flds = parseJson(m.flds, []);
        if (!models[id].tmpls && m.tmpls) models[id].tmpls = parseJson(m.tmpls, []);
      }
    });
    if (!Object.keys(models).length) {
      const rebuilt = rebuildModelsFromTables(rows);
      if (rebuilt) Object.keys(rebuilt).forEach(function (k) { models[k] = rebuilt[k]; });
    }
    Object.keys(models).forEach(function (k) {
      const m = models[k];
      if (typeof m.flds === 'string') m.flds = parseJson(m.flds, []);
      if (typeof m.tmpls === 'string') m.tmpls = parseJson(m.tmpls, []);
      if (!Array.isArray(m.flds)) m.flds = [];
      if (!Array.isArray(m.tmpls)) m.tmpls = [];
    });

    // 媒体：media JSON 给出「编号 → 文件名」，ZIP 内同名数字条目为文件内容
    const mediaFile = zip.entries['media'] || zip.entries['collection.media'] || zip.entries['media.json'];
    const mediaIndex = mediaFile ? parseJson(Zip.utf8Decode(mediaFile), {}) : {};
    const mediaByName = Object.create(null);
    let mediaCount = 0;
    Object.keys(mediaIndex).forEach(function (key) {
      const fname = String(mediaIndex[key]);
      const file = zip.entries[key] || zip.entries[String(key)];
      if (!file || !fname) return;
      mediaByName[fname] = { name: fname, mime: mimeOf(fname), data: Zip.toBase64(file) };
      mediaCount++;
    });

    const noteById = Object.create(null);
    const noteRows = rows('notes');
    noteRows.forEach(function (n) { if (n.id !== undefined) noteById[String(n.id)] = n; });

    // 新版库把复习历史单独存在 revlog 表，按卡片 id 归并到各卡片的 reviewLog
    const reviewLogs = buildReviewLogs(rows);

    const deckById = Object.create(null);
    const deckList = [];
    function getDeck(id) {
      const key = String(id);
      if (deckById[key]) return deckById[key];
      let name = deckNames[key];
      const meta = deckMeta[key] || {};
      if (!name && meta.type === 1 && meta.odid) name = deckNames[String(meta.odid)] || '筛选牌组';
      if (!name) name = 'Anki 导入';
      const created = new Date().toISOString();
      const d = {
        id: FC.makeId(), name: String(name), description: '从 Anki .apkg 导入',
        createdAt: created, modifiedAt: created, tags: ['apkg'], cards: [],
        options: FC.defaultDeckOptions ? FC.defaultDeckOptions() : null
      };
      deckById[key] = d;
      deckList.push(d);
      return d;
    }

    const cardRows = rows('cards');
    const noteIds = Object.create(null);
    let skipped = 0;

    cardRows.forEach(function (ac) {
      const note = noteById[String(ac.nid)];
      if (!note) { skipped++; return; }
      const model = models[String(note.mid)] || { flds: [], tmpls: [] };
      const mapped = mapFields(model, splitFields(note.flds));
      if (!mapped.fields.Front && !mapped.fields.Back && !mapped.clozeText) { skipped++; return; }

      const isCloze = Number(model.type) === 1 || /\{\{c\d+::/.test(mapped.clozeText);
      const ord = Math.max(0, Math.round(Number(ac.ord) || 0));
      const tplList = model.tmpls || [];
      const tpl = tplList[ord] || tplList[0] || {};
      const rendered = isCloze ? { front: '', back: '' } : renderTemplate(tpl, mapped.raw);

      const card = FC.newCard(mapped.fields.Front, mapped.fields.Back, mapped.fields.Extra, splitTags(note.tags));
      // 同一笔记的多张卡共享 noteId，便于编辑器识别兄弟卡
      const nidKey = String(note.id || ac.nid);
      if (!noteIds[nidKey]) noteIds[nidKey] = 'anki_' + (note.guid || nidKey).toString().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) + '_' + nidKey.slice(-6);
      card.noteId = noteIds[nidKey];
      card.ord = ord;
      card.fields = mapped.fields;
      card.extra = mapped.fields.Extra;
      card.notetype = 'basic';

      if (isCloze) {
        card.notetype = 'cloze';
        card.cloze = mapped.clozeText;
        const nums = clozeNums(mapped.clozeText);
        const num = nums[ord] || nums[0] || 1;
        card.front = renderClozeLocal(mapped.clozeText, num, false);
        card.back = renderClozeLocal(mapped.clozeText, num, true);
      } else {
        card.front = rendered.front || mapped.fields.Front;
        card.back = rendered.back || mapped.fields.Back;
        if (tplList.length > 1 && (ord === 1 || /revers|反向/i.test(tpl.name || ''))) card.notetype = 'basic-reverse';
      }

      const sch = mapScheduling(ac, crtSec, parseFsrs(ac.data));
      card.state = sch.state;
      // lastReview 取该卡最近一次复习时间
      const myLog = reviewLogs[String(ac.id)] || [];
      const lastReview = myLog.length ? myLog[myLog.length - 1].reviewedAt : '';
      card.scheduling = {
        difficulty: sch.difficulty, stability: sch.stability, due: sch.due,
        lastReview: lastReview, reps: sch.reps, lapses: sch.lapses,
        elapsedDays: 0, scheduledDays: sch.scheduledDays, step: 0
      };
      card.reviewLog = myLog;
      card.flags = Math.max(0, Math.min(7, Math.round(Number(ac.flags) || 0)));
      card.suspended = sch.suspended;
      card.buried = sch.buried;
      card.leeched = sch.leeched;
      card.createdAt = new Date((Number(note.id) > 1e12 ? Number(note.id) : Date.now())).toISOString();
      card.modifiedAt = new Date((Number(ac.mod) > 1e12 ? Number(ac.mod) : Date.now())).toISOString();

      // 只挂上本卡片字段真正引用到的媒体，避免每张卡都复制整包
      const text = [card.front, card.back, card.extra, card.cloze,
        mapped.fields.Front, mapped.fields.Back, mapped.fields.Extra].join('\n');
      const used = Object.create(null);
      Object.keys(mediaByName).forEach(function (name) {
        if (text.indexOf(name) >= 0) used[name] = mediaByName[name];
      });
      card.media = Object.keys(used).map(function (k) { return used[k]; });

      getDeck(ac.did).cards.push(card);
    });

    return {
      format: 'apkg',
      collection: colVer ? ('Anki ' + colVer) : 'Anki',
      file: dbName,
      decks: deckList,
      stats: {
        decks: deckList.length,
        notes: noteRows.length,
        cards: deckList.reduce(function (a, d) { return a + d.cards.length; }, 0),
        skipped: skipped,
        media: mediaCount,
        reviews: (rows('revlog') || []).length,
        fsrs: (rows('cards') || []).filter(function (c) { return parseFsrs(c.data); }).length,
        models: Object.keys(models).map(function (k) { return models[k].name || ('模型 ' + k); })
      }
    };
  }

  const API = {
    parse: parse, htmlToText: htmlToText, mimeOf: mimeOf,
    mapScheduling: mapScheduling, decodeEntities: decodeEntities,
    rebuildModelsFromTables: rebuildModelsFromTables, templateFromBlob: templateFromBlob,
    blobTexts: blobTexts, parseFsrs: parseFsrs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCApkg = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


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

    // 连续打卡：今天有学从今天起算，否则从昨日起算
    const byDate = {};
    for (let i = 0; i < stats.length; i++) byDate[stats[i].date] = (stats[i].reviews || 0) > 0;
    const cursor = new Date(now); cursor.setHours(12, 0, 0, 0);
    if (!byDate[FC.dateKey(cursor.getTime())]) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (byDate[FC.dateKey(cursor.getTime())]) { streak++; cursor.setDate(cursor.getDate() - 1); }

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


/* ===== js/ui.js ===== */
/**
 * 闪星卡（StarCard）UI 渲染层 · 返回 HTML 字符串
 * 仅依赖 window.FC，不依赖 app.js（动作由 app.js 的事件委托处理）。
 * 图标：全部为内联 SVG 线性图标，无表情符号。
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  const A = global.ArkUI;

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------- 图标库
  const IC = {
    cards: '<rect x="3" y="7" width="13" height="14" rx="3"/><path d="M7.5 7V4.8A2.8 2.8 0 0 1 10.3 2h7.9A2.8 2.8 0 0 1 21 4.8V13a2.8 2.8 0 0 1-2.8 2.8H17"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9.5h18"/>',
    book: '<path d="M4 5a3 3 0 0 1 3-3h13v18H7a3 3 0 0 1-3-3z"/><path d="M4 17.5h16"/><path d="M8.5 6.5h7"/>',
    grid: '<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2.2"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2.2"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2.2"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2.2"/>',
    chart: '<path d="M4.5 20V11"/><path d="M10 20V4"/><path d="M15.5 20v-6"/><path d="M21 20H3"/>',
    settings: '<path d="M3.5 7.5h9.2"/><path d="M17.3 7.5h3.2"/><path d="M3.5 16.5h3.2"/><path d="M11.3 16.5h9.2"/><circle cx="15" cy="7.5" r="2.4"/><circle cx="9" cy="16.5" r="2.4"/>',
    palette: '<path d="M12 3.4a8.6 8.6 0 1 0 0 17.2h1.3a2.1 2.1 0 0 0 1.5-3.6 1.7 1.7 0 0 1 1.2-2.9h1.8a2.8 2.8 0 0 0 2.8-2.8 8.6 8.6 0 0 0-8.6-7.9z"/><circle cx="8.2" cy="10.2" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/><circle cx="15.8" cy="9.6" r="1" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    download: '<path d="M12 3.5v12"/><path d="m7.6 11.1 4.4 4.4 4.4-4.4"/><path d="M4 20h16"/>',
    upload: '<path d="M12 16.5v-12"/><path d="m7.6 8.9 4.4-4.4 4.4 4.4"/><path d="M4 20h16"/>',
    trash: '<path d="M4 6.5h16"/><path d="M9.6 6.5V4.3h4.8v2.2"/><path d="m6.6 6.5.9 13.5h9l.9-13.5"/>',
    pencil: '<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8z"/><path d="m14.6 5.2 4.2 4.2"/>',
    clipboard: '<rect x="5" y="4.6" width="14" height="16.8" rx="3"/><path d="M9 4.6V3.3A1.3 1.3 0 0 1 10.3 2h3.4A1.3 1.3 0 0 1 15 3.3v1.3z"/><path d="M9 10h6"/><path d="M9 14h4"/>',
    check: '<path d="m4.8 12.6 4.8 4.8L19.2 7.2"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.7 2.7 5-5.2"/>',
    closeCircle: '<circle cx="12" cy="12" r="9"/><path d="m9.2 9.2 5.6 5.6"/><path d="m14.8 9.2-5.6 5.6"/>',
    chevronRight: '<path d="m9.2 5.2 7 6.8-7 6.8"/>',
    chevronLeft: '<path d="m14.8 5.2-7 6.8 7 6.8"/>',
    users: '<circle cx="9.2" cy="8" r="3.4"/><path d="M2.9 20a6.3 6.3 0 0 1 12.6 0"/><path d="M16.2 5.3a3.4 3.4 0 0 1 0 5.9"/><path d="M17.5 14.7A6.3 6.3 0 0 1 21.1 20"/>',
    link: '<path d="M10.1 13.6a4.2 4.2 0 0 0 6.1.4l2.2-2.2a4.2 4.2 0 0 0-5.9-5.9L11.3 7.1"/><path d="M13.9 10.4a4.2 4.2 0 0 0-6.1-.4l-2.2 2.2a4.2 4.2 0 0 0 5.9 5.9l1.2-1.2"/>',
    key: '<circle cx="8.2" cy="15.6" r="4.1"/><path d="m11.3 12.5 8.2-8.2"/><path d="m15.9 5.5 3 3"/><path d="m18.4 3 3 3"/>',
    trophy: '<path d="M8 4h8v5.1a4 4 0 0 1-8 0z"/><path d="M8 5.2H4.8v1.6a3.4 3.4 0 0 0 3.4 3.3"/><path d="M16 5.2h3.2v1.6a3.4 3.4 0 0 1-3.4 3.3"/><path d="M12 13.2V17"/><path d="M8.4 21h7.2"/>',
    zap: '<path d="M13.4 2.4 5 13.6h5.4L10.2 21.6 18.8 10.4h-5.5z"/>',
    rotate: '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.2 4v4.6h-4.6"/>',
    sparkles: '<path d="M11 3.4 12.7 8l4.6 1.7-4.6 1.7L11 16l-1.7-4.6L4.7 9.7 9.3 8z"/><path d="m18.4 15.2.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
    empty: '<rect x="3.2" y="5.6" width="17.6" height="14.2" rx="3.4"/><path d="M8 3v2.6"/><path d="M16 3v2.6"/><path d="M8.4 13.6h7.2"/>',
    play: '<path d="M8.4 5.2 18.6 12 8.4 18.8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.9 20a7.1 7.1 0 0 1 14.2 0"/>',
    cloud: '<path d="M7.2 18h9.3a3.6 3.6 0 0 0 .4-7.2A5.6 5.6 0 0 0 6.4 9.7 4.2 4.2 0 0 0 7.2 18z"/>',
    logout: '<path d="M9.6 20H5.6A1.6 1.6 0 0 1 4 18.4V5.6A1.6 1.6 0 0 1 5.6 4h4"/><path d="m15 8.4 3.6 3.6L15 15.6"/><path d="M9.6 12h9"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="m15.6 15.6 4.2 4.2"/>',
    filter: '<path d="M3.6 5.4h16.8l-6.6 7.7v5.3l-3.6 2.2v-7.5z"/>',
    flag: '<path d="M5.5 21V4.2"/><path d="M5.5 4.8h11.3l-2.1 3.7 2.1 3.7H5.5z"/>',
    pause: '<rect x="7" y="4.5" width="3.6" height="15" rx="1.2"/><rect x="13.4" y="4.5" width="3.6" height="15" rx="1.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.6v6"/><circle cx="12" cy="7.5" r=".9" fill="currentColor" stroke="none"/>',
    undo: '<path d="M4 9.4h9.4a5.2 5.2 0 0 1 0 10.4H7.2"/><path d="m4 9.4 4-4"/><path d="m4 9.4 4 4"/>',
    tag: '<path d="M3.6 11.2V4.4a.8.8 0 0 1 .8-.8h6.8l8.4 8.4-7.6 7.6z"/><circle cx="7.6" cy="7.6" r="1.3"/>',
    image: '<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="3"/><circle cx="8.6" cy="9.4" r="1.7"/><path d="m4 17.4 5-5 4 4 3-3 4 4"/>',
    music: '<path d="M9 18.2V5.6l9-1.8v12.4"/><circle cx="6.4" cy="18.4" r="2.8"/><circle cx="15.4" cy="16.6" r="2.8"/>',
    eye: '<path d="M2.4 12S5.8 5.6 12 5.6 21.6 12 21.6 12 18.2 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="3.1"/>',
    x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
    folder: '<path d="M3.2 7.2a2.4 2.4 0 0 1 2.4-2.4h3.5l1.9 2.2h7.4a2.4 2.4 0 0 1 2.4 2.4v8.2a2.4 2.4 0 0 1-2.4 2.4H5.6a2.4 2.4 0 0 1-2.4-2.4z"/>',
    folderOpen: '<path d="M3.2 8.4V7.2a2.4 2.4 0 0 1 2.4-2.4h3.5l1.9 2.2h7.4a2.4 2.4 0 0 1 2.4 2.4v1"/><path d="M3.2 9.6h17.4l-1.7 8a2.2 2.2 0 0 1-2.2 1.7H5.4a2.2 2.2 0 0 1-2.2-1.7z"/>',
    target: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    speaker: '<path d="M5 9.6h3.2L13 5.6v12.8L8.2 14.4H5z"/><path d="M16.4 9a4.2 4.2 0 0 1 0 6"/><path d="M18.8 6.8a7.4 7.4 0 0 1 0 10.4"/>',
    layers: '<path d="m12 3.4 8.6 4.4L12 12.2 3.4 7.8z"/><path d="m3.4 12.4 8.6 4.4 8.6-4.4"/><path d="m3.4 16.8 8.6 4.4 8.6-4.4"/>',
    chevronDown: '<path d="m5.4 9.2 6.6 6.6 6.6-6.6"/>',
    chevronUp: '<path d="m5.4 14.8 6.6-6.6 6.6 6.6"/>',
    more: '<circle cx="5.4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    table: '<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.6"/><path d="M3.2 9.4h17.6"/><path d="M9.4 9.4v10.2"/><path d="M15.4 9.4v10.2"/>',
    merge: '<path d="M6 3.6v5.2a4 4 0 0 0 4 4h8"/><path d="m15 9.4 3.4 3.4-3.4 3.4"/><path d="M6 20.4v-4.2"/>',
    bell: '<path d="M6.6 9.4a5.4 5.4 0 0 1 10.8 0c0 3.4 1.1 4.9 1.8 5.7H4.8c.7-.8 1.8-2.3 1.8-5.7z"/><path d="M10.2 18.6a2 2 0 0 0 3.6 0"/>',
    keyboard: '<rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.6"/><path d="M6.4 10h.6"/><path d="M9.8 10h.6"/><path d="M13.2 10h.6"/><path d="M16.6 10h.6"/><path d="M8 14h8"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.2"/><path d="M12 19v2.2"/><path d="M2.8 12h2.2"/><path d="M19 12h2.2"/><path d="M5.5 5.5l1.6 1.6"/><path d="M16.9 16.9l1.6 1.6"/><path d="M18.5 5.5l-1.6 1.6"/><path d="M7.1 16.9l-1.6 1.6"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.8 6.8 0 0 0 11 11z"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M9 20.5h6"/><path d="M12 17v3.5"/>',
    shield: '<path d="M12 2.6 20 6v5.4c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
    lock: '<rect x="4.6" y="10.4" width="14.8" height="10" rx="3"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/><circle cx="12" cy="15.4" r="1.1"/>',
    camera: '<rect x="3.2" y="6.4" width="17.6" height="12.4" rx="3"/><circle cx="12" cy="12.6" r="3.2"/><path d="M8.4 6.4 9.6 4h4.8l1.2 2.4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
    phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M10.4 5.2h3.2"/><path d="M11 18.4h2"/>',
    send: '<path d="m4 12 16-8-6 16-2.6-6.4z"/><path d="m11.4 13.6 8.6-9.6"/>',
    cmd: '<path d="M9 6.5A3.5 3.5 0 1 0 5.5 10H9z"/><path d="M9 6.5h6v11H9z"/><path d="M15 6.5A3.5 3.5 0 1 1 18.5 10H15z"/><path d="M9 17.5H5.5A3.5 3.5 0 1 1 9 14z"/><path d="M15 14a3.5 3.5 0 1 1 3.5 3.5H15z"/>',
    robot: '<rect x="4" y="7.5" width="16" height="12" rx="3.5"/><path d="M12 7.5V4.4"/><circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none"/><path d="M9.4 16.4h5.2"/>',
    huawei: '<g fill="currentColor" stroke="none" transform="translate(12 12)"><ellipse cx="0" cy="-6.4" rx="2" ry="4.3"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(45)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(90)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(135)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(180)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(225)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(270)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(315)"/></g>'
  };

  function icon(name, size) {
    return '<svg class="ic' + (size ? ' ' + size : '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (IC[name] || IC.card) + '</svg>';
  }

  // ============================================================
  // ArkUI 声明式基础组件（鸿蒙 ArkTS 风格：返回 El 树）
  // ============================================================
  function iconEl(name, size) {
    const e = new A.El('svg');
    e._attrs.viewBox = '0 0 24 24';
    e._attrs['aria-hidden'] = 'true';
    e._attrs.class = size ? 'ic ' + size : 'ic';
    e._html = IC[name] || IC.card;
    return e;
  }

  function avatarEl(acc, cls) {
    const a = acc || {};
    const n = parseInt(a.avatarColor, 10);
    const c = (n >= 0 && n <= 5) ? n : 0;
    const klass = 'ava ava-c' + c + (cls ? ' ' + cls : '');
    const imgOk = typeof a.avatarData === 'string' &&
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.avatarData);
    if (imgOk) {
      return new A.El('span').cls(klass + ' ava-img').child(new A.El('img').src(a.avatarData).alt('头像'));
    }
    const label = a.nickname ? a.nickname.slice(0, 1) : '我';
    return new A.El('span', label).cls(klass);
  }

  // 通用按钮：{ label, type, size, ico, act, id, tab, title, ... } 其余数字/字符串字段转 data-*
  function btnEl(opts) {
    opts = opts || {};
    let cls = 'btn';
    if (opts.type) cls += ' btn-' + opts.type;
    if (opts.size) cls += ' btn-' + opts.size;
    const e = new A.El('button', opts.label).cls(cls);
    if (opts.act) e.attr('act', opts.act);
    const dataKeys = ['id', 'tab', 'view', 'mode', 'page', 'q', 'i', 'status', 'rating', 'flag', 'src', 'key', 'deckId', 'color'];
    for (let i = 0; i < dataKeys.length; i++) {
      const k = dataKeys[i];
      if (opts[k] != null) e.attr(k, opts[k]);
    }
    if (opts.ico) e.child(iconEl(opts.ico, opts.icoSize || 'i14'));
    if (opts.children) e._children = e._children.concat(A.flatten(opts.children));
    if (opts.title) e.title(opts.title);
    return e;
  }

  function sectionTitleEl(text, ico) {
    const e = new A.El('div', text).cls('section-title');
    if (ico) e._children.unshift(iconEl(ico, 'i14'));
    return e;
  }

  function statBoxEl(v, k, accent, ico) {
    return new A.El('div').cls('stat-box').children([
      ico ? new A.El('span').cls('stat-ico').child(iconEl(ico, 'i16')) : null,
      new A.El('div', k).cls('k'),
      new A.El('div', v).cls('v' + (accent ? ' accent' : ''))
    ]);
  }

  function titlebarEl(title, sub, opt) {
    opt = opt || {};
    const e = new A.El('header').cls('topbar');
    if (opt.back) {
      const b = new A.El('button').cls('btn-icon').attr('act', opt.back.act);
      if (opt.back.view !== undefined) b.attr('view', opt.back.view);
      b.child(iconEl('chevronLeft', 'i18'));
      b._attrs['aria-label'] = '返回';
      e.child(b);
    }
    const main = new A.El('div').cls('tb-main').child(new A.El('div').cls('topbar-t').child(new A.El('h1', title || '闪星卡')));
    if (sub) main.child(new A.El('p', sub));
    e.child(main);
    if (opt.actions) e.child(new A.El('div').cls('tb-actions').html(opt.actions));
    return e;
  }

  function emptyBoxEl(iconName, text, btnLabel, act) {
    const e = new A.El('div').cls('empty').children([
      new A.El('div').cls('empty-ico').child(iconEl(iconName, 'i32')),
      new A.El('div', text).cls('empty-t')
    ]);
    if (btnLabel) {
      e.child(new A.El('div').style('margin-top', '16px').child(btnEl({ label: btnLabel, type: 'primary', act: act })));
    }
    return e;
  }

  function tabbarEl(active, app) {
    const acc = (app && app.account) || {};
    const on = !!acc.loggedIn;
    // 浮层页面（小星/面板/通知/备份）与页签互斥：打开浮层时不高亮任何页签
    let pageActive = '';
    if (app) {
      if (app.aiOpen) pageActive = 'ai-toggle';
      else if (app.cmdOpen) pageActive = 'cmd-open';
      else if (app.noticePageOpen || app.backupPageOpen) pageActive = 'notice-open';
    }
    const tabActive = pageActive ? -999 : active;
    const name = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    const children = [];
    children.push(new A.El('div').cls('brand').children([
      new A.El('span').cls('logo').html('<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 3.2c.5 4.5 2.3 6.3 6.8 6.8-4.5.5-6.3 2.3-6.8 6.8-.5-4.5-2.3-6.3-6.8-6.8 4.5-.5 6.3-2.3 6.8-6.8Z"/><path d="M18.6 15.6c.22 1.8.9 2.48 2.7 2.7-1.8.22-2.48.9-2.7 2.7-.22-1.8-.9-2.48-2.7-2.7 1.8-.22 2.48-.9 2.7-2.7Z"/></svg>'),
      new A.El('span').cls('brand-txt').children([
        new A.El('span', '闪星卡').cls('brand-cn'),
        new A.El('span', 'StarCard').cls('brand-en')
      ])
    ]));
    const unread = noticeUnread(app);
    let lastGroup = '';
    for (let i = 0; i < NAV.length; i++) {
      const n = NAV[i];
      if (n.group !== lastGroup) {
        lastGroup = n.group;
        children.push(new A.El('div', lastGroup).cls('nav-label'));
      }
      if (n.kind === 'tab') {
        children.push(new A.El('div').cls('tab' + (n.tab === tabActive ? ' active' : '')).attr('act', 'tab').attr('tab', n.tab).title(n.label).children([
          new A.El('span').cls('ico').child(iconEl(n.ico, 'i20')),
          new A.El('span', n.label).cls('lab')
        ]));
      } else {
        const isOn = n.act === pageActive;
        const pe = new A.El('div').cls('tab' + (isOn ? ' active' : '')).attr('act', n.act).title(n.label).children([
          new A.El('span').cls('ico').child(iconEl(n.ico, 'i20')),
          new A.El('span', n.label).cls('lab')
        ]);
        if (n.badge && unread > 0) pe.child(new A.El('span', String(unread)).cls('side-badge'));
        children.push(pe);
      }
    }
    children.push(new A.El('div').cls('side-account' + (on ? ' on' : '')).attr('act', 'account-menu').title('账户菜单').children([
      avatarEl(acc, 'ava-sm'),
      new A.El('span').cls('sa-txt').children([
        new A.El('span', on ? name : '登录 / 注册').cls('sa-name'),
        new A.El('span', on ? '查看个人中心' : '个人中心 · 未登录').cls('sa-sub')
      ]),
      new A.El('span').cls('chev').child(iconEl('chevronRight', 'i14'))
    ]));
    children.push(new A.El('div', '小李工作室').cls('side-by').title('小李工作室 XiaoLi Studio'));
    return new A.El('nav').cls('tabbar').children(children);
  }

  // 统一头像：上传图片 / 配色字母。未登录也能用（默认显示「我」），改完立刻可见。
  function avatarFace(acc, cls) {
    const a = acc || {};
    const n = parseInt(a.avatarColor, 10);
    const c = (n >= 0 && n <= 5) ? n : 0;
    const klass = 'ava ava-c' + c + (cls ? ' ' + cls : '');
    const imgOk = typeof a.avatarData === 'string' &&
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.avatarData);
    if (imgOk) {
      return '<span class="' + klass + ' ava-img"><img src="' + esc(a.avatarData) + '" alt="头像" /></span>';
    }
    const label = a.nickname ? a.nickname.slice(0, 1) : '我';
    return '<span class="' + klass + '">' + esc(label) + '</span>';
  }

  // 通知：只放"今天要做什么"和"该备份了"，不催、不堆营销话术
  function noticeItems(app) {
    const st = (app && app.state) || {};
    const ov = FC.smartOverview ? FC.smartOverview(st) : null;
    const list = [];
    if (ov && ov.hasData && ov.planned > 0) {
      list.push({
        id: 'today', icon: 'clock', tone: 'brand',
        title: '今天还有 ' + ov.planned + ' 张',
        desc: '新卡 ' + ov.newLeft + ' · 到期 ' + ov.due + ' · 约 ' + ov.minutes + ' 分钟',
        tab: 0, cta: '去学'
      });
    }
    if (ov && ov.hasData && ov.streak > 0) {
      list.push({
        id: 'streak', icon: 'zap', tone: 'amber',
        title: '已经连着学了 ' + ov.streak + ' 天',
        desc: '这是从每天的复习记录里算出来的。'
      });
    }
    const last = app && app.lastBackupAt ? app.lastBackupAt() : 0;
    const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
    if (!last) {
      list.push({
        id: 'backup', icon: 'shield', tone: 'red',
        title: '还没备份过',
        desc: '导出一份 .srcd 放到别处，换设备或清缓存都不会丢。',
        page: 'backup', cta: '去备份'
      });
    } else if (days >= 14) {
      list.push({
        id: 'backup', icon: 'shield', tone: 'amber',
        title: '上次备份是 ' + days + ' 天前',
        desc: '顺手导出一份，几十秒的事。',
        page: 'backup', cta: '去备份'
      });
    }
    return list;
  }

  function noticeUnread(app) {
    const items = noticeItems(app);
    if (!items.length) return 0;
    const read = (app && app.noticeReadAt) ? app.noticeReadAt() : 0;
    if (!read) return items.length;
    return FC.dateKey(read) === FC.dateKey(Date.now()) ? 0 : items.length;
  }

  // 隐私开关行
  function privacyRow(key, on, title, desc) {
    return '<div class="privacy-row">' +
      '<div class="pr-txt"><div class="pr-title">' + esc(title) + '</div>' +
      '<div class="pr-desc">' + esc(desc) + '</div></div>' +
      '<button class="switch' + (on ? ' on' : '') + '" data-act="privacy-toggle" data-key="' + key + '"' +
      ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(title) + '">' +
      '<span class="switch-knob"></span></button></div>';
  }

  // ---------------------------------------------------------------- 导航
  // 侧栏导航：统一页签(tab)与完整页面(page)，tab 序号 0-6 保持稳定
  const NAV = [
    { kind: 'tab', tab: 0, label: '卡片', ico: 'cards', group: '学习' },
    { kind: 'tab', tab: 1, label: '词书', ico: 'book', group: '学习' },
    { kind: 'tab', tab: 2, label: '班级', ico: 'users', group: '一起学' },
    { kind: 'tab', tab: 3, label: '同桌', ico: 'link', group: '一起学' },
    { kind: 'tab', tab: 4, label: '比赛', ico: 'zap', group: '一起学' },
    { kind: 'tab', tab: 5, label: '数据', ico: 'chart', group: '工具' },
    { kind: 'page', act: 'ai-toggle', label: '小星', ico: 'sparkles', group: '工具' },
    { kind: 'page', act: 'cmd-open', label: '面板', ico: 'cmd', group: '工具' },
    { kind: 'page', act: 'notice-open', label: '通知', ico: 'bell', group: '工具', badge: true }
    // 「设置」已移入左下角头像弹出的账户菜单（见 accountMenuLayer）
  ];

  function logo() {
    // 闪星卡：一大一小双星标记，跟随 currentColor
    return '<span class="logo"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
      '<path d="M12 3.2c.5 4.5 2.3 6.3 6.8 6.8-4.5.5-6.3 2.3-6.8 6.8-.5-4.5-2.3-6.3-6.8-6.8 4.5-.5 6.3-2.3 6.8-6.8Z"/>' +
      '<path d="M18.6 15.6c.22 1.8.9 2.48 2.7 2.7-1.8.22-2.48.9-2.7 2.7-.22-1.8-.9-2.48-2.7-2.7 1.8-.22 2.48-.9 2.7-2.7Z"/>' +
      '</svg></span>';
  }

  function tabbar(active, app) {
    const acc = (app && app.account) || {};
    const on = !!acc.loggedIn;
    // 浮层页面与页签互斥：打开浮层时不高亮任何页签
    let pageActive = '';
    if (app) {
      if (app.aiOpen) pageActive = 'ai-toggle';
      else if (app.cmdOpen) pageActive = 'cmd-open';
      else if (app.noticePageOpen || app.backupPageOpen) pageActive = 'notice-open';
    }
    const tabActive = pageActive ? -999 : active;
    const name = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    let html = '<nav class="tabbar">' +
      '<div class="brand">' + logo() +
      '<span class="brand-txt"><span class="brand-cn">闪星卡</span><span class="brand-en">StarCard</span></span></div>';
    const unread = noticeUnread(app);
    let lastGroup = '';
    for (let i = 0; i < NAV.length; i++) {
      const n = NAV[i];
      if (n.group !== lastGroup) {
        lastGroup = n.group;
        html += '<div class="nav-label">' + esc(lastGroup) + '</div>';
      }
      if (n.kind === 'tab') {
        html += '<div class="tab' + (n.tab === tabActive ? ' active' : '') + '" data-act="tab" data-tab="' + n.tab + '" title="' + n.label + '">' +
          '<span class="ico">' + icon(n.ico, 'i20') + '</span>' +
          '<span class="lab">' + n.label + '</span></div>';
      } else {
        const isOn = n.act === pageActive;
        html += '<div class="tab' + (isOn ? ' active' : '') + '" data-act="' + n.act + '" title="' + n.label + '">' +
          '<span class="ico">' + icon(n.ico, 'i20') + '</span>' +
          '<span class="lab">' + n.label + '</span>' +
          (n.badge && unread > 0 ? '<span class="side-badge">' + unread + '</span>' : '') + '</div>';
      }
    }
    html += '<div class="side-account' + (on ? ' on' : '') + '" data-act="account-menu" title="账户菜单">' +
      avatarFace(acc, 'ava-sm') +
      '<span class="sa-txt"><span class="sa-name">' + esc(on ? name : '登录 / 注册') + '</span>' +
      '<span class="sa-sub">' + (on ? '查看个人中心' : '个人中心 · 未登录') + '</span></span>' +
      '<span class="chev">' + icon('chevronRight', 'i14') + '</span>' +
      '</div>' +
      '<div class="side-by" title="小李工作室 XiaoLi Studio">小李工作室</div></nav>';
    return html;
  }

  function titlebar(title, sub, opt) {
    opt = opt || {};
    let html = '<header class="topbar">';
    if (opt.back) {
      html += '<button class="btn-icon" data-act="' + opt.back.act + '"' +
        (opt.back.view !== undefined ? ' data-view="' + opt.back.view + '"' : '') +
        ' aria-label="返回">' + icon('chevronLeft', 'i18') + '</button>';
    }
    html += '<div class="tb-main"><div class="topbar-t"><h1>' + esc(title || '闪星卡') + '</h1></div>' +
      (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
    if (opt.actions) html += '<div class="tb-actions">' + opt.actions + '</div>';
    return html + '</header>';
  }

  function emptyBox(iconName, text, btnLabel, act) {
    let html = '<div class="empty"><div class="empty-ico">' + icon(iconName, 'i32') + '</div>' +
      '<div class="empty-t">' + esc(text) + '</div>';
    if (btnLabel) {
      html += '<div style="margin-top:16px"><button class="btn btn-primary" data-act="' + act + '">' +
        esc(btnLabel) + '</button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 卡片页
  // 今日概览 Hero：待办 / 预计用时 / 连续打卡 / 一条可执行建议。
  function overviewHero(ov, app) {
    if (!ov) return '';
    const acc = (app && app.account) || {};
    const nm = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    const hr = new Date().getHours();
    const greet = hr < 6 ? '夜深了' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
    const d = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
    const dateStr = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + week;
    const pct = ov.planned > 0
      ? Math.min(100, Math.round(ov.doneToday / (ov.doneToday + ov.planned) * 100))
      : (ov.hasData ? 100 : 0);
    const adv = ov.advice;
    const fig = function (v, k, tone) {
      return '<div class="ov-fig' + (tone ? ' tone-' + tone : '') + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>';
    };
    const ctaCls = adv.tone === 'brand' ? 'btn-primary' : (adv.tone === 'green' ? 'btn-accent' : '');
    return '<div class="overview-hero">' +
      '<span class="hero-float hf-dot" style="top:14%;right:22%"></span>' +
      '<span class="hero-float hf-dot2" style="top:58%;right:9%;animation-delay:-1.3s"></span>' +
      '<span class="hero-float hf-dot3" style="top:20%;right:46%;animation-delay:-2.1s"></span>' +
      '<span class="hero-float hf-pill" style="bottom:16%;right:26%;animation-delay:-.7s">FSRS-5 · 智能间隔重复</span>' +
      '<div class="ov-body"><div class="ov-left">' +
      '<div class="ov-date">' + esc(dateStr) + '</div>' +
      '<div class="ov-hello">' + esc(greet) + '，' + esc(nm) + '</div>' +
      '<div class="ov-caption">' + (ov.hasData
        ? ('已掌握 ' + ov.mastered + ' / ' + ov.total + ' 张 · 真实留存 ' + (ov.retention > 0 ? Math.round(ov.retention * 100) + '%' : '—'))
        : '尚无学习记录，导入内容后即可开始') + '</div>' +
      '<div class="ov-figs">' +
      fig(ov.planned, '今日待学', 'brand') +
      fig(ov.minutes + ' 分', '预计用时') +
      fig(ov.streak + ' 天', '连续打卡', 'amber') +
      '</div></div>' +
      '<div class="ov-ring" style="--pct:' + pct + '"><div class="ov-ring-in">' +
      '<b>' + pct + '%</b><span>今日进度</span></div></div></div>' +
      '<div class="ov-advice tone-' + esc(adv.tone) + '">' +
      '<span class="ov-adv-ico">' + icon(adv.icon, 'i18') + '</span>' +
      '<div class="ov-adv-txt"><div class="ov-adv-title">' + esc(adv.title) + '</div>' +
      '<div class="ov-adv-desc">' + esc(adv.desc) + '</div></div>' +
      '<button class="btn btn-sm ' + ctaCls + '" data-act="' + esc(adv.act) + '"' +
      (adv.tab !== undefined ? ' data-tab="' + adv.tab + '"' : '') + '>' + esc(adv.cta) + '</button>' +
      '</div></div>';
  }

  // 未完成会话的「继续学习」入口：退出学习后回到首页仍可原样续上
  function resumeStudyBanner(app) {
    if (!app.study || app.studyActive !== false || app.study.done) return '';
    const st = app.study;
    const studied = app.studiedCount ? app.studiedCount() : 0;
    const mastered = app.learnedCount ? app.learnedCount() : 0;
    const total = st.total || 0;
    // 进度条口径 = 已掌握词汇，不是学过张数
    const pct = total ? Math.round(Math.min(mastered / total, 1) * 100) : 0;
    let when = '';
    if (st.dueQueue && st.dueQueue.length && !st.activeId) {
      const secs = Math.ceil(app.nextDueIn() / 1000);
      const mm = Math.floor(secs / 60), ss = secs % 60;
      when = '<span class="rsb-when">' + icon('clock', 'i14') + '下一张 ' + (mm > 0 ? mm + ' 分 ' : '') + ss + ' 秒后出现</span>';
    }
    return '<div class="resume-study-banner" data-act="study-resume" role="button" tabindex="0">' +
      '<span class="rsb-ico">' + icon('play', 'i20') + '</span>' +
      '<span class="rsb-main"><b>继续上次学习' + (st.deckName ? ' · ' + esc(st.deckName) : '') + '</b>' +
      '<small>已掌握 ' + mastered + ' / ' + total + ' · 已学 ' + studied + ' · 掌握进度 ' + pct + '%</small>' +
      when + '</span>' +
      '<span class="rsb-cta">继续学习 ' + icon('chevronRight', 'i16') + '</span>' +
      '<span class="rsb-progress"><i style="width:' + pct + '%"></i></span></div>';
  }

  // 首页补充卡片：填满宽屏空白，提供「本周节奏 / 重点复习 / 智能诊断」三个速览
  function homeExtras(app, ov) {
    const st = app.state;
    const now = Date.now();

    // —— 本周复习节奏（近 7 天迷你柱状图）——
    const days = [];
    const dayKeys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * FC.DAY_MS);
      const key = FC.dateKey(d.getTime());
      dayKeys.push(key);
      let n = 0;
      for (let j = 0; j < st.stats.length; j++) {
        if (st.stats[j].date === key) { n = st.stats[j].reviews || 0; break; }
      }
      days.push(n);
    }
    const maxN = Math.max(1, days.reduce(function (a, b) { return Math.max(a, b); }, 0));
    const wkTotal = days.reduce(function (a, b) { return a + b; }, 0);
    const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
    let bars = '';
    for (let i = 0; i < days.length; i++) {
      const d = new Date(now - (6 - i) * FC.DAY_MS);
      const h = Math.round(days[i] / maxN * 100);
      const isToday = i === 6;
      bars += '<div class="wk-col' + (isToday ? ' today' : '') + '">' +
        '<div class="wk-bar-wrap"><span class="wk-bar" style="height:' + Math.max(days[i] ? 8 : 3, h) + '%"' +
        (days[i] ? '' : ' data-zero="1"') + '></span></div>' +
        '<span class="wk-lb">' + wdNames[d.getDay()] + '</span></div>';
    }
    const weekCard = '<div class="home-card week-card">' +
      '<div class="hc-head">' + icon('chart', 'i18') + '<span>本周节奏</span>' +
      '<em>' + wkTotal + ' 次</em></div>' +
      '<div class="wk-chart">' + bars + '</div>' +
      '<div class="hc-foot">最近 7 天复习 · 今天 ' + days[6] + ' 次</div>' +
      '</div>';

    // —— 重点复习（本机 FSRS 算力）——
    let focusCard = '';
    try {
      if (FC.AI && FC.AI.REVIEW_ANALYSIS) {
        const a = FC.AI.REVIEW_ANALYSIS(app);
        if (a && a.hasData) {
          let words = '';
          const top = (a.items || []).slice(0, 3);
          for (let i = 0; i < top.length; i++) {
            const x = top[i];
            const w = String(x.card && x.card.front || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const wt = w.length > 16 ? w.slice(0, 16) + '…' : w;
            words += '<div class="hf-word"><span class="hf-name">' + esc(wt) + '</span>' +
              '<span class="hf-meta">可提取度 ' + esc(x.retention) + '%' +
              (x.overdueDays > 0 ? ' · 逾期 ' + esc(x.overdueDays) + ' 天' : '') + '</span></div>';
          }
        focusCard = '<div class="home-card focus-card">' +
          '<div class="hc-head">' + icon('target', 'i18') + '<span>重点复习</span>' +
          '<em>约 ' + esc(a.minutes) + ' 分钟</em></div>' +
          '<div class="hf-nums"><span><b>' + esc(a.dueCnt) + '</b>张到期</span>' +
          '<span><b>' + esc(a.lowRCnt) + '</b>张记忆偏低</span></div>' +
          (words || '<div class="hc-foot">暂无低留存卡片</div>') +
          '<button class="hc-cta" data-act="ai-prompt" data-q="哪些词要抓紧复习？要学多久？">让小星分析' + icon('chevronRight', 'i14') + '</button>' +
          '</div>';
        }
      }
    } catch (e) { focusCard = ''; }
    if (!focusCard) {
      focusCard = '<div class="home-card focus-card">' +
        '<div class="hc-head">' + icon('target', 'i18') + '<span>重点复习</span></div>' +
        '<div class="hc-empty">学几张卡后，小星会在这里算出最该多复习的词和所需时间。</div>' +
        '</div>';
    }

    // —— 智能诊断（小星）——
    let diagCard = '';
    try {
      if (FC.AI && FC.AI.DIAGNOSIS) {
        const items = FC.AI.DIAGNOSIS(app) || [];
        let rows = '';
        for (let i = 0; i < Math.min(3, items.length); i++) {
          const it = items[i];
          rows += '<div class="hd-row tone-' + esc(it.tone) + '">' +
            '<span class="hd-ico">' + icon(it.icon, 'i15') + '</span>' +
            '<div><b>' + esc(it.title) + '</b><span>' + esc(it.desc) + '</span></div></div>';
        }
        diagCard = '<div class="home-card diag-card">' +
          '<div class="hc-head">' + icon('sparkles', 'i18') + '<span>智能诊断 · 小星</span></div>' +
          rows + '</div>';
      }
    } catch (e) { diagCard = ''; }

    if (!weekCard && !focusCard && !diagCard) return '';
    return '<div class="home-extras">' + weekCard + focusCard + diagCard + '</div>';
  }

  function deckPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    const ov = FC.smartOverview ? FC.smartOverview(st) : null;
    const heroHtml = overviewHero(ov, app);
    // 卡片页 = 纯学习场所：只保留学习相关入口，制作 / 导入统一挪到「词书」页。
    let html = titlebar('卡片', 'FSRS-5 间隔重复', {
      actions:
        '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览</button>' +
        '<button class="btn btn-sm" data-act="custom-study">' + icon('layers', 'i14') + '自定义学习</button>' +
        '<button class="btn btn-sm" data-act="export-open" title="导出全部牌组 .srcd">' + icon('upload', 'i14') + '导出</button>'
    }) +
      '<div class="content home-page">' +
      heroHtml +
      resumeStudyBanner(app) +
      (FCUI.aiBriefing ? FCUI.aiBriefing(app) : '') +
      homeExtras(app, ov) +
      '<div class="section-title">牌组 · 点击开始学习</div>';

    if (st.decks.length === 0) {
      html += '<div class="onboard">' +
        '<div class="ob-head"><span class="ob-ico">' + icon('cards', 'i20') + '</span>' +
        '<div><b>快速开始</b>' +
        '<small>所有数据保存在本设备，可离线使用。</small></div></div>' +
        '<div class="ob-steps">' +
        '<div class="ob-step"><span class="ob-n">1</span>' +
        '<div class="ob-txt"><b>导入词库</b><small>支持 .srcd / Anki .apkg / CSV；每个词库会自动成为一个系列</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="import-hub">去导入</button>' +
        '</div>' +
        '<div class="ob-step"><span class="ob-n">2</span>' +
        '<div class="ob-txt"><b>导入自己的内容</b><small>支持 Anki .apkg / .colpkg、.srcd 与 CSV，或新建牌组</small></div>' +
        '<button class="btn btn-sm" data-act="tab" data-tab="1">前往词书</button></div>' +
        '<div class="ob-step"><span class="ob-n">3</span>' +
        '<div class="ob-txt"><b>键盘操作</b><small>空格 / 回车翻面 · 1-4 评分</small></div>' +
        '<button class="btn btn-sm" data-act="shortcuts-help">查看快捷键</button></div>' +
        '</div></div></div>';
      return html + tabbar(0, app);
    }
    const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
    const split = splitDecksBySeries(st, seriesList);
    // 依据 id 稳定分配一个 HarmonyOS 彩色图标（红/橙/黄/绿/青/蓝/紫/绯），同一牌组颜色固定
    function avTone(deck) {
      const key = String((deck && deck.id) || (deck && deck.name) || '');
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return h % 8;
    }
    function deckStudyItem(d) {
      const c = s.deckCounts(d, now);
      const total = d.cards.length;
      const isSat = (d.tags || []).indexOf('sat800') >= 0;
      const cap = (typeof FC.settingsFor === 'function' ? FC.settingsFor(d, st.settings) : st.settings).newCardsPerDay;
      const left = Math.max(0, cap - st.newToday);
      const capped = c[0] > left;
      let inProgress = 0;
      for (let k = 0; k < d.cards.length; k++) {
        const cc = d.cards[k];
        if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
      }
      const masteredCount = Math.max(0, total - c[0] - inProgress);
      const masterPct = total === 0 ? 0 : Math.round(masteredCount / total * 100);
      const tone = avTone(d);
      return '<div class="list-item deck-item dt-' + tone + '" data-act="study-deck" data-id="' + esc(d.id) + '">' +
        '<div class="avatar deck-av av-tone-' + tone + '">' + icon(isSat ? 'book' : 'layers', 'i20') + '</div>' +
        '<div class="li-main"><div class="name">' + esc(d.name) +
        ((c[0] || c[1]) ? '<span class="deck-chips">' +
          (c[0] ? '<span class="dchip dc-new">新 ' + c[0] + '</span>' : '') +
          (c[1] ? '<span class="dchip dc-due">到期 ' + c[1] + '</span>' : '') + '</span>'
          : (total > 0 ? '<span class="deck-chips"><span class="dchip dc-done">今日已完成</span></span>' : '')) + '</div>' +
        '<div class="meta">' + (d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + masteredCount + ' / ' + total + ' 张</div>' +
        (capped ? '<div class="cap-warn" data-act="settings-open" title="点击前往统一设置">' +
          icon('info', 'i13') + '今日新卡限 ' + left + ' 张（共 ' + c[0] + ' 张待学）· 点此调大上限</div>' : '') +
        '<div class="progress deck-prog"><span style="width:' + masterPct + '%"></span></div></div>' +
        '<div class="li-actions">' +
        '<button class="btn btn-sm btn-primary" data-act="study-deck" data-id="' + esc(d.id) + '">学习</button>' +
        '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(d.id) + '" title="更多操作">' +
        icon('more', 'i16') + '</button></div>' +
        '</div>';
    }
    for (let si = 0; si < seriesList.length; si++) {
      const se = seriesList[si];
      const ds = split.bySeries[se.id];
      if (!ds || !ds.length) continue;
      const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
      html += '<div class="series-group' + (collapsed ? ' collapsed' : '') + '">' +
        '<div class="sg-head"><button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>' +
        '<span class="sg-name">' + esc(se.name) + '</span>' +
        '<span class="sg-meta">' + ds.length + ' 个分册</span>' +
        '<button class="btn btn-sm sg-go" data-act="series-open" data-id="' + esc(se.id) + '">查看系列</button></div>';
      for (let i = 0; i < ds.length; i++) html += deckStudyItem(ds[i]);
      html += '</div>';
    }
    if (split.userDecks.length) {
      html += '<div class="section-title">牌组 · 自建</div>';
      for (let i = 0; i < split.userDecks.length; i++) html += deckStudyItem(split.userDecks[i]);
    }
    html += '</div>';
    return html + tabbar(0, app);
  }

  // ---------------------------------------------------------------- 卡片管理
  function cardManagePage(app) {
    const st = app.state;
    const deck = st.decks.find(function (d) { return d.id === app.cardManageDeckId; });
    if (!deck) {
      let html = titlebar('卡片管理', '', { back: { act: 'deck-back' } }) + '<div class="content">';
      html += emptyBox('cards', '未选择牌组');
      return html + tabbar(app.tab, app);
    }
    let html = titlebar(deck.name, '卡片管理 · 共 ' + deck.cards.length + ' 张卡片', {
      back: { act: 'deck-back' },
      actions: '<button class="btn btn-sm" data-act="browser-deck" data-id="' + esc(deck.id) + '">' +
        icon('table', 'i14') + '浏览</button>' +
        '<button class="btn btn-sm" data-act="deck-options" data-id="' + esc(deck.id) + '">' +
        icon('settings', 'i14') + '选项</button>' +
        '<button class="btn btn-sm btn-primary" data-act="card-new" data-id="' + esc(deck.id) + '">' +
        icon('plus', 'i14') + '添加卡片</button>'
    }) + '<div class="content">';

    html += '<div class="page-head">' +
      '<button class="btn btn-sm" data-act="card-batch" data-id="' + esc(deck.id) + '">' +
      icon('clipboard', 'i14') + '批量粘贴</button>' +
      '<span class="subtle">支持基础 / 反向 / 填空三种笔记类型</span></div>';

    if (deck.cards.length === 0) {
      html += emptyBox('card', '这个牌组还没有卡片');
    } else {
      for (let i = 0; i < deck.cards.length; i++) {
        const c = deck.cards[i];
        const stateLabel = FCUI.statusText ? FCUI.statusText(c) : c.state;
        const flag = c.flags ? '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[c.flags] + '"></span>' : '';
        html += '<div class="list-item">' +
          '<div class="avatar gray">' + icon('card', 'i18') + '</div>' +
          '<div class="li-main"><div class="name" style="font-size:14.5px">' + flag + esc(c.front) + '</div>' +
          '<div class="meta">' + esc(String(c.back).slice(0, 80)) + ' · ' + stateLabel +
          (c.notetype === 'cloze' ? ' · 填空' : '') +
          (c.leeched ? ' · Leech' : '') +
          (c.tags.length ? ' · ' + c.tags.map(esc).join('/') : '') + '</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          '<button class="btn btn-sm" data-act="card-info" data-id="' + esc(c.id) + '" title="信息">' +
          icon('info', 'i14') + '</button>' +
          '<button class="btn btn-sm" data-act="card-edit" data-id="' + esc(c.id) + '" title="编辑">' +
          icon('pencil', 'i14') + '</button>' +
          '<button class="btn btn-sm btn-danger" data-act="card-del" data-id="' + esc(c.id) + '" title="删除">' +
          icon('trash', 'i14') + '</button>' +
          '</div></div>';
      }
    }
    html += '</div>';
    return html + tabbar(app.tab, app);
  }

  // ---------------------------------------------------------------- 卡片学习会话
  function studySession(app) {
    const sess = app.study;
    const card = app.currentStudyCard();
    const waiting = !card && app.studyWaiting();
    const pending = (sess.dueQueue && sess.dueQueue.length) || 0;
    const graded = sess.reviewed || 0;
    const studied = app.studiedCount ? app.studiedCount() : 0;
    const mastered = app.learnedCount ? app.learnedCount() : 0;
    const elapsedMs = sess.sessionStartedAt ? Math.max(0, Date.now() - sess.sessionStartedAt) : 0;
    const secs = Math.floor(elapsedMs / 1000);
    const dur = secs >= 60
      ? Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2)
      : secs + 's';
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title">卡片学习' + (sess.deckName ? ' · ' + esc(sess.deckName) : '') + '</div>' +
      // 进度条口径 = 已掌握词汇（以良好/简单毕业的卡），不是「学过/刷过」的张数
      '<div class="subtle">已掌握 <strong>' + mastered + '</strong> / ' + sess.total + ' 个单词' +
      ' · 已学 ' + studied +
      ' · 剩余 ' + Math.max(0, sess.total - studied) + ' 张' +
      (pending ? ' · 待复习 ' + pending + ' 张' : '') +
      ' · 本次 ' + graded + ' 次评分 / ' + dur +
      ((sess.requeued) ? ' · 重来 ' + sess.requeued + ' 次' : '') + '</div></div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn btn-sm ai-ask-btn" data-act="ai-ask-study">' + icon('sparkles', 'i14') + '问小星</button>' +
      '<button class="btn btn-sm" data-act="study-stop">退出</button></div></div>' +
      '<div class="progress"><span style="width:' +
      Math.round(sess.total ? Math.min(mastered / sess.total, 1) * 100 : 0) + '%"></span></div>' +
      (FCUI.studyTools ? FCUI.studyTools(app) : '') + '</div>';

    if (!card) {
      if (waiting) {
        // 首轮学完，重来卡还没到点：Anki 式等待 + 倒计时 + 可提前学习
        const secs = Math.ceil(app.nextDueIn() / 1000);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        const cd = (mm > 0 ? mm + ' 分 ' : '') + ss + ' 秒';
        html += '<div class="study-area"><div class="card" style="text-align:center;width:100%;max-width:360px;padding:32px 22px;margin:0">' +
          '<div style="display:flex;justify-content:center;color:var(--primary)">' + icon('clock', 'i44') + '</div>' +
          '<div id="studyCountdown" style="font-weight:700;font-size:18px;margin-top:14px">下一张 ' + cd + ' 后出现</div>' +
          '<div class="subtle" style="margin-top:8px">按 Anki 记忆算法，刚点「重来」的卡会在几分钟后重新出现。' +
          '还有 <strong>' + pending + '</strong> 张在等待到期，到点会自动出现。</div>' +
          '<button class="btn btn-primary" style="margin-top:20px" data-act="study-ahead">提前学习</button>' +
          '<div style="margin-top:10px"><button class="btn btn-sm" data-act="study-stop">结束本次学习</button></div>' +
          '</div></div>';
        return html + '</div>';
      }
      const g = sess.gradeCounts || { 1: 0, 2: 0, 3: 0, 4: 0 };
      const good = (g[3] || 0) + (g[4] || 0);
      const acc = graded ? Math.round(good / graded * 100) : 0;
      const advice = acc >= 85
        ? '本次正确率较高，后续复习间隔将自动延长。'
        : (acc >= 60
          ? '标记「重来」的卡片将在几分钟后再次出现。'
          : '遗忘较多的卡片会安排更频繁的复习。');
      const cell = function (v, label) {
        return '<div class="summary-cell"><b>' + esc(String(v)) + '</b><span>' + label + '</span></div>';
      };
      const g1 = g[1] || 0, g2 = g[2] || 0, g3 = g[3] || 0, g4 = g[4] || 0;
      const seg = function (n, cls) { return n > 0 ? '<span class="rs-seg ' + cls + '" style="flex:' + n + '"></span>' : ''; };
      html += '<div class="study-area"><div class="card study-summary" style="width:100%;max-width:420px;padding:30px 26px;margin:0">' +
        '<div class="summary-ring" style="--p:' + acc + '"><div class="summary-ring-in"><b>' + acc + '%</b><span>正确率</span></div></div>' +
        '<div class="summary-title" style="text-align:center">本组已学完</div>' +
        '<div class="subtle" style="text-align:center;margin-top:6px">已学 ' + studied + ' / ' + sess.total + ' 个单词 · 掌握 ' + mastered + ' 个 · 用时 ' + dur + '</div>' +
        '<div class="summary-grid">' +
          cell(mastered + ' / ' + sess.total, '已掌握') +
          cell(studied + ' / ' + sess.total, '已学') +
          cell(String(graded), '本次评分') +
          cell(dur, '本次用时') +
        '</div>' +
        '<div class="rating-stack" title="评分分布">' + seg(g1, 's1') + seg(g2, 's2') + seg(g3, 's3') + seg(g4, 's4') + '</div>' +
        '<div class="summary-ratings">' +
          '<span class="sr s1">重来 <b>' + g1 + '</b></span>' +
          '<span class="sr s2">困难 <b>' + g2 + '</b></span>' +
          '<span class="sr s3">良好 <b>' + g3 + '</b></span>' +
          '<span class="sr s4">简单 <b>' + g4 + '</b></span>' +
          ((sess.requeued) ? '<span class="sr-extra">途中重来 ' + sess.requeued + ' 次</span>' : '') +
        '</div>' +
        '<div class="summary-advice">' + icon('info', 'i15') + '<span>' + advice + '</span></div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:18px" data-act="study-stop">返回</button></div></div>';
      return html + '</div>';
    }

    const frontHtml = FC.renderCardHtml ? FC.renderCardHtml(card, 'front') : esc(card.front);
    const backHtml = FC.renderCardHtml ? FC.renderCardHtml(card, 'back') : esc(card.back);
    const statusChip = card.leeched ? '<span class="chip red">Leech · 已遗忘 ' + card.scheduling.lapses + ' 次</span>'
      : (card.flags ? '<span class="chip">' + icon('flag', 'i14') + '已标记</span>' : '');

    // 「第 01 组」这类分组标签不是音标，别当成发音塞在单词下面
    const extraTxt = String(card.extra == null ? '' : card.extra).trim();
    const extraIsGroup = !extraTxt || /^第\s*\d+\s*组$/.test(extraTxt);

    const showCardTimer = !!(app.state && app.state.settings && app.state.settings.showTimer);
    // 「只有英文解释」的卡（如转折词）：背面是纯英文、无中文、无 == 标词例句。
    // 这类卡让英文解释干净地落在卡片正中央，不被「新卡片 / 评分提示」挤偏。
    const backTextOnly = String(card.back == null ? '' : card.back).replace(/\[sound:[^\]]+\]/g, '').trim();
    const enOnlyBack = backTextOnly.length > 0 && !/[\u4e00-\u9fa5]/.test(backTextOnly) && backTextOnly.indexOf('==') < 0;
    html += '<div class="study-area">' +
      (statusChip ? '<div class="study-flags">' + statusChip + '</div>' : '') +
      (showCardTimer ? '<div class="card-timer" id="cardTimer" title="本题用时">' + icon('clock', 'i14') + ' <span>0.0s</span></div>' : '') +
      '<div class="flip-card" data-act="study-flip">' +
      '<div class="flip-inner ' + (app.studyRevealed ? 'flipped' : '') + '">' +
      '<div class="flip-face flip-front"><div class="field-html word">' + frontHtml + '</div>' +
      ((!extraIsGroup && card.notetype !== 'cloze') ? '<div class="phon field-html">' + (FC.renderRich ? FC.renderRich(card.extra, card) : esc(card.extra)) + '</div>' : '') +
      (card.tags.length ? '<div style="margin-top:14px">' +
        card.tags.map(function (t) { return '<span class="chip gray">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="flip-hint">点击卡片翻面</div></div>' +
      '<div class="flip-face flip-back' + (enOnlyBack ? ' en-only' : '') + '">' +
      '<div class="field-html mean">' + backHtml + '</div>' +
      (enOnlyBack ? '' : '<div class="ex">' + esc(card.scheduling.reps > 0
        ? ('已复习 ' + card.scheduling.reps + ' 次 · 遗忘 ' + card.scheduling.lapses + ' 次')
        : '新卡片') + '</div>') +
      (enOnlyBack ? '' : '<div class="flip-hint">选择下方评分继续</div>') + '</div>' +
      '</div></div></div>';

    if (app.studyRevealed) {
      const labels = ['重来', '困难', '良好', '简单'];
      const sub = sess.preview || ['', '', '', ''];
      html += '<div class="rate-bar">';
      for (let r = 1; r <= 4; r++) {
        html += '<button class="rate-btn r' + r + '" data-act="study-rate" data-rating="' + r + '">' +
          '<span class="rate-key">' + String(r) + '</span>' +
          '<span class="rate-label">' + labels[r - 1] + '</span>' +
          '<span class="rate-meta">' + esc(sub[r - 1]) + '</span></button>';
      }
      html += '</div>';
    } else {
      html += '<div class="rate-bar"><button class="rate-btn r3" data-act="study-flip">' +
        '<span class="rate-key">Enter / Space</span>' +
        '<span class="rate-label">显示答案</span>' +
        '<span class="rate-meta">翻面看答案 · 按 Enter 或空格</span></button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 词书页
  function allBooks(app) {
    return app.state.wordBooks.slice();
  }

  function wordBookPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    let html = titlebar('词书', '导入 · 制作 · 管理', {
      actions: '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览全部</button>'
    }) + '<div class="content">';

    // —— 系列词书：成套牌组收纳为文件夹式容器（主文件）——
    const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
    if (seriesList.length) {
      html += '<div class="section-title">系列词书 · 主文件</div>' +
        '<div class="series-grid">';
      for (let si = 0; si < seriesList.length; si++) {
        html += seriesFolderCard(app, seriesList[si]);
      }
      html += '</div>';
    }

    // —— 已移除的词书：默认折叠，可恢复重新显示（避免误删后无处找回）——
    const removedList = typeof FC.removedSeries === 'function' ? FC.removedSeries(st) : [];
    if (removedList.length) {
      html += '<div class="removed-series-box">' +
        '<button class="removed-series-toggle" data-act="series-removed-toggle">' +
        icon('trash', 'i14') + '已移除的词书（' + removedList.length + '）' +
        (app.showRemovedSeries ? icon('chevronUp', 'i14') : icon('chevronDown', 'i14')) + '</button>';
      if (app.showRemovedSeries) {
        html += '<div class="removed-series-list">';
        for (let ri = 0; ri < removedList.length; ri++) {
          const rs = removedList[ri];
          html += '<div class="removed-series-item">' +
            '<div class="rs-info"><div class="rs-name">' + esc(rs.name) + '</div>' +
            '<div class="rs-meta">' + esc(rs.subtitle || '') + ' · 卡片已删除</div></div>' +
            '<button class="btn btn-sm" data-act="series-restore" data-id="' + esc(rs.id) + '">' + icon('rotate', 'i14') + '恢复到词书</button>' +
            '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // —— 导入与制作 ——（同步到「卡片」页供学习）
    html += '<div class="card wide studio">' +
      '<div class="studio-head"><div class="studio-title">导入与制作</div>' +
      '<div class="studio-sub">从文件导入词库，或新建牌组制作卡片</div></div>' +
      '<div class="studio-grid">' +
      '<div class="studio-col">' +
      '<div class="studio-col-t">' + icon('download', 'i14') + '导入' +
      '<button class="studio-help" data-act="import-formats" title="查看支持的格式">' + icon('info', 'i14') + '</button></div>' +
      '<button class="studio-act primary" data-act="import-hub">' + icon('download', 'i20') +
      '<span><b>导入词库</b><small>支持 .srcd / .apkg / CSV</small></span></button>' +
      '<button class="studio-act" data-act="import-formats">' + icon('info', 'i18') +
      '<span><b>支持的格式</b><small>查看每种格式的说明</small></span></button>' +
      '</div>' +
      '<div class="studio-col">' +
      '<div class="studio-col-t">' + icon('pencil', 'i14') + '制作</div>' +
      '<button class="studio-act primary" data-act="new-deck">' + icon('plus', 'i18') +
      '<span><b>新建牌组</b><small>从零创建一个卡片集</small></span></button>' +
      '<button class="studio-act" data-act="card-new-global">' + icon('card', 'i18') +
      '<span><b>添加卡片</b><small>手动编写单张卡片</small></span></button>' +
      '</div></div>' +
      '<div class="studio-note">导入或新建的牌组会落在下方「牌组」；属于某个系列的分册，会归到该系列之下。</div>' +
      '</div>';

    // —— 牌组：先按系列归组（系列 = 主文件，其分册 / 卡为子文件），再列自建牌组 ——
    const split = splitDecksBySeries(st, seriesList);
    if (st.decks.length === 0) {
      html += '<div class="section-title">牌组</div>';
      html += '<div class="card wide wb-welcome">' +
        '<div class="ww-hero"><span class="ww-ico">' + icon('book', 'i28') + '</span>' +
        '<div><b>从这里开始你的词库</b><small>闪星卡默认不带任何词库。导入一份词库，或自己动手做，学习卡片会自动出现在这里。</small></div></div>' +
        '<div class="ww-steps">' +
        '<div class="ww-step"><span class="ww-n">1</span><div><b>导入现成词库</b><small>支持闪星 .srcd、Anki .apkg / .colpkg、CSV，导入后自动成为一个系列</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="import-hub">去导入</button></div>' +
        '<div class="ww-step"><span class="ww-n">2</span><div><b>自己制作</b><small>新建牌组手动添加卡片，或按行批量粘贴正反面</small></div>' +
        '<button class="btn btn-sm" data-act="new-deck">新建牌组</button></div>' +
        '<div class="ww-step"><span class="ww-n">3</span><div><b>开始学习</b><small>做好的牌组会同步到「卡片」页，用 FSRS 科学间隔重复复习</small></div>' +
        '<button class="btn btn-sm" data-act="tab" data-tab="0">前往卡片</button></div>' +
        '</div></div>';
    } else {
      for (let si = 0; si < seriesList.length; si++) {
        const se = seriesList[si];
        const ds = split.bySeries[se.id];
        if (!ds || !ds.length) continue;
        let cardSum = 0;
        for (let k = 0; k < ds.length; k++) cardSum += ds[k].cards.length;
        const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
        html += '<div class="series-group' + (collapsed ? ' collapsed' : '') + '">' +
          '<div class="sg-head"><button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>' +
          '<span class="sg-name">' + esc(se.name) + '</span>' +
          '<span class="sg-meta">' + ds.length + ' 个分册 · 含 ' + cardSum + ' 张卡</span>' +
          '<button class="btn btn-sm sg-go" data-act="series-open" data-id="' + esc(se.id) + '">查看系列</button></div>';
        for (let i = 0; i < ds.length; i++) html += deckListItem(app, ds[i], s, now, true);
        html += '</div>';
      }
      if (split.userDecks.length) {
        html += '<div class="section-title">牌组 · 自建</div>';
        for (let i = 0; i < split.userDecks.length; i++) html += deckListItem(app, split.userDecks[i], s, now, false);
      }
    }

    // —— 自定义词书：仅在确有数据时展示，避免长期出现一个永远为空的区块 ——
    if (app.state.wordBooks && app.state.wordBooks.length) {
      html += '<div class="section-title">我的词书（自定义）</div>';
      for (let i = 0; i < app.state.wordBooks.length; i++) {
        const b = app.state.wordBooks[i];
        html += bookCard(app, b, app.wordProgressOf(b.id, b.words.length), true);
      }
    }
    html += '</div>'; // 闭合 .content，确保 tabbar 作为 #root 独立侧栏，而非被塞进内容区
    return html + tabbar(1, app);
  }

  // 把牌组按系列归组：属于某系列 tagKey 的归到该系列之下，其余算自建牌组。
  // 这样「系列 = 主文件，其分册 / 卡 = 子文件」的层级在「牌组」列表里也一目了然。
  function splitDecksBySeries(st, seriesList) {
    const bySeries = {};
    for (let i = 0; i < seriesList.length; i++) bySeries[seriesList[i].id] = [];
    const userDecks = [];
    for (let i = 0; i < st.decks.length; i++) {
      const d = st.decks[i];
      const tags = d.tags || [];
      let placed = false;
      for (let j = 0; j < seriesList.length; j++) {
        if (tags.indexOf(seriesList[j].tagKey) >= 0) { bySeries[seriesList[j].id].push(d); placed = true; break; }
      }
      if (!placed) userDecks.push(d);
    }
    return { bySeries: bySeries, userDecks: userDecks };
  }

  // 牌组列表项（学习进度 + 管理 / 更多）
  function deckListItem(app, d, s, now, isSat) {
    const c = s.deckCounts(d, now);
    const total = d.cards.length;
    let inProgress = 0;
    for (let k = 0; k < d.cards.length; k++) {
      const cc = d.cards[k];
      if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
    }
    const mastered = Math.max(0, total - c[0] - inProgress);
    const pct = total ? Math.round(mastered / total * 100) : 0;
    const chips = (c[0] || c[1])
      ? '<span class="deck-chips">' + (c[0] ? '<span class="dchip dc-new">新 ' + c[0] + '</span>' : '') +
        (c[1] ? '<span class="dchip dc-due">到期 ' + c[1] + '</span>' : '') + '</span>'
      : (total > 0 ? '<span class="deck-chips"><span class="dchip dc-done">已完成</span></span>' : '');
    return '<div class="list-item deck-item" data-act="deck-open" data-id="' + esc(d.id) + '">' +
      '<div class="avatar deck-av av-tone-' + (function () { let h = 0, k = String(d.id || d.name || ''); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return h % 8; })() + '">' + icon(isSat ? 'book' : 'layers', 'i20') + '</div>' +
      '<div class="li-main"><div class="deck-name-row">' +
      '<div class="name">' + esc(d.name) + '</div>' + chips +
      '<span class="deck-ring' + (pct >= 100 && total > 0 ? ' done' : '') + '" style="--p:' + pct + '" title="已掌握 ' + pct + '%"><b>' + pct + '%</b></span></div>' +
      '<div class="meta">' + (d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + mastered + ' / ' + total + ' 张' +
      (total && mastered >= total ? ' · 全部掌握' : '') + '</div>' +
      '<div class="progress deck-prog"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="li-actions"><button class="btn btn-sm" data-act="deck-open" data-id="' + esc(d.id) + '">管理</button>' +
      '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(d.id) + '" title="更多操作">' + icon('more', 'i16') + '</button></div>' +
      '</div>';
  }

  // 词书页的系列入口：文件夹式卡片，展示分册数 / 词数 / 掌握进度
  function seriesFolderCard(app, series) {
    const ov = FC.seriesOverview ? FC.seriesOverview(app.state, series) : null;
    const vols = ov ? ov.volumes.length : 0;
    const total = ov ? ov.total : 0;
    const pct = ov ? ov.pct : 0;
    const loaded = ov ? ov.loaded : false;
    const accent = series.accent || 'brand';
    // 分册进度矩阵：每一小格 = 一个分册，颜色表示状态，一眼看全整套进度
    let matrix = '';
    if (loaded && ov.volumes.length) {
      for (let i = 0; i < ov.volumes.length; i++) {
        const v = ov.volumes[i];
        matrix += '<span class="sf-cell s-' + esc(v.status) + '" title="' + esc(v.name) + ' · 掌握 ' + v.mastered + '/' + v.cards + '"></span>';
      }
    }
    return '<div class="series-folder accent-' + esc(accent) + '" data-act="series-open" data-id="' + esc(series.id) + '">' +
      '<div class="sf-cover"><span class="sf-icon">' + icon(series.icon || 'folder', 'i24') + '</span></div>' +
      '<div class="sf-body">' +
      '<div class="sf-head"><div class="sf-name">' + esc(series.name) + '</div>' +
      '<span class="sf-badge">' + esc(loaded ? (pct + '%') : ((series.volCount || vols) + ' 册')) + '</span></div>' +
      '<div class="sf-meta">' + (loaded ? vols : (series.volCount || 0)) + ' 分册 · ' + (loaded ? total : (series.cardCount || 0)) + ' 卡' +
      (loaded ? (' · 掌握 ' + (ov ? ov.mastered : 0)) : ' · 待导入') + '</div>' +
      (matrix ? '<div class="sf-matrix">' + matrix + '</div>' : '') +
      '<div class="progress sf-prog"><span style="width:' + pct + '%"></span></div>' +
      '</div>' +
      '</div>';
  }

  // 系列详情页：顶部概览 + 建议 + 分册网格
  function seriesPage(app) {
    const series = FC.seriesById ? FC.seriesById(app.seriesId, app.state) : null;
    if (!series) {
      return titlebar('系列', '未找到该系列', { actions: '<button class="btn btn-sm" data-act="series-back">返回词书</button>' }) +
        '<div class="content"><div class="card wide subtle">系列不存在或已被移除。</div></div>' + tabbar(1, app);
    }
    const ov = FC.seriesOverview ? FC.seriesOverview(app.state, series) : null;
    const accent = series.accent || 'brand';
    const s = new FC.Scheduler(app.state.settings);
    const now = Date.now();

    let html = titlebar(series.name, '系列 · ' + (series.subtitle || ''), {
      actions: '<button class="btn btn-sm" data-act="series-back">' + icon('chevronLeft', 'i14') + '返回词书</button>' +
        (ov && ov.loaded ? '<button class="btn btn-sm btn-primary" data-act="series-export" data-id="' + esc(series.id) + '">' +
          icon('upload', 'i14') + '导出词库</button>' : '') +
        (ov && ov.loaded ? '<button class="btn btn-sm btn-danger" data-act="series-delete" data-id="' + esc(series.id) + '">' +
          icon('trash', 'i14') + '删除整个词库</button>' : '')
    }) + '<div class="content">';

    // 系列头：文件夹封面 + 指标 + 进度环 + 建议条（复用克制仪表盘风）
    const adv = ov.advice;
    const ctaCls = adv.tone === 'brand' ? 'btn-primary' : (adv.tone === 'green' ? 'btn-accent' : 'btn-sm');
    const figs = function (v, k, tone) {
      return '<div class="ov-fig' + (tone ? ' tone-' + tone : '') + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>';
    };
    html += '<div class="overview-hero series-hero accent-' + esc(accent) + '">' +
      '<div class="ov-body"><div class="series-cover accent-' + esc(accent) + '">' + icon(series.icon || 'folder', 'i44') + '</div>' +
      '<div class="ov-left">' +
      '<div class="ov-date">系列 · 可导入词库 · ' + (series.source ? esc(series.source) : '') + '</div>' +
      '<div class="ov-hello">' + esc(series.name) + '</div>' +
      '<div class="ov-caption">' + esc(series.description || series.subtitle || '') + '</div>' +
      '<div class="ov-figs">' +
      figs(ov.loaded ? ov.volumes.length : (series.volCount || 0), '分册') +
      figs(ov.loaded ? ov.total : (series.cardCount || 0), '总卡片') +
      figs(ov.mastered, '已掌握', 'brand') +
      figs(ov.due, '待复习', 'amber') +
      '</div></div>' +
      '<div class="ov-ring" style="--pct:' + ov.pct + '"><div class="ov-ring-in">' +
      '<b>' + ov.pct + '%</b><span>掌握进度</span></div></div></div>' +
      '<div class="ov-advice tone-' + esc(adv.tone) + '">' +
      '<span class="ov-adv-ico">' + icon(adv.icon, 'i18') + '</span>' +
      '<div class="ov-adv-txt"><div class="ov-adv-title">' + esc(adv.title) + '</div>' +
      '<div class="ov-adv-desc">' + esc(adv.desc) + '</div></div>' +
      '<button class="btn btn-sm ' + ctaCls + '" data-act="' + esc(adv.act) + '"' +
      (adv.sid ? ' data-id="' + esc(adv.sid) + '"' : '') +
      (adv.tab !== undefined ? ' data-tab="' + adv.tab + '"' : '') + '>' + esc(adv.cta) + '</button>' +
      '</div></div>';

    if (!ov.loaded) {
      html += '<div class="card wide series-note">' + icon('download', 'i18') +
        '<span>本系列是独立词库文件，尚未导入。请在软件旁的 <b>decks</b> 文件夹中找到 <b>' + esc(series.file || '对应 .srcd') + '</b>，点击右侧按钮选择它。导入后 ' +
        (series.volCount || 0) + ' 个分册会作为独立牌组出现在「卡片」页，进度在此汇总。</span>' +
        '<button class="btn btn-primary btn-sm" data-act="series-import" data-id="' + esc(series.id) + '">导入卡片</button></div>';
    } else {
      html += '<div class="section-title">' + icon('layers', 'i14') + '分册目录 · 按 List 顺序学习</div>';
      html += '<div class="series-vols">';
      for (let i = 0; i < ov.volumes.length; i++) {
        const v = ov.volumes[i];
        const stIcon = v.status === 'mastered' ? 'checkCircle' : (v.status === 'learning' ? 'rotate' :
          (v.status === 'progress' ? 'play' : 'play'));
        const stText = v.status === 'mastered' ? '已掌握' : (v.status === 'learning' ? '巩固中' :
          (v.status === 'progress' ? '学习中' : '未开始'));
        const todo = ' · 待学 ' + (v.fresh + v.due) + (v.due ? '（复习 ' + v.due + '）' : '');
        html += '<div class="vol-card status-' + esc(v.status) + '">' +
          '<div class="vol-top">' +
          '<div class="vol-no">' + esc(v.label) + '</div>' +
          '<span class="vol-status s-' + esc(v.status) + '">' + icon(stIcon, 'i14') + esc(stText) + '</span>' +
          '</div>' +
          '<div class="vol-cards">' + v.cards + ' 张卡' + todo + '</div>' +
          '<div class="progress vol-prog"><span style="width:' + v.pct + '%"></span></div>' +
          '<div class="vol-mastered">已掌握 ' + v.mastered + ' / ' + v.cards + '</div>' +
          '<div class="vol-actions">' +
          '<button class="btn btn-sm btn-primary" data-act="study-deck" data-id="' + esc(v.id) + '">' + icon('play', 'i14') + '学习</button>' +
          '<button class="btn btn-sm" data-act="deck-open" data-id="' + esc(v.id) + '">管理</button>' +
          '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(v.id) + '" title="更多操作">' + icon('more', 'i16') + '</button>' +
          '</div></div>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html + tabbar(1, app);
  }

  function bookCard(app, b, prog, custom) {
    const pct = b.words.length ? Math.round(prog[0] / b.words.length * 100) : 0;
    return '<div class="book-card">' +
      '<div class="row" style="align-items:flex-start">' +
      '<div class="avatar">' + icon('book', 'i20') + '</div>' +
      '<div class="li-main"><div class="name">' + esc(b.name) + '</div>' +
      '<div class="meta">' + (b.category ? esc(b.category) + ' · ' : '') + b.words.length + ' 词</div></div>' +
      '</div>' +
      '<div class="progress" style="margin-top:14px"><span style="width:' + pct + '%"></span></div>' +
      '<div class="between" style="margin-top:8px">' +
      '<span class="subtle">已掌握 ' + prog[0] + ' / ' + b.words.length + '</span>' +
      '<span class="subtle">模糊 ' + prog[1] + '</span></div>' +
      '<div class="book-actions">' +
      '<button class="btn btn-sm btn-primary" data-act="wb-start" data-id="' + esc(b.id) + '">' +
      icon('play', 'i14') + '学习</button>' +
      '<button class="btn btn-sm" data-act="wb-review" data-id="' + esc(b.id) + '">复习模糊</button>' +
      (custom ? '<span style="flex:1"></span><button class="btn btn-sm btn-danger" data-act="wb-del" data-id="' +
        esc(b.id) + '">' + icon('trash', 'i14') + '</button>' : '') +
      '</div></div>';
  }

  function wordBookSession(app) {
    const w = app.wb;
    // 会话数据可能来自旧版本本地存档：字段缺失时不要抛错白屏，给一个可退出的提示页
    if (!w || !w.queue || !w.words) {
      return '<div class="fullscreen"><div class="battle-head"><div class="h-title">词书学习</div></div>' +
        '<div class="study-area"><div class="card" style="text-align:center;max-width:360px;padding:28px 22px;margin:0">' +
        '<div style="font-weight:700;font-size:16px">这次学习记录无法恢复</div>' +
        '<div class="subtle" style="margin-top:8px">进度数据不完整，返回后重新选择词书即可。</div>' +
        '<button class="btn btn-primary" style="margin-top:18px" data-act="wb-stop">返回</button>' +
        '</div></div></div>';
    }
    const total = w.queue.length;
    const pct = total ? Math.round(w.pos / total * 100) : 0;
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title">' + esc(w.bookName) + '</div>' +
      '<div class="subtle" style="margin-top:3px">' + (w.mode === 1 ? '复习模糊词' : '顺序学习') +
      ' · ' + w.pos + ' / ' + total + '</div></div>' +
      '<button class="btn btn-sm btn-ghost" data-act="wb-stop">退出</button></div>' +
      '<div class="progress" style="margin-top:14px"><span style="width:' + pct + '%"></span></div></div>';

    if (w.pos >= w.queue.length) {
      html += '<div class="study-area"><div class="card" style="text-align:center;width:100%;max-width:350px;padding:32px 22px;margin:0">' +
        '<div style="display:flex;justify-content:center;color:var(--green)">' + icon('checkCircle', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:14px">本轮完成</div>' +
        '<div class="subtle" style="margin-top:8px">认识 ' + w.known + ' · 模糊 ' + w.fuzzy + ' · 不认识 ' + w.unknown + '</div>' +
        '<button class="btn btn-primary" style="margin-top:20px" data-act="wb-stop">返回</button></div></div>';
      return html + '</div>';
    }
    const entry = w.words[w.queue[w.pos]];
    html += '<div class="study-area"><div class="flip-card" data-act="wb-flip">' +
      '<div class="flip-inner ' + (w.revealed ? 'flipped' : '') + '">' +
      '<div class="flip-face flip-front"><div class="wb-word">' + esc(entry.word) + '</div>' +
      '<div class="wb-phon">' + esc(entry.phonetic) + '</div>' +
      '<div class="flip-hint">点击 / 空格 看释义</div></div>' +
      '<div class="flip-face flip-back"><div class="wb-mean">' + esc(entry.meaning) + '</div>' +
      '<div class="wb-ex">' + esc(entry.example) + '<br>' + esc(entry.exampleCn) + '</div>' +
      '<div class="flip-hint">空格 = 认识 · 1-3 评分</div></div></div></div></div>';

    if (w.revealed) {
      html += '<div class="wb-actions">' +
        '<button class="btn r1" data-act="wb-rate" data-status="0">不认识</button>' +
        '<button class="btn r2" data-act="wb-rate" data-status="1">模糊</button>' +
        '<button class="btn btn-primary" data-act="wb-rate" data-status="2">认识</button>' +
        '</div>';
    } else {
      html += '<div class="rate-bar"><button class="rate-btn r3" data-act="wb-flip">' +
        '<span class="rate-key">Enter / Space</span>' +
        '<span class="rate-label">显示释义</span>' +
        '<span class="rate-meta">翻面看答案 · 按 Enter 或空格</span></button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 班级
  function classroomList(app) {
    let html = titlebar('班级', '一起攒积分', {
      actions: '<button class="btn btn-sm btn-primary" data-act="class-new">' + icon('plus', 'i14') + '创建班级</button>'
    }) + '<div class="content">';
    html += '<button class="btn btn-block" data-act="class-join">' +
      icon('key', 'i16') + '用邀请码加入班级</button>';
    if (app.state.classrooms.length === 0) {
      html += emptyBox('users', '还没有班级。建一个，或者用邀请码加入。');
    } else {
      for (let i = 0; i < app.state.classrooms.length; i++) {
        const c = app.state.classrooms[i];
        html += '<div class="list-item" data-act="class-open" data-id="' + esc(c.id) + '">' +
          '<div class="avatar">' + icon('users', 'i20') + '</div>' +
          '<div class="li-main"><div class="name">' + esc(c.name) + '</div>' +
          '<div class="meta">邀请码 ' + esc(c.code) + ' · ' + c.members.length + ' 人</div></div>' +
          '<span class="chev">' + icon('chevronRight', 'i18') + '</span></div>';
      }
    }
    html += '</div>';
    return html + tabbar(2, app);
  }

  function classroomDetail(app) {
    const c = app.activeClass();
    let html = titlebar(c ? c.name : '班级', c ? ('班级 · ' + c.members.length + ' 名成员') : '', {
      back: { act: 'class-back' },
      actions: c ? '<button class="btn btn-sm btn-primary" data-act="member-add" data-id="' + esc(c.id) + '">' +
        icon('plus', 'i14') + '添加成员</button>' : ''
    }) + '<div class="content">';
    if (!c) { html += emptyBox('users', '这个班级不在了'); return html + tabbar(2, app); }
    html += '<div class="card wide"><div class="between">' +
      '<div><div class="subtle">班级邀请码</div>' +
      '<div class="mono" style="font-size:15px;font-weight:600;letter-spacing:.8px;margin-top:3px">' +
      esc(c.code) + '</div></div>' +
      (c.description ? '<div class="subtle" style="text-align:right;max-width:60%">' + esc(c.description) + '</div>' : '') +
      '</div></div>';
    html += '<div class="section-title">积分榜</div>';
    const sorted = c.members.slice().sort(function (a, b) { return b.score - a.score; });
    if (sorted.length === 0) {
      html += emptyBox('trophy', '还没有成员，右上角加一个');
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const m = sorted[i];
        const g = i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
        html += '<div class="list-item" style="padding:13px 16px">' +
          '<span class="rank ' + g + '">' + (i + 1) + '</span>' +
          '<div class="li-main"><div class="name" style="font-size:14.5px">' + esc(m.name) + '</div></div>' +
          '<div style="font-weight:700;color:var(--primary);font-size:13.5px">' + m.score + ' 分</div></div>';
      }
    }
    html += '</div>';
    return html + tabbar(2, app);
  }

  function deskmatePage(app) {
    let html = titlebar('同桌', '互相看一眼进度', {
      actions: '<button class="btn btn-sm btn-primary" data-act="deskmate-add">' + icon('plus', 'i14') + '添加同桌</button>'
    }) + '<div class="content">';
    if (app.state.deskmates.length === 0) {
      html += emptyBox('link', '加上同桌，就能看到彼此今天学了多少。');
    } else {
      for (let i = 0; i < app.state.deskmates.length; i++) {
        const d = app.state.deskmates[i];
        html += '<div class="list-item">' +
          '<div class="avatar">' + icon('link', 'i18') + '</div>' +
          '<div class="li-main"><div class="name" style="font-size:14.5px">' + esc(d.name) + '</div>' +
          '<div class="meta">' + (d.note ? esc(d.note) + ' · ' : '') + '连续 ' + d.days + ' 天 · ' + d.score + ' 分</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          '<button class="btn btn-sm" data-act="deskmate-urge" data-id="' + esc(d.id) + '">督促</button>' +
          '<button class="btn btn-sm btn-danger" data-act="deskmate-del" data-id="' + esc(d.id) + '">' +
          icon('trash', 'i14') + '</button>' +
          '</div></div>';
      }
    }
    html += '</div>';
    return html + tabbar(3, app);
  }

  // ---------------------------------------------------------------- PK
  function battleConfig(app) {
    const books = app.battleBooks ? app.battleBooks() : allBooks(app);
    let html = titlebar('比赛', '同屏轮流，答对得分') + '<div class="content">';
    if (!books.length) {
      html += '<div class="card wide" style="text-align:center;padding:34px 22px">' +
        '<div style="display:flex;justify-content:center;color:var(--brand)">' + icon('zap', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:17px;margin-top:14px">还没有可以比赛的词库</div>' +
        '<div class="subtle" style="margin-top:8px">导入一个词库（.srcd / Anki .apkg）或新建牌组，至少 4 张卡片就能开局。</div>' +
        '<div class="row-gap" style="justify-content:center;margin-top:18px">' +
        '<button class="btn btn-primary" data-act="import-hub">' + icon('download', 'i16') + '导入词库</button>' +
        '<button class="btn" data-act="new-deck">' + icon('plus', 'i16') + '新建牌组</button>' +
        '</div></div>';
      return html + '</div>' + tabbar(4, app);
    }
    html += '<div class="pk-hero wide">' +
      '<div class="pk-side"><span class="pk-ava">我</span><b>你</b><small>先手</small></div>' +
      '<span class="pk-vs">VS</span>' +
      '<div class="pk-side pk-right"><span class="pk-ava pk-ava-alt">?</span><b>对手</b><small>2 – 4 人</small></div>' +
      '</div>';
    html += '<div class="card wide">' +
      '<div class="field"><label>用哪本词书</label><select id="battleBook">' +
      books.map(function (b) {
        return '<option value="' + esc(b.id) + '"' + (b.id === app.battleBookId ? ' selected' : '') + '>' +
          esc(b.name) + '（' + b.words.length + ' 词）</option>';
      }).join('') +
      '</select></div>' +
      '<div class="field"><label>都有谁</label>' +
      '<input id="battlePlayers" value="' + esc(app.battlePlayersText) + '" placeholder="我,同桌A,同桌B" />' +
      '<div class="hint">用逗号隔开，2 到 4 个人。</div></div>' +
      '<div class="field"><label>每人几张牌</label>' +
      '<input id="battleHand" value="' + esc(app.battleHandText) + '" placeholder="10" />' +
      '<div class="hint">从词书里随机发牌，不够就按词数平分。</div></div>' +
      '</div>';
    html += '<button class="btn btn-primary btn-block pk-start" data-act="battle-begin">' +
      icon('zap', 'i18') + '开始比赛</button>';
    html += '<div class="pk-rules">轮到你时，从别人手里抽一张，四选一。答对你 +10 分，答错出牌的人 +5 分。10 回合后分高者赢。</div>';
    html += '</div>';
    return html + tabbar(4, app);
  }

  function battleSession(app) {
    const b = app.battle;
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title" style="display:flex;align-items:center;gap:6px">' +
      '<span style="color:var(--primary);display:flex">' + icon('zap', 'i18') + '</span>比赛</div>' +
      '<div class="subtle" style="margin-top:3px">' + esc(b.bookName) + ' · 第 ' + b.turn + ' / ' + b.maxTurns + ' 回合</div></div>' +
      '<button class="btn btn-sm btn-ghost" data-act="battle-exit">退出</button></div>' +
      '<div class="players">';
    for (let i = 0; i < b.players.length; i++) {
      html += '<div class="pcard ' + (i === b.current ? 'cur' : '') + '">' +
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.players[i]) + '</div>' +
        '<div class="sc">' + b.scores[i] + '</div>' +
        '<div class="rest">剩 ' + (b.hands[i] ? b.hands[i].length : 0) + '</div></div>';
    }
    html += '</div></div>';

    if (b.phase === 1) {
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:var(--primary)">' + icon('rotate', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:14px">轮到 ' + esc(b.players[b.current]) + '</div>' +
        '<div class="subtle" style="margin-top:8px">别偷看别人的牌，准备好了就点开始。</div>' +
        '<button class="btn btn-primary" style="margin-top:20px" data-act="battle-pass">我是 ' +
        esc(b.players[b.current]) + '，开始</button>' +
        '</div></div>';
    } else if (b.phase === 2) {
      const entry = b.words[b.cardIdx];
      html += '<div class="study-area"><div class="battle-card" style="max-width:350px">' +
        '<div class="subtle" style="text-align:center">' + esc(b.players[b.current]) + ' 抽到 ' +
        esc(b.players[b.owner]) + ' 的这张卡</div>' +
        '<div class="wb-word" style="text-align:center;margin-top:8px">' + esc(entry.word) + '</div>' +
        '<div class="wb-phon" style="text-align:center">' + esc(entry.phonetic) + '</div>' +
        '<div style="margin-top:18px">';
      for (let i = 0; i < b.options.length; i++) {
        const cls = b.picked === i ? (i === b.correct ? 'correct' : 'wrong') : '';
        html += '<button class="opt ' + cls + '" data-act="battle-choose" data-i="' + i + '">' +
          '<span class="opt-letter">' + 'ABCD'.charAt(i) + '</span>' +
          '<span>' + esc(b.options[i]) + '</span></button>';
      }
      html += '</div></div></div>';
    } else if (b.phase === 3) {
      const entry = b.words[b.cardIdx];
      const pickedRight = b.picked === b.correct;
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:' + (pickedRight ? 'var(--green)' : 'var(--red)') + '">' +
        icon(pickedRight ? 'checkCircle' : 'closeCircle', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:12px">' + (pickedRight ? '答对了' : '答错了') + '</div>' +
        '<div class="wb-word" style="margin-top:14px">' + esc(entry.word) + '</div>' +
        '<div class="wb-mean">' + esc(entry.meaning) + '</div>' +
        '<div class="subtle" style="margin-top:10px">' + esc(b.lastGain) + '</div>' +
        '<button class="btn btn-primary" style="margin-top:18px" data-act="battle-next">下一回合</button>' +
        '</div></div>';
    } else if (b.phase === 4) {
      const rank = b.scores.map(function (s, i) { return { i: i, s: s }; })
        .sort(function (a, c) { return c.s - a.s; });
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:#C08A18">' + icon('trophy', 'i44') + '</div>' +
        '<div style="font-weight:750;font-size:18px;margin-top:12px">' + esc(b.lastGain) + '</div>' +
        '<div style="margin-top:14px;text-align:left">';
      for (let k = 0; k < rank.length; k++) {
        const g = k === 0 ? 'g1' : k === 1 ? 'g2' : k === 2 ? 'g3' : '';
        html += '<div class="rank-row"><span class="rank ' + g + '">' + (k + 1) + '</span>' +
          '<span style="flex:1">' + esc(b.players[rank[k].i]) + '</span>' +
          '<b style="font-size:14px">' + rank[k].s + ' 分</b></div>';
      }
      html += '</div><button class="btn btn-primary" style="margin-top:18px" data-act="battle-exit">返回</button></div></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 数据页
  function statsPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    let totalCards = 0, totalDue = 0, totalNew = 0;
    for (let i = 0; i < st.decks.length; i++) {
      const c = s.deckCounts(st.decks[i], now);
      totalNew += c[0]; totalDue += c[1]; totalCards += st.decks[i].cards.length;
    }
    const today = FC.dateKey(now);
    let todayReviews = 0;
    for (let i = 0; i < st.stats.length; i++) if (st.stats[i].date === today) todayReviews = st.stats[i].reviews;
    const retention = s.retentionFromLogs(st.decks);

    // 今日平均每题耗时（有复习才显示）
    let timeToday = 0;
    for (let i = 0; i < st.stats.length; i++) if (st.stats[i].date === today) timeToday = st.stats[i].timeMs || 0;
    const avgSec = todayReviews > 0 ? Math.max(1, Math.round(timeToday / todayReviews / 1000)) : 0;

    // 累计复习次数：为 0 时不展示十块全 0 的图表，改成一个明确的空状态
    let totalReviews = 0;
    for (let i = 0; i < st.stats.length; i++) totalReviews += st.stats[i].reviews || 0;

    let html = titlebar('数据', '学习统计') + '<div class="content">';

    // 连续打卡（空状态 / 正常状态都显示，顶部第一块）
    html += streakCardHtml(st, now);

    if (totalReviews === 0) {
      html += '<div class="stat-grid">' +
        statBox(totalCards, '卡片总数', false, 'cards') +
        statBox(todayReviews, '今日复习', true, 'rotate') +
        statBox(totalNew, '待学新卡', false, 'plus') +
        statBox(totalDue, '今日到期', false, 'clock') + '</div>';
      html += '<div class="data-empty">' +
        '<span class="de-ico">' + icon(totalCards > 0 ? 'chart' : 'cards', 'i26') + '</span>' +
        '<b>' + (totalCards > 0 ? '还没有学习记录' : '还没有词库') + '</b>' +
        '<p>' + (totalCards > 0
          ? '学完第一张卡后，这里会显示留存率、间隔分布、学习热力图，以及未来 7 天的到期预测。'
          : '先导入一套词库（.srcd / Anki .apkg / CSV），或新建一个牌组，再回来这里看统计。') + '</p>' +
        '<div class="de-actions">' +
        (totalCards > 0
          ? '<button class="btn btn-primary btn-sm" data-act="study-all">' + icon('play', 'i14') + '开始学习</button>' +
            '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览卡片</button>'
          : '<button class="btn btn-primary btn-sm" data-act="import-hub">' + icon('upload', 'i14') + '导入词库</button>' +
            '<button class="btn btn-sm" data-act="new-deck">' + icon('plus', 'i14') + '新建牌组</button>') +
        '</div></div>';
      return html + '</div>' + tabbar(5, app);
    }

    html += '<div class="stat-grid">' +
      statBox(totalCards, '卡片总数', false, 'cards') +
      statBox(todayReviews, '今日复习', true, 'rotate') +
      statBox(totalNew, '待学新卡', false, 'plus') +
      statBox(totalDue, '今日到期', false, 'clock') +
      statBox((retention * 100).toFixed(0) + '%', '真实留存率', false, 'chart') +
      statBox(avgSec ? avgSec + ' 秒' : '—', '今日每题耗时', false, 'clock') +
      statBox(st.battleRecords.length, 'PK 局数', false, 'trophy') + '</div>';

    // —— 本周概览：复习量环比 + 留存建议 ——
    let weekCur = 0, weekPrev = 0;
    for (let i = 0; i < st.stats.length; i++) {
      const e = st.stats[i];
      const t = Date.parse(e.date + 'T00:00:00');
      if (isNaN(t)) continue;
      const diff = Math.floor((now - t) / FC.DAY_MS);
      if (diff >= 0 && diff < 7) weekCur += e.reviews || 0;
      else if (diff >= 7 && diff < 14) weekPrev += e.reviews || 0;
    }
    const deltaTxt = weekPrev > 0
      ? (weekCur >= weekPrev ? '比上周多 ' + Math.round((weekCur - weekPrev) / weekPrev * 100) + '%'
        : '比上周少 ' + Math.round((weekPrev - weekCur) / weekPrev * 100) + '%')
      : (weekCur > 0 ? '暂无上周数据' : '');
    html += '<div class="insight-bar">' + icon('chart', 'i18') + '<div class="ib-txt">' +
      '<b>' + (weekCur > 0
        ? ('本周已复习 ' + weekCur + ' 次，真实留存 ' + (retention * 100).toFixed(0) + '%')
        : '本周暂无复习记录') + '</b>' +
      '<small>' + (weekCur > 0
        ? (deltaTxt ? deltaTxt + '。' : '') + (retention >= 0.85
          ? '留存率高于目标，可保持当前设置。'
          : (retention >= 0.7
            ? '可将目标留存率调整为 0.9，增加复习频率。'
            : '建议减少每日新卡数量，优先处理到期卡片。'))
        : '在「卡片」页完成一次学习后，这里会显示统计。') + '</small></div></div>';

    if (FCUI.aiDiagnosis) html += FCUI.aiDiagnosis(app);
    if (FCUI.analyticsBlocks) html += FCUI.analyticsBlocks(app);

    // —— 需要重点关注：本机算力按复习优先级综合算出（可提取度 / 逾期 / 遗忘 / 难度）——
    const ra = (FC.AI && FC.AI.REVIEW_ANALYSIS) ? FC.AI.REVIEW_ANALYSIS(app) : null;
    const weak = ra ? ra.items.filter(function (x) { return x.lapses > 0 || x.R < 0.85 || x.leeched; }).slice(0, 6) : [];
    if (weak.length) {
      const maxU = Math.max(1, weak[0].urgency);
      html += '<div class="section-title">需要重点关注 · 本机按复习优先级排序</div><div class="card wide weak-list">';
      html += '<div class="insight-bar" style="margin-bottom:10px">' + icon('target', 'i16') + '<div class="ib-txt">' +
        '<b>到期 ' + ra.dueCnt + ' 张 · 可提取度偏低 ' + ra.lowRCnt + ' 张</b>' +
        '<small>按本机 FSRS 估算，集中复习约 ' + ra.minutes + ' 分钟（每张约 ' + ra.avgSec + ' 秒）可过一遍。</small></div></div>';
      for (let i = 0; i < weak.length; i++) {
        const w = weak[i];
        let txt = String(w.card.front || '').replace(/<[^>]*>/g, ' ')
          .replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
        if (txt.length > 24) txt = txt.slice(0, 24) + '…';
        const why = '可提取度 ' + w.retention + '%' + (w.overdueDays > 0 ? ' · 逾期 ' + w.overdueDays + ' 天' : '') + ' · 忘 ' + w.lapses + ' 次';
        html += '<div class="weak-row">' +
          '<span class="weak-word">' + esc(txt || '(无标题)') +
          (w.leeched ? '<span class="weak-tag">Leech</span>' : '') + '</span>' +
          '<span class="weak-deck">' + esc(why) + '</span>' +
          '<span class="weak-bar"><span style="width:' + Math.round(w.urgency / maxU * 100) + '%"></span></span>' +
          '<b class="weak-n">' + w.retention + '%</b></div>';
      }
      html += '<div class="subtle" style="margin-top:10px">可提取度越低、逾期越久、遗忘越多，越该优先复习。想集中攻克，可用「自定义学习」按 Leeched / 已标记筛出这些卡。</div></div>';
    }

    html += '<div class="section-title">未来 7 天到期分布</div><div class="card wide"><div class="chart">';
    const f = s.forecast(st.decks, now, 7);
    const max = Math.max(1, Math.max.apply(null, f));
    for (let i = 0; i < 7; i++) {
      const d = new Date(now + i * FC.DAY_MS);
      const label = i === 0 ? '今天' : (i === 1 ? '明天' : (d.getMonth() + 1) + '/' + d.getDate());
      const h = Math.max(2, Math.round(f[i] / max * 100));
      html += '<div class="chart-col">' +
        '<span class="bar-v">' + f[i] + '</span>' +
        '<span class="bar-track"><span class="bar' + (f[i] === 0 ? ' zero' : '') +
        '" style="height:' + h + '%"></span></span>' +
        '<span class="bar-l">' + label + '</span></div>';
    }
    html += '</div></div>';

    html += '<div class="section-title">词书进度</div><div class="card">';
    const books = allBooks(app);
    let any = false;
    for (let i = 0; i < books.length; i++) {
      const p = app.wordProgressOf(books[i].id, books[i].words.length);
      if (p[0] > 0 || p[1] > 0) {
        any = true;
        html += '<div style="padding:7px 0">' +
          '<div style="font-size:13.5px">' + esc(books[i].name) + '</div>' +
          '<div class="subtle" style="margin-top:2px">掌握 ' + p[0] + ' · 模糊 ' + p[1] + ' · 未学 ' + p[2] + '</div></div>';
      }
    }
    if (!any) html += '<div class="subtle">还没有词书学习记录，去「词书」页开始吧。</div>';
    html += '</div>';

    html += '<div class="section-title">比赛战绩</div><div class="card">';
    if (st.battleRecords.length === 0) {
      html += '<div class="subtle">还没有战绩，去「比赛」玩一局。</div>';
    } else {
      const start = Math.max(0, st.battleRecords.length - 8);
      for (let i = st.battleRecords.length - 1; i >= start; i--) {
        const r = st.battleRecords[i];
        html += '<div class="between" style="padding:7px 0;font-size:13px;flex-wrap:wrap">' +
          '<span class="subtle">' + esc(r.playedAt.substring(0, 10)) + ' · ' + esc(r.bookName) + '</span>' +
          '<span style="display:flex;align-items:center;gap:4px;color:#B07A12">' +
          icon('trophy', 'i14') + esc(r.winner) + '</span></div>';
      }
    }
    html += '</div></div>';
    return html + tabbar(5, app);
  }

  // —— 连续打卡卡：天数 + 本周打卡 + 最近 7 天复习折线 ——
  function streakCardHtml(st, now) {
    const by = {};
    const stats = Array.isArray(st.stats) ? st.stats : [];
    for (let i = 0; i < stats.length; i++) {
      const e = stats[i];
      if (!e || !e.date) continue;
      by[e.date] = (by[e.date] || 0) + (e.reviews || 0);
    }
    const key = function (ts) { return FC.dateKey(ts); };
    const todayKey = key(now);
    const doneToday = (by[todayKey] || 0) > 0;

    // 连续天数：今天有学从今天起算；今天还没学但昨天学过，仍算在连击中
    let streak = 0;
    const cur = new Date(now);
    if (!doneToday) cur.setDate(cur.getDate() - 1);
    while ((by[key(cur.getTime())] || 0) > 0) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }

    // 历史最长连续
    const keys = [];
    for (const k in by) if (by[k] > 0) keys.push(k);
    keys.sort();
    let longest = 0, run = 0, prevT = null;
    for (let i = 0; i < keys.length; i++) {
      const t = Date.parse(keys[i] + 'T00:00:00');
      if (isNaN(t)) continue;
      run = (prevT !== null && Math.round((t - prevT) / FC.DAY_MS) === 1) ? run + 1 : 1;
      if (run > longest) longest = run;
      prevT = t;
    }

    // 最近 7 天
    const WK = ['日', '一', '二', '三', '四', '五', '六'];
    let dots = '';
    const vals = [];
    let weekOn = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * FC.DAY_MS);
      const k = key(d.getTime());
      const n = by[k] || 0;
      vals.push(n);
      if (n > 0) weekOn++;
      dots += '<span class="sk-dot' + (n > 0 ? ' on' : '') + (i === 0 ? ' today' : '') +
        '" title="' + esc(k) + '：' + n + ' 次复习"><i></i><small>' +
        (i === 0 ? '今' : WK[d.getDay()]) + '</small></span>';
    }

    // 迷你折线
    const maxV = Math.max(1, Math.max.apply(null, vals));
    const cw = 200, ch = 46, stp = cw / 6;
    let line = '';
    for (let i = 0; i < 7; i++) {
      const x = (i * stp).toFixed(1);
      const y = (ch - 6 - (vals[i] / maxV) * (ch - 14)).toFixed(1);
      line += (i ? 'L' : 'M') + x + ' ' + y + ' ';
    }
    const area = line + 'L ' + cw + ' ' + ch + ' L 0 ' + ch + ' Z';

    let tip;
    if (doneToday) tip = '今天已打卡，保持住';
    else if (streak > 0) tip = '今天还没打卡 · 学一张就续上';
    else tip = '学完一张卡就算打卡';

    return '<div class="streak-card' + (doneToday ? ' done' : '') + '">' +
      '<div class="sk-main">' +
      '<span class="sk-badge">' + icon('zap', 'i22') + '</span>' +
      '<div class="sk-body">' +
      '<div class="sk-num"><b>' + streak + '</b><span>天</span></div>' +
      '<div class="sk-txt"><b>' + (streak > 0 ? '连续打卡' : '开始打卡') + '</b>' +
      '<small>' + esc(tip) + '</small>' +
      '<small>本周 ' + weekOn + ' 天 · 最长 ' + longest + ' 天</small></div>' +
      '</div></div>' +
      '<div class="sk-chart">' +
      '<svg class="sk-spark" viewBox="0 0 ' + cw + ' ' + ch + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="skLineGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#8B6BFF" stop-opacity=".30"/>' +
      '<stop offset="1" stop-color="#8B6BFF" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#skLineGrad)"/>' +
      '<path d="' + line.trim() + '" fill="none" stroke="#8B6BFF" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '</svg>' +
      '<div class="sk-dots">' + dots + '</div>' +
      '<div class="sk-axis"><small>7 天前</small><small>今天</small></div>' +
      '</div></div>';
  }

  function statBox(v, k, accent, ico) {
    return '<div class="stat-box">' +
      (ico ? '<span class="stat-ico ico-' + esc(ico) + '">' + icon(ico, 'i16') + '</span>' : '') +
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v' + (accent ? ' accent' : '') + '">' + esc(v) + '</div></div>';
  }

  // ------------------------------------------------------- 账户公开 ID
  // 规则：注册序号代号 + 注册年份 + 手机尾号 4 位，例如 A20265186
  // 序号 1–999 → A；1 000–9 999 → B；1 万–9.9 万 → C；依次到 1 亿–9.9 亿 → G
  const REG_LETTERS = 'ABCDEFG';
  function regCodeLetter(no) {
    const n = Math.max(1, Math.floor(Number(no) || 1));
    const idx = Math.min(REG_LETTERS.length - 1, Math.max(0, String(n).length - 3));
    return REG_LETTERS.charAt(idx);
  }
  function accountPhoneTail(app) {
    const a = (app && app.account) || {};
    let t = String(a.phoneTail || '').replace(/\D/g, '');
    if (t.length < 4) {
      const raw = String(a.phone || a.cloudPhone || '').replace(/\D/g, '');
      if (raw.length >= 4) t = raw;
    }
    return t.slice(-4);
  }
  function accountIdentity(app) {
    const a = (app && app.account) || {};
    const cloudNo = Number(a.regNo) || 0;
    const no = cloudNo || 1; // 本机账户先按第 1 位展示，登录后以云端注册号为准
    const year = String(a.regYear || '').replace(/\D/g, '').slice(0, 4) ||
      String(a.joinedAt || '').slice(0, 4) || String(new Date().getFullYear());
    const tail = accountPhoneTail(app);
    const letter = regCodeLetter(no);
    return {
      no: no, letter: letter, year: year, tail: tail,
      code: letter + year + (tail || ''),
      ready: tail.length === 4, cloud: cloudNo > 0
    };
  }

  // 等级：暂按累计学习天数展示，正式规则（学习天数 + 学习数据）后续上线
  function levelInfo(app) {
    const st = (app && app.state) || {};
    const list = Array.isArray(st.stats) ? st.stats : [];
    const seen = {};
    let days = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !e.date) continue;
      if ((Number(e.reviews) || 0) <= 0) continue;
      if (seen[e.date]) continue;
      seen[e.date] = 1;
      days++;
    }
    const PER = 7;
    const cur = days % PER;
    return {
      days: days,
      level: Math.floor(days / PER) + 1,
      per: PER,
      left: PER - cur,
      pct: Math.round(cur / PER * 100)
    };
  }

  // ---------------------------------------------------------------- 设置页
  function settingsPage(app) {
    const s = app.state.settings;
    const a = app.account || {};
    const on = !!a.loggedIn;
    const name = app.accountDisplayName ? app.accountDisplayName() : (a.nickname || '未登录');
    const idt = accountIdentity(app);

    // 行 / 组 / 块 三个基础构件：一行 = 彩色圆角图标 + 标题 + 右侧控件
    const row = function (ico, tone, label, right, sub) {
      return '<div class="set-row">' +
        '<span class="set-ico t-' + tone + '">' + icon(ico, 'i16') + '</span>' +
        '<span class="set-label">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<span class="set-ctl">' + right + '</span></div>';
    };
    const num = function (id, val, ph, w) {
      return '<input class="set-num" id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph) +
        '" inputmode="decimal"' + (w ? ' style="width:' + w + 'px"' : '') + ' />';
    };
    const sel = function (id, opts) {
      let o = '';
      for (let i = 0; i < opts.length; i++) {
        o += '<option value="' + esc(opts[i].v) + '"' + (opts[i].on ? ' selected' : '') + '>' + esc(opts[i].label) + '</option>';
      }
      return '<select class="set-select" id="' + id + '">' + o + '</select>';
    };
    const grp = function (title, inner) {
      return '<div class="set-grp-title">' + esc(title) + '</div><div class="set-card">' + inner + '</div>';
    };
    const block = function (title, inner, sub) {
      return '<div class="set-block"><div class="set-block-h">' + esc(title) + '</div>' + inner +
        (sub ? '<div class="set-block-sub">' + sub + '</div>' : '') + '</div>';
    };
    const acts = function (inner) { return '<div class="set-actions">' + inner + '</div>'; };

    let html = titlebar('设置', '学习 · 外观 · 数据 · 隐私') + '<div class="content set-content"><div class="set-win">';

    // —— 账户头部：头像 + 昵称 + 账户 ID + 账户管理 ——
    html += '<div class="set-acct">' +
      '<div class="set-acct-ava">' + avatarFace(a, 'ava-lg') + '</div>' +
      '<div class="set-acct-name">' + esc(on ? name : '未登录') + '</div>' +
      '<div class="set-acct-id' + (idt.ready ? '' : ' is-empty') + '" title="账户 ID">' + esc(idt.code || '待填手机尾号') + '</div>' +
      '<button class="set-acct-btn" data-act="account-open">' + icon('user', 'i15') + (on ? '账户管理' : '登录 / 注册') + '</button>' +
      '</div>';

    // —— 账户与身份 ——
    html += grp('账户与身份',
      row('user', 'blue', '昵称与头像',
        '<button class="set-link" data-act="' + (on ? 'profile-open' : 'account-open') + '">' + esc(on ? name : '登录 / 注册') + icon('chevronRight', 'i12') + '</button>',
        '点击修改') +
      row('phone', 'blue', '手机尾号',
        '<input class="set-num" id="setPhoneTail" value="' + esc(accountPhoneTail(app)) + '" placeholder="5186" maxlength="4" inputmode="numeric" />',
        '账户 ID 的后四位') +
      '<div class="set-tip">账户 ID 由 <b>注册序号代号 + 注册年份 + 手机尾号</b> 组成：前 1000 位为 A，1 万以内 B，10 万以内 C，依次到 G。例：第 1 位注册、2026 年、尾号 5186 → <b>A20265186</b>。</div>'
    );

    // —— 学习计划 ——
    html += grp('学习计划',
      row('target', 'blue', '每日新卡上限', num('setNew', String(s.newCardsPerDay), '20', 78)) +
      row('rotate', 'blue', '每日复习上限', num('setReview', String(s.reviewCardsPerDay), '200', 78)) +
      '<div class="set-tip">所有牌组统一按这里执行。想让一套牌组一次全部出现（例如 50 张牌组学 50 张），把新卡上限设为 <b>999</b> 再保存。</div>' +
      acts('<button class="btn btn-sm btn-accent" data-act="set-unlimited">' + icon('layers', 'i14') + '取消上限（999）</button>' +
        '<button class="btn btn-sm" data-act="set-standard">恢复推荐（20）</button>')
    );

    // —— 记忆算法 ——
    html += grp('记忆算法 · FSRS-5',
      row('zap', 'purple', '目标留存率', num('setRetention', String(s.requestRetention), '0.9', 78), '0.7 – 0.99') +
      row('clock', 'purple', '最大间隔', num('setMaxInterval', String(s.maximumInterval), '36500', 92), '天') +
      row('layers', 'purple', '学习步骤', num('setLearn', s.learningSteps.join(','), '1,10', 120), '分钟') +
      row('rotate', 'purple', '重学步骤', num('setRelearn', s.relearningSteps.join(','), '10', 120), '分钟') +
      row('trophy', 'purple', '毕业间隔', num('setGrad', String(s.graduatingInterval), '1', 78), '天') +
      row('zap', 'purple', '简单间隔', num('setEasy', String(s.easyInterval), '4', 78), '天')
    );

    // —— 学习行为 ——
    html += grp('学习行为',
      row('bell', 'orange', 'Leech 阈值', num('setLeech', String(s.leechThreshold), '8', 78), '遗忘次数') +
      row('shield', 'orange', 'Leech 动作', sel('setLeechAction', [
        { v: 'tag', label: '标记并打标签', on: s.leechAction !== 'suspend' },
        { v: 'suspend', label: '自动暂停卡片', on: s.leechAction === 'suspend' }
      ])) +
      row('layers', 'orange', '相关卡片搁置', sel('setBury', [
        { v: '1', label: '开启', on: s.buryRelated !== false },
        { v: '0', label: '关闭', on: s.buryRelated === false }
      ]), '正反向当天只出一张') +
      row('cards', 'orange', '新卡顺序', sel('setNewOrder', [
        { v: 'mix', label: '交错', on: s.newOrder === 'mix' },
        { v: 'order', label: '按创建顺序', on: s.newOrder === 'order' },
        { v: 'random', label: '随机', on: s.newOrder === 'random' }
      ])) +
      row('rotate', 'orange', '复习顺序', sel('setReviewOrder', [
        { v: 'due', label: '按到期时间', on: s.reviewOrder !== 'random' },
        { v: 'random', label: '随机', on: s.reviewOrder === 'random' }
      ])) +
      row('clock', 'orange', '答题计时', sel('setTimer', [
        { v: '1', label: '显示', on: s.showTimer !== false },
        { v: '0', label: '隐藏', on: s.showTimer === false }
      ])) +
      row('speaker', 'orange', '翻面提示音', sel('setSound', [
        { v: '1', label: '开启', on: s.sound !== false },
        { v: '0', label: '关闭', on: s.sound === false }
      ])) +
      row('eye', 'orange', '自动翻面', sel('setAutoReveal', [
        { v: '0', label: '关闭 · 手动', on: !s.autoRevealSeconds },
        { v: '3', label: '3 秒', on: s.autoRevealSeconds === 3 },
        { v: '5', label: '5 秒', on: s.autoRevealSeconds === 5 },
        { v: '10', label: '10 秒', on: s.autoRevealSeconds === 10 }
      ])) +
      row('book', 'orange', '学习卡字号', sel('setFont', [
        { v: 's', label: '小', on: s.studyFont === 's' },
        { v: 'm', label: '标准', on: s.studyFont !== 's' && s.studyFont !== 'l' },
        { v: 'l', label: '大', on: s.studyFont === 'l' }
      ])) +
      row('sparkles', 'orange', '界面动效', sel('setMotion', [
        { v: '1', label: '开启', on: s.motion !== false },
        { v: '0', label: '关闭 · 更省电', on: s.motion === false }
      ]))
    );

    // —— 外观 ——
    html += grp('外观与个性化',
      block('明暗模式', themeModeBtns(s.theme || 'light'), '独立于主题配色，切到任何主题都会生效。') +
      block('主题预设', presetGrid(s.preset || 'default'), '一套「配色 + 背景」的组合，点选立即生效。') +
      block('强调色', '<div class="swatch-row" id="setAccent">' +
        swatch('brand', '星空紫', s.accent, 'accent') +
        swatch('green', '青绿', s.accent, 'accent') +
        swatch('teal', '湖蓝', s.accent, 'accent') +
        swatch('amber', '琥珀', s.accent, 'accent') +
        swatch('red', '绯红', s.accent, 'accent') +
        swatch('rose', '玫瑰', s.accent, 'accent') +
        '</div>', '用于按钮、进度与选中态。') +
      block('背景', '<div class="swatch-row" id="setBg">' +
        swatch('default', '纯色', s.bg, 'bg') +
        swatch('grid', '细网格', s.bg, 'bg') +
        swatch('dots', '点阵', s.bg, 'bg') +
        swatch('mist', '柔雾', s.bg, 'bg') +
        swatch('paper', '纸感', s.bg, 'bg') +
        swatch('aurora', '晕染', s.bg, 'bg') +
        '</div>', '只改变底纹，不影响阅读。')
    );

    // —— 数据 ——
    html += grp('数据与备份',
      row('bell', 'cyan', '备份提醒', sel('setBackupRemind', (function () {
        const remind = s.backupRemindDays === undefined ? 14 : s.backupRemindDays;
        return [
          { v: '0', label: '关闭', on: remind === 0 },
          { v: '7', label: '每 7 天', on: remind === 7 },
          { v: '14', label: '每 14 天', on: remind === 14 },
          { v: '30', label: '每 30 天', on: remind === 30 }
        ];
      })())) +
      (function () {
        const last = app.lastBackupAt ? app.lastBackupAt() : 0;
        const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
        const txt = last ? (days <= 0 ? '今天刚备份过' : '上次备份在 ' + days + ' 天前') : '还没有备份过';
        const remind = s.backupRemindDays === undefined ? 14 : s.backupRemindDays;
        const warn = remind > 0 && (!last || days >= remind);
        return '<div class="set-tip' + (warn ? ' warn' : '') + '">' + esc(txt) +
          '。本地数据只存在这台设备，建议定期导出 .srcd 存到别处，换设备或清缓存都不会丢。</div>';
      })() +
      acts('<button class="btn btn-sm btn-danger" data-act="reset-confirm">' + icon('trash', 'i14') + '清空数据</button>')
    );

    // —— 隐私与安全 ——
    html += grp('隐私与安全',
      row('shield', 'indigo', '学习数据存储', '<span class="set-val">本机浏览器</span>') +
      row('cloud', 'indigo', '云端用途', '<span class="set-val">验证码登录 · 在线 AI</span>') +
      row('download', 'indigo', '导出 .srcd', '<span class="set-val">不含账户资料</span>') +
      '<div class="set-tip">账户、头像和隐私偏好只在这台设备上。清除后找不回来，但不会动你的牌组和学习记录。</div>' +
      acts('<button class="btn btn-sm" data-act="account-clear">' + icon('trash', 'i14') + '清除账户数据</button>')
    );

    // —— 快捷键 ——
    html += grp('快捷键',
      row('key', 'slate', 'Ctrl + K', '<span class="set-val">命令面板</span>') +
      row('key', 'slate', '空格', '<span class="set-val">翻面 / 良好</span>') +
      row('key', 'slate', '1 / 2 / 3 / 4', '<span class="set-val">重来 / 困难 / 良好 / 简单</span>') +
      row('key', 'slate', 'E / S / F / I / R', '<span class="set-val">编辑 / 暂停 / 标记 / 信息 / 重置</span>') +
      row('key', 'slate', 'Ctrl + Z / B / Esc', '<span class="set-val">撤销 / 浏览器 / 退出</span>') +
      acts('<button class="btn btn-sm" data-act="shortcuts-help">' + icon('keyboard', 'i14') + '查看完整快捷键</button>')
    );

    // —— 等级 ——
    const lv = levelInfo(app);
    html += grp('等级',
      '<div class="set-block set-level">' +
      '<div class="lv-top"><span class="lv-badge">Lv.' + lv.level + '</span>' +
      '<span class="lv-title">' + (lv.days > 0 ? '已学习 ' + lv.days + ' 天' : '还没开始学习') + '</span>' +
      '<span class="lv-pct">' + lv.pct + '%</span></div>' +
      '<div class="lv-bar"><i style="width:' + lv.pct + '%"></i></div>' +
      '<div class="lv-sub">' +
      (lv.days > 0
        ? '再学习 ' + lv.left + ' 天可升到 Lv.' + (lv.level + 1)
        : '完成第一次学习，就能拿到 Lv.1 的第一格进度') +
      '。等级由学习天数与学习数据综合决定，正式规则后续上线。</div>' +
      '</div>'
    );

    // —— 关于 ——
    html += grp('关于',
      '<div class="set-block set-about">' +
      '<div class="set-about-t">闪星卡 · StarCard</div>' +
      '<div class="set-about-s">网页版 1.6.0 · 开发人 小李同学 · 小李工作室</div>' +
      '<div class="set-about-d">一款比 Anki 更全面、更智能的间隔重复卡片学习软件。内置离线 AI 助手「小星」，基于 FSRS-5 科学记忆算法，数据与 .srcd 都在本机处理。</div>' +
      '</div>'
    );

    // —— 保存条 ——
    html += '<div class="set-save">' +
      '<span class="set-save-hint">改完点保存，全部立即生效</span>' +
      '<button class="btn btn-primary" data-act="save-settings">' + icon('check', 'i16') + '保存设置</button>' +
      '</div>';

    html += '</div></div>';
    return html + tabbar(6, app);
  }

  function settingInput(label, id, value, ph) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="' + id + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '" /></div>';
  }

  // 主题预设：一套「配色 + 背景」的组合，一键应用；明暗模式（跟随系统/浅色/深色）独立切换，应用到所有主题
  const THEME_PRESETS = [
    { id: 'default', name: '素白', desc: '白底 · 星空紫', accent: 'brand', bg: 'default' },
    { id: 'paper', name: '暖纸', desc: '纸感 · 琥珀', accent: 'amber', bg: 'paper' },
    { id: 'forest', name: '林间', desc: '柔雾 · 青绿', accent: 'green', bg: 'mist' },
    { id: 'ocean', name: '海雾', desc: '点阵 · 湖蓝', accent: 'teal', bg: 'dots' },
    { id: 'rose', name: '暮粉', desc: '晕染 · 玫瑰', accent: 'rose', bg: 'aurora' },
    { id: 'night', name: '夜航', desc: '网格 · 星空紫', accent: 'brand', bg: 'grid' }
  ];

  function presetGrid(current) {
    let out = '<div class="preset-grid">';
    for (let i = 0; i < THEME_PRESETS.length; i++) {
      const p = THEME_PRESETS[i];
      const on = p.id === current;
      out += '<button class="preset-card pc-' + esc(p.id) + (on ? ' on' : '') + '" data-act="theme-preset" data-id="' + esc(p.id) + '">' +
        '<span class="pc-prev"><i class="pc-surface"></i><i class="pc-accent"></i></span>' +
        '<span class="pc-name">' + esc(p.name) + '</span>' +
        '<span class="pc-desc">' + esc(p.desc) + '</span>' +
        '</button>';
    }
    return out + '</div>';
  }

  // 个性化选项：单选色块 / 背景样片。name 用于分组，checked 表示当前选中。
  function swatch(value, label, current, group) {
    const on = String(current) === String(value);
    return '<label class="swatch sw-' + esc(value) + (on ? ' on' : '') + '" title="' + esc(label) + '">' +
      '<input type="radio" name="' + esc(group) + 'R" value="' + esc(value) + '"' + (on ? ' checked' : '') + ' />' +
      '<span class="sw-dot"></span><span class="sw-name">' + esc(label) + '</span></label>';
  }

  // 外观模式三选一：跟随系统 / 浅色 / 深色（即时生效，独立于主题预设，应用到所有主题）
  function themeModeBtns(current) {
    const modes = [
      { v: 'auto', label: '跟随系统', ico: 'monitor' },
      { v: 'light', label: '浅色', ico: 'sun' },
      { v: 'dark', label: '深色', ico: 'moon' }
    ];
    let out = '<div class="theme-mode">';
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      const on = String(current) === m.v;
      out += '<button class="mode-btn' + (on ? ' on' : '') + '" data-act="theme-mode" data-theme="' + m.v + '">' +
        icon(m.ico, 'i16') + '<span>' + m.label + '</span></button>';
    }
    return out + '</div>';
  }

  // ---------------------------------------------------------------- 个人中心
  // ---------------------------------------------------------------- 通知页（完整页面，非弹窗）
  function noticePage(app) {
    const items = noticeItems(app);
    let html = titlebar('通知', '学习提醒 · 备份提示', { back: { act: 'notice-back' } }) + '<div class="content">';
    if (!items.length) {
      html += '<div class="card wide"><div class="notice-empty">' + icon('bell', 'i26') +
        '<div>暂时没有要提醒的事。</div><div class="subtle">今天没有待学卡片，也备份过了。</div></div></div>';
    } else {
      html += '<div class="card wide"><div class="notice-list">';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        html += '<div class="notice-item tone-' + esc(it.tone) + '">' +
          '<span class="notice-ico">' + icon(it.icon, 'i18') + '</span>' +
          '<div class="notice-txt"><b>' + esc(it.title) + '</b><small>' + esc(it.desc) + '</small></div>' +
          (it.cta ? '<button class="btn btn-sm' + (i === 0 ? ' btn-primary' : '') + '" data-act="notice-go"' +
            (it.page ? ' data-page="' + it.page + '"' : ' data-tab="' + (it.tab || 0) + '"') + '>' + esc(it.cta) + '</button>' : '') +
          '</div>';
      }
      html += '</div></div>';
    }
    html += '<div class="card wide">' +
      '<div class="row-gap">' +
      '<button class="btn" data-act="notice-read">' + icon('checkCircle', 'i16') + '全部标为已读</button>' +
      '<button class="btn" data-act="backup-open">' + icon('shield', 'i16') + '备份中心</button>' +
      '</div>' +
      '<div class="subtle" style="margin-top:12px">通知每天汇总一次：今日待学、连续打卡、备份提醒。全部在本机生成，不上传任何服务器。</div>' +
      '</div></div>';
    return html + tabbar(app.tab, app);
  }

  // ---------------------------------------------------------------- 备份中心页（完整页面，非弹窗）
  function backupPage(app) {
    const st = app.state;
    const last = app.lastBackupAt ? app.lastBackupAt() : 0;
    const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
    const remind = st.settings.backupRemindDays === undefined ? 14 : st.settings.backupRemindDays;
    const deckCount = st.decks.length;
    let cardCount = 0;
    for (let i = 0; i < st.decks.length; i++) cardCount += st.decks[i].cards.length;
    let html = titlebar('备份中心', '导出 · 导入 · 提醒', { back: { act: 'backup-back' } }) + '<div class="content">';

    // 数据概览
    html += '<div class="stat-grid">' +
      statBox(deckCount, '牌组数', false, 'folder') +
      statBox(cardCount, '卡片数', false, 'cards') +
      statBox(!last ? '未备份' : (days === 0 ? '今天' : days + ' 天前'), '上次备份', !last, 'shield') +
      '</div>';

    // 导出
    html += '<div class="section-title">导出备份</div>' +
      '<div class="card wide">' +
      '<div class="kv"><span class="kv-k">导出内容</span><span class="kv-v">全部牌组 · 学习进度 · 复习统计</span></div>' +
      '<div class="kv"><span class="kv-k">文件格式</span><span class="kv-v">.srcd（单文件，跨设备可导入）</span></div>' +
      '<div class="kv"><span class="kv-k">不包含</span><span class="kv-v">昵称头像 · 隐私偏好 · 班级/比赛数据</span></div>' +
      '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="backup-export">' +
      icon('shield', 'i16') + '导出 .srcd 备份</button>' +
      '<div class="subtle" style="margin-top:10px">导出后把文件存到网盘 / U 盘 / 另一台设备。建议每 14 天备份一次。</div></div>';

    // 导入恢复
    html += '<div class="section-title">导入恢复</div>' +
      '<div class="card wide">' +
      '<div class="row-gap">' +
      '<button class="btn btn-primary" data-act="import-hub">' + icon('download', 'i16') + '导入</button>' +
      '<button class="btn btn-sm" data-act="import-formats" title="查看支持的格式">' + icon('info', 'i14') + '支持格式</button>' +
      '</div>' +
      '<div class="subtle" style="margin-top:10px">支持 .srcd / .apkg / CSV。同名牌组就地更新，学习进度按卡片正面自动迁移，不会重复堆叠。</div></div>';

    // 提醒频率
    html += '<div class="section-title">备份提醒</div>' +
      '<div class="card wide">' +
      '<div class="field"><label>提醒频率</label><select id="setBackupRemind">' +
      '<option value="0"' + (remind === 0 ? ' selected' : '') + '>关闭提醒</option>' +
      '<option value="7"' + (remind === 7 ? ' selected' : '') + '>每 7 天</option>' +
      '<option value="14"' + (remind === 14 ? ' selected' : '') + '>每 14 天</option>' +
      '<option value="30"' + (remind === 30 ? ' selected' : '') + '>每 30 天</option>' +
      '</select></div>' +
      '<button class="btn btn-sm" data-act="save-settings">保存频率</button>' +
      '<div class="subtle" style="margin-top:10px">到点后通知页会出现备份提醒。与「设置」页的备份提醒共用同一个设置。</div></div>';

    return html + '</div>' + tabbar(app.tab, app);
  }

  function accountPage(app) {
    const a = app.account || {};
    const on = !!a.loggedIn;
    const name = app.accountDisplayName ? app.accountDisplayName() : (a.nickname || '未登录');
    const idt = accountIdentity(app);
    const p = a.privacy || { rememberLogin: true, showNickname: true, privacyBlur: false };
    const draft = app._loginDraft || {};
    let html = titlebar('个人中心', '资料 · 登录 · 隐私', { back: { act: 'account-back' } }) + '<div class="content">';

    // 头像 + 身份概览
    html += '<div class="card wide acct-hero">' +
      '<button class="acct-ava-btn" data-act="avatar-open" title="更换头像">' + avatarFace(a, 'ava-xl') + '</button>';
    if (on) {
      const cloudId = a.provider === 'phone' ? (a.cloudPhone || a.phone) : (a.cloudEmail || a.email);
      html += '<div class="acct-name">' + esc(name) + '</div>' +
        '<div class="acct-idline">' + esc(idt.code || '待填手机尾号') + '</div>' +
        '<div class="acct-sub">' + (cloudId ? esc(cloudId) + ' · ' : '') +
        (a.joinedAt ? '加入于 ' + esc(a.joinedAt.substring(0, 10)) : '') + '</div>' +
        '<div class="acct-badge">' + icon('checkCircle', 'i14') +
        (a.provider ? (a.provider === 'huawei' ? '华为账号' : a.provider === 'phone' ? '手机号验证码登录' : '邮箱验证码登录') : '本机账户已登录') + '</div>' +
        '<div class="acct-actions">' +
        '<button class="btn btn-sm btn-primary" data-act="profile-open">' + icon('pencil', 'i14') + '编辑资料</button>' +
        '<button class="btn btn-sm" data-act="avatar-open">' + icon('camera', 'i14') + '更换头像</button>' +
        '<button class="btn btn-sm" data-act="account-logout">' + icon('logout', 'i14') + '退出登录</button>' +
        '</div>';
    } else {
      html += '<div class="acct-name">还没登录</div>' +
        '<div class="acct-idline is-empty">' + esc(idt.code || '待填手机尾号') + '</div>' +
        '<div class="acct-sub">用邮箱或手机号收验证码登录。头像现在就能换，学习数据只留本机。</div>';
    }
    html += '</div>';

    // 未登录：邮箱 / 手机号验证码登录
    if (!on) {
      const mode = app.loginMode === 'phone' ? 'phone' : 'email';
      const isPhone = mode === 'phone';
      const online = (window.FC && FC.cloudAvailable) ? FC.cloudAvailable() : false;
      const dv = function (k, fb) { return draft[k] !== undefined ? draft[k] : (fb || ''); };
      const msg = app._loginMsg || {};
      const cnt = app._otpCountdown || 0;
      const busy = !!app._otpBusy;
      const canSend = !busy && cnt <= 0;
      html += '<div class="card wide login-card">' +
        '<div class="login-head">' + logo() +
        '<div><div class="login-title">登录 / 注册闪星卡</div>' +
        '<div class="login-sub">用邮箱 / 手机验证码登录，学习数据只留本机。</div></div></div>' +

        '<div class="login-tabs">' +
        '<button class="login-tab' + (isPhone ? '' : ' on') + '" data-act="login-tab" data-mode="email">' + icon('mail', 'i15') + '邮箱登录</button>' +
        '<button class="login-tab' + (isPhone ? ' on' : '') + '" data-act="login-tab" data-mode="phone">' + icon('phone', 'i15') + '手机号登录</button>' +
        '</div>' +

        '<div class="login-form">' +
        (isPhone
          ? '<div class="field"><label>手机号</label><input id="loginPhone" type="tel" inputmode="numeric" maxlength="11" value="' + esc(dv('phone', a.phone)) + '" placeholder="11 位手机号" autocomplete="tel" /></div>'
          : '<div class="field"><label>邮箱</label><input id="loginEmail" type="email" value="' + esc(dv('email', a.email)) + '" placeholder="name@example.com" autocomplete="email" /></div>'
        ) +
        '<div class="field"><label>验证码</label>' +
        '<div class="otp-row"><input id="loginCode" type="text" inputmode="numeric" maxlength="6" value="' + esc(dv('code')) + '" placeholder="收到的验证码" autocomplete="one-time-code" />' +
        '<button type="button" class="btn btn-sm" id="btnSendCode" data-act="login-send"' + (canSend ? '' : ' disabled') + '>' +
        (busy ? '发送中…' : (cnt > 0 ? cnt + ' 秒后重发' : '获取验证码')) + '</button></div></div>' +
        (!isPhone && app._otpChallenge && !app._otpChallenge.isExistingUser
          ? '<div class="field"><label>设置密码（新用户）</label><input id="loginPassword" type="password" value="' + esc(dv('password')) + '" placeholder="至少 6 位，用于今后登录" autocomplete="new-password" /></div>'
          : '') +
        '<div class="login-msg' + (msg.text ? ' login-msg-' + (msg.kind || 'err') : '') + '" id="loginMsg">' + esc(msg.text || '') + '</div>' +
        '<label class="agree"><input type="checkbox" id="loginAgree"' + (draft.agree ? ' checked' : '') + ' />' +
        '<span>我已阅读并同意 <button class="link-btn" data-act="privacy-info">隐私说明</button></span></label>' +
        '<button class="btn btn-primary btn-block" data-act="login-submit">' + icon('lock', 'i16') + '登录 / 注册</button>' +
        '</div>' +
        (online
          ? '<div class="login-foot">' + icon('shield', 'i15') + '验证码由云端发送；昵称、头像、牌组与学习记录都只保留在本机，不写入 .srcd。</div>'
          : '<div class="login-foot">' + icon('info', 'i15') + '当前是本地离线打开，验证码登录需联网并通过在线网址使用；离线仍可正常复习本机牌组。</div>') +
        '</div>';
    }

    // 个人信息
    html += '<div class="card"><div class="card-head">' + icon('user', 'i18') + '<span>个人信息</span></div>' +
      '<div class="kv"><span class="kv-k">昵称</span><span class="kv-v">' + esc(on ? name : '未设置') + '</span></div>' +
      '<div class="kv"><span class="kv-k">邮箱</span><span class="kv-v">' + esc(a.email || '未填写') + '</span></div>' +
      (a.phone ? '<div class="kv"><span class="kv-k">手机号</span><span class="kv-v">' + esc(a.phone) + '</span></div>' : '') +
      '<div class="kv"><span class="kv-k">登录方式</span><span class="kv-v">' +
        (a.provider === 'huawei' ? '华为账号' : a.provider === 'phone' ? '手机号验证码' : a.provider === 'email' ? '邮箱验证码' : '本机昵称') + '</span></div>' +
      '<div class="kv"><span class="kv-k">用户 ID</span><span class="kv-v mono">' + esc(a.uid || '—') + '</span></div>' +
      '<div class="kv"><span class="kv-k">加入时间</span><span class="kv-v">' + esc(a.joinedAt ? a.joinedAt.substring(0, 10) : '—') + '</span></div>' +
      '<div class="kv"><span class="kv-k">登录状态</span><span class="kv-v ' + (on ? 'ok' : '') + '">' + (on ? '已登录' : '未登录') + '</span></div>' +
      (on ? '<button class="btn btn-sm btn-block" style="margin-top:12px" data-act="profile-open">' + icon('pencil', 'i14') + '编辑个人资料</button>' : '') +
      '</div>';

    // 隐私设置
    html += '<div class="card"><div class="card-head">' + icon('shield', 'i18') + '<span>隐私设置</span></div>' +
      privacyRow('rememberLogin', p.rememberLogin !== false, '记住登录状态', '关闭后每次打开都需要重新登录') +
      privacyRow('showNickname', p.showNickname !== false, '显示我的昵称', '关闭后界面中统一显示为「学习者」') +
      privacyRow('privacyBlur', p.privacyBlur === true, '离开窗口时隐藏内容', '切到其他窗口时自动遮盖学习界面') +
      '<button class="btn btn-sm btn-block" style="margin-top:12px" data-act="privacy-info">' + icon('info', 'i14') + '查看隐私说明</button>' +
      '<div class="subtle" style="margin-top:10px">隐私偏好保存在本机，不会随 .srcd 导出。</div>' +
      '</div>';

    // 云同步卡片插槽：由 cloudsync.js 填充（未配置/未启用时为空，不影响外观）
    html += '<div id="cs-slot"></div>';

    html += '</div>';
    return html + tabbar(-1, app);
  }

  // ---------------------------------------------------------------- 模态
  function modal(app) {
    const m = app.modal;
    if (!m) return '';
    let inner = '';
    if (m.type === 'deck') {
      inner = '<h3>' + (m.id ? '编辑牌组' : '新建牌组') + '</h3>' +
        '<div class="field"><label>名称</label><input id="mName" value="' + esc(m.name || '') + '" placeholder="如：英语高频词" /></div>' +
        '<div class="field"><label>描述（可选）</label><input id="mDesc" value="' + esc(m.desc || '') + '" placeholder="一句话说明" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'card') {
      inner = '<h3>' + (m.id ? '编辑卡片' : '添加卡片') + '</h3>' +
        '<div class="field"><label>正面（问题）</label><input id="mFront" value="' + esc(m.front || '') + '" placeholder="如：ubiquitous" /></div>' +
        '<div class="field"><label>背面（答案）</label><input id="mBack" value="' + esc(m.back || '') + '" placeholder="如：无处不在的" /></div>' +
        '<div class="field"><label>提示 / 笔记（可选）</label><input id="mExtra" value="' + esc(m.extra || '') + '" placeholder="可选" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'batch') {
      inner = '<h3>批量粘贴卡片</h3><div class="subtle" style="margin-bottom:8px">每行一张，Tab 或「::」或「|」分隔正反面；# 开头为注释。</div>' +
        '<div class="field"><textarea id="mBatch" rows="8" placeholder="front1\tback1\nfront2::back2"></textarea></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">导入</button></div>';
    } else if (m.type === 'class') {
      inner = '<h3>创建班级</h3>' +
        '<div class="field"><label>班级名称</label><input id="mCName" value="' + esc(m.name || '') + '" placeholder="考研冲刺班" /></div>' +
        '<div class="field"><label>简介（可选）</label><input id="mCDesc" value="' + esc(m.desc || '') + '" placeholder="一句话说明" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">创建</button></div>';
    } else if (m.type === 'join') {
      inner = '<h3>加入班级</h3><div class="subtle" style="margin-bottom:8px">输入本机已有班级的邀请码；若没有会自动新建。</div>' +
        '<div class="field"><input id="mCode" value="' + esc(m.code || '') + '" placeholder="6 位邀请码" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">加入</button></div>';
    } else if (m.type === 'member') {
      inner = '<h3>添加成员</h3><div class="field"><input id="mMember" value="' + esc(m.name || '') + '" placeholder="小明" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'deskmate') {
      inner = '<h3>添加同桌</h3>' +
        '<div class="field"><label>名字</label><input id="mDName" value="' + esc(m.name || '') + '" placeholder="阿月" /></div>' +
        '<div class="field"><label>备注（可选）</label><input id="mDNote" value="' + esc(m.note || '') + '" placeholder="每天一起背 20 词" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'account') {
      inner = '<h3>登录 / 创建账户</h3>' +
        '<div class="subtle" style="margin-bottom:4px">当前为本地账户，信息只保存在本机浏览器。</div>' +
        '<div class="field"><label>昵称</label><input id="mNick" value="' + esc(m.nickname || '') + '" placeholder="如：阿月" /></div>' +
        '<div class="field"><label>邮箱（可选）</label><input id="mEmail" value="' + esc(m.email || '') + '" placeholder="（可选）" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">登录</button></div>';
    } else if (m.type === 'profile') {
      inner = '<h3>编辑个人资料</h3>' +
        '<div class="subtle" style="margin-bottom:8px">资料只保存在本机浏览器，用于标识你的学习身份。</div>' +
        '<div class="field"><label>昵称</label><input id="mNick" value="' + esc(m.nickname || '') + '" placeholder="如：阿月" /></div>' +
        '<div class="field"><label>邮箱（可选）</label><input id="mEmail" value="' + esc(m.email || '') + '" placeholder="（可选）" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'avatar') {
      const acc = app.account || {};
      let colors = '';
      for (let i = 0; i < 6; i++) {
        colors += '<button class="ava-pick ava-c' + i +
          (Number(m.color) === i && !m.data ? ' on' : '') +
          '" data-act="avatar-color" data-color="' + i + '" aria-label="头像配色 ' + (i + 1) + '"></button>';
      }
      inner = '<h3>更换头像</h3>' +
        '<div class="ava-editor">' +
        '<div class="ava-editor-preview">' + avatarFace(acc, 'ava-lg') + '</div>' +
        '<div class="ava-editor-side">' +
        '<div class="field-label">选择配色</div><div class="ava-colors">' + colors + '</div>' +
        '<div class="field-label" style="margin-top:14px">或上传图片</div>' +
        '<label class="btn btn-sm btn-block ava-upload" for="avatarFile">' + icon('camera', 'i14') + '选择本地图片</label>' +
        '<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />' +
        (m.data ? '<button class="btn btn-sm btn-block" style="margin-top:8px" data-act="avatar-clear">' + icon('rotate', 'i14') + '移除图片</button>' : '') +
        '</div></div>' +
        '<div class="subtle" style="margin-top:10px">上传后可拖动、缩放，选好圆形区域再保存；图片只保存在本机。</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
    } else if (m.type === 'avatar-crop') {
      const c = app._crop || {};
      inner = '<h3>调整头像</h3>' +
        '<div class="crop-wrap">' +
        '<div class="crop-stage" id="avaCropStage">' +
        '<img class="crop-img" id="avaCropImg" src="' + esc(c.src || '') + '" alt="" draggable="false" />' +
        '<span class="crop-ring"></span>' +
        '</div>' +
        '<div class="crop-zoom">' +
        '<button class="crop-btn" data-act="crop-zoom" data-dir="-1" aria-label="缩小">−</button>' +
        '<input type="range" id="avaCropZoom" min="100" max="320" step="1" value="100" aria-label="缩放" />' +
        '<button class="crop-btn" data-act="crop-zoom" data-dir="1" aria-label="放大">+</button>' +
        '</div>' +
        '<div class="crop-tip">拖动图片调整位置 · 滑杆或滚轮缩放 · <b id="avaCropPct">100%</b></div>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="crop-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="crop-apply">' + icon('check', 'i15') + '使用这张</button></div>';
    } else if (m.type === 'privacy') {
      inner = '<h3>隐私说明</h3>' +
        '<div class="privacy-doc">' +
        '<p><strong>1. 学习数据都在这台设备上</strong><br/>牌组、卡片、复习记录、词书进度、班级、同桌、比赛战绩，以及昵称、头像和隐私偏好，全部保存在本浏览器的 localStorage 中，不会上传到任何服务器。</p>' +
        '<p><strong>2. 登录只用于身份校验</strong><br/>邮箱 / 手机号通过云端验证码登录，验证码由云服务发送，仅用于确认身份。云端不保存你的牌组与学习记录；退出登录可随时清除本机登录状态。</p>' +
        '<p><strong>3. 小星 AI 问答</strong><br/>联网时，小星会把你的学习概况摘要交给云端大模型以生成更贴切的回答；不会上传完整词库、卡片原文或个人身份信息。离线或本地打开时，小星自动使用本地规则引擎，功能照常可用。</p>' +
        '<p><strong>4. 导出文件不含个人资料</strong><br/>导出的 .SRCD 只包含牌组、卡片与 FSRS 参数；昵称、邮箱、头像与隐私偏好都不会写入文件，可以放心分享。</p>' +
        '<p><strong>5. 你随时可以删除</strong><br/>「清除账户数据」会删除账户资料、头像与隐私偏好；「设置 → 清空数据」会删除全部牌组与学习记录。两者都不可恢复，建议先导出 .srcd 备份。</p>' +
        '<p><strong>5. 隐私开关</strong><br/>「记住登录状态」控制刷新后是否自动登录；「显示我的昵称」控制界面是否展示昵称；「离开窗口时隐藏内容」在切到其他窗口时遮盖页面。所有开关只影响本机显示。</p>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn btn-primary" data-act="modal-cancel">我知道了</button></div>';
    } else if (m.type === 'apkg-preview') {
      const r = app.apkgImport;
      if (!r) {
        inner = '<h3>解析失败</h3><div class="subtle">没有可预览的内容。</div>' +
          '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      } else {
        const s = r.stats;
        let dl = '';
        for (let i = 0; i < r.decks.length; i++) {
          dl += '<div class="apkg-deck"><span>' + esc(r.decks[i].name) + '</span><b>' + r.decks[i].cards.length + ' 张</b></div>';
        }
        inner = '<h3>从 Anki 导入</h3>' +
          '<div class="apkg-summary">' +
          '<div class="apkg-stat"><b>' + s.cards + '</b><span>张卡片</span></div>' +
          '<div class="apkg-stat"><b>' + s.decks + '</b><span>个牌组</span></div>' +
          '<div class="apkg-stat"><b>' + s.media + '</b><span>个媒体</span></div>' +
          '</div>' +
          '<div class="subtle" style="margin:10px 0">来源：' + esc(r.collection) + ' · ' + esc(r.file) +
          (s.skipped ? ' · 跳过 ' + s.skipped + ' 张异常卡' : '') + '</div>' +
          '<div class="apkg-decks">' + dl + '</div>' +
          '<div class="subtle" style="margin-top:10px">笔记模型：' + esc((s.models || []).join('、')) + '</div>' +
          '<div class="subtle" style="margin-top:8px">会保留标签、标记、暂停状态与到期时间；图片 / 音频以内嵌媒体形式导入。不会覆盖现有牌组。</div>' +
          '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
          '<button class="btn btn-primary" data-act="apkg-confirm">确认导入</button></div>';
      }
    } else if (m.type === 'builtin-offer') {
      const dn = esc(m.deckName || '同名新版词库');
      inner = '<h3>需要换个方式导入</h3>' +
        '<div class="zstd-note">' +
        '<p>你选的是 <b>Anki 新版（zstd 压缩）</b>词库，浏览器没法直接解析这种格式。</p>' +
        '<p>不过这份词库我们已经准备好了 <b>' + dn + '</b> 版本，含完整释义与发音，点一下就能导入，不用你再找文件。</p>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="builtin-load" data-file="' + esc(m.deckFile || 'SAT800美音.srcd') + '" data-name="' + dn + '">' +
        icon('download', 'i16') + '立即载入「' + dn + '」</button></div>' +
        '<div class="subtle" style="margin-top:10px">若这份词库不是 SAT800 美音，请用「导入」手动选择对应的 .srcd 文件。</div>';
    } else if (m.type === 'import-hub') {
      inner = '<h3>导入词库</h3>' +
        '<div class="subtle" style="margin-bottom:10px">选择一种格式导入，卡片与学习进度会合并到本机。</div>' +
        '<div class="menu-list">' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="srcd">' + icon('download', 'i20') +
        '<span><b>闪星 .srcd</b><small>单文件牌组，含复习进度 · 兼容旧 .fscd</small></span></button>' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="apkg">' + icon('layers', 'i20') +
        '<span><b>Anki .apkg / .colpkg</b><small>保留模板 · 标签 · 复习进度 · 图片音频</small></span></button>' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="csv">' + icon('table', 'i20') +
        '<span><b>CSV 表格</b><small>从 Excel / Anki 批量生成，粘贴文本导入</small></span></button>' +
        '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-sm" data-act="import-formats">' + icon('info', 'i14') + '支持的格式</button></div>';
    } else if (m.type === 'import-formats') {
      inner = '<h3>支持的导入格式</h3>' +
        '<div class="privacy-doc">' +
        '<p><strong>.srcd（StarCard 牌组）</strong><br/>本应用开放的单文件牌组格式，含牌组、卡片、FSRS 复习进度与媒体，兼容旧版 .fscd。可从本机文件选择导入，同名牌组就地更新、进度按卡片正面自动迁移。</p>' +
        '<p><strong>.apkg / .colpkg（Anki 原生包）</strong><br/>纯前端解析 ZIP + SQLite，自动映射基础 / 反向 / 填空模板、标签、标记、暂停与到期时间，并保留内嵌图片音频。Anki 2.1.60+ 的 zstd 压缩包浏览器无法直接解析，会弹窗提示一键载入随包提供的对应词库。</p>' +
        '<p><strong>CSV 表格</strong><br/>适用于 Excel / Anki 批量生成，正反面以逗号或 Tab 分隔，支持引号转义与自动字段映射，导入前可预览。</p>' +
        '<p><strong>批量粘贴</strong><br/>在卡片编辑里按行粘贴，Tab / :: / | 分隔正反面，# 开头为注释。</p>' +
        '</div><div class="dialog-actions"><button class="btn btn-primary" data-act="import-back">' + icon('chevronLeft', 'i14') + '返回导入</button>' +
        '<button class="btn" data-act="modal-cancel">关闭</button></div>';
    } else if (m.type === 'confirm') {
      inner = '<h3>' + esc(m.title || '确认') + '</h3><div class="subtle" style="margin-bottom:8px">' +
        esc(m.message || '') + '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-danger" data-act="modal-ok">确定</button></div>';
    } else if (m.type === 'card-v2' && FCUI.cardEditor) {
      inner = FCUI.cardEditor(m);
    } else if (m.type === 'deck-options' && FCUI.deckOptions) {
      inner = FCUI.deckOptions(m);
    } else if (m.type === 'card-info' && FCUI.cardInfo) {
      inner = FCUI.cardInfo(m);
    } else if (m.type === 'custom-study' && FCUI.customStudy) {
      inner = FCUI.customStudy(app);
    } else if (m.type === 'csv-import' && FCUI.csvImport) {
      inner = FCUI.csvImport(app);
    } else if (m.type === 'deck-menu') {
      const deck = app.state.decks.find(function (x) { return x.id === m.deckId; });
      if (deck) {
        // 该牌组若属于某已注册系列，提供「删除整个词库」入口（一次删掉同系列全部分册）
        let deckSeries = null;
        const _series = FC.visibleSeries ? FC.visibleSeries(app.state) : [];
        for (let i = 0; i < _series.length; i++) {
          if ((deck.tags || []).indexOf(_series[i].tagKey) >= 0) { deckSeries = _series[i]; break; }
        }
        inner = '<h3>' + esc(deck.name) + '</h3>' +
          '<div class="menu-list">' +
          '<button class="menu-item" data-act="browser-deck" data-id="' + esc(deck.id) + '">' + icon('table', 'i16') + '浏览卡片</button>' +
          '<button class="menu-item" data-act="deck-options" data-id="' + esc(deck.id) + '">' + icon('settings', 'i16') + '牌组选项</button>' +
          '<button class="menu-item" data-act="deck-reset" data-id="' + esc(deck.id) + '">' + icon('rotate', 'i16') + '重置此牌组进度</button>' +
          '<button class="menu-item" data-act="deck-rename" data-id="' + esc(deck.id) + '">' + icon('pencil', 'i16') + '重命名</button>' +
          '<button class="menu-item" data-act="deck-export" data-id="' + esc(deck.id) + '">' + icon('upload', 'i16') + '导出此牌组</button>' +
          '<button class="menu-item" data-act="deck-subdeck" data-id="' + esc(deck.id) + '">' + icon('plus', 'i16') + '新建子牌组</button>' +
          (deckSeries ? '<button class="menu-item danger" data-act="series-delete-by-deck" data-id="' + esc(deck.id) + '">' + icon('trash', 'i16') + '删除整个词库（' + esc(deckSeries.name) + '）</button>' : '') +
          '<button class="menu-item danger" data-act="deck-delete" data-id="' + esc(deck.id) + '">' + icon('trash', 'i16') + '删除牌组</button>' +
          '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      } else {
        inner = '<h3>牌组不存在</h3><div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      }
    } else if (m.type === 'flag') {
      inner = '<h3>设置标记</h3><div class="subtle" style="margin-bottom:10px">标记可用于筛选和浏览器搜索（flag:1 … flag:7）。</div>' +
        '<div class="flag-row">';
      for (let i = 0; i <= 7; i++) {
        if (i === 0) {
          inner += '<button class="flag-pick" data-act="flag-set" data-flag="0" title="无标记"><span class="flag-none">无</span></button>';
        } else {
          inner += '<button class="flag-pick" data-act="flag-set" data-flag="' + i + '">' +
            '<span class="flag-dot big" style="background:' + FC.FLAG_COLORS[i] + '"></span></button>';
        }
      }
      inner += '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button></div>';
    } else if (m.type === 'tag') {
      inner = '<h3>添加标签</h3><div class="field"><label>标签（空格分隔）</label>' +
        '<input id="mTags" value="' + esc(m.tags || '') + '" placeholder="动词 高频" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'move') {
      let opts = '';
      for (let i = 0; i < app.state.decks.length; i++) {
        opts += '<option value="' + esc(app.state.decks[i].id) + '">' + esc(app.state.decks[i].name) + '</option>';
      }
      inner = '<h3>移动到牌组</h3><div class="field"><label>目标牌组</label><select id="mMoveDeck">' +
        opts + '</select></div><div class="dialog-actions">' +
        '<button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">移动</button></div>';
    } else if (m.type === 'reschedule') {
      inner = '<h3>重新调度</h3><div class="subtle" style="margin-bottom:8px">把卡片的下次到期时间设为 N 天后，不会清除复习历史。</div>' +
        '<div class="field"><label>天数</label><input id="mDays" value="1" inputmode="numeric" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">确定</button></div>';
    } else if (m.type === 'shortcuts') {
      const k = function (t) { return '<kbd>' + t + '</kbd>'; };
      const kr = function (keys, label) {
        return '<div class="shortcut-row"><span class="shortcut-keys">' + keys +
          '</span><span class="shortcut-label">' + label + '</span></div>';
      };
      inner = '<h3>键盘快捷键</h3>' +
        '<div class="subtle" style="margin-bottom:14px">双手不离键盘刷完一组卡。任何页面按 ' + k('?') + ' 都能唤出本面板。</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">卡片学习</div>' +
          kr(k('空格') + ' / ' + k('Enter'), '翻面，看背面') +
          kr(k('空格') + ' / ' + k('Enter') + ' ' + k('3'), '良好（已翻面时快速通过）') +
          kr(k('1'), '重来 · 几分钟后再次出现') +
          kr(k('2'), '困难') +
          kr(k('4'), '简单') +
          kr(k('E') + ' ' + k('S') + ' ' + k('F') + ' ' + k('I') + ' ' + k('R'), '编辑 / 暂停 / 标记 / 信息 / 重置') +
        '</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">词书速记</div>' +
          kr(k('空格') + ' / ' + k('Enter'), '翻面 / 再按一次 = 认识') +
          kr(k('1') + ' ' + k('2') + ' ' + k('3'), '不认识 / 模糊 / 认识') +
        '</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">全局</div>' +
          kr(k('Ctrl') + ' + ' + k('K'), '打开智能命令面板') +
          kr(k('?'), '打开本快捷键面板') +
          kr(k('B'), '打开卡片浏览器') +
          kr(k('Ctrl') + ' + ' + k('Z'), '撤销上一步') +
          kr(k('Esc'), '退出学习 / 关闭弹窗') +
        '</div>' +
        '<div class="dialog-actions"><button class="btn btn-primary" data-act="modal-ok">知道了</button></div>';
    }

    return '<div class="mask" data-act="mask-click"><div class="dialog' + (m.wide ? ' dialog-wide' : '') + '">' + inner + '</div></div>';
  }

  // ---------------------------------------------------------------- 智能助手 · 小星
  // 悬浮入口按钮：学习会话中隐藏，避免挡住评分条；打开后进入完整页面 AiPage
  function aiLayer(app) {
    if (!FC.AI) return '';
    const inSession = !!((app.study && app.studyActive !== false) || app.wb || app.battle);
    if (inSession) return '';
    return '<button class="ai-fab' + (app.aiOpen ? ' hidden' : '') + '" data-act="ai-toggle" ' +
      'title="小星 · 离线智能助手" aria-label="打开小星助手">' + icon('sparkles', 'i22') +
      (app.aiUnread ? '<span class="ai-fab-dot"></span>' : '') + '</button>';
  }

  // 账户菜单：点头像弹出，参照 WorkBuddy 的账户面板（高面板 + 账户卡 + 功能入口）
  function accountMenuLayer(app) {
    if (!app.accountMenuOpen) return '';
    const acc = app.account || {};
    const on = !!acc.loggedIn;
    const name = app.accountDisplayName ? app.accountDisplayName() : (acc.nickname || '学习者');
    const idt = accountIdentity(app);
    // 学习概览统计
    let decks = 0, cards = 0, mastered = 0;
    const st = app.state || {};
    if (Array.isArray(st.decks)) {
      decks = st.decks.length;
      for (let i = 0; i < st.decks.length; i++) {
        const cs = st.decks[i].cards;
        if (!Array.isArray(cs)) continue;
        cards += cs.length;
        for (let j = 0; j < cs.length; j++) {
          const sc = cs[j] && cs[j].scheduling;
          if (sc && ((Number(sc.stability) || 0) >= 21 || sc.state === 2)) mastered++;
        }
      }
    }
    // 豆包风菜单行：线性图标 + 文字 + 右侧数值/箭头
    const item = function (ico, act, label, val, cls) {
      return '<button class="am-item' + (cls ? ' ' + cls : '') + '" data-act="' + act + '">' +
        '<span class="am-ico">' + icon(ico, 'i20') + '</span>' +
        '<span class="am-txt"><b>' + label + '</b></span>' +
        (val ? '<span class="am-val">' + val + '</span>' : '') +
        icon('chevronRight', 'i14') + '</button>';
    };
    const cloudCfg = (window.FC && FC.CLOUD_SYNC_CONFIG && FC.CLOUD_SYNC_CONFIG.anonKey);
    return '<div class="acct-menu-mask" data-act="account-menu-close"></div>' +
      '<div class="acct-menu" role="dialog" aria-label="账户菜单">' +
      '<div class="am-head">' +
      '<button class="am-head-acct" data-act="account-open">' + avatarFace(acc, 'ava-lg') +
      '<span class="am-head-txt"><b>' + esc(on ? name : '登录 / 注册') + '</b>' +
      '<small class="am-head-id">' + esc(on ? (idt.ready ? idt.code : 'ID 待填手机尾号') : '登录后生成账户 ID') + '</small></span>' +
      icon('chevronRight', 'i14') + '</button>' +
      '<div class="am-head-meta">' + decks + ' 牌组 · ' + cards + ' 卡片 · 已掌握 ' + mastered + '</div>' +
      '</div>' +
      '<div class="am-list">' +
      '<div class="am-group">' +
      item('user', 'account-open', '个人中心') +
      item('settings', 'goto-settings', '设置') +
      '</div>' +
      '<div class="am-group">' +
      item('shield', 'privacy-info', '隐私说明') +
      (cloudCfg ? item('cloud', 'account-open', '云同步', '已开启') : '') +
      item('sparkles', 'ai-toggle', '小星助手') +
      '</div>' +
      '</div>' +
      '<div class="am-foot">' +
      (on
        ? item('logout', 'account-logout', '退出登录', '', 'am-item-danger')
        : '<button class="am-item am-item-primary" data-act="account-open">' +
          '<span class="am-ico">' + icon('lock', 'i20') + '</span>' +
          '<span class="am-txt"><b>登录 / 注册</b></span></button>') +
      '<div class="am-sign">闪星卡 StarCard · 小李工作室</div>' +
      '</div></div>';
  }

  // 命令面板结果行（供完整页面 CmdPage 初始渲染与实时过滤复用）
  function cmdRowsHtml(app) {
    if (!FC.AI) return '';
    const list = FC.AI.FILTER(app, app.cmdQuery || '', 8);
    let rows = '';
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      rows += '<button class="cmd-row' + (i === app.cmdIndex ? ' on' : '') + '" data-act="cmd-pick" data-i="' + i + '">' +
        '<span class="cmd-ico">' + icon(c.icon, 'i18') + '</span>' +
        '<span class="cmd-txt"><b>' + esc(c.label) + '</b><small>' + esc(c.sub) + '</small></span>' +
        (i === app.cmdIndex ? '<span class="cmd-enter">' + icon('chevronRight', 'i14') + '</span>' : '') +
        '</button>';
    }
    if (!rows) rows = '<div class="cmd-empty">没有匹配项，换个关键词试试</div>';
    return rows;
  }

  function aiBriefing(app) {
    if (!FC.AI || !FC.AI.BRIEFING) return '';
    const txt = FC.AI.BRIEFING(app);
    return '<div class="ai-brief">' +
      '<span class="ai-brief-ico">' + icon('sparkles', 'i18') + '</span>' +
      '<div class="ai-brief-txt"><b>小星今日简报</b><span>' + esc(txt) + '</span></div>' +
      '<button class="ai-brief-cta" data-act="ai-prompt" data-q="帮我安排今天的学习计划">' +
      '让小星安排' + icon('chevronRight', 'i14') + '</button></div>';
  }

  function aiDiagnosis(app) {
    if (!FC.AI || !FC.AI.DIAGNOSIS) return '';
    const items = FC.AI.DIAGNOSIS(app);
    let rows = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      rows += '<div class="ai-diag-row tone-' + esc(it.tone) + '">' +
        '<span class="ai-diag-ico">' + icon(it.icon, 'i18') + '</span>' +
        '<div><b>' + esc(it.title) + '</b><span>' + esc(it.desc) + '</span></div></div>';
    }
    return '<div class="section-title">智能诊断 · 小星</div><div class="card wide ai-diag">' + rows +
      '<button class="btn btn-sm" style="margin-top:12px" data-act="ai-prompt" data-q="帮我安排今天的学习计划">' +
      icon('sparkles', 'i14') + '让小星帮我规划</button></div>';
  }

  // 覆盖层：悬浮入口（小星按钮等），附加到所有页面根节点之后
  function overlays(app) {
    return aiLayer(app) + accountMenuLayer(app);
  }

  // ============================================================
  // ArkUI 声明式页面组件（鸿蒙 ArkTS 风格：class extends Component）
  // ============================================================

  // 牌组学习项（声明式）
  function deckStudyItemEl(d, s, now, st) {
    const c = s.deckCounts(d, now);
    const total = d.cards.length;
    const isSat = (d.tags || []).indexOf('sat800') >= 0;
    const cap = (typeof FC.settingsFor === 'function' ? FC.settingsFor(d, st.settings) : st.settings).newCardsPerDay;
    const left = Math.max(0, cap - st.newToday);
    const capped = c[0] > left;
    let inProgress = 0;
    for (let k = 0; k < d.cards.length; k++) {
      const cc = d.cards[k];
      if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
    }
    const masteredCount = Math.max(0, total - c[0] - inProgress);
    const masterPct = total === 0 ? 0 : Math.round(masteredCount / total * 100);
    const key = String((d && d.id) || (d && d.name) || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const tone = 'av-tone-' + (h % 8);

    const chips = [];
    if (c[0]) chips.push(new A.El('span', '新 ' + c[0]).cls('dchip dc-new'));
    if (c[1]) chips.push(new A.El('span', '到期 ' + c[1]).cls('dchip dc-due'));
    if (!c[0] && !c[1] && total > 0) chips.push(new A.El('span', '今日已完成').cls('dchip dc-done'));

    const nameEl = new A.El('div').cls('name').child(new A.El('span', d.name));
    if (chips.length) nameEl.child(new A.El('span').cls('deck-chips').children(chips));

    const main = new A.El('div').cls('li-main').children([
      nameEl,
      new A.El('div').cls('meta').html((d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + masteredCount + ' / ' + total + ' 张')
    ]);
    if (capped) {
      main.child(new A.El('div').cls('cap-warn').attr('act', 'settings-open').title('点击前往统一设置').children([
        iconEl('info', 'i13'),
        new A.El('span', '今日新卡限 ' + left + ' 张（共 ' + c[0] + ' 张待学）· 点此调大上限')
      ]));
    }
    main.child(new A.El('div').cls('progress deck-prog').child(new A.El('span').style('width', masterPct + '%')));

    return new A.El('div').cls('list-item deck-item').attr('act', 'study-deck').attr('id', d.id).children([
      new A.El('div').cls('avatar deck-av ' + tone).child(iconEl(isSat ? 'book' : 'layers', 'i20')),
      main,
      new A.El('div').cls('li-actions').children([
        btnEl({ label: '学习', type: 'primary', size: 'sm', act: 'study-deck', id: d.id }),
        btnEl({ type: 'more', size: 'sm', act: 'deck-menu', id: d.id, title: '更多操作', ico: 'more', icoSize: 'i16' })
      ])
    ]);
  }

  // 首页（卡片页）
  class DeckPage extends A.Component {
    build() {
      const app = this.props.app;
      const st = app.state;
      const s = new FC.Scheduler(st.settings);
      const now = Date.now();
      const ov = FC.smartOverview ? FC.smartOverview(st) : null;

      const content = new A.El('div').cls('content home-page');
      // 用区块容器承接 HTML：A.Html 会生成 <span>，作为 grid 子项只有一列宽，
      // 会把紫色概览压成窄条。hp-block 统一通栏。
      const HP = function (html) { return new A.El('div').cls('hp-block').html(html); };
      if (ov) content.child(HP(overviewHero(ov, app)));
      const rsb = resumeStudyBanner(app);
      if (rsb) content.child(HP(rsb));
      if (FCUI.aiBriefing) { const ab = FCUI.aiBriefing(app); if (ab) content.child(HP(ab)); }
      const he = homeExtras(app, ov);
      if (he) content.child(HP(he));
      if (st.decks.length === 0) {
        const onboard = new A.El('div').cls('onboard').children([
          new A.El('div').cls('ob-head').children([
            new A.El('span').cls('ob-ico').child(iconEl('cards', 'i20')),
            new A.El('div').children([
              new A.El('b', '快速开始'),
              new A.El('small', '所有数据保存在本设备，可离线使用。')
            ])
          ]),
          new A.El('div').cls('ob-steps').children([
            new A.El('div').cls('ob-step').children([
              new A.El('span', '1').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '导入词库'),
                new A.El('small', '支持 .srcd / Anki .apkg / CSV；每个词库会自动成为一个系列')
              ]),
              btnEl({ label: '去导入', type: 'primary', size: 'sm', act: 'import-hub' })
            ]),
            new A.El('div').cls('ob-step').children([
              new A.El('span', '2').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '导入自己的内容'),
                new A.El('small', '支持 Anki .apkg / .colpkg、.srcd 与 CSV，或新建牌组')
              ]),
              btnEl({ label: '前往词书', size: 'sm', act: 'tab', tab: 1 })
            ]),
            new A.El('div').cls('ob-step').children([
              new A.El('span', '3').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '键盘操作'),
                new A.El('small', '空格 / 回车翻面 · 1-4 评分')
              ]),
              btnEl({ label: '查看快捷键', size: 'sm', act: 'shortcuts-help' })
            ])
          ])
        ]);
        content.child(onboard);
      } else {
        content.child(sectionTitleEl('牌组 · 点击开始学习'));
        const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
        const split = splitDecksBySeries(st, seriesList);
        for (let si = 0; si < seriesList.length; si++) {
          const se = seriesList[si];
          const ds = split.bySeries[se.id];
          if (!ds || !ds.length) continue;
          const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
          const group = new A.El('div').cls('series-group' + (collapsed ? ' collapsed' : '')).children([
            new A.El('div').cls('sg-head').children([
              A.Html('<button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>'),
              new A.El('span', se.name).cls('sg-name'),
              new A.El('span', ds.length + ' 个分册').cls('sg-meta'),
              btnEl({ label: '查看系列', size: 'sm', cls: 'sg-go', act: 'series-open', id: se.id })
            ])
          ]);
          for (let i = 0; i < ds.length; i++) group.child(deckStudyItemEl(ds[i], s, now, st));
          content.child(group);
        }
        if (split.userDecks.length) {
          content.child(sectionTitleEl('牌组 · 自建'));
          for (let i = 0; i < split.userDecks.length; i++) content.child(deckStudyItemEl(split.userDecks[i], s, now, st));
        }
      }

      return new A.El('div').id('root').children([
        titlebarEl('卡片', 'FSRS-5 间隔重复', {
          actions: '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览</button>' +
            '<button class="btn btn-sm" data-act="custom-study">' + icon('layers', 'i14') + '自定义学习</button>'
        }),
        content,
        tabbarEl(0, app)
      ]);
    }
  }

  // 通知页（声明式）
  class NoticePage extends A.Component {
    build() {
      const app = this.props.app;
      const items = noticeItems(app);
      const unread = noticeUnread(app) > 0;
      const content = new A.El('div').cls('content');
      if (!items.length) {
        content.child(new A.El('div').cls('card wide').child(new A.El('div').cls('notice-empty').children([
          iconEl('bell', 'i26'),
          new A.El('div', '暂时没有要提醒的事。'),
          new A.El('div', '今天没有待学卡片，也备份过了。').cls('subtle')
        ])));
      } else {
        const list = new A.El('div').cls('notice-list');
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const row = new A.El('div').cls('notice-item tone-' + it.tone + (unread ? ' unread' : ''));
          const ico = new A.El('span').cls('notice-ico').child(iconEl(it.icon, 'i20'));
          if (unread) ico.child(new A.El('i').cls('notice-dot'));
          const txt = new A.El('div').cls('notice-txt').children([
            new A.El('b', it.title),
            new A.El('small', it.desc)
          ]);
          row.children([ico, txt]);
          if (it.cta) {
            const b = btnEl({ label: it.cta, size: 'sm', act: 'notice-go' });
            if (i === 0) b.cls('btn btn-sm btn-primary');
            if (it.page) b.attr('page', it.page); else b.attr('tab', it.tab || 0);
            row.child(b);
          }
          list.child(row);
        }
        content.child(list);
      }
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('row-gap').children([
          btnEl({ label: '全部标为已读', act: 'notice-read', ico: 'checkCircle', icoSize: 'i16' }),
          btnEl({ label: '备份中心', act: 'backup-open', ico: 'shield', icoSize: 'i16' })
        ]),
        new A.El('div', '通知每天汇总一次：今日待学、连续打卡、备份提醒。全部在本机生成，不上传任何服务器。').cls('subtle').style('margin-top', '12px')
      ]));
      return new A.El('div').id('root').children([
        titlebarEl('通知', '学习提醒 · 备份提示', { back: { act: 'notice-back' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 备份中心页（声明式）
  class BackupPage extends A.Component {
    build() {
      const app = this.props.app;
      const st = app.state;
      const last = app.lastBackupAt ? app.lastBackupAt() : 0;
      const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
      const remind = st.settings.backupRemindDays === undefined ? 14 : st.settings.backupRemindDays;
      const deckCount = st.decks.length;
      let cardCount = 0;
      for (let i = 0; i < st.decks.length; i++) cardCount += st.decks[i].cards.length;

      const content = new A.El('div').cls('content');
      content.child(new A.El('div').cls('stat-grid').children([
        statBoxEl(deckCount, '牌组数', false, 'folder'),
        statBoxEl(cardCount, '卡片数', false, 'cards'),
        statBoxEl(!last ? '未备份' : (days === 0 ? '今天' : days + ' 天前'), '上次备份', !last, 'shield')
      ]));

      content.child(sectionTitleEl('导出备份'));
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('kv').children([new A.El('span', '导出内容').cls('kv-k'), new A.El('span', '全部牌组 · 学习进度 · 复习统计').cls('kv-v')]),
        new A.El('div').cls('kv').children([new A.El('span', '文件格式').cls('kv-k'), new A.El('span', '.srcd（单文件，跨设备可导入）').cls('kv-v')]),
        new A.El('div').cls('kv').children([new A.El('span', '不包含').cls('kv-k'), new A.El('span', '昵称头像 · 隐私偏好 · 班级/比赛数据').cls('kv-v')]),
        btnEl({ label: '导出 .srcd 备份', type: 'primary', cls: 'btn-block', act: 'backup-export', ico: 'shield', icoSize: 'i16' }).style('margin-top', '14px'),
        new A.El('div', '导出后把文件存到网盘 / U 盘 / 另一台设备。建议每 14 天备份一次。').cls('subtle').style('margin-top', '10px')
      ]));

      content.child(sectionTitleEl('导入恢复'));
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('row-gap').children([
          btnEl({ label: '导入 .srcd', act: 'import', ico: 'merge', icoSize: 'i16' }),
          btnEl({ label: '导入 Anki .apkg', act: 'apkg-open', ico: 'layers', icoSize: 'i16' })
        ]),
        new A.El('div', '同名牌组就地更新，学习进度按卡片正面自动迁移，不会重复堆叠。').cls('subtle').style('margin-top', '10px')
      ]));

      content.child(sectionTitleEl('备份提醒'));
      const remindSelect = new A.El('select').id('setBackupRemind').children([
        new A.El('option', '关闭提醒').value('0'),
        new A.El('option', '每 7 天').value('7'),
        new A.El('option', '每 14 天').value('14'),
        new A.El('option', '每 30 天').value('30')
      ]);
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('field').children([
          new A.El('label', '提醒频率'),
          remindSelect
        ]),
        btnEl({ label: '保存频率', size: 'sm', act: 'save-settings' }),
        new A.El('div', '到点后通知页会出现备份提醒。与「设置」页的备份提醒共用同一个设置。').cls('subtle').style('margin-top', '10px')
      ]));

      return new A.El('div').id('root').children([
        titlebarEl('备份中心', '导出 · 导入 · 提醒', { back: { act: 'backup-back' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 小星助手页（声明式 · 完整页面）
  class AiPage extends A.Component {
    build() {
      const app = this.props.app;
      const list = app.aiMessages || [];

      const msgs = new A.El('div').cls('ai-msgs').id('aiMsgs');
      if (!list.length && !app.aiBusy) {
        msgs.html(FC.AI && FC.AI.GREET ? FC.AI.GREET() : '');
      } else {
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (m.role === 'user') {
            msgs.child(new A.El('div').cls('ai-msg ai-msg-me').child(
              new A.El('div').cls('ai-bubble').child(new A.El('div', m.text))
            ));
          } else {
            msgs.child(new A.El('div').cls('ai-msg ai-msg-ai').children([
              new A.El('span').cls('ai-mini-ava').child(iconEl('sparkles', 'i14')),
              new A.El('div').cls('ai-bubble ai-bubble-ai').html(m.html || '')
            ]));
          }
        }
      }
      if (app.aiBusy) {
        msgs.child(new A.El('div').cls('ai-msg ai-msg-ai').children([
          new A.El('span').cls('ai-mini-ava').child(iconEl('sparkles', 'i14')),
          new A.El('div').cls('ai-bubble ai-bubble-ai').html('<div class="ai-typing"><i></i><i></i><i></i></div>')
        ]));
      }

      const input = new A.El('input').id('aiInput').type('text')
        .placeholder('问我任何学习问题…').value(app.aiDraft || '');
      input._attrs.autocomplete = 'off';
      const sendBtn = new A.El('button').cls('ai-send').attr('act', 'ai-send').child(iconEl('send', 'i18'));
      sendBtn._attrs['aria-label'] = '发送';

      const content = new A.El('div').cls('content ai-page').children([
        msgs,
        new A.El('div').cls('ai-input-row').children([input, sendBtn]),
        new A.El('div').cls('ai-foot').child(new A.El('div', '小星完全离线运行，你的数据不会离开这台设备'))
      ]);

      return new A.El('div').id('root').children([
        titlebarEl('小星', '离线智能助手 · 只懂你的数据', { back: { act: 'ai-close' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 命令面板页（声明式 · 完整页面）
  class CmdPage extends A.Component {
    build() {
      const app = this.props.app;
      const input = new A.El('input').id('cmdInput').type('text')
        .placeholder('搜索界面、功能、单词、卡片…').value(app.cmdQuery || '');
      input._attrs.autocomplete = 'off';

      const content = new A.El('div').cls('content cmd-page').child(
        new A.El('div').cls('cmd-shell').children([
          new A.El('div').cls('cmd-search').children([
            iconEl('search', 'i18'),
            input,
            new A.El('kbd', 'ESC')
          ]),
          new A.El('div').cls('cmd-list').id('cmdList').html(cmdRowsHtml(app)),
          new A.El('div').cls('cmd-foot').html(
            '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 执行</span>' +
            '<span class="cmd-foot-brand">' + icon('sparkles', 'i13') + ' 小星命令面板</span>'
          )
        ])
      );

      return new A.El('div').id('root').children([
        titlebarEl('命令', '搜索界面 · 功能 · 单词 · 卡片', { back: { act: 'cmd-close' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 字符串 HTML → 完整 DOM fragment（保留所有顶层节点，避免 overlays / modal 被丢弃）
  function htmlToNode(htmlStr) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlStr;
    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    return frag;
  }

  // 声明式页面 + 覆盖层 → DOM fragment
  function renderDeclarative(ComponentCls, app) {
    const rootNode = A.toNode(new ComponentCls({ app: app }).render());
    // 弹窗与覆盖层必须一起挂载：声明式页面（首页 / 小星 / 命令面板 / 通知 / 备份）以前漏了 modal，
    // 导致「牌组 ⋯ 菜单」「自定义学习」等点击后状态变了却毫无界面反应。
    const extra = modal(app) + overlays(app);
    if (!extra) return rootNode;
    const tmp = document.createElement('div');
    tmp.innerHTML = extra;
    const frag = document.createDocumentFragment();
    frag.appendChild(rootNode);
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    return frag;
  }

  // 渲染分派：声明式页面优先，其余页面回退到字符串渲染
  function renderArk(app) {
    if (app.aiOpen) return renderDeclarative(AiPage, app);
    if (app.cmdOpen) return renderDeclarative(CmdPage, app);
    if (app.noticePageOpen) return renderDeclarative(NoticePage, app);
    if (app.backupPageOpen) return renderDeclarative(BackupPage, app);
    if (app.study && app.studyActive !== false) { let h = '<div id="root">' + studySession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.wb) { let h = '<div id="root">' + wordBookSession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.battle) { let h = '<div id="root">' + battleSession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.browser && FCUI.browserPage) {
      let bh = '<div id="root">' + FCUI.browserPage(app) + '</div>';
      const bm = modal(app);
      if (bm) bh += bm;
      return htmlToNode(bh + overlays(app));
    }
    // 首页用声明式渲染
    if (app.tab === 0 && !app.cardManageDeckId && !app.seriesId && !app.accountOpen) {
      return renderDeclarative(DeckPage, app);
    }
    // 其余页面沿用字符串渲染（后续逐页迁移）
    return htmlToNode(FCUI.renderLegacy(app));
  }

  const FCUI = {
    esc: esc,
    icon: icon,
    aiLayer: aiLayer,
    cmdRowsHtml: cmdRowsHtml,
    aiBriefing: aiBriefing,
    aiDiagnosis: aiDiagnosis,
    renderLegacy: function (app) {
      if (app.study && app.studyActive !== false) {
        let sh = '<div id="root">' + studySession(app) + '</div>';
        const sm = modal(app);
        if (sm) sh += sm;
        return sh + overlays(app);
      }
      if (app.wb) return '<div id="root">' + wordBookSession(app) + '</div>' + overlays(app);
      if (app.battle) return '<div id="root">' + battleSession(app) + '</div>' + overlays(app);
      if (app.browser && FCUI.browserPage) {
        let bh = '<div id="root">' + FCUI.browserPage(app) + '</div>';
        const bm = modal(app);
        if (bm) bh += bm;
        return bh + overlays(app);
      }

      let body = '';
      // 卡片管理页优先于页签渲染：从「词书」页进入制作 / 编辑时，底部高亮仍留在来源页签
      // 系列详情页同样优先于页签：它是从「词书」进入的文件夹式内容视图
      if (app.cardManageDeckId) body = cardManagePage(app);
      else if (app.seriesId) body = seriesPage(app);
      else if (app.accountOpen) body = accountPage(app);
      else if (app.tab === 0) body = deckPage(app);
      else if (app.tab === 1) body = wordBookPage(app);
      else if (app.tab === 2) body = app.activeClassId ? classroomDetail(app) : classroomList(app);
      else if (app.tab === 3) body = deskmatePage(app);
      else if (app.tab === 4) body = battleConfig(app);
      else if (app.tab === 5) body = statsPage(app);
      else body = settingsPage(app);

      let html = '<div id="root">' + body + '</div>';
      const m = modal(app);
      if (m) html += m;
      return html + overlays(app);
    },
    render: renderArk
  };

  FCUI.THEME_PRESETS = THEME_PRESETS;
  global.FCUI = FCUI;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ===== js/anki-ui.js ===== */
/**
 * 闪星卡（StarCard）· Anki 界面扩展
 * 依赖 core.js + anki.js + ui.js，在 ui.js 之后、app.js 之前加载。
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  const FCUI = global.FCUI;
  if (!FC || !FCUI) throw new Error('anki-ui.js 需要先加载 core.js / anki.js / ui.js');

  const esc = FCUI.esc;
  const icon = FCUI.icon;
  const DAY = FC.DAY_MS;

  const STATE_LABEL = {
    new: '新卡', learning: '学习中', review: '复习', relearning: '重学'
  };

  function statusText(card) {
    if (card.suspended) return '已暂停';
    if (card.buried) return '已搁置';
    return STATE_LABEL[card.state] || card.state;
  }

  function dueText(card, now) {
    if (card.state === FC.STATE_NEW) return '—';
    if (!card.scheduling.due) return '—';
    const t = Date.parse(card.scheduling.due);
    if (isNaN(t)) return '—';
    const diff = t - now;
    if (diff <= 0) return '待复习';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' 分';
    const hours = Math.round(diff / 3600000);
    if (hours < 24) return hours + ' 小时';
    const days = Math.round(diff / DAY);
    if (days < 31) return days + ' 天';
    if (days < 365) return (days / 30).toFixed(1) + ' 月';
    return (days / 365).toFixed(1) + ' 年';
  }

  function flagDot(flag) {
    if (!flag) return '';
    return '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[flag] + '"></span>';
  }

  // ---------------------------------------------------------------- 浏览器
  function filteredRows(app) {
    const b = app.browser;
    const now = Date.now();
    let rows = FC.Search.run(app.state.decks, b.query || '', now);
    if (b.deckId) rows = rows.filter(function (r) { return r.deck.id === b.deckId; });
    const key = b.sortKey || 'due';
    const dir = b.sortDir === 'asc' ? 1 : -1;
    rows.sort(function (x, y) {
      let a = 0, c = 0;
      if (key === 'due') {
        a = x.card.scheduling.due ? Date.parse(x.card.scheduling.due) : 0;
        c = y.card.scheduling.due ? Date.parse(y.card.scheduling.due) : 0;
      } else if (key === 'front') {
        return dir * String(x.card.front).localeCompare(String(y.card.front), 'zh');
      } else if (key === 'deck') {
        return dir * String(x.deck.name).localeCompare(String(y.deck.name), 'zh');
      } else if (key === 'state') {
        return dir * String(x.card.state).localeCompare(String(y.card.state));
      } else if (key === 'interval') {
        a = x.card.scheduling.scheduledDays; c = y.card.scheduling.scheduledDays;
      } else if (key === 'ease') {
        a = x.card.scheduling.difficulty; c = y.card.scheduling.difficulty;
      } else if (key === 'reps') {
        a = x.card.scheduling.reps; c = y.card.scheduling.reps;
      } else if (key === 'created') {
        a = Date.parse(x.card.createdAt); c = Date.parse(y.card.createdAt);
      }
      return dir * (a - c);
    });
    return rows;
  }

  function selectedIds(app) {
    const b = app.browser;
    const out = [];
    for (const k in b.selected) if (Object.prototype.hasOwnProperty.call(b.selected, k) && b.selected[k]) out.push(k);
    return out;
  }

  function browserPage(app) {
    const rows = filteredRows(app);
    const total = rows.length;
    const limit = app.browser.limit || 300;
    const shown = rows.slice(0, limit);
    const selCount = selectedIds(app).length;

    let html = '<div class="browser-page">';
    html += '<header class="topbar browser-top">' +
      '<button class="btn-icon" data-act="browser-close" title="返回">' + icon('chevronLeft', 'i18') + '</button>' +
      '<div class="tb-main"><div class="topbar-t"><h1>浏览</h1></div>' +
      '<p>' + total + ' 张卡片' + (selCount ? ' · 已选 ' + selCount : '') + '</p></div>' +
      '<div class="tb-actions"><button class="btn btn-sm btn-primary" data-act="card-new-global">' +
      icon('plus', 'i14') + '添加卡片</button></div></header>';

    html += '<div class="browser-search">' +
      '<span class="search-ico">' + icon('search', 'i16') + '</span>' +
      '<input id="brQuery" data-act="br-search" value="' + esc(app.browser.query || '') + '" ' +
      'placeholder="搜索：deck:英语 tag:动词 is:due flag:1 -is:suspended" autocomplete="off" spellcheck="false" />' +
      '<button class="btn btn-sm" data-act="br-filter">' + icon('filter', 'i14') + '筛选</button>' +
      '<button class="btn btn-sm" data-act="br-clear">清除</button></div>';

    html += '<div class="browser-toolbar">' +
      '<label class="br-check-all"><input type="checkbox" data-act="br-check-all" ' +
      (shown.length > 0 && shown.every(function (r) { return app.browser.selected[r.card.id]; }) ? 'checked' : '') + ' /> 全选</label>' +
      '<span class="br-sep"></span>' +
      '<button class="btn btn-sm" data-act="br-pause" ' + (selCount ? '' : 'disabled') + '>' + icon('pause', 'i14') + '暂停</button>' +
      '<button class="btn btn-sm" data-act="br-unsuspend" ' + (selCount ? '' : 'disabled') + '>' + icon('play', 'i14') + '恢复</button>' +
      '<button class="btn btn-sm" data-act="br-flag" ' + (selCount ? '' : 'disabled') + '>' + icon('flag', 'i14') + '标记</button>' +
      '<button class="btn btn-sm" data-act="br-tag" ' + (selCount ? '' : 'disabled') + '>' + icon('tag', 'i14') + '加标签</button>' +
      '<button class="btn btn-sm" data-act="br-reset" ' + (selCount ? '' : 'disabled') + '>' + icon('rotate', 'i14') + '重置</button>' +
      '<button class="btn btn-sm" data-act="br-move" ' + (selCount ? '' : 'disabled') + '>移动</button>' +
      '<button class="btn btn-sm btn-danger" data-act="br-delete" ' + (selCount ? '' : 'disabled') + '>' + icon('trash', 'i14') + '删除</button>' +
      '<span class="br-grow"></span>' +
      '<button class="btn btn-sm" data-act="br-csv">' + icon('download', 'i14') + '导出 CSV</button>' +
      '</div>';

    html += '<div class="browser-body">' +
      '<div class="browser-table-wrap" id="brTable">' + browserTable(app) + '</div>' +
      '<aside class="browser-side" id="brPreview">' + browserPreview(app) + '</aside>' +
      '</div>';

    if (total > limit) {
      html += '<div class="browser-more">只显示前 ' + limit + ' 条。' +
        '<button class="btn btn-sm" data-act="br-more">显示更多</button></div>';
    }
    html += '</div>';
    return html;
  }

  function browserTable(app) {
    const rows = filteredRows(app);
    const limit = app.browser.limit || 300;
    const shown = rows.slice(0, limit);
    const now = Date.now();

    if (shown.length === 0) {
      return '<div class="empty" style="padding:60px 20px">' +
        '<div class="empty-ico">' + icon('search', 'i30') + '</div>' +
        '<div class="empty-title">没有匹配的卡片</div>' +
        '<div class="empty-t">未找到匹配的卡片，可调整筛选条件。</div></div>';
    }

    let html = '<table class="br-table"><thead><tr>' +
      '<th class="c-check"></th>' +
      '<th class="c-front" data-act="br-sort" data-key="front">正面</th>' +
      '<th data-act="br-sort" data-key="deck">牌组</th>' +
      '<th data-act="br-sort" data-key="state">状态</th>' +
      '<th data-act="br-sort" data-key="due">到期</th>' +
      '<th data-act="br-sort" data-key="interval">间隔</th>' +
      '<th data-act="br-sort" data-key="ease">难度</th>' +
      '<th data-act="br-sort" data-key="reps">复习</th>' +
      '<th class="c-tags">标签</th></tr></thead><tbody>';

    for (let i = 0; i < shown.length; i++) {
      const r = shown[i];
      const c = r.card;
      const checked = app.browser.selected[c.id] ? 'checked' : '';
      const active = app.browser.previewId === c.id ? ' active' : '';
      html += '<tr class="br-row' + active + '" data-act="br-row" data-id="' + esc(c.id) + '">' +
        '<td class="c-check"><input type="checkbox" data-act="br-check" data-id="' + esc(c.id) + '" ' + checked + ' /></td>' +
        '<td class="c-front"><div class="br-front">' + flagDot(c.flags) + esc(c.front) + '</div>' +
        '<div class="br-sub">' + esc(String(c.back || '').slice(0, 60)) + '</div></td>' +
        '<td class="br-deck">' + esc(r.deck.name) + '</td>' +
        '<td><span class="st st-' + c.state + '">' + statusText(c) + '</span></td>' +
        '<td>' + dueText(c, now) + '</td>' +
        '<td>' + (c.scheduling.scheduledDays ? c.scheduling.scheduledDays + ' 天' : '—') + '</td>' +
        '<td>' + (c.scheduling.difficulty ? c.scheduling.difficulty.toFixed(1) : '—') + '</td>' +
        '<td>' + c.scheduling.reps + '</td>' +
        '<td class="c-tags">' + c.tags.slice(0, 3).map(function (t) {
          return '<span class="chip gray">' + esc(t) + '</span>';
        }).join('') + '</td></tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function browserPreview(app) {
    const b = app.browser;
    if (!b.previewId) {
      return '<div class="br-preview-empty">' + icon('eye', 'i28') +
        '<div>选中一张卡片查看预览</div></div>';
    }
    const r = app.findCard(b.previewId);
    if (!r) return '<div class="br-preview-empty">卡片已不存在</div>';
    const c = r.card;
    const front = FC.renderCardHtml(c, 'front');
    const back = FC.renderCardHtml(c, 'back');

    return '<div class="br-preview">' +
      '<div class="br-preview-head"><div class="br-preview-title">卡片预览</div>' +
      '<button class="btn-icon" data-act="br-preview-close" title="关闭">' + icon('x', 'i16') + '</button></div>' +
      '<div class="br-preview-box"><div class="br-preview-label">正面</div><div class="field-html">' + front + '</div>' +
      '<hr class="br-hr" /><div class="br-preview-label">背面</div><div class="field-html">' + back + '</div></div>' +
      '<div class="br-meta">' +
      '<div class="kv"><span class="kv-k">类型</span><span class="kv-v">' + esc(typeName(c.notetype)) + (c.notetype === 'basic-reverse' ? ' · ' + (c.ord + 1) : '') + '</span></div>' +
      '<div class="kv"><span class="kv-k">牌组</span><span class="kv-v">' + esc(r.deck.name) + '</span></div>' +
      '<div class="kv"><span class="kv-k">状态</span><span class="kv-v">' + statusText(c) + '</span></div>' +
      '<div class="kv"><span class="kv-k">复习 / 遗忘</span><span class="kv-v">' + c.scheduling.reps + ' / ' + c.scheduling.lapses + '</span></div>' +
      '</div>' +
      '<div class="br-preview-actions">' +
      '<button class="btn btn-sm" data-act="card-edit" data-id="' + esc(c.id) + '">' + icon('pencil', 'i14') + '编辑</button>' +
      '<button class="btn btn-sm" data-act="card-info" data-id="' + esc(c.id) + '">' + icon('info', 'i14') + '信息</button>' +
      '<button class="btn btn-sm" data-act="br-flag-one" data-id="' + esc(c.id) + '">' + icon('flag', 'i14') + '标记</button>' +
      '<button class="btn btn-sm" data-act="br-pause-one" data-id="' + esc(c.id) + '">' + icon(c.suspended ? 'play' : 'pause', 'i14') + (c.suspended ? '恢复' : '暂停') + '</button>' +
      '</div></div>';
  }

  function typeName(id) {
    const t = FC.notetypeById(id);
    return t ? t.name : '基础';
  }

  // ---------------------------------------------------------------- 卡片编辑器
  function cardEditor(m) {
    const type = m.notetype || 'basic';
    const f = m.fields || { Front: m.front || '', Back: m.back || '', Extra: m.extra || '', Source: '' };
    const tags = (m.tags || []).join(' ');
    const media = m.media || [];

    let html = '<h3>' + (m.id ? '编辑卡片' : '添加卡片') + '</h3>' +
      '<div class="editor">' +
      '<div class="editor-main">' +
      '<div class="field"><label>笔记类型</label><select id="eType">';
    for (let i = 0; i < FC.NOTETYPES.length; i++) {
      const t = FC.NOTETYPES[i];
      html += '<option value="' + t.id + '"' + (t.id === type ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }
    html += '</select><div class="hint" id="eTypeHint">' + esc(FC.notetypeById(type).desc) + '</div></div>';

    html += '<div class="field"><label id="eFrontLabel">' + (type === 'cloze' ? '填空文本' : '正面') + '</label>' +
      '<textarea id="eFront" rows="4" placeholder="' +
      (type === 'cloze' ? '如：The {{c1::capital}} of France is Paris.' : '问题 / 单词 / 提示') + '">' +
      esc(f.Front || '') + '</textarea>' +
      (type === 'cloze' ? '<div class="hint">用 {{c1::答案}} 或 {{c1::答案::提示}} 挖空，每个空生成一张卡。</div>' : '') + '</div>';

    html += '<div class="field" id="eBackWrap"' + (type === 'cloze' ? ' style="display:none"' : '') + '>' +
      '<label>背面</label><textarea id="eBack" rows="3" placeholder="答案 / 释义">' + esc(f.Back || '') + '</textarea></div>';
    html += '<div class="field"><label>补充（可选）</label><textarea id="eExtra" rows="2" placeholder="例句、备注">' + esc(f.Extra || '') + '</textarea></div>';
    html += '<div class="field"><label>来源（可选）</label><input id="eSource" value="' + esc(f.Source || '') + '" placeholder="书名 / 链接" /></div>';
    html += '<div class="field"><label>标签（空格分隔）</label><input id="eTags" value="' + esc(tags) + '" placeholder="动词 高频" /></div>';

    html += '<div class="field"><label>媒体</label><div class="media-row">' +
      '<button class="btn btn-sm" data-act="editor-media" data-kind="image">' + icon('image', 'i14') + '插入图片</button>' +
      '<button class="btn btn-sm" data-act="editor-media" data-kind="audio">' + icon('music', 'i14') + '插入音频</button>' +
      '<input type="file" id="eMediaFile" accept="image/*,audio/*" style="display:none" />' +
      '</div><div class="media-list" id="eMediaList">' +
      media.map(function (x) { return '<span class="chip">' + esc(x.name) + '</span>'; }).join('') +
      '</div><div class="hint">插入后会在文本末尾追加引用，保存时一起写入 .srcd。</div></div>';

    html += '</div><div class="editor-side">' +
      '<div class="preview-label">预览 <button class="btn btn-sm" data-act="editor-preview">刷新</button></div>' +
      '<div class="preview-box field-html" id="ePreview">' + FC.renderCardHtml({
        front: f.Front || '', back: f.Back || '', extra: f.Extra || '',
        notetype: type, cloze: type === 'cloze' ? (f.Front || '') : '', ord: 0, tags: [], media: media
      }, 'front') + '</div>' +
      '<div class="hint" style="margin-top:10px">填空题预览以第一个空为例。</div>' +
      '</div></div>';

    html += '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- 牌组选项
  function deckOptions(m) {
    const deck = m.deck || {};
    const o = deck.options || FC.defaultDeckOptions();
    const g = m.global || FC.defaultSettings();
    const val = function (v, fb) { return (v === null || v === undefined) ? '' : String(v); };

    let html = '<h3>牌组选项 · ' + esc(deck.name || '') + '</h3>' +
      '<div class="subtle" style="margin-bottom:12px">留空表示跟随「设置」中的全局值。</div>' +
      '<div class="opt-grid">';

    html += optInput('每日新卡上限', 'oNew', val(o.newPerDay), String(g.newCardsPerDay));
    html += optInput('每日复习上限', 'oReview', val(o.reviewsPerDay), String(g.reviewCardsPerDay));
    html += optInput('学习步骤（分钟，逗号分隔）', 'oLearn', o.learningSteps ? o.learningSteps.join(',') : '', g.learningSteps.join(','));
    html += optInput('重学步骤（分钟）', 'oRelearn', o.relearningSteps ? o.relearningSteps.join(',') : '', g.relearningSteps.join(','));
    html += optInput('毕业间隔（天）', 'oGrad', val(o.graduatingInterval), String(g.graduatingInterval));
    html += optInput('简单间隔（天）', 'oEasy', val(o.easyInterval), String(g.easyInterval));
    html += optInput('Leech 阈值（遗忘次数）', 'oLeech', val(o.leechThreshold), String(g.leechThreshold));
    html += optInput('最大间隔（天）', 'oMaxIvl', val(o.maxInterval), String(g.maximumInterval));
    html += optInput('目标留存率（0.7-0.99）', 'oRetention', val(o.requestRetention), String(g.requestRetention));

    html += '<div class="field"><label>Leech 动作</label><select id="oLeechAction">' +
      '<option value=""' + (!o.leechAction ? ' selected' : '') + '>跟随全局（' + esc(g.leechAction === 'suspend' ? '自动暂停' : '仅标记') + '）</option>' +
      '<option value="tag"' + (o.leechAction === 'tag' ? ' selected' : '') + '>仅标记</option>' +
      '<option value="suspend"' + (o.leechAction === 'suspend' ? ' selected' : '') + '>自动暂停</option></select></div>';

    html += '<div class="field"><label>相关卡片搁置</label><select id="oBury">' +
      '<option value=""' + (o.buryRelated === null ? ' selected' : '') + '>跟随全局（' + (g.buryRelated ? '开启' : '关闭') + '）</option>' +
      '<option value="1"' + (o.buryRelated === true ? ' selected' : '') + '>开启</option>' +
      '<option value="0"' + (o.buryRelated === false ? ' selected' : '') + '>关闭</option></select></div>';

    html += '<div class="field"><label>新卡顺序</label><select id="oNewOrder">' +
      '<option value=""' + (!o.newOrder ? ' selected' : '') + '>跟随全局</option>' +
      '<option value="mix"' + (o.newOrder === 'mix' ? ' selected' : '') + '>交错</option>' +
      '<option value="order"' + (o.newOrder === 'order' ? ' selected' : '') + '>按创建顺序</option>' +
      '<option value="random"' + (o.newOrder === 'random' ? ' selected' : '') + '>随机</option></select></div>';

    html += '<div class="field"><label>复习顺序</label><select id="oReviewOrder">' +
      '<option value=""' + (!o.reviewOrder ? ' selected' : '') + '>跟随全局</option>' +
      '<option value="due"' + (o.reviewOrder === 'due' ? ' selected' : '') + '>按到期时间</option>' +
      '<option value="random"' + (o.reviewOrder === 'random' ? ' selected' : '') + '>随机</option></select></div>';

    html += '</div><div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn" data-act="deck-options-reset">恢复全局</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    return html;
  }

  function optInput(label, id, value, ph) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="' + id + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '" inputmode="decimal" /></div>';
  }

  // ---------------------------------------------------------------- 卡片信息
  function cardInfo(m) {
    const c = m.card;
    if (!c) return '<h3>卡片信息</h3><div class="subtle">卡片不存在</div>';
    const now = Date.now();
    const fmt = function (iso) {
      if (!iso) return '—';
      const t = Date.parse(iso);
      if (isNaN(t)) return '—';
      const d = new Date(t);
      const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const log = c.reviewLog.slice(-20).reverse();

    let html = '<h3>卡片信息</h3>' +
      '<div class="info-grid">' +
      kv('卡片 ID', c.id) +
      kv('笔记 ID', c.noteId || c.id) +
      kv('笔记类型', typeName(c.notetype) + (c.notetype === 'basic-reverse' ? ' · 模板 ' + (c.ord + 1) : '')) +
      kv('状态', statusText(c)) +
      kv('到期', fmt(c.scheduling.due) + '（' + dueText(c, now) + '）') +
      kv('当前间隔', (c.scheduling.scheduledDays || 0) + ' 天') +
      kv('稳定度', c.scheduling.stability.toFixed(2)) +
      kv('难度', c.scheduling.difficulty.toFixed(2)) +
      kv('复习次数', String(c.scheduling.reps)) +
      kv('遗忘次数', String(c.scheduling.lapses)) +
      kv('标记', c.flags ? '颜色 ' + c.flags : '无') +
      kv('Leech', c.leeched ? '是' : '否') +
      '</div>';

    html += '<div class="section-title" style="margin-top:16px">复习历史（最近 20 条）</div>';
    if (log.length === 0) {
      html += '<div class="subtle">还没有复习记录。</div>';
    } else {
      html += '<table class="info-log"><thead><tr><th>时间</th><th>评分</th><th>状态</th><th>间隔</th></tr></thead><tbody>';
      const labels = ['重来', '困难', '良好', '简单'];
      for (let i = 0; i < log.length; i++) {
        const e = log[i];
        html += '<tr><td>' + fmt(e.reviewedAt) + '</td><td>' + labels[(e.rating || 1) - 1] +
          '</td><td>' + (STATE_LABEL[e.state] || e.state) + '</td><td>' + Math.round(e.scheduledDays) + ' 天</td></tr>';
      }
      html += '</tbody></table>';
    }

    html += '<div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">关闭</button>' +
      '<button class="btn" data-act="info-reschedule" data-id="' + esc(c.id) + '">重新调度</button>' +
      '<button class="btn btn-danger" data-act="info-reset" data-id="' + esc(c.id) + '">重置进度</button>' +
      '</div>';
    return html;
  }

  function kv(k, v) {
    return '<div class="kv"><span class="kv-k">' + esc(k) + '</span><span class="kv-v mono">' + esc(v) + '</span></div>';
  }

  // ---------------------------------------------------------------- 自定义学习
  function customStudy(app) {
    const decks = app.state.decks;
    let html = '<h3>自定义学习</h3>' +
      '<div class="subtle" style="margin-bottom:8px">临时学习一组卡片，不计入每日新卡 / 复习上限，也不改变原有到期时间以外的数据。</div>' +
      '<div class="opt-grid">' +
      '<div class="field"><label>牌组</label><select id="csDeck"><option value="">全部牌组</option>';
    for (let i = 0; i < decks.length; i++) {
      html += '<option value="' + esc(decks[i].id) + '">' + esc(decks[i].name) + '</option>';
    }
    html += '</select></div>' +
      '<div class="field"><label>范围</label><select id="csMode">' +
      '<option value="cram">全部卡片（ cram ）</option>' +
      '<option value="due">只看到期</option>' +
      '<option value="new">只看新卡</option>' +
      '<option value="review">只看复习卡</option></select></div>' +
      '<div class="field"><label>标签筛选（可选）</label><input id="csTag" placeholder="如：动词" /></div>' +
      '<div class="field"><label>数量上限</label><input id="csLimit" value="50" inputmode="numeric" /></div>' +
      '</div><div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">开始</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- CSV 导入
  function csvImport(app) {
    let html = '<h3>导入 CSV / TSV</h3>' +
      '<div class="subtle" style="margin-bottom:8px">支持逗号、制表符或分号分隔；表头可为 Front / Back / Tags / Deck / Extra，也可以是 正面 / 背面 / 标签 / 牌组 / 补充。</div>' +
      '<div class="field"><label>默认牌组</label><input id="csvDeck" placeholder="未指定 Deck 列时使用" value="CSV 导入" /></div>' +
      '<div class="field"><label>粘贴内容</label><textarea id="csvText" rows="9" placeholder="Front,Back,Tags,Deck&#10;apple,苹果,名词,英语"></textarea></div>' +
      '<div class="field"><label>或选择文件</label><input type="file" id="csvFile" accept=".csv,.tsv,.txt" /></div>' +
      '<div class="hint" id="csvHint">导入会新建卡片，不会覆盖已有卡片。</div>' +
      '<div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn" data-act="csv-preview">预览</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">导入</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- 统计区块
  function analyticsBlocks(app) {
    const a = FC.analytics(app.state);
    const pct = function (v) { return (v * 100).toFixed(0) + '%'; };
    const maxDaily = Math.max(1, Math.max.apply(null, a.daily.map(function (d) { return d.reviews; })));

    // 每块「标题 + 卡片」包成 data-pair，外层 data-grid 在宽屏自动两/三列，
    // 避免十块统计竖着堆成一长条。
    function pair(title, body) {
      return '<div class="data-pair"><div class="section-title">' + title + '</div>' + body + '</div>';
    }

    let html = '<div class="data-grid">';

    // 状态分布 + 答案分布
    html += pair('卡片状态', '<div class="card">' +
      '<div class="dist-row">' +
      distItem('新卡', a.newCount, a.total, 'var(--ink-4)') +
      distItem('学习中', a.learning, a.total, 'var(--amber)') +
      distItem('复习中', a.review, a.total, 'var(--primary)') +
      distItem('重学', a.relearning, a.total, 'var(--red)') +
      '</div>' +
      '<div class="dist-row" style="margin-top:10px">' +
      distItem('暂停', a.suspended, a.total, 'var(--ink-4)') +
      distItem('搁置', a.buried, a.total, 'var(--ink-4)') +
      distItem('Leech', a.leech, a.total, 'var(--red)') +
      distItem('已标记', a.marked, a.total, 'var(--amber)') +
      '</div></div>');

    let ratingBody = '<div class="card"><div class="rating-dist">';
    const rlabels = ['重来', '困难', '良好', '简单'];
    const rtotal = Math.max(1, a.ratings.reduce(function (s, v) { return s + v; }, 0));
    for (let i = 0; i < 4; i++) {
      const p = Math.round(a.ratings[i] / rtotal * 100);
      ratingBody += '<div class="rating-col"><div class="rating-bar-wrap"><span class="rating-bar r' + (i + 1) + '" style="height:' + Math.max(2, p) + '%"></span></div>' +
        '<div class="rating-v">' + a.ratings[i] + '</div><div class="rating-k">' + rlabels[i] + '</div></div>';
    }
    ratingBody += '</div></div>';
    html += pair('答案按钮分布 · 累计 ' + a.ratings.reduce(function (s, v) { return s + v; }, 0) + ' 次', ratingBody);

    // 间隔分布
    let ivlBody = '<div class="card"><div class="ivl-list">';
    const ivlMax = Math.max(1, Math.max.apply(null, a.intervals));
    for (let i = 0; i < a.intervals.length; i++) {
      ivlBody += '<div class="ivl-row"><span class="ivl-k">' + FC.INTERVAL_LABELS[i] + '</span>' +
        '<span class="progress"><span style="width:' + Math.round(a.intervals[i] / ivlMax * 100) + '%"></span></span>' +
        '<b class="ivl-v">' + a.intervals[i] + '</b></div>';
    }
    ivlBody += '</div></div>';
    html += pair('间隔分布', ivlBody);

    // 最近 14 天
    let dailyBody = '<div class="card"><div class="chart">';
    for (let i = 0; i < a.daily.length; i++) {
      const d = a.daily[i];
      const h = Math.max(2, Math.round(d.reviews / maxDaily * 100));
      dailyBody += '<div class="chart-col"><span class="bar-v">' + d.reviews + '</span>' +
        '<span class="bar-track"><span class="bar' + (d.reviews === 0 ? ' zero' : '') + '" style="height:' + h + '%"></span></span>' +
        '<span class="bar-l">' + d.label + '</span></div>';
    }
    dailyBody += '</div></div>';
    html += pair('最近 14 天复习量', dailyBody);

    // 学习热力图
    html += pair('学习热力图 · 最近 20 周', '<div class="card">' +
      '<div class="heatmap">' +
      a.heatmap.map(function (h) {
        return '<span class="hm-cell l' + h.level + '" title="' + h.date + ' · ' + h.reviews + ' 次"></span>';
      }).join('') +
      '</div><div class="hm-legend"><span>少</span>' +
      '<span class="hm-cell l0"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span>' +
      '<span class="hm-cell l3"></span><span class="hm-cell l4"></span><span>多</span></div></div>');

    // 关键指标
    html += pair('记忆健康度', '<div class="stat-grid">' +
      statBox(pct(a.retention), '累计留存率', false, 'chart') +
      statBox(pct(a.retentionToday), '今日留存率', false, 'chart') +
      statBox(a.avgDifficulty ? a.avgDifficulty.toFixed(1) : '—', '平均难度', false, 'layers') +
      statBox(a.avgStability ? a.avgStability.toFixed(1) : '—', '平均稳定度（天）', false, 'clock') +
      statBox(Math.round(a.timeToday / 60000), '今日学习（分钟）', false, 'clock') +
      statBox(a.overdue, '逾期卡片', false, 'info') +
      '</div>');

    // 标签
    if (a.tags.length > 0) {
      html += pair('常用标签', '<div class="card"><div class="tag-cloud">' +
        a.tags.map(function (t) {
          return '<button class="chip" data-act="br-tag-search" data-tag="' + esc(t.tag) + '">' +
            esc(t.tag) + ' <span class="tag-n">' + t.count + '</span></button>';
        }).join('') + '</div></div>');
    }

    html += '</div>';
    return html;
  }

  function distItem(label, n, total, color) {
    const p = total ? Math.round(n / total * 100) : 0;
    return '<div class="dist-item"><div class="dist-top"><span>' + label + '</span><b>' + n + '</b></div>' +
      '<div class="dist-track"><span style="width:' + p + '%;background:' + color + '"></span></div></div>';
  }

  function statBox(v, k, accent, ico) {
    return '<div class="stat-box">' +
      (ico ? '<span class="stat-ico ico-' + esc(ico) + '">' + icon(ico, 'i16') + '</span>' : '') +
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v' + (accent ? ' accent' : '') + '">' + esc(v) + '</div></div>';
  }

  // ---------------------------------------------------------------- 学习页工具条
  function studyTools(app) {
    const card = app.currentStudyCard();
    if (!card) return '';
    const marked = (card.flags || 0) > 0;
    return '<div class="study-tools">' +
      '<button class="tool' + (marked ? ' on' : '') + '" data-act="study-flag" title="标记（F）">' +
      icon('flag', 'i16') + '<span>标记</span></button>' +
      '<button class="tool' + (card.suspended ? ' on' : '') + '" data-act="study-suspend" title="暂停（S）">' +
      icon('pause', 'i16') + '<span>' + (card.suspended ? '恢复' : '暂停') + '</span></button>' +
      '<button class="tool" data-act="study-edit" title="编辑（E）">' + icon('pencil', 'i16') + '<span>编辑</span></button>' +
      '<button class="tool" data-act="card-info" data-id="' + esc(card.id) + '" title="信息（I）">' + icon('info', 'i16') + '<span>信息</span></button>' +
      '<button class="tool" data-act="study-reset" title="重置：当作从没学过（R）">' + icon('rotate', 'i16') + '<span>重置</span></button>' +
      '<button class="tool" data-act="study-undo" title="撤销">' + icon('undo', 'i16') + '<span>撤销</span></button>' +
      '<button class="tool" data-act="shortcuts-help" title="键盘快捷键">' + icon('keyboard', 'i16') + '<span>快捷键</span></button>' +
      '</div>';
  }

  FCUI.browserPage = browserPage;
  FCUI.browserTable = browserTable;
  FCUI.browserPreview = browserPreview;
  FCUI.selectedIds = selectedIds;
  FCUI.cardEditor = cardEditor;
  FCUI.deckOptions = deckOptions;
  FCUI.cardInfo = cardInfo;
  FCUI.customStudy = customStudy;
  FCUI.csvImport = csvImport;
  FCUI.analyticsBlocks = analyticsBlocks;
  FCUI.studyTools = studyTools;
  FCUI.statusText = statusText;
  FCUI.dueText = dueText;
  FCUI.typeName = typeName;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


/* ===== js/app.js ===== */
/**
 * 闪星卡（StarCard）网页版控制器
 * 负责：localStorage 持久化、路由、学习会话、词书学习、PK、模态与导入导出。
 */
(function () {
  'use strict';
  const FC = window.FC;
  const FCUI = window.FCUI;
  const STORE_KEY = 'starcard-state-v1';
  const ACCOUNT_KEY = 'starcard-account-v1';
  // 学习会话单独持久化：退出 / 刷新 / 重开后原样继续（进度、掌握、到期倒计时都不变）
  const STUDY_KEY = 'starcard-study-session-v1';
  // 旧版数据键链：闪星卡 ← 旧版 ← 闪记(FC&FM)。首次读取时逐级迁移，升级不丢数据
  const LEGACY = {
    'starcard-state-v1': ['fcfm-state-v1'],
    'starcard-account-v1': ['fcfm-account-v1']
  };

  function byId(id) { return document.getElementById(id); }
  // HTML / 音频标记 → 纯文本（比赛选项、词书名等场景只需要可读文本）
  function plainText(v) {
    return String(v == null ? '' : v)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[sound:[^\]]*\]/gi, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function qs(sel, root) { return (root || document).querySelector(sel); }

  // 把云端 LLM 返回的纯文本安全地转成聊天气泡 HTML。
  // 模型输出不可信：先整体转义，再仅放行换行；绝不当作 HTML 注入。
  function cloudReplyHtml(text) {
    var s = String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    s = s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
    return '<div>' + s.split('\n').map(function (line) {
      return line ? '<div>' + line + '</div>' : '<div>&nbsp;</div>';
    }).join('') + '</div>';
  }

  function readStored(key) {
    try {
      let raw = localStorage.getItem(key);
      if (!raw) {
        const chain = LEGACY[key] || [];
        for (let i = 0; i < chain.length; i++) {
          const old = localStorage.getItem(chain[i]);
          if (old) { raw = old; break; }
        }
        // 迁移到新键，之后都读新键
        if (raw) localStorage.setItem(key, raw);
      }
      return raw;
    } catch (e) { return null; }
  }

  // 账户默认结构：学习资料与隐私偏好保存在本机；登录身份来自云端验证码认证
  function defaultAccount() {
    return {
      loggedIn: false, nickname: '', email: '', phone: '', uid: '', joinedAt: '',
      // 账户公开 ID 的构成：云端注册序号 + 注册年份 + 手机尾号
      regNo: 0, regYear: 0, phoneTail: '',
      // 云端登录身份：provider = email | phone；cloudUid 为云端用户 ID
      provider: '', cloudUid: '', cloudEmail: '', cloudPhone: '',
      avatarColor: 0, avatarData: '',
      privacy: { rememberLogin: true, showNickname: true, privacyBlur: false }
    };
  }

  const App = {
    state: FC.defaultState(),
    tab: 0,
    seriesId: '',
    showRemovedSeries: false,
    cardManageDeckId: '',
    study: null,
    studySessions: {},      // 按学习范围（deckId，''=学全部）分别保存的会话，互不串台
    studyActive: true,      // false = 会话已挂起（首页显示「继续学习」，不强制进入全屏）
    studyRevealed: false,
    wb: null,
    accountOpen: false,
    accountMenuOpen: false,
    noticePageOpen: false,
    backupPageOpen: false,
    activeClassId: '',
    battle: null,
    battleBookId: '',
    battlePlayersText: '我,同桌A,同桌B',
    battleHandText: '10',
    modal: null,
    apkgImport: null,
    browser: null,
    undoStack: [],
    _cardShownAt: 0,
    account: defaultAccount(),
    // 云端验证码登录状态
    loginMode: 'email',
    _loginDraft: null,
    _loginMsg: { text: '', kind: 'err' },
    _otpChallenge: null,
    _otpCountdown: 0,
    _otpBusy: false,
    _otpTimer: null,
    // 本地智能助手「小星」与命令面板状态
    aiOpen: false,
    aiMessages: [],
    aiDraft: '',
    aiBusy: false,
    aiUnread: false,
    cmdOpen: false,
    cmdQuery: '',
    cmdIndex: 0,
    _cmdResults: [],

    // ---- 持久化 ----
    load: function () {
      try {
        const raw = readStored(STORE_KEY);
        if (raw) this.state = FC.loadState(JSON.parse(raw));
      } catch (e) { /* 忽略损坏数据，使用默认 */ }
      if (!this.state || !this.state.decks) this.state = FC.defaultState();
      this.ensureDaily();
      this.loadAccount();
      this.applyTheme();
      this.loadStudySession();
      // 旧数据迁移：老版本无 state.series，按「系列名 › 分册名」自动重建系列（幂等）
      if (FC.ensureSeriesForLegacy && FC.ensureSeriesForLegacy(this.state)) this.save();
    },
    save: function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch (e) { /* 配额满忽略 */ }
      this.saveStudySession();
    },

    // ---- 学习会话持久化：退出 / 刷新 / 重开后原样继续 ----
    saveStudySession: function () {
      try {
        // v2：按学习范围（deckId，''=学全部）分别保存。切换词库时旧会话挂起留档，
        // 下次点回该词库才从它自己的位置继续；每张卡的 FSRS 记录本就存在卡片上，互不干扰。
        if (!this.studySessions) this.studySessions = {};
        if (!this.study) {
          localStorage.setItem(STUDY_KEY, JSON.stringify({
            v: 2, sessions: this.studySessions, activeKey: ''
          }));
          return;
        }
        const st = this.study;
        if (!st.studied) st.studied = {};
        const key = st.deckId || '';
        this.studySessions[key] = {
          study: st,
          active: this.studyActive !== false,
          revealed: !!this.studyRevealed,
          cardShownAt: this._cardShownAt || 0,
          savedAt: Date.now()
        };
        localStorage.setItem(STUDY_KEY, JSON.stringify({
          v: 2, sessions: this.studySessions, activeKey: key
        }));
      } catch (e) { /* 配额满忽略 */ }
    },
    loadStudySession: function () {
      try {
        const raw = localStorage.getItem(STUDY_KEY);
        if (!raw) return false;
        const snap = JSON.parse(raw);
        this.studySessions = {};
        // v2：按学习范围分别保存，当前活动范围由 activeKey 指定
        if (snap && snap.sessions && typeof snap.sessions === 'object') {
          this.studySessions = snap.sessions;
          const key = snap.activeKey != null ? snap.activeKey : '';
          const cur = this.studySessions[key];
          // 结构校验：队列与到期队列必须是数组，否则视为损坏数据
          if (!cur || !cur.study || !Array.isArray(cur.study.queue) || !Array.isArray(cur.study.dueQueue)) return false;
          const st = cur.study;
          if (!st.studied) st.studied = {};
          if (!st.gradeCounts) st.gradeCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
          this.study = st;
          this.studyActive = cur.active !== false;
          // 卡片与队列原样保留，但一律从正面开始：避免一进来先看到答案、再翻回单词
          this.studyRevealed = false;
          this._cardShownAt = cur.cardShownAt || 0;
          return true;
        }
        // 兼容旧版 v1 单会话：迁移到 v2 的 sessions[该会话的 deckId]
        const st = snap && snap.study;
        if (!st || !Array.isArray(st.queue) || !Array.isArray(st.dueQueue)) return false;
        if (!st.studied) st.studied = {};
        if (!st.gradeCounts) st.gradeCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
        this.study = st;
        this.studyActive = snap.active !== false;
        this.studyRevealed = false;
        this._cardShownAt = snap.cardShownAt || 0;
        this.studySessions[st.deckId || ''] = {
          study: st, active: this.studyActive, revealed: false,
          cardShownAt: this._cardShownAt || 0, savedAt: snap.savedAt || Date.now()
        };
        return true;
      } catch (e) { return false; }
    },
    // 启动 / 继续时恢复运行时：已到点的重来卡按绝对时间立即补出，否则重新拉起倒计时。
    // 注意：有 activeId 时保持当前卡不变（不能调用 advanceToNext，否则会跳卡）。
    resumeStudyRuntime: function (opts) {
      if (!this.study) return;
      this._clearStudyTimer();
      this._cardShownAt = this._cardShownAt || Date.now();
      const st = this.study;
      if (!st.activeId && st.dueQueue.length) this.advanceToNext(); // 内部会 _scheduleStudyTimer
      else if (!st.activeId) st.done = true;
      this.saveStudySession();
      if (!opts || !opts.silent) this.render();
    },
    // 从首页「继续学习」恢复
    resumeStudy: function () {
      if (!this.study) { this.toast('没有可继续的学习'); return; }
      this.studyActive = true;
      this.resumeStudyRuntime();
      this.toast('继续上次学习');
    },
    applyTheme: function () {
      const s = this.state.settings || {};
      const t = s.theme || 'light';
      let dark = t === 'dark';
      if (t === 'auto') {
        dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
      const root = document.documentElement;
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      // 强调色与背景：通过 data 属性交给 CSS 处理（不写死颜色，便于深色模式适配）
      root.setAttribute('data-accent', s.accent || 'brand');
      root.setAttribute('data-bg', s.bg || 'default');
      // 主题预设：整套底色 / 卡片 / 侧栏配色，不只是强调色
      root.setAttribute('data-preset', s.preset || 'default');
      // 学习卡字号：小 / 标准 / 大 —— 用 CSS 变量统一缩放正面词、背面释义与结构化释文
      const scale = s.studyFont === 's' ? 0.86 : (s.studyFont === 'l' ? 1.18 : 1);
      root.style.setProperty('--sf', String(scale));
      root.setAttribute('data-motion', s.motion === false ? 'off' : 'on');
    },
    // 一键应用主题预设（配色 + 背景）；明暗模式独立，不随预设改变
    applyPreset: function (id) {
      const list = (typeof FCUI !== 'undefined' && FCUI.THEME_PRESETS) || [];
      let p = null;
      for (let i = 0; i < list.length; i++) if (list[i].id === id) p = list[i];
      if (!p) return;
      const s = this.state.settings;
      s.accent = p.accent; s.bg = p.bg; s.preset = p.id;
      this.applyTheme();
      this.save();
      this.toast('已切换到「' + p.name + '」');
      if (this.modal) this.modal = null;
      this.render();
    },
    // 明暗模式：跟随系统 / 浅色 / 深色（即时生效，应用到所有主题）
    setThemeMode: function (mode) {
      if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') return;
      this.state.settings.theme = mode;
      this.applyTheme();
      this.save();
      this.toast(mode === 'auto' ? '已切换为跟随系统' : mode === 'dark' ? '已切换为深色模式' : '已切换为浅色模式');
      this.render();
    },
    loadAccount: function () {
      try {
        const raw = readStored(ACCOUNT_KEY);
        if (!raw) return;
        const a = JSON.parse(raw);
        if (!a || typeof a !== 'object') return;
        const d = defaultAccount();
        const p = (a.privacy && typeof a.privacy === 'object') ? a.privacy : {};
        d.loggedIn = !!a.loggedIn;
        d.nickname = typeof a.nickname === 'string' ? a.nickname : '';
        d.email = typeof a.email === 'string' ? a.email : '';
        d.uid = typeof a.uid === 'string' ? a.uid : '';
        d.joinedAt = typeof a.joinedAt === 'string' ? a.joinedAt : '';
        d.phone = typeof a.phone === 'string' ? a.phone : '';
        const rn = parseInt(a.regNo, 10);
        d.regNo = (rn > 0) ? rn : 0;
        const ry = parseInt(a.regYear, 10);
        d.regYear = (ry >= 2000 && ry <= 2200) ? ry : 0;
        d.phoneTail = String(a.phoneTail || '').replace(/\D/g, '').slice(-4);
        d.provider = typeof a.provider === 'string' ? a.provider : '';
        d.cloudUid = typeof a.cloudUid === 'string' ? a.cloudUid : '';
        d.cloudEmail = typeof a.cloudEmail === 'string' ? a.cloudEmail : '';
        d.cloudPhone = typeof a.cloudPhone === 'string' ? a.cloudPhone : '';
        const c = parseInt(a.avatarColor, 10);
        d.avatarColor = (c >= 0 && c <= 5) ? c : 0;
        // 头像只允许内联图片 data URI，避免把任意文本写进 src
        d.avatarData = (typeof a.avatarData === 'string' &&
          /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.avatarData))
          ? a.avatarData : '';
        d.privacy.rememberLogin = p.rememberLogin !== false;
        d.privacy.showNickname = p.showNickname !== false;
        d.privacy.privacyBlur = p.privacyBlur === true;
        // 关闭「记住登录状态」后，每次打开都视为未登录
        if (!d.privacy.rememberLogin) d.loggedIn = false;
        this.account = d;
      } catch (e) { /* 忽略损坏的账户数据 */ }
    },
    saveAccount: function () {
      try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account)); } catch (e) { /* 忽略 */ }
    },
    ensureDaily: function () {
      const today = FC.dateKey(Date.now());
      if (this.state.lastNewDate !== today) { this.state.lastNewDate = today; this.state.newToday = 0; }
      if (this.state.lastReviewDate !== today) { this.state.lastReviewDate = today; this.state.reviewToday = 0; }
    },

    // ---- 查询辅助 ----
    wordProgressOf: function (id, size) {
      for (let i = 0; i < this.state.wordProgress.length; i++) {
        if (this.state.wordProgress[i].bookId === id) {
          return FC.progressCounts(this.state.wordProgress[i], size);
        }
      }
      return [0, 0, size];
    },
    saveWordProgress: function (bookId, statuses) {
      for (let i = 0; i < this.state.wordProgress.length; i++) {
        if (this.state.wordProgress[i].bookId === bookId) {
          this.state.wordProgress[i].statuses = statuses;
          this.state.wordProgress[i].updatedAt = FC.nowIso();
          return;
        }
      }
      this.state.wordProgress.push({ bookId: bookId, statuses: statuses, cursor: 0, updatedAt: FC.nowIso() });
    },
    activeClass: function () {
      for (let i = 0; i < this.state.classrooms.length; i++) {
        if (this.state.classrooms[i].id === this.activeClassId) return this.state.classrooms[i];
      }
      return null;
    },
    findCard: function (id) {
      for (let i = 0; i < this.state.decks.length; i++) {
        const d = this.state.decks[i];
        for (let j = 0; j < d.cards.length; j++) if (d.cards[j].id === id) return { deck: d, card: d.cards[j] };
      }
      return null;
    },
    findDeck: function (id) {
      for (let i = 0; i < this.state.decks.length; i++) if (this.state.decks[i].id === id) return this.state.decks[i];
      return null;
    },
    // 删除整个系列：移除该系列全部分册 + 从 state.series 移除该系列（一次撤销可恢复，含系列本身）
    deleteSeries: function (tagKey) {
      if (!tagKey) return 0;
      const self = this;
      const victims = self.state.decks.filter(function (d) { return (d.tags || []).indexOf(tagKey) >= 0; });
      self.pushUndo('删除整个词库');
      const ids = {};
      for (let i = 0; i < victims.length; i++) ids[victims[i].id] = true;
      self.state.decks = self.state.decks.filter(function (d) { return !ids[d.id]; });
      // 动态系列直接物理移除（不再预置、无快捷恢复入口）；撤销时随 copyState.series 一起恢复
      if (self.state.series) self.state.series = self.state.series.filter(function (s) { return s.tagKey !== tagKey; });
      // 清理指向已删除牌组的界面状态
      if (self.cardManageDeckId && ids[self.cardManageDeckId]) self.cardManageDeckId = '';
      if (self.browser) { self.browser.deckId = ''; self.browser.selected = {}; }
      if (self.study && self.study.deckId && ids[self.study.deckId]) { self.study = null; self.studyRevealed = false; }
      if (self.studySessions) {
        Object.keys(self.studySessions).forEach(function (sdk) { if (sdk && ids[sdk]) delete self.studySessions[sdk]; });
      }
      if (self.seriesId) {
        const se = FC.seriesById ? FC.seriesById(self.seriesId, self.state) : null;
        if (!se || se.tagKey === tagKey) self.seriesId = '';
      }
      self.save();
      self.render();
      return victims.length;
    },
    // 恢复一个被移除的系列：只需清除标记，卡片在词书里重新可见（无卡片时显示导入引导）
    restoreSeries: function (id) {
      if (!id) return false;
      const se = FC.seriesById ? FC.seriesById(id, this.state) : null;
      if (!se) return false;
      const self = this;
      self.pushUndo('恢复词书');
      self.state.removedSeries = (self.state.removedSeries || []).filter(function (x) { return x !== id; });
      self.save();
      self.render();
      self.toast('已恢复「' + se.name + '」到词书');
      return true;
    },
    // ---- 撤销 ----
    pushUndo: function (label) {
      try {
        this.undoStack.push({
          label: label || '操作',
          state: FC.copyState(this.state),
          study: this.study ? JSON.parse(JSON.stringify(this.study)) : null
        });
        if (this.undoStack.length > 30) this.undoStack.shift();
      } catch (e) { /* 快照失败不阻塞主流程 */ }
    },
    undo: function () {
      if (this.undoStack.length === 0) { this.toast('没有可撤销的操作'); return; }
      const snap = this.undoStack.pop();
      this.state = snap.state;
      this.study = snap.study ? JSON.parse(JSON.stringify(snap.study)) : null;
      this.studyRevealed = false;
      this._clearStudyTimer();
      this.save();
      this.render();
      this.toast('已撤销：' + snap.label);
    },
    // 取当前应显示的卡片（Anki 式）：优先取「待到期重来队列」中已到期的卡，
    // 否则顺序取首轮新卡 / 复习卡。到点的重来卡会插回当前队列，而不是等一轮学完。
    // 当前正在展示的卡：纯读取 activeId（在 advanceToNext 里锁定），
    // 这样 render() 反复调用来算预览时不会把卡片切换掉。
    currentStudyCard: function () {
      const st = this.study;
      if (!st || !st.activeId) return null;
      const r = this.findCard(st.activeId);
      return r ? r.card : null;
    },
    // 本会话「已学会」的单词数：按卡片 id 去重，只统计以良好/简单通过毕业的卡。
    // 供学习页进度条使用；兼容旧会话（无 learned 字段时返回 0）。
    learnedCount: function () {
      const st = this.study;
      if (!st || !st.learned) return 0;
      return Object.keys(st.learned).length;
    },
    // 本会话「已学」去重计数：凡刷过的卡都算（不管是否掌握），进度条用它。
    studiedCount: function () {
      const st = this.study;
      if (!st || !st.studied) return 0;
      return Object.keys(st.studied).length;
    },
    // 选下一张卡并锁定：Anki 顺序 = 已到期的重来卡优先，其次首轮新卡/复习卡。
    advanceToNext: function () {
      const st = this.study;
      if (!st) return;
      this._refreshDue();
      const now = Date.now();
      const dq = st.dueQueue || [];
      // 1) 到点的重来卡（学习/重学），插回当前队列 —— 到点即出现，不用等一轮学完
      while (dq.length && dq[0].due <= now) {
        const item = dq.shift();
        const r = this.findCard(item.id);
        if (r && r.card.suspended !== true) {
          st.activeId = item.id; st.fromDue = true;
          this.studyRevealed = false; this._cardShownAt = Date.now();
          return;
        }
      }
      // 2) 首轮新卡 / 复习卡
      while (st.pos < st.queue.length) {
        const id = st.queue[st.pos]; st.pos += 1;
        const r = this.findCard(id);
        if (r && r.card.suspended !== true) {
          st.activeId = id; st.fromDue = false;
          this.studyRevealed = false; this._cardShownAt = Date.now();
          return;
        }
      }
      // 3) 首轮已空、无到期卡 → 无当前卡；若还有待到期卡则安排定时器，否则完成
      st.activeId = null;
      st.done = dq.length === 0;
      this._scheduleStudyTimer();
    },
    // 把待到期队列按时间排序（早的在前）
    _refreshDue: function () {
      const st = this.study;
      if (!st || !st.dueQueue) return;
      st.dueQueue.sort(function (a, b) { return a.due - b.due; });
    },
    // 首轮已学完，但还有重来卡在等待到期（学习页据此显示倒计时）
    studyWaiting: function () {
      const st = this.study;
      if (!st || st.activeId) return false;
      const dq = st.dueQueue || [];
      return dq.length > 0;
    },
    nextDueIn: function () {
      const st = this.study;
      if (!st || !st.dueQueue || !st.dueQueue.length) return 0;
      this._refreshDue();
      return Math.max(0, st.dueQueue[0].due - Date.now());
    },
    // 提前学习：把待到期卡全部立即解锁（Anki「提前学习」）
    studyAhead: function () {
      const st = this.study;
      if (!st || !st.dueQueue || !st.dueQueue.length) return;
      const now = Date.now();
      for (let i = 0; i < st.dueQueue.length; i++) st.dueQueue[i].due = now;
      this.toast('已提前解锁 ' + st.dueQueue.length + ' 张待复习卡');
      this.advanceToNext();
      this.save();
      this.render();
    },
    // 到期自动刷新：让重来卡到点时立刻出现在学习界面
    _clearStudyTimer: function () {
      if (this._studyTimer) { clearInterval(this._studyTimer); this._studyTimer = null; }
    },
    _scheduleStudyTimer: function () {
      this._clearStudyTimer();
      const st = this.study;
      if (!st || st.activeId || !st.dueQueue || !st.dueQueue.length) return;
      // 等待期只更新倒计时数字（不整页重绘，避免每秒闪一下）；到点才切卡
      this._studyTimer = setInterval(function () {
        if (!App.study || App.study.activeId || !App.studyActive) { App._clearStudyTimer(); return; }
        if (App.nextDueIn() <= 0) { App.advanceToNext(); App.saveStudySession(); App.render(); return; }
        const el = document.getElementById('studyCountdown');
        if (!el) return;
        const secs = Math.ceil(App.nextDueIn() / 1000);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        const cd = (mm > 0 ? mm + ' 分 ' : '') + ss + ' 秒';
        el.textContent = '下一张 ' + cd + ' 后出现';
      }, 1000);
    },
    allBooks: function () { return this.state.wordBooks.slice(); },
    // 比赛用词库：把「牌组」也当成可用的词库来源。
    // 之前只读 state.wordBooks，而词书只能由已下线的旧入口创建，
    // 于是导入的牌组再多，比赛页的下拉框也是空的、无法开局。
    battleBooks: function () {
      const out = [];
      const seen = {};
      const decks = this.state.decks || [];
      for (let i = 0; i < decks.length; i++) {
        const d = decks[i];
        const words = [];
        const cards = d.cards || [];
        for (let j = 0; j < cards.length; j++) {
          const c = cards[j];
          if (!c || c.suspended) continue;
          const ft = c.fields && c.fields.Front != null ? c.fields.Front : c.front;
          const bt = c.fields && c.fields.Back != null ? c.fields.Back : c.back;
          const word = plainText(ft);
          const meaning = plainText(bt).split(/[\n；;·]/)[0].slice(0, 60);
          if (!word || !meaning) continue;
          words.push({ word: word, meaning: meaning, phonetic: '', example: '', exampleCn: '' });
        }
        seen[d.id] = true;
        if (words.length >= 4) out.push({ id: d.id, name: d.name, words: words, fromDeck: true });
      }
      const books = this.state.wordBooks || [];
      for (let i = 0; i < books.length; i++) {
        if (seen[books[i].id]) continue;
        if ((books[i].words || []).length >= 4) out.push(books[i]);
      }
      return out;
    },
    bookById: function (id) {
      const all = this.allBooks();
      for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },

    // ---- 渲染 ----
    pageKey: function () {
      return [this.tab, this.accountOpen ? 1 : 0, this.cardManageDeckId, this.activeClassId].join('|');
    },
    render: function () {
      if (this.study && this.studyRevealed) {
        const c = this.currentStudyCard();
        if (c) this.study.preview = new FC.Scheduler(this.state.settings).preview(c, Date.now());
      }
      const root = byId('app');
      const prev = root.querySelector('.content');
      const key = this.pageKey();
      // 同一页面内重绘时保留滚动位置，切换页面则回到顶部
      const changed = this._pk !== key;
      const keep = (!changed && prev) ? prev.scrollTop : 0;
      const rendered = FCUI.render(this);
      root.innerHTML = '';
      root.appendChild(rendered);
      const next = root.querySelector('.content');
      if (next && keep) next.scrollTop = keep;
      this._pk = key;
      // 切页入场动效（一次性：播完移除，避免同页反复重绘时新建节点重播动画而闪烁）
      if (changed && root.classList) {
        root.classList.remove('page-in');
        void root.offsetWidth;
        root.classList.add('page-in');
        this.animateNumbers(root);
        if (this._pageInTimer) clearTimeout(this._pageInTimer);
        const r = root;
        this._pageInTimer = setTimeout(function () { r.classList.remove('page-in'); }, 900);
      }
      // 小星面板 / 命令面板：定位焦点、滚动到底部
      if (this.cmdOpen) {
        const ci = byId('cmdInput');
        if (ci && document.activeElement !== ci) {
          ci.focus();
          try { ci.setSelectionRange(ci.value.length, ci.value.length); } catch (e) {}
        }
      } else if (this.aiOpen) {
        const am = byId('aiMsgs');
        if (am) am.scrollTop = am.scrollHeight;
        const ai = byId('aiInput');
        if (ai && document.activeElement !== ai) ai.focus();
      }
      // 自动翻面：出题后到点自动翻到背面（仅在未翻面、设置开启时）
      this.scheduleAutoReveal();
      // 头像裁剪：渲染后按舞台实际尺寸计算基准缩放
      if (this.modal && this.modal.type === 'avatar-crop') this.mountAvatarCrop();
    },
    // 数字滚动：切页时把关键指标从 0 数到目标值（只改写文本，不动结构）
    animateNumbers: function (root) {
      if (!root || !root.querySelectorAll) return;
      if (root.getAttribute && root.getAttribute('data-motion') === 'off') return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (typeof window.requestAnimationFrame !== 'function') return;
      const sel = '.ov-fig b, .stat-box .v, .summary-cell b, .ov-ring-in b, ' +
                  '.summary-ring-in b, .deck-ring b, .hc-head em, .hf-nums b';
      const nodes = root.querySelectorAll(sel);
      const items = [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const raw = (el.textContent || '').trim();
        const m = /^([^\d+-]*)([+-]?)(\d+(?:[.,]\d+)?)(.*)$/.exec(raw);
        if (!m) continue;
        const num = parseFloat(m[3].replace(',', '.'));
        if (!isFinite(num) || Math.abs(num) > 99999) continue;
        const dot = /[.,]/.test(m[3]) ? 1 : 0;
        items.push({ el: el, pre: m[1], sign: m[2], to: num, suf: m[4], dot: dot, raw: raw });
      }
      if (!items.length) return;
      const dur = 620;
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      const tick = function (now) {
        const p = Math.min(1, ((now || Date.now()) - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.el.isConnected === false) continue;
          const v = it.to * e;
          it.el.textContent = it.pre + it.sign + (it.dot ? v.toFixed(it.dot) : String(Math.round(v))) + it.suf;
        }
        if (p < 1) {
          window.requestAnimationFrame(tick);
        } else {
          for (let i = 0; i < items.length; i++) {
            if (items[i].el.isConnected !== false) items[i].el.textContent = items[i].raw;
          }
        }
      };
      window.requestAnimationFrame(tick);
    },
    // 自动翻面定时器（autoRevealSeconds）：每张卡只触发一次，手动翻面/切卡会取消
    scheduleAutoReveal: function () {
      if (this._autoRevealTimer) { clearTimeout(this._autoRevealTimer); this._autoRevealTimer = null; }
      if (!this.study || this.studyRevealed) return;
      const secs = this.state.settings && this.state.settings.autoRevealSeconds;
      if (!secs || secs <= 0) return;
      if (!this.currentStudyCard || !this.currentStudyCard()) return;
      const self = this;
      this._autoRevealTimer = setTimeout(function () {
        self._autoRevealTimer = null;
        if (self.study && !self.studyRevealed && self.currentStudyCard && self.currentStudyCard()) {
          const flip = byId('app') && byId('app').querySelector('[data-act="study-flip"].flip-card');
          if (flip) flip.click();
        }
      }, secs * 1000);
    },
    toast: function (msg, type, iconName) {
      const t = document.createElement('div');
      t.className = 'toast toast-' + (type || 'info');
      const ico = iconName || (type === 'success' ? 'checkCircle' : type === 'ai' ? 'sparkles' : 'info');
      t.innerHTML = (FCUI && FCUI.icon ? FCUI.icon(ico, 'i16') : '') + '<span>' + FCUI.esc(msg) + '</span>';
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
    },

    // ---- 本地智能助手「小星」----
    aiToggle: function () {
      if (this.aiOpen) { this.aiClose(); return; }
      this.aiOpen = true;
      this.aiUnread = false;
      this.noticePageOpen = false;
      this.backupPageOpen = false;
      this.accountOpen = false;
      this.modal = null;
      this.render();
    },
    aiClose: function () { this.aiOpen = false; this.aiDraft = ''; this.render(); },
    aiOpenWith: function (text) {
      this.modal = null;
      this.cmdOpen = false;
      this.aiOpen = true;
      this.aiUnread = false;
      this.noticePageOpen = false;
      this.backupPageOpen = false;
      this.accountOpen = false;
      this.seriesId = ''; this.cardManageDeckId = '';
      // 先渲染出小星页面，再发起提问：原先 skipRender 让界面在 AI 思考的
      // 400ms 里毫无变化，看起来像「点了没反应」。
      if (text) {
        if (this.aiBusy) this.render(); else this.aiSend(text);
      } else this.render();
    },
    // 本地规则引擎回答（保留操作意图 / 查词朗读等本地能力）
    _aiLocalAnswer: function (text) {
      let res = { html: '<div>抱歉，我暂时无法回答这个问题。</div>' };
      try {
        if (window.FC && FC.AI && FC.AI.ANSWER) res = FC.AI.ANSWER(text, this) || res;
      } catch (e) {}
      return res;
    },
    // 落一条 AI 消息并收尾（离线/回退共用）
    _aiFinish: function (res, speakAfter) {
      const self = this;
      this.aiMessages.push({ role: 'ai', html: res.html || '' });
      this.aiBusy = false;
      this.render();
      if (res._action) {
        setTimeout(function () { self.runCommandByKey(res._action); }, 420);
      } else if (speakAfter && self.speakText) {
        setTimeout(function () { self.speakText(speakAfter); }, 200);
      }
    },
    aiSend: function (text, skipRender) {
      text = String(text == null ? '' : text).trim();
      if (!text || this.aiBusy) return;
      this.aiMessages.push({ role: 'user', text: text });
      this.aiDraft = '';
      this.aiBusy = true;
      if (!skipRender) this.render();
      const self = this;
      const local = this._aiLocalAnswer(text);
      const canCloud = !!(window.FC && FC.CloudLLM && FC.CloudLLM.available());
      // 操作意图与查词朗读走本地：它们要触发本地动作 / 读取本机词库，云端无法替代
      const keepLocal = !!(local._action || local.speak);

      if (!canCloud || keepLocal) {
        setTimeout(function () { self._aiFinish(local, local.speak); }, 380);
        return;
      }
      // 联网：把学习简报作为上下文交给真实大模型；失败自动回退本地引擎
      let context = '';
      try { context = (FC.AI && FC.AI.BRIEFING) ? (FC.AI.BRIEFING(self) || '') : ''; } catch (e) {}
      const question = context
        ? ('【我的学习情况】' + context + '\n\n【我的问题】' + text)
        : text;
      const history = (self.aiMessages || []).slice(0, -1); // 去掉刚 push 的当前问题
      let done = false;
      const fallback = function () {
        if (done) return; done = true;
        self._aiFinish(local, local.speak);
      };
      // 8 秒超时兜底，避免云慢导致一直转圈
      const timer = setTimeout(fallback, 8000);
      try {
        FC.CloudLLM.ask(question, history).then(function (answer) {
          if (done) return;
          if (!answer || !String(answer).trim()) { clearTimeout(timer); return fallback(); }
          done = true; clearTimeout(timer);
          self._aiFinish({ html: cloudReplyHtml(answer) }, null);
        }).catch(function () { clearTimeout(timer); fallback(); });
      } catch (e) { clearTimeout(timer); fallback(); }
    },
    aiPrompt: function (q) { this.aiOpenWith(q); },
    aiCmd: function (key) { this.aiClose(); this.runCommandByKey(key); },

    // ---- 命令面板----
    cmdToggle: function () {
      if (this.cmdOpen) { this.cmdClose(); return; }
      this.cmdOpen = true;
      this.cmdQuery = '';
      this.cmdIndex = 0;
      this.aiOpen = false;
      this.noticePageOpen = false;
      this.backupPageOpen = false;
      this.accountOpen = false;
      this.modal = null;
      try { this._cmdResults = (FC.AI && FC.AI.FILTER) ? FC.AI.FILTER(this, '', 8) : []; } catch (e) { this._cmdResults = []; }
      this.render();
    },
    cmdClose: function () { this.cmdOpen = false; this.cmdQuery = ''; this.cmdIndex = 0; this.render(); },
    refreshCmdList: function () {
      if (!this.cmdOpen) return;
      try { this._cmdResults = (FC.AI && FC.AI.FILTER) ? FC.AI.FILTER(this, this.cmdQuery || '', 8) : []; }
      catch (e) { this._cmdResults = []; }
      if (this.cmdIndex >= this._cmdResults.length) this.cmdIndex = 0;
      const box = byId('cmdList');
      if (!box || !FCUI) return;
      box.innerHTML = FCUI.cmdRowsHtml(this);
    },
    cmdMove: function (delta) {
      const n = this._cmdResults.length;
      if (!n) return;
      this.cmdIndex = (this.cmdIndex + delta + n) % n;
      const rows = document.querySelectorAll('.cmd-row');
      for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('on', i === this.cmdIndex);
      const on = rows[this.cmdIndex];
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    },
    cmdPick: function (i) {
      const c = this._cmdResults[i];
      if (c) this.runCommand(c);
      else this.cmdClose();
    },
    runCommandByKey: function (key) {
      let cmd = null;
      try {
        const list = (FC.AI && FC.AI.COMMANDS) ? FC.AI.COMMANDS(this) : [];
        for (let i = 0; i < list.length; i++) if (list[i].key === key) { cmd = list[i]; break; }
      } catch (e) {}
      if (cmd) this.runCommand(cmd);
    },
    runCommand: function (cmd) {
      if (!cmd) return;
      this.cmdOpen = false;
      this.aiOpen = false;
      switch (cmd.act) {
        case 'tab':
          this.tab = cmd.tab; this.seriesId = ''; this.cardManageDeckId = '';
          this.accountOpen = false; this.activeClassId = '';
          break;
        case 'study-all': this.toast('正在进入学习…', 'ai'); this.startStudy(''); return;
        case 'study-deck': this.startStudy(cmd.id); return;
        case 'import': byId('srcdFile').click(); return;
        case 'export': this.doExport(); return;
        case 'shortcuts': this.openModal({ type: 'shortcuts' }); break;
        case 'browser': this.openBrowser('', ''); return;
        case 'browser-q': this.openBrowser('', cmd.q); return;
        case 'ai-prompt': this.aiOpenWith(cmd.text); return;
        default: break;
      }
      this.render();
    },

    // ---- 卡片学习 ----
    startStudy: function (deckId, mode) {
      const key = deckId || '';
      const cur = this.study;
      // 同一个学习范围：会话未完成时直接续上（挂起则激活，进行中则保持当前卡）
      if (cur && (cur.deckId || '') === key && !cur.done) {
        if (!this.studyActive) this.resumeStudy();
        return;
      }
      // 切换到另一个学习范围：先把旧会话挂起留档，避免下一次误续到别的词库
      if (cur && !cur.done) {
        this.studyActive = false;
        this.studyRevealed = false;
      }
      this.saveStudySession();

      // 该范围若已有未完成会话，恢复到它上次学到的位置；卡片级 FSRS 记录保存在卡片上，互不干扰
      const saved = (this.studySessions || {})[key];
      if (saved && saved.study && !saved.study.done &&
          Array.isArray(saved.study.queue) && Array.isArray(saved.study.dueQueue)) {
        this.study = saved.study;
        this.studyActive = true;
        this.studyRevealed = false;
        this._cardShownAt = saved.cardShownAt || Date.now();
        this.saveStudySession();
        this.resumeStudyRuntime();
        return;
      }

      this.ensureDaily();
      const now = Date.now();
      const deck = deckId ? this.findDeck(deckId) : null;
      const entries = FC.buildStudyQueue
        ? FC.buildStudyQueue(this.state, { deckId: key, mode: mode || 'all', now: now })
        : null;

      let queue;
      if (entries) {
        queue = entries.map(function (e) { return e.card.id; });
      } else {
        const sched = new FC.Scheduler(this.state.settings);
        const newRemaining = Math.max(0, this.state.settings.newCardsPerDay - this.state.newToday);
        const reviewRemaining = Math.max(0, this.state.settings.reviewCardsPerDay - this.state.reviewToday);
        queue = sched.buildQueue(this.state.decks, now, key, newRemaining, reviewRemaining);
      }

      if (queue.length === 0) { this.toast('没有到期的卡片'); return; }
      this._beginStudy(key, deck ? deck.name : '', queue, mode || 'all');
    },
    // 统一初始化学习会话状态
    _beginStudy: function (deckId, deckName, queue, mode) {
      this.study = {
        deckId: deckId, deckName: deckName,
        queue: queue, pos: 0, reviewed: 0, total: queue.length,
        newCount: 0, reviewCount: 0,
        preview: ['', '', '', ''], mode: mode,
        dueQueue: [], requeued: 0, done: false, activeId: null, fromDue: false,
        learned: {}, studied: {},
        sessionStartedAt: Date.now(), gradeCounts: { 1: 0, 2: 0, 3: 0, 4: 0 }
      };
      this.studyActive = true;
      this._cardShownAt = Date.now();
      this.studyRevealed = false;
      this._clearStudyTimer();
      this.advanceToNext();
      this.saveStudySession();
      this.render();
    },
    // 把一张卡的「学习痕迹」彻底抹掉——回到新卡，清空调度 / 复习历史 / 遗忘与暂停搁置。
    // 单卡重置、牌组重置、浏览器批量重置都走这里，保证「当从没学过」语义一致。
    _applyReset: function (c) {
      c.state = FC.STATE_NEW;
      c.scheduling = FC.defaultScheduling();
      c.reviewLog = [];
      c.leeched = false;
      c.suspended = false;
      c.buried = false;
      c.buriedAt = '';
      c.modifiedAt = FC.nowIso();
    },

    // 把一张卡彻底重置成「从没学过」，并联动当前学习会话：从「已学会」集合与待到期队列里
    // 移除，避免进度条仍算它已掌握、或它仍按旧的到期时间插回；若重置的是当前正在展示的卡，
    // 则翻回正面从头再学一遍。
    resetCard: function (cardId) {
      const r = this.findCard(cardId);
      if (!r) return false;
      this.pushUndo('重置卡片');
      this._applyReset(r.card);
      r.deck.modifiedAt = FC.nowIso();
      const st = this.study;
      if (st) {
        if (st.learned) delete st.learned[cardId];
        if (st.dueQueue && st.dueQueue.length) {
          st.dueQueue = st.dueQueue.filter(function (x) { return x.id !== cardId; });
        }
        if (st.activeId === cardId) {
          st.fromDue = false;
          this.studyRevealed = false;
          this._cardShownAt = Date.now();
        }
        st.done = false;
      }
      this.save();
      this.render();
      this.toast('已重置：这张卡将从头重新学（可撤销）');
      return true;
    },

    stopStudy: function () {
      // 退出学习界面不再销毁会话：标记为挂起并持久化，首页提供「继续学习」入口。
      // 只有会话已完成（done）时点「返回」才真正清除，开始新的学习。
      this._clearStudyTimer();
      if (this.study && !this.study.done) {
        this.studyActive = false;
        this.studyRevealed = false;
        this.saveStudySession();
      } else {
        // 会话已完成：清掉该范围的留档，下次进入该词库从新会话开始
        if (this.study && this.studySessions) delete this.studySessions[this.study.deckId || ''];
        this.study = null; this.studyActive = true; this.studyRevealed = false;
        this.saveStudySession();
      }
      this.render();
    },
    replaceCard: function (cardId, updated) {
      const r = this.findCard(cardId);
      if (!r) return;
      const idx = r.deck.cards.indexOf(r.card);
      const copy = r.deck.cards.slice();
      copy[idx] = updated;
      r.deck.cards = copy;
      r.deck.modifiedAt = FC.nowIso();
    },
    rateStudy: function (rating) {
      if (this._autoRevealTimer) { clearTimeout(this._autoRevealTimer); this._autoRevealTimer = null; }
      stopStudyAudio(); // 切到下一张卡前停止可能的残留朗读
      const card = this.currentStudyCard();
      if (!card) { this.stopStudy(); return; }
      const found = this.findCard(card.id);
      const deck = found ? found.deck : null;
      const settings = deck ? FC.settingsFor(deck, this.state.settings) : this.state.settings;
      const wasNew = card.state === FC.STATE_NEW;
      const now = Date.now();
      const spent = this._cardShownAt ? Math.max(0, now - this._cardShownAt) : 0;

      this.pushUndo('评分');
      const updated = new FC.Scheduler(settings).grade(card, rating, now);
      updated.modifiedAt = FC.nowIso();
      this.replaceCard(card.id, updated);

      // 同笔记的正反向卡片当天搁置
      if (deck && settings.buryRelated !== false) {
        const today = FC.dateKey(now);
        const sibs = FC.siblingCards(deck, updated);
        for (let i = 0; i < sibs.length; i++) {
          if (sibs[i].state === FC.STATE_NEW) continue;
          sibs[i].buried = true;
          sibs[i].buriedAt = today;
        }
      }

      // 统计
      const today = FC.dateKey(now);
      let stat = null;
      for (let i = 0; i < this.state.stats.length; i++) if (this.state.stats[i].date === today) stat = this.state.stats[i];
      if (!stat) {
        stat = { date: today, reviews: 0, passed: 0, timeMs: 0, newCount: 0, reviewCount: 0 };
        this.state.stats.push(stat);
      }
      stat.reviews += 1;
      stat.timeMs = (stat.timeMs || 0) + spent;
      if (rating >= 2) stat.passed += 1;
      if (wasNew) {
        stat.newCount = (stat.newCount || 0) + 1;
        this.state.newToday += 1;
      } else {
        stat.reviewCount = (stat.reviewCount || 0) + 1;
        this.state.reviewToday += 1;
      }
      this.study.reviewed += 1;
      // 「学过」去重集合：凡是本次刷过的卡都计入进度条（不管是否掌握），按 card.id 去重
      if (!this.study.studied) this.study.studied = {};
      this.study.studied[card.id] = true;
      if (!this.study.gradeCounts) this.study.gradeCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      this.study.gradeCounts[rating] = (this.study.gradeCounts[rating] || 0) + 1;
      if (wasNew) this.study.newCount += 1; else this.study.reviewCount += 1;

      // 「已学会」判定（学习页进度条口径）：一张卡只有在流程走完、最终以
      // 「良好(3)」或「简单(4)」通过并进入/保持复习态(STATE_REVIEW)时，才算学会 1 个单词。
      // 按卡片 id 去重——同一张卡点多少次「重来 / 困难」都只在其最终通过时计 1 次，
      // 绝不按刷卡次数累加；中途点「重来 / 困难」或还没走完学习步骤的卡一律不计入。
      if ((rating === 3 || rating === 4) && updated.state === FC.STATE_REVIEW) {
        if (!this.study.learned) this.study.learned = {};
        this.study.learned[card.id] = true;
      }

      // —— Anki 式会话调度 ——
      // 评分后仍处于「学习中 / 重学中」的卡：按 grade 算出的到期时间放进待到期队列，
      // 到点了就插回当前会话重新出现（默认「重来」= 1 分钟后）。不再「学完一轮统一重来」。
      // 进入复习状态（简单 / 走完步骤）的卡本会话放行。
      const st = this.study;
      const needRequeue = (updated.state === FC.STATE_LEARNING || updated.state === FC.STATE_RELEARNING);
      if (needRequeue) {
        const due = this._dueOf(updated, now);
        // 同一张卡若已在队列中（重学被打回），先移除旧的再按新到期时间入队
        st.dueQueue = (st.dueQueue || []).filter(function (x) { return x.id !== card.id; });
        st.dueQueue.push({ id: card.id, due: due });
        st.requeued = (st.requeued || 0) + 1;
      } else {
        // 毕业了：确保它不再留在待到期队列
        if (st.dueQueue && st.dueQueue.length) {
          st.dueQueue = st.dueQueue.filter(function (x) { return x.id !== card.id; });
        }
      }
      st.done = false;
      this.advanceToNext();
      this.save();
      this.render();
    },

    // 读取卡片调度到期时间（毫秒）；异常回退为 1 分钟后
    _dueOf: function (card, nowMs) {
      const t = card && card.scheduling ? Date.parse(card.scheduling.due) : NaN;
      return isFinite(t) ? t : nowMs + 60000;
    },

    // ---- 自定义学习 ----
    startCustomStudy: function () {
      const deckId = byId('csDeck') ? byId('csDeck').value : '';
      const mode = byId('csMode') ? byId('csMode').value : 'cram';
      const tag = byId('csTag') ? byId('csTag').value.trim() : '';
      const limit = byId('csLimit') ? parseInt(byId('csLimit').value, 10) : 50;
      let query = tag ? 'tag:' + tag : '';
      const entries = FC.buildStudyQueue(this.state, {
        deckId: deckId, mode: mode, query: query,
        limit: isFinite(limit) && limit > 0 ? limit : 0, now: Date.now()
      });
      if (entries.length === 0) { this.toast('没有符合条件的卡片'); return; }
      const deck = deckId ? this.findDeck(deckId) : null;
      this.modal = null;
      this._beginStudy(deckId, deck ? deck.name : '自定义学习',
        entries.map(function (e) { return e.card.id; }), mode);
      this.toast('已开始自定义学习 · ' + entries.length + ' 张');
    },

    // ---- 浏览器 ----
    openBrowser: function (deckId, query) {
      this.browser = {
        query: query || '', deckId: deckId || '',
        sortKey: 'due', sortDir: 'desc',
        selected: {}, previewId: '', limit: 300
      };
      this.modal = null;
      this.render();
    },
    closeBrowser: function () {
      this.browser = null;
      this.render();
    },
    browserRows: function () {
      if (!this.browser) return [];
      let rows = FC.Search.run(this.state.decks, this.browser.query || '', Date.now());
      if (this.browser.deckId) {
        rows = rows.filter(function (r) { return r.deck.id === this.browser.deckId; }.bind(this));
      }
      return rows;
    },
    refreshBrowser: function () {
      if (!this.browser) return;
      const table = byId('brTable');
      if (table) table.innerHTML = FCUI.browserTable(this);
      const preview = byId('brPreview');
      if (preview) preview.innerHTML = FCUI.browserPreview(this);
      const sub = qs('.browser-top .topbar p');
      if (sub) {
        const rows = this.browserRows();
        const sel = FCUI.selectedIds(this).length;
        sub.textContent = rows.length + ' 张卡片' + (sel ? ' · 已选 ' + sel : '');
      }
    },
    toggleSelect: function (id) {
      if (!this.browser) return;
      this.browser.selected[id] = !this.browser.selected[id];
      this.refreshBrowser();
    },
    selectAll: function (flag) {
      if (!this.browser) return;
      const rows = this.browserRows();
      this.browser.selected = {};
      if (flag) {
        for (let i = 0; i < rows.length; i++) this.browser.selected[rows[i].card.id] = true;
      }
      this.refreshBrowser();
    },
    batchCards: function (action, value) {
      if (!this.browser) return 0;
      const ids = FCUI.selectedIds(this);
      if (ids.length === 0) { this.toast('先选择卡片'); return 0; }
      this.pushUndo('批量' + action);
      const map = {};
      for (let i = 0; i < ids.length; i++) map[ids[i]] = true;
      let n = 0;
      const targetDeck = value && value.deckId ? this.findDeck(value.deckId) : null;

      for (let i = 0; i < this.state.decks.length; i++) {
        const deck = this.state.decks[i];
        const keep = [];
        let changed = false;
        for (let j = 0; j < deck.cards.length; j++) {
          const c = deck.cards[j];
          if (!map[c.id]) { keep.push(c); continue; }
          changed = true;
          n += 1;
          if (action === 'pause') { c.suspended = true; keep.push(c); }
          else if (action === 'unsuspend') { c.suspended = false; c.buried = false; keep.push(c); }
          else if (action === 'flag') { c.flags = value.flag || 0; keep.push(c); }
          else if (action === 'tag') {
            const tags = String(value.tags || '').split(/[,;\s]+/).filter(function (t) { return t !== ''; });
            for (let k = 0; k < tags.length; k++) if (c.tags.indexOf(tags[k]) < 0) c.tags.push(tags[k]);
            keep.push(c);
          } else if (action === 'reset') {
            c.state = FC.STATE_NEW;
            c.scheduling = FC.defaultScheduling();
            c.leeched = false;
            keep.push(c);
          } else if (action === 'move') {
            if (targetDeck && targetDeck.id !== deck.id) {
              c.modifiedAt = FC.nowIso();
              targetDeck.cards.push(c);
            } else {
              keep.push(c);
            }
          } else if (action === 'delete') {
            // 不 retain
          } else {
            keep.push(c);
          }
        }
        if (changed) {
          deck.cards = keep;
          deck.modifiedAt = FC.nowIso();
        }
      }
      if (this.browser) this.browser.selected = {};
      this.save();
      this.render();
      return n;
    },

    // ---- 词书学习 ----
    startWordBook: function (bookId, mode) {
      const book = this.bookById(bookId);
      if (!book) return;
      let queue;
      if (mode === 1) {
        const prog = this.getProgStatuses(bookId, book.words.length);
        queue = [];
        for (let i = 0; i < book.words.length; i++) if (prog[i] === 1) queue.push(i);
        if (queue.length === 0) { this.toast('没有「模糊」的词需要复习'); return; }
      } else {
        queue = [];
        for (let i = 0; i < book.words.length; i++) queue.push(i);
      }
      this.wb = {
        bookId: bookId, bookName: book.name, mode: mode, words: book.words,
        queue: queue, pos: 0, revealed: false, known: 0, fuzzy: 0, unknown: 0
      };
      this.render();
    },
    getProgStatuses: function (bookId, size) {
      for (let i = 0; i < this.state.wordProgress.length; i++) {
        if (this.state.wordProgress[i].bookId === bookId) {
          const s = this.state.wordProgress[i].statuses;
          while (s.length < size) s.push(0);
          return s;
        }
      }
      const fresh = [];
      for (let i = 0; i < size; i++) fresh.push(0);
      return fresh;
    },
    rateWord: function (status) {
      if (!this.wb || this.wb.pos >= this.wb.queue.length) return;
      const idx = this.wb.queue[this.wb.pos];
      const statuses = this.getProgStatuses(this.wb.bookId, this.wb.words.length);
      statuses[idx] = status;
      this.saveWordProgress(this.wb.bookId, statuses);
      if (status === 2) this.wb.known += 1;
      else if (status === 1) this.wb.fuzzy += 1;
      else this.wb.unknown += 1;

      if (this.wb.mode === 0 && status === 0) {
        // 不认识：回队尾再练
        this.wb.queue.push(idx);
      }
      this.wb.pos += 1;
      this.wb.revealed = false;
      this.save();
      this.render();
    },
    stopWordBook: function () { this.wb = null; this.render(); },

    // ---- PK ----
    startBattle: function () {
      const pool = this.battleBooks();
      const book = pool.filter(function (x) { return x.id === this.battleBookId; }, this)[0] || pool[0];
      if (!book) { this.toast('还没有可用的词库，先导入或新建牌组'); return; }
      this.battleBookId = book.id;
      const players = this.battlePlayersText.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
      if (players.length < 2) { this.toast('至少需要 2 名玩家'); return; }
      if (players.length > 4) players.length = 4;
      let hand = parseInt(this.battleHandText, 10);
      if (isNaN(hand) || hand < 1) hand = 10;
      const maxHand = Math.max(1, Math.floor(book.words.length / players.length));
      hand = Math.min(hand, maxHand);
      hand = Math.max(1, hand);

      const hands = [];
      for (let p = 0; p < players.length; p++) {
        hands.push(shuffleIndices(book.words.length).slice(0, hand));
      }
      this.battle = FC.emptyBattle();
      this.battle.bookId = book.id;
      this.battle.bookName = book.name;
      this.battle.words = book.words;
      this.battle.players = players.slice();
      this.battle.hands = hands;
      this.battle.scores = players.map(function () { return 0; });
      this.battle.maxTurns = 10;
      this.battle.turn = 1;
      this.battle.current = 0;
      this.battle.phase = 1;
      this.render();
    },
    battlePass: function () {
      const b = this.battle;
      if (b.phase !== 1) return;
      // 选一个手牌非空的他人作为卡主
      const others = [];
      for (let i = 0; i < b.players.length; i++) if (i !== b.current && b.hands[i].length > 0) others.push(i);
      if (others.length === 0) { this.endBattle(); return; }
      const owner = others[Math.floor(Math.random() * others.length)];
      const cardIdx = b.hands[owner].pop();
      b.owner = owner; b.cardIdx = cardIdx; b.picked = -1; b.phase = 2;
      // 四选一
      const correct = b.words[cardIdx].meaning;
      const pool = [];
      for (let i = 0; i < b.words.length; i++) if (b.words[i].meaning !== correct) pool.push(b.words[i].meaning);
      shuffle(pool);
      const options = [correct].concat(pool.slice(0, 3));
      shuffle(options);
      b.options = options;
      b.correct = options.indexOf(correct);
      this.render();
    },
    battleChoose: function (i) {
      const b = this.battle;
      if (b.phase !== 2 || b.picked !== -1) return;
      b.picked = i;
      b.phase = 3;
      if (i === b.correct) { b.scores[b.current] += 10; b.lastGain = b.players[b.current] + ' 答对 +10'; }
      else { b.scores[b.owner] += 5; b.lastGain = '答错了 · 出牌人 ' + b.players[b.owner] + ' +5'; }
      this.render();
    },
    battleNext: function () {
      const b = this.battle;
      if (b.turn >= b.maxTurns) { this.endBattle(); return; }
      b.turn += 1;
      b.current = (b.current + 1) % b.players.length;
      b.phase = 1;
      this.render();
    },
    endBattle: function () {
      const b = this.battle;
      let max = -1, winner = '';
      for (let i = 0; i < b.scores.length; i++) if (b.scores[i] > max) { max = b.scores[i]; winner = b.players[i]; }
      this.state.battleRecords.push({
        id: FC.makeId(), bookName: b.bookName, players: b.players.slice(),
        scores: b.scores.slice(), winner: winner, playedAt: FC.nowIso()
      });
      this.save();
      b.phase = 4;
      b.lastGain = winner + ' 赢了 · ' + max + ' 分';
      this.render();
    },
    exitBattle: function () { this.battle = null; this.render(); },

    // ---- 账户菜单（点头像弹出，参照 WorkBuddy 账户面板）----
    toggleAccountMenu: function () {
      this.accountMenuOpen = !this.accountMenuOpen;
      if (this.accountMenuOpen) {
        // 与其他浮层互斥
        this.aiOpen = false; this.cmdOpen = false;
        this.noticePageOpen = false; this.backupPageOpen = false;
        this.modal = null;
      }
      this.render();
    },
    closeAccountMenu: function () {
      if (!this.accountMenuOpen) return;
      this.accountMenuOpen = false;
      this.render();
    },
    gotoSettings: function () {
      this.accountMenuOpen = false;
      this.accountOpen = false;
      this.aiOpen = false; this.cmdOpen = false;
      this.noticePageOpen = false; this.backupPageOpen = false;
      this.modal = null;
      this.seriesId = ''; this.cardManageDeckId = ''; this.activeClassId = '';
      this.study = null; this.wb = null; this.battle = null;
      this.tab = 6;
      this.render();
    },

    // ---- 账户 / 个人中心：云端验证码登录 + 本机学习数据 ----
    openAccount: function () {
      // 账户页与通知 / 备份 / 小星 / 命令面板互斥：否则从这些页面点「我的」看不到反应
      this.accountMenuOpen = false;
      this.aiOpen = false;
      this.cmdOpen = false;
      this.noticePageOpen = false;
      this.backupPageOpen = false;
      this.modal = null;
      this.accountOpen = true;
      // seriesId / cardManageDeckId 的渲染优先级高于 accountOpen，
      // 不清掉的话，在「系列详情」「牌组管理」里点「我的」会毫无反应。
      this.seriesId = ''; this.cardManageDeckId = ''; this.activeClassId = '';
      this.study = null; this.wb = null; this.battle = null;
      this.setLoginMsg('');
      this.render();
    },
    // 关闭「显示昵称」后，界面统一显示为「学习者」
    accountDisplayName: function () {
      const a = this.account;
      if (!a.loggedIn) return '未登录';
      if (a.privacy && a.privacy.showNickname === false) return '学习者';
      return a.nickname || '学习者';
    },
    // —— 通知页 / 备份中心页（完整页面，非弹窗）——
    openNoticePage: function () {
      this.noticePageOpen = true; this.backupPageOpen = false; this.accountOpen = false;
      this.aiOpen = false; this.cmdOpen = false;
      this.modal = null; this.render();
    },
    closeNoticePage: function () { this.noticePageOpen = false; this.render(); },
    openBackupPage: function () {
      this.backupPageOpen = true; this.noticePageOpen = false; this.accountOpen = false;
      this.aiOpen = false; this.cmdOpen = false;
      this.modal = null; this.render();
    },
    closeBackupPage: function () { this.backupPageOpen = false; this.render(); },
    logoutAccount: function () {
      const self = this;
      this.account.loggedIn = false;
      this.saveAccount();
      this.accountOpen = false;
      this.toast('已退出登录，本机学习数据仍保留');
      this.render();
      // 同步退出云端会话（失败不影响本机退出）
      if (window.FC && FC.Auth && FC.Auth.available()) {
        try { FC.Auth.signOut().then(function () {}); } catch (e) {}
      }
    },
    // 验证码登录成功：把云端用户身份写入本机账户（学习数据仍在本机）
    finishCloudLogin: function (user, provider, target) {
      const a = this.account;
      const u = user || {};
      a.loggedIn = true;
      a.provider = provider;
      a.cloudUid = String(u.id || u.uid || u.sub || '');
      a.cloudEmail = provider === 'email' ? target : (u.email || '');
      a.cloudPhone = provider === 'phone' ? target : (u.phone || '');
      a.email = a.cloudEmail;
      a.phone = a.cloudPhone;
      a.uid = a.cloudUid || ('bc_' + FC.makeId().replace(/-/g, '').slice(0, 10));
      if (!a.nickname) {
        a.nickname = provider === 'email'
          ? String(target || '').split('@')[0]
          : (target ? target.slice(0, 3) + '****' + target.slice(-4) : '学习者');
      }
      if (!a.joinedAt) a.joinedAt = FC.nowIso();
      if (!a.regYear) a.regYear = new Date().getFullYear();
      if (provider === 'phone' && !a.phoneTail) {
        a.phoneTail = String(target || '').replace(/\D/g, '').slice(-4);
      }
      this._otpChallenge = null;
      this._otpCountdown = 0;
      this._loginDraft = null;
      this.saveAccount();
      this.toast('登录成功，欢迎 ' + (a.privacy && a.privacy.showNickname === false ? '回来' : a.nickname));
    },
    // 启动校验云端会话：仅当在线 + 之前用验证码登录过时请求，离线打开不触发任何网络
    restoreCloudSession: function () {
      const a = this.account;
      if (!a.loggedIn || !a.provider) return;
      if (!FC.Auth || !FC.Auth.available()) return; // file:// 离线：保留本机登录状态，不联网
      const self = this;
      try {
        FC.Auth.getSession().then(function (r) {
          if (!r) return;
          // 明确无会话（无 error 且 data 为空）才退出；网络错误时保持现状
          if (!r.error && !r.data) {
            self.account.loggedIn = false;
            self.saveAccount();
            self.render();
          }
        });
      } catch (e) { /* 离线或 SDK 未就绪：忽略 */ }
    },
    // 供旧的账户弹窗兼容调用（新 UI 用验证码流程，此处仅保留安全兜底）
    finishLogin: function (nickname, email) {
      const a = this.account;
      a.loggedIn = true;
      a.nickname = nickname;
      if (email) { a.email = email; a.cloudEmail = email; a.provider = a.provider || 'email'; }
      if (!a.uid) a.uid = 'bc_' + FC.makeId().replace(/-/g, '').slice(0, 10);
      if (!a.joinedAt) a.joinedAt = FC.nowIso();
      if (!a.regYear) a.regYear = new Date().getFullYear();
      this._loginDraft = null;
      this.saveAccount();
      this.toast('已登录，欢迎 ' + nickname);
    },
    // 暂存登录表单输入，避免任何重绘后丢失内容
    saveLoginDraft: function () {
      const g = function (id) { const e = byId(id); return e ? e.value : undefined; };
      const has = byId('loginEmail') || byId('loginPhone') || byId('loginCode') || byId('loginPassword') || byId('loginAgree') || byId('loginNick');
      if (!has) return;
      this._loginDraft = {
        nickname: g('loginNick') || '', email: g('loginEmail') || '', phone: g('loginPhone') || '',
        code: g('loginCode') || '', password: g('loginPassword') || '',
        agree: byId('loginAgree') ? !!byId('loginAgree').checked : false,
        mode: this.loginMode || 'email'
      };
    },
    // 只更新登录区的行内提示，不整页重绘（保住输入焦点与内容）
    setLoginMsg: function (msg, kind) {
      this._loginMsg = { text: msg || '', kind: kind || 'err' };
      const el = byId('loginMsg');
      if (el) {
        el.textContent = msg || '';
        el.className = 'login-msg' + (msg ? ' login-msg-' + (kind || 'err') : '');
      }
    },
    // 切换 邮箱 / 手机号 通道
    setLoginMode: function (mode) {
      this.saveLoginDraft();
      this.loginMode = mode === 'phone' ? 'phone' : 'email';
      this._otpChallenge = null;
      this._otpCountdown = 0;
      if (this._otpTimer) { clearInterval(this._otpTimer); this._otpTimer = null; }
      this.setLoginMsg('');
      this.render();
    },
    _updateOtpButton: function () {
      const b = byId('btnSendCode');
      if (!b) return;
      if (this._otpBusy) { b.disabled = true; b.textContent = '发送中…'; }
      else if (this._otpCountdown > 0) { b.disabled = true; b.textContent = this._otpCountdown + ' 秒后重发'; }
      else { b.disabled = false; b.textContent = '获取验证码'; }
    },
    _startOtpCountdown: function () {
      const self = this;
      if (this._otpTimer) clearInterval(this._otpTimer);
      this._otpTimer = setInterval(function () {
        self._otpCountdown--;
        if (self._otpCountdown <= 0) {
          clearInterval(self._otpTimer); self._otpTimer = null; self._otpCountdown = 0;
        }
        self._updateOtpButton();
      }, 1000);
    },
    // 获取验证码（sendOtp：只发送，不校验）
    sendLoginCode: function () {
      const mode = this.loginMode || 'email';
      const draft = this._loginDraft || {};
      const agree = byId('loginAgree') ? !!byId('loginAgree').checked : draft.agree;
      if (!agree) { this.setLoginMsg('请先阅读并同意隐私说明'); return; }
      if (this._otpBusy || this._otpCountdown > 0) return;
      let target;
      if (mode === 'phone') {
        target = ((byId('loginPhone') ? byId('loginPhone').value : draft.phone) || '').trim();
        if (!/^1\d{10}$/.test(target)) { this.setLoginMsg('请输入正确的 11 位手机号'); return; }
      } else {
        target = ((byId('loginEmail') ? byId('loginEmail').value : draft.email) || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) { this.setLoginMsg('请输入正确的邮箱地址'); return; }
      }
      if (!FC.Auth || !FC.Auth.available()) {
        this.setLoginMsg('验证码登录需要联网并通过在线网址打开；本地离线时仅本机学习可用');
        return;
      }
      this.saveLoginDraft();
      this._otpBusy = true;
      this.setLoginMsg('正在发送验证码…');
      this._updateOtpButton();
      const self = this;
      const p = mode === 'phone' ? FC.Auth.sendPhoneCode(target) : FC.Auth.sendEmailCode(target);
      Promise.resolve(p).then(function (r) {
        self._otpBusy = false;
        if (r && r.error) { self.setLoginMsg(r.error.message); self._updateOtpButton(); return; }
        const d = (r && r.data) || {};
        self._otpChallenge = {
          type: mode, target: target,
          verificationId: d.verificationId,
          isExistingUser: !!d.isExistingUser
        };
        self.setLoginMsg((mode === 'phone' ? '短信' : '邮件') + '验证码已发送到 ' + target, 'ok');
        self._otpCountdown = 60;
        self._startOtpCountdown();
        self._updateOtpButton();
      });
    },
    // 提交验证码（verifyOtp：用已保存的 challenge，不再重新发送）
    submitLogin: function () {
      const ch = this._otpChallenge;
      if (!ch) { this.setLoginMsg('请先获取验证码'); return; }
      const code = ((byId('loginCode') ? byId('loginCode').value : '') || '').trim();
      if (!code) { this.setLoginMsg('请输入验证码'); return; }
      const cur = (ch.type === 'phone'
        ? (byId('loginPhone') ? byId('loginPhone').value : '')
        : (byId('loginEmail') ? byId('loginEmail').value : '')) || '';
      if (cur.trim() !== ch.target) { this.setLoginMsg('账号已修改，请重新获取验证码'); return; }
      const password = (ch.type === 'email' && !ch.isExistingUser)
        ? ((byId('loginPassword') ? byId('loginPassword').value : '') || '') : '';
      if (ch.type === 'email' && !ch.isExistingUser && !password) {
        this.setLoginMsg('新邮箱用户请设置密码（至少 6 位）'); return;
      }
      this.saveLoginDraft();
      this._otpBusy = true;
      this.setLoginMsg('正在登录…');
      const self = this;
      const p = ch.type === 'phone'
        ? FC.Auth.verifyPhone(ch.target, ch.verificationId, ch.isExistingUser, code)
        : FC.Auth.verifyEmail(ch.target, ch.verificationId, ch.isExistingUser, code, password);
      Promise.resolve(p).then(function (r) {
        self._otpBusy = false;
        if (r && r.error) { self.setLoginMsg(r.error.message); return; }
        const d = (r && r.data) || {};
        self.finishCloudLogin(d.user || d.session || {}, ch.type, ch.target);
        self.render();
      });
    },
    // 旧内嵌入口兼容：等同提交验证码
    loginInline: function () { this.submitLogin(); },
    // ---- 头像 ----
    openAvatar: function () {
      this.openModal({ type: 'avatar', color: this.account.avatarColor, data: this.account.avatarData });
    },
    setAvatarColor: function (n) {
      const c = parseInt(n, 10);
      this.account.avatarColor = (c >= 0 && c <= 5) ? c : 0;
      this.account.avatarData = '';
      this.saveAccount();
      // 弹窗保持打开，直接看到预览变化；点「关闭」即可
      this.modal = { type: 'avatar', color: this.account.avatarColor, data: '' };
      this.render();
    },
    clearAvatarImage: function () {
      this.account.avatarData = '';
      this.saveAccount();
      this.modal = null;
      this.render();
      this.toast('已恢复字母头像');
    },
    handleAvatarFile: function (file) {
      if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
        this.toast('请选择 PNG / JPG / WebP / GIF 图片'); return;
      }
      const self = this;
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) { self.toast('图片读取失败，请换一张'); return; }
          // 进入裁剪：拖动 / 缩放后取圆形区域
          self._crop = {
            src: String(reader.result || ''),
            w: w, h: h,
            base: 1, stage: 240,
            scale: 1, x: 0, y: 0
          };
          self.modal = { type: 'avatar-crop' };
          self.render();
        };
        img.onerror = function () { self.toast('图片读取失败，请换一张'); };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    },
    // 裁剪舞台：按实际尺寸算基准缩放，短边铺满圆形裁切框
    mountAvatarCrop: function () {
      const c = this._crop;
      const stage = document.getElementById('avaCropStage');
      if (!c || !stage) return;
      const S = stage.clientWidth || 240;
      c.stage = S;
      c.base = S / Math.min(c.w, c.h);
      c.x = 0; c.y = 0;
      if (!(c.scale >= 1)) c.scale = 1;
      this.syncAvatarCrop();
      const rg = document.getElementById('avaCropZoom');
      if (rg) rg.value = String(Math.round(c.scale * 100));
    },
    clampAvatarCrop: function () {
      const c = this._crop;
      if (!c) return;
      const S = c.stage || 240;
      const W = c.w * c.base * c.scale;
      const H = c.h * c.base * c.scale;
      const mx = Math.max(0, (W - S) / 2);
      const my = Math.max(0, (H - S) / 2);
      c.x = Math.max(-mx, Math.min(mx, c.x));
      c.y = Math.max(-my, Math.min(my, c.y));
    },
    syncAvatarCrop: function () {
      const c = this._crop;
      const img = document.getElementById('avaCropImg');
      if (!c || !img) return;
      this.clampAvatarCrop();
      const W = c.w * c.base;
      const H = c.h * c.base;
      img.style.width = W + 'px';
      img.style.height = H + 'px';
      img.style.marginLeft = (-W / 2) + 'px';
      img.style.marginTop = (-H / 2) + 'px';
      img.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px) scale(' + c.scale.toFixed(3) + ')';
      const pct = document.getElementById('avaCropPct');
      if (pct) pct.textContent = Math.round(c.scale * 100) + '%';
    },
    zoomAvatarCrop: function (dir) {
      const c = this._crop;
      if (!c) return;
      c.scale = Math.max(1, Math.min(3.2, c.scale + (dir > 0 ? 0.12 : -0.12)));
      const rg = document.getElementById('avaCropZoom');
      if (rg) rg.value = String(Math.round(c.scale * 100));
      this.syncAvatarCrop();
    },
    setAvatarCropScale: function (v) {
      const c = this._crop;
      if (!c) return;
      const n = Number(v);
      c.scale = Math.max(1, Math.min(3.2, (isNaN(n) ? 100 : n) / 100));
      this.syncAvatarCrop();
    },
    cancelAvatarCrop: function () {
      this._crop = null;
      this.modal = { type: 'avatar', color: this.account.avatarColor, data: this.account.avatarData };
      this.render();
    },
    commitAvatarCrop: function () {
      const c = this._crop;
      if (!c) return;
      const img = document.getElementById('avaCropImg');
      if (!img) { this.toast('图片未就绪，请重试'); return; }
      try {
        const SIZE = 320; // 输出清晰度：320×320
        const k = c.base * c.scale;
        const side = (c.stage || 240) / k;
        const cx = c.w / 2 - c.x / k;
        const cy = c.h / 2 - c.y / k;
        const cv = document.createElement('canvas');
        cv.width = SIZE; cv.height = SIZE;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, SIZE, SIZE);
        this.account.avatarData = cv.toDataURL('image/jpeg', 0.86);
        this._crop = null;
        this.saveAccount();
        this.modal = { type: 'avatar', color: this.account.avatarColor, data: this.account.avatarData };
        this.render();
        this.toast('头像已更新');
      } catch (err) {
        this.toast('图片处理失败，请换一张');
      }
    },
    // ---- 隐私设置 ----
    togglePrivacy: function (key) {
      const p = this.account.privacy;
      if (!p || !(key in p)) return;
      p[key] = !p[key];
      this.saveAccount();
      if (key === 'privacyBlur' && !p[key]) setPrivacyCover(false);
      this.render();
      const labels = { rememberLogin: '记住登录状态', showNickname: '显示昵称', privacyBlur: '离开窗口时隐藏内容' };
      this.toast((labels[key] || '设置') + (p[key] ? '已开启' : '已关闭'));
    },

    // ---- 模态 ----
    openModal: function (m) {
      if (m && ['card-v2', 'deck-options', 'card-info', 'csv-import', 'custom-study', 'privacy', 'apkg-preview', 'shortcuts', 'theme'].indexOf(m.type) >= 0) m.wide = true;
      this.modal = m;
      this.render();
    },
    closeModal: function () { this.modal = null; this.render(); },
    modalOk: function () {
      const m = this.modal;
      if (!m) return;
      const id = function (x) { return document.getElementById(x); };
      if (m.type === 'deck') {
        const name = id('mName').value.trim();
        if (!name) { this.toast('请填写名称'); return; }
        const desc = id('mDesc').value.trim();
        if (m.id) {
          for (let i = 0; i < this.state.decks.length; i++) if (this.state.decks[i].id === m.id) {
            this.state.decks[i].name = name; this.state.decks[i].description = desc; this.state.decks[i].modifiedAt = FC.nowIso();
          }
          this.toast('牌组已更新');
        } else {
          let fullName = name;
          if (m.parentId) {
            const parent = this.findDeck(m.parentId);
            if (parent) fullName = parent.name + '::' + name;
          }
          this.pushUndo('新建牌组');
          this.state.decks.push(FC.newDeck(fullName, desc));
          this.toast('牌组已创建');
        }
      } else if (m.type === 'card-v2') {
        const type = id('eType') ? id('eType').value : 'basic';
        const fields = {
          Front: id('eFront') ? id('eFront').value.trim() : '',
          Back: id('eBack') ? id('eBack').value.trim() : '',
          Extra: id('eExtra') ? id('eExtra').value.trim() : '',
          Source: id('eSource') ? id('eSource').value.trim() : ''
        };
        const tags = (id('eTags') ? id('eTags').value : '').split(/[,;\s]+/).filter(function (t) { return t !== ''; });
        const media = (m.media || []).slice();

        if (type === 'cloze') {
          if (!FC.hasCloze(fields.Front)) { this.toast('填空文本里需要 {{c1::答案}}'); return; }
          fields.Back = '';
        } else if (!fields.Front || !fields.Back) {
          this.toast('正面和背面都要填');
          return;
        }

        if (m.id) {
          const r = this.findCard(m.id);
          if (!r) { this.toast('卡片不存在'); return; }
          this.pushUndo('编辑卡片');
          const noteId = r.card.noteId || r.card.id;
          const merged = [];
          const seen = {};
          for (let i = 0; i < r.card.media.length; i++) { merged.push(r.card.media[i]); seen[r.card.media[i].name] = true; }
          for (let i = 0; i < media.length; i++) if (!seen[media[i].name]) { merged.push(media[i]); seen[media[i].name] = true; }
          const cards = FC.rebuildNote(r.deck, noteId, { notetype: type, fields: fields, tags: tags });
          for (let i = 0; i < cards.length; i++) cards[i].media = merged;
          this.toast('已更新，共 ' + cards.length + ' 张卡片');
        } else {
          const deck = this.findDeck(m.deckId);
          if (!deck) { this.toast('牌组不存在'); return; }
          this.pushUndo('添加卡片');
          const cards = FC.buildCards({ notetype: type, fields: fields, tags: tags });
          if (cards.length === 0) { this.toast('没有可生成的卡片'); return; }
          for (let i = 0; i < cards.length; i++) cards[i].media = media;
          deck.cards = deck.cards.concat(cards);
          deck.modifiedAt = FC.nowIso();
          this.toast('已添加 ' + cards.length + ' 张卡片');
        }
      } else if (m.type === 'deck-options') {
        const deck = this.findDeck(m.deckId);
        if (!deck) { this.toast('牌组不存在'); return; }
        const numOrNull = function (idv) {
          const el = id(idv);
          if (!el || el.value.trim() === '') return null;
          const v = parseFloat(el.value);
          return isFinite(v) ? v : null;
        };
        const stepsOrNull = function (idv) {
          const el = id(idv);
          if (!el || el.value.trim() === '') return null;
          const arr = el.value.split(',').map(function (x) { return parseInt(x.trim(), 10); })
            .filter(function (x) { return !isNaN(x) && x > 0; });
          return arr.length ? arr : null;
        };
        this.pushUndo('修改牌组选项');
        deck.options = {
          newPerDay: numOrNull('oNew'),
          reviewsPerDay: numOrNull('oReview'),
          learningSteps: stepsOrNull('oLearn'),
          relearningSteps: stepsOrNull('oRelearn'),
          graduatingInterval: numOrNull('oGrad'),
          easyInterval: numOrNull('oEasy'),
          leechThreshold: numOrNull('oLeech'),
          leechAction: id('oLeechAction') ? id('oLeechAction').value : '',
          buryRelated: id('oBury') && id('oBury').value !== '' ? id('oBury').value === '1' : null,
          maxInterval: numOrNull('oMaxIvl'),
          requestRetention: numOrNull('oRetention'),
          newOrder: id('oNewOrder') ? id('oNewOrder').value : '',
          reviewOrder: id('oReviewOrder') ? id('oReviewOrder').value : ''
        };
        deck.modifiedAt = FC.nowIso();
        this.toast('牌组选项已保存');
      } else if (m.type === 'tag') {
        const tags = (id('mTags') ? id('mTags').value : '').split(/[,;\s]+/).filter(function (t) { return t !== ''; });
        if (tags.length === 0) { this.toast('请输入标签'); return; }
        this.batchCards('tag', { tags: tags.join(' ') });
        this.toast('已添加标签');
      } else if (m.type === 'move') {
        const deckId = id('mMoveDeck') ? id('mMoveDeck').value : '';
        const n = this.batchCards('move', { deckId: deckId });
        this.toast('已移动 ' + n + ' 张卡片');
      } else if (m.type === 'reschedule') {
        const days = id('mDays') ? parseFloat(id('mDays').value) : 1;
        if (!isFinite(days) || days < 0) { this.toast('请输入有效天数'); return; }
        this.pushUndo('重新调度');
        const r = this.findCard(m.cardId);
        if (r) {
          r.card.scheduling.due = new Date(Date.now() + days * FC.DAY_MS).toISOString();
          r.card.scheduling.scheduledDays = days;
          if (r.card.state === FC.STATE_NEW) r.card.state = FC.STATE_REVIEW;
          r.card.modifiedAt = FC.nowIso();
        }
        this.toast('已设为 ' + days + ' 天后');
      } else if (m.type === 'custom-study') {
        this.startCustomStudy();
        return;
      } else if (m.type === 'csv-import') {
        const text = id('csvText') ? id('csvText').value : '';
        if (!text.trim()) { this.toast('请粘贴 CSV 内容或选择文件'); return; }
        const defaultDeck = id('csvDeck') ? id('csvDeck').value.trim() : 'CSV 导入';
        const plan = FC.Csv.toPlan(text, defaultDeck);
        if (plan.items.length === 0) { this.toast('没有可导入的行'); return; }
        this.pushUndo('导入 CSV');
        const groups = {};
        for (let i = 0; i < plan.items.length; i++) {
          const it = plan.items[i];
          if (!groups[it.deck]) groups[it.deck] = [];
          groups[it.deck].push(it);
        }
        let added = 0;
        for (const name in groups) {
          if (!Object.prototype.hasOwnProperty.call(groups, name)) continue;
          let deck = null;
          for (let i = 0; i < this.state.decks.length; i++) if (this.state.decks[i].name === name) deck = this.state.decks[i];
          if (!deck) { deck = FC.newDeck(name, 'CSV 导入'); this.state.decks.push(deck); }
          const items = groups[name];
          for (let i = 0; i < items.length; i++) {
            const cards = FC.buildCards({
              notetype: 'basic',
              fields: { Front: items[i].front, Back: items[i].back, Extra: items[i].extra, Source: '' },
              tags: items[i].tags
            });
            for (let k = 0; k < cards.length; k++) deck.cards.push(cards[k]);
            added += cards.length;
          }
          deck.modifiedAt = FC.nowIso();
        }
        this.toast('已导入 ' + added + ' 张卡片');
      } else if (m.type === 'card') {
        const front = id('mFront').value.trim();
        const back = id('mBack').value.trim();
        if (!front || !back) { this.toast('正反面都要填'); return; }
        const extra = id('mExtra').value.trim();
        let deck = null;
        for (let i = 0; i < this.state.decks.length; i++) if (this.state.decks[i].id === m.deckId) deck = this.state.decks[i];
        if (!deck) { this.toast('牌组不存在'); return; }
        if (m.id) {
          for (let i = 0; i < deck.cards.length; i++) if (deck.cards[i].id === m.id) {
            deck.cards[i].front = front; deck.cards[i].back = back; deck.cards[i].extra = extra;
          }
          this.toast('卡片已更新');
        } else {
          deck.cards.push(FC.newCard(front, back, extra, []));
          this.toast('卡片已添加');
        }
      } else if (m.type === 'batch') {
        const text = id('mBatch').value;
        const cards = FC.SrcdCodec.parseBatchText(text);
        let deck = null;
        for (let i = 0; i < this.state.decks.length; i++) if (this.state.decks[i].id === m.deckId) deck = this.state.decks[i];
        if (!deck) { this.toast('牌组不存在'); return; }
        const arr = deck.cards.slice();
        for (let i = 0; i < cards.length; i++) arr.push(cards[i]);
        deck.cards = arr; deck.modifiedAt = FC.nowIso();
        this.toast('已导入 ' + cards.length + ' 张');
      } else if (m.type === 'class') {
        const name = id('mCName').value.trim();
        if (!name) { this.toast('请填写班级名'); return; }
        this.state.classrooms.push({
          id: FC.makeId(), name: name, description: id('mCDesc').value.trim(),
          code: genCode(), members: [], createdAt: FC.nowIso()
        });
        this.toast('班级已创建');
      } else if (m.type === 'join') {
        const code = id('mCode').value.trim().toUpperCase();
        if (!code) { this.toast('请输入邀请码'); return; }
        let found = null;
        for (let i = 0; i < this.state.classrooms.length; i++) if (this.state.classrooms[i].code === code) found = this.state.classrooms[i];
        if (!found) {
          found = { id: FC.makeId(), name: '班级-' + code, description: '', code: code, members: [], createdAt: FC.nowIso() };
          this.state.classrooms.push(found);
          this.toast('已新建班级 ' + code);
        } else { this.toast('已加入 ' + code); }
        this.activeClassId = found.id;
      } else if (m.type === 'member') {
        const name = id('mMember').value.trim();
        if (!name) { this.toast('请输入名字'); return; }
        const c = this.activeClass();
        if (c) c.members.push({ id: FC.makeId(), name: name, score: 0 });
      } else if (m.type === 'deskmate') {
        const name = id('mDName').value.trim();
        if (!name) { this.toast('请输入名字'); return; }
        this.state.deskmates.push({ id: FC.makeId(), name: name, note: id('mDNote').value.trim(), score: 0, days: 1 });
      } else if (m.type === 'account') {
        const nickname = id('mNick').value.trim();
        if (!nickname) { this.toast('请填写昵称'); return; }
        this.finishLogin(nickname, id('mEmail').value.trim());
      } else if (m.type === 'profile') {
        const nickname = id('mNick').value.trim();
        if (!nickname) { this.toast('请填写昵称'); return; }
        const email = id('mEmail').value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.toast('邮箱格式不正确'); return; }
        this.account.nickname = nickname;
        this.account.email = email;
        this.saveAccount();
        this.toast('个人资料已更新');
      } else if (m.type === 'confirm' && m.action === 'logout') {
        this.account.loggedIn = false;
        this.saveAccount();
        this.accountOpen = false;
        this.toast('已退出登录，本机学习数据仍保留');
      } else if (m.type === 'confirm' && m.action === 'account-clear') {
        this.account = defaultAccount();
        this.saveAccount();
        setPrivacyCover(false);
        this.accountOpen = true;
        this.toast('已清除本机账户数据');
      } else if (m.type === 'confirm' && m.action === 'reset') {
        this.state = FC.defaultState();
        this.cardManageDeckId = ''; this.study = null; this.wb = null; this.battle = null; this.accountOpen = false; this.activeClassId = '';
        this.browser = null; this.undoStack = [];
        this.toast('已清空全部数据');
      } else if (m.type === 'confirm' && m.action === 'deck-delete') {
        this.pushUndo('删除牌组');
        this.state.decks = this.state.decks.filter(function (x) { return x.id !== m.deckId; });
        this.cardManageDeckId = '';
        this.browser = null;
        this.toast('牌组已删除，可撤销');
      } else if (m.type === 'confirm' && m.action === 'series-delete') {
        const n = this.deleteSeries(m.tagKey);
        this.toast(n ? ('已删除整个词库 · ' + n + ' 个牌组，该系列已从词书移除，可撤销') : '未找到该词库的牌组');
      } else if (m.type === 'confirm' && m.action === 'cards-delete') {
        const n = this.batchCards('delete');
        this.toast('已删除 ' + n + ' 张卡片');
      } else if (m.type === 'confirm' && m.action === 'cards-reset') {
        const n = this.batchCards('reset');
        this.toast('已重置 ' + n + ' 张卡片');
      } else if (m.type === 'confirm' && m.action === 'deck-reset') {
        const deck = this.findDeck(m.deckId);
        if (deck) {
          this.pushUndo('重置牌组进度');
          const ids = {};
          for (let i = 0; i < deck.cards.length; i++) {
            this._applyReset(deck.cards[i]);
            ids[deck.cards[i].id] = true;
          }
          deck.modifiedAt = FC.nowIso();
          // 联动当前学习会话：移出「已学会」集合与待到期队列，进度归零，避免旧到期插回
          if (this.study) {
            if (this.study.learned) {
              for (let k = 0; k < deck.cards.length; k++) delete this.study.learned[deck.cards[k].id];
            }
            if (this.study.dueQueue && this.study.dueQueue.length) {
              this.study.dueQueue = this.study.dueQueue.filter(function (x) { return !ids[x.id]; });
            }
            if (this.study.activeId && ids[this.study.activeId]) {
              this.studyRevealed = false;
              this._cardShownAt = Date.now();
            }
            this.study.done = false;
          }
          this.toast('「' + deck.name + '」的 ' + deck.cards.length + ' 张卡已重置为新卡，可撤销');
        }
      }
      this.save();
      this.modal = null;
      this.render();
    },

    // ---- 导入导出 ----
    // 从一个导入文件名推断系列名：去扩展名、去 starcard- 前缀。
    _seriesNameFromFile: function (fileName) {
      let n = String(fileName || '').trim();
      n = n.replace(/\.(srcd|apkg|colpkg|zip|json|csv)$/i, '').trim();
      n = n.replace(/^starcard-/i, '').trim();
      return n || '导入词库';
    },
    // 把一批刚导入的牌组归入（自动新建/复用的）系列，刷新系列元数据。
    _attachImportedSeries: function (deckNames, fileName) {
      if (!FC.registerSeries) return null;
      const name = this._seriesNameFromFile(fileName);
      const se = FC.registerSeries(this.state, name, fileName || '');
      FC.tagSeriesDecks(this.state, se, deckNames);
      FC.updateSeriesMeta(this.state, se);
      return se;
    },
    // 一键载入随发布包提供的新版词库（.srcd 外置文件）。
    // 用于 Anki zstd 包无法在浏览器解析时，绕过 .apkg 直接载入等价词库。
    loadBuiltinDeck: function (deckFile, deckName) {
      const self = this;
      if (!deckFile) return;
      const url = (typeof FC.assetUrl === 'function' ? FC.assetUrl(encodeURIComponent(deckFile)) : encodeURIComponent(deckFile));
      this.toast('正在载入「' + (deckName || deckFile) + '」…');
      try {
        fetch(url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(function (text) {
          self.modal = null;
          self.doImport(text, deckFile);
        }).catch(function () {
          self.toast('载入失败：找不到随包的词库文件，请确认词库 .srcd 与网页在同一目录，或用「导入」手动选择 .srcd。');
        });
      } catch (e) {
        this.toast('当前环境无法自动载入，请用「导入」手动选择 .srcd。');
      }
    },
    doImport: function (text, fileName) {
      let decoded;
      try { decoded = FC.SrcdCodec.decode(text); }
      catch (e) { this.toast('导入失败：' + e.message); return; }
      this.pushUndo('导入牌组文件');
      const res = FC.SrcdCodec.merge(this.state, decoded, false);
      this.state = res.state;
      const names = decoded.decks.map(function (d) { return d.name; });
      const se = this._attachImportedSeries(names, fileName);
      this.save();
      this.render();
      const sm = res.summary;
      this.toast('已导入 ' + sm.decks + ' 个牌组 / ' + sm.cards + ' 张卡片' +
        (sm.updated ? '（更新 ' + sm.updated + ' · 新增 ' + sm.added + '）' : '') +
        (se ? ' · 已归入系列「' + se.name + '」' : ''));
    },
    doExport: function (decks, filename) {
      const list = (decks && decks.length) ? decks : this.state.decks;
      if (!list || list.length === 0) { this.toast('没有可导出的牌组'); return; }
      const text = FC.SrcdCodec.encode(list, this.state.settings, '闪星卡（StarCard）· 小李工作室 / Web 1.5.0');
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'starcard-decks.srcd';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      try { localStorage.setItem('starcard-last-backup', new Date().toISOString()); } catch (e) { /* 忽略 */ }
      this.toast('已导出 .srcd');
    },
    lastBackupAt: function () {
      try {
        const v = localStorage.getItem('starcard-last-backup');
        return v ? Date.parse(v) : 0;
      } catch (e) { return 0; }
    },
    noticeReadAt: function () {
      try {
        const v = parseInt(localStorage.getItem('starcard-notice-read'), 10);
        return isNaN(v) ? 0 : v;
      } catch (e) { return 0; }
    },
    markNoticesRead: function () {
      try { localStorage.setItem('starcard-notice-read', String(Date.now())); } catch (e) { /* 忽略 */ }
      this.modal = null;
      this.render();
      this.toast('已全部标为已读');
    },
    noticesGo: function (tab) {
      this.modal = null;
      this.noticePageOpen = false;
      this.backupPageOpen = false;
      this.tab = isNaN(tab) ? 0 : tab;
      this.accountOpen = false;
      this.seriesId = '';
      this.cardManageDeckId = '';
      this.activeClassId = '';
      this.study = null; this.wb = null; this.battle = null;
      this.render();
    },

    // ---- Anki .apkg / .colpkg 导入 ----
    importApkgFile: function (file) {
      if (!file) return;
      this._pendingImportFileName = file.name;
      if (!/\.(apkg|colpkg|zip)$/i.test(file.name)) {
        this.toast('请选择 Anki 导出的 .apkg 或 .colpkg 文件'); return;
      }
      if (!window.BCApkg) { this.toast('Apkg 解析模块未加载'); return; }
      const self = this;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const result = window.BCApkg.parse(reader.result);
          if (!result || !result.decks || !result.stats.cards) {
            self.toast('没有解析到可导入的卡片'); return;
          }
          self.apkgImport = result;
          self.openModal({ type: 'apkg-preview' });
        } catch (err) {
          if (err && err.code === 'ZSTD_BUILTIN') {
            // Anki 新版 zstd 包：直接弹出「一键载入」对话框，用户点一下即载入随包提供的 .srcd
            self.openModal({ type: 'builtin-offer', deckFile: err.deckFile, deckName: err.deckName });
          } else {
            self.toast('导入失败：' + (err && err.message ? err.message : String(err)));
          }
        }
      };
      reader.onerror = function () { self.toast('文件读取失败'); };
      // FileReader 本身是异步的，解析前先给出反馈，避免大牌组看起来「没反应」
      this.toast('正在解析 Anki 牌组…');
      reader.readAsArrayBuffer(file);
    },
    confirmApkgImport: function () {
      const r = this.apkgImport;
      if (!r) return;
      this.pushUndo('导入 Anki .apkg');
      const fileName = this._pendingImportFileName || 'Anki 词库';
      const names = (r.decks || []).map(function (d) { return d.name; });
      const merged = FC.SrcdCodec.merge(this.state, { decks: r.decks }, false);
      this.state = merged.state;
      const se = this._attachImportedSeries(names, fileName);
      this.apkgImport = null;
      this._pendingImportFileName = '';
      this.modal = null;
      this.save();
      this.render();
      this.toast('已导入 ' + merged.summary.decks + ' 个牌组 / ' + merged.summary.cards + ' 张卡片' +
        (se ? ' · 已归入系列「' + se.name + '」' : ''));
    },

    // ---- 系列（Series）：把成套牌组收进文件夹式容器，统一导入 / 学习 ----
    openSeries: function (id) {
      const series = FC.seriesById ? FC.seriesById(id, this.state) : null;
      if (!series) { this.toast('系列不存在'); return; }
      this.seriesId = id;
      this.cardManageDeckId = '';
      if (!window.BAI_MEDIA && typeof globalThis !== 'undefined' && globalThis.BAI_MEDIA) window.BAI_MEDIA = globalThis.BAI_MEDIA;
      this.render();
    },
    closeSeries: function () {
      this.seriesId = '';
      this.cardManageDeckId = '';
      this.tab = 1;
      this.render();
    },
    importSeries: function (id) {
      const series = FC.seriesById ? FC.seriesById(id, this.state) : null;
      if (!series) { this.toast('系列不存在'); return; }
      this.toast('重新导入将更新「' + series.name + '」（保留进度）：请选择对应的 .srcd 词库文件');
      const el = byId('srcdFile');
      if (el) { el.value = ''; el.click(); }
    },
    // 学习整个系列：合并该系列所有分册的到期/新卡为一个队列，按 Anki 顺序
    studySeries: function (id) {
      const series = FC.seriesById ? FC.seriesById(id, this.state) : null;
      if (!series) { this.toast('系列不存在'); return; }
      if (!FC.seriesIsLoaded || !FC.seriesIsLoaded(this.state, series)) { this.importSeries(id); return; }
      this.ensureDaily();
      const now = Date.now();
      const decks = FC.seriesDecksOf(this.state, series);
      const settings = this.state.settings;
      const capNew = Math.max(0, (settings.newCardsPerDay || 0) - (this.state.newToday || 0));
      const capRev = Math.max(0, (settings.reviewCardsPerDay || 0) - (this.state.reviewToday || 0));
      const sched = new FC.Scheduler(settings);
      const queue = sched.buildQueue(decks, now, '', capNew, capRev);
      if (!queue.length) { this.toast('本系列暂时没有到期的卡片'); this.render(); return; }
      // 每个系列用独立会话 key，绝不能和「学全部」的空 key 共用——否则学完转折词系列
      // 再点开 SAT800，会被 startStudy 的同 key 判定直接续上转折词的队列。
      this._beginStudy('series:' + id, series.name, queue, 'all');
    },

    // ---- 编辑器辅助 ----
    syncEditor: function () {
      const m = this.modal;
      if (!m || m.type !== 'card-v2') return;
      const get = function (idv) { const el = byId(idv); return el ? el.value : ''; };
      m.notetype = get('eType') || m.notetype;
      m.fields = {
        Front: get('eFront').trim(), Back: get('eBack').trim(),
        Extra: get('eExtra').trim(), Source: get('eSource').trim()
      };
      m.tags = get('eTags').split(/[,;\s]+/).filter(function (t) { return t !== ''; });
    },
    previewEditor: function () {
      const el = byId('ePreview');
      if (!el) return;
      const type = byId('eType') ? byId('eType').value : 'basic';
      const fields = {
        Front: byId('eFront') ? byId('eFront').value : '',
        Back: byId('eBack') ? byId('eBack').value : '',
        Extra: byId('eExtra') ? byId('eExtra').value : ''
      };
      const probe = {
        front: type === 'cloze' ? fields.Front : fields.Front,
        back: type === 'cloze' ? fields.Front : fields.Back,
        extra: fields.Extra, notetype: type,
        cloze: type === 'cloze' ? fields.Front : '', ord: 0,
        tags: [], media: (this.modal && this.modal.media) || []
      };
      el.innerHTML = FC.renderCardHtml(probe, 'front') +
        '<hr class="br-hr" />' +
        FC.renderCardHtml(probe, 'back');
    },

    // ---- 设置 ----
    // 「每日学习量」是全局统一设置：清除各牌组残留的新卡/复习上限覆盖，
    // 使调大的全局上限真正作用到每一个牌组（含导入/内置牌组）。
    applyGlobalDailyLimits: function () {
      const decks = this.state.decks || [];
      for (let i = 0; i < decks.length; i++) {
        const o = decks[i].options;
        if (!o) continue;
        o.newPerDay = null;
        o.reviewsPerDay = null;
      }
    },
    saveSettings: function () {
      const s = this.state.settings;
      const num = function (idv, fb) {
        const el = byId(idv);
        if (!el) return fb;
        const v = parseFloat(el.value);
        return isNaN(v) ? fb : v;
      };
      s.requestRetention = FC.clamp(num('setRetention', 0.9), 0.7, 0.99);
      s.maximumInterval = Math.max(1, Math.round(num('setMaxInterval', 36500)));
      s.newCardsPerDay = Math.max(0, Math.round(num('setNew', 20)));
      s.reviewCardsPerDay = Math.max(0, Math.round(num('setReview', 200)));
      this.applyGlobalDailyLimits();
      s.graduatingInterval = Math.max(1, Math.round(num('setGrad', 1)));
      s.easyInterval = Math.max(1, Math.round(num('setEasy', 4)));
      s.leechThreshold = Math.max(1, Math.round(num('setLeech', 8)));
      if (byId('setLeechAction')) s.leechAction = byId('setLeechAction').value === 'suspend' ? 'suspend' : 'tag';
      if (byId('setBury')) s.buryRelated = byId('setBury').value === '1';
      if (byId('setNewOrder')) s.newOrder = byId('setNewOrder').value || 'mix';
      if (byId('setReviewOrder')) s.reviewOrder = byId('setReviewOrder').value || 'due';
      if (byId('setTimer')) s.showTimer = byId('setTimer').value === '1';
      if (byId('setSound')) s.sound = byId('setSound').value !== '0';
      if (byId('setAutoReveal')) s.autoRevealSeconds = parseInt(byId('setAutoReveal').value, 10) || 0;
      if (byId('setBackupRemind')) s.backupRemindDays = parseInt(byId('setBackupRemind').value, 10) || 0;
      if (byId('setFont')) s.studyFont = byId('setFont').value || 'm';
      const readSwatch = function (idv) {
        const box = byId(idv);
        if (!box) return null;
        const r = box.querySelector('input:checked');
        return r ? r.value : null;
      };
      const ac = readSwatch('setAccent'); if (ac) s.accent = ac;
      const bgv = readSwatch('setBg'); if (bgv) s.bg = bgv;
      // 预设标记：强调色 + 背景完全一致记为该预设；否则视为自定义微调
      const plist = (typeof FCUI !== 'undefined' && FCUI.THEME_PRESETS) || [];
      let matchedPreset = '';
      for (let pi = 0; pi < plist.length; pi++) {
        const p = plist[pi];
        if (p.accent === s.accent && p.bg === s.bg) { matchedPreset = p.id; break; }
      }
      s.preset = matchedPreset || 'custom';
      if (byId('setMotion')) s.motion = byId('setMotion').value !== '0';

      const parseArr = function (idv) {
        const el = byId(idv);
        if (!el) return [];
        return el.value.split(',').map(function (x) { return parseInt(x.trim(), 10); })
          .filter(function (x) { return !isNaN(x) && x > 0; });
      };
      const ls = parseArr('setLearn'); if (ls.length) s.learningSteps = ls;
      const rs = parseArr('setRelearn'); if (rs.length) s.relearningSteps = rs;
      // 账户 ID 的手机尾号：只留数字，取后 4 位
      if (byId('setPhoneTail')) {
        const t = String(byId('setPhoneTail').value || '').replace(/\D/g, '').slice(-4);
        if (t !== (this.account.phoneTail || '')) {
          this.account.phoneTail = t;
          this.saveAccount();
        }
      }
      this.applyTheme();
      this.save();
      this.toast('设置已保存');
      this.render();
    },

    // ---- CSV ----
    doCsvExport: function () {
      const text = FC.Csv.encode(this.state.decks);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'starcard-cards.csv';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      this.toast('已导出 CSV');
    },
    exportSelectedCsv: function () {
      const ids = FCUI.selectedIds(this);
      if (ids.length === 0) { this.toast('先选择卡片'); return; }
      const text = FC.Csv.encode(this.state.decks, ids);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'starcard-selected.csv';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      this.toast('已导出 ' + ids.length + ' 张卡片');
    }
  };

  let _studyAudio = null;
  function stopStudyAudio() {
    try { if (_studyAudio) { _studyAudio.pause(); _studyAudio = null; } } catch (e) {}
    // TTS 兜底：停止浏览器语音朗读
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) {}
  }
  function playStudyAudio(src) {
    stopStudyAudio();
    try {
      if (src) { _studyAudio = new Audio(src); const p = _studyAudio.play(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* 音频播放失败不影响学习 */ }
  }

  // TTS 兜底：没有真人音频时，用浏览器语音合成朗读英文（单词/短语）。
  function speakText(text) {
    if (!text || typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/==/g, '').trim());
      u.lang = 'en-US'; u.rate = 0.9; u.pitch = 1;
      // 尽量挑选英文语音
      const voices = speechSynthesis.getVoices() || [];
      const en = voices.filter(v => /^en(\-|_|$)/i.test(v.lang));
      if (en.length) u.voice = en[0];
      speechSynthesis.speak(u);
    } catch (e) { /* TTS 不可用时静默 */ }
  }
  // 暴露给小星助手的「朗读单词」按钮使用
  App.speakText = speakText;

  // 轻提示音（翻面 / 评分）：WebAudio 合成，无需音频文件；受「翻面提示音」设置控制
  let _audioCtx = null;
  function playCue(kind) {
    const s = App.state && App.state.settings;
    if (!s || s.sound === false) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      if (_audioCtx.state === 'suspended' && _audioCtx.resume) _audioCtx.resume();
      const now = _audioCtx.currentTime;
      const notes = kind === 'rate'
        ? [[660, 0], [880, 0.07]]      // 评分：上行两音
        : [[520, 0]];                   // 翻面：单音
      notes.forEach(function (n) {
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n[0], now + n[1]);
        gain.gain.setValueAtTime(0.0001, now + n[1]);
        gain.gain.exponentialRampToValueAtTime(0.12, now + n[1] + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n[1] + 0.12);
        osc.connect(gain); gain.connect(_audioCtx.destination);
        osc.start(now + n[1]); osc.stop(now + n[1] + 0.14);
      });
    } catch (e) { /* 提示音失败不影响学习 */ }
  }
  App.playCue = playCue;

  // 翻到卡片背面时自动朗读：真人音频优先（播放按钮 / audio 标签），否则用 TTS 读正面单词。
  function autoPlayFaceAudio(faceEl, fallbackText) {
    // 停止页面上其它正在播放的学习卡音频，避免多张卡叠音
    const allAu = document.querySelectorAll('.flip-face audio');
    for (let i = 0; i < allAu.length; i++) { try { allAu[i].pause(); } catch (e) {} }
    let src = '';
    if (faceEl) {
      const btn = faceEl.querySelector('[data-act="st-play"][data-src]');
      if (btn) src = btn.getAttribute('data-src') || '';
      if (!src) {
        const au = faceEl.querySelector('audio[src]');
        if (au) src = au.getAttribute('src') || '';
      }
    }
    if (src) { playStudyAudio(src); return; }
    // 无真人音频 → TTS 朗读正面英文
    speakText(fallbackText || '');
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function shuffleIndices(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return shuffle(a); }
  function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ----------------------------------------------------------------------
  // 事件委托
  // ----------------------------------------------------------------------
  // 个性化色块 / 背景样片：单选，点击立即高亮当前项（保存后由 applyTheme 真正生效）
  document.addEventListener('change', function (e) {
    const r = e.target;
    if (r && r.type === 'radio' && r.name && (r.name === 'accentR' || r.name === 'bgR')) {
      const row = r.closest('.swatch-row');
      if (row) {
        const sibs = row.querySelectorAll('.swatch');
        for (let i = 0; i < sibs.length; i++) sibs[i].classList.remove('on');
        const lab = r.closest('.swatch');
        if (lab) lab.classList.add('on');
      }
    }
  });

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const d = el.dataset;

    // 翻面（局部处理，保留动画）—— 用户要求卡片零发音，不再有 st-play / 自动朗读 / 提示音
    if (act === 'study-flip') {
      const inner = qs('.flip-inner');
      if (!inner) return;
      App.studyRevealed = !App.studyRevealed;
      App.saveStudySession();
      inner.classList.toggle('flipped', App.studyRevealed);
      // 同步底部按钮
      const footer = qs('.rate-bar');
      if (footer && App.study) {
        const c = App.currentStudyCard();
        if (c) {
          if (App.studyRevealed) {
            const labels = ['重来', '困难', '良好', '简单'];
            const prev = new FC.Scheduler(App.state.settings).preview(c, Date.now());
            footer.innerHTML = '';
            for (let r = 1; r <= 4; r++) {
              const b = document.createElement('button');
              b.className = 'rate-btn r' + r; b.setAttribute('data-act', 'study-rate'); b.setAttribute('data-rating', String(r));
              b.innerHTML = '<span class="rate-key">' + String(r) + '</span>' +
                '<span class="rate-label">' + labels[r - 1] + '</span>' +
                '<span class="rate-meta">' + FCUI.esc(prev[r - 1]) + '</span>';
              footer.appendChild(b);
            }
          } else {
            footer.innerHTML = '<button class="rate-btn r3" data-act="study-flip">' +
              '<span class="rate-label">显示答案</span></button>';
          }
        }
      }
      return;
    }
    if (act === 'wb-flip') {
      const inner = qs('.flip-inner');
      if (!inner) return;
      App.wb.revealed = !App.wb.revealed;
      inner.classList.toggle('flipped', App.wb.revealed);
      const footer = qs('.wb-actions') || qs('.rate-bar');
      if (footer && App.wb) {
        if (App.wb.revealed) {
          footer.className = 'wb-actions';
          footer.innerHTML =
            '<button class="btn r1" data-act="wb-rate" data-status="0">不认识</button>' +
            '<button class="btn r2" data-act="wb-rate" data-status="1">模糊</button>' +
            '<button class="btn btn-primary" data-act="wb-rate" data-status="2">认识</button>';
        } else {
          footer.className = 'rate-bar';
          footer.innerHTML = '<button class="rate-btn r3" data-act="wb-flip">' +
            '<span class="rate-key">Enter / Space</span>' +
            '<span class="rate-label">显示释义</span>' +
            '<span class="rate-meta">翻面看答案 · 按 Enter 或空格</span></button>';
        }
      }
      return;
    }

    // 模态遮罩点击关闭（只有点在遮罩本身，点弹窗内部不关闭）
    if (act === 'mask-click') { if (e.target === el) App.closeModal(); return; }

    switch (act) {
      // —— 小星助手 / 命令面板 ——
      case 'ai-toggle': App.aiToggle(); break;
      case 'ai-close': App.aiClose(); break;
      case 'ai-send': {
        const inp = byId('aiInput');
        App.aiSend(inp ? inp.value : App.aiDraft);
        break;
      }
      case 'ai-prompt': App.aiPrompt(d.q || ''); break;
      case 'ai-cmd': App.aiCmd(d.key); break;
      case 'ai-speak':
        if (d.word && App.speakText) { App.speakText(d.word); App.toast('正在朗读 ' + d.word, 'ai', 'speaker'); }
        break;
      case 'ai-ask-study': {
        const c = App.currentStudyCard && App.currentStudyCard();
        App.aiOpenWith(c ? ('查 ' + (FC.AI && FC.AI.STRIP ? FC.AI.STRIP(c.front) : c.front)) : '今天要学多少');
        break;
      }
      case 'cmd-open': App.cmdToggle(); break;
      case 'cmd-close': App.cmdClose(); break;
      case 'cmd-mask': if (e.target === el) App.cmdClose(); break;
      case 'cmd-pick': App.cmdPick(parseInt(d.i, 10)); break;
      case 'tab': App.tab = parseInt(d.tab, 10); App.seriesId = ''; App.cardManageDeckId = ''; App.accountOpen = false; App.activeClassId = ''; App.aiOpen = false; App.cmdOpen = false; App.noticePageOpen = false; App.backupPageOpen = false; App.modal = null; App.render(); break;
      case 'new-deck': App.openModal({ type: 'deck', id: '', name: '', desc: '' }); break;
      case 'deck-open': App.cardManageDeckId = d.id; App.render(); break;
      case 'deck-back': App.cardManageDeckId = ''; App.render(); break;
      case 'series-open': App.openSeries(d.id); break;
      case 'series-back': App.closeSeries(); break;
      case 'series-import': App.importSeries(d.id); break;
      case 'series-restore': App.restoreSeries(d.id); break;
      case 'series-removed-toggle': App.showRemovedSeries = !App.showRemovedSeries; App.render(); break;
      case 'series-study': App.studySeries(d.id); break;
      case 'series-toggle': {
        const arr = App.state.collapsedSeries || (App.state.collapsedSeries = []);
        const ci = arr.indexOf(d.id);
        if (ci >= 0) arr.splice(ci, 1); else arr.push(d.id);
        App.save(); App.render(); break;
      }
      case 'study-deck': App.startStudy(d.id); break;
      case 'study-all': App.startStudy(''); break;
      case 'study-stop': App.stopStudy(); break;
      case 'study-resume': App.resumeStudy(); break;
      case 'study-rate': App.rateStudy(parseInt(d.rating, 10)); break;
      case 'card-new':
        App.openModal({
          type: 'card-v2', id: '', deckId: d.id, notetype: 'basic',
          fields: { Front: '', Back: '', Extra: '', Source: '' }, tags: [], media: []
        });
        break;
      case 'card-new-global': {
        let deck = App.state.decks[0];
        if (!deck) {
          deck = FC.newDeck('默认牌组', '');
          App.state.decks.push(deck);
        }
        App.openModal({
          type: 'card-v2', id: '', deckId: deck.id, notetype: 'basic',
          fields: { Front: '', Back: '', Extra: '', Source: '' }, tags: [], media: []
        });
        break;
      }
      case 'card-edit': {
        const r = App.findCard(d.id);
        if (r) {
          const c = r.card;
          const f = c.fields || { Front: c.front, Back: c.back, Extra: c.extra, Source: '' };
          App.openModal({
            type: 'card-v2', id: c.id, deckId: r.deck.id,
            notetype: c.notetype || 'basic',
            fields: { Front: f.Front, Back: f.Back, Extra: f.Extra, Source: f.Source || '' },
            tags: c.tags.slice(),
            media: c.media.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; })
          });
        }
        break;
      }
      case 'card-info': {
        const r = App.findCard(d.id);
        if (r) App.openModal({ type: 'card-info', card: r.card, cardId: r.card.id });
        break;
      }
      case 'card-del': {
        const r = App.findCard(d.id);
        if (r) {
          App.pushUndo('删除卡片');
          r.deck.cards = r.deck.cards.filter(function (c) { return c.id !== d.id; });
          App.save(); App.render(); App.toast('已删除');
        }
        break;
      }
      case 'card-batch': App.openModal({ type: 'batch', deckId: d.id }); break;
      case 'import-open': byId('srcdFile').click(); break;
      case 'import-hub': App.openModal({ type: 'import-hub' }); break;
      case 'import-formats': App.openModal({ type: 'import-formats' }); break;
      case 'import-back': App.openModal({ type: 'import-hub' }); break;
      case 'import-pick':
        App.modal = null;
        if (d.kind === 'srcd') byId('srcdFile').click();
        else if (d.kind === 'apkg') byId('apkgFile').click();
        else if (d.kind === 'csv') App.openModal({ type: 'csv-import' });
        break;
      case 'apkg-open': byId('apkgFile').click(); break;
      case 'apkg-confirm': App.confirmApkgImport(); break;
      case 'builtin-load': App.loadBuiltinDeck(d.file, d.name); break;
      case 'builtin-sat800': App.openSeries('sat800'); break;
      case 'export-open': App.doExport(); break;
      case 'reset-confirm': App.openModal({ type: 'confirm', title: '清空所有数据', message: '将删除全部牌组、卡片、词书进度、班级/同桌与比赛战绩，且不可恢复。建议先导出 .srcd 备份。', action: 'reset' }); break;

      // ---- 浏览器 ----
      case 'browser-open': App.openBrowser('', ''); break;
      case 'browser-deck': App.openBrowser(d.id, ''); break;
      case 'browser-close': App.closeBrowser(); break;
      case 'br-row':
        if (App.browser) { App.browser.previewId = d.id; App.refreshBrowser(); }
        break;
      case 'br-preview-close':
        if (App.browser) { App.browser.previewId = ''; App.refreshBrowser(); }
        break;
      case 'br-check':
        if (App.browser) {
          App.browser.selected[d.id] = !App.browser.selected[d.id];
          App.refreshBrowser();
        }
        break;
      case 'br-check-all':
        if (App.browser) {
          const rows0 = App.browserRows();
          const allOn = rows0.length > 0 && rows0.every(function (r) { return App.browser.selected[r.card.id]; });
          App.selectAll(!allOn);
        }
        break;
      case 'br-sort':
        if (App.browser) {
          if (App.browser.sortKey === d.key) App.browser.sortDir = App.browser.sortDir === 'asc' ? 'desc' : 'asc';
          else { App.browser.sortKey = d.key; App.browser.sortDir = 'desc'; }
          App.refreshBrowser();
        }
        break;
      case 'br-clear':
        if (App.browser) {
          App.browser.query = '';
          App.browser.deckId = '';
          const inp = byId('brQuery');
          if (inp) inp.value = '';
          App.refreshBrowser();
        }
        break;
      case 'br-filter': App.toast('可用语法：deck: tag: is:due flag:1 - 取反 OR'); break;
      case 'br-more':
        if (App.browser) { App.browser.limit = (App.browser.limit || 300) + 300; App.render(); }
        break;
      case 'br-pause': App.batchCards('pause'); App.toast('已暂停'); break;
      case 'br-unsuspend': App.batchCards('unsuspend'); App.toast('已恢复'); break;
      case 'br-flag': App.openModal({ type: 'flag' }); break;
      case 'br-flag-one': App.openModal({ type: 'flag', cardId: d.id }); break;
      case 'br-tag': App.openModal({ type: 'tag', tags: '' }); break;
      case 'br-reset':
        App.openModal({ type: 'confirm', title: '重置选中卡片', message: '将把选中卡片恢复为新卡，并清除调度进度（复习历史保留）。', action: 'cards-reset' });
        break;
      case 'br-move': App.openModal({ type: 'move' }); break;
      case 'br-delete':
        App.openModal({ type: 'confirm', title: '删除选中卡片', message: '将永久删除选中的卡片，可以撤销。', action: 'cards-delete' });
        break;
      case 'br-csv': App.exportSelectedCsv(); break;
      case 'br-tag-search': App.openBrowser('', 'tag:' + d.tag); break;
      case 'br-pause-one': {
        const r = App.findCard(d.id);
        if (r) {
          App.pushUndo(r.card.suspended ? '恢复卡片' : '暂停卡片');
          r.card.suspended = !r.card.suspended;
          App.save(); App.refreshBrowser(); App.toast(r.card.suspended ? '已暂停' : '已恢复');
        }
        break;
      }
      case 'flag-set': {
        const flag = parseInt(d.flag, 10) || 0;
        if (App.modal && App.modal.cardId) {
          const r = App.findCard(App.modal.cardId);
          if (r) { App.pushUndo('标记卡片'); r.card.flags = flag; App.save(); }
        } else if (App.browser) {
          App.batchCards('flag', { flag: flag });
        }
        App.modal = null;
        App.render();
        break;
      }

      // ---- 牌组操作 ----
      case 'deck-menu': App.openModal({ type: 'deck-menu', deckId: d.id }); break;
      case 'deck-options': App.openModal({
        type: 'deck-options', deckId: d.id, deck: App.findDeck(d.id), global: App.state.settings
      }); break;
      case 'deck-options-reset': {
        const deck = App.findDeck(d.id);
        if (deck) {
          App.pushUndo('恢复牌组默认选项');
          deck.options = FC.defaultDeckOptions();
          App.save();
        }
        App.modal = null;
        App.render();
        App.toast('已恢复为跟随全局');
        break;
      }
      case 'deck-rename': {
        const deck = App.findDeck(d.id);
        if (deck) App.openModal({ type: 'deck', id: deck.id, name: deck.name, desc: deck.description });
        break;
      }
      case 'deck-export': App.doExport([App.findDeck(d.id)], 'starcard-deck.srcd'); break;
      case 'series-export': {
        const se = FC.seriesById && FC.seriesById(d.id, App.state);
        if (!se) { App.toast('系列不存在'); break; }
        const decks = FC.seriesDecksOf ? FC.seriesDecksOf(App.state, se) : [];
        if (!decks.length) { App.toast('该系列还没有可导出的牌组'); break; }
        App.doExport(decks, 'starcard-' + se.id + '.srcd');
        break;
      }
      case 'deck-subdeck': App.openModal({ type: 'deck', id: '', name: '', desc: '', parentId: d.id }); break;
      case 'deck-reset': {
        const dk = App.findDeck(d.id);
        App.openModal({
          type: 'confirm', title: '重置牌组进度',
          message: '将把「' + (dk ? dk.name : '') + '」的全部 ' + (dk ? dk.cards.length : 0) +
            ' 张卡片恢复成从没学过（清空调度、复习历史与标记），可撤销。',
          action: 'deck-reset', deckId: d.id
        });
        break;
      }
      case 'deck-delete':
        App.openModal({ type: 'confirm', title: '删除牌组', message: '将删除该牌组及其中所有卡片，可撤销。', action: 'deck-delete', deckId: d.id });
        break;
      case 'series-delete': {
        const se = FC.seriesById ? FC.seriesById(d.id, App.state) : null;
        if (!se) { App.toast('系列不存在'); break; }
        const vd = FC.seriesDecksOf ? FC.seriesDecksOf(App.state, se) : [];
        const vcards = vd.reduce(function (a, dk) { return a + dk.cards.length; }, 0);
        App.openModal({ type: 'confirm', title: '删除整个词库', message: '将删除「' + se.name + '」整个词库，共 ' + vd.length + ' 个牌组 / ' + vcards + ' 张卡片。删除后该系列将从词书移除，可撤销。', action: 'series-delete', tagKey: se.tagKey });
        break;
      }
      case 'series-delete-by-deck': {
        const dk = App.findDeck(d.id);
        let se = null;
        const _series = FC.visibleSeries ? FC.visibleSeries(App.state) : [];
        if (dk) {
          for (let i = 0; i < _series.length; i++) {
            if ((dk.tags || []).indexOf(_series[i].tagKey) >= 0) { se = _series[i]; break; }
          }
        }
        if (!se) { App.toast('该牌组不属于可整库删除的词库'); break; }
        const vd = FC.seriesDecksOf ? FC.seriesDecksOf(App.state, se) : [];
        const vcards = vd.reduce(function (a, dk2) { return a + dk2.cards.length; }, 0);
        App.openModal({ type: 'confirm', title: '删除整个词库', message: '将删除「' + se.name + '」整个词库，共 ' + vd.length + ' 个牌组 / ' + vcards + ' 张卡片。删除后该系列将从词书移除，可撤销。', action: 'series-delete', tagKey: se.tagKey });
        break;
      }

      // ---- Anki 扩展 ----
      case 'custom-study': App.openModal({ type: 'custom-study' }); break;
      case 'csv-open': App.openModal({ type: 'csv-import' }); break;
      case 'csv-export': App.doCsvExport(); break;
      case 'csv-preview': {
        const text = byId('csvText') ? byId('csvText').value : '';
        const name = byId('csvDeck') ? byId('csvDeck').value : 'CSV 导入';
        if (!text.trim()) { App.toast('先粘贴内容'); break; }
        const plan = FC.Csv.toPlan(text, name);
        const hint = byId('csvHint');
        if (hint) {
          hint.textContent = '识别到 ' + plan.items.length + ' 行' + (plan.hasHeader ? '（含表头）' : '（无表头）') +
            (plan.items.length ? '，前 3 行：' + plan.items.slice(0, 3).map(function (x) {
              return x.front + ' → ' + x.back;
            }).join(' / ') : '');
        }
        break;
      }
      case 'editor-media': {
        const file = byId('eMediaFile');
        if (file) { file.setAttribute('data-kind', d.kind || 'image'); file.click(); }
        break;
      }
      case 'editor-preview': App.previewEditor(); break;

      // ---- 学习页工具 ----
      case 'study-flag': {
        const c = App.currentStudyCard();
        if (c) App.openModal({ type: 'flag', cardId: c.id });
        break;
      }
      case 'study-suspend': {
        const c = App.currentStudyCard();
        if (c) {
          App.pushUndo('暂停卡片');
          const r = App.findCard(c.id);
          if (r) r.card.suspended = !r.card.suspended;
          App.save();
          if (r && r.card.suspended) {
            if (App.study && App.study.dueQueue) {
              App.study.dueQueue = App.study.dueQueue.filter(function (x) { return x.id !== c.id; });
            }
            App.advanceToNext();
          } else App.studyRevealed = false;
          App.render();
          App.toast(r && r.card.suspended ? '已暂停并跳过' : '已恢复');
        }
        break;
      }
      case 'study-ahead': App.studyAhead(); break;
      case 'study-edit': {
        const c = App.currentStudyCard();
        if (c) {
          const r = App.findCard(c.id);
          if (r) {
            App.openModal({
              type: 'card-v2', id: c.id, deckId: r.deck.id, notetype: c.notetype || 'basic',
              fields: c.fields || { Front: c.front, Back: c.back, Extra: c.extra, Source: '' },
              tags: c.tags.slice(),
              media: c.media.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; })
            });
          }
        }
        break;
      }
      case 'study-reset': {
        const c = App.currentStudyCard();
        if (c) App.resetCard(c.id);
        break;
      }
      case 'study-undo': App.undo(); break;
      case 'info-reset': {
        App.modal = null;
        App.resetCard(d.id);
        break;
      }
      case 'info-reschedule': App.openModal({ type: 'reschedule', cardId: d.id }); break;
      case 'wb-start': App.startWordBook(d.id, 0); break;
      case 'wb-review': App.startWordBook(d.id, 1); break;
      case 'wb-del':
        App.state.wordBooks = App.state.wordBooks.filter(function (b) { return b.id !== d.id; });
        App.save(); App.render(); App.toast('已删除词书'); break;
      case 'wb-rate': App.rateWord(parseInt(d.status, 10)); break;
      case 'wb-stop': App.stopWordBook(); break;
      case 'class-back': App.activeClassId = ''; App.render(); break;
      case 'account-back': App.accountOpen = false; App.render(); break;
      case 'class-new': App.openModal({ type: 'class', id: '', name: '', desc: '' }); break;
      case 'class-join': App.openModal({ type: 'join', code: '' }); break;
      case 'class-open': App.activeClassId = d.id; App.render(); break;
      case 'member-add': App.openModal({ type: 'member', classId: d.id, name: '' }); break;
      case 'deskmate-add': App.openModal({ type: 'deskmate', name: '', note: '' }); break;
      case 'deskmate-del':
        App.state.deskmates = App.state.deskmates.filter(function (x) { return x.id !== d.id; });
        App.save(); App.render(); break;
      case 'deskmate-urge': {
        const dt = App.state.deskmates.find(function (x) { return x.id === d.id; });
        if (dt) { dt.score += 5; App.save(); App.render(); App.toast('已督促 ' + dt.name + ' +5 分'); }
        break;
      }
      case 'battle-config': App.tab = 4; App.accountOpen = false; App.render(); break;
      case 'battle-begin':
        App.battleBookId = (byId('battleBook') ? byId('battleBook').value : App.battleBookId);
        App.battlePlayersText = (byId('battlePlayers') ? byId('battlePlayers').value : App.battlePlayersText);
        App.battleHandText = (byId('battleHand') ? byId('battleHand').value : App.battleHandText);
        App.startBattle(); break;
      case 'battle-pass': App.battlePass(); break;
      case 'battle-choose': App.battleChoose(parseInt(d.i, 10)); break;
      case 'battle-next': App.battleNext(); break;
      case 'battle-exit': App.exitBattle(); break;
      case 'account-menu': App.toggleAccountMenu(); break;
      case 'account-menu-close': App.closeAccountMenu(); break;
      case 'goto-settings': App.gotoSettings(); break;
      case 'account-open': App.openAccount(); break;
      case 'account-login': App.openAccount(); break;
      case 'login-tab': App.setLoginMode(d.mode); break;
      case 'login-send': App.sendLoginCode(); break;
      case 'login-submit': App.submitLogin(); break;
      case 'login-inline': App.loginInline(); break;
      case 'profile-open': App.openModal({ type: 'profile', nickname: App.account.nickname, email: App.account.email }); break;
      case 'avatar-open': App.openAvatar(); break;
      case 'crop-apply': App.commitAvatarCrop(); break;
      case 'crop-cancel': App.cancelAvatarCrop(); break;
      case 'crop-zoom': App.zoomAvatarCrop(Number(d.dir) || 1); break;
      case 'avatar-color': App.setAvatarColor(d.color); break;
      case 'avatar-clear': App.clearAvatarImage(); break;
      case 'privacy-toggle': App.togglePrivacy(d.key); break;
      case 'privacy-info': App.saveLoginDraft(); App.openModal({ type: 'privacy' }); break;
      case 'account-logout': App.openModal({ type: 'confirm', title: '退出登录', message: '退出后本机学习数据仍会保留，重新登录即可继续使用。', action: 'logout' }); break;
      case 'account-clear': App.openModal({ type: 'confirm', title: '清除本机账户数据', message: '将删除昵称、邮箱、头像与隐私偏好，并退出登录。牌组与学习记录不受影响。', action: 'account-clear' }); break;
      case 'save-settings': App.saveSettings(); break;
      // 设置页顶部锚点：只滚动，不重绘（重绘会打断正在编辑的输入框）
      case 'set-jump': {
        const target = byId(d.target);
        if (target && target.scrollIntoView) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          catch (err) { target.scrollIntoView(); }
        }
        break;
      }
      case 'set-unlimited':
        App.state.settings.newCardsPerDay = 999;
        App.applyGlobalDailyLimits();
        App.ensureDaily(); App.save(); App.render();
        App.toast('每日新卡上限已设为不限（999）· 全部卡片可一次学完');
        break;
      case 'set-standard':
        App.state.settings.newCardsPerDay = 20;
        App.applyGlobalDailyLimits();
        App.ensureDaily(); App.save(); App.render();
        App.toast('已恢复推荐上限（每日新卡 20）');
        break;
      case 'settings-open':
        App.tab = 6; App.cardManageDeckId = ''; App.accountOpen = false; App.study = null; App.render();
        break;
      case 'modal-ok': App.modalOk(); break;
      case 'modal-cancel': App.closeModal(); break;
      case 'shortcuts-help': App.openModal({ type: 'shortcuts' }); break;
      case 'notice-open': App.openNoticePage(); break;
      case 'notice-back': App.closeNoticePage(); break;
      case 'backup-open': App.openBackupPage(); break;
      case 'backup-back': App.closeBackupPage(); break;
      case 'backup-export': App.doExport(null, 'starcard-backup.srcd'); break;
      case 'notice-read': App.markNoticesRead(); break;
      case 'notice-go': if (d.page === 'backup') { App.openBackupPage(); } else { App.noticesGo(parseInt(d.tab, 10)); } break;
      case 'theme-preset': App.applyPreset(d.id); break;
      case 'theme-mode': App.setThemeMode(d.theme); break;
    }
  });

  // 浏览器实时搜索
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t) return;
    if (t.id === 'brQuery' && App.browser) {
      App.browser.query = t.value;
      App.refreshBrowser();
    }
    // 小星输入框：暂存草稿（不重绘，避免打断输入 / 中文输入法）
    if (t.id === 'aiInput') App.aiDraft = t.value;
    // 命令面板：实时过滤（只更新列表 DOM，不重绘整个应用，保住焦点与输入法）
    if (t.id === 'cmdInput') {
      App.cmdQuery = t.value;
      if (!e.isComposing) App.refreshCmdList();
    }
    // 登录表单输入实时暂存，避免任何重绘丢失内容
    if (t.id === 'loginEmail' || t.id === 'loginPhone' || t.id === 'loginCode' ||
        t.id === 'loginPassword' || t.id === 'loginNick' || t.id === 'loginAgree') App.saveLoginDraft();
  });

  // 中文输入法结束后刷新命令面板候选
  document.addEventListener('compositionend', function (e) {
    if (e.target && e.target.id === 'cmdInput' && App.cmdOpen) {
      App.cmdQuery = e.target.value;
      App.refreshCmdList();
    }
  });

  // 头像裁剪：拖动 / 滚轮 / 滑杆（document 级委托，避免每次渲染重复绑定）
  let _cropDrag = null;
  document.addEventListener('pointerdown', function (e) {
    if (!App.modal || App.modal.type !== 'avatar-crop' || !App._crop) return;
    const stage = byId('avaCropStage');
    if (!stage || !(stage === e.target || stage.contains(e.target))) return;
    _cropDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: App._crop.x, oy: App._crop.y };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!_cropDrag || e.pointerId !== _cropDrag.id) return;
    const c = App._crop;
    if (!c) { _cropDrag = null; return; }
    c.x = _cropDrag.ox + (e.clientX - _cropDrag.x);
    c.y = _cropDrag.oy + (e.clientY - _cropDrag.y);
    App.syncAvatarCrop();
    e.preventDefault();
  });
  document.addEventListener('pointerup', function (e) {
    if (_cropDrag && e.pointerId === _cropDrag.id) _cropDrag = null;
  });
  document.addEventListener('pointercancel', function (e) {
    if (_cropDrag && e.pointerId === _cropDrag.id) _cropDrag = null;
  });
  document.addEventListener('wheel', function (e) {
    if (!App.modal || App.modal.type !== 'avatar-crop' || !App._crop) return;
    const stage = byId('avaCropStage');
    if (!stage || !stage.contains(e.target)) return;
    e.preventDefault();
    const c = App._crop;
    c.scale = Math.max(1, Math.min(3.2, c.scale * (e.deltaY < 0 ? 1.08 : 0.925)));
    const rg = byId('avaCropZoom');
    if (rg) rg.value = String(Math.round(c.scale * 100));
    App.syncAvatarCrop();
  }, { passive: false });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'avaCropZoom') App.setAvatarCropScale(e.target.value);
  });

  // 编辑器：类型切换 / 媒体文件
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t) return;
    if (t.id === 'loginAgree') { App.saveLoginDraft(); return; }
    if (t.id === 'avatarFile') {
      App.handleAvatarFile(t.files && t.files[0]);
      t.value = '';
      return;
    }
    if (t.id === 'eType' && App.modal && App.modal.type === 'card-v2') {
      const type = t.value;
      const backWrap = byId('eBackWrap');
      if (backWrap) backWrap.style.display = type === 'cloze' ? 'none' : '';
      const label = byId('eFrontLabel');
      if (label) label.textContent = type === 'cloze' ? '填空文本' : '正面';
      const hint = byId('eTypeHint');
      if (hint) hint.textContent = FC.notetypeById(type).desc;
      const front = byId('eFront');
      if (front) front.placeholder = type === 'cloze'
        ? '如：The {{c1::capital}} of France is Paris.'
        : '问题 / 单词 / 提示';
      return;
    }
    if (t.id === 'csvFile') {
      const file = t.files && t.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const ta = byId('csvText');
        if (ta) {
          ta.value = String(reader.result || '');
          const hint = byId('csvHint');
          if (hint) hint.textContent = '已读取 ' + file.name + '，点击「预览」检查解析结果。';
        }
      };
      reader.readAsText(file, 'UTF-8');
      return;
    }
    if (t.id === 'eMediaFile') {
      const kind = t.getAttribute('data-kind') || 'image';
      const file = t.files && t.files[0];
      if (!file || !App.modal) return;
      App.syncEditor();
      const reader = new FileReader();
      reader.onload = function () {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return;
        const base64 = dataUrl.slice(comma + 1);
        const ext = (file.name.split('.').pop() || (kind === 'image' ? 'png' : 'mp3')).toLowerCase();
        const name = (kind === 'image' ? 'img-' : 'audio-') + Date.now() + '.' + ext;
        const mime = file.type || (kind === 'image' ? 'image/png' : 'audio/mpeg');
        if (!App.modal) return;
        App.modal.media = App.modal.media || [];
        App.modal.media.push({ name: name, mime: mime, data: base64 });
        const field = kind === 'image' ? byId('eFront') : byId('eBack');
        if (field) {
          field.value = field.value + (kind === 'image'
            ? '\n![](' + 'media:' + name + ')'
            : '\n[sound:' + name + ']');
        }
        App.syncEditor();
        App.render();
        App.toast('媒体已加入，保存后随卡片生效');
      };
      reader.readAsDataURL(file);
      t.value = '';
    }
  });

  // 键盘快捷键：空格/回车 翻面 / 1-4 评分 / Esc 退出
  document.addEventListener('keydown', function (e) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' || t.isContentEditable);

    // 撤销：Ctrl + Z（输入框内保留浏览器原生撤销）
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      if (!typing) {
        e.preventDefault();
        App.undo();
      }
      return;
    }
    // 智能命令面板：Ctrl + K 全局唤出
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      App.cmdToggle();
      return;
    }
    // 命令面板键盘导航
    if (App.cmdOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); App.cmdMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); App.cmdMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); App.cmdPick(App.cmdIndex); }
      else if (e.key === 'Escape') { e.preventDefault(); App.cmdClose(); }
      return;
    }
    // 小星输入框：Enter 发送 / Esc 关闭（不打断中文输入法）
    if (App.aiOpen && typing) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const inp = qs('#aiInput');
        App.aiSend(inp ? inp.value : App.aiDraft);
      } else if (e.key === 'Escape') { e.preventDefault(); App.aiClose(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing) return;

    if (App.modal) {
      if (e.key === 'Escape') { App.closeModal(); }
      else if (e.key === 'Enter') {
        const ok = qs('[data-act="modal-ok"]');
        if (ok && !ok.hasAttribute('disabled')) { e.preventDefault(); ok.click(); }
      }
      return;
    }
    if (App.aiOpen && e.key === 'Escape') { e.preventDefault(); App.aiClose(); return; }
    // 全局：? 打开快捷键面板（PK 进行中不打断）
    if (e.key === '?' && !App.battle) {
      e.preventDefault();
      App.openModal({ type: 'shortcuts' });
      return;
    }
    if (App.study) {
      const k = String(e.key || '').toLowerCase();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // 未翻面 → 翻面；已翻面 → 良好（Anki 高效流：空格/回车 = Good）
        const b = App.studyRevealed
          ? qs('[data-act="study-rate"][data-rating="3"]')
          : qs('.rate-bar [data-act="study-flip"]');
        if (b) b.click();
      } else if (App.studyRevealed && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const b = qs('[data-act="study-rate"][data-rating="' + e.key + '"]');
        if (b) b.click();
      } else if (k === 'e') {
        const b = qs('[data-act="study-edit"]');
        if (b) b.click();
      } else if (k === 's') {
        const b = qs('[data-act="study-suspend"]');
        if (b) b.click();
      } else if (k === 'f') {
        const b = qs('[data-act="study-flag"]');
        if (b) b.click();
      } else if (k === 'i') {
        const c = App.currentStudyCard();
        if (c) App.openModal({ type: 'card-info', card: c, cardId: c.id });
      } else if (k === 'r') {
        const c = App.currentStudyCard();
        if (c) App.resetCard(c.id);
      } else if (e.key === 'Escape') { App.stopStudy(); }
      return;
    }
    if (App.browser) {
      if (e.key === 'Escape') App.closeBrowser();
      return;
    }
    if (App.wb) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // 未翻面 → 翻面；已翻面 → 认识（等同 3）
        const b = App.wb.revealed
          ? qs('[data-act="wb-rate"][data-status="2"]')
          : qs('[data-act="wb-flip"]');
        if (b) b.click();
      } else if (App.wb.revealed && e.key >= '1' && e.key <= '3') {
        e.preventDefault();
        const b = qs('[data-act="wb-rate"][data-status="' + (parseInt(e.key, 10) - 1) + '"]');
        if (b) b.click();
      } else if (e.key === 'Escape') { App.stopWordBook(); }
      return;
    }
    if (App.battle && App.battle.phase === 2 && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const b = qs('[data-act="battle-choose"][data-i="' + (parseInt(e.key, 10) - 1) + '"]');
      if (b) b.click();
      return;
    }
    if (String(e.key || '').toLowerCase() === 'b') {
      e.preventDefault();
      App.openBrowser('', '');
    }
  });

  // 文件导入
  byId('srcdFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () { App.doImport(String(reader.result), file.name); };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Anki .apkg / .colpkg 导入
  byId('apkgFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    App.importApkgFile(file);
    e.target.value = '';
  });

  // 隐私模式：开启后离开窗口 / 切到后台时遮盖学习内容
  function setPrivacyCover(on) {
    const cl = document.documentElement.classList;
    const bcl = document.body && document.body.classList;
    if (cl) cl.toggle('privacy-covered', !!on);
    if (bcl) bcl.toggle('privacy-covered', !!on);
  }
  function privacyBlurEnabled() {
    return !!(App.account.privacy && App.account.privacy.privacyBlur);
  }
  window.addEventListener('blur', function () { if (privacyBlurEnabled()) setPrivacyCover(true); });
  window.addEventListener('focus', function () {
    setPrivacyCover(false);
    // 回到页面时按绝对到期时间补算：到点的重来卡立即出现，未到点的重排倒计时
    if (App.study && App.studyActive) App.resumeStudyRuntime();
  });
  document.addEventListener('visibilitychange', function () {
    setPrivacyCover(!!(document.hidden && privacyBlurEnabled()));
    if (!document.hidden && App.study && App.studyActive) App.resumeStudyRuntime();
  });

  // 单卡答题计时：轻量定时更新 DOM，不触发整页重绘（仅「显示答题计时」开启时存在该元素）
  setInterval(function () {
    if (!App.study) return;
    const el = document.getElementById('cardTimer');
    if (!el || !App._cardShownAt) return;
    const secs = Math.max(0, Date.now() - App._cardShownAt) / 1000;
    const span = el.querySelector('span');
    if (span) span.textContent = secs.toFixed(1) + 's';
  }, 100);

  // 启动
  App.load();
  // 恢复会话后按绝对到期时间补算（静默，由紧随的 render 统一呈现，避免二次重绘闪烁）
  if (App.study && App.studyActive) App.resumeStudyRuntime({ silent: true });
  App.render();

  // 首次启动自动载入随包词库：仅当本地完全没有牌组、且从未自动载入过时执行。
  // 逐个 fetch 同目录的 .srcd（不内嵌进 HTML，避免单文件过大卡顿），全部成功后一次性合并。
  // 用户已有数据或已自动载入过则跳过，绝不覆盖学习进度。
  (function autoLoadBundledDecks() {
    var MARK = 'starcard-autoloaded-v2';
    // 只自动载入两个核心词库（约 1MB），避免一次性写入超出 localStorage 配额导致刷新丢失，
    // 也避免大词库（TOEFL 3783 张）拖慢首屏。其余词库仍随包提供，用户可按需「导入」。
    var FILES = ['SAT800美音.srcd', 'SAT转折词.srcd'];
    try {
      if (localStorage.getItem(MARK)) return;
    } catch (e) { return; }
    if (App.state && App.state.decks && App.state.decks.length) return;
    // file:// 下 fetch 本地文件通常被浏览器拦截，自动载入不可用，静默跳过（用户可用「导入」手动选）
    if (!/^https?:$/.test((window.location && window.location.protocol) || '')) return;
    var got = 0, texts = [];
    FILES.forEach(function (name, idx) {
      fetch(encodeURIComponent(name)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (text) {
        texts[idx] = text;
        got++;
        if (got !== FILES.length) return;
        var merged = null;
        for (var i = 0; i < texts.length; i++) {
          if (!texts[i]) continue;
          try {
            var dec = FC.SrcdCodec.decode(texts[i]);
            merged = merged ? FC.SrcdCodec.merge(merged, dec, false).state
                            : FC.SrcdCodec.merge(App.state, dec, false).state;
          } catch (e2) { /* 单个词库损坏则跳过其余 */ }
        }
        if (merged) {
          App.state = merged;
          App.save();
          App.render();
          App.toast('已自动载入核心词库（SAT800 / 转折词），可以开始学习了');
        }
        try { localStorage.setItem(MARK, '1'); } catch (e3) {}
      }).catch(function () {
        got++;
        if (got === FILES.length) { try { localStorage.setItem(MARK, '1'); } catch (e4) {} }
      });
    });
  })();
  // 首屏渲染成功后移除启动占位（若脚本异常，占位会保留并显示错误信息）
  try {
    const boot = document.getElementById('boot');
    if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
  } catch (e) {}
  // 在线环境下异步校验云端登录会话（离线不触发网络请求）
  App.restoreCloudSession();
})();

