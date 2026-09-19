// ============================================================
//  重打包归档（REPACK/60CN）只读解析层
//  二进制协议见 docs/pvf-repack-format.md；与 PvfArchive（JP/JPAG/CN）、
//  TwPvfArchive（TW）互补互斥。归档内文件为明文文本（非 .str 固定 GBK；
//  .str 为 EUC-KR / GBK / SJIS 多编码行级混合，见 §3），
//  公共 API 对齐既有两层子集，PvfEditor / ItemCodeView 可无感切换。
//  只读边界（docs/pvf-repack-format.md §4）：编辑回写未实现（无写入端权威对照），
//  hasChanges 恒 false，保存 / 导入入口由编辑器拦截。
// ============================================================

import { decodeText } from "./encoding.js";
import { readInt32LE, readUInt32LE, pvfDecryptRepack, REPACK_MAGIC, PvfFormat } from "./pvfCodec.js";
import { extractNameFromText, sanitizeFilename } from "./pvfTool.js";
import { encodeGBK } from "./gbkEncoder.js";

// 头部 = 15 字节魔数 + 12 字节参数（树区长度 / 树区校验值 / 文件总数）
const REPACK_HEADER_SIZE = REPACK_MAGIC.length + 12;

// .str 两级编码判定的复用实例与判定正则（docs/pvf-repack-format.md §3/§4）
const DECODE_GBK = new TextDecoder("gbk");
const DECODE_SJIS_STRICT = new TextDecoder("shift_jis", { fatal: true });
const KANA_WIDE_RE = /[\u3041-\u30ff]/;

// 魔数探测：27 字节内可无歧义判定（明文魔数与官方加密 PVF 头部不重叠）
function repackSniff(buffer) {
    if (!buffer) return false;
    const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (b.length < REPACK_HEADER_SIZE) return false;
    for (let i = 0; i < REPACK_MAGIC.length; i++) {
        if (b[i] !== REPACK_MAGIC[i]) return false;
    }
    return true;
}

export class RepackPvfArchive {
    constructor(buffer) {
        this.buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        this.files = [];
        this.header = null;
        this._tree = null; // 解密后的文件树字节（副本，不改原归档）
        this._bodyBase = 0; // 数据区起点（REPACK_HEADER_SIZE + treeLength）
        this._pathIndex = null;
        this._nameIndex = null;
        this._nameTagCache = new Map();
        this._itemMetaCache = new Map();
        this._lstTextCache = new Map();
        this._lstNameMapCache = new Map();
        this._lstRefMap = new Map();
    }

    static sniff(buffer) {
        return repackSniff(buffer);
    }

    // ---- 只读不变式（编辑回写未实现）----

    get headerFormat() {
        return PvfFormat.REPACK;
    }

    get headerFormatLabel() {
        return "60CN";
    }

    get fileCount() {
        return this.header ? this.header.fileCount : 0;
    }

    get strEncoding() {
        return "gbk";
    }

    get hasChanges() {
        return false;
    }

    // 兼容 PvfArchive：重打包归档无 GRPI 分组
    get groups() {
        return [];
    }

    // 无分块：bodySize = 全部文件明文数据字节
    get bodySize() {
        let s = 0;
        for (const f of this.files) {
            if (!f.isDir) s += f.dataSize;
        }
        return s;
    }

    get modifiedCount() {
        return 0;
    }

    get deletedCount() {
        return 0;
    }

    get renamedCount() {
        return 0;
    }

    // ---- 编辑器消费的修改类查询（只读层恒为空态，对齐 TwPvfArchive 安全禁用语义）----

    isFileModified() {
        return false;
    }

    isFileDeleted() {
        return false;
    }

    isFileRenamed() {
        return false;
    }

    async getStrNameMap() {
        return new Map();
    }

    // 编辑展示入口：归档内为明文文本，与 decodeContent 一致（无 token 流无缩进重排）
    decodeContentForEdit(file, data) {
        return this.decodeContent(file, data);
    }

    // ---- 修改类操作显式拒绝（只读边界，docs/pvf-repack-format.md §4）----
    // 组件层右键菜单已对只读归档隐藏修改类入口；以下为防御性兜底，抛错经
    // 调用点既有 catch 弹窗反馈。

    setFileContent() {
        this._rejectWrite();
    }

    setFileRawData() {
        this._rejectWrite();
    }

    deleteFile() {
        this._rejectWrite();
    }

