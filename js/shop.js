/* ============================================================
   闪星卡 StarCard · 商铺 v2（js/shop.js）
   ------------------------------------------------------------
   结构：
   1) 积分账本：学习产生积分（获得 / 消耗），余额可花。仍存本机。
   2) 商城：官方词库 + 同学上架的作品，横向滑动浏览。
   3) 我的：我的作品（可编简介 / 详细介绍 / 改价 / 下架）+ 我关注的人。
   4) 社交：作品可点赞，作者可关注。落在 Supabase（store_decks / shop_likes / shop_follows）。
   ============================================================ */
(function () {
  'use strict';
  var FC = window.FC || (window.FC = {});

  var K_LEDGER = 'starcard-points-v1';
  var K_SHOP = 'starcard-shop-v1';
  var MAX_LOG = 160;

  function readJSON(k, def) {
    try {
      var v = JSON.parse(localStorage.getItem(k) || 'null');
      return (v && typeof v === 'object') ? v : def;
    } catch (e) { return def; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateStr(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function monthKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  /* ---------------- 官方词库商品 ---------------- */
  var OFFICIAL = [
    { id: 'off-sat800', title: 'SAT 800 美音', file: 'SAT800美音.srcd', price: 120, tone: 'blue', tag: '词库', desc: 'SAT 高频 800 词，附美式音标与释义' },
    { id: 'off-turn', title: 'SAT 转折词', file: 'SAT转折词.srcd', price: 60, tone: 'purple', tag: '词库', desc: '转折、让步逻辑词专练，阅读提速' },
    { id: 'off-jijing', title: 'SAT 鸡精词汇', file: 'SAT鸡精词汇.srcd', price: 90, tone: 'amber', tag: '词库', desc: '真题高频还原，冲刺期的词表' },
    { id: 'off-toefl', title: 'TOEFL 托福', file: 'TOEFL托福.srcd', price: 180, tone: 'cyan', tag: '词库', desc: '托福核心词库，听说读写通用' },
    { id: 'off-writing', title: '黄金写作书', file: '黄金写作书.srcd', price: 80, tone: 'pink', tag: '词库', desc: '写作高分表达与句式' }
  ];

  var TONES = ['blue', 'purple', 'amber', 'cyan', 'pink', 'green'];

  /* ---------------- 积分账本 ---------------- */
  function blankLedger() { return { v: 1, earned: 0, spent: 0, log: [] }; }

  function ledger() {
    var L = readJSON(K_LEDGER, null);
    if (!L || L.v !== 1) L = blankLedger();
    if (!Array.isArray(L.log)) L.log = [];
    L.earned = Number(L.earned) || 0;
    L.spent = Number(L.spent) || 0;
    return L;
  }

  function pushLog(L, delta, kind, note) {
    L.log.unshift({ ts: Date.now(), delta: delta, kind: kind, note: note });
    if (L.log.length > MAX_LOG) L.log.length = MAX_LOG;
  }

  function sync(app) {
    var L = ledger();
    var ach = null;
    try {
      ach = window.FCUI.achievementInfo(app, window.FCUI.levelInfo(app), window.FCUI.streakStat(app));
    } catch (e) { ach = null; }
    var target = ach ? Number(ach.points) || 0 : 0;
    if (target > L.earned) {
      var delta = target - L.earned;
      L.earned = target;
      pushLog(L, delta, 'earn', '学习奖励 · 复习 ' + ach.reviews + ' 次 / 学习 ' + ach.days + ' 天 / 勋章 ' + ach.gotCount + ' 枚');
      writeJSON(K_LEDGER, L);
    }
    return L;
  }

  function balance(app) {
    var L = sync(app);
    var b = L.earned - L.spent;
    return b > 0 ? b : 0;
  }

  function monthStats(L) {
    var mk = monthKey(Date.now());
    var earn = 0, spend = 0;
    for (var i = 0; i < L.log.length; i++) {
      var e = L.log[i];
      if (!e || !e.ts || monthKey(e.ts) !== mk) continue;
      if (e.kind === 'spend') spend += Math.abs(Number(e.delta) || 0);
      else earn += Number(e.delta) || 0;
    }
    return { earn: earn, spend: spend };
  }

  /* ---------------- 本机小账本（已购 / 旧版本机作品） ---------------- */
  function shopData() {
    var S = readJSON(K_SHOP, null);
    if (!S || S.v !== 1) S = { v: 1, items: [], owned: [] };
    if (!Array.isArray(S.items)) S.items = [];
    if (!Array.isArray(S.owned)) S.owned = [];
    return S;
  }

  function ownedMap() {
    var S = shopData();
    var m = {};
    for (var i = 0; i < S.owned.length; i++) {
      if (S.owned[i] && S.owned[i].id) m[S.owned[i].id] = 1;
    }
    return m;
  }

  function markOwned(id) {
    var S = shopData();
    for (var i = 0; i < S.owned.length; i++) if (S.owned[i] && S.owned[i].id === id) return;
    S.owned.push({ id: id, at: Date.now() });
    writeJSON(K_SHOP, S);
  }

  function legacyItems() {
    var S = shopData();
    var out = [];
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i] && S.items[i].status !== 'off') out.push(S.items[i]);
    }
    return out;
  }

  /* ---------------- 官方商品内容 ---------------- */
  function loadOfficial(item) {
    if (!item.file) return Promise.reject(new Error('商品没有内容'));
    var url = (FC.assetUrl ? FC.assetUrl(encodeURIComponent(item.file)) : item.file);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('词库下载失败（HTTP ' + r.status + '）');
      return r.text();
    });
  }

  /* ============================================================
     云端：商城 / 点赞 / 关注（Supabase RPC）
     ============================================================ */
  function readCfg() {
    var c = (FC.CLOUD_SYNC_CONFIG || {});
    return { base: String(c.url || '').replace(/\/+$/, ''), anon: String(c.anonKey || '') };
  }

  function available() {
    var c = readCfg();
    return !!(c.base && c.anon && typeof fetch !== 'undefined');
  }

  function session() {
    try {
      if (FC.CloudSync && FC.CloudSync.getSession) return FC.CloudSync.getSession();
    } catch (e) {}
    return null;
  }

  function hasSession() { return !!(session() && session().access_token); }

  // allowAnon=true 时，未登录也能拉公开列表
  function rpc(fn, body, allowAnon) {
    var c = readCfg();
    if (!c.base || !c.anon) return Promise.resolve({ ok: false, code: 'offline', msg: '云服务未配置' });
    var s = session();
    var token = (s && s.access_token) ? s.access_token : '';
    if (!token && !allowAnon) return Promise.resolve({ ok: false, code: 'no_auth', msg: '先登录一下' });

    var headers = {
      'apikey': c.anon,
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return fetch(c.base + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: headers, body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) return { ok: false, code: 'no_auth', msg: '登录已过期，重新登录一下' };
          return { ok: false, code: 'http_' + r.status, msg: (d && (d.message || d.msg)) || ('HTTP ' + r.status) };
        }
        return (d && typeof d === 'object') ? d : { ok: false, code: 'empty', msg: '服务端没有返回数据' };
      });
    }).catch(function (e) {
      return { ok: false, code: 'network', msg: (e && e.message) || '网络不可用' };
    });
  }

  /* ---------------- 缓存 ---------------- */
  function storeState(app) {
    return app._shopStore || (app._shopStore = { list: null, loading: false, err: null });
  }
  function mineState(app) {
    return app._shopMine || (app._shopMine = { data: null, loading: false, err: null });
  }

  function ensureStore(app, force) {
    var st = storeState(app);
    if (st.loading || st.list !== null) return st;
    if (st.err && !force) return st;
    st.loading = true;
    rpc('shop_list', { p_limit: 40 }, true).then(function (r) {
      st.loading = false;
      if (r && r.ok) { st.list = r.items || []; st.tries = 0; }
      else if (r && r.code === 'offline' && (st.tries = (st.tries || 0) + 1) <= 6) {
        // 页面刚起来时配置可能还没挂上，等一拍再试
        st.err = null;
        setTimeout(function () { app.render(); }, 400);
        return;
      } else {
        st.err = (r && r.msg) || '商城没加载出来';
      }
      app.render();
    });
    return st;
  }

  function ensureMine(app, force) {
    var st = mineState(app);
    if (st.loading) return st;
    if (st.data && !force) return st;
    if (st.err && st.err !== 'no_auth' && !force) return st;
    if (!hasSession()) { st.data = null; st.err = 'no_auth'; st.loading = false; return st; }
    st.loading = true; st.err = null;
    rpc('shop_mine', {}, false).then(function (r) {
      st.loading = false;
      if (r && r.ok) st.data = r;
      else st.err = (r && r.code === 'no_auth') ? 'no_auth' : ((r && r.msg) || '加载失败');
      app.render();
    });
    return st;
  }

  /* ---------------- 旧的本机作品：登录后自动搬到云端 ---------------- */
  function migrateLegacy(app) {
    var S = shopData();
    if (S.migrated) return;
    var items = legacyItems();
    if (!items.length) { S.migrated = true; writeJSON(K_SHOP, S); return; }
    if (!hasSession()) return;

    S.migrated = true;
    writeJSON(K_SHOP, S);

    var done = 0;
    items.forEach(function (it) {
      rpc('shop_publish', {
        p_title: it.title,
        p_intro: it.desc || '',
        p_detail: '',
        p_price: Number(it.price) || 60,
        p_category: '词库',
        p_card_count: Number(it.count) || 0,
        p_content: it.payload || ''
      }, false).then(function () {
        done++;
        if (done === items.length) {
          var S2 = shopData();
          S2.items = [];
          writeJSON(K_SHOP, S2);
          if (app.toast) app.toast('已把 ' + items.length + ' 件本机作品搬到云上');
          mineState(app).data = null;
          app.render();
        }
      });
    });
  }

  /* ============================================================
     页面渲染
     ============================================================ */
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var icon = function () { return ''; };

  var HEART_FILL = '<path d="M12 20.6 4.2 12.8a5 5 0 0 1 0-7.1 5 5 0 0 1 7.1 0l.7.7.7-.7a5 5 0 0 1 7.1 0 5 5 0 0 1 0 7.1Z" fill="currentColor"/>';
  var HEART_LINE = '<path d="M12 20.2 4.6 12.8a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.9.9.9-.9a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>';

  function heart(filled, size) {
    return '<svg class="ic ' + (size || 'i14') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (filled ? HEART_FILL : HEART_LINE) + '</svg>';
  }

  function ready() {
    if (window.FCUI) {
      if (window.FCUI.esc) esc = window.FCUI.esc;
      if (window.FCUI.icon) icon = window.FCUI.icon;
    }
  }

  function avaColor(n) {
    var tones = ['blue', 'purple', 'amber', 'cyan', 'pink', 'green'];
    var i = Number(n) || 0;
    return tones[Math.abs(i) % tones.length];
  }

  function toneOf(item, idx) {
    if (item.tone) return item.tone;
    if (item.official) return item.tone || 'blue';
    return TONES[(idx || 0) % TONES.length];
  }

  function initial(name) {
    var s = String(name || '同').trim();
    return s ? s.slice(0, 1) : '同';
  }

  /* ---------------- 顶部 ---------------- */
  function headerHtml(app, L) {
    var bal = Math.max(0, L.earned - L.spent);
    var m = monthStats(L);
    return '<header class="topbar"><div class="tb-main">' +
      '<div class="topbar-t"><h1>商铺</h1></div>' +
      '<p>换词库 · 逛同学的作品</p></div>' +
      '<div class="shp-balance">' +
      '<b>' + bal + '</b><span>积分</span>' +
      '<em>本月 +' + m.earn + ' / −' + m.spend + '</em>' +
      '</div></header>';
  }

  function switchHtml(tab) {
    var t = (tab === 'mine' || tab === 'ledger') ? tab : 'store';
    return '<div class="shp-switch">' +
      '<button class="shp-tab' + (t === 'store' ? ' on' : '') + '" data-act="shop-goto" data-tab="store">商城</button>' +
      '<button class="shp-tab' + (t === 'mine' ? ' on' : '') + '" data-act="shop-goto" data-tab="mine">我的</button>' +
      '<button class="shp-tab' + (t === 'ledger' ? ' on' : '') + '" data-act="shop-goto" data-tab="ledger">积分明细</button>' +
      '</div>';
  }

  /* ---------------- 商品卡 ---------------- */
  function cardHtml(item, idx) {
    var tone = toneOf(item, idx);
    var mark = item.official ? '官' : '作';
    var ico = item.official ? 'book' : 'layers';
    var likes = Number(item.likes) || 0;
    return '<button class="shp-card" data-act="shop-open" data-id="' + esc(item.id) + '" data-kind="' + (item.official ? 'off' : 'cloud') + '">' +
      '<div class="shp-cover t-' + tone + '">' +
      '<span class="shp-mark">' + mark + '</span>' +
      heart(!!item.liked, 'i13') +
      icon(ico, 'i30') +
      '</div>' +
      '<div class="shp-cbody">' +
      '<b class="shp-ctitle">' + esc(item.title) + '</b>' +
      '<p class="shp-cdesc">' + esc(item.intro || item.desc || '') + '</p>' +
      '<div class="shp-cfoot">' +
      '<span class="shp-price">' + (Number(item.price) || 0) + '<i>积分</i></span>' +
      '<span class="shp-likes">' + heart(likes > 0 || item.liked, 'i12') + likes + '</span>' +
      '</div></div></button>';
  }

  function railHtml(title, sub, cards, emptyText) {
    var inner = cards || (emptyText
      ? '<div class="shp-rail-empty">' + esc(emptyText) + '</div>'
      : '');
    return '<div class="shp-shelf">' +
      '<div class="shp-shelf-h"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="shp-rail">' + inner + '</div></div>';
  }

  /* ---------------- 商城 ---------------- */
  function storePane(app) {
    var st = ensureStore(app);
    var cards = '';

    // 官方
    var officialCards = '';
    for (var i = 0; i < OFFICIAL.length; i++) {
      var o = OFFICIAL[i];
      officialCards += cardHtml({
        id: o.id, title: o.title, intro: o.desc, price: o.price,
        tone: o.tone, official: true, likes: 0, liked: false
      }, i);
    }

    // 同学的作品
    var cloudCards = '';
    if (st.err && st.err !== 'no_auth') {
      cloudCards = '<div class="shp-rail-empty">' + esc(st.err) + '</div>';
    } else if (st.list === null) {
      cloudCards = '<div class="shp-rail-empty">正在加载…</div>';
    } else if (!st.list.length) {
      cloudCards = '<div class="shp-rail-empty">还没有人上架。你可以是第一个。</div>';
    } else {
      for (var j = 0; j < st.list.length; j++) {
        cloudCards += cardHtml(st.list[j], j + 2);
      }
    }

    var owned = ownedMap();
    var ownedCount = 0;
    for (var k in owned) if (owned[k]) ownedCount++;

    cards = railHtml('官方精选', OFFICIAL.length + ' 件 · 左右滑动看全部', officialCards) +
      railHtml('同学的店', (st.list === null ? '正在加载' : st.list.length + ' 件') + ' · 点开可以点赞 / 关注作者', cloudCards) +
      '<div class="shp-tip">' + icon('info', 'i14') +
      '<span>积分靠学习攒：复习 1 次 +1，学习 1 天 +10，每枚勋章 +20。买下的词库直接并入「词书」。</span></div>' +
      (ownedCount ? '<div class="shp-owned-hint">已拥有 ' + ownedCount + ' 件，在商城卡片上点开可以重新导入。</div>' : '');

    return cards;
  }

  /* ---------------- 我的 ---------------- */
  function minePane(app) {
    if (!available()) {
      return '<div class="shp-blank">' + icon('cloud', 'i26') + '<b>云服务没配置</b><small>上架和点赞需要连接云端，先在配置里填好地址与密钥。</small></div>';
    }
    if (!hasSession()) {
      return '<div class="shp-blank">' + icon('user', 'i26') +
        '<b>登录后才能上架和看自己的作品</b>' +
        '<small>作品、点赞、关注都挂在账号上，换设备也能看到。</small>' +
        '<button class="btn btn-primary" data-act="shop-login">' + icon('key', 'i14') + '去登录</button></div>';
    }

    migrateLegacy(app);
    var st = ensureMine(app);
    var d = st.data || {};
    var stats = d.stats || {};
    var items = d.items || [];
    var following = d.following_list || [];

    var statsHtml = '<div class="shp-mystats">' +
      '<div><b>' + (stats.decks || 0) + '</b><span>在售作品</span></div>' +
      '<div><b>' + (stats.likes || 0) + '</b><span>获赞</span></div>' +
      '<div><b>' + (stats.followers || 0) + '</b><span>关注者</span></div>' +
      '</div>';

    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var tone = TONES[i % TONES.length];
      var off = it.status !== 'published';
      rows += '<div class="shp-mine-row' + (off ? ' off' : '') + '">' +
        '<span class="shp-thumb t-' + tone + '">' + icon('layers', 'i16') + '</span>' +
        '<span class="shp-mrow-main"><b>' + esc(it.title) + '</b>' +
        '<small>' + (it.card_count || 0) + ' 张 · ' + (it.sales || 0) + ' 人换过 · ' +
        heart(it.likes > 0, 'i11') + (it.likes || 0) + (off ? ' · 已下架' : '') + '</small></span>' +
        '<span class="shp-mrow-price">' + (it.price || 0) + '<i>积分</i></span>' +
        '<span class="shp-mrow-acts">' +
        '<button class="btn btn-sm" data-act="shop-edit" data-id="' + esc(it.id) + '">编辑</button>' +
        (off
          ? '<button class="btn btn-sm btn-primary" data-act="shop-relist" data-id="' + esc(it.id) + '">重新上架</button>'
          : '<button class="btn btn-sm" data-act="shop-delist" data-id="' + esc(it.id) + '">下架</button>') +
        '</span></div>';
    }
    if (!rows) rows = '<div class="shp-blank small">' + icon('layers', 'i24') +
      '<b>还没有作品</b><small>把「词书」里的一套牌组挂上来，写上简介，别人就能用积分换。</small></div>';

    var frows = '';
    for (var j = 0; j < following.length; j++) {
      var f = following[j];
      var a = f.author || {};
      frows += '<div class="shp-follow-row">' +
        '<span class="shp-ava t-' + avaColor(a.color) + '">' + esc(initial(a.name)) + '</span>' +
        '<span class="shp-frow-main"><b>' + esc(a.name || '同学') + '</b>' +
        '<small>' + (f.decks || 0) + ' 件作品</small></span>' +
        '<button class="btn btn-sm" data-act="shop-follow" data-user="' + esc(a.id) + '">已关注</button></div>';
    }

    return '<div class="shp-mine-top">' + statsHtml +
      '<button class="btn btn-primary btn-block" data-act="shop-new">' + icon('upload', 'i14') + '上架新作品</button>' +
      '</div>' +
      '<div class="shp-sec-h">我的作品<span>' + items.length + ' 件</span></div>' +
      rows +
      (following.length
        ? '<div class="shp-sec-h">我关注的人<span>' + following.length + ' 位</span></div>' + frows
        : '');
  }

  /* ---------------- 积分明细 ---------------- */
  function ledgerPane(app, L) {
    var bal = Math.max(0, L.earned - L.spent);
    var m = monthStats(L);
    var rows = '';
    var n = 0;
    for (var i = 0; i < L.log.length && n < 60; i++) {
      var e = L.log[i];
      if (!e) continue;
      n++;
      var d = Number(e.delta) || 0;
      rows += '<div class="sht-row">' +
        '<i>' + dateStr(e.ts) + '</i>' +
        '<i class="' + (d < 0 ? 'neg' : 'pos') + '">' + (d > 0 ? '+' : '') + d + '</i>' +
        '<i>' + esc(e.note || (d > 0 ? '学习奖励' : '积分消耗')) + '</i></div>';
    }
    if (!rows) rows = '<div class="sht-empty">还没有积分记录。去学几张卡，这里就会开始进账。</div>';

    return '<div class="shop-panel">' +
      '<div class="shop-stat">' +
      '<div><b>' + bal + '</b><span>当前余额</span></div>' +
      '<div><b>' + m.earn + '</b><span>本月获取</span></div>' +
      '<div><b>' + m.spend + '</b><span>本月消耗</span></div>' +
      '</div>' +
      '<div class="shp-sec-h">收支明细</div>' +
      '<div class="sh-table"><div class="sht-head"><i>时间</i><i>积分</i><i>概述</i></div>' +
      '<div class="sht-body">' + rows + '</div></div>' +
      '<div class="shp-tip">' + icon('info', 'i14') +
      '<span>积分自动结算：复习 1 次 +1，学习 1 天 +10，每点亮一枚勋章 +20。积分只用于商铺兑换。</span></div>' +
      '</div>';
  }

  /* ---------------- 详情弹层 ---------------- */
  function findStoreItem(app, id) {
    var st = storeState(app);
    if (st.list) for (var i = 0; i < st.list.length; i++) if (st.list[i].id === id) return st.list[i];
    for (var j = 0; j < OFFICIAL.length; j++) if (OFFICIAL[j].id === id) return {
      id: OFFICIAL[j].id, title: OFFICIAL[j].title, intro: OFFICIAL[j].desc,
      price: OFFICIAL[j].price, tone: OFFICIAL[j].tone, official: true,
      likes: 0, liked: false, card_count: 0
    };
    return null;
  }

  function sheetHtml(app) {
    var sheet = app._shopSheet;
    if (!sheet) return '';

    if (sheet.type === 'publish' || sheet.type === 'edit') return formSheet(app, sheet);

    var it = sheet.item || findStoreItem(app, sheet.id);
    if (!it) return '';

    var owned = ownedMap()[it.id];
    var mine = !!it.mine;
    var tone = toneOf(it, 0);
    var a = it.author || { name: '官方精选', color: 0 };
    var likes = Number(it.likes) || 0;
    var detail = String(it.detail || '');
    var tags = it.tags || [];

    var authorRow = it.official
      ? '<div class="shp-author"><span class="shp-ava t-blue">' + icon('shield', 'i15') + '</span>' +
      '<span class="shp-ava-main"><b>官方精选</b><small>闪星卡团队整理</small></span></div>'
      : '<div class="shp-author">' +
      '<span class="shp-ava t-' + avaColor(a.color) + '">' + esc(initial(a.name)) + '</span>' +
      '<span class="shp-ava-main"><b>' + esc(a.name || '同学') + '</b>' +
      '<small>' + (it.author_stats ? (it.author_stats.decks || 0) + ' 件作品 · ' + (it.author_stats.followers || 0) + ' 位关注者' : '') + '</small></span>' +
      (mine ? '' :
        '<button class="btn btn-sm' + (it.following ? '' : ' btn-primary') + '" data-act="shop-follow" data-user="' + esc(a.id) + '">' +
        (it.following ? '已关注' : '关注') + '</button>') +
      '</div>';

    var tagHtml = '';
    if (tags && tags.length) {
      for (var t = 0; t < tags.length; t++) tagHtml += '<span class="shp-chip">' + esc(tags[t]) + '</span>';
    }

    var actions = '';
    if (it.official) {
      actions = (owned
        ? '<button class="btn" data-act="shop-reimport" data-id="' + esc(it.id) + '">重新导入词书</button>'
        : '<button class="btn btn-primary btn-block" data-act="shop-buy" data-id="' + esc(it.id) + '">用 ' + it.price + ' 积分换</button>');
    } else if (mine) {
      actions = '<button class="btn btn-primary" data-act="shop-edit" data-id="' + esc(it.id) + '">编辑这件作品</button>';
    } else {
      actions = '<button class="btn btn-primary" data-act="shop-buy" data-id="' + esc(it.id) + '">用 ' + it.price + ' 积分换</button>';
    }

    return '<div class="shp-mask" data-act="shop-close"></div>' +
      '<div class="shp-sheet-hold"><div class="shp-sheet">' +
      '<div class="shp-grab"></div>' +
      '<div class="shp-detail-top">' +
      '<div class="shp-cover big t-' + tone + '"><span class="shp-mark">' + (it.official ? '官' : '作') + '</span>' +
      icon(it.official ? 'book' : 'layers', 'i30') + '</div>' +
      '<div class="shp-dt-main"><b>' + esc(it.title) + '</b>' +
      '<span class="shp-dt-meta">' + (it.card_count ? it.card_count + ' 张 · ' : '') + (it.sales || 0) + ' 人换过</span>' +
      '<span class="shp-likes big">' + heart(likes > 0, 'i13') + '<b>' + likes + '</b><i>赞</i></span>' +
      '</div></div>' +
      authorRow +
      '<div class="shp-intro">' + esc(it.intro || '这套作品还没写简介。') + '</div>' +
      (detail ? '<div class="shp-detail">' + esc(detail).replace(/\n/g, '<br>') + '</div>' : '') +
      (tagHtml ? '<div class="shp-chips">' + tagHtml + '</div>' : '') +
      '<div class="shp-actbar">' +
      '<button class="shp-like' + (it.liked ? ' on' : '') + '" data-act="shop-like" data-id="' + esc(it.id) + '">' +
      heart(it.liked, 'i18') + '<span>' + (it.liked ? '已赞' : '点赞') + '</span></button>' +
      actions + '</div>' +
      '<button class="shp-close" data-act="shop-close">' + icon('x', 'i16') + '</button>' +
      '</div></div>';
  }

  function formSheet(app, sheet) {
    var decks = (app.state && app.state.decks) || [];
    var isEdit = sheet.type === 'edit';
    var it = isEdit ? (sheet.item || {}) : {};
    var opts = '';
    for (var i = 0; i < decks.length; i++) {
      opts += '<option value="' + esc(decks[i].id) + '">' + esc(decks[i].name) + '（' + (decks[i].cards || []).length + ' 张）</option>';
    }
    if (!isEdit && !decks.length) {
      return '<div class="shp-mask" data-act="shop-close"></div>' +
        '<div class="shp-sheet-hold"><div class="shp-sheet">' +
        '<div class="shp-grab"></div>' +
        '<div class="shp-blank small">' + icon('layers', 'i24') + '<b>没有可上架的牌组</b>' +
        '<small>先去「词书」导入或新建一套牌组，再回来挂上去。</small></div>' +
        '<button class="shp-close" data-act="shop-close">' + icon('x', 'i16') + '</button></div></div>';
    }

    return '<div class="shp-mask" data-act="shop-close"></div>' +
      '<div class="shp-sheet-hold"><div class="shp-sheet">' +
      '<div class="shp-grab"></div>' +
      '<div class="shp-sheet-h">' + (isEdit ? '编辑作品' : '上架新作品') + '</div>' +
      '<div class="shp-form">' +
      (isEdit ? '' :
        '<label class="shp-field"><span>选一套牌组</span>' +
        '<select id="shpDeck" class="set-select">' + opts + '</select></label>') +
      '<label class="shp-field"><span>作品名</span>' +
      '<input id="shpTitle" class="set-num" style="width:100%" maxlength="40" placeholder="例如：雅思高频 900 词" value="' + esc(it.title || '') + '" /></label>' +
      '<label class="shp-field"><span>一句话简介</span>' +
      '<input id="shpIntro" class="set-num" style="width:100%" maxlength="120" placeholder="这套牌适合谁、怎么用" value="' + esc(it.intro || '') + '" /></label>' +
      '<label class="shp-field"><span>详细介绍</span>' +
      '<textarea id="shpDetail" class="shp-textarea" rows="5" maxlength="4000" placeholder="分了几个话题、每天刷多少、配了什么例子…">' + esc(it.detail || '') + '</textarea></label>' +
      '<label class="shp-field"><span>定价（积分）</span>' +
      '<input id="shpPrice" class="set-num" type="number" min="0" max="999" style="width:120px" value="' + esc(isEdit ? (it.price || 0) : 60) + '" /></label>' +
      '<div class="shp-form-note">上架后会出现在「商城」，别人点开能看到简介和详细介绍，可以点赞、关注你。</div>' +
      '<div class="shp-form-acts">' +
      '<button class="btn" data-act="shop-close">取消</button>' +
      '<button class="btn btn-primary" data-act="' + (isEdit ? 'shop-save-edit' : 'shop-save-publish') + '" data-id="' + esc(it.id || '') + '">' +
      (isEdit ? '保存修改' : '上架') + '</button></div></div>' +
      '<button class="shp-close" data-act="shop-close">' + icon('x', 'i16') + '</button>' +
      '</div></div>';
  }

  /* ---------------- 主渲染 ---------------- */
  function render(app) {
    ready();
    var L = sync(app);
    var tab = app.shopTab || 'store';
    var body = '';
    if (tab === 'ledger') body = ledgerPane(app, L);
    else if (tab === 'mine') body = minePane(app);
    else body = storePane(app);

    var html = headerHtml(app, L) +
      '<div class="content shop-content">' + switchHtml(tab) + body + '</div>' +
      sheetHtml(app);

    return html + ((window.FCUI && window.FCUI.tabbarHtml) ? window.FCUI.tabbarHtml(app.tab, app) : '');
  }

  /* ============================================================
     购买 / 上架 / 社交
     ============================================================ */
  function toast(app, msg) { if (app && app.toast) app.toast(msg); }

  function importSrcd(app, text) {
    var dec = FC.SrcdCodec.decode(text);
    var merged = FC.SrcdCodec.merge(app.state, dec, false);
    app.state = merged.state;
    app.save();
    return merged.summary || {};
  }

  function buyItem(app, item) {
    var price = Number(item.price) || 0;
    var bal = balance(app);
    if (bal < price) return Promise.resolve({ ok: false, msg: '积分不够，还差 ' + (price - bal) + ' 分（多复习几天就能攒到）' });

    var getText = item.official
      ? loadOfficial(item)
      : rpc('shop_get', { p_id: item.id }, false).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.msg) || '拿不到作品内容');
        return r.content;
      });

    return getText.then(function (text) {
      var summary = importSrcd(app, text);

      // 词书里已有同名词库：只更新，不扣分
      if (!summary.added && summary.updated) {
        markOwned(item.id);
        return { ok: true, msg: '词书里已经有《' + item.title + '》了，已更新到最新版，这次没扣积分' };
      }

      var L = ledger();
      L.spent += price;
      pushLog(L, -price, 'spend', '兑换《' + item.title + '》');
      writeJSON(K_LEDGER, L);
      markOwned(item.id);

      return { ok: true, msg: '已兑换《' + item.title + '》，' + (summary.decks || 1) + ' 套词库并入词书，扣 ' + price + ' 积分' };
    }).catch(function (e) {
      return { ok: false, msg: '兑换失败：' + ((e && e.message) || String(e)) };
    });
  }

  function reimport(app, id) {
    var item = findStoreItem(app, id);
    if (!item) return Promise.resolve({ ok: false, msg: '找不到这件作品' });
    var getText = item.official
      ? loadOfficial(item)
      : rpc('shop_get', { p_id: item.id }, false).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.msg) || '拿不到内容');
        return r.content;
      });
    return getText.then(function (text) {
      var s = importSrcd(app, text);
      return { ok: true, msg: '《' + item.title + '》已重新导入（' + (s.decks || 1) + ' 套）' };
    }).catch(function (e) {
      return { ok: false, msg: '导入失败：' + ((e && e.message) || String(e)) };
    });
  }

  function buildSrcd(deck) {
    var cards = [];
    var arr = (deck && deck.cards) || [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i] || {};
      cards.push({
        front: String(c.front || ''),
        back: String(c.back || ''),
        extra: String(c.extra || ''),
        tags: Array.isArray(c.tags) ? c.tags.slice(0, 6) : []
      });
    }
    return JSON.stringify({
      format: 'srcd', version: 1, generator: 'StarCard Shop',
      exportedAt: new Date().toISOString(), parameters: {},
      decks: [{ name: deck.name || '未命名牌组', description: deck.description || '', cards: cards, options: {} }]
    });
  }

  function publish(app, deckId, title, intro, detail, price) {
    var decks = (app.state && app.state.decks) || [];
    var deck = null;
    for (var i = 0; i < decks.length; i++) if (decks[i].id === deckId) deck = decks[i];
    if (!deck) return Promise.resolve({ ok: false, msg: '先选一套牌组' });
    if (!(deck.cards || []).length) return Promise.resolve({ ok: false, msg: '这套牌组还没有卡片' });

    var p = Math.round(Number(price));
    if (isNaN(p) || p < 0 || p > 999) return Promise.resolve({ ok: false, msg: '价格要在 0–999 积分之间' });

    var content = buildSrcd(deck);
    if (content.length > 1600000) return Promise.resolve({ ok: false, msg: '这套牌太大了，拆小一点再上架' });

    return rpc('shop_publish', {
      p_title: String(title || '').trim() || deck.name,
      p_intro: String(intro || '').slice(0, 120),
      p_detail: String(detail || '').slice(0, 4000),
      p_price: p,
      p_category: '词库',
      p_card_count: (deck.cards || []).length,
      p_content: content
    }, false).then(function (r) {
      if (r && r.ok) {
        mineState(app).data = null;
        storeState(app).list = null;
        return { ok: true, msg: '《' + (String(title || '').trim() || deck.name) + '》已上架，' + ((deck.cards || []).length) + ' 张卡片' };
      }
      return { ok: false, msg: (r && r.msg) || '上架失败' };
    });
  }

  function updateItem(app, id, title, intro, detail, price, status) {
    var p = Math.round(Number(price));
    if (isNaN(p) || p < 0 || p > 999) return Promise.resolve({ ok: false, msg: '价格要在 0–999 积分之间' });
    return rpc('shop_update', {
      p_id: id,
      p_title: String(title || '').trim() || null,
      p_intro: String(intro || ''),
      p_detail: String(detail || ''),
      p_price: p,
      p_status: status || null
    }, false).then(function (r) {
      if (r && r.ok) {
        mineState(app).data = null;
        storeState(app).list = null;
        return { ok: true, msg: '已保存' };
      }
      return { ok: false, msg: (r && r.msg) || '保存失败' };
    });
  }

  function toggleLike(app, id) {
    return rpc('shop_like', { p_id: id }, false).then(function (r) {
      if (!r || !r.ok) {
        toast(app, (r && r.msg) || '点赞失败');
        return;
      }
      var st = storeState(app);
      if (st.list) {
        for (var i = 0; i < st.list.length; i++) {
          if (st.list[i].id === id) {
            st.list[i].liked = !!r.liked;
            st.list[i].likes = Number(r.likes) || 0;
          }
        }
      }
      if (app._shopSheet && app._shopSheet.id === id) {
        var it = findStoreItem(app, id);
        if (it) { it.liked = !!r.liked; it.likes = Number(r.likes) || 0; }
      }
      app.render();
    });
  }

  function toggleFollow(app, userId) {
    return rpc('shop_follow', { p_user: userId }, false).then(function (r) {
      if (!r || !r.ok) {
        toast(app, (r && r.msg) || '关注失败');
        if (r && r.code === 'no_auth') { app.accountOpen = true; app.render(); }
        return;
      }
      toast(app, r.following ? '已关注，他的新作品会出现在商城顶部' : '已取消关注');
      var st = storeState(app);
      if (st.list) {
        for (var i = 0; i < st.list.length; i++) {
          if (st.list[i].author && st.list[i].author.id === userId) st.list[i].following = !!r.following;
        }
      }
      if (app._shopSheet) {
        var it = app._shopSheet.item || findStoreItem(app, app._shopSheet.id);
        if (it) it.following = !!r.following;
      }
      mineState(app).data = null;
      app.render();
    });
  }

  /* ============================================================
     交互入口
     ============================================================ */
  function handleAct(act, el, app) {
    var d = (el && el.dataset) || {};

    if (act === 'shop-goto') {
      app.tab = 7;
      app.shopTab = d.tab || 'store';
      app._shopSheet = null;
      app.render();
      try { window.scrollTo(0, 0); } catch (e) {}
      return true;
    }

    if (act === 'shop-open') {
      var item = findStoreItem(app, d.id);
      if (!item) { toast(app, '这件作品不在了'); return true; }
      // 云端作品：补一次详情（拿到作者统计与点赞态）
      if (!item.official) {
        rpc('shop_detail', { p_id: item.id }, true).then(function (r) {
          if (r && r.ok && r.item) {
            for (var k in r.item) if (r.item.hasOwnProperty(k)) item[k] = r.item[k];
            app._shopSheet = { type: 'detail', id: item.id, item: item };
            app.render();
          }
        });
      }
      app._shopSheet = { type: 'detail', id: item.id, item: item };
      app.render();
      return true;
    }

    if (act === 'shop-close') { app._shopSheet = null; app.render(); return true; }

    if (act === 'shop-new') {
      if (!hasSession()) { app.accountOpen = true; app.render(); return true; }
      app._shopSheet = { type: 'publish' };
      app.render();
      return true;
    }

    if (act === 'shop-edit') {
      var target = null;
      var md = mineState(app).data;
      if (md && md.items) for (var i = 0; i < md.items.length; i++) if (md.items[i].id === d.id) target = md.items[i];
      if (!target) { toast(app, '找不到这件作品'); return true; }
      app._shopSheet = { type: 'edit', id: target.id, item: target };
      app.render();
      return true;
    }

    if (act === 'shop-like') { toggleLike(app, d.id); return true; }
    if (act === 'shop-follow') { toggleFollow(app, d.user); return true; }
    if (act === 'shop-login') { app.accountOpen = true; app.render(); return true; }

    if (act === 'shop-buy') {
      var buyItemObj = findStoreItem(app, d.id);
      if (!buyItemObj) { toast(app, '这件作品不在了'); return true; }
      if (el) { el.disabled = true; }
      buyItem(app, buyItemObj).then(function (r) {
        toast(app, r.msg);
        app._shopSheet = null;
        app.render();
      });
      return true;
    }

    if (act === 'shop-reimport') {
      reimport(app, d.id).then(function (r) { toast(app, r.msg); app.render(); });
      return true;
    }

    if (act === 'shop-save-publish') {
      var deckSel = document.getElementById('shpDeck');
      var t1 = document.getElementById('shpTitle');
      var i1 = document.getElementById('shpIntro');
      var dd1 = document.getElementById('shpDetail');
      var p1 = document.getElementById('shpPrice');
      publish(app,
        deckSel ? deckSel.value : '',
        t1 ? t1.value : '',
        i1 ? i1.value : '',
        dd1 ? dd1.value : '',
        p1 ? p1.value : '60'
      ).then(function (r) {
        toast(app, r.msg);
        if (r.ok) { app._shopSheet = null; app.shopTab = 'mine'; }
        app.render();
      });
      return true;
    }

    if (act === 'shop-save-edit') {
      var t2 = document.getElementById('shpTitle');
      var i2 = document.getElementById('shpIntro');
      var d2 = document.getElementById('shpDetail');
      var p2 = document.getElementById('shpPrice');
      updateItem(app, d.id,
        t2 ? t2.value : '', i2 ? i2.value : '', d2 ? d2.value : '', p2 ? p2.value : '', null
      ).then(function (r) {
        toast(app, r.msg);
        if (r.ok) app._shopSheet = null;
        app.render();
      });
      return true;
    }

    if (act === 'shop-delist') {
      updateItem(app, d.id, null, null, null, null, 'removed').then(function (r) {
        toast(app, r.ok ? '已下架，别人在商城看不到它了' : r.msg);
        app.render();
      });
      return true;
    }

    if (act === 'shop-relist') {
      updateItem(app, d.id, null, null, null, null, 'published').then(function (r) {
        toast(app, r.ok ? '已重新上架' : r.msg);
        app.render();
      });
      return true;
    }

    return false;
  }

  window.SCShop = {
    ledger: ledger,
    sync: sync,
    balance: balance,
    monthStats: monthStats,
    ownedMap: ownedMap,
    handleAct: handleAct,
    available: available,
    hasSession: hasSession,
    storeState: storeState,
    mineState: mineState
  };
  window.SCShopUI = { render: render };
})();
