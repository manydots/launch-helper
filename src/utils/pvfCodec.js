// ============================================================
//  PVF Codec — 底层加解密、压缩解压、二进制读写与分区字节组装
//  独立于 PvfArchive，可在任何需要解析/重建 PVF 二进制格式的地方复用
// ============================================================

// ---- 解密类型枚举 ----
const PvfFormat = Object.freeze({
    ORIGINAL: "original", // 原版 PVF 包头（无 Guard 加密）
    GUARD: "guard", // Guard 包头（第 24~27 字节 0x55 XOR）
    PROTECTED: "protected", // 新版 protected_nkpi（UTF-16 seed 密钥流）
    TW: "tw" // 繁体台服归档（ROR6 ^ key ^ checksum，无压缩）
});

// 枚举值 → 显示标签（后续新增格式只需在此追加映射）
const PvfFormatLabels = Object.freeze({
    [PvfFormat.ORIGINAL]: "JP",
    [PvfFormat.GUARD]: "JPAG",
    [PvfFormat.PROTECTED]: "CN",
    [PvfFormat.TW]: "TW"
});

// 默认优先尝试的解析格式（original 优先，兼容大多数原版 PVF 文件）
const PvfFormatDefault = PvfFormat.ORIGINAL;

// ---- 魔数常量 ----
const MAGIC_DECRYPT = 0x269ec3;
const MAGIC_DECRYPT2 = 0x269ec9;

// ---- 繁体 TW 格式常量（协议见 docs/pvf-tw-format.md）----
const TW_DECRYPT_KEY = 0x81a79011; // 文件树与文件数据共用（加密/解密同 key）
const TW_TAIL_MARKER = new Uint8Array([0, ...Array.from("This pvf Pack was created by pvfUtility.", c => c.charCodeAt(0))]); // 42 字节尾部标记（部分台服工具保存时附加，文件内真实字节）

// ---- 二进制读写辅助 ----

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

/**
 * 合并多个 Uint8Array 为一个
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
function mergeChunks(chunks) {
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const result = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) {
        result.set(c, off);
        off += c.length;
    }
    return result;
}

// ---- PVF 解密 ----

/**
 * PVF 主解密（PRNG XOR，适用于 HeaD / BodY / GRPI / HASH 等字段）
 * @param {string} key   解密密钥（至少 4 个 ASCII 字符）
 * @param {Uint8Array} buf  待解密数据（原地修改）
 * @param {number} magic    魔数（MAGIC_DECRYPT 或 MAGIC_DECRYPT2）
 * @returns {number} 尾部字节数
 */
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

/**
 * Guard 格式额外解密：对 PVF 头部第 24~27 字节做 0x55 XOR
 * @param {Uint8Array} buf  待解密数据（至少 28 字节，原地修改）
 */
function pvfDecryptGuard(buf) {
    if (buf.length < 28) return;
    for (let i = 24; i < 28; i++) buf[i] ^= 0x55;
}

/**
 * 新版 protected_nkpi 解密（UTF-16 seed 密钥流，复刻新版客户端的
 * protected_nkpi 归档算法：seed 由 key 的 UTF-16 码元生成，常量 0x339E9711/0x393，
 * 用于 header("hEAd")、GRPI("grpi")、body("bODy")、字符串池("StRa"/"StRw") 解密。
 * @param {string} key   解密密钥（至少 4 个 UTF-16 码元）
 * @param {Uint8Array} buf  待解密数据（原地修改）
 * @param {number} magic    魔数（MAGIC_DECRYPT 或 MAGIC_DECRYPT2）
 * @returns {number} 尾部字节数
 */
