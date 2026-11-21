
    // 启动异常可视化：脚本出错时不再白屏，而是把原因显示出来，便于反馈
    window.addEventListener('error', function (e) {
      var b = document.getElementById('bootErr');
      if (!b || !b.style) return;
      var msg = (e && e.message) || '未知错误';
      var where = '';
      if (e && e.filename) {
        var parts = String(e.filename).split('/');
        where = ' @ ' + parts[parts.length - 1] + ':' + (e.lineno || 0);
      }
      b.style.display = 'block';
      b.textContent = '启动失败：' + msg + where;
    });



