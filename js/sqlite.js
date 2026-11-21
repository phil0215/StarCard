/* ===== js/sqlite.js ===== */
/**
 * 闪星卡（StarCard）· 精简 SQLite 只读解析器（纯前端，零外部依赖）
 *
 * 只实现读取 .apkg 内 collection.anki2 / anki21 所需的部分：
 *   - 文件头 / 页大小 / 文本编码
 *   - Table B-Tree（leaf 0x0D / interior 0x05）遍历
 *   - 记录的 varint / serial type 解码（含整型、浮点、文本、BLOB）
 *   - Overflow 页链（Anki 的长字段 / 模板 JSON 会用到）
 *   - sqlite_master 解析表结构
 *
 * 不做写入、索引、表达式、WAL —— 这些对读取 Anki 导出包不是必需的。
 */
(function (global) {
  'use strict';

  function open(bytes) { return new SQLite(bytes); }

  function SQLite(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    if (this.b.length < 100) throw new Error('SQLite 文件过小');
    let sig = '';
    for (let i = 0; i < 15; i++) sig += String.fromCharCode(this.b[i]);
    if (sig !== 'SQLite format 3') throw new Error('不是 SQLite 数据库（collection.anki2 损坏）');
    let ps = this.dv.getUint16(16);
    if (ps === 1) ps = 65536;
    if (!ps || ps < 512 || (ps & (ps - 1)) !== 0) throw new Error('SQLite 页大小非法：' + ps);
    this.pageSize = ps;
    this.reserved = this.b[20] || 0;
    this.usable = ps - this.reserved;
    const enc = this.dv.getUint32(56);
    this.enc = enc === 2 ? 'utf-16le' : (enc === 3 ? 'utf-16be' : 'utf-8');
    this._master = null;
  }

  /** 从指定字节数组读取 SQLite varint，返回 [值, 占用字节数] */
  SQLite.prototype.varintAt = function (bytes, off) {
    let n = 0;
    for (let i = 0; i < 8; i++) {
      if (off + i >= bytes.length) throw new Error('SQLite varint 越界');
      const v = bytes[off + i];
      n = n * 128 + (v & 0x7f);
      if ((v & 0x80) === 0) return [n, i + 1];
    }
    n = n * 256 + bytes[off + 8];
    return [n, 9];
  };
  /** 从整库字节流读取 varint */
  SQLite.prototype.varint = function (off) { return this.varintAt(this.b, off); };

  SQLite.prototype.text = function (bytes) {
    if (this.enc === 'utf-8') {
      if (typeof TextDecoder !== 'undefined') {
        try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* 走手动回退 */ }
      }
      // 手动 UTF-8 解码（部分老浏览器 / 沙箱没有 TextDecoder）
      let s = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80) { s += String.fromCharCode(b); continue; }
        let cp, n;
        if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
        else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
        else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
        else { s += '\ufffd'; continue; }
        for (let j = 1; j <= n && i + j < bytes.length; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
        i += n;
        s += String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      }
      return s;
    }
    const le = this.enc === 'utf-16le';
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(dv.getUint16(i, le));
    return s;
  };

  /** 取完整 payload（自动跟随 overflow 页链） */
  SQLite.prototype.payload = function (cellPayloadPos, payloadLen) {
    const usable = this.usable;
    const maxLocal = usable - 35;
    const minLocal = Math.floor((usable - 12) * 32 / 255) - 23;
    let local = payloadLen;
    if (payloadLen > maxLocal) {
      const surplus = minLocal + ((payloadLen - minLocal) % (usable - 4));
      local = surplus <= maxLocal ? surplus : minLocal;
    }
    const out = new Uint8Array(payloadLen);
    if (this.b.length < cellPayloadPos + local) throw new Error('SQLite 记录内容越界');
    out.set(this.b.subarray(cellPayloadPos, cellPayloadPos + local), 0);
    let got = local;
    if (local < payloadLen) {
      let next = this.dv.getUint32(cellPayloadPos + local, false);
      const seen = Object.create(null);
      while (next && got < payloadLen) {
        if (seen[next]) throw new Error('SQLite overflow 页链出现循环');
        seen[next] = 1;
        const off = (next - 1) * this.pageSize;
        if (off + 4 > this.b.length) throw new Error('SQLite overflow 页越界');
        const take = Math.min(usable - 4, payloadLen - got);
        out.set(this.b.subarray(off + 4, off + 4 + take), got);
        got += take;
        next = this.dv.getUint32(off, false);
      }
    }
    return out;
  };

  /** 解析一条记录：返回按列顺序排列的值数组 */
  SQLite.prototype.record = function (payload) {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const hdr = this.varintAt(payload, 0);
    const headerSize = hdr[0];
    if (headerSize > payload.length) throw new Error('SQLite 记录头越界');
    const types = [];
    let p = hdr[1];
    while (p < headerSize) {
      const v = this.varintAt(payload, p);
      types.push(v[0]);
      p += v[1];
    }
    const vals = [];
    let d = headerSize;
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      let v = null;
      if (t === 0) {
        v = null;
      } else if (t >= 1 && t <= 6) {
        const len = [0, 1, 2, 3, 4, 6, 8][t];
        if (d + len > payload.length) throw new Error('SQLite 整型列越界');
        if (t === 1) v = dv.getInt8(d);
        else if (t === 2) v = dv.getInt16(d);
        else if (t === 3) v = (dv.getInt16(d) << 8) | payload[d + 2];
        else if (t === 4) v = dv.getInt32(d);
        else if (t === 5) {
          // 6 字节：高 2 字节有符号，低 4 字节无符号
          const hi = dv.getInt16(d), lo = dv.getUint32(d + 2);
          v = hi * 4294967296 + lo;
        } else {
          // 8 字节：高 4 字节有符号，低 4 字节无符号
          const hi = dv.getInt32(d), lo = dv.getUint32(d + 4);
          v = hi * 4294967296 + lo;
        }
        d += len;
      } else if (t === 7) {
        if (d + 8 > payload.length) throw new Error('SQLite 浮点列越界');
        v = dv.getFloat64(d); d += 8;
      } else if (t === 8) {
        v = 0;
      } else if (t === 9) {
        v = 1;
      } else if (t === 10 || t === 11) {
        v = null;
      } else if ((t & 1) === 0) {
        const len = (t - 12) / 2;
        if (d + len > payload.length) throw new Error('SQLite BLOB 列越界');
        v = payload.subarray(d, d + len); d += len;
      } else {
        const len = (t - 13) / 2;
        if (d + len > payload.length) throw new Error('SQLite 文本列越界');
        v = this.text(payload.subarray(d, d + len)); d += len;
      }
      vals.push(v);
    }
    return vals;
  };

  /** 直接遍历某个 B-Tree 根页，按给定列名产出对象数组 */
  SQLite.prototype._rawRows = function (rootPage, cols, sql) {
    const self = this;
    const rows = [];
    const visited = Object.create(null);
    if (!rootPage) return rows;

    function isPk(col) {
      if (!sql) return col === 'id';
      const c = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 允许 NOT NULL / UNSIGNED 等修饰词夹在 INTEGER 与 PRIMARY KEY 之间：
      // Anki 新版 notetypes 表写作 `id integer NOT NULL PRIMARY KEY`。
      const re = new RegExp('["`\\[]?' + c + '["`\\]]?\\s+INTEGER\\b[\\s\\S]{0,40}?PRIMARY\\s+KEY', 'i');
      return re.test(sql) || (col === 'id' && /\bid\b[\s\S]{0,80}INTEGER\s+PRIMARY\s+KEY/i.test(sql));
    }
    // WITHOUT ROWID 表的 cell 里没有 rowid varint，payload 紧跟在 payloadLen 之后。
    // Anki 新版 schema 的 fields / templates 表就是 WITHOUT ROWID；若误读会整体错位一列。
    const withoutRowid = !!sql && /WITHOUT\s+ROWID/i.test(sql);

    /** 计算一条 cell 里 record 的起始位置与 rowid。对 WITHOUT ROWID 做特殊处理。 */
    function cellRowidAndPayloadOff(cell, pl) {
      if (withoutRowid) {
        // 无 rowid：payload 从 pl 字节后直接开始；rowid 取主键首列（解析后回填）
        return { rowid: null, payloadOff: cell + pl[1] };
      }
      const rl = self.varint(cell + pl[1]);
      return { rowid: rl[0], payloadOff: cell + pl[1] + rl[1] };
    }

    function walk(pgno) {
      if (pgno <= 0 || visited[pgno]) return;
      visited[pgno] = 1;
      const off = (pgno - 1) * self.pageSize;
      if (off + 12 > self.b.length) throw new Error('SQLite 页越界：' + pgno);
      const base = off + (pgno === 1 ? 100 : 0);
      if (base + 12 > self.b.length) throw new Error('SQLite 页头越界：' + pgno);
      const type = self.b[base];
      const n = self.dv.getUint16(base + 3);
      const interior = (type === 0x05 || type === 0x02);
      const ptrBase = base + (interior ? 12 : 8);

      if (interior) {
        for (let i = 0; i < n; i++) {
          const cp = self.dv.getUint16(ptrBase + i * 2);
          walk(self.dv.getUint32(off + cp, false));
        }
        walk(self.dv.getUint32(base + 8, false));
        return;
      }
      if (type !== 0x0d && type !== 0x0a) return;

      for (let i = 0; i < n; i++) {
        const cp = self.dv.getUint16(ptrBase + i * 2);
        const cell = off + cp;
        const pl = self.varint(cell);
        const rp = cellRowidAndPayloadOff(cell, pl);
        let rowid = rp.rowid;
        const payload = self.payload(rp.payloadOff, pl[0]);
        const vals = self.record(payload);
        const row = Object.create(null);
        for (let c = 0; c < cols.length; c++) {
          let v = (c < vals.length ? vals[c] : null);
          // WITHOUT ROWID 表：主键首列（INTEGER PRIMARY KEY）用 record 里的实际值；
          // 普通表：id 为 rowid 别名时若 record 里是 null 则用 rowid 回填。
          if (withoutRowid) {
            if (isPk(cols[c]) && rowid === null) rowid = v;
          } else if (v === null && isPk(cols[c])) {
            v = rowid;
          }
          row[cols[c]] = v;
        }
        row.__rowid = rowid;
        rows.push(row);
      }
    }

    walk(rootPage);
    return rows;
  };

  /** 从 CREATE TABLE 语句里提取列名（忽略括号/引号内的逗号） */
  function parseColumns(sql) {
    if (!sql) return [];
    const open = sql.indexOf('(');
    const close = sql.lastIndexOf(')');
    if (open < 0 || close <= open) return [];
    // 去掉 SQL 注释：Anki 导出的表结构常在列后带 /* 0 */ 之类注释，
    // 不剥离会让注释吞掉后面的列名，最终只解析出第一列。
    const body = sql.substring(open + 1, close)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    const parts = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (quote) {
        if (c === quote && body[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) { parts.push(body.substring(start, i)); start = i + 1; }
    }
    parts.push(body.substring(start));
    const cols = [];
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim();
      if (!t || /^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)\b/i.test(t)) continue;
      const m = t.match(/^["'`\[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/);
      if (m) cols.push(m[1]);
    }
    return cols;
  }

  /** 解析 sqlite_master */
  SQLite.prototype.tables = function () {
    if (this._master) return this._master;
    const rows = this._rawRows(1, ['type', 'name', 'tbl_name', 'rootpage', 'sql']);
    this._master = rows.map(function (r) {
      return {
        type: r.type || '', name: r.name || '', tblName: r.tbl_name || '',
        rootpage: Number(r.rootpage) || 0, sql: r.sql || ''
      };
    });
    return this._master;
  };

  /** 按表名读取所有行 */
  SQLite.prototype.rows = function (name) {
    const meta = null;
    const all = this.tables();
    let found = null;
    for (let i = 0; i < all.length; i++) {
      if (all[i].type === 'table' && all[i].name === name) { found = all[i]; break; }
    }
    if (!found || !found.rootpage) return [];
    return this._rawRows(found.rootpage, parseColumns(found.sql), found.sql);
  };

  SQLite.prototype.tableNames = function () {
    return this.tables().filter(function (t) { return t.type === 'table'; }).map(function (t) { return t.name; });
  };

  const API = { open: open, SQLite: SQLite, parseColumns: parseColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCSqlite = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


