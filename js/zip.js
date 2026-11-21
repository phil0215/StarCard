/* ===== js/zip.js ===== */
/**
 * 闪星卡（StarCard）· ZIP / DEFLATE 解压（纯前端，零外部依赖）
 *
 * 用途：直接读取 Anki 导出的 .apkg / .colpkg（本质是 ZIP 包），
 * 取出里面的 collection.anki2 / collection.anki21（SQLite）与媒体文件。
 * 支持 stored(0) 与 deflate(8, raw) 两种方式，含 fixed / dynamic Huffman。
 * 之所以自己实现而不引入 JS 库，是为了保持「单文件、双击即用、无外链」。
 */
(function (global) {
  'use strict';

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /** 解压 raw DEFLATE（ZIP 内使用的格式），返回 Uint8Array */
  function inflateRaw(input) {
    const src = input instanceof Uint8Array ? input : new Uint8Array(input);
    let pos = 0, bb = 0, bc = 0;

    function bits(n) {
      while (bc < n) {
        if (pos >= src.length) throw new Error('DEFLATE 数据意外结束');
        bb |= src[pos++] << bc;
        bc += 8;
      }
      const v = bb & ((1 << n) - 1);
      bb >>>= n;
      bc -= n;
      return v;
    }
    function alignByte() {
      pos -= Math.floor(bc / 8);
      bb = 0; bc = 0;
    }

    // canonical Huffman：按码长分桶，桶内用对象按码值 O(1) 查找
    function makeTree(lengths) {
      const max = 15;
      const count = new Int32Array(max + 1);
      for (let i = 0; i < lengths.length; i++) {
        const l = lengths[i] | 0;
        if (l > max) throw new Error('DEFLATE 码长非法');
        count[l]++;
      }
      count[0] = 0;
      const first = new Int32Array(max + 1);
      let code = 0;
      for (let i = 1; i <= max; i++) {
        code = (code + count[i - 1]) << 1;
        first[i] = code;
      }
      const buckets = [];
      for (let i = 0; i <= max; i++) buckets.push(Object.create(null));
      for (let sym = 0; sym < lengths.length; sym++) {
        const l = lengths[sym];
        if (l) buckets[l][first[l]++] = sym;
      }
      return buckets;
    }
    function decode(tree) {
      let code = 0;
      for (let len = 1; len <= 15; len++) {
        code = (code << 1) | bits(1);
        const hit = tree[len][code];
        if (hit !== undefined) return hit;
      }
      throw new Error('DEFLATE 无效 Huffman 编码');
    }

    let out = new Uint8Array(Math.max(1024, src.length * 3));
    let outLen = 0;
    function put(b) {
      if (outLen >= out.length) {
        const bigger = new Uint8Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[outLen++] = b;
    }
    function copyBack(dist, len) {
      if (dist > outLen) throw new Error('DEFLATE 回溯距离超出范围');
      for (let i = 0; i < len; i++) put(out[outLen - dist]);
    }

    const fixedLit = makeTree((function () {
      const a = new Uint8Array(288);
      for (let i = 0; i <= 143; i++) a[i] = 8;
      for (let i = 144; i <= 255; i++) a[i] = 9;
      for (let i = 256; i <= 279; i++) a[i] = 7;
      for (let i = 280; i <= 287; i++) a[i] = 8;
      return a;
    })());
    const fixedDist = makeTree((function () {
      const a = new Uint8Array(32);
      for (let i = 0; i < 32; i++) a[i] = 5;
      return a;
    })());

    let distTree = fixedDist;
    let last = false;
    while (!last) {
      last = bits(1) === 1;
      const type = bits(2);

      if (type === 0) {
        alignByte();
        if (pos + 4 > src.length) throw new Error('DEFLATE 存储块损坏');
        const len = src[pos] | (src[pos + 1] << 8);
        const nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('DEFLATE 存储块长度校验失败');
        for (let i = 0; i < len; i++) {
          if (pos >= src.length) throw new Error('DEFLATE 数据意外结束');
          put(src[pos++]);
        }
      } else if (type === 1 || type === 2) {
        let litTree = fixedLit;
        distTree = fixedDist;
        if (type === 2) {
          const hlit = bits(5) + 257;
          const hdist = bits(5) + 1;
          const hclen = bits(4) + 4;
          const clen = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clen[CL_ORDER[i]] = bits(3);
          const clTree = makeTree(clen);
          const lens = new Uint8Array(hlit + hdist);
          let idx = 0;
          while (idx < lens.length) {
            const s = decode(clTree);
            if (s < 16) {
              lens[idx++] = s;
            } else if (s === 16) {
              if (idx === 0) throw new Error('DEFLATE 重复码长非法');
              const prev = lens[idx - 1], r = bits(2) + 3;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = prev;
            } else if (s === 17) {
              const r = bits(3) + 3;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = 0;
            } else {
              const r = bits(7) + 11;
              for (let i = 0; i < r && idx < lens.length; i++) lens[idx++] = 0;
            }
          }
          litTree = makeTree(lens.subarray(0, hlit));
          distTree = makeTree(lens.subarray(hlit, hlit + hdist));
        }
        for (;;) {
          const sym = decode(litTree);
          if (sym === 256) break;
          if (sym < 256) { put(sym); continue; }
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error('DEFLATE 长度符号非法');
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const ds = decode(distTree);
          if (ds >= DIST_BASE.length) throw new Error('DEFLATE 距离符号非法');
          const dist = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          copyBack(dist, len);
        }
      } else {
        throw new Error('DEFLATE 保留块类型非法');
      }
    }
    return out.subarray(0, outLen);
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* 回退 */ }
    }
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); continue; }
      let cp, n;
      if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
      else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
      else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
      else { out += '\ufffd'; continue; }
      for (let j = 1; j <= n && i + j < bytes.length; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
      i += n;
      out += String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    }
    return out;
  }

  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    if (typeof btoa === 'function') return btoa(bin);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bin.length; i += 3) {
      const a = bin.charCodeAt(i), b = i + 1 < bin.length ? bin.charCodeAt(i + 1) : -1, c = i + 2 < bin.length ? bin.charCodeAt(i + 2) : -1;
      out += chars[a >> 2] + chars[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)] + (b < 0 ? '=' : chars[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)]) + (c < 0 ? '=' : chars[c & 63]);
    }
    return out;
  }

  function isZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  /** 解包。返回 { entries: { 文件名: Uint8Array }, names: string[] } */
  function unzip(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (u8.length < 22) throw new Error('文件太小，不是有效的 .apkg / ZIP');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const min = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('找不到 ZIP 结束标记，文件可能不是 .apkg');

    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = Object.create(null);

    for (let i = 0; i < total; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
        throw new Error('ZIP 中央目录损坏');
      }
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = utf8Decode(u8.subarray(p + 46, p + 46 + nameLen));

      if (localOff + 30 > u8.length || dv.getUint32(localOff, true) !== 0x04034b50) {
        throw new Error('ZIP 本地文件头损坏：' + name);
      }
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) {
        data = comp;
      } else if (method === 8) {
        data = inflateRaw(comp);
      } else {
        throw new Error('不支持的 ZIP 压缩方式（' + method + '）：' + name);
      }
      if (uncompSize && data.length !== uncompSize) {
        throw new Error('ZIP 解压大小不符：' + name);
      }
      entries[name] = data;
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries, names: Object.keys(entries) };
  }

  const API = { inflateRaw: inflateRaw, unzip: unzip, isZip: isZip, utf8Decode: utf8Decode, toBase64: toBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.BCZip = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


