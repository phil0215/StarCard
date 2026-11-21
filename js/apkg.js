/* ===== js/apkg.js ===== */
/**
 * 闪星卡（StarCard）· Anki .apkg / .colpkg 解析器（纯前端）
 *
 * 流程：ZIP 解包 → 找到 collection.anki2 / anki21 → 精简 SQLite 读取
 *       notes / cards / models / decks / col → 映射成 StarCard 牌组结构。
 * 映射策略：
 *   - 标准笔记按模板（qfmt/afmt）渲染正反面；含 Back 模板且 ord=1 的识别为反向卡
 *   - Cloze 笔记直接沿用 {{c1::答案}} 语法（StarCard 原生支持）
 *   - 标签 / 标记 / 暂停 / 搁置 / Leech / 复习次数与到期时间一并迁移
 *   - 媒体从 media JSON + 数字文件读出，转成内联 base64 并只挂在引用到它的卡片上
 */
(function (global) {
  'use strict';

  const Zip = global.BCZip || (typeof require !== 'undefined' ? require('./zip.js') : null);
  const Sqlite = global.BCSqlite || (typeof require !== 'undefined' ? require('./sqlite.js') : null);
  const FC = global.FC || (typeof require !== 'undefined' ? require('./core.js') : null);

  function parseJson(text, fallback) {
    try {
      const v = JSON.parse(text);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }

  function decodeEntities(s) {
    return String(s == null ? '' : s)
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&').replace(/&#x([0-9a-f]+);/gi, function (a, h) {
        try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return a; }
      })
      .replace(/&#(\d+);/g, function (a, d) {
        try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return a; }
      });
  }

  /** 把 Anki 字段 HTML 转成 StarCard renderRich 能安全渲染的轻量标记 */
  function htmlToText(html) {
    let s = String(html == null ? '' : html);
    s = s.replace(/<br\s*\/?\s*>/gi, '\n');
    s = s.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (all, src) {
      return '![](media:' + decodeEntities(src) + ')';
    });
    s = s.replace(/\[sound:([^\]]+)\]/gi, '[sound:$1]');
    s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '$2');
    s = s.replace(/<li\b[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '');
    s = s.replace(/<(div|p|tr|h[1-6]|section)\b[^>]*>/gi, '\n').replace(/<\/(div|p|tr|h[1-6]|section)>/gi, '\n');
    s = s.replace(/<hr\b[^>]*>/gi, '\n');
    s = s.replace(/<[^>]*>/g, '');
    s = decodeEntities(s);
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.replace(/^[ \t]+|[ \t]+$/gm, '');
  }

  function mimeOf(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
      txt: 'text/plain', json: 'application/json', pdf: 'application/pdf'
    };
    return map[ext] || 'application/octet-stream';
  }

  function splitFields(flds) {
    return String(flds == null ? '' : flds).split('\x1f');
  }

  function splitTags(tags) {
    return String(tags == null ? '' : tags).trim().split(/\s+/).filter(function (t) { return t !== ''; });
  }

  // 内置填空渲染，避免依赖 anki.js 的加载顺序（apkg.js 也可单独使用）
  const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/g;
  function clozeNums(text) {
    const nums = [], seen = Object.create(null);
    let m;
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(String(text || ''))) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && !seen[n]) { seen[n] = 1; nums.push(n); }
    }
    nums.sort(function (a, b) { return a - b; });
    return nums;
  }
  function renderClozeLocal(text, num, reveal) {
    return String(text || '').replace(CLOZE_RE, function (all, n, answer, hint) {
      return reveal ? answer : (hint ? '[' + hint + ']' : '[...]');
    });
  }

  /** 把 Anki 模型字段映射到 StarCard 的 Front / Back / Extra / Source */
  function mapFields(model, values) {
    const defs = (model && Array.isArray(model.flds)) ? model.flds : [];
    const raw = {};
    const lower = {};
    for (let i = 0; i < defs.length; i++) {
      const name = defs[i].name || ('Field' + (i + 1));
      const val = htmlToText(values[i]);
      raw[name] = val;
      lower[name.toLowerCase()] = val;
    }
    function pick() {
      for (let i = 0; i < arguments.length; i++) {
        const k = String(arguments[i]).toLowerCase();
        if (lower[k] !== undefined && lower[k] !== '') return lower[k];
      }
      return '';
    }
    const names = defs.map(function (d) { return String(d.name || '').toLowerCase(); });
    let Front = pick('Front', '正面', 'Question', '问题', 'Word', 'Term', 'Expression', 'Prompts', 'Front Side');
    let Back = pick('Back', '背面', 'Answer', '答案', 'Meaning', 'Definition', 'Translation', 'Definition & Example', 'Back Side');
    let Extra = pick('Extra', '补充', 'Notes', 'Note', '备注', 'Example', '例句', 'Sentence', 'Comments');
    let Source = pick('Source', '来源', 'Source Sentence', 'Reference');
    if (!Front && defs.length) Front = raw[defs[0].name] || '';
    if (!Back && defs.length > 1) Back = raw[defs[1].name] || '';
    if (!Extra && defs.length > 2) Extra = raw[defs[2].name] || '';
    if (!Source && defs.length > 3) Source = raw[defs[3].name] || '';

    let clozeText = '';
    for (let i = 0; i < defs.length; i++) {
      const v = raw[defs[i].name] || '';
      if (/\{\{c\d+::/.test(v)) { clozeText = v; break; }
    }
    if (!clozeText && defs.length) clozeText = raw[defs[0].name] || '';
    return { raw: raw, names: names, fields: { Front: Front, Back: Back, Extra: Extra, Source: Source }, clozeText: clozeText };
  }

  /** 用模板渲染 Anki 卡片正反面 */
  function renderTemplate(tpl, fields) {
    const qRaw = String((tpl && tpl.qfmt) || '');
    const aRaw = String((tpl && tpl.afmt) || '');
    function conditions(s) {
      return s
        .replace(/\{\{#([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (all, key, body) {
          return (fields[key] || '').trim() ? body : '';
        })
        .replace(/\{\{\^([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (all, key, body) {
          return (fields[key] || '').trim() ? '' : body;
        });
    }
    function fill(s, frontSide) {
      return s.replace(/\{\{([^{}]+)\}\}/g, function (all, expr0) {
        const expr = String(expr0).trim();
        if (/^FrontSide$/i.test(expr)) return frontSide || '';
        if (/^(Tags|Deck|Subdeck|Card|Type|c\d+)$/i.test(expr)) return '';
        const mc = expr.match(/^(cloze|text):\s*(.+)$/i);
        const key = mc ? mc[2].trim() : expr;
        return fields[key] !== undefined ? fields[key] : '';
      });
    }
    const qRendered = fill(conditions(qRaw), '');
    const aRendered = fill(conditions(aRaw), qRendered);
    return { front: htmlToText(qRendered), back: htmlToText(aRendered) };
  }

  /** Anki 调度信息 → StarCard 调度字段（fsrs 为 cards.data 里解析出的真实 FSRS 参数） */
  function mapScheduling(card, crtSec, fsrs) {
    const q = Number(card.queue);
    const reps = Math.max(0, Math.round(Number(card.reps) || 0));
    const lapses = Math.max(0, Math.round(Number(card.lapses) || 0));
    const ivl = Math.max(0, Math.round(Number(card.ivl) || 0));
    const now = Date.now();
    const baseMs = (Number(crtSec) > 0 ? Number(crtSec) * 1000 : now);
    let state = FC ? FC.STATE_NEW : 'new';
    let due = '';

    if (q === -1 || q === -2 || q === -3) {
      state = reps === 0 ? (FC ? FC.STATE_NEW : 'new') : (ivl >= 1 ? (FC ? FC.STATE_REVIEW : 'review') : (FC ? FC.STATE_LEARNING : 'learning'));
    } else if (q === 0 || reps === 0) {
      state = FC ? FC.STATE_NEW : 'new';
    } else if (q === 2) {
      state = FC ? FC.STATE_REVIEW : 'review';
      const day = Number(card.due) || 0;
      // Anki 2.1 复习卡的 due 是「自 Unix epoch 起的天数」，不是相对牌组的偏移；
      // 极少数旧数据可能存的是相对 col.crt 的小天数，早于 2000 年时按相对值兜底。
      let ms = day * 86400000;
      if (ms < 946684800000) ms = baseMs + day * 86400000;
      due = new Date(ms).toISOString();
    } else {
      state = q === 3 ? (FC ? FC.STATE_RELEARNING : 'relearning') : (FC ? FC.STATE_LEARNING : 'learning');
      const dm = Number(card.due) || 0;
      // 学习中 due 可能是「绝对分钟时间戳」或「绝对秒时间戳」，也可能是相对分钟偏移。
      // 用合理年份区间（2000–2100）区分，避免把 2960 万分钟误算到 2083 年。
      const minMs = dm * 60000, secMs = dm * 1000;
      const sane = function (ms) { return ms > 946684800000 && ms < 4102444800000; };
      const dueMs = sane(minMs) ? minMs : (sane(secMs) ? secMs : now + (dm > 0 ? dm * 60000 : 0));
      due = new Date(dueMs).toISOString();
    }

    const factor = Number(card.factor) || 2500;
    let difficulty = Math.max(1, Math.min(10, 10 - (factor - 1300) / 170));
    let stability = ivl >= 1 ? Math.min(36500, ivl) : 0.001;
    // 新版 Anki（FSRS）把真实排程参数写在 cards.data 的 {s,d,...} 里，
    // factor 此时常为 0，必须优先采用，否则难度/稳定性全错。
    if (fsrs) {
      difficulty = fsrs.difficulty;
      stability = fsrs.stability;
    }
    return {
      state: state, due: due,
      difficulty: Math.round(difficulty * 100) / 100,
      stability: Math.round(stability * 1000) / 1000, reps: reps, lapses: lapses,
      scheduledDays: ivl,
      suspended: q === -1,
      buried: q === -2 || q === -3,
      leeched: lapses >= 8
    };
  }

  function findDbEntry(entries, names) {
    for (let i = 0; i < names.length; i++) if (entries[names[i]]) return names[i];
    for (let i = 0; i < names.length; i++) {
      for (const n in entries) {
        if (new RegExp('\\.' + names[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(n)) return n;
      }
    }
    return null;
  }

  // ---- Anki 新版 schema（ver 18+，"FSRS" 数据库）支持 --------------------
  // 新版把牌组 / 笔记类型从 col.decks / col.models 的 JSON 迁到了独立表：
  //   decks(notetypes/fields/templates) 表的 config 列是 protobuf BLOB。
  // 这里不写完整 protobuf 解析器，只做两件可靠的事：
  //   1) 明文列名（name）直接用；
  //   2) 从 BLOB 里提取连续可打印 ASCII 串，从中认出模板 qfmt/afmt 里的 {{字段}} 与 <hr id=answer>。
  // 对外产出与老版 col.models 相同形状的对象，让后续渲染逻辑无需改动。

  /** 把 Uint8Array / Array / string 的 protobuf BLOB 提取成可打印文本片段 */
  function blobTexts(v) {
    let s = '';
    if (v instanceof Uint8Array || Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const b = v[i];
        s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '\n';
      }
    } else if (v != null) {
      s = String(v);
    }
    return s.split(/[\n\r]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
  }

  /** 去掉 protobuf 长度前缀噪声：模板文本开头的孤立标点（% # ) 等） */
  function cleanTpl(s) {
    return String(s || '').replace(/^[\s%#)@&\d]{1,4}(?=(\{\{|<|[A-Za-z\u4e00-\u9fff]))/, '');
  }

  /** 从模板 config BLOB 的文本片段里拼出 qfmt / afmt（Anki 新版） */
  function templateFromBlob(config) {
    const parts = blobTexts(config);
    let qfmt = '', afmt = '';
    for (let i = 0; i < parts.length; i++) {
      const p = cleanTpl(parts[i]);
      // qfmt 段：含 {{字段}} 且不含 FrontSide / <hr ... answer
      if (!qfmt && /\{\{/.test(p) && !/FrontSide/i.test(p)) qfmt = p;
      // afmt 段：含 FrontSide 或 answer 分隔符
      if (!afmt && (/FrontSide/i.test(p) || /hr[^>]*id\s*=\s*answer/i.test(p))) afmt = p;
    }
    if (!afmt && qfmt) afmt = '{{FrontSide}}<hr id="answer">{{Back}}';
    return { qfmt: qfmt, afmt: afmt };
  }

  /**
   * 当 col.models 为空（新版库）时，从 notetypes + fields + templates 表重建 models。
   * 返回与老版 col.models 同形状：{ [id]: { id, name, type, flds:[{name}], tmpls:[{name,qfmt,afmt}] } }
   */
  function rebuildModelsFromTables(rows) {
    const nt = rows('notetypes') || [];
    const flds = rows('fields') || [];
    const tmpls = rows('templates') || [];
    if (!nt.length) return null;
    const models = Object.create(null);
    nt.forEach(function (m) {
      const id = String(m.id);
      models[id] = { id: m.id, name: String(m.name || ''), type: 0, flds: [], tmpls: [], css: '' };
    });
    flds.forEach(function (f) {
      const m = models[String(f.ntid)];
      if (m) m.flds[Math.max(0, Math.round(Number(f.ord) || 0))] = { name: String(f.name || '') };
    });
    tmpls.forEach(function (t) {
      const m = models[String(t.ntid)];
      if (!m) return;
      const tpl = templateFromBlob(t.config);
      m.tmpls[Math.max(0, Math.round(Number(t.ord) || 0))] = {
        name: String(t.name || ''), qfmt: tpl.qfmt, afmt: tpl.afmt
      };
    });
    Object.keys(models).forEach(function (k) {
      const m = models[k];
      // 去掉 flds/tmpls 因 ord 空洞产生的 undefined
      m.flds = (m.flds || []).filter(Boolean);
      m.tmpls = (m.tmpls || []).filter(Boolean);
      // cloze 判定：模板里含 {{cN:: 或类型名含 cloze
      if (/cloze/i.test(m.name) || m.tmpls.some(function (t) { return /\{\{c\d+::/.test(t.qfmt || ''); })) m.type = 1;
    });
    return models;
  }

  /** 解析 Anki 新版 cards.data 里的 FSRS 参数：{s, d, dr, decay, ...} */
  function parseFsrs(data) {
    if (!data) return null;
    const obj = parseJson(typeof data === 'string' ? data : '', null);
    if (!obj || obj.s === undefined || obj.d === undefined) return null;
    return { stability: Math.max(0, Number(obj.s) || 0), difficulty: Math.max(1, Number(obj.d) || 1) };
  }

  /** 把 Anki revlog 行转成 StarCard reviewLog 条目（按 cid 分组） */
  function buildReviewLogs(rows) {
    const map = Object.create(null);
    (rows('revlog') || []).forEach(function (r) {
      const key = String(r.cid);
      if (!map[key]) map[key] = [];
      const ivl = Number(r.ivl) || 0;
      map[key].push({
        rating: Math.max(1, Math.min(4, Math.round(Number(r.ease) || 3))),
        reviewedAt: new Date(Number(r.id) > 1e12 ? Number(r.id) : Date.now()).toISOString(),
        elapsedDays: Math.max(0, Math.round((Number(r.lastIvl) || 0) * (Number(r.lastIvl) < 0 ? -1 : 1))),
        scheduledDays: Math.max(0, Math.abs(Math.round(ivl))),
        state: ivl >= 1 ? 'review' : 'learning'
      });
    });
    return map;
  }

  /** 主解析入口：接受 ArrayBuffer / Uint8Array，返回 StarCard 可合并的牌组与统计 */
  function parse(input) {
    if (!Zip || !Sqlite || !FC) throw new Error('解析器依赖未加载');
    const zip = Zip.unzip(input);
    const dbName = findDbEntry(zip.entries, ['anki21b', 'anki21', 'anki2', 'anki']);
    if (!dbName) throw new Error('未在 .apkg 中找到 collection.anki2 / collection.anki21');

    // Anki 2.1.60+ 的 collection.anki21b 是 zstd 压缩的 SQLite，且媒体也是 zstd +
    // protobuf 映射。浏览器没有原生 zstd 解压，纯 JS 解 FSE/Huffman 风险高；若这个包
    // 仅含 anki21b（anki2 是 1 张卡的空壳），明确提示，避免误导入空壳或读乱码崩溃。
    const zstdBytes = zip.entries[dbName];
    const isZstd = zstdBytes && zstdBytes[0] === 0x28 && zstdBytes[1] === 0xb5 &&
      zstdBytes[2] === 0x2f && zstdBytes[3] === 0xfd;
    if (isZstd) {
      const legacy = zip.entries['collection.anki2'] || zip.entries['collection.anki'];
      let legacyCards = 0;
      try {
        const legacyDb = Sqlite.open(legacy);
        if (legacyDb.tableNames().indexOf('cards') >= 0) legacyCards = legacyDb.rows('cards').length;
      } catch (e) { /* 读不到就当空壳 */ }
      if (legacyCards <= 1) {
        // 结构化信号：让 UI 能弹出「一键载入」对话框，而不是把一大段说明塞进 toast。
        // SAT800 美音已随发布包提供为外置 .srcd（与网页同目录），可一步载入，无需用户手动找文件。
        const e = new Error('这是 Anki 新版（zstd 压缩）的词库，浏览器无法直接解析。');
        e.code = 'ZSTD_BUILTIN';
        e.deckFile = 'SAT800美音.srcd';
        e.deckName = 'SAT800 美音';
        throw e;
      }
      const e2 = new Error('这是 Anki 新版（zstd 压缩）的词库，浏览器暂不支持直接解析。');
      e2.code = 'ZSTD_UNSUPPORTED';
      throw e2;
    }

    const db = Sqlite.open(zip.entries[dbName]);
    const tables = db.tableNames();
    function rows(name) { return tables.indexOf(name) >= 0 ? db.rows(name) : []; }

    const colRow = rows('col')[0] || {};
    const colDecks = parseJson(colRow.decks, {});
    const colModels = parseJson(colRow.models, {});
    const crtSec = Number(colRow.crt) || 0;
    const colVer = Number(colRow.ver) || 0;

    // 牌组名：优先 col.decks，其次 decks 表（新版库 col.decks 为空，全靠 decks 表）
    const deckNames = {};
    const deckMeta = {};
    Object.keys(colDecks).forEach(function (k) {
      const d = colDecks[k] || {};
      if (d.name) deckNames[String(k)] = String(d.name);
      deckMeta[String(k)] = d;
    });
    rows('decks').forEach(function (d) {
      if (d.id !== undefined && d.name) {
        // Anki 新版牌组层级用 \x1f 分隔（如 TOEFL\x1f大组01\x1fList01），转成 :: 便于阅读
        deckNames[String(d.id)] = String(d.name).replace(/\x1f/g, '::');
        deckMeta[String(d.id)] = d;
      }
    });

    // 模型：优先 col.models，其次 models 表；两者都空时用新版 notetypes/fields/templates 表重建
    const models = {};
    Object.keys(colModels).forEach(function (k) { models[String(k)] = colModels[k] || {}; });
    rows('models').forEach(function (m) {
      const id = String(m.id);
      if (!models[id]) models[id] = m;
      else {
        if (!models[id].flds && m.flds) models[id].flds = parseJson(m.flds, []);
        if (!models[id].tmpls && m.tmpls) models[id].tmpls = parseJson(m.tmpls, []);
      }
    });
    if (!Object.keys(models).length) {
      const rebuilt = rebuildModelsFromTables(rows);
      if (rebuilt) Object.keys(rebuilt).forEach(function (k) { models[k] = rebuilt[k]; });
    }
    Object.keys(models).forEach(function (k) {
      const m = models[k];
      if (typeof m.flds === 'string') m.flds = parseJson(m.flds, []);
      if (typeof m.tmpls === 'string') m.tmpls = parseJson(m.tmpls, []);
      if (!Array.isArray(m.flds)) m.flds = [];
      if (!Array.isArray(m.tmpls)) m.tmpls = [];
    });

    // 媒体：media JSON 给出「编号 → 文件名」，ZIP 内同名数字条目为文件内容
    const mediaFile = zip.entries['media'] || zip.entries['collection.media'] || zip.entries['media.json'];
    const mediaIndex = mediaFile ? parseJson(Zip.utf8Decode(mediaFile), {}) : {};
    const mediaByName = Object.create(null);
    let mediaCount = 0;
    Object.keys(mediaIndex).forEach(function (key) {
      const fname = String(mediaIndex[key]);
      const file = zip.entries[key] || zip.entries[String(key)];
      if (!file || !fname) return;
      mediaByName[fname] = { name: fname, mime: mimeOf(fname), data: Zip.toBase64(file) };
      mediaCount++;
    });

    const noteById = Object.create(null);
    const noteRows = rows('notes');
    noteRows.forEach(function (n) { if (n.id !== undefined) noteById[String(n.id)] = n; });

    // 新版库把复习历史单独存在 revlog 表，按卡片 id 归并到各卡片的 reviewLog
    const reviewLogs = buildReviewLogs(rows);

    const deckById = Object.create(null);
    const deckList = [];
    function getDeck(id) {
      const key = String(id);
      if (deckById[key]) return deckById[key];
      let name = deckNames[key];
      const meta = deckMeta[key] || {};
      if (!name && meta.type === 1 && meta.odid) name = deckNames[String(meta.odid)] || '筛选牌组';
      if (!name) name = 'Anki 导入';
      const created = new Date().toISOString();
      const d = {
        id: FC.makeId(), name: String(name), description: '从 Anki .apkg 导入',
        createdAt: created, modifiedAt: created, tags: ['apkg'], cards: [],
        options: FC.defaultDeckOptions ? FC.defaultDeckOptions() : null
      };
      deckById[key] = d;
      deckList.push(d);
      return d;
    }

    const cardRows = rows('cards');
    const noteIds = Object.create(null);
    let skipped = 0;

    cardRows.forEach(function (ac) {
      const note = noteById[String(ac.nid)];
      if (!note) { skipped++; return; }
      const model = models[String(note.mid)] || { flds: [], tmpls: [] };
      const mapped = mapFields(model, splitFields(note.flds));
      if (!mapped.fields.Front && !mapped.fields.Back && !mapped.clozeText) { skipped++; return; }

      const isCloze = Number(model.type) === 1 || /\{\{c\d+::/.test(mapped.clozeText);
      const ord = Math.max(0, Math.round(Number(ac.ord) || 0));
      const tplList = model.tmpls || [];
      const tpl = tplList[ord] || tplList[0] || {};
      const rendered = isCloze ? { front: '', back: '' } : renderTemplate(tpl, mapped.raw);

      const card = FC.newCard(mapped.fields.Front, mapped.fields.Back, mapped.fields.Extra, splitTags(note.tags));
      // 同一笔记的多张卡共享 noteId，便于编辑器识别兄弟卡
      const nidKey = String(note.id || ac.nid);
      if (!noteIds[nidKey]) noteIds[nidKey] = 'anki_' + (note.guid || nidKey).toString().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) + '_' + nidKey.slice(-6);
      card.noteId = noteIds[nidKey];
      card.ord = ord;
      card.fields = mapped.fields;
      card.extra = mapped.fields.Extra;
      card.notetype = 'basic';

      if (isCloze) {
        card.notetype = 'cloze';
        card.cloze = mapped.clozeText;
        const nums = clozeNums(mapped.clozeText);
        const num = nums[ord] || nums[0] || 1;
        card.front = renderClozeLocal(mapped.clozeText, num, false);
        card.back = renderClozeLocal(mapped.clozeText, num, true);
      } else {
        card.front = rendered.front || mapped.fields.Front;
        card.back = rendered.back || mapped.fields.Back;
        if (tplList.length > 1 && (ord === 1 || /revers|反向/i.test(tpl.name || ''))) card.notetype = 'basic-reverse';
      }

      const sch = mapScheduling(ac, crtSec, parseFsrs(ac.data));
      card.state = sch.state;
      // lastReview 取该卡最近一次复习时间
      const myLog = reviewLogs[String(ac.id)] || [];
      const lastReview = myLog.length ? myLog[myLog.length - 1].reviewedAt : '';
      card.scheduling = {
        difficulty: sch.difficulty, stability: sch.stability, due: sch.due,
        lastReview: lastReview, reps: sch.reps, lapses: sch.lapses,
        elapsedDays: 0, scheduledDays: sch.scheduledDays, step: 0
      };
      card.reviewLog = myLog;
      card.flags = Math.max(0, Math.min(7, Math.round(Number(ac.flags) || 0)));
      card.suspended = sch.suspended;
      card.buried = sch.buried;
      card.leeched = sch.leeched;
      card.createdAt = new Date((Number(note.id) > 1e12 ? Number(note.id) : Date.now())).toISOString();
      card.modifiedAt = new Date((Number(ac.mod) > 1e12 ? Number(ac.mod) : Date.now())).toISOString();

      // 只挂上本卡片字段真正引用到的媒体，避免每张卡都复制整包
      const text = [card.front, card.back, card.extra, card.cloze,
        mapped.fields.Front, mapped.fields.Back, mapped.fields.Extra].join('\n');
      const used = Object.create(null);
      Object.keys(mediaByName).forEach(function (name) {
        if (text.indexOf(name) >= 0) used[name] = mediaByName[name];
      });
      card.media = Object.keys(used).map(function (k) { return used[k]; });

      getDeck(ac.did).cards.push(card);
    });

    return {
      format: 'apkg',
      collection: colVer ? ('Anki ' + colVer) : 'Anki',
      file: dbName,
      decks: deckList,
      stats: {
        decks: deckList.length,
        notes: noteRows.length,
        cards: deckList.reduce(function (a, d) { return a + d.cards.length; }, 0),
        skipped: skipped,
        media: mediaCount,
        reviews: (rows('revlog') || []).length,
        fsrs: (rows('cards') || []).filter(function (c) { return parseFsrs(c.data); }).length,
        models: Object.keys(models).map(function (k) { return models[k].name || ('模型 ' + k); })
      }
    };
  }

  const API = {
    parse: parse, htmlToText: htmlToText, mimeOf: mimeOf,
    mapScheduling: mapScheduling, decodeEntities: decodeEntities,
    rebuildModelsFromTables: rebuildModelsFromTables, templateFromBlob: templateFromBlob,
    blobTexts: blobTexts, parseFsrs: parseFsrs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCApkg = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