function pvfDecryptProtected(key, buf, magic) {
    const k = [];
    for (let i = 0; i < key.length; i++) k.push(key.charCodeAt(i));
    if (k.length < 4) return 0;
    const len = buf.length;
    let tail = len;

    let seed = (Math.imul(0x339e9711, k[0]) + Math.imul(0x393, (k[3] + Math.imul(0x393, (k[2] + Math.imul(0x393, k[1])) | 0)) | 0)) | 0;

    if (len >= 4) {
        const quadCount = len >>> 2;
        tail = len - (quadCount << 2);
        for (let i = 0; i < quadCount; i++) {
            const t1 = (Math.imul(0x343fd, seed) + magic) | 0;
            seed = (Math.imul(0x343fd, t1) + magic) | 0;
            const xorKey = ((t1 & 0xffff0000) + (seed >>> 16)) >>> 0;
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
        const finalKey = ((t1 & 0xffff0000) + (t2 >>> 16)) >>> 0;
        const kb = [finalKey & 0xff, (finalKey >>> 8) & 0xff, (finalKey >>> 16) & 0xff, (finalKey >>> 24) & 0xff];
        const start = len - tail;
        for (let i = 0; i < tail; i++) buf[start + i] ^= kb[i];
    }
    return tail;
}

// ---- 繁体 TW 解密（逐 4 字节 ROR6 ^ key ^ checksum）----

/**
 * 繁体台服 PVF 解密：
 *   解密：ROR6(dword ^ key ^ checksum)；加密：ROL6(dword) ^ checksum ^ key
 * 文件树与文件数据共用该算法，仅 key（固定 0x81A79011）与 checksum（各自生成）不同。
 * 注意：数据按 4 字节对齐（TrueLen = (DataLen + 3) & ~3），调用方需先补齐再调用。
 * @param {Uint8Array} buf  待解密数据（原地修改）
 * @param {number} key     常量 TW_DECRYPT_KEY
 * @param {number} checksum 该块校验和（文件树 = CreateBuffKey(tree, treeLen, fileCount)；
 *                          文件数据 = CreateBuffKey(data, TrueLen, 文件名哈希)）
 */
function pvfDecryptTw(buf, key, checksum) {
    const len = buf.length & ~3;
    for (let i = 0; i < len; i += 4) {
        const dw = (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
        const r = ((dw ^ key ^ checksum) >>> 6) | ((dw ^ key ^ checksum) << 26);
        buf[i] = r & 0xff;
        buf[i + 1] = (r >>> 8) & 0xff;
        buf[i + 2] = (r >>> 16) & 0xff;
        buf[i + 3] = (r >>> 24) & 0xff;
    }
}

/**
 * 繁体 TW 加密（pvfDecryptTw 的逆方向）：逐 4 字节 ROL6(dword) ^ checksum ^ key。
 * 保存重建时用；其余协议见 pvfDecryptTw 注释。
 * @param {Uint8Array} buf  明文数据（原地修改为密文）
 * @param {number} key     常量 TW_DECRYPT_KEY
 * @param {number} checksum 该块校验和（与解密使用的同一 checksum）
 */
function pvfEncryptTw(buf, key, checksum) {
    const len = buf.length & ~3;
    for (let i = 0; i < len; i += 4) {
        const dw = (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
        const r = (((dw << 6) | (dw >>> 26)) ^ key ^ checksum) >>> 0;
        buf[i] = r & 0xff;
        buf[i + 1] = (r >>> 8) & 0xff;
        buf[i + 2] = (r >>> 16) & 0xff;
        buf[i + 3] = (r >>> 24) & 0xff;
    }
}

/**
 * 繁体 TW 文件名哈希（GetFileNameHashCode）：
 *   hash = 0x1505; 逐字节 hash = 0x21 * hash + byte（uint 环绕）；再 hash *= 0x21
 * @param {Uint8Array} bytes  文件名编码字节
 * @returns {number} uint32 哈希
 */
function twFileNameHash(bytes) {
    let h = 0x1505;
    for (let i = 0; i < bytes.length; i++) {
        h = (Math.imul(0x21, h) + bytes[i]) >>> 0;
    }
    return Math.imul(0x21, h) >>> 0;
}

/**
 * 繁体 TW 数据校验（CreateBuffKey，CRC32 变体）：
 *   crc = ~文件名哈希；逐字节 crc = (crc >> 8) ^ table[(crc ^ b) & 0xFF]；return ~crc
 * @param {Uint8Array} bytes  明文数据（TrueLen，4 对齐）
 * @param {number} fileNameHash  文件名哈希（twFileNameHash 结果）
 * @returns {number} uint32 校验和
 */
function twCreateBuffKey(bytes, fileNameHash) {
    let crc = ~fileNameHash >>> 0;
    for (let i = 0; i < bytes.length; i++) {
        const t = (crc ^ bytes[i]) & 0xff;
        crc = (crc >>> 8) ^ TW_CRC_TABLE[t];
    }
    return ~crc >>> 0;
}

// CRC32 表（多项式 0xEDB88320），懒构建
let TW_CRC_TABLE = null;
function _ensureTwCrcTable() {
    if (TW_CRC_TABLE) return;
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    TW_CRC_TABLE = t;
}
_ensureTwCrcTable();

// ---- Zlib 压缩 / 解压（via CompressionStream）----

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

// ---- PVF 分区字节组装（导出用）----

/**
 * 编码单条文件表条目（24 字节）
 */
function encodeFileTableEntry(item) {
    const buf = new Uint8Array(0x18);
    writeInt32LE(buf, 0, item.nameOff);
    writeInt32LE(buf, 4, item.pathOff);
    writeInt32LE(buf, 8, item.chunkIndex);
    writeInt32LE(buf, 12, item.dataOffset);
    writeInt32LE(buf, 16, item.dataSize);
    writeInt32LE(buf, 20, item.dataType);
    return buf;
}

/**
 * 编码完整文件表（items 数组 → 字节数组）
 */
function encodeFileTable(items) {
    const buf = new Uint8Array(items.length * 0x18);
    for (let i = 0; i < items.length; i++) {
        const off = i * 0x18;
        writeInt32LE(buf, off, items[i].nameOff);
        writeInt32LE(buf, off + 4, items[i].pathOff);
        writeInt32LE(buf, off + 8, items[i].chunkIndex);
        writeInt32LE(buf, off + 12, items[i].dataOffset);
        writeInt32LE(buf, off + 16, items[i].dataSize);
        writeInt32LE(buf, off + 20, items[i].dataType);
    }
    return buf;
}

/**
 * 编码 GRPI 分组表（不含加密，加密由调用方完成）
 */
function encodeGrpiTable(groups) {
    const buf = new Uint8Array(groups.length * 8);
    for (let i = 0; i < groups.length; i++) {
        writeInt32LE(buf, i * 8, groups[i].compressedSize);
        writeInt32LE(buf, i * 8 + 4, groups[i].originalSize);
    }
    return buf;
}

/**
 * 组装 PVF 头部原始字节（不含加密，加密由调用方完成）
 */
function encodeHeaderRaw({ signature, guid, fileCount, padding, bodySize, groupCount, hashTableSize, nameTableSize }) {
    const buf = new Uint8Array(0x30);
    writeInt32LE(buf, 0, signature);
    buf.set(guid, 4);
    writeInt32LE(buf, 24, fileCount);
    writeInt32LE(buf, 28, padding);
    writeInt32LE(buf, 32, bodySize);
    writeInt32LE(buf, 36, groupCount);
    writeInt32LE(buf, 40, hashTableSize);
    writeInt32LE(buf, 44, nameTableSize);
    return buf;
}

/**
 * 压缩并加密一个 body 块（compress → encrypt "BodY" / "bODy"）
 * @param {Uint8Array} chunk  明文数据
 * @param {boolean} [useProtected]  true 用 protected_nkpi 算法（新版），默认旧算法
 */
async function encodeBodyChunk(chunk, useProtected = false) {
    const compressed = await zlibCompress(chunk);
    const encrypted = new Uint8Array(compressed);
    if (useProtected) pvfDecryptProtected("bODy", encrypted, MAGIC_DECRYPT);
    else pvfDecrypt("BodY", encrypted, MAGIC_DECRYPT);
    return encrypted;
}

/**
 * 压缩并加密一个 name 表分区（compress → encrypt key → 封装 8 字节头）
 * @param {string} key      "sTrA" 或 "sTrW"（protected 格式为 "StRa" / "StRw"）
 * @param {Uint8Array} rawBuffer  原始数据
 * @param {number} xorConst  0xaa74472e（sTrA）或 0x9a82f037（sTrW）
 * @param {boolean} [useProtected]  true 用 protected_nkpi 算法（新版），默认旧算法
 */
async function encodeNameSection(key, rawBuffer, xorConst, useProtected = false) {
    if (!rawBuffer || rawBuffer.length === 0) {
        rawBuffer = key === "sTrW" ? new Uint8Array([0, 0]) : new Uint8Array([0]);
    }
    const compressed = await zlibCompress(rawBuffer);
    const encrypted = new Uint8Array(compressed);
    if (useProtected) pvfDecryptProtected(key, encrypted, MAGIC_DECRYPT2);
    else pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);

    const section = new Uint8Array(8 + encrypted.length);
    writeInt32LE(section, 0, (encrypted.length ^ xorConst) | 0);
    writeInt32LE(section, 4, (rawBuffer.length ^ encrypted.length) | 0);
    section.set(encrypted, 8);
    return section;
}

/**
 * 解码一个 name 表分区（解封装 8 字节头 → decrypt → decompress）
 * @param {Uint8Array} bytes  完整 name 表字节
 * @param {number} idx  当前读取位置（会就地推进）
 * @param {string} key  "sTrA" 或 "sTrW"
 * @param {number} xorConst  对应 XOR 常量
 * @returns {{ decrypted: Uint8Array, nextIdx: number } | null}
 */
function decodeNameSection(bytes, idx, key, xorConst) {
    if (idx + 8 > bytes.length) return null;
    const cnt1 = readInt32LE(bytes, idx);
    const encSize = (cnt1 ^ xorConst) | 0;
    if (encSize <= 0 || idx + 8 + encSize > bytes.length) return null;
    const encrypted = bytes.slice(idx + 8, idx + 8 + encSize);
    pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);
    return { encrypted, nextIdx: idx + 8 + encSize };
}

export {
    PvfFormat,
    PvfFormatLabels,
    PvfFormatDefault,
    MAGIC_DECRYPT,
    MAGIC_DECRYPT2,
    TW_DECRYPT_KEY,
    TW_TAIL_MARKER,
    readInt32LE,
    readUInt32LE,
    writeInt32LE,
    mergeChunks,
    pvfDecrypt,
    pvfDecryptGuard,
    pvfDecryptProtected,
    pvfDecryptTw,
    pvfEncryptTw,
    twFileNameHash,
    twCreateBuffKey,
    zlibCompress,
    zlibDecompress,
    encodeFileTableEntry,
    encodeFileTable,
    encodeGrpiTable,
    encodeHeaderRaw,
    encodeBodyChunk,
    encodeNameSection,
    decodeNameSection
};
