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


