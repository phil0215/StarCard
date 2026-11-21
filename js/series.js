/* ===== js/series.js ===== */
/**
 * 闪星卡（StarCard）· 系列（Series）
 * ------------------------------------------------------------------
 * "系列"是把若干牌组按主题收进同一个文件夹式容器的内容组织层。
 * 全部学习卡片都由用户导入，运行时零内置：每导入一个词库文件，
 * 就自动生成一个系列（文件夹）收纳本批牌组。系列是运行时动态数据，
 * 存在 state.series 中，可增删改、可折叠、可整体系列导出 / 学习 / 删除。
 * 牌组通过 tagKey（series_xxx 标签）归属系列。
 * 纯数据 / 工具，不依赖 app.js。
 */
(function (global) {
  'use strict';
  const FC = global.FC || {};

  // 兼容旧接口：运行时系列一律取自 state.series，此常量恒为空（不再预置任何词库）。
  const SERIES = [];
  // 最近一次被查询的 state，供 seriesById 在未显式传 state 时兜底。
  let LAST_STATE = null;
  function remember(state) { if (state) LAST_STATE = state; }

  const ACCENTS = ['brand', 'green', 'amber', 'red', 'blue', 'pink', 'cyan', 'orange'];

  function hashStr(x) {
    let h = 0;
    for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // 从牌组名提取分册编号。核心词形如「01List」（数字在前），
  // 增补词形如「List 13」（数字在后）——两者都要识别，避免增补 13-17 被误读成 01-05。
  function deckNumber(d) {
    const name = String(d.name || '');
    let m = name.match(/(\d+)\s*List/i);        // 数字在前：01List
    if (!m) m = name.match(/List\s*(\d+)/i);    // 数字在后：List 13
    return m ? parseInt(m[1], 10) : 9999;
  }

  // 该系列已导入的真实牌组（按分册编号排序）
  function decksOf(state, series) {
    if (!state || !state.decks) return [];
    const key = series.tagKey;
    const out = state.decks.filter(function (d) {
      return (d.tags || []).indexOf(key) >= 0;
    });
    out.sort(function (a, b) { return deckNumber(a) - deckNumber(b); });
    return out;
  }

  function isLoaded(state, series) { return decksOf(state, series).length > 0; }

  // 系列是否被用户从词书中移除（动态系列一般直接物理删除，此字段保留兼容旧数据）
  function isRemoved(state, series) {
    return !!(state && state.removedSeries && state.removedSeries.indexOf(series.id) >= 0);
  }
  // 在词书/学习页可见的系列
  function visible(state) {
    remember(state);
    const list = (state && state.series) || SERIES;
    return list.filter(function (s) { return !isRemoved(state, s); });
  }
  // 被用户移除的系列（供词书页「恢复」入口使用）
  function removed(state) {
    remember(state);
    const list = (state && state.series) || SERIES;
    return list.filter(function (s) { return isRemoved(state, s); });
  }

  // 按 id 查系列（显式传 state 优先；否则用最近一次查询的 state 兜底）
  function seriesById(id, state) {
    const st = state || LAST_STATE;
    const list = (st && st.series) || SERIES;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---- 动态系列：导入词库时创建 / 复用一个系列，并把本批牌组归入 ----
  // name 一般来自文件名去后缀；同名复用，保证"重新导入"归回原系列、不堆叠重复文件夹。
  function registerSeries(state, name, file) {
    if (!state.series) state.series = [];
    name = String(name || '').trim() || '导入词库';
    file = String(file || '');
    for (let i = 0; i < state.series.length; i++) {
      if (state.series[i].name === name) {
        if (file) { state.series[i].file = file; state.series[i].source = file; }
        return state.series[i];
      }
    }
    let base = 's_' + hashStr(name);
    let id = base, n = 1;
    while (state.series.some(function (x) { return x.id === id; })) { id = base + '_' + (n++); }
    const se = {
      id: id, name: name, subtitle: '', description: '',
      icon: 'layers', accent: ACCENTS[state.series.length % ACCENTS.length],
      tagKey: 'series_' + id, file: file, source: file,
      volCount: 0, cardCount: 0, builtIn: false, createdAt: Date.now()
    };
    state.series.push(se);
    return se;
  }

  // 给本次导入的牌组（按名字集合）打上该系列的归属标签。
  // 先清掉任何旧的 series_ 标签，避免同一牌组同时属于多个系列；
  // 也解决"同名重新导入时 merge 用文件 tags 覆盖、冲掉归属"的问题。
  function tagSeriesDecks(state, series, deckNames) {
    const set = {};
    (deckNames || []).forEach(function (n) { set[n] = true; });
    const key = series.tagKey;
    (state.decks || []).forEach(function (d) {
      if (!set[d.name]) return;
      let tags = (d.tags || []).filter(function (t) {
        return !(typeof t === 'string' && t.indexOf('series_') === 0);
      });
      if (tags.indexOf(key) < 0) tags.push(key);
      d.tags = tags;
    });
  }

  // 刷新系列的分册数 / 卡数静态元数据（供未导入引导与文件夹卡片使用）
  function updateSeriesMeta(state, series) {
    const ds = decksOf(state, series);
    series.volCount = ds.length;
    let cc = 0;
    for (let i = 0; i < ds.length; i++) cc += ds[i].cards.length;
    series.cardCount = cc;
  }

  // 旧数据迁移：老版本没有 state.series，牌组按「系列名 › 分册名」命名。
  // 对没有任何 series_ 标签、且名字带 › 的牌组，按前缀自动重建系列。
  // 幂等：已打标的牌组会被跳过；自建牌组（无 ›）保持平铺，不强行归系列。
  function ensureSeriesForLegacy(state) {
    if (!state || !state.decks || !state.decks.length) return 0;
    const groups = {};
    for (let i = 0; i < state.decks.length; i++) {
      const d = state.decks[i];
      const tags = d.tags || [];
      let hasSeries = false;
      for (let j = 0; j < tags.length; j++) {
        if (typeof tags[j] === 'string' && tags[j].indexOf('series_') === 0) { hasSeries = true; break; }
      }
      if (hasSeries) continue;
      const parts = String(d.name || '').split('›');
      if (parts.length < 2) continue;
      const name = parts[0].trim();
      if (!name) continue;
      (groups[name] = groups[name] || []).push(d);
    }
    let made = 0;
    Object.keys(groups).forEach(function (name) {
      const se = registerSeries(state, name, '');
      tagSeriesDecks(state, se, groups[name].map(function (d) { return d.name; }));
      updateSeriesMeta(state, se);
      made++;
    });
    return made;
  }

  // 词库一律外部导入，不再有内置预览数据
  function previewVolumes(series) { return []; }

  // 系列聚合概览：分册进度、掌握口径与建议。已导入读真实牌组，未导入读预览。
  function overview(state, series, nowMs) {
    const now = nowMs || Date.now();
    const loaded = isLoaded(state, series);
    const s = new FC.Scheduler(state.settings);
    const S = state.settings || FC.defaultSettings();
    const cap = Math.max(0, Math.round(S.newCardsPerDay != null ? S.newCardsPerDay : 20));
    const newToday = state.newToday || 0;

    const volumes = [];
    let total = 0, fresh = 0, due = 0, learning = 0, mastered = 0;

    if (loaded) {
      const decks = decksOf(state, series);
      for (let i = 0; i < decks.length; i++) {
        const d = decks[i];
        const counts = s.deckCounts(d, now); // [fresh, due, total]
        let inProgress = 0;
        for (let k = 0; k < d.cards.length; k++) {
          const cc = d.cards[k];
          if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
        }
        const no = deckNumber(d);
        const volTotal = d.cards.length;
        const volMastered = Math.max(0, volTotal - counts[0] - inProgress);
        const volPct = volTotal ? Math.round(volMastered / volTotal * 100) : 0;
        let status = 'new';
        if (volMastered >= volTotal && volTotal > 0) status = 'mastered';
        else if (inProgress > 0) status = 'learning';
        else if (volMastered > 0) status = 'progress';
        volumes.push({
          no: no, label: (no < 10 ? '0' + no : no) + ' List', name: d.name, id: d.id,
          cards: volTotal, fresh: counts[0], due: counts[1], learning: inProgress,
          mastered: volMastered, pct: volPct, status: status
        });
        total += volTotal; fresh += counts[0]; due += counts[1]; learning += inProgress; mastered += volMastered;
      }
    } else {
      const pv = previewVolumes(series);
      for (let i = 0; i < pv.length; i++) {
        volumes.push({
          no: pv[i].no, label: pv[i].label, name: pv[i].name, id: '',
          cards: pv[i].cards, fresh: pv[i].cards, due: 0, learning: 0,
          mastered: 0, pct: 0, status: 'locked'
        });
        total += pv[i].cards; fresh += pv[i].cards;
      }
    }

    const pct = total ? Math.round(mastered / total * 100) : 0;
    const newLeft = Math.max(0, Math.min(Math.max(0, cap - newToday), fresh));
    const planned = newLeft + due;
    let secSum = 0, revSum = 0;
    const stats = state.stats || [];
    for (let i = 0; i < stats.length; i++) {
      const r = stats[i].reviews || 0;
      if (r > 0) { secSum += (stats[i].timeMs || 0) / 1000; revSum += r; }
    }
    const avgSec = revSum > 0 ? FC.clamp(secSum / revSum, 6, 30) : 12;
    const minutes = Math.round(planned * avgSec / 60);

    let next = null;
    for (let i = 0; i < volumes.length; i++) {
      if (volumes[i].status !== 'mastered') { next = volumes[i]; break; }
    }
    let advice;
    if (!loaded) {
      advice = { icon: 'download', tone: 'brand', title: '导入词库卡片',
        desc: '请选择 decks / ' + (series.file || '对应 .srcd') + '（' + (series.volCount || 0) + ' 分册 · ' + (series.cardCount || 0) + ' 卡）。',
        cta: '导入卡片', act: 'series-import', sid: series.id };
    } else if (total === 0) {
      advice = { icon: 'info', tone: 'brand', title: '系列暂时没有卡片',
        desc: '可到「词书」页为这些分册添加卡片。', cta: '前往词书', act: 'tab', tab: 1 };
    } else if (planned === 0) {
      advice = { icon: 'checkCircle', tone: 'green', title: '今日任务已完成',
        desc: '已掌握 ' + mastered + ' / ' + total + ' 张（' + pct + '%）。',
        cta: '自定义学习', act: 'custom-study' };
    } else if (due > 0 && newLeft === 0) {
      advice = { icon: 'rotate', tone: 'amber', title: '有 ' + due + ' 张卡到期复习',
        desc: '预计约 ' + minutes + ' 分钟。', cta: '开始复习', act: 'series-study', sid: series.id };
    } else {
      advice = { icon: 'layers', tone: 'brand',
        title: (next ? ('从 ' + next.label + ' 继续') : '继续学习本系列'),
        desc: '待学 ' + planned + ' 张（新 ' + newLeft + ' · 复习 ' + due + '），已掌握 ' + pct + '%，约 ' + minutes + ' 分钟。',
        cta: planned > 0 ? '开始学习' : '查看分册', act: 'series-study', sid: series.id };
    }

    return {
      loaded: loaded, volumes: volumes, total: total, fresh: fresh, due: due,
      learning: learning, mastered: mastered, pct: pct, newLeft: newLeft,
      planned: planned, minutes: minutes, advice: advice, next: next
    };
  }

  FC.SERIES = SERIES;
  FC.seriesById = seriesById;
  FC.seriesDecksOf = decksOf;
  FC.seriesIsLoaded = isLoaded;
  FC.seriesIsRemoved = isRemoved;
  FC.visibleSeries = visible;
  FC.removedSeries = removed;
  FC.seriesPreviewVolumes = previewVolumes;
  FC.seriesOverview = overview;
  // 动态系列 API
  FC.registerSeries = registerSeries;
  FC.tagSeriesDecks = tagSeriesDecks;
  FC.updateSeriesMeta = updateSeriesMeta;
  FC.ensureSeriesForLegacy = ensureSeriesForLegacy;
  global.FC = FC;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


