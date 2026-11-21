/* ============================================================
   闪星卡 StarCard · 商铺与积分（js/shop.js）
   ------------------------------------------------------------
   两个东西合在一个模块里：
   1) 积分账本：学习产生的积分落成真实流水（获得 / 消耗），余额可花。
   2) 商铺：官方词库 + 用户自建牌组上架，用积分购买后直接并入词书。
   数据都存本机（localStorage），跟着云同步一起走。
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

  /* ---------------- 积分账本 ---------------- */
  function blankLedger() {
    return { v: 1, earned: 0, spent: 0, log: [] };
  }

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

  // 把学习成果折算成积分并落账：只补差额，不重复发放
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

  /* ---------------- 商铺数据 ---------------- */
  function shopData() {
    var S = readJSON(K_SHOP, null);
    if (!S || S.v !== 1) S = { v: 1, items: [], owned: [] };
    if (!Array.isArray(S.items)) S.items = [];
    if (!Array.isArray(S.owned)) S.owned = [];
    // 旧数据自愈：丢掉损坏的、缺字段的商品
    var clean = [];
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!it || !it.id || !it.title) continue;
      clean.push(it);
    }
    S.items = clean;
    return S;
  }

  function allItems(app) {
    var S = shopData();
    var list = [];
    for (var i = 0; i < OFFICIAL.length; i++) {
      var o = OFFICIAL[i];
      list.push({
        id: o.id, title: o.title, desc: o.desc, price: o.price, tone: o.tone,
        tag: o.tag, author: '官方精选', count: 0, official: true,
        file: o.file, sales: 0
      });
    }
    for (var j = 0; j < S.items.length; j++) {
      var t = S.items[j];
      if (t.status === 'off') continue;
      list.push({
        id: t.id, title: t.title, desc: t.desc || '', price: Number(t.price) || 0,
        tone: t.tone || 'green', tag: '自制', author: t.author || '星球居民',
        count: Number(t.count) || 0, official: false,
        payload: t.payload || '', sales: Number(t.sales) || 0, mine: true,
        deckName: t.deckName || ''
      });
    }
    return list;
  }

  function ownedMap() {
    var S = shopData();
    var m = {};
    for (var i = 0; i < S.owned.length; i++) {
      if (S.owned[i] && S.owned[i].id) m[S.owned[i].id] = 1;
    }
    return m;
  }

  function findItem(app, id) {
    var list = allItems(app);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------- 商品内容 ---------------- */
  // 官方商品：读随包 .srcd；自制商品：读上架时存的快照
  function loadPayload(item) {
    if (item.payload) {
      return Promise.resolve(item.payload);
    }
    if (!item.file) return Promise.reject(new Error('商品没有内容'));
    var url = (FC.assetUrl ? FC.assetUrl(encodeURIComponent(item.file)) : item.file);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('词库下载失败（HTTP ' + r.status + '）');
      return r.text();
    });
  }

  function importPayload(app, text) {
    var dec = FC.SrcdCodec.decode(text);
    var merged = FC.SrcdCodec.merge(app.state, dec, false);
    app.state = merged.state;
    app.save();
    return merged.summary;
  }

  function buildPayload(deck) {
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
      format: 'srcd',
      version: 1,
      generator: 'StarCard Shop',
      exportedAt: new Date().toISOString(),
      parameters: {},
      decks: [{
        name: deck.name || '未命名牌组',
        description: deck.description || '',
        cards: cards,
        options: {}
      }]
    });
  }

  /* ---------------- 购买 ---------------- */
  function buy(app, id) {
    var item = findItem(app, id);
    if (!item) return { ok: false, msg: '商品不存在了' };
    if (item.mine) return { ok: false, msg: '这是你自己上架的作品' };
    var owned = ownedMap();
    if (owned[id]) return { ok: false, msg: '已经拥有这套词库了' };

    var L = sync(app);
    var bal = L.earned - L.spent;
    if (bal < item.price) {
      return { ok: false, msg: '积分不够，还差 ' + (item.price - bal) + ' 分（多复习几天就能攒到）' };
    }

    // 先把内容取回来并校验能解析，再扣分，避免扣了分却导入失败
    return loadPayload(item).then(function (text) {
      var dec = FC.SrcdCodec.decode(text);           // 校验
      var merged = FC.SrcdCodec.merge(app.state, dec, false);
      var summary = merged.summary || {};
      app.state = merged.state;

      // 词书里已经有同名词库：只做版本更新，不扣积分
      if (!summary.added && summary.updated) {
        app.save();
        var S0 = shopData();
        var has = false;
        for (var k = 0; k < S0.owned.length; k++) if (S0.owned[k] && S0.owned[k].id === id) has = true;
        if (!has) { S0.owned.push({ id: id, at: Date.now() }); writeJSON(K_SHOP, S0); }
        return { ok: true, msg: '词书里已经有《' + item.title + '》了，已更新到最新版，这次没扣积分' };
      }

      L = ledger();
      L.spent += item.price;
      pushLog(L, -item.price, 'spend', '购买《' + item.title + '》');
      writeJSON(K_LEDGER, L);

      var S = shopData();
      S.owned.push({ id: id, at: Date.now() });
      for (var i = 0; i < S.items.length; i++) {
        if (S.items[i].id === id) S.items[i].sales = (Number(S.items[i].sales) || 0) + 1;
      }
      writeJSON(K_SHOP, S);

      app.save();
      return { ok: true, msg: '已购买《' + item.title + '》，' + (merged.summary.decks || 1) + ' 套词库已并入词书，扣 ' + item.price + ' 积分' };
    }).catch(function (e) {
      return { ok: false, msg: '购买失败：' + (e && e.message ? e.message : String(e)) };
    });
  }

  // 已拥有后重新导入（换设备、清过本地数据时用）
  function importOwned(app, id) {
    var item = findItem(app, id);
    if (!item) return Promise.resolve({ ok: false, msg: '商品不存在了' });
    return loadPayload(item).then(function (text) {
      var summary = importPayload(app, text);
      return { ok: true, msg: '《' + item.title + '》已重新导入（' + (summary.decks || 1) + ' 套）' };
    }).catch(function (e) {
      return { ok: false, msg: '导入失败：' + (e && e.message ? e.message : String(e)) };
    });
  }

  /* ---------------- 上架 / 下架 / 改价 ---------------- */
  function publish(app, deckId, title, price, desc) {
    var decks = (app.state && app.state.decks) || [];
    var deck = null;
    for (var i = 0; i < decks.length; i++) if (decks[i].id === deckId) deck = decks[i];
    if (!deck) return { ok: false, msg: '先选一套牌组' };
    var count = (deck.cards || []).length;
    if (count < 1) return { ok: false, msg: '这套牌组还没有卡片' };

    var p = Math.round(Number(price));
    if (!p || p < 1) return { ok: false, msg: '定价至少 1 积分' };
    if (p > 999) return { ok: false, msg: '定价最多 999 积分' };

    var payload = buildPayload(deck);
    if (payload.length > 1600000) return { ok: false, msg: '这套牌太大了（' + count + ' 张），拆小一点再上架' };

    var S = shopData();
    var name = String(title || '').trim() || deck.name;
    S.items.unshift({
      id: 'my-' + Date.now().toString(36),
      title: name.slice(0, 40),
      desc: String(desc || '').trim().slice(0, 120) || (deck.description || ''),
      price: p,
      tone: 'green',
      tag: '自制',
      author: (function () {
        var n = app.accountDisplayName ? app.accountDisplayName() : '';
        if (!n || n === '未登录' || n === '匿名用户' || n === '学习者') return '本机用户';
        return n;
      })(),
      deckName: deck.name,
      count: count,
      payload: payload,
      createdAt: Date.now(),
      sales: 0,
      status: 'on'
    });
    writeJSON(K_SHOP, S);
    return { ok: true, msg: '《' + name + '》已上架，定价 ' + p + ' 积分（' + count + ' 张卡片）' };
  }

  function delist(id) {
    var S = shopData();
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i].id === id) S.items[i].status = 'off';
    }
    writeJSON(K_SHOP, S);
  }

  function reprice(id, price) {
    var p = Math.round(Number(price));
    if (!p || p < 1 || p > 999) return false;
    var S = shopData();
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i].id === id) S.items[i].price = p;
    }
    writeJSON(K_SHOP, S);
    return true;
  }

  function myItems() {
    var S = shopData();
    var out = [];
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i] && S.items[i].status !== 'off') out.push(S.items[i]);
    }
    return out;
  }

  /* ============================================================
     页面渲染
     ============================================================ */
  var esc, icon;
  function ready() {
    esc = window.FCUI.esc;
    icon = window.FCUI.icon;
  }

  function heroHtml(app, L) {
    var bal = Math.max(0, L.earned - L.spent);
    var m = monthStats(L);
    return '<div class="shop-hero">' +
      '<div class="sh-l"><div class="sh-bal"><b>' + bal + '</b><span>积分</span></div>' +
      '<div class="sh-meta">本月获取 <b>' + m.earn + '</b> · 已消耗 <b>' + m.spend + '</b></div></div>' +
      '<div class="sh-r">' +
      '<button class="btn btn-sm" data-act="shop-goto" data-tab="ledger">积分明细</button>' +
      '<button class="btn btn-sm btn-primary" data-act="shop-goto" data-tab="mine">' + icon('upload', 'i14') + '上架作品</button>' +
      '</div></div>';
  }

  function tabsHtml(tab) {
    var t = [
      { k: 'store', label: '商铺' },
      { k: 'ledger', label: '我的积分' },
      { k: 'mine', label: '我的作品' }
    ];
    var h = '<div class="shop-tabs">';
    for (var i = 0; i < t.length; i++) {
      h += '<button class="shop-tab' + (tab === t[i].k ? ' on' : '') + '" data-act="shop-goto" data-tab="' + t[i].k + '">' + t[i].label + '</button>';
    }
    return h + '</div>';
  }

  function coverHtml(item) {
    var mark = item.official ? '官' : '自';
    var ico = item.official ? 'book' : 'layers';
    return '<div class="sc-cover t-' + (item.tone || 'green') + '">' +
      '<span class="sc-tagmark">' + mark + '</span>' +
      icon(ico, 'i26') + '</div>';
  }

  function cardHtml(item, owned) {
    var me = !!item.mine;
    var has = !!owned[item.id];
    var foot;
    if (me) {
      foot = '<span class="sc-state">我的作品</span>';
    } else if (has) {
      foot = '<span class="sc-state ok">已拥有</span>' +
        '<button class="btn btn-sm" data-act="shop-reimport" data-id="' + esc(item.id) + '">重新导入</button>';
    } else {
      foot = '<span class="sc-price">' + item.price + ' <em>积分</em></span>' +
        '<button class="btn btn-sm btn-primary" data-act="shop-buy" data-id="' + esc(item.id) + '">购买</button>';
    }
    return '<div class="shop-card">' + coverHtml(item) +
      '<div class="sc-body">' +
      '<b class="sc-title">' + esc(item.title) + '</b>' +
      '<small class="sc-desc">' + esc(item.desc || '') + '</small>' +
      '<div class="sc-meta">' + esc(item.author || '') +
      (item.count ? ' · ' + item.count + ' 张' : '') +
      (item.sales ? ' · 已售 ' + item.sales : '') + '</div>' +
      '<div class="sc-foot">' + foot + '</div>' +
      '</div></div>';
  }

  function storePane(app, L) {
    var items = allItems(app);
    var owned = ownedMap();
    var mine = 0, buyable = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].mine) mine++;
      else if (!owned[items[i].id]) buyable++;
    }
    var grid = '';
    for (var j = 0; j < items.length; j++) grid += cardHtml(items[j], owned);

    return '<div class="shop-sec-h">全部商品<span>' + items.length + ' 件 · 还能买 ' + buyable + ' 件</span></div>' +
      '<div class="shop-grid">' + grid + '</div>' +
      '<div class="shop-note">' + icon('info', 'i14') +
      '<span>积分来自学习：复习 1 次 +1，学习 1 天 +10，每枚勋章 +20。买下的词库直接并入「词书」。</span></div>';
  }

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
    if (!rows) {
      rows = '<div class="sht-empty">还没有积分记录。去学几张卡，这里就会开始进账。</div>';
    }
    return '<div class="shop-panel">' +
      '<div class="shop-sec-h">积分总览</div>' +
      '<div class="shop-stat">' +
      '<div><b>' + bal + '</b><span>当前余额</span></div>' +
      '<div><b>' + m.earn + '</b><span>本月获取</span></div>' +
      '<div><b>' + m.spend + '</b><span>本月消耗</span></div>' +
      '</div>' +
      '<div class="shop-sec-h">收支明细</div>' +
      '<div class="sh-table"><div class="sht-head"><i>时间</i><i>积分</i><i>概述</i></div>' +
      '<div class="sht-body">' + rows + '</div></div>' +
      '<div class="shop-note">' + icon('info', 'i14') +
      '<span>积分自动结算：复习 1 次 +1，学习 1 天 +10，每点亮一枚勋章 +20。积分只用于商铺兑换。</span></div>' +
      '</div>';
  }

  function minePane(app) {
    var decks = (app.state && app.state.decks) || [];
    var opts = '';
    for (var i = 0; i < decks.length; i++) {
      var d = decks[i];
      opts += '<option value="' + esc(d.id) + '">' + esc(d.name) + '（' + (d.cards || []).length + ' 张）</option>';
    }
    var form = '';
    if (!decks.length) {
      form = '<div class="sht-empty">还没有牌组可上架。先去「词书」导入或新建一套。</div>';
    } else {
      form = '<div class="shop-form">' +
        '<label class="sf-row"><span>牌组</span><select id="shopDeck" class="set-select">' + opts + '</select></label>' +
        '<label class="sf-row"><span>作品名</span><input id="shopTitle" class="set-num" style="width:100%" placeholder="默认用牌组名" /></label>' +
        '<label class="sf-row"><span>定价</span><input id="shopPrice" class="set-num" type="number" min="1" max="999" placeholder="例如 60" /></label>' +
        '<label class="sf-row"><span>一句话介绍</span><input id="shopDesc" class="set-num" style="width:100%" placeholder="这套牌适合谁、怎么用" /></label>' +
        '<div class="sf-act"><button class="btn btn-primary" data-act="shop-publish">' + icon('upload', 'i14') + '上架到商铺</button>' +
        '<small>上架后本机所有账号都能在商铺看到；价格 1–999 积分。</small></div>' +
        '</div>';
    }

    var list = myItems();
    var rows = '';
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      rows += '<div class="shop-mine-row">' +
        '<span class="smr-ico t-green">' + icon('layers', 'i16') + '</span>' +
        '<span class="smr-main"><b>' + esc(it.title) + '</b>' +
        '<small>' + (Number(it.count) || 0) + ' 张 · 已售 ' + (Number(it.sales) || 0) + '</small></span>' +
        '<span class="smr-price">' + (Number(it.price) || 0) + ' <em>积分</em></span>' +
        '<button class="btn btn-sm" data-act="shop-reprice" data-id="' + esc(it.id) + '">改价</button>' +
        '<button class="btn btn-sm" data-act="shop-delist" data-id="' + esc(it.id) + '">下架</button>' +
        '</div>';
    }
    if (!rows) rows = '<div class="sht-empty">还没上架作品。选一套自己做的牌组，定个价挂上去。</div>';

    return '<div class="shop-panel">' +
      '<div class="shop-sec-h">上架我的牌组</div>' + form +
      '<div class="shop-sec-h">我的作品<span>' + list.length + ' 件在售</span></div>' +
      '<div class="shop-mine">' + rows + '</div>' +
      '<div class="shop-note">' + icon('info', 'i14') +
      '<span>上架时会保存一份卡片快照，之后改原牌组不会影响已上架版本。</span></div>' +
      '</div>';
  }

  function render(app) {
    ready();
    var L = sync(app);
    var tab = app.shopTab || 'store';
    var sub = '积分换词库 · 自制牌组上架';
    var body = '';
    if (tab === 'ledger') body = ledgerPane(app, L);
    else if (tab === 'mine') body = minePane(app);
    else body = storePane(app, L);

    var html = '<header class="topbar"><div class="tb-main">' +
      '<div class="topbar-t"><h1>商铺</h1></div><p>' + esc(sub) + '</p></div></header>' +
      '<div class="content shop-content">' + heroHtml(app, L) + tabsHtml(tab) + body + '</div>';
    return html + ((window.FCUI && window.FCUI.tabbarHtml) ? window.FCUI.tabbarHtml(app.tab, app) : '');
  }

  /* ============================================================
     交互
     ============================================================ */
  function toast(app, msg) {
    if (app && app.toast) app.toast(msg);
  }

  function handleAct(act, el, app) {
    var d = (el && el.dataset) || {};
    if (act === 'shop-goto') {
      app.tab = 7;
      app.shopTab = d.tab || 'store';
      app.render();
      try { window.scrollTo(0, 0); } catch (e) {}
      return true;
    }
    if (act === 'shop-buy') {
      var id = d.id;
      if (!id) return true;
      var btn = el;
      if (btn) { btn.disabled = true; btn.textContent = '购买中…'; }
      buy(app, id).then(function (r) {
        toast(app, r.msg);
        app.render();
      });
      return true;
    }
    if (act === 'shop-reimport') {
      importOwned(app, d.id).then(function (r) {
        toast(app, r.msg);
        app.render();
      });
      return true;
    }
    if (act === 'shop-publish') {
      var sel = document.getElementById('shopDeck');
      var title = document.getElementById('shopTitle');
      var price = document.getElementById('shopPrice');
      var desc = document.getElementById('shopDesc');
      var r = publish(app, sel ? sel.value : '',
        title ? title.value : '',
        price ? price.value : '',
        desc ? desc.value : '');
      toast(app, r.msg);
      if (r.ok) app.render();
      return true;
    }
    if (act === 'shop-delist') {
      delist(d.id);
      toast(app, '已下架');
      app.render();
      return true;
    }
    if (act === 'shop-reprice') {
      var input = window.prompt('输入新的价格（1–999 积分）', '60');
      if (input === null) return true;
      if (reprice(d.id, input)) { toast(app, '价格已更新为 ' + Math.round(Number(input)) + ' 积分'); app.render(); }
      else toast(app, '价格要在 1–999 之间');
      return true;
    }
    return false;
  }

  window.SCShop = {
    ledger: ledger,
    sync: sync,
    balance: balance,
    monthStats: monthStats,
    allItems: allItems,
    myItems: myItems,
    ownedMap: ownedMap,
    buy: buy,
    importOwned: importOwned,
    publish: publish,
    delist: delist,
    reprice: reprice,
    handleAct: handleAct
  };
  window.SCShopUI = { render: render };
})();
