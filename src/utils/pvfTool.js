// ============================================================
//  PVF Archive Library
//  Port of PvfLib (PvfDecryptor.cs + PvfArchive.cs + PvfHashTable.cs)
//  Supports: parse, decrypt, decode, edit, rebuild, save
// ============================================================

import { decodeText, encodeText, decodeUtf16LE, encodeUtf16LE, detectEncoding as iconvDetect } from "./encoding.js";

// ---- Binary helpers ----
function readInt32LE(buf, off) {
    return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}
function readUInt32LE(buf, off) {
    return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
function writeInt32LE(buf, off, val) {
    buf[off] = val & 0xff;
    buf[off + 1] = (val >> 8) & 0xff;
    buf[off + 2] = (val >> 16) & 0xff;
    buf[off + 3] = (val >> 24) & 0xff;
}

// ---- PVF Decryption (PvfDecryptor.cs) ----
const MAGIC_DECRYPT = 0x269ec3;
const MAGIC_DECRYPT2 = 0x269ec9;

function pvfDecrypt(key, buf, magic) {
    const k = new Array(key.length);
    for (let i = 0; i < key.length; i++) k[i] = key.charCodeAt(i);
    if (k.length < 4) return 0;
    const len = buf.length;
    let tail = len;

    let seed = (Math.imul(0x76826701, k[0]) + Math.imul(0x1c1, (k[3] + Math.imul(0x1c1, (k[2] + Math.imul(0x1c1, k[1])) | 0)) | 0)) | 0;

    if (len >= 4) {
        const quadCount = len >>> 2;
        tail = len - (quadCount << 2);
        for (let i = 0; i < quadCount; i++) {
            const t1 = (Math.imul(0x343fd, seed) + magic) | 0;
            seed = (Math.imul(0x343fd, t1) + magic) | 0;
            const xorKey = (((t1 >>> 16) & 0xffff) << 16) | ((seed >>> 16) & 0xffff);
            const off = i << 2;
            const data = (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
            const newData = (data ^ xorKey) >>> 0;
            buf[off] = newData & 0xff;
            buf[off + 1] = (newData >>> 8) & 0xff;
            buf[off + 2] = (newData >>> 16) & 0xff;
            buf[off + 3] = (newData >>> 24) & 0xff;
        }
    }

    if (tail > 0) {
        const t1 = (Math.imul(0x343fd, seed) + magic) | 0;
        const t2 = (Math.imul(0x343fd, t1) + magic) | 0;
        const finalKey = (((t1 >>> 16) & 0xffff) << 16) | ((t2 >>> 16) & 0xffff);
        const kb = [finalKey & 0xff, (finalKey >>> 8) & 0xff, (finalKey >>> 16) & 0xff, (finalKey >>> 24) & 0xff];
        const start = len - tail;
        for (let i = 0; i < tail; i++) buf[start + i] ^= kb[i];
    }
    return tail;
}

function pvfDecryptGuard(buf) {
    if (buf.length < 28) return;
    for (let i = 24; i < 28; i++) buf[i] ^= 0x55;
}

// ---- Zlib compress / decompress (via CompressionStream) ----
async function zlibCompress(data) {
    if (typeof CompressionStream === "undefined") throw new Error("浏览器不支持 CompressionStream");
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    let totalLen = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
    }
    const result = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) {
        result.set(c, off);
        off += c.length;
    }
    return result;
}

