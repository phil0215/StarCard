
    // 启动异常可视化 + 偶发资源失败自愈
    // 背景：GitHub Pages 边缘节点会间歇性返回 503，某个 js 没加载成功时整页会报
    // "FC.xxx is not a function" 并白屏。这里捕获资源错误后自动整页重拉一次（防循环）。
    (function () {
      var RETRY_KEY = 'sc_brt';

      function canRetry() {
        try { return !sessionStorage.getItem(RETRY_KEY); } catch (e) { return false; }
      }
      function markRetry() {
        try { sessionStorage.setItem(RETRY_KEY, String(Date.now())); } catch (e) {}
      }
      function retryOnce() {
        if (!canRetry()) return false;
        markRetry();
        try {
          var u = new URL(location.href);
          u.searchParams.set('r', '1');
          location.replace(u.toString());
          return true;
        } catch (e) { return false; }
      }

      // 捕获阶段才能拿到 script/link 的资源加载失败（这类错误不冒泡）
      window.addEventListener('error', function (e) {
        var t = e && e.target;
        if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
          // 只自愈本站资源；外链（登录 SDK 的 CDN）失败不能整页重载，否则会丢掉用户输入
          var src = t.src || t.href || '';
          var sameOrigin = false;
          try { sameOrigin = !!src && new URL(src, location.href).origin === location.origin; } catch (x) {}
          if (sameOrigin && retryOnce()) return;
        }
        var b = document.getElementById('bootErr');
        if (!b || !b.style) return;
        var msg = (e && e.message) || (t && t.src ? '资源加载失败：' + String(t.src).split('/').pop() : '未知错误');
        var where = '';
        if (e && e.filename) {
          var parts = String(e.filename).split('/');
          where = ' @ ' + parts[parts.length - 1] + ':' + (e.lineno || 0);
        }
        b.style.display = 'block';
        b.textContent = '启动失败：' + msg + where;
      }, true);

      // 兜底：资源都没报错但核心没就绪（例如脚本被截断）也重试一次
      window.addEventListener('load', function () {
        setTimeout(function () {
          var hasCore = (typeof FC !== 'undefined' && FC && typeof FC.defaultState === 'function');
          var needComm = !!document.querySelector('script[src*="community.js"]');
          var hasComm = (typeof FC !== 'undefined' && FC && !!FC.Community);
          var ok = hasCore && (!needComm || hasComm);
          if (ok) {
            try { sessionStorage.removeItem(RETRY_KEY); } catch (e) {}
            return;
          }
          if (retryOnce()) return;
          var b = document.getElementById('bootErr');
          if (b && b.style) {
            b.style.display = 'block';
            b.textContent = '启动失败：核心脚本没加载完整，请刷新页面重试';
          }
        }, 0);
      });
    })();


