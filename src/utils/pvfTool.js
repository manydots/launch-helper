// ============================================================
//  PVF Archive Library
//  Port of PvfLib (PvfDecryptor.cs + PvfArchive.cs + PvfHashTable.cs)
//  Supports: parse, decrypt, decode, edit, rebuild, save
// ============================================================

import { decodeText, encodeText, decodeUtf16LE, encodeUtf16LE, detectEncoding as iconvDetect } from "./encoding.js";

import {
    readInt32LE,
    readUInt32LE,
    writeInt32LE,
    mergeChunks,
    pvfDecrypt,
    pvfDecryptGuard,
    pvfDecryptProtected,
    zlibCompress,
    zlibDecompress,
    encodeFileTable,
    encodeGrpiTable,
    encodeHeaderRaw,
    encodeBodyChunk,
    encodeNameSection,
    decodeNameSection
} from "./pvfCodec.js";
import { PvfFormat, PvfFormatLabels, PvfFormatDefault, MAGIC_DECRYPT, MAGIC_DECRYPT2 } from "./pvfCodec.js";

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Float helpers ----
function float32ToString(bits) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setInt32(0, bits | 0, true);
    const f = dv.getFloat32(0, true);
    if (!isFinite(f)) return String(f);
    if (f === 0) return "0";
    if (Number.isInteger(f) && Math.abs(f) < 1e15) return String(f);
    const f32 = new Float32Array([f])[0];
    for (let p = 1; p <= 9; p++) {
        const s = f32.toPrecision(p);
        if (new Float32Array([parseFloat(s)])[0] === f32) {
            let r = s;
            if (r.indexOf(".") >= 0 && r.indexOf("e") < 0) r = r.replace(/0+$/, "").replace(/\.$/, "");
            return r || "0";
        }
    }
    return String(f32);
}

// ---- PvfArchive ----
// 解析文件类型登记表（dataType -> 扩展名 -> 解析方法，方法名为 PvfArchive 上的成员）。
// 当前已登记专用解析方法的文件类型：
//   dataType=1  token 流（5 字节 token：1 字节类型 + 4 字节小端 int32）
//     "*"    -> decodeToken   通用 token 流解析（默认；.str / .aic / .ani / .etc 等未登记后缀均走此）
//     "lst"  -> decodeLst     *.lst：数字+反引号字符串同行，每条独占一行
//     "dat"  -> decodeDat     *.dat：纯数字定长记录表，按连续 ID 探测记录宽度后分组换行
//   dataType=3  UTF-16 文本
//     "*"    -> decodeUTF16   UTF-16 文本解析（默认）
// 内层键 "*" 为该 dataType 的默认方法；未登记的后缀一律走该 dataType 的 "*" 方法。
// 档案中实际存在的全部后缀（含 .ani / .etc 等任意后缀）可在运行时通过 listFileTypes()
// 汇总查看，据此按需为高频后缀在此登记专用 decodeXxx 方法，实现差异化解析。
const CONTENT_DECODERS = {
    1: { "*": "decodeToken", lst: "decodeLst", dat: "decodeDat" },
    3: { "*": "decodeUTF16" }
};

class PvfArchive {
    constructor(buffer) {
        this.buf = new Uint8Array(buffer);
        this.header = null;
        this.files = [];
        this.groups = [];
        this.strABuf = null;
        this.strWBuf = null;
        this.rawNameHeader = new Uint8Array(8); // 8-byte name table header
        this.bodyOffset = 0;
        this.bodyLength = 0;
        this._chunkCache = new Map();
        this._strAOffsetCache = null;
        this._strWOffsetCache = null;
        this._strAValueCache = null;
        this._strWValueCache = null;
        this._overlay = new Map(); // fileIndex -> Uint8Array (modified raw data)
        this._deleted = new Set(); // fileIndex -> true (soft-deleted)
        this._renamed = new Set(); // fileIndex -> true (renamed)
        this._originalMeta = new Map(); // fileIndex -> { nameOff, name, fullpath }
        this.strEncoding = "utf-8"; // encoding for sTrA (single-byte) string table
        this._headerFormat = PvfFormat.ORIGINAL; // 当前头部格式（original / guard / protected），parse 时自动探测
        this._nameTagCache = new Map(); // fileIndex -> [name] 标签值缓存（.lst 名称展示）
        this._lstTextCache = new Map(); // fileIndex -> decodeLstWithNames 结果缓存（.lst 展示文本）
        this._lstRefMap = new Map(); // fileIndex -> Map<引用路径, file>（.lst 引用快捷跳转）
        this._itemMetaCache = new Map(); // fileIndex -> { rarity, minLevel }（.lst 物品品质/使用等级解析缓存）
        this._tagOffsetCache = null; // 常用标签的字符串表偏移缓存（懒构建）
        this._strNameMap = null; // key -> 中文名称 映射（懒加载扫描 .str 文件，getStrNameMap）
        this._pathIndex = null; // fullpath -> file 索引（懒构建，重命名后失效）
        this._nameIndex = null; // name -> [file] 索引（懒构建，重命名后失效）
    }

    // 当前文件格式枚举值（用于逻辑判断与 CSS 类名）
    get headerFormat() {
        return this._headerFormat;
    }

    // 当前文件格式的可读文案（用于界面与日志打印）
    get headerFormatLabel() {
        return PvfFormatLabels[this.headerFormat] || this.headerFormat;
    }

    async parse() {
        const buf = this.buf;
        if (buf.length < 0x30) throw new Error("数据不足以包含 PVF 头部");

        // Header
        // 按默认格式优先（PvfFormatDefault）依次尝试解密包头：校验签名与分区布局，
        // 仅当布局合法才判定该候选有效，避免把 Guard 误判为原版（或反之）。
        // 候选顺序：原版 → Guard → protected_nkpi（CN），依次回退。
        this.header = null;
        let lastHeaderError = null;
        const tryGuardFirst = PvfFormatDefault === PvfFormat.GUARD;
        const candidates = tryGuardFirst ? [PvfFormat.GUARD, PvfFormat.ORIGINAL, PvfFormat.PROTECTED] : [PvfFormat.ORIGINAL, PvfFormat.GUARD, PvfFormat.PROTECTED];
        for (const fmt of candidates) {
            try {
                this.header = this._decodeHeaderCandidate(buf, fmt);
                this._headerFormat = fmt;
                break;
            } catch (e) {
                lastHeaderError = e;
            }
        }
        if (!this.header) {
            throw lastHeaderError || new Error("PVF 头部解密失败");
        }

        // Section offsets
        const h = this.header;
        let pos = 0x30;
        const tableOffset = pos;
        const tableSize = h.fileCount * 0x18;
        pos += tableSize;
        const hashOffset = pos;
        pos += h.hashTableSize;
        // protected_nkpi 的 HASH 表无法/无需解密（官方服务端亦不读取），
        // 原样保存原始字节，导出时直接复用，保证重封包格式一致。
        this._rawHashBytes = buf.slice(hashOffset, hashOffset + h.hashTableSize);
        const nameOffset = pos;
        pos += h.nameTableSize;
        const grpiOffset = pos;
        const grpiSize = h.groupCount * 8;
        pos += grpiSize;
        this.bodyOffset = pos;
        this.bodyLength = h.bodySize;

        // 分区偏移与数据区不得超出文件长度
        if (pos < 0 || pos > buf.length || this.bodyLength < 0 || pos + this.bodyLength > buf.length) {
            throw new Error("PVF 结构异常：声明的数据区超出文件实际大小，文件可能已损坏或被截断。");
        }

        // Name table
        const nameBytes = buf.slice(nameOffset, nameOffset + h.nameTableSize);
        this.rawNameHeader = nameBytes.slice(0, 8);
        await this._parseNameTable(nameBytes);

        // sTrA 是文件名/路径与 token 文本解析的基础，缺失则后续全部为空——必须报错
        if (!this.strABuf || this.strABuf.length === 0) {
            throw new Error("字符串表 (sTrA) 解析失败，文件可能已损坏或为不支持的 PVF 版本。");
        }

        // Auto-detect sTrA encoding before resolving file names/paths
        if (this.strABuf.length > 1) {
            this.strEncoding = detectEncoding(this.strABuf);
        }

        // 提前构建字符串表缓存（offset->value 表）：文件表解析需要数百万次
        // resolveString，缓存就绪后全部 O(1) 查表，避免逐条重复解码字符串表。
        // 此阶段仍在加载 spinner 下，单帧解码成本可接受。
        this._buildStringCaches();

        await new Promise(r => setTimeout(r, 0));

        // File table
        this._parseFileTable(buf, tableOffset, this.header.fileCount);

        await new Promise(r => setTimeout(r, 0));

        // GRPI
        const grpiBytes = buf.slice(grpiOffset, grpiOffset + grpiSize);
        if (this._headerFormat === PvfFormat.PROTECTED) pvfDecryptProtected("grpi", grpiBytes, MAGIC_DECRYPT);
        else pvfDecrypt("GRPI", grpiBytes, MAGIC_DECRYPT);
        this._parseGroups(grpiBytes, this.header.groupCount);

        return this.header;
    }

    // 解密并校验一个头部候选（fmt 决定解密方式：original 用 "HeaD"，guard 额外 0x55 XOR，
    // protected 用 "hEAd" UTF-16 seed 密钥流且无 guard），失败抛错由调用方回退到下一种格式。
    _decodeHeaderCandidate(allBytes, fmt) {
        const headerBytes = allBytes.slice(0, 0x30);
        if (fmt === PvfFormat.PROTECTED) {
            pvfDecryptProtected("hEAd", headerBytes, MAGIC_DECRYPT);
        } else {
            if (fmt === PvfFormat.GUARD) pvfDecryptGuard(headerBytes);
            if (pvfDecrypt("HeaD", headerBytes, MAGIC_DECRYPT) !== 0) throw new Error("PVF 头部解密失败");
        }

        const signature = readUInt32LE(headerBytes, 0);
        if (signature !== 0x69706b6e) {
            throw new Error("该文件不是有效的 PVF 文件（签名 0x" + (signature >>> 0).toString(16) + "，应为 0x69706b6e）。请确认选择的是游戏的 Script.pvf。");
        }

        const header = {
            signature,
            guid: headerBytes.slice(4, 24),
            fileCount: readInt32LE(headerBytes, 24),
            padding: readInt32LE(headerBytes, 28),
            bodySize: readInt32LE(headerBytes, 32),
            groupCount: readInt32LE(headerBytes, 36),
            hashTableSize: readInt32LE(headerBytes, 40),
            nameTableSize: readInt32LE(headerBytes, 44)
        };
        this._validateHeaderLayout(header, allBytes.length);
        return header;
    }

    // 头部字段合法性：损坏的文件可能给出负值或越界尺寸，导致后续静默解析出垃圾。
    _validateHeaderLayout(header, dataLength) {
        const { fileCount, groupCount, hashTableSize, nameTableSize, bodySize } = header;
        if (fileCount < 0 || groupCount < 0 || hashTableSize < 0 || nameTableSize < 0 || bodySize < 0) {
            throw new Error(`PVF 头部包含负的分区尺寸（fileCount=${fileCount}, groupCount=${groupCount}），文件可能已损坏。`);
        }
        const declaredLength = 0x30 + fileCount * 0x18 + hashTableSize + nameTableSize + groupCount * 8 + bodySize;
        if (declaredLength > dataLength) {
            throw new Error("PVF 结构异常：声明的数据区超出文件实际大小，文件可能已损坏或被截断。");
        }
    }

