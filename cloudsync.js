/* ============================================================
 * 闪星卡 StarCard · Supabase 云同步模块（FC.CloudSync）
 * ------------------------------------------------------------
 * 目标：让学习进度不再只存本机浏览器，登录后可跨设备/清缓存不丢。
 *
 * 设计原则：
 *  1) 零侵入：不改动原 app.js 的业务逻辑。通过包装 localStorage.setItem
 *     自动捕获进度写入并防抖上传；不配置 / 不登录时完全静默。
 *  2) 纯 fetch 直连 Supabase REST + Auth API，不依赖 supabase-js、
 *     不依赖 Edge Functions，也不依赖 WorkBuddy 云（两套互不影响）。
 *  3) anon key 是公开密钥，配合表上的行级安全(RLS)，前端可安全直连。
 *
 * 接入方式：在本文件之前，于 index.html 里写：
 *   window.FC = window.FC || {};
 *   window.FC.CLOUD_SYNC_CONFIG = {
 *     url: 'https://aqsbrjiudrqhqazvipj.supabase.co',
 *     anonKey: '<你的 anon public key>',
 *     autoPush: true,      // 进度变化后自动上传
 *     pushDelay: 2000,     // 防抖毫秒
 *     otpType: 'email',    // supabase 发邮箱验证码的类型
 *     ui: true             // 显示右下角同步小面板
 *   };
 * 未配置 anonKey 时本模块整体休眠，不影响任何现有功能。
 * ============================================================ */
