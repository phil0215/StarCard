/* ===== js/anki-ui.js ===== */
/**
 * 闪星卡（StarCard）· Anki 界面扩展
 * 依赖 core.js + anki.js + ui.js，在 ui.js 之后、app.js 之前加载。
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  const FCUI = global.FCUI;
  if (!FC || !FCUI) throw new Error('anki-ui.js 需要先加载 core.js / anki.js / ui.js');

  const esc = FCUI.esc;
  const icon = FCUI.icon;
  const DAY = FC.DAY_MS;

  const STATE_LABEL = {
    new: '新卡', learning: '学习中', review: '复习', relearning: '重学'
  };

  function statusText(card) {
    if (card.suspended) return '已暂停';
    if (card.buried) return '已搁置';
    return STATE_LABEL[card.state] || card.state;
  }

  function dueText(card, now) {
    if (card.state === FC.STATE_NEW) return '—';
    if (!card.scheduling.due) return '—';
    const t = Date.parse(card.scheduling.due);
    if (isNaN(t)) return '—';
    const diff = t - now;
    if (diff <= 0) return '待复习';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' 分';
    const hours = Math.round(diff / 3600000);
    if (hours < 24) return hours + ' 小时';
    const days = Math.round(diff / DAY);
    if (days < 31) return days + ' 天';
    if (days < 365) return (days / 30).toFixed(1) + ' 月';
    return (days / 365).toFixed(1) + ' 年';
  }

  function flagDot(flag) {
    if (!flag) return '';
    return '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[flag] + '"></span>';
  }

  // ---------------------------------------------------------------- 浏览器
  function filteredRows(app) {
    const b = app.browser;
    const now = Date.now();
    let rows = FC.Search.run(app.state.decks, b.query || '', now);
    if (b.deckId) rows = rows.filter(function (r) { return r.deck.id === b.deckId; });
    const key = b.sortKey || 'due';
    const dir = b.sortDir === 'asc' ? 1 : -1;
    rows.sort(function (x, y) {
      let a = 0, c = 0;
      if (key === 'due') {
        a = x.card.scheduling.due ? Date.parse(x.card.scheduling.due) : 0;
        c = y.card.scheduling.due ? Date.parse(y.card.scheduling.due) : 0;
      } else if (key === 'front') {
        return dir * String(x.card.front).localeCompare(String(y.card.front), 'zh');
      } else if (key === 'deck') {
        return dir * String(x.deck.name).localeCompare(String(y.deck.name), 'zh');
      } else if (key === 'state') {
        return dir * String(x.card.state).localeCompare(String(y.card.state));
      } else if (key === 'interval') {
        a = x.card.scheduling.scheduledDays; c = y.card.scheduling.scheduledDays;
      } else if (key === 'ease') {
        a = x.card.scheduling.difficulty; c = y.card.scheduling.difficulty;
      } else if (key === 'reps') {
        a = x.card.scheduling.reps; c = y.card.scheduling.reps;
      } else if (key === 'created') {
        a = Date.parse(x.card.createdAt); c = Date.parse(y.card.createdAt);
      }
      return dir * (a - c);
    });
    return rows;
  }

  function selectedIds(app) {
    const b = app.browser;
    const out = [];
    for (const k in b.selected) if (Object.prototype.hasOwnProperty.call(b.selected, k) && b.selected[k]) out.push(k);
    return out;
  }

  function browserPage(app) {
    const rows = filteredRows(app);
    const total = rows.length;
    const limit = app.browser.limit || 300;
    const shown = rows.slice(0, limit);
    const selCount = selectedIds(app).length;

    let html = '<div class="browser-page">';
    html += '<header class="topbar browser-top">' +
      '<button class="btn-icon" data-act="browser-close" title="返回">' + icon('chevronLeft', 'i18') + '</button>' +
      '<div class="tb-main"><div class="topbar-t"><h1>浏览</h1></div>' +
      '<p>' + total + ' 张卡片' + (selCount ? ' · 已选 ' + selCount : '') + '</p></div>' +
      '<div class="tb-actions"><button class="btn btn-sm btn-primary" data-act="card-new-global">' +
      icon('plus', 'i14') + '添加卡片</button></div></header>';

    html += '<div class="browser-search">' +
      '<span class="search-ico">' + icon('search', 'i16') + '</span>' +
      '<input id="brQuery" data-act="br-search" value="' + esc(app.browser.query || '') + '" ' +
      'placeholder="搜索：deck:英语 tag:动词 is:due flag:1 -is:suspended" autocomplete="off" spellcheck="false" />' +
      '<button class="btn btn-sm" data-act="br-filter">' + icon('filter', 'i14') + '筛选</button>' +
      '<button class="btn btn-sm" data-act="br-clear">清除</button></div>';

    html += '<div class="browser-toolbar">' +
      '<label class="br-check-all"><input type="checkbox" data-act="br-check-all" ' +
      (shown.length > 0 && shown.every(function (r) { return app.browser.selected[r.card.id]; }) ? 'checked' : '') + ' /> 全选</label>' +
      '<span class="br-sep"></span>' +
      '<button class="btn btn-sm" data-act="br-pause" ' + (selCount ? '' : 'disabled') + '>' + icon('pause', 'i14') + '暂停</button>' +
      '<button class="btn btn-sm" data-act="br-unsuspend" ' + (selCount ? '' : 'disabled') + '>' + icon('play', 'i14') + '恢复</button>' +
      '<button class="btn btn-sm" data-act="br-flag" ' + (selCount ? '' : 'disabled') + '>' + icon('flag', 'i14') + '标记</button>' +
      '<button class="btn btn-sm" data-act="br-tag" ' + (selCount ? '' : 'disabled') + '>' + icon('tag', 'i14') + '加标签</button>' +
      '<button class="btn btn-sm" data-act="br-reset" ' + (selCount ? '' : 'disabled') + '>' + icon('rotate', 'i14') + '重置</button>' +
      '<button class="btn btn-sm" data-act="br-move" ' + (selCount ? '' : 'disabled') + '>移动</button>' +
      '<button class="btn btn-sm btn-danger" data-act="br-delete" ' + (selCount ? '' : 'disabled') + '>' + icon('trash', 'i14') + '删除</button>' +
      '<span class="br-grow"></span>' +
      '<button class="btn btn-sm" data-act="br-csv">' + icon('download', 'i14') + '导出 CSV</button>' +
      '</div>';

    html += '<div class="browser-body">' +
      '<div class="browser-table-wrap" id="brTable">' + browserTable(app) + '</div>' +
      '<aside class="browser-side" id="brPreview">' + browserPreview(app) + '</aside>' +
      '</div>';

    if (total > limit) {
      html += '<div class="browser-more">只显示前 ' + limit + ' 条。' +
        '<button class="btn btn-sm" data-act="br-more">显示更多</button></div>';
    }
    html += '</div>';
    return html;
  }

  function browserTable(app) {
    const rows = filteredRows(app);
    const limit = app.browser.limit || 300;
    const shown = rows.slice(0, limit);
    const now = Date.now();

    if (shown.length === 0) {
      return '<div class="empty" style="padding:60px 20px">' +
        '<div class="empty-ico">' + icon('search', 'i30') + '</div>' +
        '<div class="empty-title">没有匹配的卡片</div>' +
        '<div class="empty-t">未找到匹配的卡片，可调整筛选条件。</div></div>';
    }

    let html = '<table class="br-table"><thead><tr>' +
      '<th class="c-check"></th>' +
      '<th class="c-front" data-act="br-sort" data-key="front">正面</th>' +
      '<th data-act="br-sort" data-key="deck">牌组</th>' +
      '<th data-act="br-sort" data-key="state">状态</th>' +
      '<th data-act="br-sort" data-key="due">到期</th>' +
      '<th data-act="br-sort" data-key="interval">间隔</th>' +
      '<th data-act="br-sort" data-key="ease">难度</th>' +
      '<th data-act="br-sort" data-key="reps">复习</th>' +
      '<th class="c-tags">标签</th></tr></thead><tbody>';

    for (let i = 0; i < shown.length; i++) {
      const r = shown[i];
      const c = r.card;
      const checked = app.browser.selected[c.id] ? 'checked' : '';
      const active = app.browser.previewId === c.id ? ' active' : '';
      html += '<tr class="br-row' + active + '" data-act="br-row" data-id="' + esc(c.id) + '">' +
        '<td class="c-check"><input type="checkbox" data-act="br-check" data-id="' + esc(c.id) + '" ' + checked + ' /></td>' +
        '<td class="c-front"><div class="br-front">' + flagDot(c.flags) + esc(c.front) + '</div>' +
        '<div class="br-sub">' + esc(String(c.back || '').slice(0, 60)) + '</div></td>' +
        '<td class="br-deck">' + esc(r.deck.name) + '</td>' +
        '<td><span class="st st-' + c.state + '">' + statusText(c) + '</span></td>' +
        '<td>' + dueText(c, now) + '</td>' +
        '<td>' + (c.scheduling.scheduledDays ? c.scheduling.scheduledDays + ' 天' : '—') + '</td>' +
        '<td>' + (c.scheduling.difficulty ? c.scheduling.difficulty.toFixed(1) : '—') + '</td>' +
        '<td>' + c.scheduling.reps + '</td>' +
        '<td class="c-tags">' + c.tags.slice(0, 3).map(function (t) {
          return '<span class="chip gray">' + esc(t) + '</span>';
        }).join('') + '</td></tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function browserPreview(app) {
    const b = app.browser;
    if (!b.previewId) {
      return '<div class="br-preview-empty">' + icon('eye', 'i28') +
        '<div>选中一张卡片查看预览</div></div>';
    }
    const r = app.findCard(b.previewId);
    if (!r) return '<div class="br-preview-empty">卡片已不存在</div>';
    const c = r.card;
    const front = FC.renderCardHtml(c, 'front');
    const back = FC.renderCardHtml(c, 'back');

    return '<div class="br-preview">' +
      '<div class="br-preview-head"><div class="br-preview-title">卡片预览</div>' +
      '<button class="btn-icon" data-act="br-preview-close" title="关闭">' + icon('x', 'i16') + '</button></div>' +
      '<div class="br-preview-box"><div class="br-preview-label">正面</div><div class="field-html">' + front + '</div>' +
      '<hr class="br-hr" /><div class="br-preview-label">背面</div><div class="field-html">' + back + '</div></div>' +
      '<div class="br-meta">' +
      '<div class="kv"><span class="kv-k">类型</span><span class="kv-v">' + esc(typeName(c.notetype)) + (c.notetype === 'basic-reverse' ? ' · ' + (c.ord + 1) : '') + '</span></div>' +
      '<div class="kv"><span class="kv-k">牌组</span><span class="kv-v">' + esc(r.deck.name) + '</span></div>' +
      '<div class="kv"><span class="kv-k">状态</span><span class="kv-v">' + statusText(c) + '</span></div>' +
      '<div class="kv"><span class="kv-k">复习 / 遗忘</span><span class="kv-v">' + c.scheduling.reps + ' / ' + c.scheduling.lapses + '</span></div>' +
      '</div>' +
      '<div class="br-preview-actions">' +
      '<button class="btn btn-sm" data-act="card-edit" data-id="' + esc(c.id) + '">' + icon('pencil', 'i14') + '编辑</button>' +
      '<button class="btn btn-sm" data-act="card-info" data-id="' + esc(c.id) + '">' + icon('info', 'i14') + '信息</button>' +
      '<button class="btn btn-sm" data-act="br-flag-one" data-id="' + esc(c.id) + '">' + icon('flag', 'i14') + '标记</button>' +
      '<button class="btn btn-sm" data-act="br-pause-one" data-id="' + esc(c.id) + '">' + icon(c.suspended ? 'play' : 'pause', 'i14') + (c.suspended ? '恢复' : '暂停') + '</button>' +
      '</div></div>';
  }

  function typeName(id) {
    const t = FC.notetypeById(id);
    return t ? t.name : '基础';
  }

  // ---------------------------------------------------------------- 卡片编辑器
  function cardEditor(m) {
    const type = m.notetype || 'basic';
    const f = m.fields || { Front: m.front || '', Back: m.back || '', Extra: m.extra || '', Source: '' };
    const tags = (m.tags || []).join(' ');
    const media = m.media || [];

    let html = '<h3>' + (m.id ? '编辑卡片' : '添加卡片') + '</h3>' +
      '<div class="editor">' +
      '<div class="editor-main">' +
      '<div class="field"><label>笔记类型</label><select id="eType">';
    for (let i = 0; i < FC.NOTETYPES.length; i++) {
      const t = FC.NOTETYPES[i];
      html += '<option value="' + t.id + '"' + (t.id === type ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }
    html += '</select><div class="hint" id="eTypeHint">' + esc(FC.notetypeById(type).desc) + '</div></div>';

    html += '<div class="field"><label id="eFrontLabel">' + (type === 'cloze' ? '填空文本' : '正面') + '</label>' +
      '<textarea id="eFront" rows="4" placeholder="' +
      (type === 'cloze' ? '如：The {{c1::capital}} of France is Paris.' : '问题 / 单词 / 提示') + '">' +
      esc(f.Front || '') + '</textarea>' +
      (type === 'cloze' ? '<div class="hint">用 {{c1::答案}} 或 {{c1::答案::提示}} 挖空，每个空生成一张卡。</div>' : '') + '</div>';

    html += '<div class="field" id="eBackWrap"' + (type === 'cloze' ? ' style="display:none"' : '') + '>' +
      '<label>背面</label><textarea id="eBack" rows="3" placeholder="答案 / 释义">' + esc(f.Back || '') + '</textarea></div>';
    html += '<div class="field"><label>补充（可选）</label><textarea id="eExtra" rows="2" placeholder="例句、备注">' + esc(f.Extra || '') + '</textarea></div>';
    html += '<div class="field"><label>来源（可选）</label><input id="eSource" value="' + esc(f.Source || '') + '" placeholder="书名 / 链接" /></div>';
    html += '<div class="field"><label>标签（空格分隔）</label><input id="eTags" value="' + esc(tags) + '" placeholder="动词 高频" /></div>';

    html += '<div class="field"><label>媒体</label><div class="media-row">' +
      '<button class="btn btn-sm" data-act="editor-media" data-kind="image">' + icon('image', 'i14') + '插入图片</button>' +
      '<button class="btn btn-sm" data-act="editor-media" data-kind="audio">' + icon('music', 'i14') + '插入音频</button>' +
      '<input type="file" id="eMediaFile" accept="image/*,audio/*" style="display:none" />' +
      '</div><div class="media-list" id="eMediaList">' +
      media.map(function (x) { return '<span class="chip">' + esc(x.name) + '</span>'; }).join('') +
      '</div><div class="hint">插入后会在文本末尾追加引用，保存时一起写入 .srcd。</div></div>';

    html += '</div><div class="editor-side">' +
      '<div class="preview-label">预览 <button class="btn btn-sm" data-act="editor-preview">刷新</button></div>' +
      '<div class="preview-box field-html" id="ePreview">' + FC.renderCardHtml({
        front: f.Front || '', back: f.Back || '', extra: f.Extra || '',
        notetype: type, cloze: type === 'cloze' ? (f.Front || '') : '', ord: 0, tags: [], media: media
      }, 'front') + '</div>' +
      '<div class="hint" style="margin-top:10px">填空题预览以第一个空为例。</div>' +
      '</div></div>';

    html += '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- 牌组选项
  function deckOptions(m) {
    const deck = m.deck || {};
    const o = deck.options || FC.defaultDeckOptions();
    const g = m.global || FC.defaultSettings();
    const val = function (v, fb) { return (v === null || v === undefined) ? '' : String(v); };

    let html = '<h3>牌组选项 · ' + esc(deck.name || '') + '</h3>' +
      '<div class="subtle" style="margin-bottom:12px">留空表示跟随「设置」中的全局值。</div>' +
      '<div class="opt-grid">';

    html += optInput('每日新卡上限', 'oNew', val(o.newPerDay), String(g.newCardsPerDay));
    html += optInput('每日复习上限', 'oReview', val(o.reviewsPerDay), String(g.reviewCardsPerDay));
    html += optInput('学习步骤（分钟，逗号分隔）', 'oLearn', o.learningSteps ? o.learningSteps.join(',') : '', g.learningSteps.join(','));
    html += optInput('重学步骤（分钟）', 'oRelearn', o.relearningSteps ? o.relearningSteps.join(',') : '', g.relearningSteps.join(','));
    html += optInput('毕业间隔（天）', 'oGrad', val(o.graduatingInterval), String(g.graduatingInterval));
    html += optInput('简单间隔（天）', 'oEasy', val(o.easyInterval), String(g.easyInterval));
    html += optInput('Leech 阈值（遗忘次数）', 'oLeech', val(o.leechThreshold), String(g.leechThreshold));
    html += optInput('最大间隔（天）', 'oMaxIvl', val(o.maxInterval), String(g.maximumInterval));
    html += optInput('目标留存率（0.7-0.99）', 'oRetention', val(o.requestRetention), String(g.requestRetention));

    html += '<div class="field"><label>Leech 动作</label><select id="oLeechAction">' +
      '<option value=""' + (!o.leechAction ? ' selected' : '') + '>跟随全局（' + esc(g.leechAction === 'suspend' ? '自动暂停' : '仅标记') + '）</option>' +
      '<option value="tag"' + (o.leechAction === 'tag' ? ' selected' : '') + '>仅标记</option>' +
      '<option value="suspend"' + (o.leechAction === 'suspend' ? ' selected' : '') + '>自动暂停</option></select></div>';

    html += '<div class="field"><label>相关卡片搁置</label><select id="oBury">' +
      '<option value=""' + (o.buryRelated === null ? ' selected' : '') + '>跟随全局（' + (g.buryRelated ? '开启' : '关闭') + '）</option>' +
      '<option value="1"' + (o.buryRelated === true ? ' selected' : '') + '>开启</option>' +
      '<option value="0"' + (o.buryRelated === false ? ' selected' : '') + '>关闭</option></select></div>';

    html += '<div class="field"><label>新卡顺序</label><select id="oNewOrder">' +
      '<option value=""' + (!o.newOrder ? ' selected' : '') + '>跟随全局</option>' +
      '<option value="mix"' + (o.newOrder === 'mix' ? ' selected' : '') + '>交错</option>' +
      '<option value="order"' + (o.newOrder === 'order' ? ' selected' : '') + '>按创建顺序</option>' +
      '<option value="random"' + (o.newOrder === 'random' ? ' selected' : '') + '>随机</option></select></div>';

    html += '<div class="field"><label>复习顺序</label><select id="oReviewOrder">' +
      '<option value=""' + (!o.reviewOrder ? ' selected' : '') + '>跟随全局</option>' +
      '<option value="due"' + (o.reviewOrder === 'due' ? ' selected' : '') + '>按到期时间</option>' +
      '<option value="random"' + (o.reviewOrder === 'random' ? ' selected' : '') + '>随机</option></select></div>';

    html += '</div><div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn" data-act="deck-options-reset">恢复全局</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    return html;
  }

  function optInput(label, id, value, ph) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="' + id + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '" inputmode="decimal" /></div>';
  }

  // ---------------------------------------------------------------- 卡片信息
  function cardInfo(m) {
    const c = m.card;
    if (!c) return '<h3>卡片信息</h3><div class="subtle">卡片不存在</div>';
    const now = Date.now();
    const fmt = function (iso) {
      if (!iso) return '—';
      const t = Date.parse(iso);
      if (isNaN(t)) return '—';
      const d = new Date(t);
      const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const log = c.reviewLog.slice(-20).reverse();

    let html = '<h3>卡片信息</h3>' +
      '<div class="info-grid">' +
      kv('卡片 ID', c.id) +
      kv('笔记 ID', c.noteId || c.id) +
      kv('笔记类型', typeName(c.notetype) + (c.notetype === 'basic-reverse' ? ' · 模板 ' + (c.ord + 1) : '')) +
      kv('状态', statusText(c)) +
      kv('到期', fmt(c.scheduling.due) + '（' + dueText(c, now) + '）') +
      kv('当前间隔', (c.scheduling.scheduledDays || 0) + ' 天') +
      kv('稳定度', c.scheduling.stability.toFixed(2)) +
      kv('难度', c.scheduling.difficulty.toFixed(2)) +
      kv('复习次数', String(c.scheduling.reps)) +
      kv('遗忘次数', String(c.scheduling.lapses)) +
      kv('标记', c.flags ? '颜色 ' + c.flags : '无') +
      kv('Leech', c.leeched ? '是' : '否') +
      '</div>';

    html += '<div class="section-title" style="margin-top:16px">复习历史（最近 20 条）</div>';
    if (log.length === 0) {
      html += '<div class="subtle">还没有复习记录。</div>';
    } else {
      html += '<table class="info-log"><thead><tr><th>时间</th><th>评分</th><th>状态</th><th>间隔</th></tr></thead><tbody>';
      const labels = ['重来', '困难', '良好', '简单'];
      for (let i = 0; i < log.length; i++) {
        const e = log[i];
        html += '<tr><td>' + fmt(e.reviewedAt) + '</td><td>' + labels[(e.rating || 1) - 1] +
          '</td><td>' + (STATE_LABEL[e.state] || e.state) + '</td><td>' + Math.round(e.scheduledDays) + ' 天</td></tr>';
      }
      html += '</tbody></table>';
    }

    html += '<div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">关闭</button>' +
      '<button class="btn" data-act="info-reschedule" data-id="' + esc(c.id) + '">重新调度</button>' +
      '<button class="btn btn-danger" data-act="info-reset" data-id="' + esc(c.id) + '">重置进度</button>' +
      '</div>';
    return html;
  }

  function kv(k, v) {
    return '<div class="kv"><span class="kv-k">' + esc(k) + '</span><span class="kv-v mono">' + esc(v) + '</span></div>';
  }

  // ---------------------------------------------------------------- 自定义学习
  function customStudy(app) {
    const decks = app.state.decks;
    let html = '<h3>自定义学习</h3>' +
      '<div class="subtle" style="margin-bottom:8px">临时学习一组卡片，不计入每日新卡 / 复习上限，也不改变原有到期时间以外的数据。</div>' +
      '<div class="opt-grid">' +
      '<div class="field"><label>牌组</label><select id="csDeck"><option value="">全部牌组</option>';
    for (let i = 0; i < decks.length; i++) {
      html += '<option value="' + esc(decks[i].id) + '">' + esc(decks[i].name) + '</option>';
    }
    html += '</select></div>' +
      '<div class="field"><label>范围</label><select id="csMode">' +
      '<option value="cram">全部卡片（ cram ）</option>' +
      '<option value="due">只看到期</option>' +
      '<option value="new">只看新卡</option>' +
      '<option value="review">只看复习卡</option></select></div>' +
      '<div class="field"><label>标签筛选（可选）</label><input id="csTag" placeholder="如：动词" /></div>' +
      '<div class="field"><label>数量上限</label><input id="csLimit" value="50" inputmode="numeric" /></div>' +
      '</div><div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">开始</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- CSV 导入
  function csvImport(app) {
    let html = '<h3>导入 CSV / TSV</h3>' +
      '<div class="subtle" style="margin-bottom:8px">支持逗号、制表符或分号分隔；表头可为 Front / Back / Tags / Deck / Extra，也可以是 正面 / 背面 / 标签 / 牌组 / 补充。</div>' +
      '<div class="field"><label>默认牌组</label><input id="csvDeck" placeholder="未指定 Deck 列时使用" value="CSV 导入" /></div>' +
      '<div class="field"><label>粘贴内容</label><textarea id="csvText" rows="9" placeholder="Front,Back,Tags,Deck&#10;apple,苹果,名词,英语"></textarea></div>' +
      '<div class="field"><label>或选择文件</label><input type="file" id="csvFile" accept=".csv,.tsv,.txt" /></div>' +
      '<div class="hint" id="csvHint">导入会新建卡片，不会覆盖已有卡片。</div>' +
      '<div class="dialog-actions">' +
      '<button class="btn" data-act="modal-cancel">取消</button>' +
      '<button class="btn" data-act="csv-preview">预览</button>' +
      '<button class="btn btn-primary" data-act="modal-ok">导入</button></div>';
    return html;
  }

  // ---------------------------------------------------------------- 统计区块
  function analyticsBlocks(app) {
    const a = FC.analytics(app.state);
    const pct = function (v) { return (v * 100).toFixed(0) + '%'; };
    const maxDaily = Math.max(1, Math.max.apply(null, a.daily.map(function (d) { return d.reviews; })));

    // 每块「标题 + 卡片」包成 data-pair，外层 data-grid 在宽屏自动两/三列，
    // 避免十块统计竖着堆成一长条。
    function pair(title, body) {
      return '<div class="data-pair"><div class="section-title">' + title + '</div>' + body + '</div>';
    }

    let html = '<div class="data-grid">';

    // 状态分布 + 答案分布
    html += pair('卡片状态', '<div class="card">' +
      '<div class="dist-row">' +
      distItem('新卡', a.newCount, a.total, 'var(--ink-4)') +
      distItem('学习中', a.learning, a.total, 'var(--amber)') +
      distItem('复习中', a.review, a.total, 'var(--primary)') +
      distItem('重学', a.relearning, a.total, 'var(--red)') +
      '</div>' +
      '<div class="dist-row" style="margin-top:10px">' +
      distItem('暂停', a.suspended, a.total, 'var(--ink-4)') +
      distItem('搁置', a.buried, a.total, 'var(--ink-4)') +
      distItem('Leech', a.leech, a.total, 'var(--red)') +
      distItem('已标记', a.marked, a.total, 'var(--amber)') +
      '</div></div>');

    let ratingBody = '<div class="card"><div class="rating-dist">';
    const rlabels = ['重来', '困难', '良好', '简单'];
    const rtotal = Math.max(1, a.ratings.reduce(function (s, v) { return s + v; }, 0));
    for (let i = 0; i < 4; i++) {
      const p = Math.round(a.ratings[i] / rtotal * 100);
      ratingBody += '<div class="rating-col"><div class="rating-bar-wrap"><span class="rating-bar r' + (i + 1) + '" style="height:' + Math.max(2, p) + '%"></span></div>' +
        '<div class="rating-v">' + a.ratings[i] + '</div><div class="rating-k">' + rlabels[i] + '</div></div>';
    }
    ratingBody += '</div></div>';
    html += pair('答案按钮分布 · 累计 ' + a.ratings.reduce(function (s, v) { return s + v; }, 0) + ' 次', ratingBody);

    // 间隔分布
    let ivlBody = '<div class="card"><div class="ivl-list">';
    const ivlMax = Math.max(1, Math.max.apply(null, a.intervals));
    for (let i = 0; i < a.intervals.length; i++) {
      ivlBody += '<div class="ivl-row"><span class="ivl-k">' + FC.INTERVAL_LABELS[i] + '</span>' +
        '<span class="progress"><span style="width:' + Math.round(a.intervals[i] / ivlMax * 100) + '%"></span></span>' +
        '<b class="ivl-v">' + a.intervals[i] + '</b></div>';
    }
    ivlBody += '</div></div>';
    html += pair('间隔分布', ivlBody);

    // 最近 14 天
    let dailyBody = '<div class="card"><div class="chart">';
    for (let i = 0; i < a.daily.length; i++) {
      const d = a.daily[i];
      const h = Math.max(2, Math.round(d.reviews / maxDaily * 100));
      dailyBody += '<div class="chart-col"><span class="bar-v">' + d.reviews + '</span>' +
        '<span class="bar-track"><span class="bar' + (d.reviews === 0 ? ' zero' : '') + '" style="height:' + h + '%"></span></span>' +
        '<span class="bar-l">' + d.label + '</span></div>';
    }
    dailyBody += '</div></div>';
    html += pair('最近 14 天复习量', dailyBody);

    // 学习热力图
    html += pair('学习热力图 · 最近 20 周', '<div class="card">' +
      '<div class="heatmap">' +
      a.heatmap.map(function (h) {
        return '<span class="hm-cell l' + h.level + '" title="' + h.date + ' · ' + h.reviews + ' 次"></span>';
      }).join('') +
      '</div><div class="hm-legend"><span>少</span>' +
      '<span class="hm-cell l0"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span>' +
      '<span class="hm-cell l3"></span><span class="hm-cell l4"></span><span>多</span></div></div>');

    // 关键指标
    html += pair('记忆健康度', '<div class="stat-grid">' +
      statBox(pct(a.retention), '累计留存率', false, 'chart') +
      statBox(pct(a.retentionToday), '今日留存率', false, 'chart') +
      statBox(a.avgDifficulty ? a.avgDifficulty.toFixed(1) : '—', '平均难度', false, 'layers') +
      statBox(a.avgStability ? a.avgStability.toFixed(1) : '—', '平均稳定度（天）', false, 'clock') +
      statBox(Math.round(a.timeToday / 60000), '今日学习（分钟）', false, 'clock') +
      statBox(a.overdue, '逾期卡片', false, 'info') +
      '</div>');

    // 标签
    if (a.tags.length > 0) {
      html += pair('常用标签', '<div class="card"><div class="tag-cloud">' +
        a.tags.map(function (t) {
          return '<button class="chip" data-act="br-tag-search" data-tag="' + esc(t.tag) + '">' +
            esc(t.tag) + ' <span class="tag-n">' + t.count + '</span></button>';
        }).join('') + '</div></div>');
    }

    html += '</div>';
    return html;
  }

  function distItem(label, n, total, color) {
    const p = total ? Math.round(n / total * 100) : 0;
    return '<div class="dist-item"><div class="dist-top"><span>' + label + '</span><b>' + n + '</b></div>' +
      '<div class="dist-track"><span style="width:' + p + '%;background:' + color + '"></span></div></div>';
  }

  function statBox(v, k, accent, ico) {
    return '<div class="stat-box">' +
      (ico ? '<span class="stat-ico ico-' + esc(ico) + '">' + icon(ico, 'i16') + '</span>' : '') +
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v' + (accent ? ' accent' : '') + '">' + esc(v) + '</div></div>';
  }

  // ---------------------------------------------------------------- 学习页工具条
  function studyTools(app) {
    const card = app.currentStudyCard();
    if (!card) return '';
    const marked = (card.flags || 0) > 0;
    return '<div class="study-tools">' +
      '<button class="tool' + (marked ? ' on' : '') + '" data-act="study-flag" title="标记（F）">' +
      icon('flag', 'i16') + '<span>标记</span></button>' +
      '<button class="tool' + (card.suspended ? ' on' : '') + '" data-act="study-suspend" title="暂停（S）">' +
      icon('pause', 'i16') + '<span>' + (card.suspended ? '恢复' : '暂停') + '</span></button>' +
      '<button class="tool" data-act="study-edit" title="编辑（E）">' + icon('pencil', 'i16') + '<span>编辑</span></button>' +
      '<button class="tool" data-act="card-info" data-id="' + esc(card.id) + '" title="信息（I）">' + icon('info', 'i16') + '<span>信息</span></button>' +
      '<button class="tool" data-act="study-reset" title="重置：当作从没学过（R）">' + icon('rotate', 'i16') + '<span>重置</span></button>' +
      '<button class="tool" data-act="study-undo" title="撤销">' + icon('undo', 'i16') + '<span>撤销</span></button>' +
      '<button class="tool" data-act="shortcuts-help" title="键盘快捷键">' + icon('keyboard', 'i16') + '<span>快捷键</span></button>' +
      '</div>';
  }

  FCUI.browserPage = browserPage;
  FCUI.browserTable = browserTable;
  FCUI.browserPreview = browserPreview;
  FCUI.selectedIds = selectedIds;
  FCUI.cardEditor = cardEditor;
  FCUI.deckOptions = deckOptions;
  FCUI.cardInfo = cardInfo;
  FCUI.customStudy = customStudy;
  FCUI.csvImport = csvImport;
  FCUI.analyticsBlocks = analyticsBlocks;
  FCUI.studyTools = studyTools;
  FCUI.statusText = statusText;
  FCUI.dueText = dueText;
  FCUI.typeName = typeName;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