    async renameFile() {
        this._rejectWrite();
    }

    async renameFolder() {
        this._rejectWrite();
    }

    async saveAs() {
        this._rejectWrite();
    }

    _rejectWrite() {
        throw new Error("该归档为重打包格式（60CN），为只读展示层，暂不支持修改与保存导出。");
    }

    // 撤销 / 引用修复 / 编码切换：无修改态下安全空操作（对齐 TwPvfArchive 禁用语义）
    revertFile() {}

    revertAll() {}

    undeleteFile() {}

    setEncoding() {}

    buildPathMappings() {
        return [];
    }

    async findReferencesMulti() {
        return [];
    }

    async fixReferences() {
        return 0;
    }

    // ---- 解析 ----

    async parse() {
        if (!repackSniff(this.buf)) {
            throw new Error("该文件不是有效的重打包归档（归档魔数不匹配）。");
        }
        const treeLength = readInt32LE(this.buf, 15);
        const treeChecksum = readUInt32LE(this.buf, 19);
        const fileCount = readUInt32LE(this.buf, 23);
        if (treeLength <= 0 || treeLength % 4 !== 0 || REPACK_HEADER_SIZE + treeLength > this.buf.length) {
            throw new Error("重打包归档头部树区参数非法（长度或对齐异常）。");
        }
        if (fileCount <= 0 || fileCount > 0x7fffffff) {
            throw new Error("重打包归档头部文件总数非法。");
        }

        // 树区解密（副本）：密钥 = 头部树区校验值
        const tree = this.buf.slice(REPACK_HEADER_SIZE, REPACK_HEADER_SIZE + treeLength);
        pvfDecryptRepack(tree, treeChecksum);
        this._tree = tree;
        this._bodyBase = REPACK_HEADER_SIZE + treeLength;

        // 条目流：每条目 5 × 4 字节字段 + 路径字节（路径编码 EUC-KR，对齐消费端 949 语义）
        this.files = [];
        let idx = 0;
        for (let i = 0; i < fileCount; i++) {
            if (idx + 20 > treeLength) throw new Error(`重打包归档文件树条目 ${i} 头部越界`);
            const fileNumber = readUInt32LE(tree, idx);
            const dataOffset = readUInt32LE(tree, idx + 4);
            const dataSize = readInt32LE(tree, idx + 8);
            const checksum = readUInt32LE(tree, idx + 12);
            const pathLen = readInt32LE(tree, idx + 16);
            idx += 20;
            if (dataSize < 0 || pathLen <= 0 || idx + pathLen > treeLength) {
                throw new Error(`重打包归档文件树条目 ${i} 字段异常`);
            }
            if (this._bodyBase + dataOffset + ((dataSize + 3) & ~3) > this.buf.length) {
                throw new Error(`重打包归档条目 ${i} 数据区越界`);
            }
            const nameBytes = tree.subarray(idx, idx + pathLen);
            idx += pathLen;
            const name = decodeText(nameBytes, "euc-kr").replace(/\0+$/g, "").replace(/\\/g, "/").toLowerCase();
            this.files.push({
                name,
                path: "",
                nameOff: -1,
                pathOff: -1,
                chunkIndex: -1,
                dataOffset,
                dataSize,
                checksum,
                nameHash: fileNumber,
                dataType: 0,
                index: i,
                isDir: false,
                fullpath: name
            });
        }
        if (this.files.length !== fileCount) {
            throw new Error("重打包归档文件树条目数与头部不一致");
        }
        this.header = {
            fileCount,
            treeLength,
            treeChecksum,
            bodyOffset: this._bodyBase,
            groupCount: 0
        };
        return this.header;
    }

    // ---- 数据读取 ----

    _decodeFileBytes(file) {
        if (file.isDir || file.dataSize <= 0) return new Uint8Array(0);
        const padded = (file.dataSize + 3) & ~3;
        const start = this._bodyBase + file.dataOffset;
        if (start + padded > this.buf.length) throw new Error(`条目 ${file.fullpath} 数据区越界`);
        const data = this.buf.slice(start, start + padded);
        pvfDecryptRepack(data, file.checksum);
        return data.slice(0, file.dataSize);
    }

    async getFileData(file) {
        if (!file || file.isDir) return new Uint8Array(0);
        return this._decodeFileBytes(file);
    }