(function () {
  'use strict';
  var FC = window.FC || (window.FC = {});
  var CFG = FC.CLOUD_SYNC_CONFIG || {};

  var BASE = String(CFG.url || '').replace(/\/+$/, '');
  var ANON = String(CFG.anonKey || '');
  var STATE_KEY = 'starcard-state-v1';     // 原 app 存进度的键
  var ACCOUNT_KEY = 'starcard-account-v1'; // 原 app 存账户的键
  var SESS_KEY = 'starcard-sb-session-v1'; // 本模块存 supabase 会话的键
  var PUSH_DELAY = CFG.pushDelay || 2000;

  function configured() { return !!(BASE && ANON); }
  function online() { return /^https?:$/.test((window.location && window.location.protocol) || ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 会话：只保存在本机，key 是用户自己的 access_token，不是公开的 anon key ----
  function getSession() {
    try {
      var raw = localStorage.getItem(SESS_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.access_token) return null;
      // 过期判断（留 60 秒余量）
      if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return null;
      return s;
    } catch (e) { return null; }
  }
  function saveSession(s) {
    var data = {
      access_token: s.access_token || s.access_token,
      refresh_token: s.refresh_token || '',
      user: s.user || null,
      expires_at: s.expires_at || (s.expires_in ? Math.floor(Date.now() / 1000) + s.expires_in : 0)
    };
    localStorage.setItem(SESS_KEY, JSON.stringify(data));
    return data;
  }
  function signOut() {
    try { localStorage.removeItem(SESS_KEY); } catch (e) {}
    renderPanel();
  }

  // ---- HTTP ----
  function buildHeaders(extra, sess) {
    var h = { 'apikey': ANON, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    if (sess && sess.access_token) h['Authorization'] = 'Bearer ' + sess.access_token;
    return h;
  }
  function request(path, opts) {
    if (!configured()) return Promise.reject(new Error('云同步未配置'));
    return fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var data;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
        if (!r.ok) {
          var msg = (data && (data.message || data.msg || data.error_description)) || ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---- Auth：邮箱验证码（魔法链接 OTP）----
  function sendCode(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error('请输入正确的邮箱'));
    return request('/auth/v1/otp', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ email: email, create_user: true })
    });
  }
  function verifyCode(email, code) {
    email = String(email || '').trim();
    code = String(code || '').trim();
    if (!email || !code) return Promise.reject(new Error('请填写邮箱和验证码'));
    return request('/auth/v1/verify', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ email: email, token: code, type: CFG.otpType || 'email' })
    }).then(function (r) {
      if (!r || !r.access_token) throw new Error('登录响应缺少凭证，请确认 otpType 配置');
      return saveSession(r);
    });
  }

  // ---- 数据：上传 / 下载整份进度快照 ----
  function pull() {
    var s = getSession();
    if (!s) return Promise.reject(new Error('请先登录云同步'));
    var uid = s.user && (s.user.id || s.user.sub);
    if (!uid) return Promise.reject(new Error('会话缺少用户 ID'));
    var path = '/rest/v1/user_state?user_id=eq.' + encodeURIComponent(uid) + '&select=state,updated_at';
    return request(path, { method: 'GET', headers: buildHeaders(null, s) }).then(function (rows) {
      if (rows && rows[0] && rows[0].state) {
        return { has: true, state: rows[0].state, updatedAt: rows[0].updated_at };
      }
      return { has: false };
    });
  }
  function push(state) {
    var s = getSession();
    if (!s) return Promise.reject(new Error('请先登录云同步'));
    var uid = s.user && (s.user.id || s.user.sub);
    if (!uid) return Promise.reject(new Error('会话缺少用户 ID'));
    var payload = {
      user_id: uid,
      state: state,
      account: null,
      updated_at: new Date().toISOString()
    };
    try {
      var accRaw = localStorage.getItem(ACCOUNT_KEY);
      if (accRaw) payload.account = JSON.parse(accRaw);
    } catch (e) {}
    return request('/rest/v1/user_state', {
      method: 'POST',
      headers: buildHeaders({ 'Prefer': 'resolution=merge-duplicates' }, s),
      body: JSON.stringify(payload)
    });
  }

  // ---- 统计上报：从进度快照提取数据，写入 study_daily / study_summary ----
  function reportStats(state, sess) {
    if (!state || !state.decks || !Array.isArray(state.decks)) return Promise.resolve();
    var uid = sess.user && (sess.user.id || sess.user.sub);
    if (!uid) return Promise.resolve();
    var today = new Date();
    var dstr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var totalReps = 0, totalLapses = 0, totalCards = 0, mastered = 0;
    for (var i = 0; i < state.decks.length; i++) {
      var cards = state.decks[i].cards;
      if (!Array.isArray(cards)) continue;
      for (var j = 0; j < cards.length; j++) {
        var sc = cards[j].scheduling;
        if (!sc) continue;
        totalCards++;
        totalReps += Number(sc.reps) || 0;
        totalLapses += Number(sc.lapses) || 0;
        // 掌握口径：稳定度 >= 21 天视为已掌握（与主程序 mastered 口径接近）
        if ((Number(sc.stability) || 0) >= 21) mastered++;
      }
    }
    var daily = {
      user_id: uid, study_date: dstr,
      cards_new: Number(state.newToday) || 0,
      cards_reviewed: Number(state.reviewToday) || 0,
      cards_mastered: mastered,
      correct: Math.max(0, totalReps - totalLapses),
      wrong: totalLapses
    };
    var summary = {
      user_id: uid,
      total_cards_new: totalCards,
      total_reviews: totalReps,
      total_mastered: mastered,
      total_minutes: 0,
      last_study_date: dstr,
      updated_at: new Date().toISOString()
    };
    var p1 = request('/rest/v1/study_daily', {
      method: 'POST',
      headers: buildHeaders({ 'Prefer': 'resolution=merge-duplicates' }, sess),
      body: JSON.stringify([daily])
    }).catch(function () {});
    var p2 = request('/rest/v1/study_summary', {
      method: 'POST',
      headers: buildHeaders({ 'Prefer': 'resolution=merge-duplicates' }, sess),
      body: JSON.stringify([summary])
    }).catch(function () {});
    return Promise.all([p1, p2]);
  }

  // ---- 自动上传：包装 setItem，捕获进度写入 ----
  var _origSetItem = (typeof Storage !== 'undefined' && Storage.prototype && Storage.prototype.setItem)
    ? Storage.prototype.setItem : null;
  var _inSync = false;      // 正在写入云端数据时置 true，避免触发回传循环
  var _pushTimer = null;
  function rawSet(k, v) {    // 写本地但不触发上传
    _inSync = true;
    try { localStorage.setItem(k, v); } finally { _inSync = false; }
  }
  function schedulePush() {
    if (!configured() || CFG.autoPush === false || !online()) return;
    if (!getSession()) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () {
      var raw;
      try { raw = localStorage.getItem(STATE_KEY); } catch (e) { return; }
      if (!raw) return;
      try {
        var st = JSON.parse(raw);
        push(st).then(function () { reportStats(st, getSession()); }).catch(function () {});
      } catch (e) {}
    }, PUSH_DELAY);
  }
  if (_origSetItem && !FC.__cloudSyncHooked) {
    Storage.prototype.setItem = function (k, v) {
      _origSetItem.call(this, k, v);
      if (!_inSync && k === STATE_KEY && this === localStorage) schedulePush();
    };
    FC.__cloudSyncHooked = true;
  }

  // 启动时：已登录则从云端拉最新进度覆盖本机并刷新（用原始 setItem，避免触发回传循环）
  function boot() {
    if (!configured() || !online()) return;
    var s = getSession();
    if (!s) return;
    pull().then(function (r) {
      if (r.has && r.state) {
        rawSet(STATE_KEY, JSON.stringify(r.state));
        // 不强制 reload，避免打断用户；下次打开/刷新即见云端进度
        renderPanel('已同步云端进度');
      }
    }).catch(function () {});
  }

  // ---- 右下角同步小面板（可关）----
  // 消息提示：写进卡片内的提示条（不弹窗，保持账户页风格）
  var _panelMsg = '';
  function notice(msg) { _panelMsg = msg || ''; }

  // 把云同步卡片渲染进账户页的 #cs-slot（由 app.js 的 accountPage 提供）
  // 未配置时插槽保持空白，账户页外观零变化；不再使用任何浮动面板。
  function renderPanel(msg) {
    if (msg !== undefined) notice(msg);
    if (CFG.ui === false || !configured()) return;
    var slot = document.getElementById('cs-slot');
    if (!slot) return; // 账户页未打开

    var s = getSession();
    var tip = _panelMsg ? '<div class="subtle" style="color:#8b5cf6;margin-bottom:8px">' + esc(_panelMsg) + '</div>' : '';
    var html = '<div class="card"><div class="card-head"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6.5 19a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 17.9 9.2A4 4 0 0 1 17.5 19h-11z"/></svg><span>云同步</span></div>';

    if (s) {
      var email = esc((s.user && (s.user.email || s.user.phone)) || '已登录用户');
      html += tip +
        '<div class="kv"><span class="kv-k">状态</span><span class="kv-v ok">已连接云端</span></div>' +
        '<div class="kv"><span class="kv-k">账号</span><span class="kv-v">' + email + '</span></div>' +
        '<div class="kv"><span class="kv-k">学习数据</span><span class="kv-v">自动同步到云端，换设备不丢</span></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" id="cs-pull">下载云端进度</button>' +
        '<button class="btn btn-sm" id="cs-push">上传本机进度</button>' +
        '<button class="btn btn-sm" id="cs-out">退出云同步</button>' +
        '</div>';
    } else {
      html += tip +
        '<div class="subtle" style="margin-bottom:10px">登录后学习进度自动存入云端，换手机、清缓存都不丢。</div>' +
        '<div class="field"><label>邮箱</label><input id="cs-email" type="email" placeholder="name@example.com" autocomplete="email" /></div>' +
        '<div class="field"><label>验证码</label>' +
        '<div class="otp-row"><input id="cs-code" type="text" inputmode="numeric" maxlength="6" placeholder="收到的验证码" autocomplete="one-time-code" />' +
        '<button type="button" class="btn btn-sm" id="cs-send">发验证码</button></div></div>' +
        '<button class="btn btn-primary btn-block" id="cs-login">登录 / 开启云同步</button>';
    }
    html += '</div>';
    slot.innerHTML = html;

    // 绑定事件（用 id 直接绑，不走 app.js 的 data-act 委托，两边互不干扰）
    var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; };
    if (s) {
      bind('cs-pull', function () {
        pull().then(function (r) {
          if (r.has && r.state) {
            rawSet(STATE_KEY, JSON.stringify(r.state));
            renderPanel('已下载云端进度，刷新页面后生效');
          } else renderPanel('云端暂无进度，可先上传本机');
        }).catch(function (e) { renderPanel('下载失败：' + e.message); });
      });
      bind('cs-push', function () {
        var raw = localStorage.getItem(STATE_KEY);
        if (!raw) return renderPanel('本机暂无进度');
        var st=JSON.parse(raw); push(st).then(function () { reportStats(st, getSession()); renderPanel('已上传本机进度'); })
          .catch(function (e) { renderPanel('上传失败：' + e.message); });
      });
      bind('cs-out', function () { signOut(); renderPanel('已退出云同步'); });
    } else {
      bind('cs-send', function () {
        var emailEl = document.getElementById('cs-email');
        sendCode(emailEl && emailEl.value).then(function () { renderPanel('验证码已发到邮箱，请注意查收'); })
          .catch(function (e) { renderPanel('发送失败：' + e.message); });
      });
      bind('cs-login', function () {
        var emailEl = document.getElementById('cs-email');
        var codeEl = document.getElementById('cs-code');
        verifyCode(emailEl && emailEl.value, codeEl && codeEl.value).then(function () {
          boot(); renderPanel('登录成功，云同步已开启');
        }).catch(function (e) { renderPanel('登录失败：' + e.message); });
      });
    }
  }

  // 账户页是动态渲染的：监听 DOM 变化，一旦 #cs-slot 出现就填充卡片
  function watchSlot() {
    if (!configured()) return;
    if (document.getElementById('cs-slot')) { renderPanel(); return; }
    var obs = new MutationObserver(function () {
      if (document.getElementById('cs-slot')) { renderPanel(); obs.disconnect(); scheduleWatch(); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  function scheduleWatch() {
    // 账户页每次重绘会重建 slot，重新挂一个观察器
    setTimeout(watchSlot, 60);
  }

  FC.CloudSync = {
    configure: function (c) {
      CFG = c || CFG;
      BASE = String(CFG.url || '').replace(/\/+$/, '');
      ANON = String(CFG.anonKey || '');
      PUSH_DELAY = CFG.pushDelay || 2000;
      watchSlot();
    },
    configured: configured,
    available: function () { return configured() && online(); },
    getSession: getSession,
    signOut: signOut,
    sendCode: sendCode,
    verifyCode: verifyCode,
    pull: pull,
    push: push,
    boot: boot,
    mount: renderPanel
  };

  // DOM 就绪后监听账户页插槽 + 启动拉取
  function start() {
    watchSlot();
    boot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
