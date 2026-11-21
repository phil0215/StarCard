/* ============================================================
 * 闪星卡 StarCard · 社区（FC.Community）
 * ------------------------------------------------------------
 * 发帖 / 评论 / 点赞 / 分享词库 / 互相邀请做同桌。
 *
 * 身份与云同步共用同一套 Supabase 会话（FC.CloudSync.getSession），
 * 不新建账号体系；未登录时只读浏览，写操作一律要求登录。
 *
 * 只依赖 fetch 直连 Supabase REST + Storage，不引入任何 SDK。
 * 权限全部由数据库 RLS 收口（见 sql/community.sql）：
 *   - 帖子 / 评论 / 点赞：所有人可读，只有本人能写自己的行
 *   - 同桌邀请：只有收发双方可见
 * ============================================================ */
(function (global) {
  'use strict';
  var FC = global.FC || (global.FC = {});

  function cfg() { return FC.CLOUD_SYNC_CONFIG || {}; }
  function base() { return String(cfg().url || '').replace(/\/+$/, ''); }
  function anon() { return String(cfg().anonKey || ''); }
  function configured() { return !!(base() && anon()); }

  function session() {
    try { return FC.CloudSync && FC.CloudSync.getSession ? FC.CloudSync.getSession() : null; }
    catch (e) { return null; }
  }
  function uid() {
    var s = session();
    return (s && s.user && (s.user.id || s.user.sub)) || '';
  }
  function sessionEmail() {
    var s = session();
    return (s && s.user && (s.user.email || s.user.phone)) || '';
  }

  // 统一错误文案：网络被拦、未登录、权限不足、字段冲突各说清楚
  function humanError(e) {
    if (!e) return '未知错误';
    if (e.status === 401) return '登录已过期，请重新登录';
    if (e.status === 403) return '没有权限做这件事';
    if (e.status === 409) return '已经存在相同的记录';
    if (e.status === 413) return '文件太大，单次最多 5MB';
    var m = String(e.message || e);
    if (/Failed to fetch|NetworkError|load failed|fetch/i.test(m)) {
      return '连不上社区服务器（网络不通或被拦截）';
    }
    return m;
  }

  function request(path, opts) {
    if (!configured()) return Promise.reject(new Error('社区服务未配置'));
    opts = opts || {};
    var s = session();
    var headers = { 'apikey': anon() };
    if (opts.body != null && !opts.raw) headers['Content-Type'] = 'application/json';
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    if (s && s.access_token) headers['Authorization'] = 'Bearer ' + s.access_token;
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body != null) init.body = opts.raw ? opts.body : JSON.stringify(opts.body);
    return fetch(base() + path, init).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        if (t) { try { data = JSON.parse(t); } catch (e) { data = t; } }
        if (!r.ok) {
          var err = new Error((data && (data.message || data.error_description || data.msg)) || ('HTTP ' + r.status));
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function (e) {
      var err = new Error(humanError(e));
      err.network = true;
      throw err;
    });
  }

  // ---------------------------------------------------------------- 登录
  function sendCode(email) {
    if (!(FC.CloudSync && FC.CloudSync.sendCode)) return Promise.reject(new Error('云同步模块未加载'));
    return FC.CloudSync.sendCode(email);
  }
  function verifyCode(email, code) {
    if (!(FC.CloudSync && FC.CloudSync.verifyCode)) return Promise.reject(new Error('云同步模块未加载'));
    return FC.CloudSync.verifyCode(email, code);
  }

  // ---------------------------------------------------------------- 帖子
  // 一次取回点赞人与评论 id，前端直接算数量，省掉额外计数接口
  function feed(limit, before) {
    var n = Math.max(1, Math.min(50, limit || 20));
    var q = '/rest/v1/community_posts?select=*,likes:community_likes(user_id),comments:community_comments(id)' +
      '&order=created_at.desc&limit=' + n;
    if (before) q += '&created_at=lt.' + encodeURIComponent(before);
    return request(q).then(function (rows) {
      return (rows || []).map(normalizePost);
    });
  }
  function normalizePost(r) {
    var likes = (r.likes || []).map(function (x) { return x.user_id; });
    return {
      id: r.id,
      authorId: r.author_id,
      authorName: r.author_name || '学习者',
      avatarColor: Number(r.avatar_color) || 0,
      kind: r.kind || 'post',
      title: r.title || '',
      body: r.body || '',
      deckName: r.deck_name || '',
      deckWords: Number(r.deck_words) || 0,
      resourcePath: r.resource_path || '',
      resourceSize: Number(r.resource_size) || 0,
      createdAt: r.created_at,
      likeUsers: likes,
      likeCount: likes.length,
      commentCount: (r.comments || []).length
    };
  }

  function createPost(p) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    var row = {
      author_id: uid(),
      author_name: String(p.authorName || '学习者').slice(0, 24),
      avatar_color: Number(p.avatarColor) || 0,
      kind: p.kind === 'resource' ? 'resource' : 'post',
      title: String(p.title || '').slice(0, 60),
      body: String(p.body || '').slice(0, 2000),
      deck_name: String(p.deckName || '').slice(0, 60),
      deck_words: Number(p.deckWords) || 0,
      resource_path: p.resourcePath || '',
      resource_size: Number(p.resourceSize) || 0
    };
    return request('/rest/v1/community_posts?select=*', {
      method: 'POST', body: row, headers: { 'Prefer': 'return=representation' }
    }).then(function (rows) { return rows && rows[0] ? normalizePost(rows[0]) : null; });
  }

  function removePost(id) {
    return request('/rest/v1/community_posts?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // ---------------------------------------------------------------- 点赞
  function like(postId, on) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    if (on) {
      return request('/rest/v1/community_likes', {
        method: 'POST', body: { post_id: postId, user_id: uid() }
      }).catch(function (e) {
        if (e.status === 409) return null; // 已经点过，忽略
        throw e;
      });
    }
    return request('/rest/v1/community_likes?post_id=eq.' + encodeURIComponent(postId) +
      '&user_id=eq.' + encodeURIComponent(uid()), { method: 'DELETE' });
  }

  // ---------------------------------------------------------------- 评论
  function comments(postId) {
    return request('/rest/v1/community_comments?post_id=eq.' + encodeURIComponent(postId) +
      '&select=*&order=created_at.asc&limit=200').then(function (rows) {
      return (rows || []).map(function (r) {
        return {
          id: r.id, authorId: r.author_id, authorName: r.author_name || '学习者',
          body: r.body || '', createdAt: r.created_at
        };
      });
    });
  }
  function addComment(postId, body) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    var text = String(body || '').trim();
    if (!text) return Promise.reject(new Error('评论不能为空'));
    return request('/rest/v1/community_comments?select=*', {
      method: 'POST',
      body: {
        post_id: postId, author_id: uid(),
        author_name: String(arguments[2] || '学习者').slice(0, 24),
        body: text.slice(0, 500)
      },
      headers: { 'Prefer': 'return=representation' }
    });
  }

  // ---------------------------------------------------------------- 同桌邀请
  function invite(toUser, message, postId, fromName) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    if (!toUser) return Promise.reject(new Error('找不到对方的账号'));
    if (toUser === uid()) return Promise.reject(new Error('不能邀请自己'));
    var row = {
      from_user: uid(),
      from_name: String(fromName || '学习者').slice(0, 24),
      to_user: toUser,
      message: String(message || '').slice(0, 120)
    };
    if (postId) row.post_id = postId;
    return request('/rest/v1/deskmate_invites?select=*', {
      method: 'POST', body: row, headers: { 'Prefer': 'return=representation' }
    });
  }
  function inbox() {
    if (!uid()) return Promise.resolve([]);
    return request('/rest/v1/deskmate_invites?to_user=eq.' + encodeURIComponent(uid()) +
      '&status=eq.pending&select=*&order=created_at.desc').then(function (rows) { return rows || []; });
  }
  function outbox() {
    if (!uid()) return Promise.resolve([]);
    return request('/rest/v1/deskmate_invites?from_user=eq.' + encodeURIComponent(uid()) +
      '&status=eq.pending&select=*').then(function (rows) { return rows || []; });
  }
  function respond(id, status) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    return request('/rest/v1/deskmate_invites?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      body: { status: status === 'accepted' ? 'accepted' : 'declined', responded_at: new Date().toISOString() },
      headers: { 'Prefer': 'return=minimal' }
    });
  }

  // ---------------------------------------------------------------- 资源（分享词库）
  function safeName(name) {
    return String(name || 'deck').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 40) || 'deck';
  }
  function uploadDeck(deck) {
    if (!uid()) return Promise.reject(new Error('请先登录'));
    if (!deck || !deck.id) return Promise.reject(new Error('请选择要分享的牌组'));
    var text;
    try {
      text = FC.SrcdCodec.encode([deck], {}, '闪星卡（StarCard）· 社区分享');
    } catch (e) {
      return Promise.reject(new Error('打包牌组失败：' + e.message));
    }
    var path = uid() + '/' + Date.now() + '-' + safeName(deck.name) + '.srcd';
    return request('/storage/v1/object/community/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST',
      raw: true,
      body: text,
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' }
    }).then(function () {
      return { path: path, size: text.length, words: (deck.cards || []).length };
    });
  }
  function publicUrl(path) {
    return base() + '/storage/v1/object/public/community/' + String(path).split('/').map(encodeURIComponent).join('/');
  }
  // 下载分享的词库并并入本机（复用主程序的导入逻辑）
  function importShared(path, name) {
    return fetch(publicUrl(path)).then(function (r) {
      if (!r.ok) throw new Error('下载失败（HTTP ' + r.status + '）');
      return r.text();
    }).then(function (text) {
      if (!(global.App && global.App.doImport)) throw new Error('导入模块未就绪');
      global.App.doImport(text, safeName(name || 'shared') + '.srcd');
      return true;
    });
  }

  FC.Community = {
    configured: configured,
    available: function () { return configured(); },
    session: session,
    uid: uid,
    email: sessionEmail,
    sendCode: sendCode,
    verifyCode: verifyCode,
    feed: feed,
    createPost: createPost,
    removePost: removePost,
    like: like,
    comments: comments,
    addComment: addComment,
    invite: invite,
    inbox: inbox,
    outbox: outbox,
    respond: respond,
    uploadDeck: uploadDeck,
    publicUrl: publicUrl,
    importShared: importShared,
    humanError: humanError
  };
})(typeof window !== 'undefined' ? window : this);
