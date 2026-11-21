/* ===== js/classroom.js ===== 班级（真实班级 · 密钥加入 · 学习量榜） */
(function () {
  var FC = window.FC = window.FC || {};
  var BASE = '';
  var ANON = '';

  function readCfg() {
    var cfg = (FC.CLOUD_SYNC_CONFIG || {});
    BASE = String(cfg.url || '').replace(/\/+$/, '');
    ANON = String(cfg.anonKey || '');
    return { base: BASE, anon: ANON };
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

  function hasSession() {
    return !!session();
  }

  function rpc(fn, body) {
    var c = readCfg();
    if (!c.base || !c.anon) return Promise.reject(new Error('云同步未配置'));
    var s = session();
    if (!s || !s.access_token) return Promise.resolve({ ok: false, code: 'no_auth', msg: '请先登录' });

    return fetch(c.base + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': c.anon,
        'Authorization': 'Bearer ' + s.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var data;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = (data && (data.message || data.msg || data.hint)) || ('HTTP ' + r.status);
          if (r.status === 401 || r.status === 403) return { ok: false, code: 'no_auth', msg: '登录已过期，请重新登录' };
          return { ok: false, code: 'http_' + r.status, msg: msg };
        }
        if (data && typeof data === 'object') return data;
        return { ok: false, code: 'empty', msg: '服务端没有返回数据' };
      });
    }).catch(function (e) {
      return { ok: false, code: 'network', msg: (e && e.message) || '网络不可用' };
    });
  }

  function fmtKey(k) {
    var s = String(k || '').toUpperCase();
    return s.length === 8 ? (s.slice(0, 4) + '-' + s.slice(4)) : s;
  }

  function cleanKey(k) {
    return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  function copy(text) {
    var t = String(text || '');
    if (!t) return Promise.resolve(false);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(t).then(function () { return true; }).catch(function () { return fallback(t); });
      }
    } catch (e) {}
    return Promise.resolve(fallback(t));
  }

  function fallback(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  FC.Classroom = {
    available: available,
    hasSession: hasSession,
    session: session,
    fmtKey: fmtKey,
    cleanKey: cleanKey,
    copy: copy,

    list: function () {
      return rpc('class_mine', {});
    },
    detail: function (classId) {
      return rpc('class_detail', { p_class_id: classId });
    },
    create: function (form) {
      form = form || {};
      return rpc('class_create', {
        p_name: String(form.name || '').trim(),
        p_slogan: String(form.slogan || '').trim(),
        p_daily_goal: parseInt(form.daily_goal, 10) || 30,
        p_total_goal: parseInt(form.total_goal, 10) || 1000,
        p_max_members: parseInt(form.max_members, 10) || 50,
        p_ends_on: form.ends_on || null
      });
    },
    join: function (key) {
      return rpc('class_join', { p_key: cleanKey(key) });
    },
    leave: function (classId) {
      return rpc('class_leave', { p_class_id: classId });
    },
    newKey: function (classId) {
      return rpc('class_new_key', { p_class_id: classId });
    },
    kick: function (classId, userId) {
      return rpc('class_kick', { p_class_id: classId, p_user_id: userId });
    }
  };
})();
