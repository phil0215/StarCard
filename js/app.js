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
      privacy: { rememberLogin: true, showNickname: true, privacyBlur: false, allowInvites: true, showInCommunity: true, allowBuyMyCards: true },
      // 个人资料（社区展示用）与黑名单
      profile: { bio: '', exp: '', school: '' },
      blacklist: []
    };
  }

  const App = {
    state: FC.defaultState(),
    // 侧栏隐藏：桌面版专属，跨页跳转（整页刷新）也要记住
    sideHide: (function () { try { return localStorage.getItem('scSideHide') === '1'; } catch (e) { return false; } })(),
    tab: 1,
    seriesId: '',
    showRemovedSeries: false,
    cardManageDeckId: '',
    folderId: '',
    study: null,
    studySessions: {},      // 按学习范围（deckId，''=学全部）分别保存的会话，互不串台
    studyActive: true,      // false = 会话已挂起（首页显示「继续学习」，不强制进入全屏）
    studyRevealed: false,
    wb: null,
    accountOpen: false,
    accountMenuOpen: false,
    settingsQuery: '',         // 设置页左栏搜索关键词
    // 左栏搜索：纯 DOM 过滤，不重渲染（避免输入时掉焦点）
    filterStudio(q) {
      if (!this.studio) this.studio = { q: '', sel: '' };
      const needle = String(q || '').trim().toLowerCase();
      const rows = document.querySelectorAll('.s2-row');
      let visible = 0;
      for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        const kw = (el.getAttribute('data-key') || '').toLowerCase();
        const hit = !needle || kw.indexOf(needle) >= 0;
        el.style.display = hit ? '' : 'none';
        if (hit) visible += 1;
      }
      const more = document.querySelector('.s2-more');
      if (more) more.textContent = needle ? ('匹配 ' + visible + ' 张') : (more.getAttribute('data-orig') || more.textContent);
    },

    filterSettings(q) {
      this.settingsQuery = q || '';
      const needle = String(this.settingsQuery).trim().toLowerCase();
      const items = document.querySelectorAll('.set-side .ss-item');
      let visible = 0;
      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        const kw = (el.getAttribute('data-kw') || '').toLowerCase();
        const hit = !needle || kw.indexOf(needle) >= 0;
        el.style.display = hit ? '' : 'none';
        if (hit) visible += 1;
      }
      const groups = document.querySelectorAll('.set-side .ss-group');
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        let any = false, n = g.nextElementSibling;
        while (n && n.classList.contains('ss-item')) {
          if (n.style.display !== 'none') any = true;
          n = n.nextElementSibling;
        }
        g.style.display = any ? '' : 'none';
      }
      const empty = document.getElementById('ssEmpty');
      if (empty) empty.style.display = visible ? 'none' : '';
    },
    settingsPane: 'account',   // 设置页当前分类：account / level / plan / fsrs / study / appearance / data / privacy / keys / about
    noticePageOpen: false,
    backupPageOpen: false,
    activeClassId: '',
    battle: null,
    battleBookId: '',
    battlePlayersText: '',
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
      // 素白（默认）走极简黑白；其余彩色主题保留流动装饰
      // 素白只看「强调色 + 背景」实际取值：改强调色后仍保留彩色装饰，不会被整页降级成黑白
      const plainLook = (s.bg || 'default') === 'default';
      root.setAttribute('data-look', plainLook ? 'plain' : 'vivid');
      // 学习卡字号：小 / 标准 / 大 —— 用 CSS 变量统一缩放正面词、背面释义与结构化释文
      const scale = s.studyFont === 's' ? 0.86 : (s.studyFont === 'l' ? 1.18 : 1);
      root.style.setProperty('--sf', String(scale));
      const mv = s.motion === false ? 'off' : (s.motion === 'full' ? 'full' : (s.motion === 'off' ? 'off' : 'calm'));
      root.setAttribute('data-motion', mv === 'full' ? 'on' : mv);
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
    // 动效档位：轻 / 完整 / 关闭（即时生效）
    setFx: function (mode) {
      if (mode !== 'full' && mode !== 'calm' && mode !== 'off') return;
      this.state.settings.motion = mode;
      this.applyTheme();
      this.save();
      this.toast(mode === 'off' ? '已关闭动效' : (mode === 'full' ? '已开启完整动效' : '已切换为轻动效'));
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
        d.privacy.allowInvites = p.allowInvites !== false;
        d.privacy.showInCommunity = p.showInCommunity !== false;
        d.privacy.allowBuyMyCards = p.allowBuyMyCards !== false;
        const pr = (a.profile && typeof a.profile === 'object') ? a.profile : {};
        d.profile = {
          bio: typeof pr.bio === 'string' ? pr.bio : '',
          exp: typeof pr.exp === 'string' ? pr.exp : '',
          school: typeof pr.school === 'string' ? pr.school : ''
        };
        d.blacklist = Array.isArray(a.blacklist)
          ? a.blacklist.filter(function (b) { return b && typeof b.id === 'string'; }).slice(0, 500)
          : [];
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
      this.syncCheckinRewards(true);
    },

    // ---- 连续打卡奖励：达标天数解锁勋章，勋章发补签卡 ----
    syncCheckinRewards: function (silent) {
      if (!FC.checkinStreak || !FC.CHECKIN_BADGES) return false;
      const ck = FC.checkinStreak(this.state, Date.now());
      if (!Array.isArray(this.state.badges)) this.state.badges = [];
      let grant = 0;
      const fresh = [];
      for (let i = 0; i < FC.CHECKIN_BADGES.length; i++) {
        const b = FC.CHECKIN_BADGES[i];
        const id = 'd' + b.days;
        if (ck.longest < b.days || this.state.badges.indexOf(id) >= 0) continue;
        this.state.badges.push(id);
        grant += b.cards;
        fresh.push(b);
      }
      if (!fresh.length) return false;
      this.state.makeupCards = (Number(this.state.makeupCards) || 0) + grant;
      this.save();
      if (!silent) {
        const last = fresh[fresh.length - 1];
        this.toast('解锁勋章「' + last.name + '」· 补签卡 +' + grant);
      }
      return true;
    },

    // ---- 用补签卡补上最近漏掉的一天（把断掉的连击接回来） ----
    useMakeupCard: function () {
      if ((Number(this.state.makeupCards) || 0) <= 0) {
        this.toast('还没有补签卡：连续打卡解锁勋章后可以获得');
        return;
      }
      const map = {};
      for (let i = 0; i < this.state.stats.length; i++) {
        const e = this.state.stats[i];
        if (e && e.date) map[e.date] = e;
      }
      const now = Date.now();
      const okOf = function (k) { return FC.dayCheckin(map[k]).ok; };
      let target = '';
      for (let i = 1; i <= 7; i++) {
        const k = FC.dateKey(now - i * FC.DAY_MS);
        if (!okOf(k)) { target = k; break; }
      }
      if (!target) {
        this.toast('最近一周都打卡了，不需要补签');
        return;
      }
      this.state.stats.push({
        date: target, reviews: 0, passed: 0, timeMs: 0,
        newCount: 0, reviewCount: 0, makeup: true
      });
      this.state.makeupCards = Math.max(0, (Number(this.state.makeupCards) || 0) - 1);
      this.syncCheckinRewards(true);
      this.save();
      this.render();
      this.toast('已补签 ' + target + '，连击接上了');
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

    // ---------------------------------------------------------------- 社区
    // 数据全部在云端（Supabase），本机只做缓存；未登录时社区页显示登录卡。
    communityLoginState: function () {
      if (!this.communityLogin) this.communityLogin = { email: '', code: '', msg: '', error: false };
      return this.communityLogin;
    },
    communityReady: function () {
      return !!(window.FC && FC.Community && FC.Community.session && FC.Community.session());
    },
    openCommunity: function () {
      var page = String((typeof window !== 'undefined' && window.SC_PAGE) || '');
      if (page && page !== 'community') { window.location.href = FC.siteRoot() + 'community/'; return; }
      this.tab = 8;
      this.accountOpen = false;
      this.communityPostId = '';
      this.render();
      this.loadCommunity();
      this.loadInvites();
    },
    // 同桌页 / 社区页共用的 uid 集合：判断「已是同桌」「已发邀请」
    syncDeskmateSets: function () {
      var mates = this.state.deskmates || [];
      var set = {};
      for (var i = 0; i < mates.length; i++) if (mates[i].cloudUid) set[mates[i].cloudUid] = true;
      this.deskmateUidSet = set;
    },
    loadCommunity: function (more) {
      if (!this.communityReady()) return;
      var self = this;
      if (!this.community) this.community = { items: [], loading: false, error: '', loaded: false };
      var c = this.community;
      if (more && !c.items.length) return;
      c.loading = true;
      if (!more) c.error = '';
      this.render();
      var before = more && c.items.length ? c.items[c.items.length - 1].createdAt : '';
      FC.Community.feed(20, before).then(function (rows) {
        var bl = (self.account && self.account.blacklist) || [];
        rows = (rows || []).filter(function (r) {
          for (var k = 0; k < bl.length; k++) if (bl[k].id === r.authorId) return false;
          return true;
        });
        c.items = more ? c.items.concat(rows) : rows;
        c.loading = false; c.error = ''; c.loaded = true;
        // 点赞状态与「已发邀请」状态一并刷新
        var liked = {};
        var me = FC.Community.uid();
        for (var i = 0; i < c.items.length; i++) {
          if ((c.items[i].likeUsers || []).indexOf(me) >= 0) liked[c.items[i].id] = true;
        }
        self.communityLiked = liked;
        self.syncDeskmateSets();
        self.render();
      }).catch(function (e) {
        c.loading = false;
        c.error = FC.Community.humanError(e);
        self.render();
      });
    },
    openPost: function (id) {
      this.communityPostId = id;
      this.communityDetail = { loading: true, post: null, comments: [], error: '' };
      this.render();
      this.loadCommunityDetail();
    },
    loadCommunityDetail: function () {
      var id = this.communityPostId;
      if (!id || !this.communityReady()) return;
      var self = this;
      var d = this.communityDetail || (this.communityDetail = {});
      var post = null;
      var list = (this.community && this.community.items) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) post = list[i];
      FC.Community.comments(id).then(function (rows) {
        d.comments = rows || [];
        d.post = post;
        d.loading = false; d.error = '';
        self.render();
      }).catch(function (e) {
        d.loading = false;
        d.post = post;
        d.error = FC.Community.humanError(e);
        self.render();
      });
    },
    // 收到的同桌邀请（同桌页顶部显示）
    loadInvites: function () {
      var self = this;
      if (!this.inviteInbox) this.inviteInbox = { items: [], loading: false, error: '' };
      if (!this.communityReady()) { this.inviteInbox = { items: [], loading: false, error: '' }; return; }
      var box = this.inviteInbox;
      box.loading = true;
      var done = function () { if (self.tab === 3 || self.tab === 8) self.render(); };
      FC.Community.inbox().then(function (rows) {
        box.items = rows || []; box.loading = false; box.error = ''; done();
      }).catch(function (e) {
        box.loading = false; box.error = FC.Community.humanError(e); done();
      });
      FC.Community.outbox().then(function (rows) {
        var set = {};
        for (var i = 0; i < (rows || []).length; i++) set[rows[i].to_user] = true;
        self.communityOutSet = set;
        self.syncDeskmateSets();
        done();
      }).catch(function () {});
    },
    // ---- 社区登录（与云同步共用同一个 Supabase 会话）----
    communitySendCode: function () {
      var st = this.communityLoginState();
      var el = byId('ccEmail');
      st.email = el ? el.value.trim() : st.email;
      st.msg = ''; st.error = false;
      if (!st.email) { this.toast('先填邮箱'); return; }
      var self = this;
      st.msg = '正在发送…';
      this.render();
      FC.Community.sendCode(st.email).then(function () {
        st.msg = '验证码已发到 ' + st.email + '，去邮箱看一下';
        self.render();
      }).catch(function (e) {
        st.error = true;
        st.msg = '发送失败：' + FC.Community.humanError(e);
        self.render();
      });
    },
    communitySubmitLogin: function () {
      var st = this.communityLoginState();
      var em = byId('ccEmail'), cd = byId('ccCode');
      st.email = em ? em.value.trim() : st.email;
      st.code = cd ? cd.value.trim() : st.code;
      st.msg = ''; st.error = false;
      if (!st.email || !st.code) { this.toast('邮箱和验证码都要填'); return; }
      var self = this;
      st.msg = '正在登录…';
      this.render();
      FC.Community.verifyCode(st.email, st.code).then(function () {
        st.code = ''; st.msg = '';
        self.toast('已登录，可以发帖了');
        self.loadCommunity();
        self.loadInvites();
        self.render();
      }).catch(function (e) {
        st.error = true;
        st.msg = '登录失败：' + FC.Community.humanError(e);
        self.render();
      });
    },
    // ---- 发帖 ----
    openPostComposer: function () {
      if (!this.communityReady()) { this.toast('请先登录'); return; }
      this.openModal({ type: 'community-post' });
    },
    publishPost: function () {
      var g = function (id) { var e = byId(id); return e ? e.value : ''; };
      var title = String(g('cpTitle') || '').trim();
      var body = String(g('cpBody') || '').trim();
      var deckId = String(g('cpDeck') || '');
      if (!body && !deckId) { this.toast('写点内容，或选一个要分享的词库'); return; }
      var deck = null;
      var decks = this.state.decks || [];
      for (var i = 0; i < decks.length; i++) if (decks[i].id === deckId) deck = decks[i];
      var self = this;
      var author = { authorName: this.accountDisplayName(), avatarColor: this.account.avatarColor };
      this.modal = null;
      this.render();
      this.toast(deck ? '正在打包词库并发布…' : '正在发布…');
      var task;
      if (deck) {
        task = FC.Community.uploadDeck(deck).then(function (r) {
          return FC.Community.createPost({
            authorName: author.authorName, avatarColor: author.avatarColor,
            kind: 'resource', title: title, body: body,
            deckName: deck.name, deckWords: r.words,
            resourcePath: r.path, resourceSize: r.size
          });
        });
      } else {
        task = FC.Community.createPost({
          authorName: author.authorName, avatarColor: author.avatarColor,
          kind: 'post', title: title, body: body
        });
      }
      task.then(function () {
        self.toast('已发布');
        self.loadCommunity();
      }).catch(function (e) {
        self.toast('发布失败：' + FC.Community.humanError(e));
      });
    },
    togglePostLike: function (id) {
      if (!this.communityReady()) { this.toast('请先登录'); return; }
      var self = this;
      var liked = !!(this.communityLiked && this.communityLiked[id]);
      if (!this.communityLiked) this.communityLiked = {};
      this.communityLiked[id] = !liked;
      var item = null;
      var list = (this.community && this.community.items) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) item = list[i];
      if (item) item.likeCount = Math.max(0, (item.likeCount || 0) + (liked ? -1 : 1));
      if (this.communityDetail && this.communityDetail.post && this.communityDetail.post.id === id && item) {
        this.communityDetail.post = item;
      }
      this.render();
      FC.Community.like(id, !liked).catch(function (e) {
        self.communityLiked[id] = liked;
        if (item) item.likeCount = Math.max(0, (item.likeCount || 0) + (liked ? 1 : -1));
        self.render();
        self.toast('点赞失败：' + FC.Community.humanError(e));
      });
    },
    deletePost: function (id) {
      var self = this;
      FC.Community.removePost(id).then(function () {
        self.toast('已删除');
        self.communityPostId = '';
        self.loadCommunity();
      }).catch(function (e) { self.toast('删除失败：' + FC.Community.humanError(e)); });
    },
    // ---- 评论 ----
    addPostComment: function () {
      var el = byId('cmtInput');
      var text = el ? el.value.trim() : '';
      if (!text) { this.toast('写点什么再发'); return; }
      var self = this;
      var id = this.communityPostId;
      FC.Community.addComment(id, text, this.accountDisplayName()).then(function () {
        if (el) el.value = '';
        self.loadCommunityDetail();
      }).catch(function (e) { self.toast('评论失败：' + FC.Community.humanError(e)); });
    },
    // ---- 邀请 / 接受同桌 ----
    inviteDeskmate: function (uid, name) {
      if (!this.communityReady()) { this.toast('请先登录'); return; }
      if (this.isBlocked(uid)) { this.toast('该用户在你的黑名单里，先到 设置 › 隐私设置 移出'); return; }
      var self = this;
      FC.Community.invite(uid, '', this.communityPostId, this.accountDisplayName()).then(function () {
        if (!self.communityOutSet) self.communityOutSet = {};
        self.communityOutSet[uid] = true;
        self.render();
        self.toast('已邀请「' + (name || '对方') + '」做同桌，等他/她在同桌页点接受');
      }).catch(function (e) {
        var m = FC.Community.humanError(e);
        self.toast(e.status === 409 ? '已经发过邀请，等对方接受' : '邀请失败：' + m);
      });
    },
    acceptInvite: function (id, name, fromUid) {
      var self = this;
      FC.Community.respond(id, 'accepted').then(function () {
        var mates = self.state.deskmates || (self.state.deskmates = []);
        var exists = false;
        for (var i = 0; i < mates.length; i++) if (fromUid && mates[i].cloudUid === fromUid) exists = true;
        if (!exists) {
          mates.push({ id: FC.makeId(), name: name || '同桌', note: '来自社区', score: 0, days: 0, cloudUid: fromUid || '' });
          self.save();
        }
        self.syncDeskmateSets();
        self.loadInvites();
        self.render();
        self.toast('已和「' + (name || '对方') + '」成为同桌');
      }).catch(function (e) { self.toast('接受失败：' + FC.Community.humanError(e)); });
    },
    declineInvite: function (id) {
      var self = this;
      FC.Community.respond(id, 'declined').then(function () {
        self.loadInvites();
        self.render();
      }).catch(function (e) { self.toast('操作失败：' + FC.Community.humanError(e)); });
    },
    // ---- 导入别人分享的词库 ----
    importSharedDeck: function (path, name) {
      var self = this;
      if (!path) { this.toast('这个帖子没有附词库'); return; }
      this.toast('正在下载「' + (name || '词库') + '」…');
      FC.Community.importShared(path, name).then(function () {
        self.loadCommunity();
      }).catch(function (e) {
        self.toast('导入失败：' + FC.Community.humanError(e));
      });
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
    sideSearch: function () {
      this.tab = 1;
      this.study = null;
      this.render();
      setTimeout(function () {
        var el = document.getElementById('sdQuery');
        if (el) { el.focus(); }
      }, 60);
    },

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
      this.syncCheckinRewards();
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
      // 独立「浏览」页：关闭后回到卡片首页，避免地址栏停在一个空视图上
      if (String((typeof window !== 'undefined' && window.SC_PAGE) || '') === 'browse') {
        window.location.href = FC.siteRoot();
        return;
      }
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
      this.settingsPane = 'account';
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
      // 「个人中心」整页已并入 设置 → 账户与身份
      const page = String((typeof window !== 'undefined' && window.SC_PAGE) || '');
      if (page && page !== 'settings') {
        try { sessionStorage.setItem('sc_set_pane', 'account'); } catch (err) {}
        window.location.href = FC.siteRoot() + 'settings/';
        return;
      }
      this.accountMenuOpen = false;
      this.aiOpen = false; this.cmdOpen = false;
      this.noticePageOpen = false; this.backupPageOpen = false;
      this.modal = null;
      this.accountOpen = false;
      this.seriesId = ''; this.cardManageDeckId = ''; this.activeClassId = '';
      this.study = null; this.wb = null; this.battle = null;
      this.tab = 6;
      this.settingsPane = 'account';
      this.setLoginMsg('');
      this.render();
      try { window.scrollTo(0, 0); } catch (err) {}
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
      this.accountMenuOpen = false;
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
      this.clearLoginDraft();
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
      this.clearLoginDraft();
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
      try { sessionStorage.setItem('sc_login_draft', JSON.stringify(this._loginDraft)); } catch (e) {}
    },
    // 页面重载 / 刷新后把上次填的邮箱、验证码恢复回来
    restoreLoginDraft: function () {
      if (this._loginDraft && Object.keys(this._loginDraft).length) return;
      try {
        const raw = sessionStorage.getItem('sc_login_draft');
        if (!raw) return;
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          this._loginDraft = d;
          if (d.mode === 'phone') this.loginMode = 'phone';
        }
      } catch (e) {}
    },
    clearLoginDraft: function () {
      this._loginDraft = null;
      try { sessionStorage.removeItem('sc_login_draft'); } catch (e) {}
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
        self.verifyPublicId();
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
      const labels = { rememberLogin: '记住登录状态', showNickname: '显示昵称', privacyBlur: '离开窗口时隐藏内容', allowInvites: '接受同桌邀请', showInCommunity: '在社区展示我的资料', allowBuyMyCards: '允许他人换我的卡组' };
      this.toast((labels[key] || '设置') + (p[key] ? '已开启' : '已关闭'));
    },

    // ---- 个人信息（简介/经历/学校）----
    saveProfileInfo: function () {
      const a = this.account;
      if (!a.profile) a.profile = { bio: '', exp: '', school: '' };
      const bio = byId('setBio'), exp = byId('setExp'), sch = byId('setSchool');
      a.profile.bio = bio ? bio.value.trim().slice(0, 200) : '';
      a.profile.exp = exp ? exp.value.trim().slice(0, 500) : '';
      a.profile.school = sch ? sch.value.trim().slice(0, 60) : '';
      this.saveAccount();
      this.render();
      this.toast('个人信息已保存');
    },

    // ---- 黑名单 ----
    isBlocked: function (id) {
      const bl = (this.account && this.account.blacklist) || [];
      for (let i = 0; i < bl.length; i++) if (bl[i].id === id) return true;
      return false;
    },
    blacklistAdd: function (id, name) {
      if (!id) return;
      if (this.isBlocked(id)) { this.toast('已经在黑名单里了'); return; }
      const a = this.account;
      if (!a.blacklist) a.blacklist = [];
      a.blacklist.push({ id: id, name: name || '', at: Date.now() });
      this.saveAccount();
      this.render();
      this.toast('已拉黑「' + (name || '该用户') + '」');
      if (this.community && this.community.items && this.community.items.length) this.loadCommunity();
    },
    blacklistRemove: function (id) {
      const a = this.account;
      if (!a.blacklist) return;
      a.blacklist = a.blacklist.filter(function (b) { return b.id !== id; });
      this.saveAccount();
      this.render();
      this.toast('已移出黑名单');
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
      if (m.type === 'community-post') { this.publishPost(); return; }
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
          const nd = FC.newDeck(fullName, desc);
          this.state.decks.push(nd);
          // 工坊语义：建完牌组直接进到这个空牌组里，马上就能加卡片
          if (this.studio) { this.studio.scope = nd.id; this.studio.sel = ''; this.studio.q = ''; }
          this.toast('牌组已创建，可以添加卡片了');
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
        if (!FC.Classroom || !FC.Classroom.hasSession()) { this.toast('请先登录，再建班'); return; }
        const self = this;
        const form = {
          name: name,
          slogan: (id('mCDesc') || {}).value || '',
          daily_goal: parseInt((id('mCDaily') || {}).value, 10) || 30,
          total_goal: parseInt((id('mCTotal') || {}).value, 10) || 1000,
          max_members: parseInt((id('mCMax') || {}).value, 10) || 50,
          ends_on: (id('mCEnds') || {}).value || null
        };
        this.toast('正在创建班级…');
        FC.Classroom.create(form).then(function (r) {
          if (!r || !r.ok) { self.toast((r && r.msg) || '创建失败，稍后再试'); return; }
          self.modal = null;
          self._clsState = null; self._clsDetail = null;
          self.activeClassId = r.class.id;
          self.render();
          self.toast('班级已建好，密钥 ' + FC.Classroom.fmtKey(r.class.join_key));
        });
      } else if (m.type === 'join') {
        if (!FC.Classroom || !FC.Classroom.hasSession()) { this.toast('请先登录，再加入班级'); return; }
        const code = FC.Classroom.cleanKey(id('mCode').value);
        if (code.length !== 8) { this.toast('密钥是 8 位，别漏字符'); return; }
        const self2 = this;
        FC.Classroom.join(code).then(function (r) {
          if (!r || !r.ok) { self2.toast((r && r.msg) || '加入失败'); return; }
          self2.modal = null;
          self2._clsState = null; self2._clsDetail = null;
          self2.activeClassId = r.class.id;
          self2.render();
          self2.toast(r.already ? ('你已经在「' + r.class.name + '」里了') : ('已加入「' + r.class.name + '」'));
        });
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
      } else if (m.type === 'confirm' && m.action === 'class-leave') {
        const cid = m.classId;
        const self3 = this;
        FC.Classroom.leave(cid).then(function (r) {
          if (!r || !r.ok) { self3.toast((r && r.msg) || '退出失败'); return; }
          self3._clsState = null; self3._clsDetail = null;
          self3.activeClassId = '';
          self3.render();
          self3.toast(r && r.code === 'owner' ? '创建者不能退出班级' : '已退出班级');
        });
      } else if (m.type === 'confirm' && m.action === 'account-clear') {
        this.account = defaultAccount();
        this.saveAccount();
        setPrivacyCover(false);
        this.accountOpen = true;
        this.toast('已清除本机账户数据');
      } else if (m.type === 'confirm' && m.action === 'class-new-key') {
        const cid2 = m.classId;
        const self4 = this;
        FC.Classroom.newKey(cid2).then(function (r) {
          if (!r || !r.ok) { self4.toast((r && r.msg) || '换密钥失败'); return; }
          self4._clsState = null; self4._clsDetail = null;
          self4.render();
          self4.toast('新密钥 ' + FC.Classroom.fmtKey(r.join_key) + '（旧密钥已失效）');
        });
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
      this.tab = isNaN(tab) ? 1 : tab;
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
    // ---- 自定义文件夹 ----
    createFolder: function (moveDeckId) {
      const name = prompt('新建文件夹名称', '新文件夹');
      if (name === null) return;
      const nm = String(name).trim() || '新文件夹';
      const id = FC.addFolder(this.state, nm);
      this.save();
      if (moveDeckId) {
        FC.moveDeckToFolder(this.state, moveDeckId, id);
        this.save();
        this.closeModal();
        this.toast('已新建文件夹并移入牌组');
      } else {
        this.render();
      }
    },
    renameFolder: function (id) {
      const f = FC.folderById(this.state, id);
      if (!f) return;
      const name = prompt('文件夹名称', f.name);
      if (name === null) return;
      FC.renameFolder(this.state, id, String(name).trim() || f.name);
      this.save(); this.render();
    },
    deleteFolder: function (id) {
      const f = FC.folderById(this.state, id);
      if (!f) return;
      if (!confirm('删除文件夹「' + f.name + '」？里面的牌组不会被删除，只是移出文件夹。')) return;
      FC.deleteFolder(this.state, id);
      this.folderId = '';
      this.save(); this.render();
    },
    moveDeckToFolder: function (deckId, folderId) {
      FC.moveDeckToFolder(this.state, deckId, folderId);
      this.save(); this.closeModal();
      this.toast(folderId ? '已移动到文件夹' : '已移出文件夹');
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
      // 素白与流光共用同一组 accent/bg，保存其他设置时不能把当前主题改掉
      if (matchedPreset) {
        for (let pi = 0; pi < plist.length; pi++) {
          if (plist[pi].id === s.preset && plist[pi].accent === s.accent && plist[pi].bg === s.bg) { matchedPreset = s.preset; break; }
        }
      }
      s.preset = matchedPreset || 'custom';

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
      // 账户 ID 后缀：可以自己改，但必须 3 个数字 + 3 个字母；不合规就保留原值
      let idChanged = false;
      if (byId('setIdCode')) {
        const raw = String(byId('setIdCode').value || '').trim();
        const cut = raw.indexOf('__');
        const suf = (cut >= 0 ? raw.slice(cut + 2) : raw).replace(/[^A-Za-z0-9]/g, '');
        if (suf !== (this.account.idSuffix || '')) {
          if (idSuffixValid(suf)) {
            this.account.idSuffix = suf;
            this.saveAccount();
            idChanged = true;
          } else {
            this.toast('ID 后缀要 3 个数字 + 3 个字母，共 6 位');
          }
        }
      }
      this.applyTheme();
      this.save();
      if (idChanged) this.verifyPublicId();
      this.toast('设置已保存');
      this.render();
    },

    // 账户 ID 查重：云端记录过同一个 ID 就自动换一个后缀（未登录 / 断网时静默跳过）
    verifyPublicId: function (tries) {
      const self = this;
      const n = Number(tries) || 0;
      if (n > 3) return Promise.resolve(false);
      if (typeof FC === 'undefined' || !FC.CloudSync || !FC.CloudSync.checkPublicId) return Promise.resolve(true);
      const idt = accountIdentity(self);
      return FC.CloudSync.checkPublicId(idt.code).then(function (r) {
        if (!r || !r.taken) return true;
        self.account.idSuffix = genIdSuffix();
        self.saveAccount();
        self.toast('这个 ID 已被占用，已帮你换成 ' + self.account.idSuffix);
        self.render();
        return self.verifyPublicId(n + 1);
      }).catch(function () { return true; });
    },

    // 随机换一个 ID 后缀（设置页按钮）
    regenPublicId: function () {
      this.account.idSuffix = genIdSuffix();
      this.saveAccount();
      this.toast('已换成 ' + this.account.idSuffix);
      this.render();
      this.verifyPublicId();
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
      // 点选即时生效：写回设置 → 反推匹配到哪套预设 → 重画属性，无需再点保存
      const st = App.state.settings;
      if (r.name === 'accentR') st.accent = r.value; else st.bg = r.value;
      const plist = (typeof FCUI !== 'undefined' && FCUI.THEME_PRESETS) || [];
      let matched = '';
      for (let i = 0; i < plist.length; i++) {
        if (plist[i].accent === (st.accent || 'brand') && plist[i].bg === (st.bg || 'default')) { matched = plist[i].id; break; }
      }
      st.preset = matched || 'custom';
      App.applyTheme();
      App.save();
      const grid = document.querySelector('.preset-grid');
      if (grid) {
        const cards = grid.querySelectorAll('.preset-card');
        for (let i = 0; i < cards.length; i++) cards[i].classList.toggle('on', cards[i].getAttribute('data-id') === st.preset);
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

    // 商铺 / 积分相关交互统一交给 shop.js
    if (act.indexOf('shop-') === 0 && window.SCShop) { window.SCShop.handleAct(act, el, App); return; }

    switch (act) {
      // —— 小星助手 / 命令面板：入口已移除 ——
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
      case 'cmd-close': App.cmdClose(); break;
      case 'cmd-mask': if (e.target === el) App.cmdClose(); break;
      case 'cmd-pick': App.cmdPick(parseInt(d.i, 10)); break;
      case 'tab': {
        // 多页面模式：跳到别的板块就走真实网址，刷新 / 分享都停在当前页
        const t = parseInt(d.tab, 10);
        const dirs = ['', 'books/', 'class/', 'deskmate/', 'battle/', 'stats/'];
        const page = String((typeof window !== 'undefined' && window.SC_PAGE) || '');
        if (page && !isNaN(t) && dirs[t] !== undefined) {
          const here = page === 'cards' ? '' : page + '/';
          if (here !== dirs[t]) { window.location.href = FC.siteRoot() + dirs[t]; break; }
        }
        App.tab = t; App.seriesId = ''; App.cardManageDeckId = ''; App.folderId = ''; App.accountOpen = false; App.activeClassId = ''; App.aiOpen = false; App.cmdOpen = false; App.noticePageOpen = false; App.backupPageOpen = false; App.modal = null; App.render(); break;
      }
      case 'new-deck': App.openModal({ type: 'deck', id: '', name: '', desc: '' }); break;
      case 'deck-open': App.cardManageDeckId = d.id; App.render(); break;
      case 'deck-back': App.cardManageDeckId = ''; App.render(); break;
      case 'folder-new': App.createFolder(); break;
      case 'folder-open': App.folderId = d.id; App.cardManageDeckId = ''; App.seriesId = ''; App.render(); break;
      case 'folder-back': App.folderId = ''; App.render(); break;
      case 'folder-rename': App.renameFolder(d.id); break;
      case 'folder-delete': App.deleteFolder(d.id); break;
      case 'deck-move-menu': App.openModal({ type: 'folder-move', deckId: d.id }); break;
      case 'folder-new-then-move': App.createFolder(d.id); break;
      case 'deck-move': App.moveDeckToFolder(d.id, d.folder || ''); break;
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
          if (App.studio && App.studio.sel === d.id) App.studio.sel = '';
          App.save(); App.render(); App.toast('已删除');
        }
        break;
      }
      case 'side-toggle':
        App.sideHide = !App.sideHide;
        try { localStorage.setItem('scSideHide', App.sideHide ? '1' : '0'); } catch (e) {}
        App.render();
        break;
      // 往当前范围牌组添加卡片（工坊顶部 / 空牌组引导）
      case 'card-new-scope': {
        if (!App.studio) App.studio = { q: '', sel: '', scope: '' };
        let deck = null;
        if (App.studio.scope) {
          for (let i = 0; i < App.state.decks.length; i++) if (App.state.decks[i].id === App.studio.scope) { deck = App.state.decks[i]; break; }
        }
        if (!deck) {
          deck = App.state.decks[0];
          if (!deck) { deck = FC.newDeck('默认牌组', ''); App.state.decks.push(deck); }
        }
        App.openModal({
          type: 'card-v2', id: '', deckId: deck.id, notetype: 'basic',
          fields: { Front: '', Back: '', Extra: '', Source: '' }, tags: [], media: []
        });
        break;
      }
      // —— 工坊（Anki Browser 式）：左列点行 → 右侧内联编辑；保存走 rebuildNote ——
      case 'studio-fflag': {
        if (!App.studio) App.studio = { q: '', sel: '', fflag: 0 };
        App.studio.fflag = parseInt(d.flag, 10) || 0;
        App.render();
        break;
      }
      case 'studio-flag': {
        const fnum = parseInt(d.flag, 10) || 0;
        if (App.studio && App.studio.sel) {
          const rr = App.findCard(App.studio.sel);
          if (rr) { App.pushUndo('标记卡片'); rr.card.flags = fnum; App.save(); App.toast(fnum ? ('已打上旗标 ' + fnum) : '已清除旗标'); }
        }
        App.render();
        break;
      }
      case 'studio-scope-deck':
        if (!App.studio) App.studio = { q: '', sel: '', scope: '' };
        App.studio.scope = d.id || '';
        App.studio.sel = '';
        App.render();
        break;
      case 'studio-row':
        if (!App.studio) App.studio = { q: '', sel: '' };
        App.studio.sel = d.id;
        App.render();
        break;
      case 'studio-save': {
        if (!App.studio) App.studio = { q: '', sel: '' };
        const idv = function (x) { return document.getElementById(x); };
        const type = idv('sdType') ? idv('sdType').value : 'basic';
        const fields = {
          Front: idv('sdFront') ? idv('sdFront').value.trim() : '',
          Back: idv('sdBack') ? idv('sdBack').value.trim() : '',
          Extra: idv('sdExtra') ? idv('sdExtra').value.trim() : '',
          Source: idv('sdSource') ? idv('sdSource').value.trim() : ''
        };
        const tags = (idv('sdTags') ? idv('sdTags').value : '').split(/[,;\s]+/).filter(function (t) { return t !== ''; });
        if (type === 'cloze') {
          if (!FC.hasCloze(fields.Front)) { App.toast('填空文本里需要 {{c1::答案}}'); return; }
          fields.Back = '';
        } else if (!fields.Front || !fields.Back) {
          App.toast('正面和背面都要填');
          return;
        }
        const rr = App.findCard(d.id);
        if (!rr) { App.toast('卡片不存在'); return; }
        App.pushUndo('编辑卡片');
        const noteId = rr.card.noteId || rr.card.id;
        // rebuildNote 会重写字段，原 media 在卡片对象上保留即可（同弹窗编辑链路）
        const cards2 = FC.rebuildNote(rr.deck, noteId, { notetype: type, fields: fields, tags: tags });
        App.save(); App.render();
        App.toast('已保存' + (cards2.length > 1 ? '，生成 ' + cards2.length + ' 张卡片' : ''));
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
      case 'class-new': App.openModal({ type: 'class', name: '', desc: '' }); break;
      case 'class-join': App.openModal({ type: 'join', code: '' }); break;
      case 'class-open': App.activeClassId = d.id; App.render(); break;
      case 'class-login': App.accountOpen = true; App.render(); break;
      case 'class-refresh': App._clsState = null; App._clsDetail = null; App.render(); break;
      case 'class-refresh-detail':
        if (App._clsDetail) delete App._clsDetail[(d && d.id) || App.activeClassId];
        App.render(); break;
      case 'class-copy-key': {
        var k = (d && d.key) || '';
        FC.Classroom.copy(FC.Classroom.fmtKey(k)).then(function (ok) {
          App.toast(ok ? '密钥已复制，发给同学就能加入' : ('密钥是 ' + FC.Classroom.fmtKey(k)));
        });
        break;
      }
      case 'class-new-key':
        App.openModal({ type: 'confirm', title: '换一个新密钥？',
          message: '换完旧密钥立即失效；已经进班的同学不受影响。', action: 'class-new-key', classId: d.id });
        break;
      case 'class-leave':
        App.openModal({ type: 'confirm', title: '退出这个班级？',
          message: '退出后你的学习量不再计入这个班级，之后仍可用密钥重新加入。', action: 'class-leave', classId: d.id });
        break;
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
      // ---- 社区 ----
      case 'community-open': App.openCommunity(); break;
      case 'community-refresh': App.loadCommunity(false); break;
      case 'community-more': App.loadCommunity(true); break;
      case 'community-post': App.openPostComposer(); break;
      case 'community-login-send': App.communitySendCode(); break;
      case 'community-login-submit': App.communitySubmitLogin(); break;
      case 'post-like': App.togglePostLike(d.id); break;
      case 'post-open': App.openPost(d.id); break;
      case 'post-back': App.communityPostId = ''; App.render(); break;
      case 'post-del': App.deletePost(d.id); break;
      case 'post-invite': App.inviteDeskmate(d.id, d.name); break;
      case 'post-import': App.importSharedDeck(d.path, d.name); break;
      case 'comment-add': App.addPostComment(); break;
      case 'invite-accept': App.acceptInvite(d.id, d.name, d.uid); break;
      case 'invite-decline': App.declineInvite(d.id); break;
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
      case 'goto-settings': {
        const page = String((typeof window !== 'undefined' && window.SC_PAGE) || '');
        if (page && page !== 'settings') { window.location.href = FC.siteRoot() + 'settings/'; break; }
        App.gotoSettings(); break;
      }
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
      case 'profile-save': App.saveProfileInfo(); break;
      case 'blacklist-remove': App.blacklistRemove(d.id); break;
      case 'post-block': App.blacklistAdd(d.id, d.name); break;
      case 'privacy-info': App.saveLoginDraft(); App.openModal({ type: 'privacy' }); break;
      case 'account-logout': App.openModal({ type: 'confirm', title: '退出登录', message: '退出后本机学习数据仍会保留，重新登录即可继续使用。', action: 'logout' }); break;
      case 'account-clear': App.openModal({ type: 'confirm', title: '清除本机账户数据', message: '将删除昵称、邮箱、头像与隐私偏好，并退出登录。牌组与学习记录不受影响。', action: 'account-clear' }); break;
      case 'save-settings': App.saveSettings(); break;
      case 'checkin-makeup': App.useMakeupCard(); break;
      // 设置页二级分类：点分类进参数页，返回回到目录
      case 'set-pane': App.settingsPane = d.pane || 'account'; App.render(); try { window.scrollTo(0, 0); } catch (err) {} break;
      case 'set-pane-back': App.settingsPane = 'account'; App.render(); try { window.scrollTo(0, 0); } catch (err) {} break;
      case 'id-regen': App.regenPublicId(); break;
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
        App.settingsPane = 'plan'; App.tab = 6; App.cardManageDeckId = ''; App.accountOpen = false; App.study = null; App.render();
        break;
      case 'modal-ok': App.modalOk(); break;
      case 'modal-cancel': App.closeModal(); break;
      case 'shortcuts-help': App.openModal({ type: 'shortcuts' }); break;
      case 'notice-open': App.openNoticePage(); break;
      case 'side-search': App.sideSearch(); break;
      case 'notice-back': App.closeNoticePage(); break;
      case 'backup-open': App.openBackupPage(); break;
      case 'backup-back': App.closeBackupPage(); break;
      case 'backup-export': App.doExport(null, 'starcard-backup.srcd'); break;
      case 'notice-read': App.markNoticesRead(); break;
      case 'notice-go': if (d.page === 'backup') { App.openBackupPage(); } else { App.noticesGo(parseInt(d.tab, 10)); } break;
      case 'theme-preset': App.applyPreset(d.id); break;
      case 'theme-mode': App.setThemeMode(d.mode); break;
      case 'set-fx': App.setFx(d.fx); break;
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
    // 工坊编辑文本框：随输入自动长高（字多框大，不固定行数）
    if (t.classList && t.classList.contains('sd-ta')) {
      t.style.height = 'auto';
      t.style.height = (t.scrollHeight + 2) + 'px';
    }
    // 工坊编辑器：正面 / 背面改动即时刷新预览
    if (t.id === 'sdFront' || t.id === 'sdBack') {
      const pv = byId(t.id === 'sdFront' ? 'sdPvFront' : 'sdPvBack');
      if (pv) {
        let h = String(t.value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        h = h.replace(/==([^=\n]{1,60})==/g, '<mark class="sd-hl">$1</mark>');
        h = h.replace(/\*\*([^*\n]{1,60})\*\*/g, '<b>$1</b>');
        h = h.replace(/\n/g, '<br/>');
        pv.innerHTML = h || '<i class="sd-pv-empty">（空）</i>';
      }
    }
    // 工坊卡片列表搜索：纯 DOM 过滤，不重绘整个应用（保住焦点与中文输入法）
    if (t.id === 'sdQuery') {
      if (!App.studio) App.studio = { q: '', sel: '' };
      App.studio.q = t.value;
      if (!e.isComposing) App.filterStudio(t.value);
    }
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
    // 工坊范围切换：全部 / 某个牌组（计数与列表同步跟着变）
    if (t.id === 'sdScope') {
      if (!App.studio) App.studio = { q: '', sel: '', scope: '' };
      App.studio.scope = t.value;
      App.studio.sel = '';
      App.studio.q = '';
      App.render();
      return;
    }
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
    // 命令面板与小星输入已移除，键盘事件不再拦截
    // 工坊：Shift+1~7 给选中卡片打旗标，Shift+0 清除（Anki Browser 同款，输入框内不拦截）
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && App.tab === 1 && !App.study && App.studio && App.studio.sel) {
      const m = /^Digit([0-9])$/.exec(e.code || '');
      if (m) {
        const fv = parseInt(m[1], 10);
        if (fv <= 7) {
          e.preventDefault();
          const rr = App.findCard(App.studio.sel);
          if (rr) { App.pushUndo('标记卡片'); rr.card.flags = fv; App.save(); App.toast(fv ? ('已打上旗标 ' + fv) : '已清除旗标'); App.render(); }
          return;
        }
      }
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
  // 多页面入口：各页 HTML 用 window.SC_PAGE 声明首屏显示哪一块，避免每次都从卡片页开始
  (function applyPageEntry() {
    var page = String((typeof window !== 'undefined' && window.SC_PAGE) || '').toLowerCase();
    var TABS = { books: 1, 'class': 2, deskmate: 3, battle: 4, stats: 5, settings: 6, store: 7, community: 8 };
    if (Object.prototype.hasOwnProperty.call(TABS, page)) {
      App.tab = TABS[page];
      App.accountOpen = false;
      App.accountMenuOpen = false;
      App.seriesId = '';
      App.cardManageDeckId = '';
      App.folderId = '';
      App.activeClassId = '';
      App.browser = null;
      if (page === 'settings') {
        try {
          var wantPane = sessionStorage.getItem('sc_set_pane');
          if (wantPane) { App.settingsPane = wantPane; sessionStorage.removeItem('sc_set_pane'); }
        } catch (err) {}
      }
    } else if (page === 'browse') {
      App.browser = { query: '', deckId: '', sortKey: 'due', sortDir: 'desc', selected: {}, previewId: '', limit: 300 };
      App.modal = null;
    }
  })();
  // 恢复会话后按绝对到期时间补算（静默，由紧随的 render 统一呈现，避免二次重绘闪烁）
  if (App.study && App.studyActive) App.resumeStudyRuntime({ silent: true });
  App.render();
  // 社区：首屏按需拉数据（未登录 / 离线时自动跳过，不产生任何请求）
  // 必须等 cloudsync.js / community.js 解析完（它们在 app.js 之后引入），
  // 所以挂到 DOMContentLoaded 上，而不是在这里立即执行。
  function bootCommunity() {
    if (!window.FC || !FC.Community) return;
    var page = String((typeof window !== 'undefined' && window.SC_PAGE) || '').toLowerCase();
    App.syncDeskmateSets();
    App.loadInvites();
    if (page === 'community') App.loadCommunity();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootCommunity);
  else setTimeout(bootCommunity, 0);

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
      fetch(FC.assetUrl(encodeURIComponent(name))).then(function (r) {
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
  // 设置页左栏搜索：内联 oninput 在闭包外，拿不到 App，这里挂一个薄桥
  window.scFilterSettings = function (q) { try { App.filterSettings(q); } catch (e) {} };

  // 登录表单输入即落盘：任何重载 / 刷新都不会吞掉已填的邮箱与验证码
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (t && t.id && /^login(Email|Phone|Code|Password|Nick)$/.test(t.id)) {
      try { App.saveLoginDraft(); } catch (x) {}
    }
  });
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.id === 'loginAgree') { try { App.saveLoginDraft(); } catch (x) {} }
  });
  App.restoreLoginDraft();

  // 在线环境下异步校验云端登录会话（离线不触发网络请求）
  App.restoreCloudSession();
})();