    async _parseNameTable(nameBytes) {
        if (nameBytes.length < 16) return;
        let idx = 8;
        // protected_nkpi（CN）字符串池密钥为大写变体 "StRa"/"StRw"，旧格式为 "sTrA"/"sTrW"
        const useProtected = this._headerFormat === PvfFormat.PROTECTED;
        const keyA = useProtected ? "StRa" : "sTrA";
        const keyW = useProtected ? "StRw" : "sTrW";

        const sTrA = this._readStringSection(nameBytes, idx, keyA, 0xaa74472e);
        if (sTrA) {
            idx = sTrA.nextIdx;
            this.strABuf = await zlibDecompress(sTrA.encrypted);
        }
        const sTrW = this._readStringSection(nameBytes, idx, keyW, 0x9a82f037);
        if (sTrW) {
            this.strWBuf = await zlibDecompress(sTrW.encrypted);
        }
    }

    _readStringSection(bytes, idx, key, xorConst) {
        if (idx + 8 > bytes.length) return null;
        const cnt1 = readInt32LE(bytes, idx);
        const encSize = (cnt1 ^ xorConst) | 0;
        if (encSize <= 0 || idx + 8 + encSize > bytes.length) return null;
        const encrypted = bytes.slice(idx + 8, idx + 8 + encSize);
        if (this._headerFormat === PvfFormat.PROTECTED) pvfDecryptProtected(key, encrypted, MAGIC_DECRYPT2);
        else pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);
        return { encrypted, nextIdx: idx + 8 + encSize };
    }

    // ---- String resolution ----
    resolveString(magicOff) {
        if (magicOff < 0) return "";
        if ((magicOff & 1) !== 0) {
            const idx = magicOff >> 1;
            const vc = this._strWValueCache;
            if (vc && vc[idx] !== undefined) return vc[idx];
            const result = this._readUnicodeString(this.strWBuf, idx * 2);
            if (vc) vc[idx] = result;
            return result;
        }
        const idx = magicOff >> 1;
        const vc = this._strAValueCache;
        if (vc && vc[idx] !== undefined) return vc[idx];
        const result = this._readUtf8String(this.strABuf, idx);
        if (vc) vc[idx] = result;
        return result;
    }

    _readUtf8String(buffer, start) {
        if (!buffer || start < 0 || start >= buffer.length) return "";
        let end = start;
        while (end < buffer.length && buffer[end] !== 0) end++;
        return decodeText(buffer.subarray(start, end), this.strEncoding);
    }

    _readUnicodeString(buffer, start) {
        if (!buffer || start < 0 || start >= buffer.length) return "";
        let end = start;
        while (end + 1 < buffer.length && !(buffer[end] === 0 && buffer[end + 1] === 0)) end += 2;
        const len = end - start;
        if (len <= 0) return "";
        return decodeUtf16LE(buffer.subarray(start, start + len));
    }

    // ---- String offset management (for editing) ----
    // 同步构建字符串表缓存：value->offset（getOrAddStringOffset 编辑用）+
    // offset->value（resolveString O(1) 查表用）。parse() 在文件表解析前调用，
    // setEncoding 在重解析前调用；_ensureStringOffsetCache 兜底懒构建。
    _buildStringCaches() {
        if (this._strAOffsetCache && this._strWOffsetCache) return;
        this._strAOffsetCache = new Map();
        this._strWOffsetCache = new Map();
        this._strAValueCache = [];
        this._strWValueCache = [];
        if (!this.strABuf) this.strABuf = new Uint8Array([0]);
        if (!this.strWBuf) this.strWBuf = new Uint8Array([0, 0]);

        let pos = 0;
        while (pos < this.strABuf.length) {
            let end = pos;
            while (end < this.strABuf.length && this.strABuf[end] !== 0) end++;
            const value = end > pos ? decodeText(this.strABuf.subarray(pos, end), this.strEncoding) : "";
            if (!this._strAOffsetCache.has(value)) this._strAOffsetCache.set(value, pos << 1);
            this._strAValueCache[pos] = value;
            pos = end + 1;
        }

        pos = 0;
        while (pos + 1 < this.strWBuf.length) {
            let end = pos;
            while (end + 1 < this.strWBuf.length && !(this.strWBuf[end] === 0 && this.strWBuf[end + 1] === 0)) end += 2;
            const value = end > pos ? decodeUtf16LE(this.strWBuf.subarray(pos, end)) : "";
            if (!this._strWOffsetCache.has(value)) this._strWOffsetCache.set(value, ((pos >> 1) << 1) | 1);
            this._strWValueCache[pos >> 1] = value;
            pos = end + 2;
        }
    }

    _ensureStringOffsetCache() {
        this._buildStringCaches();
    }

    getOrAddStringOffset(value, preferUnicode = false) {
        if (value === null) value = "";
        this._ensureStringOffsetCache();

        if (!preferUnicode) {
            if (this._strAOffsetCache.has(value)) return this._strAOffsetCache.get(value);
            if (this._strWOffsetCache.has(value)) return this._strWOffsetCache.get(value);
        } else {
            if (this._strWOffsetCache.has(value)) return this._strWOffsetCache.get(value);
            if (this._strAOffsetCache.has(value)) return this._strAOffsetCache.get(value);
        }

        if (preferUnicode) return this._appendUnicodeString(value);
        return this._appendUtf8String(value);
    }

    _appendUtf8String(value) {
        const textBytes = encodeText(value, this.strEncoding);
        const oldLen = this.strABuf.length;
        const next = new Uint8Array(oldLen + textBytes.length + 1);
        next.set(this.strABuf, 0);
        next.set(textBytes, oldLen);
        next[next.length - 1] = 0;
        this.strABuf = next;
        const magicOffset = oldLen << 1;
        this._strAOffsetCache.set(value, magicOffset);
        return magicOffset;
    }

    _appendUnicodeString(value) {
        const textBytes16 = encodeUtf16LE(value);
        let oldLen = this.strWBuf.length;
        if ((oldLen & 1) !== 0) oldLen++;
        const next = new Uint8Array(oldLen + textBytes16.length + 2);
        next.set(this.strWBuf, 0);
        next.set(textBytes16, oldLen);
        this.strWBuf = next;
        const magicOffset = ((oldLen >> 1) << 1) | 1;
        this._strWOffsetCache.set(value, magicOffset);
        return magicOffset;
    }

    // ---- File table & groups ----
    _parseFileTable(buf, offset, count) {
        for (let i = 0; i < count; i++) {
            const off = offset + i * 0x18;
            const nameOff = readInt32LE(buf, off);
            const pathOff = readInt32LE(buf, off + 4);
            const chunkIndex = readInt32LE(buf, off + 8);
            const dataOffset = readInt32LE(buf, off + 12);
            const dataSize = readInt32LE(buf, off + 16);
            const dataType = readInt32LE(buf, off + 20);
            const name = this.resolveString(nameOff);
            const path = this.resolveString(pathOff);
            const isDir = name.endsWith("/") || name.endsWith("\\");
            this.files.push({
                name,
                path,
                nameOff,
                pathOff,
                chunkIndex,
                dataOffset,
                dataSize,
                dataType,
                index: i,
                isDir,
                fullpath: this._normalizePath(path, name)
            });
        }
    }

    _normalizePath(path, name) {
        let n = (name || "").replace(/\\/g, "/");
        if (n.startsWith("./")) n = n.substring(2);
        while (n.startsWith("/")) n = n.substring(1);
        let p = (path || "").replace(/\\/g, "/");
        p = p.replace(/^\.\//, "").replace(/^\//, "");
        if (p) return p + "/" + n;
        return n;
    }

    _parseGroups(buf, count) {
        for (let i = 0; i < count; i++) {
            const off = i * 8;
            this.groups.push({
                compressedSize: readInt32LE(buf, off),
                originalSize: readInt32LE(buf, off + 4)
            });
        }
    }

    // ---- Chunk access ----
    async _getChunk(chunkIndex) {
        if (this._chunkCache.has(chunkIndex)) return this._chunkCache.get(chunkIndex);
        if (chunkIndex < 0 || chunkIndex >= this.groups.length) return null;

        const prev = chunkIndex > 0 ? this.groups[chunkIndex - 1].compressedSize : 0;
        const curr = this.groups[chunkIndex].compressedSize;
        const start = this.bodyOffset + prev;
        const size = curr - prev;
        if (size <= 0 || start + size > this.bodyOffset + this.bodyLength) return null;

        const encrypted = this.buf.slice(start, start + size);
        if (this._headerFormat === PvfFormat.PROTECTED) pvfDecryptProtected("bODy", encrypted, MAGIC_DECRYPT);
        else pvfDecrypt("BodY", encrypted, MAGIC_DECRYPT);
        const decompressed = await zlibDecompress(encrypted);
        if (this._chunkCache.size >= 64) this._chunkCache.delete(this._chunkCache.keys().next().value);
        this._chunkCache.set(chunkIndex, decompressed);
        return decompressed;
    }

    _getChunkRawEncrypted(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.groups.length) return null;
        const prev = chunkIndex > 0 ? this.groups[chunkIndex - 1].compressedSize : 0;
        const curr = this.groups[chunkIndex].compressedSize;
        const start = this.bodyOffset + prev;
        const size = curr - prev;
        if (size <= 0 || start + size > this.bodyOffset + this.bodyLength) return null;
        return this.buf.slice(start, start + size);
    }

    async getFileData(file) {
        if (file.isDir || file.dataSize <= 0) return new Uint8Array(0);
        if (this._overlay.has(file.index)) return this._overlay.get(file.index);
        const chunk = await this._getChunk(file.chunkIndex);
        if (!chunk || file.dataOffset < 0 || file.dataOffset + file.dataSize > chunk.length) return null;
        return chunk.subarray(file.dataOffset, file.dataOffset + file.dataSize);
    }

    // 批量读取文件数据：按 chunk 分组，每个 chunk 仅解压一次（不依赖 _chunkCache 的 20 槽窗口，
    // 避免大档案下同一 chunk 被反复 zlib 解压）。返回与 files 等长的数组，读取失败项为 null。
    async getFilesData(files) {
        const result = new Array(files.length).fill(null);
        const byChunk = new Map();
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir || f.dataSize <= 0) continue;
            if (this._overlay.has(f.index)) {
                result[i] = this._overlay.get(f.index);
                continue;
            }
            const list = byChunk.get(f.chunkIndex);
            if (list) list.push(i);
            else byChunk.set(f.chunkIndex, [i]);
        }
        const entries = [...byChunk.entries()].sort((a, b) => a[0] - b[0]);
        for (const [chunkIndex, indexes] of entries) {
            const chunk = await this._getChunk(chunkIndex);
            if (!chunk) continue;
            for (const i of indexes) {
                const f = files[i];
                if (f.dataOffset < 0 || f.dataOffset + f.dataSize > chunk.length) continue;
                result[i] = chunk.subarray(f.dataOffset, f.dataOffset + f.dataSize);
            }
        }
        return result;
    }

    // ---- Content decode ----
    // 通用：读取 token 流（dataType=1），每 5 字节一个 token (1 字节类型 + 4 字节小端 int32)
    _readTokens(data) {
        const count = Math.floor(data.length / 5);
        const tokens = new Array(count);
        for (let i = 0; i < count; i++) {
            const off = i * 5;
            tokens[i] = { type: data[off], value: readInt32LE(data, off + 1) };
        }
        return tokens;
    }

    // 是否数字 token（type 0=整数，2=浮点）
    _isNumType(t) {
        return t === 0 || t === 2;
    }

    // 格式化数字 token 为文本：整数直接转字符串，浮点用 float32ToString
    _fmtNum(type, value) {
        return type === 0 ? String(value) : float32ToString(value);
    }

    // 格式化为反引号字符串：解析字符串表偏移并转义内部 `
    _fmtBacktickStr(value) {
        return "`" + this._escapeBacktick(this.resolveString(value)) + "`";
    }

    // 从索引 j 起合并连续数字 token 到 row，返回新的 { row, j }
    _appendNumRun(tokens, j, row) {
        while (j < tokens.length && this._isNumType(tokens[j].type)) {
            row += " " + this._fmtNum(tokens[j].type, tokens[j].value);
            j++;
        }
        return { row, j };
    }

    // 统一换行：\r\n 与单独 \r 转为 \n
    _normalizeLines(text) {
        return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    // 转义反引号：` -> ``（PVF 反引号串的转义规则）
    _escapeBacktick(s) {
        return s ? s.replace(/`/g, "``") : s;
    }

    // 文件类型: dataType=1 通用 token 流（默认：未登记扩展名的文件，如 .str / .aic / .ani / .etc）
    decodeToken(data) {
        const tokens = this._readTokens(data);
        if (tokens.length === 0) return "";
        const parts = [];
        let i = 0;
        while (i < tokens.length) {
            const { type, value } = tokens[i];
            switch (type) {
                case 0:
                case 2: {
                    // 连续数字 token 合并到同一行展示；编码器按空白拆分，单行/多行写法等价。
                    let row = this._fmtNum(type, value);
                    let j;
                    ({ row, j } = this._appendNumRun(tokens, i + 1, row));
                    parts.push(row + "\n");
                    i = j;
                    break;
                }
                case 3:
                    parts.push("\n" + this.resolveString(value) + "\n");
                    i++;
                    break;
                case 5:
                    parts.push("\n{5=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                    i++;
                    break;
                case 6: {
                    // 反引号字符串与其后连续数字合并到同一行（如 .lst 名称/索引、.aic 角色信息）。
                    let row = this._fmtBacktickStr(value);
                    let j;
                    ({ row, j } = this._appendNumRun(tokens, i + 1, row));
                    parts.push(row + "\n");
                    i = j;
                    break;
                }
                case 7:
                    parts.push("\n{7=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                    i++;
                    break;
                default:
                    parts.push("?(" + type + "," + value + ")\n");
                    i++;
                    break;
            }
        }
        return this._normalizeLines(parts.join(""));
    }

    // 文件类型: *.lst（dataType=1）
    // 「数字 + 反引号字符串」或「反引号字符串 + 数字」合并到同一行，每条独占一行。
    //   0  `Character/Character.chn.str`
    //   `G.S.D` 7
    decodeLst(data) {
        const tokens = this._readTokens(data);
        if (tokens.length === 0) return "";
        const parts = [];
        let i = 0;
        while (i < tokens.length) {
            const { type, value } = tokens[i];
            if (this._isNumType(type)) {
                // 数字（含连续数字）与紧随其后的反引号字符串合并：`数字 `字符``
                let row = this._fmtNum(type, value);
                let j;
                ({ row, j } = this._appendNumRun(tokens, i + 1, row));
                if (j < tokens.length && tokens[j].type === 6) {
                    row += " " + this._fmtBacktickStr(tokens[j].value);
                    j++;
                }
                parts.push(row + "\n");
                i = j;
            } else if (type === 6) {
                // 反引号字符串与紧随其后的连续数字合并：`字符` 数字
                let row = this._fmtBacktickStr(value);
                let j;
                ({ row, j } = this._appendNumRun(tokens, i + 1, row));
                parts.push(row + "\n");
                i = j;
            } else {
                switch (type) {
                    case 3:
                        parts.push(this.resolveString(value) + "\n");
                        break;
                    case 5:
                        parts.push("{5=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                        break;
                    case 7:
                        parts.push("{7=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                        break;
                    default:
                        parts.push("?(" + type + "," + value + ")\n");
                        break;
                }
                i++;
            }
        }
        return this._normalizeLines(parts.join(""));
    }

    // 文件类型: dataType=3 UTF-16 文本
    decodeUTF16(data) {
        return this._normalizeLines(decodeUtf16LE(data));
    }

    // 是否为 .lst 列表文件（其解码文本中会追加引用文件的 [name] 名称展示）
    isLstFile(file) {
        return !!(file && file.name && /\.lst$/i.test(file.name));
    }

    // fullpath -> file 索引（懒构建；重命名/路径变更后置空重建）
    _buildPathIndex() {
        if (this._pathIndex) return this._pathIndex;
        const idx = new Map();
        const nameIdx = new Map();
        for (const f of this.files) {
            if (f.isDir || !f.fullpath) continue;
            idx.set(f.fullpath, f);
            const key = f.name.toLowerCase();
            if (!nameIdx.has(key)) nameIdx.set(key, []);
            nameIdx.get(key).push(f);
        }
        this._pathIndex = idx;
        this._nameIndex = nameIdx;
        return idx;
    }

    // 物品元数据快速定向扫描的标签集。[name] 为必需（缺失则整体回退全文解析），
    // 其余标签可选：存在才提取，缺失字段为 null。语义对齐 86JPGMTool 物品发放解析
    // （PvfIndexService.Items.cs / StackableExpirationPolicyResolver.cs，见 docs/pvf-item-grant-parsing.md）。
    static ITEM_META_TAGS = [
        "[name]",
        "[rarity]",
        "[minimum level]",
        "[equipment type]",
        "[stackable type]",
        "[item category]",
        "[random option]",
        "[usable period]",
        "[expiration date]",
        "[daily delete item]"
    ];

    // 常用标签的字符串表偏移（懒构建）。token 流中标签以 type 3 token 的字符串表偏移表示，
    // 直接比较偏移即可识别标签，无需对每个标签 token 调用 resolveString 解码文本。
    _buildTagOffsetCache() {
        if (this._tagOffsetCache) return this._tagOffsetCache;
        this._ensureStringOffsetCache();
        const cache = new Map();
        for (const tag of PvfArchive.ITEM_META_TAGS) {
            let off = this._strAOffsetCache.get(tag);
            if (off == null) off = this._strWOffsetCache.get(tag);
            cache.set(tag, off);
        }
        this._tagOffsetCache = cache;
        return cache;
    }

    // 读取标签后的一个值 token：type 0 整数、type 6/5/7 字符串（resolveString 天然反转义）。
    // type 3 若为标签形式（[...]）视为下一标签而非值，返回 null。
    _readItemTagValue(data, off) {
        if (off + 5 > data.length) return null;
        const type = data[off];
        const value = readInt32LE(data, off + 1);
        if (type === 0) return value;
        if (type === 6 || type === 5 || type === 7) return this.resolveString(value);
        if (type === 3) {
            const s = this.resolveString(value);
            return /^\[.*\]$/.test(s) ? null : s;
        }
        return null;
    }

    // token 级定向扫描物品文件（dataType=1），提取 ITEM_META_TAGS 标签集，避免 decodeContent 全文解码。
    // 返回 { name, rarity, minLevel, equipType, stackableType, itemCategory, hasRandomOption,
    //        usablePeriod, expirationDate, dailyDelete }，字段缺省为 null。
    // 字符串表中缺少 [name] 偏移时返回 null，调用方应回退到全文文本解析；其余标签可选。
    _extractItemTagsFast(file, data) {
        const tags = this._buildTagOffsetCache();
        const nameOff = tags.get("[name]");
        if (nameOff == null) return null;
        const offsetToKey = new Map();
        for (const tag of PvfArchive.ITEM_META_TAGS) {
            const off = tags.get(tag);
            if (off == null) continue;
            offsetToKey.set(off, tag);
        }
        const result = {
            name: null,
            rarity: null,
            minLevel: null,
            equipType: null,
            stackableType: null,
            itemCategory: null,
            hasRandomOption: false,
            usablePeriod: null,
            expirationDate: null,
            dailyDelete: null
        };
        const len = data.length - (data.length % 5);
        for (let off = 0; off < len; off += 5) {
            if (data[off] !== 3) continue;
            const value = readInt32LE(data, off + 1);
            const tag = offsetToKey.get(value);
            if (!tag) continue;
            const v = this._readItemTagValue(data, off + 5);
            switch (tag) {
                case "[name]":
                    result.name = v == null ? null : String(v);
                    break;
                case "[random option]":
                    // 仅记存在性；值（若有）不参与分类
                    result.hasRandomOption = true;
                    break;
                case "[rarity]":
                case "[minimum level]":
                case "[usable period]":
                case "[daily delete item]": {
                    if (typeof v === "number") {
                        result[tag === "[rarity]" ? "rarity" : tag === "[minimum level]" ? "minLevel" : tag === "[usable period]" ? "usablePeriod" : "dailyDelete"] = v;
                    } else {
                        const m = /^(\d+)/.exec(String(v == null ? "" : v));
                        const parsed = m ? parseInt(m[1], 10) : null;
                        result[tag === "[rarity]" ? "rarity" : tag === "[minimum level]" ? "minLevel" : tag === "[usable period]" ? "usablePeriod" : "dailyDelete"] = parsed;
                    }
                    break;
                }
                case "[equipment type]":
                    result.equipType = v == null ? null : String(v);
                    break;
                case "[stackable type]":
                    result.stackableType = v == null ? null : String(v);
                    break;
                case "[item category]":
                    result.itemCategory = v == null ? null : String(v);
                    break;
                case "[expiration date]":
                    result.expirationDate = v == null ? null : String(v);
                    break;
            }
        }
        return result;
    }

    // 从已读取的文件数据中提取 [name] 标签值（无 IO）。token 流文件走 _extractItemTagsFast
    // 定向扫描，顺带把完整物品元数据写入 _itemMetaCache，供 listLstItemMeta 复用，
    // 避免同一文件二次读取解码。非 token 流或无标签偏移时回退到全文文本解析。
    _extractNameFromData(file, data) {
        if (!data || data.length === 0) return "";
        if (file.dataType === 1) {
            const m = this._extractItemTagsFast(file, data);
            if (m) {
                if (!this._itemMetaCache.has(file.index)) {
                    this._itemMetaCache.set(file.index, this._metaWithoutName(m));
                }
                return m.name ? String(m.name) : "";
            }
            return extractNameFromText(this.decodeContent(file, data));
        }
        return extractNameFromText(this.decodeContent(file, data));
    }

    // 剔除 name 字段的元数据快照（_itemMetaCache 存 rarity/minLevel 等非展示键，name 走 _nameTagCache）
    _metaWithoutName(m) {
        return {
            rarity: m.rarity,
            minLevel: m.minLevel,
            equipType: m.equipType,
            stackableType: m.stackableType,
            itemCategory: m.itemCategory,
            hasRandomOption: m.hasRandomOption,
            usablePeriod: m.usablePeriod,
            expirationDate: m.expirationDate,
            dailyDelete: m.dailyDelete
        };
    }

    // 提取指定文件的 [name] 标签值（异步读取 + 缓存）。常用于 .lst 列表展示引用文件的缩略名称。
    async extractNameTag(file) {
        if (!file || file.isDir) return "";
        if (this._nameTagCache.has(file.index)) return this._nameTagCache.get(file.index);
        let name = "";
        try {
            const data = await this.getFileData(file);
            name = this._extractNameFromData(file, data);
        } catch (e) {
            name = "";
        }
        this._nameTagCache.set(file.index, name);
        return name;
    }

    // 批量提取 [name] 标签值：内部用 getFilesData 按 chunk 分组读取，每个 chunk 仅解压一次。
    // 返回与 files 等长的名称数组（缺省为空串），并顺带填充 _itemMetaCache。
    async extractNameTags(files) {
        const names = new Array(files.length).fill("");
        const pending = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir || this._nameTagCache.has(f.index)) continue;
            pending.push({ index: i, file: f });
        }
        pending.sort((a, b) => (a.file.chunkIndex || 0) - (b.file.chunkIndex || 0));
        for (let i = 0; i < pending.length; i += 500) {
            const batch = pending.slice(i, i + 500);
            const datas = await this.getFilesData(batch.map(p => p.file));
            for (let n = 0; n < batch.length; n++) {
                const p = batch[n];
                let name = "";
                try {
                    name = this._extractNameFromData(p.file, datas[n]);
                } catch (e) {
                    name = "";
                }
                this._nameTagCache.set(p.file.index, name);
                names[p.index] = name;
            }
        }
        return names;
    }

    // .lst 增强解码：在「数字 `引用路径`」行尾追加引用文件的 [name] 标签值，便于识别物品名称。
    // 引用路径优先相对 .lst 所在目录解析（如 stackable.lst 中的 cash/store_basic.stk -> stackable/cash/store_basic.stk），
    // 失败时依次尝试原始引用路径、按文件名（忽略目录、大小写不敏感）回退匹配。
    async decodeLstWithNames(file) {
        const cached = this._lstTextCache.get(file.index);
        if (cached != null) return cached;
        const t0 = Date.now();
        const data = await this.getFileData(file);
        if (!data || data.length === 0) return "";
        const baseText = this.decodeLst(data);
        const lines = baseText.split("\n");
        const baseDir = String(file.fullpath || file.name || "")
            .replace(/\\/g, "/")
            .split("/")
            .slice(0, -1)
            .join("/");
        const idx = this._buildPathIndex();
        const nameIdx = this._nameIndex || new Map();
        const rows = [];
        const pending = new Map();
        const missed = [];
        for (const line of lines) {
            const m = /^(\d+)\s+`([^`]*)`$/.exec(line.trim());
            if (!m) {
                rows.push({ line, target: null });
                continue;
            }
            const ref = m[2].replace(/\\/g, "/");
            const candidates = [];
            if (ref.startsWith("/")) {
                candidates.push(ref.replace(/^\/+/, ""));
            } else {
                if (baseDir) candidates.push(baseDir + "/" + ref);
                candidates.push(ref);
            }
            let target = null;
            for (const c of candidates) {
                target = idx.get(c);
                if (target) break;
            }
            if (!target) {
                const base = ref.split("/").pop();
                const byName = nameIdx.get(String(base).toLowerCase());
                if (byName && byName.length === 1) target = byName[0];
            }
            if (!target) {
                if (missed.length < 5) missed.push(ref);
                rows.push({ line, target: null });
                continue;
            }
            let refMap = this._lstRefMap.get(file.index);
            if (!refMap) {
                refMap = new Map();
                this._lstRefMap.set(file.index, refMap);
            }
            refMap.set(m[2], target);
            rows.push({ line, target });
            pending.set(target.index, target);
        }
        // 按 chunk 顺序批处理，批量读取使每个 chunk 仅解压一次，避免大档案下反复 zlib 解压
        const targets = [...pending.values()].sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
        await this.extractNameTags(targets);
        let matched = 0;
        let named = 0;
        const out = rows.map(({ line, target }) => {
            if (!target) return line;
            matched++;
            const name = this._nameTagCache.get(target.index) || "";
            // 仅排除会破坏行结构或脚本语法的字符（换行/反引号/花括号/方括号/井号）；
            // 空格必须允许——英文版（如 90US）的名称几乎都含空格，之前误滤导致不显示
            if (name && !/[\n\r`{}\[\]#]/.test(name)) {
                named++;
                return `${line.trim()} ${name}`;
            }
            return line;
        });
        const result = this._normalizeLines(out.join("\n"));
        this._lstTextCache.set(file.index, result);
        console.info(
            `[PVF] ${file.name} 名称解析完成：引用 ${rows.length} 行，匹配 ${matched} 个文件，提取名称 ${named} 个，耗时 ${Date.now() - t0}ms` +
                (missed.length ? `，未匹配示例：${missed.join(", ")}` : "")
        );
        return result;
    }

    // 查询 .lst 行中反引号引用路径对应的文件（decodeLstWithNames 解析时构建映射）
    getLstRefTarget(file, ref) {
        if (!file || ref == null) return null;
        const map = this._lstRefMap.get(file.index);
        return map ? map.get(ref) || null : null;
    }

    // 结构化解析 .lst：返回 [{ code, ref, name }] 条目列表。
    // 复用 decodeLstWithNames（引用文件的 [name] 标签追加到行尾），再按「数字 `路径` [名称]」拆分；
    // 编码即每行首个数字，名称缺省为空串（保留 ref 便于核对）。
    async listLstItems(file) {
        const text = await this.decodeLstWithNames(file);
        const items = [];
        for (const raw of text.split("\n")) {
            const m = /^(\d+)\s+`((?:[^`]|``)*)`(?:\s+(.*))?$/.exec(raw.trim());
            if (!m) continue;
            items.push({ code: m[1], ref: m[2].replace(/``/g, "`"), name: m[3] ? m[3].trim() : "" });
        }
        return items;
    }

    // 确保 .lst 的引用映射（ref -> file）已构建；listLstItems / decodeLstWithNames 后即就绪。
    async _ensureLstRefMap(file) {
        await this.decodeLstWithNames(file);
        return this._lstRefMap.get(file.index) || new Map();
    }

    // 从已读取的数据解析单个物品文件的完整元数据（无 IO）。
    // 无相应标签或解析失败时字段为 null；整数字段为 number 或 null。
    // token 流文件走 _extractItemTagsFast 定向扫描；非 token 流或无标签偏移时回退全文文本解析。
    _resolveItemMetaFromData(file, data) {
        if (!data || data.length === 0) return null;
        if (file.dataType === 1) {
            const m = this._extractItemTagsFast(file, data);
            if (m) return this._metaWithoutName(m);
            const text = this.decodeContent(file, data);
            return this._metaFromText(text);
        }
        return this._metaFromText(this.decodeContent(file, data));
    }

    // 全文文本路径的元数据提取（与 token 快速路径同语义）
    _metaFromText(text) {
        const tagRes = extractTagFromText(text, "random option");
        return {
            rarity: extractIntFieldFromText(text, "rarity"),
            minLevel: extractIntFieldFromText(text, "minimum level"),
            equipType: extractStringFieldFromText(text, "equipment type"),
            stackableType: extractStringFieldFromText(text, "stackable type"),
            itemCategory: extractStringFieldFromText(text, "item category"),
            hasRandomOption: tagRes != null,
            usablePeriod: extractIntFieldFromText(text, "usable period"),
            expirationDate: extractStringFieldFromText(text, "expiration date"),
            dailyDelete: extractIntFieldFromText(text, "daily delete item")
        };
    }

    // 为 listLstItems 的结果批量解析引用物品文件的元数据（品质/使用等级/类型/品质细分/期限）。
    // 返回与 items 等长的数组，每项 { rarity, minLevel, equipType, stackableType, itemCategory,
    // hasRandomOption, usablePeriod, expirationDate, dailyDelete }（字段可缺省为 null）；
    // 引用无法解析的项为 null。
    // 大多数条目在 extractNameTag 阶段已预填充 _itemMetaCache；缺失项走 getFilesData 批量读取
    // （按 chunk 分组，每个 chunk 仅解压一次），结果直接取自返回值，缓存仅作重复调用优化。
    async listLstItemMeta(lstFile, items) {
        const map = await this._ensureLstRefMap(lstFile);
        const metas = new Array(items.length).fill(null);
        const pending = [];
        for (let i = 0; i < items.length; i++) {
            const target = map.get(items[i].ref) || map.get(items[i].ref.replace(/`/g, "``"));
            if (!target) continue;
            const cached = this._itemMetaCache.get(target.index);
            if (cached !== undefined) {
                metas[i] = cached;
            } else {
                pending.push({ index: i, target });
            }
        }
        pending.sort((a, b) => (a.target.chunkIndex || 0) - (b.target.chunkIndex || 0));
        for (let i = 0; i < pending.length; i += 500) {
            const batch = pending.slice(i, i + 500);
            const datas = await this.getFilesData(batch.map(p => p.target));
            for (let n = 0; n < batch.length; n++) {
                const p = batch[n];
                let meta = null;
                try {
                    meta = this._resolveItemMetaFromData(p.target, datas[n]);
                } catch (e) {
                    meta = null;
                }
                // 缓存条目数天然 ≤ 文件总数（每个文件最多一条），无需截断；截断会导致读不到结果
                this._itemMetaCache.set(p.target.index, meta);
                metas[p.index] = meta;
            }
        }
        return metas;
    }

    // 文件类型: *.dat（dataType=1）等纯数字定长记录表
    // 通用 decodeToken 会把所有连续数字合并到同一行（_appendNumRun），对定长记录表不可读。
    // 这里按"连续 ID"自动探测每条记录的字段数：首字段为 ID，下一条记录 ID = 首条 ID + 1，
    // 再用第三条记录 ID（首条 ID + 2）校验宽度稳定，之后按记录分行输出：
    //   10000 0 0 0 ... 0
    //   10001 0 0 0 ... 0
    // 探测失败（含非数字 token 或 ID 不连续）则回退到 decodeToken。
    decodeDat(data) {
        const tokens = this._readTokens(data);
        if (tokens.length === 0) return "";
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== 0 && tokens[i].type !== 2) return this.decodeToken(data);
        }
        const firstId = tokens[0].value;
        let recordSize = -1;
        const limit = Math.floor(tokens.length / 2);
        for (let i = 1; i <= limit; i++) {
            if (tokens[i].value === firstId + 1 && tokens[i * 2] && tokens[i * 2].value === firstId + 2) {
                recordSize = i;
                break;
            }
        }
        if (recordSize <= 1) return this.decodeToken(data);
        const lines = [];
        for (let i = 0; i < tokens.length; i += recordSize) {
            const row = [];
            for (let j = 0; j < recordSize && i + j < tokens.length; j++) {
                row.push(this._fmtNum(tokens[i + j].type, tokens[i + j].value));
            }
            lines.push(row.join(" "));
        }
        return this._normalizeLines(lines.join("\n"));
    }

    // 取文件名扩展名（小写，不含 '.'）；无扩展名返回空串
    _extOf(name) {
        if (!name) return "";
        const i = name.lastIndexOf(".");
        return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
    }

    // 原始字节 -> 文本的总入口：按 (dataType, 扩展名) 查 CONTENT_DECODERS 选解析方法，
    // 未登记扩展名回退到该 dataType 的 "*" 默认方法；未知 dataType 返回空串。
    decodeContent(file, data) {
        if (!data || data.length === 0) return "";
        const byExt = CONTENT_DECODERS[file.dataType];
        if (!byExt) return "";
        const fn = byExt[this._extOf(file.name)] || byExt["*"];
        return fn ? this[fn](data) : "";
    }

    // 汇总当前档案中所有文件后缀，按 dataType 分组，标注是否已登记专用解析方法，
    // 方便后期按扩展名做差异化解析。返回 { [dataType]: [{ ext, count, registered }] }，
    // 按 count 降序；registered=false 的即为当前走默认解析、可差异化的候选后缀。
    listFileTypes() {
        const tally = {};
        for (const file of this.files) {
            if (file.isDir) continue;
            const dt = file.dataType;
            if (!tally[dt]) tally[dt] = {};
            const key = this._extOf(file.name) || "(无后缀)";
            tally[dt][key] = (tally[dt][key] || 0) + 1;
        }
        const result = {};
        for (const dt of Object.keys(tally).sort((a, b) => Number(a) - Number(b))) {
            const byExt = CONTENT_DECODERS[dt] || {};
            result[dt] = Object.entries(tally[dt])
                .map(([ext, count]) => ({
                    ext,
                    count,
                    registered: ext !== "(无后缀)" && Boolean(byExt[ext])
                }))
                .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
        }
        return result;
    }

    // ---- Content encode (text -> raw bytes) ----
    // 文件类型: dataType=1 token 流文本 -> 5 字节 token 序列
    // 与 decodeToken 互逆：按空白拆分文本为 token（反引号字符串 / {N=...} 标记 / [标签] / 数字 / 裸串），
    // 每个 token 写为 1 字节类型 + 4 字节小端 int32。# 为行注释。
    encodeTokenText(text) {
        const tokens = [];
        let i = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
                i++;
                continue;
            }
            if (ch === "#") {
                while (i < text.length && text[i] !== "\n") i++;
                continue;
            }
            if (ch === "`") {
                const result = this._tryReadBacktickString(text, i);
                if (result) {
                    tokens.push({ type: 6, value: this.getOrAddStringOffset(result.value) });
                    i = result.nextIndex;
                    continue;
                }
            }
            if (ch === "{") {
                const end = this._findMarkerEnd(text, i + 1);
                if (end > i) {
                    const marker = text.substring(i, end + 1).trim();
                    const markerToken = this._tryParseSpecialMarker(marker);
                    if (markerToken) {
                        tokens.push(markerToken);
                        i = end + 1;
                        continue;
                    }
                }
            }
            if (ch === "[") {
                let nl = text.indexOf("\n", i + 1);
                if (nl < 0) nl = text.length;
                const end = text.indexOf("]", i + 1);
                if (end > i && end < nl) {
                    const tag = text.substring(i, end + 1);
                    tokens.push({ type: 3, value: this.getOrAddStringOffset(tag) });
                    i = end + 1;
                    continue;
                }
                // 同行无闭合 ]：以 [ 开头的裸 token（如原始数据中的 [/BEHAVI），
                // 读取到空白作为字符串 token，避免跨行吞并到下一个 ]。
                const bStart = i;
                i++;
                while (i < nl && !/[\s`{}\[\]#]/.test(text[i])) i++;
                const bToken = text.substring(bStart, i);
                if (bToken.length > 0) {
                    tokens.push({ type: 3, value: this.getOrAddStringOffset(bToken) });
                }
                continue;
            }
            // Read bare token
            const start = i;
            while (i < text.length && !/[\s`{\[]/.test(text[i])) i++;
            if (i === start) {
                i++;
                continue;
            }
            const token = text.substring(start, i);
            if (/^-?\d+$/.test(token)) {
                tokens.push({ type: 0, value: parseInt(token, 10) });
            } else if (/^-?\d*\.\d+$/.test(token) || /^-?\d+\.\d*$/.test(token)) {
                const dv = new DataView(new ArrayBuffer(4));
                dv.setFloat32(0, parseFloat(token), true);
                tokens.push({ type: 2, value: dv.getInt32(0, true) });
            } else {
                tokens.push({ type: 3, value: this.getOrAddStringOffset(token) });
            }
        }

        const raw = new Uint8Array(tokens.length * 5);
        for (let n = 0; n < tokens.length; n++) {
            const off = n * 5;
            raw[off] = tokens[n].type;
            writeInt32LE(raw, off + 1, tokens[n].value);
        }
        return raw;
    }

    // 读取反引号字符串：从 start 处的 ` 开始，到下一个未转义的 ` 结束；`` 转义为字面 `。
    // 可跨多行。返回 { value, nextIndex }，不是反引号串则返回 null。
    _tryReadBacktickString(text, start) {
        if (start < 0 || start >= text.length || text[start] !== "`") return null;
        let i = start + 1;
        let result = "";
        while (i < text.length) {
            if (text[i] === "`") {
                if (i + 1 < text.length && text[i + 1] === "`") {
                    result += "`";
                    i += 2;
                    continue;
                }
                return { value: result, nextIndex: i + 1 };
            }
            result += text[i];
            i++;
        }
        return { value: result, nextIndex: i };
    }

    // 定位 {N=...} 标记的闭合 }，跳过反引号字符串内的 }。返回 } 的索引，未找到返回 -1。
    _findMarkerEnd(text, start) {
        let inBacktick = false;
        for (let i = start; i < text.length; i++) {
            if (text[i] === "`") {
                if (inBacktick && i + 1 < text.length && text[i + 1] === "`") {
                    i++;
                    continue;
                }
                inBacktick = !inBacktick;
                continue;
            }
            if (!inBacktick && text[i] === "}") return i;
        }
        return -1;
    }

    // 解析 {5=...} / {7=...} 特殊标记为 token：内部若为纯数字则用整数值，否则写入字符串表用其偏移。
    _tryParseSpecialMarker(marker) {
        if (!marker || marker.length < 4 || marker[0] !== "{" || marker[marker.length - 1] !== "}") return null;
        let type;
        if (marker.startsWith("{5=")) type = 5;
        else if (marker.startsWith("{7=")) type = 7;
        else return null;

        let inner = marker.substring(3, marker.length - 1).trim();
        if (inner.length >= 2 && inner[0] === "`" && inner[inner.length - 1] === "`") inner = inner.substring(1, inner.length - 1);

        const intValue = parseInt(inner, 10);
        const value = !isNaN(intValue) && /^-?\d+$/.test(inner) ? intValue : this.getOrAddStringOffset(inner);
        return { type, value };
    }

    // 文件类型: dataType=3 UTF-16 文本 -> UTF-16 LE 字节序列（与 decodeUTF16 互逆）
    encodeUTF16Text(text) {
        return encodeUtf16LE(text);
    }

    // 文本 -> 原始字节的总入口（与 decodeContent 对应）。按 dataType 选择编码器；
    // 其他类型按 UTF-8 落盘。dataType=1 目前统一走 encodeTokenText，不按扩展名差异化。
    encodeContent(file, text) {
        switch (file.dataType) {
            case 1:
                return this.encodeTokenText(text);
            case 3:
                return this.encodeUTF16Text(text);
            default:
                return encodeText(text, "utf-8");
        }
    }

    // ---- Modification tracking ----
    setFileContent(fileIndex, text) {
        const file = this.files[fileIndex];
        if (!file) return;
        // .lst 展示时行尾追加了引用文件的 [name] 名称，保存前必须剥离，避免名称被编码进 token 流
        const encoded = this.encodeContent(file, this.isLstFile(file) ? stripLstNameAnnotations(text) : text);
        this._overlay.set(fileIndex, encoded);
        this._deleted.delete(fileIndex);
        if (this._nameTagCache.has(fileIndex)) this._nameTagCache.delete(fileIndex);
        this._lstTextCache.delete(fileIndex);
        this._lstRefMap.delete(fileIndex);
        this._itemMetaCache.delete(fileIndex);
    }

    setFileRawData(fileIndex, data) {
        this._overlay.set(fileIndex, data);
        this._deleted.delete(fileIndex);
        this._lstTextCache.delete(fileIndex);
        this._lstRefMap.delete(fileIndex);
        this._itemMetaCache.delete(fileIndex);
    }

    async exportFile(file) {
        if (!file || file.isDir) return null;
        const data = await this.getFileData(file);
        if (!data) return null;
        const filename = sanitizeFilename(file.name || file.fullpath || "export");
        if (file.dataType === 1 || file.dataType === 3) {
            const text = this.decodeContent(file, data);
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            return { filename, blob, size: text.length };
        }
        const blob = new Blob([data], { type: "application/octet-stream" });
        return { filename, blob, size: data.length };
    }

    isFileModified(fileIndex) {
        return this._overlay.has(fileIndex);
    }

    deleteFile(fileIndex) {
        if (fileIndex < 0 || fileIndex >= this.files.length) return;
        this._deleted.add(fileIndex);
    }

    isFileDeleted(fileIndex) {
        return this._deleted.has(fileIndex);
    }

    isFileRenamed(fileIndex) {
        return this._renamed.has(fileIndex);
    }

    undeleteFile(fileIndex) {
        this._deleted.delete(fileIndex);
    }

    // ---- Encoding switching ----
    // ---- String table (.str) name mapping ----
    // 扫描全部 .str 字符串表文件，构建「key -> 名称」映射（懒加载 + 缓存）。
    // 脚本中 [name]/[explain] 等常以字符串 key（如 `name_97`）引用，真实名称定义在 .chn/.kor/.jpn.str 里。
    // .str 解码文本为逐行「key>名称」，兼容 {N=`...`} / `...` 包装；同名 key 先到先得（中文优先于外文）。
    async _ensureStrNameMap() {
        if (this._strNameMap) return this._strNameMap;
        const map = new Map();
        const t0 = Date.now();
        const strFiles = this.files.filter(f => !f.isDir && !this._deleted.has(f.index) && /\.str$/i.test(f.name));
        for (const f of strFiles) {
            try {
                const data = await this.getFileData(f);
                if (!data || data.length === 0) continue;
                const text = this.decodeContent(f, data);
                if (!text) continue;
                for (const raw of text.split("\n")) {
                    let line = raw.trim();
                    if (!line || line.startsWith("#")) continue;
                    let m = /^\{[0-9]+=`([^`]*)`\}$/.exec(line);
                    if (m) line = m[1];
                    else {
                        m = /^`([^`]*)`$/.exec(line);
                        if (m) line = m[1];
                    }
                    const kv = /^([^>]+)>([\s\S]*)$/.exec(line);
                    if (kv) {
                        const key = kv[1].trim();
                        const val = kv[2].trim();
                        if (key && val && !map.has(key)) map.set(key, val);
                    }
                }
            } catch (e) {
                // 单个 .str 文件解析失败不影响整体
            }
        }
        this._strNameMap = map;
        console.info(`[PVF] 字符串表解析完成：${strFiles.length} 个 .str 文件，${map.size} 条映射，耗时 ${Date.now() - t0}ms`);
        return map;
    }

    // 供界面获取 name 字符串表映射（Promise<Map<string,string>>）
    getStrNameMap() {
        return this._ensureStrNameMap();
    }

    setEncoding(encoding) {
        if (this.strEncoding === encoding) return;
        this.strEncoding = encoding;
        this._strAOffsetCache = null;
        this._strWOffsetCache = null;
        this._strAValueCache = null;
        this._strWValueCache = null;
        this._nameTagCache.clear();
        this._lstTextCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();
        this._tagOffsetCache = null;
        this._strNameMap = null;
        this._pathIndex = null;
        this._nameIndex = null;
        // 编码变化后字符串解码结果随之变化：重建字符串表缓存，
        // 再以 O(1) 查表方式重解析全部文件路径（避免 100 万次逐条解码）。
        this._buildStringCaches();
        for (const file of this.files) {
            file.name = this.resolveString(file.nameOff);
            file.path = this.resolveString(file.pathOff);
            file.fullpath = this._normalizePath(file.path, file.name);
        }
    }

    // ---- Rename file ----
    renameFile(fileIndex, newName) {
        const file = this.files[fileIndex];
        if (!file || !newName) return null;
        const oldFullpath = file.fullpath;
        const oldName = file.name;

        // Store original metadata for revert (only on first rename)
        if (!this._renamed.has(fileIndex)) {
            this._originalMeta.set(fileIndex, {
                nameOff: file.nameOff,
                name: file.name,
                fullpath: file.fullpath,
                pathOff: file.pathOff,
                path: file.path
            });
        }

        const newNameOff = this.getOrAddStringOffset(newName);
        file.nameOff = newNameOff;
        file.name = newName;
        file.fullpath = this._normalizePath(file.path, newName);
        this._renamed.add(fileIndex);
        this._pathIndex = null;
        this._nameIndex = null;
        this._lstTextCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();

        return { oldFullpath, newFullpath: file.fullpath, oldName, newName };
    }

    // ---- Set file path (for folder rename) ----
    setFilePath(fileIndex, newPath) {
        const file = this.files[fileIndex];
        if (!file) return;
        if (!this._renamed.has(fileIndex)) {
            this._originalMeta.set(fileIndex, {
                nameOff: file.nameOff,
                name: file.name,
                fullpath: file.fullpath,
                pathOff: file.pathOff,
                path: file.path
            });
        }
        const newPathOff = this.getOrAddStringOffset(newPath);
        file.pathOff = newPathOff;
        file.path = newPath;
        file.fullpath = this._normalizePath(newPath, file.name);
        this._renamed.add(fileIndex);
        this._pathIndex = null;
        this._nameIndex = null;
        this._lstTextCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();
    }

    // ---- Rename folder: update path of all files under it ----
    renameFolder(folderPath, newFolderName) {
        const lastSlash = folderPath.lastIndexOf("/");
        const parent = lastSlash >= 0 ? folderPath.substring(0, lastSlash) : "";
        const newFolderPath = parent ? parent + "/" + newFolderName : newFolderName;
        const oldPrefix = folderPath + "/";

        const mappings = [];
        for (const file of this.files) {
            if (this._deleted.has(file.index)) continue;
            if (!file.fullpath.startsWith(oldPrefix)) continue;
            const oldFullpath = file.fullpath;
            const relativePath = file.fullpath.substring(oldPrefix.length);
            const relLastSlash = relativePath.lastIndexOf("/");
            let newDir;
            if (relLastSlash >= 0) {
                newDir = newFolderPath + "/" + relativePath.substring(0, relLastSlash);
            } else {
                newDir = newFolderPath;
            }
            this.setFilePath(file.index, newDir);
            mappings.push({ old: oldFullpath, new: file.fullpath });
        }
        return { newFolderPath, mappings };
    }

    // ---- Full reference search: find all files referencing any of the given paths ----
    // Token files (dataType 1) reference path strings through string-table
    // offsets, so we avoid decoding every file: collect the string-table offsets
    // whose value contains any search path, then raw-scan each token file's
    // bytes for a reference to one of those offsets. Only inline-text files
    // (dataType 3) need to be decoded. This keeps renames responsive instead of
    // scanning the whole archive once per search path per file.
    async findReferencesMulti(searchPaths) {
        const refs = new Map();
        const paths = searchPaths.filter(Boolean);
        if (paths.length === 0) return [];
        const pattern = new RegExp(paths.map(escapeRegExp).join("|"));

        this._ensureStringOffsetCache();
        const targetOffsets = new Set();
        let lastYield = Date.now();
        for (const [value, off] of this._strAOffsetCache) {
            if (pattern.test(value)) targetOffsets.add(off);
            if (Date.now() - lastYield > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastYield = Date.now();
            }
        }
        for (const [value, off] of this._strWOffsetCache) {
            if (pattern.test(value)) targetOffsets.add(off);
            if (Date.now() - lastYield > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastYield = Date.now();
            }
        }

        for (let i = 0; i < this.files.length; i++) {
            if (this._deleted.has(i)) continue;
            const file = this.files[i];
            if (file.dataType !== 1 && file.dataType !== 3) continue;
            try {
                const data = await this.getFileData(file);
                if (!data || data.length === 0) continue;
                let matched = null;
                if (file.dataType === 1) {
                    matched = this._findTokenRefs(data, targetOffsets, paths);
                } else {
                    const text = this.decodeContent(file, data);
                    if (pattern.test(text)) matched = paths.filter(sp => text.includes(sp));
                }
                if (matched && matched.length > 0) {
                    refs.set(i, { fileIndex: i, fullpath: file.fullpath, matches: matched });
                }
            } catch (e) {
                /* skip unreadable files */
            }
            // Yield on a time basis so neither the token scan nor dataType-3
            // decode can lock the UI for long stretches. getFileData resolves on
            // a microtask when its chunk is cached, so without this the loop
            // would run back-to-back and freeze the browser.
            if (Date.now() - lastYield > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastYield = Date.now();
            }
        }
        return Array.from(refs.values());
    }

    // Raw-scan a token stream (5-byte records: 1 type + 4 LE int32 value) for
    // string-bearing tokens (types 3/5/6/7) whose value is a string-table offset
    // already known to contain a search path. Returns the matched search paths,
    // or null if none. Avoids decoding the whole file to text.
    _findTokenRefs(data, targetOffsets, paths) {
        if (targetOffsets.size === 0) return null;
        const len = data.length - (data.length % 5);
        const hitOffsets = new Set();
        for (let off = 0; off < len; off += 5) {
            const type = data[off];
            if (type !== 3 && type !== 5 && type !== 6 && type !== 7) continue;
            const value = readInt32LE(data, off + 1);
            if (targetOffsets.has(value)) hitOffsets.add(value);
        }
        if (hitOffsets.size === 0) return null;
        const matched = new Set();
        for (const off of hitOffsets) {
            const s = this.resolveString(off);
            for (const sp of paths) {
                if (s.includes(sp)) matched.add(sp);
            }
        }
        return matched.size > 0 ? Array.from(matched) : null;
    }

    // ---- Fix references: replace old paths with new paths in all referenced files ----
    async fixReferences(mappings, refs) {
        let fixed = 0;
        // One pass per file instead of one split/join per mapping: folder renames
        // can produce thousands of mappings, and split/join rescans the whole
        // text for each. Sort longest-old-first so overlapping paths (e.g. a
        // directory prefix vs. a file path under it) resolve to the longer match.
        const active = mappings.filter(m => m.old && m.new && m.old !== m.new);
        if (active.length === 0) return 0;
        active.sort((a, b) => b.old.length - a.old.length);
        const replaceRe = new RegExp(active.map(m => escapeRegExp(m.old)).join("|"), "g");
        const replaceMap = new Map(active.map(m => [m.old, m.new]));

        let lastYield = Date.now();
        for (const ref of refs) {
            const file = this.files[ref.fileIndex];
            try {
                const data = await this.getFileData(file);
                if (!data) continue;
                const text = this.decodeContent(file, data);
                const newText = text.replace(replaceRe, m => replaceMap.get(m));
                if (newText !== text) {
                    this.setFileContent(ref.fileIndex, newText);
                    fixed++;
                }
            } catch (e) {
                /* skip */
            }
            if (Date.now() - lastYield > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastYield = Date.now();
            }
        }
        return fixed;
    }

    // ---- Build path mappings with and without extension for thorough reference matching ----
    buildPathMappings(renameMappings) {
        const result = [];
        const seen = new Set();
        for (const m of renameMappings) {
            // With extension (full path)
            if (!seen.has(m.old)) {
                seen.add(m.old);
                result.push({ old: m.old, new: m.new });
            }
            // Without extension (PVF references often omit file extension)
            const oldNoExt = m.old.replace(/\.[^.\/]+$/, "");
            const newNoExt = m.new.replace(/\.[^.\/]+$/, "");
            if (oldNoExt !== m.old && !seen.has(oldNoExt)) {
                seen.add(oldNoExt);
                result.push({ old: oldNoExt, new: newNoExt });
            }
        }
        return result;
    }

    // ---- Legacy single-path reference search (kept for compatibility) ----
    async findReferences(searchPath) {
        const refs = await this.findReferencesMulti([searchPath]);
        return refs.map(r => ({ fileIndex: r.fileIndex, fullpath: r.fullpath }));
    }

    revertFile(fileIndex) {
        this._overlay.delete(fileIndex);
        this._deleted.delete(fileIndex);
        if (this._renamed.has(fileIndex) && this._originalMeta.has(fileIndex)) {
            const orig = this._originalMeta.get(fileIndex);
            const file = this.files[fileIndex];
            file.nameOff = orig.nameOff;
            file.name = orig.name;
            file.pathOff = orig.pathOff;
            file.path = orig.path;
            file.fullpath = orig.fullpath;
            this._renamed.delete(fileIndex);
            this._pathIndex = null;
            this._nameIndex = null;
            this._lstTextCache.clear();
            this._lstRefMap.clear();
            this._itemMetaCache.clear();
        }
    }

    revertAll() {
        this._overlay.clear();
        this._deleted.clear();
        // Revert all renames
        for (const idx of this._renamed) {
            const orig = this._originalMeta.get(idx);
            if (orig) {
                const file = this.files[idx];
                file.nameOff = orig.nameOff;
                file.name = orig.name;
                file.pathOff = orig.pathOff;
                file.path = orig.path;
                file.fullpath = orig.fullpath;
            }
        }
        this._renamed.clear();
        this._pathIndex = null;
        this._nameIndex = null;
        this._lstTextCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();
    }

    get modifiedCount() {
        return this._overlay.size;
    }

    get deletedCount() {
        return this._deleted.size;
    }

    get renamedCount() {
        return this._renamed.size;
    }

    get hasChanges() {
        return this._overlay.size > 0 || this._deleted.size > 0 || this._renamed.size > 0;
    }

    // ---- Name table rebuild ----
    async buildNameTableBytes(useProtected = false) {
        const parts = [];
        // 8-byte header
        parts.push(this.rawNameHeader);

        // sTrA section（protected_nkpi 密钥为大写变体 "StRa"，与解密侧一致）
        parts.push(await encodeNameSection(useProtected ? "StRa" : "sTrA", this.strABuf, 0xaa74472e, useProtected));
        // sTrW section
        parts.push(await encodeNameSection(useProtected ? "StRw" : "sTrW", this.strWBuf, 0x9a82f037, useProtected));

        // Calculate total size
        let totalLen = 0;
        for (const p of parts) totalLen += p.length;
        const result = new Uint8Array(totalLen);
        let off = 0;
        for (const p of parts) {
            result.set(p, off);
            off += p.length;
        }
        return result;
    }

    // ---- Hash table rebuild ----
    _buildHashTableBytes(fileItems) {
        const count = fileItems.length;
        const entries = [];
        const uniqueOffsets = new Set();

        for (let i = 0; i < count; i++) {
            const item = fileItems[i];
            entries.push({ nameOffset: item.nameOff, pathOffset: item.pathOff });
            uniqueOffsets.add(item.nameOff);
            if (item.pathOff >= 0) uniqueOffsets.add(item.pathOff);
        }

        const sorted = Array.from(uniqueOffsets).sort((a, b) => {
            const sa = this.resolveString(a);
            const sb = this.resolveString(b);
            return sa < sb ? -1 : sa > sb ? 1 : 0;
        });

        const size = 4 + count * 8 + 4 + sorted.length * 4;
        const result = new Uint8Array(size);
        let pos = 0;
        writeInt32LE(result, pos, count);
        pos += 4;
        for (let i = 0; i < count; i++) {
            writeInt32LE(result, pos, entries[i].nameOffset);
            pos += 4;
            writeInt32LE(result, pos, entries[i].pathOffset);
            pos += 4;
        }
        writeInt32LE(result, pos, sorted.length);
        pos += 4;
        for (let i = 0; i < sorted.length; i++) {
            writeInt32LE(result, pos, sorted[i]);
            pos += 4;
        }
        return result;
    }

    // ---- Rebuild chunk with overlay ----
    async _rebuildChunkWithOverlay(chunkIndex, originalChunk, newItems, oldToNewIndex) {
        const segments = [];
        for (let i = 0; i < this.files.length; i++) {
            if (this._deleted.has(i)) continue;
            const item = this.files[i];
            const hasOverlay = this._overlay.has(i);
            if (item.chunkIndex !== chunkIndex || (item.dataSize <= 0 && !hasOverlay)) continue;
            const newIdx = oldToNewIndex ? oldToNewIndex.get(i) : i;
            if (newIdx < 0) continue;
            segments.push({
                origOffset: item.dataOffset,
                origSize: item.dataSize,
                newIdx,
                newData: hasOverlay ? this._overlay.get(i) : null
            });
        }
        segments.sort((a, b) => a.origOffset - b.origOffset);

        const parts = [];
        let srcPos = 0;
        let runningOffset = 0;
        for (const seg of segments) {
            if (seg.origOffset > srcPos && originalChunk) {
                const gap = originalChunk.subarray(srcPos, seg.origOffset);
                parts.push(gap);
                runningOffset += gap.length;
            }
            newItems[seg.newIdx].dataOffset = runningOffset;

            if (seg.newData) {
                parts.push(seg.newData);
                newItems[seg.newIdx].dataSize = seg.newData.length;
                runningOffset += seg.newData.length;
            } else if (originalChunk && seg.origOffset >= 0 && seg.origOffset + seg.origSize <= originalChunk.length) {
                const orig = originalChunk.subarray(seg.origOffset, seg.origOffset + seg.origSize);
                parts.push(orig);
                runningOffset += orig.length;
            }
            srcPos = seg.origOffset + seg.origSize;
        }
        if (originalChunk && srcPos < originalChunk.length) {
            parts.push(originalChunk.subarray(srcPos));
        }

        let totalLen = 0;
        for (const p of parts) totalLen += p.length;
        const result = new Uint8Array(totalLen);
        let off = 0;
        for (const p of parts) {
            result.set(p, off);
            off += p.length;
        }
        return result;
    }

    // ---- SaveAs: rebuild full PVF ----
    async saveAs(onProgress) {
        // If no modifications, deletions, or renames, return original bytes
        if (this._overlay.size === 0 && this._deleted.size === 0 && this._renamed.size === 0) {
            return this.buf.slice();
        }

        // Find chunks needing rebuild (contain modified OR deleted files)
        const modifiedChunks = new Set();
        for (let i = 0; i < this.files.length; i++) {
            if ((this._overlay.has(i) || this._deleted.has(i)) && this.files[i].chunkIndex >= 0 && this.files[i].chunkIndex < this.groups.length) {
                modifiedChunks.add(this.files[i].chunkIndex);
            }
        }

        const originalChunkCount = this.groups.length;
        const newGroups = [];
        // Build newItems excluding deleted files, track old->new index mapping
        const newItems = [];
        const oldToNewIndex = new Map();
        for (let i = 0; i < this.files.length; i++) {
            if (this._deleted.has(i)) {
                oldToNewIndex.set(i, -1);
                continue;
            }
            oldToNewIndex.set(i, newItems.length);
            const f = this.files[i];
            newItems.push({
                nameOff: f.nameOff,
                pathOff: f.pathOff,
                chunkIndex: f.chunkIndex,
                dataOffset: f.dataOffset,
                dataSize: f.dataSize,
                dataType: f.dataType
            });
        }

        // Body parts
        const bodyParts = [];
        let cumulativeCompressed = 0;

        for (let ci = 0; ci < originalChunkCount; ci++) {
            if (!modifiedChunks.has(ci)) {
                const rawEncrypted = this._getChunkRawEncrypted(ci);
                if (rawEncrypted) {
                    bodyParts.push(rawEncrypted);
                    cumulativeCompressed += rawEncrypted.length;
                    newGroups.push({ compressedSize: cumulativeCompressed, originalSize: this.groups[ci].originalSize });
                }
            } else {
                const originalChunk = await this._getChunk(ci);
                const newChunk = await this._rebuildChunkWithOverlay(ci, originalChunk, newItems, oldToNewIndex);
                const encrypted = await encodeBodyChunk(newChunk, this._headerFormat === PvfFormat.PROTECTED);
                bodyParts.push(encrypted);
                cumulativeCompressed += encrypted.length;
                newGroups.push({ compressedSize: cumulativeCompressed, originalSize: newChunk.length });
            }
            if (onProgress && (ci % 100 === 0 || ci === originalChunkCount - 1)) onProgress(ci + 1, originalChunkCount);
        }

        // Concatenate body
        const bodyBytes = mergeChunks(bodyParts);

        // Rebuild file table
        const tableBytes = encodeFileTable(newItems);

        // Rebuild hash table（protected_nkpi 格式的 HASH 表无法解密重建，直接复用原始字节）
        let hashBytes;
        if (this._headerFormat === PvfFormat.PROTECTED) {
            hashBytes = (this._rawHashBytes || new Uint8Array(0)).slice();
        } else {
            hashBytes = this._buildHashTableBytes(newItems);
            pvfDecrypt("HASH", hashBytes, MAGIC_DECRYPT);
        }

        // Rebuild name table
        const useProtected = this._headerFormat === PvfFormat.PROTECTED;
        const nameBytes = await this.buildNameTableBytes(useProtected);

        // Rebuild GRPI
        const grpiBytes = encodeGrpiTable(newGroups);
        if (useProtected) pvfDecryptProtected("grpi", grpiBytes, MAGIC_DECRYPT);
        else pvfDecrypt("GRPI", grpiBytes, MAGIC_DECRYPT);

        // Rebuild header
        const headerBytes = encodeHeaderRaw({
            signature: this.header.signature,
            guid: this.header.guid,
            fileCount: newItems.length,
            padding: this.header.padding,
            bodySize: cumulativeCompressed,
            groupCount: newGroups.length,
            hashTableSize: hashBytes.length,
            nameTableSize: nameBytes.length
        });
        if (useProtected) {
            pvfDecryptProtected("hEAd", headerBytes, MAGIC_DECRYPT);
        } else {
            pvfDecrypt("HeaD", headerBytes, MAGIC_DECRYPT);
            if (this._headerFormat === PvfFormat.GUARD) pvfDecryptGuard(headerBytes);
        }

        // Assemble: Header + Table + Hash + Name + GRPI + Body
        const result = mergeChunks([headerBytes, tableBytes, hashBytes, nameBytes, grpiBytes, bodyBytes]);

        // 自校验：重开导出字节，回读每个 overlay 文件的原始字节并逐字节比对，
        // 端到端验证分块重建/文件表/压缩/加密正确。任一不一致即抛错，避免产出坏档。
        if (onProgress) onProgress(0, 0, "verify");
        const verify = new PvfArchive(result.buffer);
        await verify.parse();
        for (const [fi, overlayData] of this._overlay) {
            const newIdx = oldToNewIndex.get(fi);
            if (newIdx == null || newIdx < 0 || newIdx >= verify.files.length) continue;
            const actual = await verify.getFileData(verify.files[newIdx]);
            if (!actual || actual.length !== overlayData.length) {
                throw new Error(`导出自校验失败：${this.files[fi].fullpath || this.files[fi].name}（索引 ${fi}）回读长度不一致（期望 ${overlayData.length}，实际 ${actual ? actual.length : -1}）`);
            }
            for (let k = 0; k < overlayData.length; k++) {
                if (actual[k] !== overlayData[k]) {
                    throw new Error(`导出自校验失败：${this.files[fi].fullpath || this.files[fi].name}（索引 ${fi}）回读字节在偏移 ${k} 处不一致`);
                }
            }
        }

        return result;
    }
}

export {
    PvfArchive,
    PvfFormat,
    PvfFormatLabels,
    PvfFormatDefault,
    pvfDecrypt,
    pvfDecryptGuard,
    pvfDecryptProtected,
    zlibCompress,
    zlibDecompress,
    formatBytes,
    buildFileTree,
    detectEncoding,
    sanitizeFilename,
    stripLstNameAnnotations
};

// 解析 PVF 脚本标签的一行内容值（见 extractTagFromText）：
//   反引号串 `xx`（含 `` 转义）      -> 解出字符串
//   {5=`xx`} / {7=`xx`} 标记        -> 解出内部字符串
//   纯数字行（可含连续数字）         -> 首个整数
//   [xxx] 包裹值 / 裸字符串          -> 原样返回
function parseTagValueLine(line) {
    let m = /^`((?:[^`]|``)*)`$/.exec(line);
    if (m) return m[1].replace(/``/g, "`");
    m = /^\{[57]=`((?:[^`]|``)*)`\}$/.exec(line);
    if (m) return m[1].replace(/``/g, "`");
    m = /^(\d+)(?:\s|$)/.exec(line);
    if (m) return parseInt(m[1], 10);
    return line;
}

// 从 PVF 脚本文本中提取 [tag] 标签的值（通用，兼容闭合 [tag]...[\/tag] 与不闭合两种写法）。
// 标签行允许前导缩进、大小写不敏感；内容行跳过空行与 # 注释。
//   闭合形式：内容为 [tag] 与 [/tag] 之间的所有行；
//   不闭合形式：内容为 [tag] 后到下一个标签（[...] 行）前的所有行（即紧邻值行）。
// 返回 { raw, values, value, closed }：raw 为内容行数组（trim 后），values 为逐行解析值，
// value 为 values 首项（无内容时为 null），closed 标记是否为闭合标签；标签不存在返回 null。
function extractTagFromText(text, tag) {
    if (!text) return null;
    const lines = String(text).split("\n");
    const open = "[" + String(tag).toLowerCase() + "]";
    const close = "[/" + String(tag).toLowerCase() + "]";
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().toLowerCase() !== open) continue;
        let closed = false;
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim().toLowerCase() === close) {
                closed = true;
                break;
            }
        }
        const raw = [];
        for (let j = i + 1; j < lines.length; j++) {
            const trimmed = lines[j].trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            if (trimmed.toLowerCase() === close) break;
            if (!closed && trimmed.startsWith("[")) break;
            raw.push(trimmed);
        }
        const values = raw.map(parseTagValueLine);
        return { raw, values, value: values.length ? values[0] : null, closed };
    }
    return null;
}

// 从 PVF 脚本文本中提取 [name] 标签的字符串值（反引号串、{5=}/{7=} 标记或裸字符串）。
// 用于 .lst 列表在行尾追加引用文件的缩略名称。
function extractNameFromText(text) {
    const res = extractTagFromText(text, "name");
    const v = res && res.value != null ? res.value : "";
    return typeof v === "number" ? String(v) : v;
}

// 从 PVF 脚本文本中提取 [tag] 标签后的首个整数值（如 [rarity] / [minimum level]）。
// 标签缺失、后随非数字内容返回 null；连续数字行取第一个数。
function extractIntFieldFromText(text, tag) {
    const res = extractTagFromText(text, tag);
    if (!res || res.value == null) return null;
    if (typeof res.value === "number") return res.value;
    const m = /^(\d+)/.exec(String(res.value));
    return m ? parseInt(m[1], 10) : null;
}

// 从 PVF 脚本文本中提取 [tag] 标签后的字符串值（如 [equipment type] / [expiration date]）。
// 标签缺失返回 null；数值型内容转为字符串（保持与 token 快速路径 _readItemTagValue 一致的形态）。
function extractStringFieldFromText(text, tag) {
    const res = extractTagFromText(text, tag);
    if (!res || res.value == null) return null;
    return String(res.value);
}

// ==================== 物品发放解析规则（对齐 86JPGMTool，见 docs/pvf-item-grant-parsing.md） ====================

// 去反引号、小写后取类型串的首个 [xxx] 标签（86JPGMTool PvfIndexService.Items.FirstTag）。
// 如 "`[weapon]`" -> "weapon"；无标签返回 null。
export function firstTypeTag(typeString) {
    if (!typeString) return null;
    const m = /\[([a-z ]+)\]/.exec(String(typeString).replace(/`/g, "").toLowerCase());
    return m ? m[1].trim() : null;
}

// 堆叠物背包入格分段（86JPGMTool PvfIndexService.Items.StackSegment / ItemMetadataResolver.GetSlotRange 同语义）。
export function stackSegment(stackableType) {
    if (!stackableType || !String(stackableType).trim()) return "消耗品";
    const st = String(stackableType).replace(/`/g, "").trim().toLowerCase();
    if (st.startsWith("[material]")) return st.endsWith("4") ? "特殊材料" : "材料";
    if (st.startsWith("[quest]")) return "任务品";
    if (st.startsWith("[material expert job]")) return "副职业材料";
    if (st.startsWith("[avatar emblem]")) return "徽章";
    return "消耗品";
}

// 装备品质细分（86JPGMTool PvfIndexService.Items.EquipSpecial，均经实物验证）：
//   [item category] legacy    -> 传承
//   [item category] boss drop -> 领主神器
//   含 [random option]        -> 魔法封印（前缀是客户端运行时加的）
// 返回 'legacy' | 'boss' | 'sealed' | null
export function equipSpecial(itemCategory, hasRandomOption) {
    const value = itemCategory == null ? "" : String(itemCategory).trim();
    if (value === "legacy") return "legacy";
    if (value === "boss drop") return "boss";
    if (hasRandomOption) return "sealed";
    return null;
}

// 绝对期限解析（86JPGMTool PvfExpirationMetadata.TryParseUnixTime 同语义）：
//   "yyyy-MM-dd HH:mm:ss" / "yyyy-MM-dd" -> 按服务器时区 UTC+8 转 Unix 秒
//   纯数字 0 -> 无期限（返回 0）
//   纯数字 >= 1e9 -> 本身即 Unix 秒
//   其他 8 位数字 -> yyyyMMdd 日期（UTC+8）
// 解析失败返回 null（调用方据此标记 invalid）。
export function parsePvfExpirationDate(rawValue) {
    const normalized = String(rawValue == null ? "" : rawValue)
        .trim()
        .replace(/^`|`$/g, "")
        .trim();
    if (!normalized) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/.exec(normalized);
    if (m) {
        const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
        return localToUnixUtc8(+y, +mo, +d, +h, +mi, +s);
    }
    if (!/^-?\d+$/.test(normalized)) return null;
    const n = parseInt(normalized, 10);
    if (n === 0) return 0;
    if (n >= 1e9) return n;
    if (n > 0 && n >= 10000000 && n <= 99991231) {
        const y = Math.floor(n / 10000);
        const mo = Math.floor((n % 10000) / 100);
        const d = n % 100;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return localToUnixUtc8(y, mo, d, 0, 0, 0);
    }
    return null;
}

// 服务器本地时间（UTC+8）-> Unix 秒；越界返回 null（对齐 C# TryConvertServerLocalTime）
function localToUnixUtc8(y, mo, d, h, mi, s) {
    const ms = Date.UTC(y, mo - 1, d, h, mi, s) - 8 * 3600 * 1000;
    const sec = Math.floor(ms / 1000);
    if (sec <= 0 || sec > 2147483647) return null;
    return sec;
}

// 期限归类（86JPGMTool StackableExpirationPolicyResolver + 发放界面过滤语义）。
// 入参为 listLstItemMeta 的元数据项；返回
//   { kind: 'none'|'relative'|'absolute'|'daily'|'invalid', absoluteExpireTime, usablePeriodDays, dailyDelete }
//   absolute/relative/daily 可叠加（kind 按 absolute > relative > daily 优先级取主类别，叠加细节看布尔字段）。
export function classifyItemExpiration(meta) {
    if (!meta) return { kind: "none", absoluteExpireTime: null, usablePeriodDays: null, dailyDelete: false, hasAbsolute: false, hasRelative: false, invalid: false };
    const hasRawAbsolute = meta.expirationDate != null && String(meta.expirationDate).trim() !== "";
    const absolute = hasRawAbsolute ? parsePvfExpirationDate(meta.expirationDate) : null;
    const hasRelative = meta.usablePeriod != null && meta.usablePeriod > 0;
    const dailyDelete = meta.dailyDelete != null && meta.dailyDelete > 0;
    const invalid = (hasRawAbsolute && absolute == null) || (meta.usablePeriod != null && (isNaN(meta.usablePeriod) || meta.usablePeriod < 0));
    let kind = "none";
    if (invalid) kind = "invalid";
    else if (absolute != null && absolute > 0) kind = "absolute";
    else if (hasRelative) kind = "relative";
    else if (dailyDelete) kind = "daily";
    return {
        kind,
        absoluteExpireTime: absolute != null && absolute > 0 ? absolute : null,
        usablePeriodDays: hasRelative ? meta.usablePeriod : null,
        dailyDelete,
        hasAbsolute: absolute != null && absolute > 0,
        hasRelative,
        invalid
    };
}

// 剥离 .lst 增强解码追加在行尾的「缩略名称」，保留数字 token（数字与名称同形但不可剥离）。
// 兼容 formatPvfText 产生的前导缩进。与 encodeTokenText 结合保证编辑保存不把名称编入 token 流。
function stripLstNameAnnotations(text) {
    if (!text) return text;
    return String(text).replace(/^(\s*\d+\s+`(?:[^`]|``)*`)\s+([^\s`{}\[\]#]+)$/gm, (m, base, tail) => (/^-?\d+$/.test(tail) || /^-?\d*\.\d+$/.test(tail) ? m : base));
}

function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
}

function sanitizeFilename(name) {
    if (!name) return "export";
    let base = String(name).replace(/\\/g, "/").split("/").pop() || name;
    base = base.replace(/^\.+/, "");
    base = base.replace(/[<>:"|?*]/g, "_");
    return base || "export";
}

// ---- Build hierarchical file tree from flat file list ----
function buildFileTree(files) {
    const root = { name: "", path: "", isDir: true, file: null, children: [], total: files.length };
    const folderMap = new Map();
    folderMap.set("", root);

    // Code-unit comparison instead of localeCompare: paths are ASCII, and this
    // is ~10x faster -- buildFileTree runs on every refreshKey bump (e.g. after
    // a rename) and the localeCompare sort was a noticeable synchronous freeze.
    const sorted = [...files].sort((a, b) => (a.fullpath > b.fullpath) - (a.fullpath < b.fullpath));

    for (const file of sorted) {
        const fp = file.fullpath || file.name;
        if (!fp) continue;
        const parts = fp.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let curPath = "";
        let curNode = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            curPath = curPath ? curPath + "/" + part : part;

            if (isLast && !file.isDir) {
                curNode.children.push({
                    name: part,
                    path: curPath,
                    pathLower: curPath.toLowerCase(),
                    isDir: false,
                    file,
                    children: []
                });
            } else {
                if (!folderMap.has(curPath)) {
                    const folderNode = {
                        name: part,
                        path: curPath,
                        pathLower: curPath.toLowerCase(),
                        isDir: true,
                        file: null,
                        children: []
                    };
                    folderMap.set(curPath, folderNode);
                    curNode.children.push(folderNode);
                }
                curNode = folderMap.get(curPath);
            }
        }
    }

    function sortTree(node) {
        node.children.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return (a.name > b.name) - (a.name < b.name);
        });
        for (const child of node.children) sortTree(child);
    }
    sortTree(root);
    return root;
}

// ---- Encoding detection ----
function detectEncoding(bytes) {
    return iconvDetect(bytes);
}
