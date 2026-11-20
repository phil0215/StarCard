/* ============================================================
 * 闪星卡 StarCard · 词店模块（FC.Store · 免费分享 MVP）
 * ------------------------------------------------------------
 *  - 浏览：无需登录，公开已上架卡组
 *  - 导入：把词店卡组按 .srcd 解码合并进本机（复用 App.doImport）
 *  - 上架：需登录（复用 FC.CloudSync 会话），把本机卡组打包成 .srcd 上传
 *  - 数据直连 Supabase REST + RLS，不依赖 Edge Function
 *  - 付费 / 购买 / 创作者订阅暂未接入，留待支付渠道确定后再扩展
 * ============================================================ */
(function () {
  'use strict';
  var FC = window.FC || (window.FC = {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cfg() { return FC.CLOUD_SYNC_CONFIG || {}; }
  function base() { return String(cfg().url || '').replace(/\/+$/, ''); }
  function anon() { return String(cfg().anonKey || ''); }
  function sess() { return (FC.CloudSync && FC.CloudSync.getSession) ? FC.CloudSync.getSession() : null; }
  function uid() { var s = sess(); return (s && s.user && (s.user.id || s.user.sub)) || ''; }
  function loggedIn() { return !!uid(); }

  function headers(extra) {
    var h = { apikey: anon(), 'Content-Type': 'application/json' };
    var s = sess();
    if (s && s.access_token) h.Authorization = 'Bearer ' + s.access_token;
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    return h;
  }
  function req(path, opts) {
    if (!base() || !anon()) return Promise.reject(new Error('云同步未配置'));
    return fetch(base() + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var d; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
        if (!r.ok) {
          var m = (d && (d.message || d.error || d.msg)) || ('HTTP ' + r.status);
          var e = new Error(m); e.status = r.status; throw e;
        }
        return d;
      });
    });
  }

  var SEL = 'id,title,description,tags,category,card_count,downloads,created_at,creator_id,profiles(display_name)';
  var S = {
    view: 'list', items: [], mine: [], detail: null,
    loading: false, error: '', loadedList: false,
    selected: '', draft: { title: '', description: '', tags: '' }
  };

  function loadList() {
    S.loading = true; S.error = '';
    return req('/rest/v1/store_decks?select=' + SEL + '&status=eq.published&order=created_at.desc', { method: 'GET', headers: headers() })
      .then(function (rows) { S.items = rows || []; S.loadedList = true; S.loading = false; })
      .catch(function (e) { S.error = e.message; S.loading = false; });
  }
  function loadMine() {
    if (!uid()) { S.mine = []; return Promise.resolve(); }
    return req('/rest/v1/store_decks?select=' + SEL + '&creator_id=eq.' + encodeURIComponent(uid()) + '&order=created_at.desc', { method: 'GET', headers: headers() })
      .then(function (rows) { S.mine = rows || []; })
      .catch(function (e) { S.error = e.message; });
  }
  function loadDeck(id) {
    return req('/rest/v1/store_decks?select=*,profiles(display_name)&id=eq.' + encodeURIComponent(id), { method: 'GET', headers: headers() })
      .then(function (rows) { S.detail = (rows && rows[0]) || null; });
  }

  function author(r) {
    var p = r.profiles || {};
    return p.display_name || '匿名创作者';
  }
  function icon(name, size) { return (FCUI && FCUI.icon) ? FCUI.icon(name, size || 'i18') : ''; }

  function header(title, sub, actions, backSact) {
    var h = '<header class="topbar">';
    if (backSact) h += '<button class="btn-icon" data-act="store-action" data-sact="' + backSact + '" aria-label="返回">' + icon('chevronLeft', 'i18') + '</button>';
    h += '<div class="tb-main"><div class="topbar-t"><h1>' + esc(title) + '</h1></div>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
    if (actions) h += '<div class="tb-actions">' + actions + '</div>';
    return h + '</header>';
  }
  function emptyBox(ico, text) {
    return '<div class="empty"><div class="empty-ico">' + icon(ico, 'i32') + '</div><div class="empty-t">' + esc(text) + '</div></div>';
  }
  function publishBtn() {
    return '<button class="btn btn-sm btn-primary" data-act="store-action" data-sact="publish-open">' + icon('plus', 'i14') + '上架卡组</button>';
  }
  function mineBtn() {
    return '<button class="btn btn-sm" data-act="store-action" data-sact="mine">我的上架</button>';
  }

  function listRow(r) {
    var tags = (r.tags && r.tags.length) ? ' · ' + esc(r.tags.join(' / ')) : '';
    return '<div class="list-item" data-act="store-action" data-sact="open" data-id="' + esc(r.id) + '">' +
      '<div class="avatar">' + icon('grid', 'i18') + '</div>' +
      '<div class="li-main"><div class="name">' + esc(r.title) + '</div>' +
      '<div class="meta">' + esc(author(r)) + ' · ' + (r.card_count || 0) + ' 张 · 下载 ' + (r.downloads || 0) + tags + '</div></div>' +
      '</div>';
  }

  function previewCards(content) {
    var cards = [];
    try {
      var srcd = JSON.parse(content);
      var decks = srcd.decks || [];
      for (var i = 0; i < decks.length && cards.length < 6; i++) {
        var cs = decks[i].cards || [];
        for (var j = 0; j < cs.length && cards.length < 6; j++) cards.push(cs[j]);
      }
    } catch (e) { /* 内容损坏时不展示预览 */ }
    return cards;
  }

  function renderList(app) {
    if (S.loading && !S.items.length) return emptyBox('grid', '正在加载词店…');
    if (S.error) return emptyBox('grid', '加载失败：' + S.error);
    if (!S.items.length) return emptyBox('grid', '词店还没有卡组，来上架第一个吧。');
    return S.items.map(listRow).join('');
  }

  function renderDetail(app) {
    var d = S.detail;
    if (!d) return emptyBox('grid', '卡组不存在或已下架。');
    var cards = previewCards(d.content || '');
    var tags = (d.tags && d.tags.length) ? '<div class="meta" style="margin-top:6px">标签：' + esc(d.tags.join(' / ')) + '</div>' : '';
    var html = '<div class="card wide" style="padding:18px">' +
      '<div style="font-weight:700;font-size:17px">' + esc(d.title) + '</div>' +
      '<div class="meta" style="margin-top:6px">' + esc(author(d)) + ' · ' + (d.card_count || 0) + ' 张 · 下载 ' + (d.downloads || 0) + '</div>' +
      (d.description ? '<div class="subtle" style="margin-top:10px">' + esc(d.description) + '</div>' : '') + tags +
      '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" data-act="store-action" data-sact="import" data-id="' + esc(d.id) + '">' + icon('download', 'i16') + '导入到我的词书</button>' +
      '</div></div>';
    if (cards.length) {
      html += '<div class="card wide" style="margin-top:14px"><div class="subtle" style="margin-bottom:10px">预览（前 ' + cards.length + ' 张）</div>';
      for (var i = 0; i < cards.length; i++) {
        html += '<div class="list-item"><div class="li-main">' +
          '<div class="name" style="font-size:14px">' + esc(cards[i].front) + '</div>' +
          '<div class="meta">' + esc(cards[i].back) + '</div></div></div>';
      }
      html += '</div>';
    }
    return html;
  }

  function renderPublish(app) {
    var decks = (app.state && app.state.decks) || [];
    if (!loggedIn()) return emptyBox('link', '请先在左下角云面板登录后再上架卡组。');
    if (!decks.length) return emptyBox('book', '本机还没有卡组，先导入或新建牌组再来上架。');

    var rows = decks.map(function (d) {
      var checked = S.selected === d.id ? ' checked' : '';
      return '<label class="list-item" style="display:flex;gap:10px;align-items:center">' +
        '<input type="radio" name="st-deck" value="' + esc(d.id) + '"' + checked + ' data-act="store-action" data-sact="pick-deck" />' +
        '<div class="li-main"><div class="name" style="font-size:14px">' + esc(d.name) + '</div>' +
        '<div class="meta">' + d.cards.length + ' 张卡片</div></div></label>';
    }).join('');

    var defTitle = '';
    var cur = decks.filter(function (d) { return d.id === S.selected; })[0];
    if (cur) defTitle = cur.name;

    return '<div class="card wide" style="padding:18px">' +
      '<div class="field"><label>选择本机卡组</label>' + rows + '</div>' +
      '<div class="field"><label>标题</label><input id="st-title" value="' + esc(S.draft.title || defTitle) + '" placeholder="给卡组起个名字" /></div>' +
      '<div class="field"><label>简介</label><textarea id="st-desc" rows="3" placeholder="适合谁、包含什么内容">' + esc(S.draft.description) + '</textarea></div>' +
      '<div class="field"><label>标签（逗号分隔）</label><input id="st-tags" value="' + esc(S.draft.tags) + '" placeholder="如：SAT, 词汇, 写作" /></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" data-act="store-action" data-sact="publish">确认上架</button>' +
      '<button class="btn" data-act="store-action" data-sact="back">取消</button>' +
      '</div></div>';
  }

  function renderMine(app) {
    if (!loggedIn()) return emptyBox('link', '登录后查看我的上架。');
    if (!S.mine.length) return emptyBox('grid', '你还没有上架过卡组。');
    return S.mine.map(function (r) {
      return '<div class="list-item" data-act="store-action" data-sact="open" data-id="' + esc(r.id) + '">' +
        '<div class="avatar">' + icon('grid', 'i18') + '</div>' +
        '<div class="li-main"><div class="name">' + esc(r.title) + '</div>' +
        '<div class="meta">' + (r.card_count || 0) + ' 张 · 下载 ' + (r.downloads || 0) + '</div></div>' +
        '<div style="flex:none"><button class="btn btn-sm btn-danger" data-act="store-action" data-sact="remove" data-id="' + esc(r.id) + '">下架</button></div>' +
        '</div>';
    }).join('');
  }

  function body(app) {
    if (S.view === 'detail') return renderDetail(app);
    if (S.view === 'publish') return renderPublish(app);
    if (S.view === 'mine') return renderMine(app);
    return renderList(app);
  }

  function page(app) {
    if (!base() || !anon()) return header('词店', '未配置') + '<div class="content">' + emptyBox('grid', '云同步未配置，词店暂不可用。') + '</div>';
    if (!S.loadedList && S.view === 'list') loadList().then(function () { if (app && app.render) app.render(); });

    var actions = '';
    if (S.view === 'list') actions = loggedIn() ? mineBtn() + publishBtn() : '';
    else if (S.view === 'mine') actions = publishBtn();

    var back = (S.view === 'detail' || S.view === 'publish' || S.view === 'mine') ? 'back' : '';
    var sub = S.view === 'publish' ? '免费分享到词店' : (S.view === 'mine' ? '我上架的卡组' : '发现与分享卡组');
    return header('词店', sub, actions, back) + '<div class="content">' + body(app) + '</div>' + (FCUI && FCUI.tabbar ? FCUI.tabbar(7, app) : '');
  }

  function findDeck(app, id) {
    var decks = (app.state && app.state.decks) || [];
    for (var i = 0; i < decks.length; i++) if (decks[i].id === id) return decks[i];
    return null;
  }

  function submit(app) {
    if (!loggedIn()) { app.toast('请先在左下角云面板登录'); return; }
    var radio = document.querySelector('input[name="st-deck"]:checked');
    var deckId = radio ? radio.value : S.selected;
    var deck = findDeck(app, deckId);
    var titleEl = document.getElementById('st-title');
    var descEl = document.getElementById('st-desc');
    var tagsEl = document.getElementById('st-tags');
    var title = titleEl ? titleEl.value.trim() : '';
    var desc = descEl ? descEl.value.trim() : '';
    var tags = tagsEl ? tagsEl.value.split(/[,，\s]+/).filter(Boolean) : [];
    if (!deck) { app.toast('请选择要上架的卡组'); return; }
    if (!title) { app.toast('请填写卡组标题'); return; }

    var text = FC.SrcdCodec.encode([deck], app.state.settings, '闪星卡 StarCard 词店');
    var payload = {
      creator_id: uid(), title: title, description: desc, tags: tags, category: '',
      card_count: deck.cards.length, content: text, status: 'published', downloads: 0
    };
    req('/rest/v1/store_decks', { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
      .then(function () {
        app.toast('已上架到词店');
        S.view = 'mine'; S.draft = { title: '', description: '', tags: '' }; S.selected = '';
        return loadMine();
      })
      .then(function () { app.render(); })
      .catch(function (e) { app.toast('上架失败：' + e.message); });
  }

  function removeDeck(id, app) {
    req('/rest/v1/store_decks?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: headers() })
      .then(function () { app.toast('已下架'); return loadMine(); })
      .then(function () { S.loadedList = false; app.render(); })
      .catch(function (e) { app.toast('下架失败：' + e.message); });
  }

  function onAction(d, app) {
    var sact = d.sact, id = d.id;
    if (sact === 'open') {
      loadDeck(id).then(function () { S.view = 'detail'; app.render(); }).catch(function (e) { app.toast(e.message); });
    } else if (sact === 'back') {
      S.view = 'list'; app.render();
    } else if (sact === 'mine') {
      S.view = 'mine'; loadMine().then(function () { app.render(); });
    } else if (sact === 'publish-open') {
      if (!loggedIn()) { app.toast('请先在左下角云面板登录后再上架'); return; }
      if (!S.selected && app.state.decks[0]) S.selected = app.state.decks[0].id;
      S.view = 'publish'; app.render();
    } else if (sact === 'pick-deck') {
      S.selected = id || (d.value || '');
    } else if (sact === 'publish') {
      submit(app);
    } else if (sact === 'remove') {
      removeDeck(id, app);
    } else if (sact === 'import') {
      if (S.detail) app.doImport(S.detail.content, S.detail.title);
    }
  }

  FC.Store = {
    page: page,
    onAction: onAction,
    isLoggedIn: loggedIn
  };
})();
