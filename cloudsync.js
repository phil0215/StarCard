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
      try { push(JSON.parse(raw)); } catch (e) {}
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

  // ---- 左下角同步小面板：默认收起为胶囊，点击展开，避免遮挡侧边栏与内容 ----
  var panelOpen = false;
  var PANEL_CSS = 'position:fixed;left:14px;bottom:14px;z-index:99999;' +
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e9e6ff;';
  var BOX_CSS = PANEL_CSS + 'max-width:300px;background:rgba(28,22,48,.96);' +
    'border:1px solid rgba(168,140,255,.35);border-radius:14px;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.4);backdrop-filter:blur(8px);';

  function renderPanel(msg) {
    // 未配置 / 关闭 UI 时完全不挂载面板，保持原网页外观零变化
    if (CFG.ui === false || !configured()) return;
    if (msg) panelOpen = true; // 有操作反馈时自动展开，保证提示可见
    var box = document.getElementById('cs-panel');
    if (!box) {
      box = document.createElement('div');
      box.id = 'cs-panel';
      document.body.appendChild(box);
    }
    var s = getSession();

    // 收起态：一枚小胶囊
    if (!panelOpen) {
      box.style.cssText = PANEL_CSS;
      var chipLabel = s ? '云同步已连接' : '登录云同步';
      box.innerHTML = '<button id="cs-chip" style="display:flex;align-items:center;gap:7px;padding:9px 13px;border:0;' +
        'background:rgba(28,22,48,.96);border:1px solid rgba(168,140,255,.35);border-radius:999px;' +
        'color:#e9e6ff;font:13px/1 inherit;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)">' +
        '☁ <span>' + esc(chipLabel) + '</span></button>';
      document.getElementById('cs-chip').onclick = function () { panelOpen = true; renderPanel(); };
      return;
    }

    // 展开态：完整面板
    box.style.cssText = BOX_CSS;
    var notice = msg ? '<div style="color:#b39dff;font-size:12px;margin-bottom:6px">' + esc(msg) + '</div>' : '';
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<div style="font-weight:600">' + (s ? '☁ 云同步已连接' : '☁ 登录以开启云同步') + '</div>' +
      '<button id="cs-min" title="收起" style="border:0;background:transparent;color:#bdb4e6;cursor:pointer;font-size:15px;line-height:1;padding:2px 6px">−</button></div>';
    var minBtn = function () { var b = document.getElementById('cs-min'); if (b) b.onclick = function () { panelOpen = false; renderPanel(); }; };

    if (s) {
      var email = esc((s.user && (s.user.email || s.user.phone)) || '已登录用户');
      box.innerHTML = notice +
        '<div style="padding:12px">' + head +
        '<div style="font-size:12px;color:#bdb4e6;margin-bottom:10px">' + email + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button id="cs-pull">下载云端</button>' +
        '<button id="cs-push">上传本机</button>' +
        '<button id="cs-out">退出</button>' +
        '</div></div>';
      minBtn();
      var pullBtn = document.getElementById('cs-pull');
      var pushBtn = document.getElementById('cs-push');
      var outBtn = document.getElementById('cs-out');
      var btnCss = 'flex:1;min-width:80px;padding:7px 9px;border:1px solid rgba(168,140,255,.4);' +
        'background:rgba(168,140,255,.14);color:#e9e6ff;border-radius:9px;cursor:pointer';
      [pullBtn, pushBtn, outBtn].forEach(function (b) { if (b) b.style.cssText = btnCss; });
      if (pullBtn) pullBtn.onclick = function () {
        pull().then(function (r) {
          if (r.has && r.state) {
            rawSet(STATE_KEY, JSON.stringify(r.state));
            renderPanel('已下载云端进度，刷新后生效');
          } else renderPanel('云端暂无进度');
        }).catch(function (e) { renderPanel('下载失败：' + e.message); });
      };
      if (pushBtn) pushBtn.onclick = function () {
        var raw = localStorage.getItem(STATE_KEY);
        if (!raw) return renderPanel('本机暂无进度');
        push(JSON.parse(raw)).then(function () { renderPanel('已上传本机进度'); })
          .catch(function (e) { renderPanel('上传失败：' + e.message); });
      };
      if (outBtn) outBtn.onclick = function () { signOut(); panelOpen = false; renderPanel('已退出云同步'); };
    } else {
      box.innerHTML = notice +
        '<div style="padding:12px">' + head +
        '<input id="cs-email" type="email" placeholder="邮箱" style="width:100%;box-sizing:border-box;margin-bottom:6px;padding:7px 9px;border-radius:9px;border:1px solid rgba(168,140,255,.4);background:rgba(255,255,255,.06);color:#fff">' +
        '<div style="display:flex;gap:6px">' +
        '<input id="cs-code" type="text" inputmode="numeric" placeholder="验证码" style="flex:1;min-width:0;padding:7px 9px;border-radius:9px;border:1px solid rgba(168,140,255,.4);background:rgba(255,255,255,.06);color:#fff">' +
        '<button id="cs-send" style="padding:7px 9px;border-radius:9px;border:1px solid rgba(168,140,255,.4);background:rgba(168,140,255,.14);color:#e9e6ff;cursor:pointer;white-space:nowrap">发验证码</button>' +
        '</div>' +
        '<button id="cs-login" style="width:100%;margin-top:6px;padding:8px;border-radius:9px;border:0;background:linear-gradient(135deg,#8b5cf6,#6d3fe0);color:#fff;font-weight:600;cursor:pointer">登录</button>' +
        '</div>';
      minBtn();
      var emailEl = document.getElementById('cs-email');
      var codeEl = document.getElementById('cs-code');
      document.getElementById('cs-send').onclick = function () {
        sendCode(emailEl.value).then(function () { renderPanel('验证码已发到邮箱'); })
          .catch(function (e) { renderPanel('发送失败：' + e.message); });
      };
      document.getElementById('cs-login').onclick = function () {
        verifyCode(emailEl.value, codeEl.value).then(function () {
          boot(); renderPanel('登录成功，云同步已开启');
        }).catch(function (e) { renderPanel('登录失败：' + e.message); });
      };
    }
  }

  FC.CloudSync = {
    configure: function (c) {
      CFG = c || CFG;
      BASE = String(CFG.url || '').replace(/\/+$/, '');
      ANON = String(CFG.anonKey || '');
      PUSH_DELAY = CFG.pushDelay || 2000;
      renderPanel();
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

  // DOM 就绪后挂载面板 + 启动拉取
  function start() {
    renderPanel();
    boot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
