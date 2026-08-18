// ============================================================
//  PVF Codec — 底层加解密、压缩解压、二进制读写与分区字节组装
//  独立于 PvfArchive，可在任何需要解析/重建 PVF 二进制格式的地方复用
// ============================================================

// ---- 解密类型枚举 ----
const PvfFormat = Object.freeze({
    ORIGINAL: "original", // 原版 PVF 包头（无 Guard 加密）
    GUARD: "guard" // Guard 包头（第 24~27 字节 0x55 XOR）
});

// 枚举值 → 显示标签（后续新增格式只需在此追加映射）
const PvfFormatLabels = Object.freeze({
    [PvfFormat.ORIGINAL]: "JP",
    [PvfFormat.GUARD]: "JPAG"
});

// 默认优先尝试的解析格式（original 优先，兼容大多数原版 PVF 文件）
const PvfFormatDefault = PvfFormat.ORIGINAL;

// ---- 魔数常量 ----
const MAGIC_DECRYPT = 0x269ec3;
const MAGIC_DECRYPT2 = 0x269ec9;

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
 * 压缩并加密一个 body 块（compress → encrypt "BodY"）
 */
async function encodeBodyChunk(chunk) {
    const compressed = await zlibCompress(chunk);
    const encrypted = new Uint8Array(compressed);
    pvfDecrypt("BodY", encrypted, MAGIC_DECRYPT);
    return encrypted;
}

/**
 * 压缩并加密一个 name 表分区（compress → encrypt key → 封装 8 字节头）
 * @param {string} key      "sTrA" 或 "sTrW"
 * @param {Uint8Array} rawBuffer  原始数据
 * @param {number} xorConst  0xaa74472e（sTrA）或 0x9a82f037（sTrW）
 */
async function encodeNameSection(key, rawBuffer, xorConst) {
    if (!rawBuffer || rawBuffer.length === 0) {
        rawBuffer = key === "sTrW" ? new Uint8Array([0, 0]) : new Uint8Array([0]);
    }
    const compressed = await zlibCompress(rawBuffer);
    const encrypted = new Uint8Array(compressed);
    pvfDecrypt(key, encrypted, MAGIC_DECRYPT2);

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
    readInt32LE,
    readUInt32LE,
    writeInt32LE,
    mergeChunks,
    pvfDecrypt,
    pvfDecryptGuard,
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