async function zlibDecompress(data) {
    if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持 DecompressionStream");
    if (data.length < 6 || data[0] !== 0x78) throw new Error("无效的 Zlib 头");
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let totalLen = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
    }
    const result = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) {
        result.set(c, off);
        off += c.length;
    }
    return result;
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
        this._strCache = new Map();
        this._strAOffsetCache = null;
        this._strWOffsetCache = null;
        this._overlay = new Map(); // fileIndex -> Uint8Array (modified raw data)
        this._deleted = new Set(); // fileIndex -> true (soft-deleted)
        this._renamed = new Set(); // fileIndex -> true (renamed)
        this._originalMeta = new Map(); // fileIndex -> { nameOff, name, fullpath }
        this.strEncoding = "utf-8"; // encoding for sTrA (single-byte) string table
    }

    async parse() {
        const buf = this.buf;
        if (buf.length < 0x30) throw new Error("数据不足以包含 PVF 头部");

        // Header
        const hdr = buf.slice(0, 0x30);
        pvfDecryptGuard(hdr);
        if (pvfDecrypt("HeaD", hdr, MAGIC_DECRYPT) !== 0) throw new Error("PVF 头部解密失败");

        const signature = readUInt32LE(hdr, 0);
        if (signature !== 0x69706b6e) {
            throw new Error("该文件不是有效的 PVF 文件（签名 0x" + (signature >>> 0).toString(16) + "，应为 0x69706b6e）。请确认选择的是游戏的 Script.pvf。");
        }

        this.header = {
            signature,
            guid: hdr.slice(4, 24),
            fileCount: readInt32LE(hdr, 24),
            padding: readInt32LE(hdr, 28),
            bodySize: readInt32LE(hdr, 32),
            groupCount: readInt32LE(hdr, 36),
            hashTableSize: readInt32LE(hdr, 40),
            nameTableSize: readInt32LE(hdr, 44)
        };

        // 头部字段合法性（损坏的文件可能给出负值或越界尺寸，导致后续静默解析出垃圾）
        const h = this.header;
        if (h.fileCount <= 0 || h.groupCount < 0 || h.nameTableSize < 0 || h.hashTableSize < 0) {
            throw new Error(`PVF 头部字段异常（fileCount=${h.fileCount}, groupCount=${h.groupCount}），文件可能已损坏。`);
        }

        // Section offsets
        let pos = 0x30;
        const tableOffset = pos;
        const tableSize = h.fileCount * 0x18;
        pos += tableSize;
        const hashOffset = pos;
        pos += h.hashTableSize;
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

        // sTrA 是文件名/路径与 Type1 文本解析的基础，缺失则后续全部为空——必须报错
        if (!this.strABuf || this.strABuf.length === 0) {
            throw new Error("字符串表 (sTrA) 解析失败，文件可能已损坏或为不支持的 PVF 版本。");
        }

        // Auto-detect sTrA encoding before resolving file names/paths
        if (this.strABuf.length > 1) {
            this.strEncoding = detectEncoding(this.strABuf);
        }

        await new Promise(r => setTimeout(r, 0));

        // File table
        this._parseFileTable(buf, tableOffset, this.header.fileCount);

        await new Promise(r => setTimeout(r, 0));

        // GRPI
        const grpiBytes = buf.slice(grpiOffset, grpiOffset + grpiSize);
        pvfDecrypt("GRPI", grpiBytes, MAGIC_DECRYPT);
        this._parseGroups(grpiBytes, this.header.groupCount);

        return this.header;
    }

    async _parseNameTable(nameBytes) {
        if (nameBytes.length < 16) return;
        let idx = 8;

        const sTrA = this._readStringSection(nameBytes, idx, "sTrA", 0xaa74472e);
        if (sTrA) {
            idx = sTrA.nextIdx;
            this.strABuf = await zlibDecompress(sTrA.encrypted);
        }
        const sTrW = this._readStringSection(nameBytes, idx, "sTrW", 0x9a82f037);
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
        pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);
        return { encrypted, nextIdx: idx + 8 + encSize };
    }

    // ---- String resolution ----
    resolveString(magicOff) {
        if (magicOff < 0) return "";
        if (this._strCache.has(magicOff)) return this._strCache.get(magicOff);
        let result;
        if ((magicOff & 1) !== 0) {
            const off = (magicOff >> 1) * 2;
            result = this._readUnicodeString(this.strWBuf, off);
        } else {
            const off = magicOff >> 1;
            result = this._readUtf8String(this.strABuf, off);
        }
        if (this._strCache.size < 50000) this._strCache.set(magicOff, result);
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
    _ensureStringOffsetCache() {
        if (this._strAOffsetCache && this._strWOffsetCache) return;
        this._strAOffsetCache = new Map();
        this._strWOffsetCache = new Map();
        if (!this.strABuf) this.strABuf = new Uint8Array([0]);
        if (!this.strWBuf) this.strWBuf = new Uint8Array([0, 0]);

        let pos = 0;
        while (pos < this.strABuf.length) {
            let end = pos;
            while (end < this.strABuf.length && this.strABuf[end] !== 0) end++;
            const value = end > pos ? decodeText(this.strABuf.subarray(pos, end), this.strEncoding) : "";
            if (!this._strAOffsetCache.has(value)) this._strAOffsetCache.set(value, pos << 1);
            pos = end + 1;
        }

        pos = 0;
        while (pos + 1 < this.strWBuf.length) {
            let end = pos;
            while (end + 1 < this.strWBuf.length && !(this.strWBuf[end] === 0 && this.strWBuf[end + 1] === 0)) end += 2;
            const value = end > pos ? decodeUtf16LE(this.strWBuf.subarray(pos, end)) : "";
            if (!this._strWOffsetCache.has(value)) this._strWOffsetCache.set(value, ((pos >> 1) << 1) | 1);
            pos = end + 2;
        }
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
        pvfDecrypt("BodY", encrypted, MAGIC_DECRYPT);
        const decompressed = await zlibDecompress(encrypted);
        if (this._chunkCache.size >= 20) this._chunkCache.delete(this._chunkCache.keys().next().value);
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

    // ---- Content decode ----
    decodeType1(data) {
        const lineCount = Math.floor(data.length / 5);
        if (lineCount === 0) return "";
        const parts = [];
        for (let i = 0; i < lineCount; i++) {
            const off = i * 5;
            const type = data[off];
            const value = readInt32LE(data, off + 1);
            switch (type) {
                case 0:
                case 2: {
                    // 连续的数字 token（整数/浮点）合并到同一行展示，便于阅读。
                    // 编码器按空白拆分 token，单行或多行写法等价，可安全合并。
                    let row = type === 0 ? String(value) : float32ToString(value);
                    let j = i + 1;
                    while (j < lineCount) {
                        const jOff = j * 5;
                        const jType = data[jOff];
                        if (jType === 0) {
                            row += " " + String(readInt32LE(data, jOff + 1));
                            j++;
                        } else if (jType === 2) {
                            row += " " + float32ToString(readInt32LE(data, jOff + 1));
                            j++;
                        } else {
                            break;
                        }
                    }
                    parts.push(row + "\n");
                    i = j - 1;
                    break;
                }
                case 3:
                    parts.push("\n" + this.resolveString(value) + "\n");
                    break;
                case 5:
                    parts.push("\n{5=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                    break;
                case 6: {
                    // 反引号字符串与其后连续的数字 (type 0/2) 合并到同一行展示，
                    // 便于阅读「名称 + 一组数值」这类结构（如 .lst 名称/索引、.aic 角色信息）。
                    // 编码器按空白拆分 token，单行或多行写法等价，故可安全合并。
                    let row = "`" + this._escapeBacktick(this.resolveString(value)) + "`";
                    let j = i + 1;
                    while (j < lineCount) {
                        const jOff = j * 5;
                        const jType = data[jOff];
                        if (jType === 0) {
                            row += " " + String(readInt32LE(data, jOff + 1));
                            j++;
                        } else if (jType === 2) {
                            row += " " + float32ToString(readInt32LE(data, jOff + 1));
                            j++;
                        } else {
                            break;
                        }
                    }
                    parts.push(row + "\n");
                    i = j - 1;
                    break;
                }
                case 7:
                    parts.push("\n{7=`" + this._escapeBacktick(this.resolveString(value)) + "`}\n");
                    break;
                default:
                    parts.push("?(" + type + "," + value + ")\n");
                    break;
            }
        }
        // Normalize \r\n and lone \r to \n (fixes .lst / text display)
        return parts.join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    _escapeBacktick(s) {
        return s ? s.replace(/`/g, "``") : s;
    }

    decodeType3(data) {
        let text = decodeUtf16LE(data);
        // Normalize \r\n and lone \r to \n
        return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    decodeContent(file, data) {
        if (!data || data.length === 0) return "";
        switch (file.dataType) {
            case 1:
                return this.decodeType1(data);
            case 3:
                return this.decodeType3(data);
            default:
                return "";
        }
    }

    // ---- Content encode (text -> raw bytes) ----
    encodeType1Text(text) {
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

    encodeType3Text(text) {
        return encodeUtf16LE(text);
    }

    encodeContent(file, text) {
        switch (file.dataType) {
            case 1:
                return this.encodeType1Text(text);
            case 3:
                return this.encodeType3Text(text);
            default:
                return encodeText(text, "utf-8");
        }
    }

    // ---- Modification tracking ----
    setFileContent(fileIndex, text) {
        const file = this.files[fileIndex];
        if (!file) return;
        const encoded = this.encodeContent(file, text);
        this._overlay.set(fileIndex, encoded);
        this._deleted.delete(fileIndex);
    }

    setFileRawData(fileIndex, data) {
        this._overlay.set(fileIndex, data);
        this._deleted.delete(fileIndex);
    }

    async exportFile(file) {
        if (!file || file.isDir) return null;
        const data = await this.getFileData(file);
        if (!data) return null;
        if (file.dataType === 1 || file.dataType === 3) {
            const text = this.decodeContent(file, data);
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            return { filename: file.name, blob, size: text.length };
        }
        const blob = new Blob([data], { type: "application/octet-stream" });
        return { filename: file.name, blob, size: data.length };
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
    setEncoding(encoding) {
        if (this.strEncoding === encoding) return;
        this.strEncoding = encoding;
        this._strCache.clear();
        this._strAOffsetCache = null;
        this._strWOffsetCache = null;
        // Re-resolve all file names/paths with new encoding
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
    async findReferencesMulti(searchPaths) {
        const refs = new Map();
        for (let i = 0; i < this.files.length; i++) {
            if (this._deleted.has(i)) continue;
            const file = this.files[i];
            if (file.dataType !== 1 && file.dataType !== 3) continue;
            try {
                const data = await this.getFileData(file);
                if (!data) continue;
                const text = this.decodeContent(file, data);
                const matched = [];
                for (const sp of searchPaths) {
                    if (sp && text.includes(sp)) matched.push(sp);
                }
                if (matched.length > 0) {
                    refs.set(i, { fileIndex: i, fullpath: file.fullpath, matches: matched });
                }
            } catch (e) {
                /* skip unreadable files */
            }
        }
        return Array.from(refs.values());
    }

    // ---- Fix references: replace old paths with new paths in all referenced files ----
    async fixReferences(mappings, refs) {
        let fixed = 0;
        for (const ref of refs) {
            const file = this.files[ref.fileIndex];
            try {
                const data = await this.getFileData(file);
                if (!data) continue;
                let text = this.decodeContent(file, data);
                let changed = false;
                for (const mapping of mappings) {
                    if (text.includes(mapping.old)) {
                        text = text.split(mapping.old).join(mapping.new);
                        changed = true;
                    }
                }
                if (changed) {
                    this.setFileContent(ref.fileIndex, text);
                    fixed++;
                }
            } catch (e) {
                /* skip */
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
    async buildNameTableBytes() {
        const parts = [];
        // 8-byte header
        parts.push(this.rawNameHeader);

        // sTrA section
        parts.push(await this._compressNameSection("sTrA", this.strABuf, 0xaa74472e));
        // sTrW section
        parts.push(await this._compressNameSection("sTrW", this.strWBuf, 0x9a82f037));

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

    async _compressNameSection(key, rawBuffer, xorConst) {
        if (!rawBuffer || rawBuffer.length === 0) {
            rawBuffer = key === "sTrW" ? new Uint8Array([0, 0]) : new Uint8Array([0]);
        }
        const compressed = await zlibCompress(rawBuffer);
        const encrypted = new Uint8Array(compressed);
        pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);

        // cnt1 = encrypted.length ^ xorConst
        // cnt2 = rawBuffer.length ^ encrypted.length
        const section = new Uint8Array(8 + encrypted.length);
        writeInt32LE(section, 0, (encrypted.length ^ xorConst) | 0);
        writeInt32LE(section, 4, (rawBuffer.length ^ encrypted.length) | 0);
        section.set(encrypted, 8);
        return section;
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
                const compressed = await zlibCompress(newChunk);
                const encrypted = new Uint8Array(compressed);
                pvfDecrypt("BodY", encrypted, MAGIC_DECRYPT);
                bodyParts.push(encrypted);
                cumulativeCompressed += encrypted.length;
                newGroups.push({ compressedSize: cumulativeCompressed, originalSize: newChunk.length });
            }
            if (onProgress && (ci % 100 === 0 || ci === originalChunkCount - 1)) onProgress(ci + 1, originalChunkCount);
        }

        // Concatenate body
        let bodyTotalLen = 0;
        for (const p of bodyParts) bodyTotalLen += p.length;
        const bodyBytes = new Uint8Array(bodyTotalLen);
        let bodyOff = 0;
        for (const p of bodyParts) {
            bodyBytes.set(p, bodyOff);
            bodyOff += p.length;
        }

        // Rebuild file table
        const tableBytes = new Uint8Array(newItems.length * 0x18);
        for (let i = 0; i < newItems.length; i++) {
            const off = i * 0x18;
            writeInt32LE(tableBytes, off, newItems[i].nameOff);
            writeInt32LE(tableBytes, off + 4, newItems[i].pathOff);
            writeInt32LE(tableBytes, off + 8, newItems[i].chunkIndex);
            writeInt32LE(tableBytes, off + 12, newItems[i].dataOffset);
            writeInt32LE(tableBytes, off + 16, newItems[i].dataSize);
            writeInt32LE(tableBytes, off + 20, newItems[i].dataType);
        }

        // Rebuild hash table
        const hashBytes = this._buildHashTableBytes(newItems);
        pvfDecrypt("HASH", hashBytes, MAGIC_DECRYPT);

        // Rebuild name table
        const nameBytes = await this.buildNameTableBytes();

        // Rebuild GRPI
        const grpiBytes = new Uint8Array(newGroups.length * 8);
        for (let i = 0; i < newGroups.length; i++) {
            writeInt32LE(grpiBytes, i * 8, newGroups[i].compressedSize);
            writeInt32LE(grpiBytes, i * 8 + 4, newGroups[i].originalSize);
        }
        pvfDecrypt("GRPI", grpiBytes, MAGIC_DECRYPT);

        // Rebuild header
        const headerBytes = new Uint8Array(0x30);
        writeInt32LE(headerBytes, 0, this.header.signature);
        headerBytes.set(this.header.guid, 4);
        writeInt32LE(headerBytes, 24, newItems.length);
        writeInt32LE(headerBytes, 28, this.header.padding);
        writeInt32LE(headerBytes, 32, cumulativeCompressed);
        writeInt32LE(headerBytes, 36, newGroups.length);
        writeInt32LE(headerBytes, 40, hashBytes.length);
        writeInt32LE(headerBytes, 44, nameBytes.length);
        pvfDecrypt("HeaD", headerBytes, MAGIC_DECRYPT);
        pvfDecryptGuard(headerBytes);

        // Assemble: Header + Table + Hash + Name + GRPI + Body
        const totalSize = 0x30 + tableBytes.length + hashBytes.length + nameBytes.length + grpiBytes.length + bodyBytes.length;
        const result = new Uint8Array(totalSize);
        let pos = 0;
        result.set(headerBytes, pos);
        pos += 0x30;
        result.set(tableBytes, pos);
        pos += tableBytes.length;
        result.set(hashBytes, pos);
        pos += hashBytes.length;
        result.set(nameBytes, pos);
        pos += nameBytes.length;
        result.set(grpiBytes, pos);
        pos += grpiBytes.length;
        result.set(bodyBytes, pos);

        return result;
    }
}

export { PvfArchive, pvfDecrypt, pvfDecryptGuard, zlibCompress, zlibDecompress, formatBytes, buildFileTree, bytesToHex, detectEncoding };

function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
}

// ---- Build hierarchical file tree from flat file list ----
function buildFileTree(files) {
    const root = { name: "", path: "", isDir: true, file: null, children: [] };
    const folderMap = new Map();
    folderMap.set("", root);

    const sorted = [...files].sort((a, b) => a.fullpath.localeCompare(b.fullpath));

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
                    isDir: false,
                    file,
                    children: []
                });
            } else {
                if (!folderMap.has(curPath)) {
                    const folderNode = {
                        name: part,
                        path: curPath,
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
            return a.name.localeCompare(b.name);
        });
        for (const child of node.children) sortTree(child);
    }
    sortTree(root);
    return root;
}

// ---- Hex dump for binary files ----
function bytesToHex(data, maxBytes = 8192) {
    if (!data || data.length === 0) return "(空文件)";
    const len = Math.min(data.length, maxBytes);
    const lines = [];
    for (let i = 0; i < len; i += 16) {
        const slice = data.subarray(i, Math.min(i + 16, len));
        const hex = Array.from(slice)
            .map(b => b.toString(16).padStart(2, "0"))
            .join(" ");
        const ascii = Array.from(slice)
            .map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
            .join("");
        const offset = i.toString(16).padStart(8, "0");
        lines.push(`${offset}  ${hex.padEnd(47)}  ${ascii}`);
    }
    if (data.length > maxBytes) {
        lines.push(`\n... (仅显示前 ${maxBytes} 字节，共 ${data.length} 字节)`);
    }
    return lines.join("\n");
}

// ---- Encoding detection ----
function detectEncoding(bytes) {
    return iconvDetect(bytes);
}
