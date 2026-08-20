// ============================================================
//  繁体 TW PVF Archive（独立层）
//  二进制协议见 docs/pvf-tw-format.md；与 PvfArchive（JP/JPAG/CN）互补互斥。
//  公共 API 对齐 PvfArchive 子集，PvfEditor / ItemCodeViewer 可无感切换。
// ============================================================

import { decodeText, encodeText } from "./encoding.js";
import { readInt32LE, readUInt32LE, writeInt32LE, pvfDecryptTw, pvfEncryptTw, TW_DECRYPT_KEY, twCreateBuffKey, twFileNameHash, PvfFormat } from "./pvfCodec.js";
import { extractTagFromText, extractNameFromText, extractIntFieldFromText, extractStringFieldFromText } from "./pvfTool.js";

function float32ToString(bits) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setInt32(0, bits | 0, true);
    const f = dv.getFloat32(0, true);
    if (!isFinite(f)) return String(f);
    if (f === 0) return "0";
    if (Number.isInteger(f) && Math.abs(f) < 1e15) return String(f);
    const f32 = new Float32Array([f])[0];
    return String(f32);
}

function mergeChunks(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

// 物品元数据标签集（与 PvfArchive.ITEM_META_TAGS 同语义，TW 走全文文本解析）
const ITEM_META_TAGS = [
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

// 通用：读取 token 流，每 5 字节一个 token（1 字节类型 + 4 字节小端 int32）
function readTokens(data) {
    const count = Math.floor(data.length / 5);
    const tokens = new Array(count);
    for (let i = 0; i < count; i++) {
        const off = i * 5;
        tokens[i] = { type: data[off], value: readInt32LE(data, off + 1) };
    }
    return tokens;
}

export class TwPvfArchive {
    // ---- 构造与头部探测 ----

    constructor(buffer) {
        this.buf = new Uint8Array(buffer);
        this.files = [];
        this.header = null;
        this.twEncoding = "big5"; // 区域编码（默认繁中 Big5，可经 setEncoding 切换）
        this._twTree = null; // 解密后的文件树字节
        this._twDataBase = 0; // 数据区起点（20 + guidLen + fileTreeLength）
        this._twStringTable = null; // stringtable.bin 解析结果 { list, count }
        this._twStrIdx = null; // 文本 -> 索引（编辑入表用）
        this._twStrLists = null; // strlst 引用表 Map<strlstId, Map<key,text>>
        this._twStrListsDirty = new Set(); // 被编辑过的 strlst 文件索引
        this._overlay = new Map(); // 修改：fileIndex -> 新数据字节
        this._deleted = new Set();
        this._renamed = new Map(); // fileIndex -> 新文件名（fullpath）
        this._nameTagCache = new Map();
        this._itemMetaCache = new Map();
        this._lstTextCache = new Map();
        this._lstNameMapCache = new Map(); // fileIndex -> Map<行号, 追加的引用文件名称>
        this._lstRefMap = new Map();
        this._pathIndex = null;
        this._nameIndex = null;
    }

    get headerFormat() {
        return PvfFormat.TW;
    }

    get headerFormatLabel() {
        return "TW";
    }

    get fileCount() {
        return this.header ? this.header.fileCount : 0;
    }

    get strEncoding() {
        return this.twEncoding;
    }

    set strEncoding(v) {
        this.twEncoding = v;
    }

    get hasChanges() {
        return this._overlay.size > 0 || this._deleted.size > 0 || this._renamed.size > 0;
    }

    // 兼容 PvfArchive：TW 无 GRPI 分组
    get groups() {
        return [];
    }

    // TW 无分块压缩：bodySize = 全部文件明文数据字节（bodySize / totalOrig 同值）
    get bodySize() {
        let s = 0;
        for (const f of this.files) {
            if (!f.isDir) s += f.dataSize;
        }
        return s;
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

    // ---- 解析 ----

    // 头部无固定魔数，三重校验：布局合理性 + 文件树解密 + 首条目文件名哈希。
    async parse() {
        const all = this.buf;
        if (all.length < 64) throw new Error("TW 头部数据不足");
        const guidLen = readInt32LE(all, 0);
        if (guidLen < 4 || guidLen > 4096) throw new Error("TW GUID 长度异常");
        const hOff = 4 + guidLen;
        if (hOff + 20 > all.length) throw new Error("TW 头部越界");
        const fileVersion = readInt32LE(all, hOff);
        const fileTreeLength = readInt32LE(all, hOff + 4);
        const fileTreeChecksum = readUInt32LE(all, hOff + 8);
        const fileCount = readInt32LE(all, hOff + 12);
        if (fileVersion < 0 || fileTreeLength <= 0 || fileCount <= 0 || fileCount > 5000000) {
            throw new Error("TW 头部字段非法");
        }
        if (hOff + 16 + fileTreeLength > all.length) throw new Error("TW 文件树越界");

        const tree = all.slice(hOff + 16, hOff + 16 + fileTreeLength);
        pvfDecryptTw(tree, TW_DECRYPT_KEY, fileTreeChecksum);
        const nameLen = readInt32LE(tree, 4);
        if (nameLen <= 0 || nameLen > 4096 || 8 + nameLen > tree.length) {
            throw new Error("TW 文件树解密结果异常");
        }
        const nameCksum = readUInt32LE(tree, 0);
        const nameBytes = tree.subarray(8, 8 + nameLen);
        if (twFileNameHash(nameBytes) !== nameCksum) {
            throw new Error("TW 文件名哈希校验失败");
        }

        this.header = {
            signature: 0,
            guid: all.slice(4, 4 + guidLen),
            guidLen,
            fileVersion,
            fileTreeLength,
            fileTreeChecksum,
            fileCount,
            padding: 0,
            bodySize: 0,
            groupCount: 0,
            hashTableSize: 0,
            nameTableSize: 0
        };
        this._twTree = tree;
        this._twDataBase = hOff + 16 + fileTreeLength;
        this._parseTwFileTree();
        this._twInitStringTables();
    }

    // 文件树：每条 = 哈希(4) + 长度(4) + 文件名 + DataLen(4) + Checksum(4) + DataOffset(4)
    _parseTwFileTree() {
        const tree = this._twTree;
        const treeLen = tree.length;
        const count = this.header.fileCount;
        const enc = this.twEncoding;
        this.files = [];
        let idx = 0;
        for (let i = 0; i < count; i++) {
            if (idx + 20 > treeLen) throw new Error("TW 文件树条目越界");
            const nameHash = readUInt32LE(tree, idx);
            const nameLen = readInt32LE(tree, idx + 4);
            if (nameLen <= 0 || nameLen > 4096 || idx + 20 + nameLen > treeLen) {
                throw new Error(`TW 文件树条目 ${i} 长度异常`);
            }
            const nameBytes = tree.subarray(idx + 8, idx + 8 + nameLen);
            const dataLen = readInt32LE(tree, idx + 8 + nameLen);
            const checksum = readUInt32LE(tree, idx + 12 + nameLen);
            const dataOffset = readInt32LE(tree, idx + 16 + nameLen);
            const name = decodeText(nameBytes, enc).replace(/\0+$/g, "").replace(/\\/g, "/").toLowerCase();
            const isDir = name.endsWith("/");
            this.files.push({
                name,
                path: isDir ? name : "",
                nameOff: -1,
                pathOff: -1,
                chunkIndex: -1,
                dataOffset,
                dataSize: dataLen,
                checksum,
                nameHash,
                dataType: 1,
                index: i,
                isDir,
                fullpath: name,
                twNameBytes: nameBytes.slice()
            });
            idx += nameLen + 20;
        }
        if (this.files.length !== count) throw new Error("TW 文件树条目数与头部不一致");
    }

    // 文件数据同步解密（返回明文，失败返回 null）
    _twDecodeFileBytes(file) {
        if (file.isDir || file.dataSize <= 0) return new Uint8Array(0);
        const trueLen = (file.dataSize + 3) & ~3;
        const start = this._twDataBase + file.dataOffset;
        if (start < 0 || start + trueLen > this.buf.length) return null;
        const dec = this.buf.slice(start, start + trueLen);
        pvfDecryptTw(dec, TW_DECRYPT_KEY, file.checksum >>> 0);
        return dec.subarray(0, file.dataSize);
    }

    // 区域编码检测：Big5 优先（GBK 双字节区过于宽松，会把繁体字节全量误判为 GBK）
    _twDetectEncoding(bytes) {
        const n = Math.min(bytes.length, 16384);
        let hasNonAscii = false;
        for (let i = 0; i < n; i++) {
            if (bytes[i] >= 0x80) {
                hasNonAscii = true;
                break;
            }
        }
        if (!hasNonAscii) return this.twEncoding;
        for (const enc of ["big5", "gbk", "utf-8"]) {
            try {
                new TextDecoder(enc, { fatal: true }).decode(bytes.subarray(0, n));
                return enc;
            } catch (err) {
                // 该编码无法严格解码 → 尝试下一个
            }
        }
        return this.twEncoding;
    }

    // 同步初始化 stringtable.bin 与 strlst（n_string.lst）引用表
    _twInitStringTables() {
        const st = this.files.find(x => x.name === "stringtable.bin");
        if (st) {
            const data = this._twDecodeFileBytes(st);
            if (data && data.length >= 8) {
                const count = readInt32LE(data, 0);
                if (count > 0 && count < 3000000 && 4 + (count + 1) * 4 <= data.length) {
                    this.twEncoding = this._twDetectEncoding(data);
                    const offs = new Int32Array(count + 1);
                    for (let i = 0; i <= count; i++) offs[i] = readInt32LE(data, 4 + i * 4);
                    // 偏移表第 i 项是「数据区起点之前的 4 字节处 + 累计长度」的绝对定位值，
                    // 字符串 i 的字节区间 = [offs[i] + 4, offs[i+1] + 4)
                    const list = new Array(count);
                    for (let i = 0; i < count; i++) {
                        const start = offs[i] + 4;
                        const end = offs[i + 1] + 4;
                        if (start < 0 || end < start || end > data.length) {
                            list[i] = "";
                            continue;
                        }
                        list[i] = decodeText(data.subarray(start, end), this.twEncoding).replace(/\0+$/, "");
                    }
                    this._twStringTable = { list, count };
                    this._twStrIdx = new Map();
                    for (let i = 0; i < count; i++) {
                        if (!this._twStrIdx.has(list[i])) this._twStrIdx.set(list[i], i);
                    }
                    // 文件名与字符串同编码：按检测结果统一重解码；
                    // 保留原始路径大小写，不强制转小写（匹配时按需小写归一）
                    for (const f of this.files) {
                        if (f.twNameBytes) {
                            f.name = decodeText(f.twNameBytes, this.twEncoding).replace(/\0+$/g, "").replace(/\\/g, "/");
                            f.isDir = f.name.endsWith("/");
                            f.fullpath = f.name;
                            f.path = f.isDir ? f.name : "";
                        }
                    }
                }
            }
        }
        if (!this._twStringTable) {
            this._twStringTable = { list: [], count: 0 };
            this._twStrIdx = new Map();
        }

        // strlst 引用表：n_string.lst 每 10 字节一组 [9][int32:id][10][int32:文件名索引]
        const strLists = new Map();
        const strListFiles = new Map();
        const lstFile = this.files.find(x => x.name === "n_string.lst");
        if (lstFile) {
            const data = this._twDecodeFileBytes(lstFile);
            if (data && data.length >= 2 && data[0] === 0xb0 && data[1] === 0xd0) {
                for (let i = 2; i < data.length - 9; i += 10) {
                    const strId = readInt32LE(data, i + 1);
                    const nameIdx = readInt32LE(data, i + 6);
                    const fileName = this._twString(nameIdx);
                    if (!fileName) continue;
                    const dir = String(lstFile.fullpath || "")
                        .split("/")
                        .slice(0, -1)
                        .join("/");
                    // n_string.lst 中引用名可能大小写混写，仅匹配时统一转小写，不改原路径
                    const norm = fileName.replace(/\\/g, "/").toLowerCase();
                    const full = (dir ? dir + "/" : "") + norm;
                    const target = this.files.find(x => String(x.fullpath).toLowerCase() === full || String(x.name).toLowerCase() === norm);
                    if (!target) continue;
                    const textData = this._twDecodeFileBytes(target);
                    if (!textData) continue;
                    const m = new Map();
                    const text = decodeText(textData, this.twEncoding);
                    for (const line of text.split(/\r?\n/)) {
                        if (!line || line.startsWith("//")) continue;
                        const sep = line.indexOf(">");
                        if (sep <= 0) continue;
                        const k = line.slice(0, sep);
                        const v = line.slice(sep + 1);
                        if (k && !m.has(k)) m.set(k, v);
                    }
                    strLists.set(strId, m);
                    strListFiles.set(strId, target);
                }
            }
        }
        this._twStrLists = strLists;
        this._twStrListFiles = strListFiles;
    }

    // ---- 字符串表 / strlst ----

    // TW 字符串表查值（索引 -> 文本）
    _twString(idx) {
        const t = this._twStringTable;
        if (!t || idx < 0 || idx >= t.list.length) return "::" + idx;
        return t.list[idx];
    }

    // 文本入表：已存在返回索引，否则追加到表尾（编辑写回时新增字符串）
    _twIntern(text) {
        const key = text == null ? "" : String(text);
        if (this._twStrIdx.has(key)) return this._twStrIdx.get(key);
        const t = this._twStringTable;
        const idx = t.count;
        t.list.push(key);
        t.count++;
        this._twStrIdx.set(key, idx);
        return idx;
    }

    // TW strlst 查询：按 strlst id 与引用键名取文本
    _twStrText(strId, name) {
        const m = this._twStrLists ? this._twStrLists.get(strId) : null;
        return m && m.has(name) ? m.get(name) : "";
    }

    // 更新 strlst 文本（编辑 <id::name`text`> 时调用），并标记对应 strlst 文件待重建
    _twSetStrListText(strId, name, text) {
        let m = this._twStrLists.get(strId);
        if (!m) {
            m = new Map();
            this._twStrLists.set(strId, m);
        }
        m.set(name, text);
        const file = this._twStrListFiles.get(strId);
        if (file) this._twStrListsDirty.add(file.index);
    }

    // 重建 stringtable.bin 字节（含 _twIntern 新追加的字符串）
    _twBuildStringTableBytes() {
        const t = this._twStringTable;
        const list = t.list;
        const count = t.count;
        const enc = this.twEncoding;
        const payload = [];
        let length = 0;
        for (const s of list) {
            const bytes = encodeText(s == null ? "" : s, enc);
            payload.push(bytes);
            length += bytes.length;
        }
        // offset[i] = count*4 + 4 + 累计长度（读取方用 offset[i] + 4 定位）
        const head = new Uint8Array(4 + (count + 1) * 4);
        writeInt32LE(head, 0, count);
        let acc = 0;
        for (let i = 0; i < count; i++) {
            writeInt32LE(head, 4 + i * 4, count * 4 + 4 + acc);
            acc += payload[i].length;
        }
        writeInt32LE(head, 4 + count * 4, count * 4 + 4 + acc);
        return mergeChunks([head, ...payload]);
    }

    // stringtable.bin 可读视图：每行 `索引>文本`，内容区纯文本显示原始字符串；
    // 字符串内部真实换行（\r\n / \r / \n）转义为字面 \n 展示，保持每行一条且换行位置可见。
    _twStringTableView() {
        const t = this._twStringTable;
        const list = t && t.list ? t.list : [];
        const out = new Array(list.length);
        for (let i = 0; i < list.length; i++) {
            out[i] = i + ">" + String(list[i]).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\\n");
        }
        return out.join("\n");
    }

    // 把 stringtable.bin 视图文本回写到字符串表 list（按行首索引更新对应条目）
    _twApplyStringTableText(text) {
        const t = this._twStringTable;
        const list = t.list;
        const lines = String(text || "").split("\n");
        for (const line of lines) {
            if (!line) continue;
            const sep = line.indexOf(">");
            if (sep <= 0) continue;
            const idx = parseInt(line.slice(0, sep), 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) continue;
            list[idx] = line.slice(sep + 1).replace(/\\n/g, "\n");
        }
        this._twStrIdx = new Map();
        for (let i = 0; i < list.length; i++) {
            if (!this._twStrIdx.has(list[i])) this._twStrIdx.set(list[i], i);
        }
    }

    // ---- 文件数据读取 ----

    async getFileData(file) {
        if (file.isDir || file.dataSize <= 0) return new Uint8Array(0);
        if (this._overlay.has(file.index)) return this._overlay.get(file.index);
        return this._twDecodeFileBytes(file);
    }

    async getFilesData(files) {
        const result = new Array(files.length).fill(null);
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir || f.dataSize <= 0) continue;
            if (this._overlay.has(f.index)) {
                result[i] = this._overlay.get(f.index);
                continue;
            }
            result[i] = this._twDecodeFileBytes(f);
        }
        return result;
    }

    // ---- 解码 ----

    _twEscape(s) {
        return s ? s.replace(/`/g, "``") : s;
    }

    _normalizeLines(text) {
        return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    // TW 脚本 token 流转文本：
    //   2=int / 4=float 以 \t 同行；5=节；7=`串`；6、8={N=`串`}；3={N=值}；9+10=<id::name`text`> 成对。
    // 脚本文件前 2 字节为魔数 0xD0B0，条目流自偏移 2 起。
    decodeTwToken(data) {
        const tokens = readTokens(data.subarray(2));
        if (tokens.length === 0) return "";
        const parts = [];
        let i = 0;
        while (i < tokens.length) {
            const { type, value } = tokens[i];
            switch (type) {
                case 2:
                    parts.push(String(value) + "\t");
                    i++;
                    break;
                case 4:
                    parts.push(float32ToString(value) + "\t");
                    i++;
                    break;
                case 5: {
                    // 字符串表中节名已含方括号（如 "[name]"），直接输出避免双重包裹
                    const sec = this._twString(value);
                    parts.push("\n" + (/^\[.*\]$/.test(sec) ? sec : "[" + sec + "]") + "\n");
                    i++;
                    break;
                }
                case 7:
                    parts.push("`" + this._twEscape(this._twString(value)) + "`\t");
                    i++;
                    break;
                case 3:
                    parts.push("{3=" + value + "}\t");
                    i++;
                    break;
                case 6:
                    parts.push("{6=`" + this._twEscape(this._twString(value)) + "`}\t");
                    i++;
                    break;
                case 8:
                    parts.push("{8=`" + this._twEscape(this._twString(value)) + "`}\t");
                    i++;
                    break;
                case 9:
                    if (i + 1 < tokens.length && tokens[i + 1].type === 10) {
                        const strId = value;
                        const name = this._twString(tokens[i + 1].value);
                        parts.push("<" + strId + "::" + name + "`" + this._twEscape(this._twStrText(strId, name)) + "`>\t");
                        i += 2;
                    } else {
                        parts.push("{9=" + value + "}\t");
                        i++;
                    }
                    break;
                case 10:
                    parts.push("<::" + this._twString(value) + "``>\t");
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

    // TW .lst 解码：`[2:id][7:路径索引]` 成对合并为「数字 `路径`」行
    decodeTwLst(data) {
        const tokens = readTokens(data.subarray(2));
        if (tokens.length === 0) return "";
        const parts = [];
        let i = 0;
        while (i < tokens.length) {
            const { type, value } = tokens[i];
            if (type === 2 && i + 1 < tokens.length && tokens[i + 1].type === 7) {
                parts.push(String(value) + " `" + this._twEscape(this._twString(tokens[i + 1].value)) + "`\n");
                i += 2;
            } else if (type === 7) {
                parts.push("`" + this._twEscape(this._twString(value)) + "`\n");
                i++;
            } else if (type === 2 || type === 4) {
                parts.push((type === 4 ? float32ToString(value) : String(value)) + "\n");
                i++;
            } else {
                parts.push("?(" + type + "," + value + ")\n");
                i++;
            }
        }
        return this._normalizeLines(parts.join(""));
    }

    // TW 非脚本文件文本尝试：可打印率过低视为二进制
    _twDecodeBinaryText(data) {
        // 明文 ani / 其它 pvfUtility 导出文本（#PVF_File 或 [FRAME 开头）按注释显示
        const head = decodeText(data.subarray(0, 16), "latin1");
        if (/^#PVF_File/.test(head) || /^\[FRAME/.test(head)) {
            return this._normalizeLines(decodeText(data, this.twEncoding));
        }
        // strlst 明文检测：`key>text` 行（含韩文等多字节文本时可打印率不足 70% 而误判）
        if (this._twLooksLikeStrList(data)) {
            return this._normalizeLines(decodeText(data, this.twEncoding));
        }
        // UTF-16LE 文本检测（如 .lua 源码）：偶数索引字节可打印、奇数索引字节大量为 0
        const n16 = Math.min(data.length - (data.length % 2), 4096);
        if (n16 >= 4) {
            let oddZero = 0;
            let evenPrintable = 0;
            let evenTotal = 0;
            for (let i = 0; i < n16; i += 2) {
                if (data[i + 1] === 0) oddZero++;
                const c = data[i];
                if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f)) evenPrintable++;
                evenTotal++;
            }
            if (oddZero > n16 / 4 && evenPrintable > evenTotal * 0.7) {
                return this._normalizeLines(new TextDecoder("utf-16le").decode(data));
            }
        }
        let printable = 0;
        const n = Math.min(data.length, 4096);
        for (let i = 0; i < n; i++) {
            const c = data[i];
            if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f)) printable++;
        }
        if (printable < n * 0.7) return "[二进制文件 " + data.length + " 字节]";
        return this._normalizeLines(decodeText(data, this.twEncoding));
    }

    // strlst 明文判定：行结构为 `key>text`、`// 注释` 或空行，且至少一条 key>text。
    // 采样前 64 行即可判定（strlst 头部即符合特征），避免对大文件全量解码。
    _twLooksLikeStrList(data) {
        let lineStart = 0;
        let kvLines = 0;
        let otherLines = 0;
        let lines = 0;
        const maxBytes = Math.min(data.length, 4096);
        for (let i = 0; i <= maxBytes && lines < 64; i++) {
            if (i === maxBytes || data[i] === 10) {
                if (i > lineStart) {
                    lines++;
                    const b = data[lineStart];
                    if (b === 47 && data[lineStart + 1] === 47) {
                        // // 注释行
                    } else if (data.indexOf(62, lineStart) >= lineStart && data.indexOf(62, lineStart) < i) {
                        kvLines++;
                    } else {
                        otherLines++;
                    }
                }
                lineStart = i + 1;
            }
        }
        return kvLines >= 1 && kvLines >= otherLines;
    }

    // .ani 动画文件解析（70 ANI 二进制格式，见 docs/pvf-tw-format.md §9.2）。
    // 输出 pvfUtility 权威明文格式（对照 Ani70Encoder.cs Decrypt70Ani）：
    //   #PVF_File / 全局项(LOOP/SHADOW/COORD/OPERATION/SPECTRUM 系列) /
    //   [FRAME MAX] / 每帧 [FRAME000] [IMAGE] `路径` idx [IMAGE POS] x\ty 帧项 + 盒。
    // 明文 ani（#PVF_File 开头，或直接 [FRAME MAX] 文本）按注释文本原样展示（不加前缀）。
    _twDecodeAni(data) {
        const head = decodeText(data.subarray(0, 16), "latin1");
        if (/^#PVF_File/.test(head) || /^\[FRAME/.test(head)) {
            return this._normalizeLines(decodeText(data, this.twEncoding));
        }
        const out = ["#PVF_File"];
        try {
            const rd = this._twAniReader(data);
            const frameMax = rd.u16();
            if (frameMax > 5000) throw new Error("frameMax implausible " + frameMax);
            const imgCount = rd.u16();
            if (imgCount > 1000) throw new Error("imgCount implausible " + imgCount);
            const imgList = [];
            for (let i = 0; i < imgCount; i++) {
                const len = rd.i32();
                if (len <= 0 || len > 512) throw new Error("img " + i + " len " + len);
                imgList.push(rd.str(len));
            }
            const overallCount = rd.u16();
            for (let j = 0; j < overallCount; j++) {
                const tag = rd.u16();
                if (tag === 0 || tag === 1) out.push(`[${this._twAniTagName(tag)}]`, String(rd.byte()));
                else if (tag === 3 || tag === 28) out.push(`[${this._twAniTagName(tag)}]`, String(rd.u16()));
                else if (tag === 18) {
                    out.push("[SPECTRUM]", String(rd.byte()));
                    out.push("[SPECTRUM TERM]", String(rd.i32()));
                    out.push("[SPECTRUM LIFE TIME]", String(rd.i32()));
                    out.push("[SPECTRUM COLOR]", [this._twPct(rd.byte()), this._twPct(rd.byte()),
                        this._twPct(rd.byte()), this._twPct(rd.byte())].join("\t"));
                    const se = rd.u16();
                    out.push("[SPECTRUM EFFECT]", `\`${this._twAniEffectName(se)}\``);
                } else throw new Error("overall tag " + tag + " (" + j + "/" + overallCount + ")");
            }
            out.push("[FRAME MAX]", String(frameMax));
            for (let k = 0; k < frameMax; k++) {
                out.push("", `[FRAME${String(k).padStart(3, "0")}]`);
                const boxLines = [];
                const boxCount = rd.u16();
                for (let l = 0; l < boxCount; l++) {
                    const tag = rd.u16();
                    if (tag !== 15 && tag !== 14) throw new Error("frame" + k + " box tag " + tag);
                    const six = [];
                    for (let b = 0; b < 6; b++) six.push(rd.i32());
                    boxLines.push(`[${this._twAniTagName(tag)}]`, six.join("\t"));
                }
                const imgIndex = rd.i16();
                out.push("[IMAGE]");
                if (imgIndex >= 0) {
                    if (imgIndex > imgList.length - 1) throw new Error("frame" + k + " imgIndex " + imgIndex + " oob");
                    out.push(`\`${imgList[imgIndex]}\``, String(rd.u16()));
                } else out.push("``", "0");
                out.push("[IMAGE POS]", `${rd.i32()}\t${rd.i32()}`);
                const frameItemCount = rd.u16();
                for (let i = 0; i < frameItemCount; i++) {
                    const tag = rd.u16();
                    const t = this._twAniTagName(tag);
                    switch (tag) {
                        case 0: case 1: case 10: out.push(`[${t}]`, String(rd.byte())); break;
                        case 3: out.push(`[${t}]`, String(rd.u16())); break;
                        case 17: out.push(`[${t}]`, "1"); break;
                        case 7: out.push(`[${t}]`, `${this._twFmtF(rd.f32())}\t${this._twFmtF(rd.f32())}`); break;
                        case 8: out.push(`[${t}]`, this._twFmtF(rd.f32())); break;
                        case 9: out.push(`[${t}]`, [this._twPct(rd.byte()), this._twPct(rd.byte()),
                            this._twPct(rd.byte()), this._twPct(rd.byte())].join("\t")); break;
                        case 11: {
                            const e = rd.u16();
                            out.push(`[${t}]`, `\`${this._twAniEffectName(e)}\``);
                            if (e === 5) out.push([this._twPct(rd.byte()), this._twPct(rd.byte()),
                                this._twPct(rd.byte())].join("\t"));
                            if (e === 6) out.push(`${rd.i16()}\t${rd.i16()}`);
                            break;
                        }
                        case 12: out.push(`[${t}]`, String(rd.i32())); break;
                        case 13: { const v = rd.u16(); out.push(`[${t}]`, `\`${this._twAniDamageName(v)}\``); break; }
                        case 16: {
                            const len = rd.i32();
                            if (len <= 0 || len > 512) throw new Error("frame" + k + " sound len " + len);
                            out.push(`[${t}]`, `\`${rd.str(len)}\``);
                            break;
                        }
                        case 23: out.push(`[${t}]`, String(rd.i32())); break;
                        case 24: { const v = rd.u16(); out.push(`[${t}]`, `\`${this._twAniFlipName(v)}\``); break; }
                        case 25: out.push(`[${t}]`); break;
                        case 26: out.push(`[${t}]`, String(rd.i32())); break;
                        case 27: out.push(`[${t}]`, `${rd.i16()}\t${rd.i16()}\t${rd.i16()}\t${rd.i16()}`); break;
                        default: throw new Error("frame" + k + " item tag " + tag);
                    }
                }
                out.push(...boxLines);
            }
            const consumed = rd.pos();
            if (consumed > data.length) throw new Error("overrun");
        } catch (e) {
            // 解析失败回退 hex（含 3 字节尾部零填充等容差由 reader 边界处理）
            return this._twAniHexFallback(data);
        }
        return out.join("\n") + "\n";
    }

    _twPct(b) { return String((256.0 + b) % 256.0); }

    _twFmtF(v) { return Number(v.toPrecision(7)).toString(); }

    _twAniTagName(tag) {
        const ANI_TAGS = ["LOOP", "SHADOW", "?", "COORD", "?", "?", "?", "IMAGE RATE",
            "IMAGE ROTATE", "RGBA", "INTERPOLATION", "GRAPHIC EFFECT", "DELAY", "DAMAGE TYPE",
            "DAMAGE BOX", "ATTACK BOX", "PLAY SOUND", "PRELOAD", "SPECTRUM", "?", "?", "?", "?",
            "SET FLAG", "FLIP TYPE", "LOOP START", "LOOP END", "CLIP", "OPERATION"];
        return ANI_TAGS[tag] ?? ("TAG" + tag);
    }

    _twAniEffectName(e) {
        const names = ["NONE", "DODGE", "LINEARDODGE", "DARK", "XOR", "MONOCHROME", "SPACEDISTORT"];
        return names[e] ?? String(e);
    }

    _twAniDamageName(v) {
        return ["NORMAL", "SUPERARMOR", "UNBREAKABLE"][v] ?? String(v);
    }

    _twAniFlipName(v) {
        return ["", "HORIZON", "VERTICAL", "ALL"][v] ?? String(v);
    }

    // 二进制读取器（小端）
    _twAniReader(data) {
        let i = 0;
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        return {
            pos: () => i,
            byte() { return dv.getUint8(i++); },
            u16() { const v = dv.getUint16(i, true); i += 2; return v; },
            i16() { const v = dv.getInt16(i, true); i += 2; return v; },
            i32() { const v = dv.getInt32(i, true); i += 4; return v; },
            f32() { const v = dv.getFloat32(i, true); i += 4; return v; },
            str(len) { let s = ""; for (let p = i, e = i + len; p < e; p++) { const b = data[p]; s += b < 0x80 ? String.fromCharCode(b) : "?"; } i += len; return s; }
        };
    }

    _twAniHexFallback(data) {
        const out = [];
        const frameCount = data.length >= 2 ? data[0] | (data[1] << 8) : 0;
        out.push("[ani] 帧数: " + frameCount);
        out.push("数据 (" + data.length + " 字节):");
        for (let i = 0; i < data.length; i += 16) {
            const chunk = Array.from(data.subarray(i, Math.min(i + 16, data.length)))
                .map(b => b.toString(16).padStart(2, "0"))
                .join(" ");
            out.push("  " + chunk);
        }
        return out.join("\n");
    }

    // 原始字节 -> 文本总入口（对齐 PvfArchive.decodeContent）
    decodeContent(file, data) {
        if (!data || data.length === 0) return "";
        // #PVF_File 明文（pvfUtility 导出的 ani/其它类型文本）不解析，按注释文本原样展示；
        // 编辑/导出按源文件处理（_twDecodeBinaryText 同规则，见 docs/pvf-tw-format.md §9）
        if (/^#PVF_File/.test(decodeText(data.subarray(0, 16), "latin1"))) {
            return this._normalizeLines(decodeText(data, this.twEncoding));
        }
        if (file && /^stringtable\.bin$/i.test(file.name)) return this._twStringTableView();
        if (file && /\.ani$/i.test(file.name)) return this._twDecodeAni(data);
        if (data.length >= 2 && data[0] === 0xb0 && data[1] === 0xd0) {
            return /\.lst$/i.test(file.name) ? this.decodeTwLst(data) : this.decodeTwToken(data);
        }
        return this._twDecodeBinaryText(data);
    }

    decodeLst(data) {
        return this.decodeTwLst(data);
    }

    isLstFile(file) {
        return !!(file && file.name && /\.lst$/i.test(file.name));
    }

    // ---- 名称 / 元数据（全文文本路径）----

    _extractNameFromData(file, data) {
        if (!data || data.length === 0) return "";
        return extractNameFromText(this.decodeContent(file, data));
    }

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

    async extractNameTags(files) {
        const names = new Array(files.length).fill("");
        const pending = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir || this._nameTagCache.has(f.index)) continue;
            pending.push({ index: i, file: f });
        }
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

    _resolveItemMetaFromData(file, data) {
        if (!data || data.length === 0) return null;
        return this._metaFromText(this.decodeContent(file, data));
    }

    // .lst 增强解码：行尾追加引用文件的 [name] 标签值（对齐 PvfArchive.decodeLstWithNames）
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
                target = idx.get(c.toLowerCase());
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
        const targets = [...pending.values()];
        await this.extractNameTags(targets);
        let matched = 0;
        let named = 0;
        const nameRows = new Map();
        const out = rows.map(({ line, target }, lineNo) => {
            if (!target) return line;
            matched++;
            const name = this._nameTagCache.get(target.index) || "";
            // TW 名称常含 `[技能]` 方括号（如 "殘忍之弒項鏈 : [拔刀斬]"），放行 []，仅过滤
            // 反引号/花括号（token 形态）、换行、# 等明显非名称内容
            if (name && !/[\n\r`{}#]/.test(name)) {
                named++;
                nameRows.set(lineNo, name);
                return `${line.trim()} ${name}`;
            }
            return line;
        });
        const result = this._normalizeLines(out.join("\n"));
        this._lstTextCache.set(file.index, result);
        this._lstNameMapCache.set(file.index, nameRows);
        console.info(
            `[PVF] ${file.name} 名称解析完成：引用 ${rows.length} 行，匹配 ${matched} 个文件，提取名称 ${named} 个，耗时 ${Date.now() - t0}ms` +
                (missed.length ? `，未匹配示例：${missed.join(", ")}` : "")
        );
        return result;
    }

    getLstRefTarget(file, ref) {
        if (!file || ref == null) return null;
        const map = this._lstRefMap.get(file.index);
        return map ? map.get(ref) || null : null;
    }

    // 返回 decodeLstWithNames 追加的引用文件名称映射（行号 -> 名称原文），
    // 供渲染层精确染灰辅助展示的名称（仅包含实际追加名称的行）。
    getLstNameMap(file) {
        if (!file) return new Map();
        return this._lstNameMapCache.get(file.index) || new Map();
    }

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

    async listLstItemMeta(lstFile, items) {
        const map = this._lstRefMap.get(lstFile.index) || new Map();
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
                this._itemMetaCache.set(p.target.index, meta);
                metas[p.index] = meta;
            }
        }
        return metas;
    }

    _buildPathIndex() {
        if (this._pathIndex) return this._pathIndex;
        const idx = new Map();
        const nameIdx = new Map();
        for (const f of this.files) {
            if (f.isDir || !f.fullpath) continue;
            // 匹配统一用小写 key（引用路径可能大小写混写，如 n_string.lst 中
            // `Character/Character.kor.str`），原路径大小写保持不变
            idx.set(f.fullpath.toLowerCase(), f);
            const key = f.name.toLowerCase();
            if (!nameIdx.has(key)) nameIdx.set(key, []);
            nameIdx.get(key).push(f);
        }
        this._pathIndex = idx;
        this._nameIndex = nameIdx;
        return idx;
    }

    // ---- 编码（文本 -> token 流，编辑写回）----

    // 解析 `<id::name`text`>` 字符串链接：返回 { strId, name, text, nextIndex }，非链接返回 null
    _tryReadTwStringLink(text, start) {
        if (start >= text.length || text[start] !== "<") return null;
        const m = /^<(\d+)::([^`]*)`((?:[^`]|``)*)`>/.exec(text.substring(start));
        if (!m) return null;
        return {
            strId: parseInt(m[1], 10),
            name: m[2],
            text: m[3].replace(/``/g, "`"),
            nextIndex: start + m[0].length
        };
    }

    // 解析 `<::name``>` 孤立索引链接（type10 单独出现时 decode 的输出）：返回 { name, nextIndex }
    _tryReadTwBareIndex(text, start) {
        if (start >= text.length || text[start] !== "<") return null;
        const m = /^<::([^`]*)``>/.exec(text.substring(start));
        if (!m) return null;
        return { name: m[1], nextIndex: start + m[0].length };
    }

    // 读取反引号字符串：`` 转义为字面 `。返回 { value, nextIndex }
    _tryReadTwBacktick(text, start) {
        if (start >= text.length || text[start] !== "`") return null;
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

    // TW 脚本文本 -> token 字节（含 0xD0B0 魔数头）。与 decodeTwToken 互逆：
    //   [xxx]/[/xxx] 节、`串`、{3=N}/{6=`串`}/{8=`串`}、<id::name`text`>、数字。
    // 字符串一律经 _twIntern 入 stringtable 表；字符串链接的 text 变化同步回写 strlst。
    encodeTwToken(text) {
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
            const link = this._tryReadTwStringLink(text, i);
            if (link) {
                tokens.push({ type: 9, value: link.strId });
                tokens.push({ type: 10, value: this._twIntern(link.name) });
                const prev = this._twStrText(link.strId, link.name);
                if (prev !== link.text) this._twSetStrListText(link.strId, link.name, link.text);
                i = link.nextIndex;
                continue;
            }
            const bare = this._tryReadTwBareIndex(text, i);
            if (bare) {
                tokens.push({ type: 10, value: this._twIntern(bare.name) });
                i = bare.nextIndex;
                continue;
            }
            if (ch === "`") {
                const bt = this._tryReadTwBacktick(text, i);
                if (bt) {
                    tokens.push({ type: 7, value: this._twIntern(bt.value) });
                    i = bt.nextIndex;
                    continue;
                }
            }
            if (ch === "{") {
                const end = text.indexOf("}", i + 1);
                if (end > i) {
                    const marker = text.substring(i, end + 1).trim();
                    const m = /^\{(\d+)=(.*)\}$/.exec(marker);
                    if (m) {
                        const type = parseInt(m[1], 10);
                        let inner = m[2];
                        if (inner.length >= 2 && inner[0] === "`" && inner[inner.length - 1] === "`") {
                            inner = inner.substring(1, inner.length - 1).replace(/``/g, "`");
                        }
                        if (type === 3) {
                            tokens.push({ type: 3, value: parseInt(inner, 10) || 0 });
                        } else if (type === 6 || type === 8) {
                            tokens.push({ type, value: this._twIntern(inner) });
                        } else {
                            tokens.push({ type: 3, value: parseInt(inner, 10) || 0 });
                        }
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
                    const sec = text.substring(i, end + 1);
                    tokens.push({ type: 5, value: this._twIntern(sec) });
                    i = end + 1;
                    continue;
                }
            }
            // 裸 token：数字 / 未知内容
            const start = i;
            while (i < text.length && !/[\s`{<\[\]}]/.test(text[i])) i++;
            if (i === start) {
                i++;
                continue;
            }
            const token = text.substring(start, i);
            if (/^-?\d+$/.test(token)) {
                tokens.push({ type: 2, value: parseInt(token, 10) });
            } else if (/^-?\d*\.\d+$/.test(token) || /^-?\d+\.\d*$/.test(token)) {
                const dv = new DataView(new ArrayBuffer(4));
                dv.setFloat32(0, parseFloat(token), true);
                tokens.push({ type: 4, value: dv.getInt32(0, true) });
            } else {
                tokens.push({ type: 7, value: this._twIntern(token) });
            }
        }
        const raw = new Uint8Array(2 + tokens.length * 5);
        raw[0] = 0xb0;
        raw[1] = 0xd0;
        for (let n = 0; n < tokens.length; n++) {
            const off = 2 + n * 5;
            raw[off] = tokens[n].type;
            writeInt32LE(raw, off + 1, tokens[n].value);
        }
        return raw;
    }

    // TW .lst 文本 -> token 字节。每行「数字 `路径`」-> [type2][type7] 对。
    encodeTwLst(text) {
        const tokens = [];
        for (const line of text.split(/\r?\n/)) {
            const m = /^(\d+)\s+`((?:[^`]|``)*)`$/.exec(line.trim());
            if (!m) continue;
            tokens.push({ type: 2, value: parseInt(m[1], 10) });
            tokens.push({ type: 7, value: this._twIntern(m[2].replace(/``/g, "`")) });
        }
        const raw = new Uint8Array(2 + tokens.length * 5);
        raw[0] = 0xb0;
        raw[1] = 0xd0;
        for (let n = 0; n < tokens.length; n++) {
            const off = 2 + n * 5;
            raw[off] = tokens[n].type;
            writeInt32LE(raw, off + 1, tokens[n].value);
        }
        return raw;
    }

    // 文本 -> 原始字节总入口（对齐 PvfArchive.encodeContent）
    encodeContent(file, text) {
        // #PVF_File 明文（导出文本）：按源文件格式原样编码（区域编码字节），不做 token 化
        if (/^#PVF_File/.test(String(text || ""))) {
            return encodeText(text, this.twEncoding);
        }
        if (dataTypeIsLst(file)) return this.encodeTwLst(text);
        return this.encodeTwToken(text);
    }

    // ---- 修改跟踪 ----

    setFileContent(fileIndex, text) {
        const file = this.files[fileIndex];
        if (!file) return;
        if (/^stringtable\.bin$/i.test(file.name)) {
            this._twApplyStringTableText(text);
            this._overlay.set(fileIndex, this._twBuildStringTableBytes());
            this._deleted.delete(fileIndex);
            this._nameTagCache.delete(fileIndex);
            this._lstTextCache.delete(fileIndex);
            this._lstNameMapCache.delete(fileIndex);
            this._lstRefMap.delete(fileIndex);
            this._itemMetaCache.delete(fileIndex);
            return;
        }
        const encoded = this.encodeContent(file, this.isLstFile(file) ? stripLstNameAnnotations(text) : text);
        this._overlay.set(fileIndex, encoded);
        this._deleted.delete(fileIndex);
        this._nameTagCache.delete(fileIndex);
        this._lstTextCache.delete(fileIndex);
        this._lstNameMapCache.delete(fileIndex);
        this._lstRefMap.delete(fileIndex);
        this._itemMetaCache.delete(fileIndex);
        this._pathIndex = null;
        this._nameIndex = null;
    }

    setFileRawData(fileIndex, data) {
        const file = this.files[fileIndex];
        if (!file) return;
        this._overlay.set(fileIndex, data);
        this._deleted.delete(fileIndex);
        this._nameTagCache.delete(fileIndex);
        this._lstTextCache.delete(fileIndex);
        this._lstNameMapCache.delete(fileIndex);
        this._lstRefMap.delete(fileIndex);
        this._itemMetaCache.delete(fileIndex);
    }

    deleteFile(fileIndex) {
        if (this.files[fileIndex]) {
            this._deleted.add(fileIndex);
            this._overlay.delete(fileIndex);
        }
    }

    isFileModified(fileIndex) {
        return this._overlay.has(fileIndex);
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

    revertFile(fileIndex) {
        this._overlay.delete(fileIndex);
        this._deleted.delete(fileIndex);
        this._renamed.delete(fileIndex);
        this._nameTagCache.delete(fileIndex);
        this._lstTextCache.delete(fileIndex);
        this._lstNameMapCache.delete(fileIndex);
        this._lstRefMap.delete(fileIndex);
        this._itemMetaCache.delete(fileIndex);
        this._pathIndex = null;
        this._nameIndex = null;
    }

    revertAll() {
        this._overlay.clear();
        this._deleted.clear();
        this._renamed.clear();
        this._nameTagCache.clear();
        this._lstTextCache.clear();
        this._lstNameMapCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();
        this._pathIndex = null;
        this._nameIndex = null;
    }

    async renameFile(fileIndex, newName) {
        const file = this.files[fileIndex];
        if (!file || file.isDir) return { oldFullpath: file && file.fullpath, newFullpath: file && file.fullpath };
        const oldFullpath = file.fullpath;
        let name = String(newName || "")
            .replace(/\\/g, "/")
            .toLowerCase();
        if (name.startsWith("/")) name = name.replace(/^\/+/, "");
        const parts = String(file.fullpath || "").split("/");
        parts[parts.length - 1] = name.split("/").pop();
        const full = parts.join("/");
        if (this._pathIndex && this._pathIndex.has(full)) {
            throw new Error(`目标路径已存在：${full}`);
        }
        this._renamed.set(fileIndex, full);
        this._pathIndex = null;
        this._nameIndex = null;
        return { oldFullpath, newFullpath: full };
    }

    async setFilePath(fileIndex, newPath) {
        const file = this.files[fileIndex];
        if (!file || file.isDir) return;
        const base = String(file.fullpath || "")
            .split("/")
            .pop();
        let path = String(newPath || "")
            .replace(/\\/g, "/")
            .toLowerCase();
        if (path.startsWith("/")) path = path.replace(/^\/+/, "");
        const full = (path ? path.replace(/\/+$/, "") + "/" : "") + base;
        if (this._pathIndex && this._pathIndex.has(full)) {
            throw new Error(`目标路径已存在：${full}`);
        }
        this._renamed.set(fileIndex, full);
        this._pathIndex = null;
        this._nameIndex = null;
    }

    async renameFolder(folderPath, newFolderName) {
        const path = String(folderPath || "").replace(/\\/g, "/");
        if (!path.endsWith("/")) return { mappings: [] };
        const target = String(newFolderName || "")
            .replace(/\\/g, "/")
            .replace(/^\/+|\/+$/g, "");
        if (!target) return { mappings: [] };
        for (const f of this.files) {
            if (!f.fullpath || !f.fullpath.startsWith(path)) continue;
            const full = target + "/" + f.fullpath.substring(path.length);
            if (this._pathIndex && this._pathIndex.has(full)) {
                throw new Error(`目标路径已存在：${full}`);
            }
            this._renamed.set(f.index, full);
        }
        this._pathIndex = null;
        this._nameIndex = null;
        // TW 字符串为 stringtable 索引，自动改写文本引用不安全，不提供映射
        return { mappings: [] };
    }

    // ---- 引用搜索（TW 无字符串池偏移语义，安全禁用；文本级改写会破坏 stringtable 索引）----

    buildPathMappings() {
        return [];
    }

    async findReferencesMulti() {
        return [];
    }

    async fixReferences() {
        return 0;
    }

    async getStrNameMap() {
        return new Map();
    }

    async exportFile(file) {
        if (file.isDir) return null;
        const data = await this.getFileData(file);
        if (!data) return null;
        const name =
            String(file.fullpath || file.name || "file")
                .split("/")
                .pop() || "file";
        return { data, name };
    }

    // ---- 编码切换 ----

    setEncoding(encoding) {
        if (this.twEncoding === encoding) return;
        this.twEncoding = encoding;
        // 重新解码文件名（保留原始编码字节）与 stringtable / strlst 引用表
        for (const file of this.files) {
            if (file.twNameBytes) {
                file.name = decodeText(file.twNameBytes, this.twEncoding).replace(/\0+$/g, "").replace(/\\/g, "/").toLowerCase();
                file.isDir = file.name.endsWith("/");
                file.fullpath = file.name;
                file.path = file.isDir ? file.name : "";
            }
        }
        this._twInitStringTables();
        this._nameTagCache.clear();
        this._lstTextCache.clear();
        this._lstNameMapCache.clear();
        this._lstRefMap.clear();
        this._itemMetaCache.clear();
        this._pathIndex = null;
        this._nameIndex = null;
    }

    // ---- 保存（TW 全量重建）----

    // 保存流程：收集所有文件数据（overlay 优先）→ 回写 strlst / stringtable →
    // 逐文件对齐加密并重算校验 → 按文件名哈希排序重建文件树 → 拼接头部+树+数据区。
    async saveAs(onProgress) {
        // 无修改直接返回原字节
        if (this._overlay.size === 0 && this._deleted.size === 0 && this._renamed.size === 0) {
            return this.buf.slice();
        }

        // 1. 回写被编辑的 strlst 文件（明文 name>text 行，区域编码；按文件聚合多个 id 的键值）
        if (this._twStrListsDirty.size > 0) {
            const byFile = new Map();
            for (const [strId, m] of this._twStrLists) {
                const file = this._twStrListFiles.get(strId);
                if (!file) continue;
                if (!byFile.has(file.index)) byFile.set(file.index, { file, lines: [] });
                for (const [k, v] of m) byFile.get(file.index).lines.push(k + ">" + v);
            }
            for (const { file, lines } of byFile.values()) {
                if (!this._twStrListsDirty.has(file.index)) continue;
                const textBytes = encodeText(lines.join("\n") + (lines.length ? "\n" : ""), this.twEncoding);
                this._overlay.set(file.index, textBytes);
            }
            this._twStrListsDirty.clear();
        }

        // 2. 重建 stringtable.bin（含 _twIntern 新增字符串）
        const stBytes = this._twBuildStringTableBytes();
        const stFile = this.files.find(x => x.name === "stringtable.bin");
        if (stFile && !this._overlay.has(stFile.index)) {
            this._overlay.set(stFile.index, stBytes);
        }

        // 3. 逐文件准备明文数据与条目
        const entries = [];
        const enc = this.twEncoding;
        for (let i = 0; i < this.files.length; i++) {
            const f = this.files[i];
            if (this._deleted.has(i)) continue;
            let data;
            if (this._overlay.has(i)) {
                data = this._overlay.get(i);
            } else if (!f.isDir) {
                data = this._twDecodeFileBytes(f);
            } else {
                data = null;
            }
            if (data == null) data = new Uint8Array(0);

            const newName = this._renamed.has(i) ? this._renamed.get(i) : f.fullpath;
            // 未重命名文件沿用原始文件名编码字节（重编码可能因编码歧义改变哈希）；
            // 重命名文件按新名以区域编码生成
            const nameBytes = this._renamed.has(i)
                ? encodeText(String(newName).toLowerCase().replace(/\\/g, "/"), enc)
                : f.twNameBytes
                  ? f.twNameBytes.slice()
                  : encodeText(String(newName).toLowerCase(), enc);
            // 重命名后按新名重算哈希；未重命名沿用原文件名哈希
            const nameCksum = this._renamed.has(i) ? twFileNameHash(nameBytes) >>> 0 : f.nameHash;
            const checksum = twCreateBuffKey(data, nameCksum) >>> 0;
            entries.push({
                index: i,
                nameCksum,
                nameBytes,
                dataLen: data.length,
                checksum,
                data,
                isDir: f.isDir
            });
        }

        // 4. 按文件名哈希排序重建文件树（对齐原归档语义）
        entries.sort((a, b) => (a.nameCksum >>> 0) - (b.nameCksum >>> 0));

        // 5. 布局计算：树长与数据区偏移
        let treeLen = 0;
        for (const e of entries) treeLen += e.nameBytes.length + 20;
        treeLen = (treeLen + 3) & ~3;
        const guidLen = this.header.guidLen;
        const hOff = 4 + guidLen;
        const dataBase = hOff + 16 + treeLen;

        // 6. 文件树字节 + 数据区（明文逐文件加密）
        const tree = new Uint8Array(treeLen);
        const bodyParts = [];
        let cursor = 0;
        for (const e of entries) {
            e.dataOffset = cursor;
            cursor += (e.dataLen + 3) & ~3;
        }
        let tOff = 0;
        let done = 0;
        const total = entries.length;
        for (const e of entries) {
            writeInt32LE(tree, tOff, e.nameCksum >>> 0);
            writeInt32LE(tree, tOff + 4, e.nameBytes.length);
            tree.set(e.nameBytes, tOff + 8);
            writeInt32LE(tree, tOff + 8 + e.nameBytes.length, e.dataLen);
            writeInt32LE(tree, tOff + 12 + e.nameBytes.length, e.checksum >>> 0);
            writeInt32LE(tree, tOff + 16 + e.nameBytes.length, e.dataOffset);
            tOff += e.nameBytes.length + 20;

            // 明文数据 4 字节对齐后加密
            const trueLen = (e.dataLen + 3) & ~3;
            const block = new Uint8Array(trueLen);
            block.set(e.data, 0);
            pvfEncryptTw(block, TW_DECRYPT_KEY, e.checksum >>> 0);
            bodyParts.push(block);
            done++;
            if (onProgress && (done % 2000 === 0 || done === total)) onProgress(done, total);
        }
        const body = mergeChunks(bodyParts);

        // 7. 加密文件树（checksum = CreateBuffKey(明文树, treeLen, fileCount)）
        const fileTreeChecksum = twCreateBuffKey(tree, entries.length) >>> 0;
        const encTree = tree.slice();
        pvfEncryptTw(encTree, TW_DECRYPT_KEY, fileTreeChecksum);

        // 8. 头部 + 加密树 + 数据区 + 尾部标记
        const head = new Uint8Array(20 + guidLen);
        writeInt32LE(head, 0, guidLen);
        head.set(this.header.guid, 4);
        writeInt32LE(head, hOff, this.header.fileVersion);
        writeInt32LE(head, hOff + 4, treeLen);
        writeInt32LE(head, hOff + 8, fileTreeChecksum);
        writeInt32LE(head, hOff + 12, entries.length);
        const out = mergeChunks([head, encTree, body]);
        this.header.fileCount = entries.length;
        this.header.fileTreeLength = treeLen;
        this.header.fileTreeChecksum = fileTreeChecksum;
        return out;
    }
}

// .lst 判定的 dataType 独立辅助（TW 全部为 dataType 1，靠扩展名判定）
function dataTypeIsLst(file) {
    return !!(file && file.name && /\.lst$/i.test(file.name));
}

// 剥离 .lst 展示时追加的行尾 [name] 名称（对齐 pvfTool 的 stripLstNameAnnotations 语义）
function stripLstNameAnnotations(text) {
    if (!text) return text;
    return String(text)
        .split(/\r?\n/)
        .map(line => {
            const m = /^(\d+\s+`(?:[^`]|``)*`)\s+[^\s].*$/.exec(line);
            return m ? m[1] : line;
        })
        .join("\n");
}
