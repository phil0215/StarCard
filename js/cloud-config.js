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
  // 站点根路径：页面可以放在一级子目录（/books/、/stats/…），资源仍统一从根取
  FC.siteRoot = function () {
    var cur = (window.location && window.location.pathname) || '/';
    var mark = '/StarCard/';
    var at = cur.indexOf(mark);
    if (at >= 0) return cur.slice(0, at + mark.length);
    var seg = cur.split('/').filter(function (x) { return !!x; });
    var known = { books: 1, 'class': 1, deskmate: 1, battle: 1, stats: 1, settings: 1, browse: 1, store: 1 };
    while (seg.length && (known[seg[seg.length - 1]] || /\.[a-z0-9]+$/i.test(seg[seg.length - 1]))) seg.pop();
    return '/' + seg.join('/') + (seg.length ? '/' : '');
  };

  FC.assetUrl = function (path) {
    if (!path) return path;
    var out = String(path);
    if (!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(out) && out.charAt(0) !== '/' && out.charAt(0) !== '#') {
      out = FC.siteRoot() + out;
    }
    var search = (window.location && window.location.search) || '';
    var m = /(?:^|[?&])sharecode=([^&#]+)/.exec(search);
    if (!m) return out;
    var sep = out.indexOf('?') >= 0 ? '&' : '?';
    return out + sep + 'sharecode=' + encodeURIComponent(m[1]);
  };
})();