    async getFilesData(files) {
        const result = new Array(files.length).fill(null);
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir) continue;
            result[i] = this._decodeFileBytes(f);
        }
        return result;
    }

    // ---- 解码 ----

    // 归档内非 .str 文件固定 GBK（lst/stk/eqp 基线验证一致，docs/pvf-repack-format.md §3）。
    // .str 文件两级判定：文件级探测（EUC-KR 韩文文件 vs GBK 主导文件）+
    // GBK 主导文件的行级 SJIS 日文行修正（_decodeStrLines）。
    decodeContent(file, data) {
        if (!data || data.length === 0) return "";
        const isStr = !!(file && file.name && /\.str$/i.test(file.name));
        if (!isStr) return decodeText(data, "gbk");
        if (this._detectStrEncoding(data, file.name) === "euc-kr") return decodeText(data, "euc-kr");
        return this._decodeStrLines(data);
    }

    // 文件级探测：前 16KB 采样严格解码（GBK 中文字节在 EUC-KR 严格下整文件采样必然失败，
    // 反之 EUC-KR 韩文文件 GBK 严格也成功，故先 EUC-KR 后 GBK 顺序不可颠倒）。
    // 双失败（混合/局部损坏）按 .kor.str 后验走 EUC-KR（韩文主体，坏字节 U+FFFD）。
    _detectStrEncoding(data, name) {
        let n = Math.min(data.length, 16384);
        // 残半检测：从头按「≥0x81 即双字节首字节」配对扫描，若采样末尾恰好停在首字节上
        // （残半）则回退 1 字节；不能盲目对末字节 ≥0x81 回退——合法双字节的尾字节同样 ≥0x81
        if (n > 0 && data[n - 1] >= 0x81) {
            let paired = 0;
            while (paired < n) {
                if (data[paired] >= 0x81) paired += 2;
                else paired++;
            }
            if (paired > n) n--; // 末字节确为残半首字节
        }
        const sample = data.subarray(0, n);
        try {
            new TextDecoder("euc-kr", { fatal: true }).decode(sample);
            return "euc-kr";
        } catch {
            // EUC-KR 严格失败 → 非 EUC-KR 韩文文件
        }
        try {
            new TextDecoder("gbk", { fatal: true }).decode(sample);
            return "gbk";
        } catch {
            // 双失败：混合或局部损坏，按后缀先验
        }
        return /\.kor\.str$/i.test(name) ? "euc-kr" : "gbk";
    }

    // GBK 主导 .str 的行级 SJIS 日文行修正（docs/pvf-repack-format.md §3/§4）：
    // SJIS 严格成功且文本含全角假名 → 日文行；含 GBK 扩展区字符 → 纯汉字日文行；
    // 其余行（含顶部 GBK 中文翻译行）按 GBK。
    // 不做行级 EUC-KR 判定：GBK 中文字节与 EUC-KR 谚文区（0xB0A1–0xC8FE）重叠，
    // 「含谚文」会把 GBK 中文行误判为韩文行（回归教训，见 §3 行级边界）。
    _decodeStrLines(data) {
        let start = 0;
        const out = [];
        for (let i = 0; i <= data.length; i++) {
            if (i !== data.length && data[i] !== 0x0a) continue;
            let line = data.subarray(start, i);
            start = i + 1;
            let cr = "";
            if (line.length && line[line.length - 1] === 0x0d) {
                line = line.subarray(0, line.length - 1);
                cr = "\r";
            }
            if (i === data.length && line.length === 0 && out.length > 0) break;
            out.push(this._decodeStrLine(line) + cr);
        }
        return out.join("\n");
    }

    _decodeStrLine(line) {
        if (!line.some(b => b >= 0x80)) return DECODE_GBK.decode(line);
        try {
            const jp = DECODE_SJIS_STRICT.decode(line);
            if (KANA_WIDE_RE.test(jp)) return jp;
            if (this._hasGbkExtendedChar(jp)) return jp;
        } catch {
            // SJIS 严格失败，回退 GBK
        }
        return DECODE_GBK.decode(line);
    }

    // GBK 扩展区字符判定：字符 re-encode GBK 后双字节首字节落在 0x81–0xA0
    // （GB2312 常用汉字 / 符号区不含，SJIS→GBK 误解字符的集中区）
    _hasGbkExtendedChar(text) {
        const bytes = encodeGBK(text);
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b >= 0x81 && b <= 0xa0) return true;
            if (b >= 0x81) i++;
        }
        return false;
    }

    decodeLst(data) {
        return this.decodeContent(null, data);
    }

    isLstFile(file) {
        return !!(file && file.name && /\.lst$/i.test(file.name));
    }

    _normalizeLines(text) {
        return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    _buildPathIndex() {
        if (this._pathIndex) return this._pathIndex;
        const idx = new Map();
        const nameIdx = new Map();
        for (const f of this.files) {
            if (f.isDir || !f.fullpath) continue;
            // 匹配统一用小写 key（原路径已规范化为小写，此处保持与引用路径大小写无关）
            idx.set(f.fullpath.toLowerCase(), f);
            const key = f.name.toLowerCase();
            if (!nameIdx.has(key)) nameIdx.set(key, []);
            nameIdx.get(key).push(f);
        }
        this._pathIndex = idx;
        this._nameIndex = nameIdx;
        return idx;
    }

    // ---- 名称 / 元数据（全文文本路径）----

    _extractNameFromData(file, data) {
        if (!data || data.length === 0) return "";
        // 60CN 明文形态 [name] \`xxx\` 标签与值同行，extractNameFromText（标签独行语义）取不到，
        // 用 _repackTagFromText 提取后剥反引号，对齐既有名称语义
        const res = this._repackTagFromText(this.decodeContent(file, data), "name");
        if (!res || res.value == null) return "";
        const s = String(res.value);
        const m = /^`((?:[^`]|``)*)`$/.exec(s);
        return m ? m[1].replace(/``/g, "`") : s;
    }

    async extractNameTag(file) {
        if (!file || file.isDir) return "";
        if (this._nameTagCache.has(file.index)) return this._nameTagCache.get(file.index);
        let name = "";
        try {
            const data = await this.getFileData(file);
            name = this._extractNameFromData(file, data);
        } catch {
            name = "";
        }
        this._nameTagCache.set(file.index, name);
        return name;
    }

    async extractNameTags(files) {
        const names = new Array(files.length).fill("");
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || f.isDir) continue;
            if (this._nameTagCache.has(f.index)) {
                names[i] = this._nameTagCache.get(f.index);
                continue;
            }
            let name = "";
            try {
                name = this._extractNameFromData(f, await this.getFileData(f));
            } catch {
                name = "";
            }
            this._nameTagCache.set(f.index, name);
            names[i] = name;
        }
        return names;
    }

    // .lst 增强解码：行尾追加引用文件的 [name] 标签值（对齐 PvfArchive.decodeLstWithNames）。
    // 60CN 明文 lst 条目行自带行尾官方名称注释（`1 \t\`coin.stk\` \t\t// 复活币`），
    // 行解析须兼容该形态以建立引用映射；追加名称与注释正文相同时去重跳过。
    async decodeLstWithNames(file) {
        const cached = this._lstTextCache.get(file.index);
        if (cached != null) return cached;
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
        for (const line of lines) {
            const m = /^(\d+)\s+`([^`]*)`(?:\s+\/\/(.*))?$/.exec(line.trim());
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
                rows.push({ line, target: null });
                continue;
            }
            let refMap = this._lstRefMap.get(file.index);
            if (!refMap) {
                refMap = new Map();
                this._lstRefMap.set(file.index, refMap);
            }
            refMap.set(m[2], target);
            rows.push({ line, target, comment: m[3] ? m[3].trim() : "" });
            pending.set(target.index, target);
        }
        const targets = [...pending.values()];
        await this.extractNameTags(targets);
        const nameRows = new Map();
        const out = rows.map(({ line, target, comment }, lineNo) => {
            if (!target) return line;
            const name = this._nameTagCache.get(target.index) || "";
            if (name && !/[\n\r`{}#]/.test(name) && name !== comment) {
                nameRows.set(lineNo, name);
                return `${line.trim()} ${name}`;
            }
            return line.trim();
        });
        const result = this._normalizeLines(out.join("\n"));
        this._lstTextCache.set(file.index, result);
        this._lstNameMapCache.set(file.index, nameRows);
        return result;
    }

    getLstRefTarget(file, ref) {
        if (!file || ref == null) return null;
        const map = this._lstRefMap.get(file.index);
        return map ? map.get(ref) || null : null;
    }

    // 返回 decodeLstWithNames 追加的引用文件名称映射（行号 -> 名称原文）
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
            // 60CN 条目行尾自带官方名称注释（`// 复活币`），剥离注释前缀取正文作展示名
            const name = m[3] ? m[3].trim().replace(/^\/\/\s*/, "") : "";
            items.push({ code: m[1], ref: m[2].replace(/``/g, "`"), name });
        }
        return items;
    }

    // ---- 物品元数据（ItemCodeView 品质 / 等级 / 类型 / 期限筛选，对齐 TwPvfArchive.listLstItemMeta）----

    // 60CN 明文文本的标签提取：与 token 解码文本（标签独占一行）不同，明文形态多为
    // 「[tag] 参数...」同行（如 `[rarity] 2`、`[stackable type] \`[recipe]\` 1`），
    // 也存在块标签独占一行（如 `[random option]`、`[usable job]`）。
    // 返回 { raw, value, closed }：value 为首个参数（同行剩余或首个内容行）；不存在返回 null。
    _repackTagFromText(text, tag) {
        if (!text) return null;
        const lines = String(text).split("\n");
        const open = "[" + String(tag).toLowerCase() + "]";
        const close = "[/" + String(tag).toLowerCase() + "]";
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lower = line.toLowerCase();
            if (!lower.startsWith(open)) continue;
            // 标签边界：open 之后必须紧跟空白或行尾（避免 [name] 命中 [name2]）
            const after = lower.slice(open.length);
            if (after && !/^\s/.test(after)) continue;
            const rest = line.slice(open.length).trim();
            if (rest) return { raw: [rest], value: rest, closed: false };
            // 独行形态：收集后续行至闭合标签或下一个标签行
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
            return { raw, value: raw.length ? raw[0] : null, closed };
        }
        return null;
    }

    _tagIntValue(text, tag) {
        const res = this._repackTagFromText(text, tag);
        if (!res || res.value == null) return null;
        if (typeof res.value === "number") return res.value;
        const m = /^(\d+)/.exec(String(res.value));
        return m ? parseInt(m[1], 10) : null;
    }

    _tagStringValue(text, tag) {
        const res = this._repackTagFromText(text, tag);
        if (!res || res.value == null) return null;
        return String(res.value);
    }

    // 字段结构对齐 TwPvfArchive._metaFromText（ItemCodeView 直接消费，见 docs/pvf-item-grant-parsing.md）
    _metaFromText(text) {
        return {
            rarity: this._tagIntValue(text, "rarity"),
            minLevel: this._tagIntValue(text, "minimum level"),
            equipType: this._tagStringValue(text, "equipment type"),
            stackableType: this._tagStringValue(text, "stackable type"),
            itemCategory: this._tagStringValue(text, "item category"),
            hasRandomOption: this._repackTagFromText(text, "random option") != null,
            usablePeriod: this._tagIntValue(text, "usable period"),
            expirationDate: this._tagStringValue(text, "expiration date"),
            dailyDelete: this._tagIntValue(text, "daily delete item")
        };
    }

    _resolveItemMetaFromData(file, data) {
        if (!data || data.length === 0) return null;
        return this._metaFromText(this.decodeContent(file, data));
    }

    async listLstItemMeta(lstFile, items) {
        const map = this._lstRefMap.get(lstFile.index) || new Map();
        const metas = new Array(items.length).fill(null);
        for (let i = 0; i < items.length; i++) {
            const target = map.get(items[i].ref) || map.get(items[i].ref.replace(/`/g, "``"));
            if (!target) continue;
            const cached = this._itemMetaCache.get(target.index);
            if (cached !== undefined) {
                metas[i] = cached;
            } else {
                let meta = null;
                try {
                    meta = this._resolveItemMetaFromData(target, await this.getFileData(target));
                } catch {
                    meta = null;
                }
                this._itemMetaCache.set(target.index, meta);
                metas[i] = meta;
            }
        }
        return metas;
    }

    // ---- 导出 ----

    // 导出契约与 PvfArchive.exportFile / TwPvfArchive.exportFile 一致：{ filename, blob, size }。
    // 归档内全部为明文文本，统一按 UTF-8 文本落盘（无二进制回退形态）。
    async exportFile(file) {
        if (!file || file.isDir) return null;
        const data = await this.getFileData(file);
        if (!data) return null;
        const filename = sanitizeFilename(file.name || file.fullpath || "export");
        const text = this.decodeContent(file, data);
        return { filename, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), size: text.length };
    }
}
