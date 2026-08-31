// NPK 归档只读预览库（JP 格式）。
//
// 移植自权威 GM 工具 S4A21GmTool 的 ImagePack 模块（NpkNameCipher / NpkArchive /
// NpkImageDecoder / PngEncoder），格式规则见 docs/npk-format.md。
// 零第三方依赖：zlib 用浏览器原生 DecompressionStream("deflate")，PNG 编码手写。
//
// 加解密算法以注册表形式组织（NPK_FORMATS）。所有 NPK 使用同一套加解密格式：
// 魔数 `NeoplePack_Bill` + 条目名 XOR 密钥。

const NPK_MAGIC_JP = "NeoplePack_Bill";

// 条目名 256 字节 XOR：前缀 "puchikon@neople dungeon and fighter "，其后循环填充 "DNF"。
function createNameKey() {
    const prefix = "puchikon@neople dungeon and fighter ";
    const key = new Uint8Array(256);
    for (let i = 0; i < prefix.length; i++) key[i] = prefix.charCodeAt(i) & 0xff;
    const dnf = "DNF";
    for (let i = prefix.length; i < 256; i++) key[i] = dnf.charCodeAt((i - prefix.length) % dnf.length) & 0xff;
    return key;
}
const NAME_KEY = createNameKey();

function decryptName(raw) {
    const n = Math.min(raw.length, NAME_KEY.length);
    const decoded = new Uint8Array(raw.length);
    for (let i = 0; i < n; i++) decoded[i] = raw[i] ^ NAME_KEY[i];
    for (let i = n; i < raw.length; i++) decoded[i] = raw[i];

    let end = decoded.indexOf(0);
    if (end < 0) end = decoded.length;
    let text = "";
    for (let i = 0; i < end; i++) text += String.fromCharCode(decoded[i]);
    text = text.replace(/\\/g, "/").trim();

    const img = text.toLowerCase().indexOf(".img");
    if (img >= 0) return text.substring(0, img + 4);

    // 遇到首个非法路径字符即截断
    let out = "";
    for (const ch of text) {
        if (/[A-Za-z0-9/_.-]/.test(ch)) out += ch;
        else break;
    }
    return out;
}

// 读取 DataView 安全助手
function readU32(view, offset) {
    return view.getUint32(offset, true);
}
function readI32(view, offset) {
    return view.getInt32(offset, true);
}

// JP 格式解析：校验魔数 + 条目表（每条 264 字节：offset/size/加密名）
function parseJp(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (buffer.byteLength < 20) throw new Error("NPK 文件过小");
    const magic = bytesToAscii(buffer, 0, 16).replace(/\0/g, "");
    if (!magic.startsWith(NPK_MAGIC_JP)) throw new Error(`不支持的 NPK 魔数：${magic || "(空)"}`);

    const count = readU32(view, 16);
    if (count <= 0 || count > 20000) throw new Error(`条目数异常：${count}`);
    const tableSize = count * 264;
    if (20 + tableSize > buffer.byteLength) throw new Error("NPK 条目表越界");

    const entries = [];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        const row = 20 + i * 264;
        const offset = readU32(view, row);
        const size = readU32(view, row + 4);
        if (offset < 0 || size <= 0 || offset + size > buffer.byteLength) continue;
        const nameBytes = buffer.subarray(row + 8, row + 264);
        const name = decryptName(nameBytes);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        entries.push({ name, offset, size });
    }
    if (!entries.length) throw new Error("NPK 无可解析条目");

    return { count: entries.length, entries };
}

// 加解密算法注册表。所有 NPK 使用同一套格式。
export const NPK_FORMATS = [{ id: "jp", label: "JP / TW", magic: NPK_MAGIC_JP, parse: parseJp }];

export function parseNpk(buffer, formatId = "jp") {
    const format = NPK_FORMATS.find(f => f.id === formatId) || NPK_FORMATS[0];
    return format.parse(buffer);
}

// 读取 NPK 条目的 IMG 帧索引（JP version 2）。
// 返回 { frames: [...] }，帧为 { type, compression, width, height, size,
// keyX, keyY, maxWidth, maxHeight, pixelOffset }；链接帧(0x11)跳过。
export function readImgEntry(buffer, entry) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (entry.size < 32) throw new Error("IMG 数据过小");
    const imgStart = entry.offset;
    const img = buffer.subarray(imgStart, imgStart + entry.size);
    if (bytesToAscii(img, 0, 15) !== "Neople Img File") throw new Error("条目数据不是 IMG 文件");

    const indexLength = readU32(view, imgStart + 16);
    const version = readU32(view, imgStart + 24);
    const frameCount = readU32(view, imgStart + 28);
    if (version !== 2 || frameCount <= 0 || frameCount > 100000) throw new Error(`不支持的 IMG 版本/帧数：v${version} frames=${frameCount}`);
    if (indexLength <= 0 || 32 + indexLength > entry.size) throw new Error("IMG 索引区越界");

    const frames = [];
    let pos = 32;
    let pixelCursor = 32 + indexLength;
    for (let i = 0; i < frameCount; i++) {
        if (pos + 4 > entry.size) throw new Error("IMG 帧索引越界");
        const type = readU32(view, imgStart + pos);
        if (type === 0x11) {
            // 链接帧：静态预览跳过
            pos += 8;
            continue;
        }
        if (pos + 36 > entry.size) throw new Error("IMG 像素帧索引越界");
        const compressed = readU32(view, imgStart + pos + 4);
        const width = readI32(view, imgStart + pos + 8);
        const height = readI32(view, imgStart + pos + 12);
        const size = readI32(view, imgStart + pos + 16);
        const keyX = readI32(view, imgStart + pos + 20);
        const keyY = readI32(view, imgStart + pos + 24);
        const maxWidth = readI32(view, imgStart + pos + 28);
        const maxHeight = readI32(view, imgStart + pos + 32);
        if (size < 0 || pixelCursor + size > entry.size) throw new Error("IMG 像素数据越界");
        frames.push({
            type,
            compression: compressed,
            width,
            height,
            size,
            keyX,
            keyY,
            maxWidth,
            maxHeight,
            pixelOffset: imgStart + pixelCursor
        });
        pos += 36;
        pixelCursor += size;
    }
    return { frames };
}

// zlib 解压（浏览器 DecompressionStream；Node 18+ 也原生支持）
async function inflate(raw) {
    if (typeof DecompressionStream === "undefined") throw new Error("当前环境不支持 DecompressionStream");
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out;
}

// 按像素格式解码帧数据为 RGBA
function decodePixels(frame, payload) {
    const need = frame.width * frame.height * (frame.type === 0x10 ? 4 : 2);
    if (payload.length < need) throw new Error("解压后数据长度不足");

    const out = new Uint8Array(frame.width * frame.height * 4);
    if (frame.type === 0x10) {
        // ARGB8888：BGRA -> RGBA（对齐 S4A21GmTool FromArgb8888）
        for (let i = 0, di = 0; i < need; i += 4) {
            out[di++] = payload[i + 2];
            out[di++] = payload[i + 1];
            out[di++] = payload[i];
            out[di++] = payload[i + 3];
        }
        return out;
    }
    for (let i = 0, di = 0; i < need; i += 2) {
        const pixel = payload[i] | (payload[i + 1] << 8);
        if (frame.type === 0x0e) {
            // ARGB1555
            out[di++] = scale5((pixel >> 10) & 0x1f);
            out[di++] = scale5((pixel >> 5) & 0x1f);
            out[di++] = scale5(pixel & 0x1f);
            out[di++] = pixel & 0x8000 ? 255 : 0;
        } else {
            // ARGB4444
            out[di++] = ((pixel >> 8) & 0x0f) * 17;
            out[di++] = ((pixel >> 4) & 0x0f) * 17;
            out[di++] = (pixel & 0x0f) * 17;
            out[di++] = ((pixel >> 12) & 0x0f) * 17;
        }
    }
    return out;
}

function scale5(v) {
    return ((v * 255) / 31) | 0;
}

// 带 keyX/keyY/maxWidth/maxHeight 的画布 Blit（alpha 混合，对齐 S4A21GmTool Blit）
function blit(dest, destW, destH, src, srcW, srcH, x, y) {
    for (let row = 0; row < srcH; row++) {
        const dy = y + row;
        if (dy < 0 || dy >= destH) continue;
        for (let col = 0; col < srcW; col++) {
            const dx = x + col;
            if (dx < 0 || dx >= destW) continue;
            const si = (row * srcW + col) * 4;
            const alpha = src[si + 3];
            if (alpha === 0) continue;
            const di = (dy * destW + dx) * 4;
            if (alpha === 255) {
                dest[di] = src[si];
                dest[di + 1] = src[si + 1];
                dest[di + 2] = src[si + 2];
                dest[di + 3] = 255;
                continue;
            }
            const destAlpha = dest[di + 3];
            const outAlpha = (alpha + (destAlpha * (255 - alpha)) / 255) | 0;
            if (outAlpha === 0) continue;
            dest[di] = ((src[si] * alpha + (dest[di] * destAlpha * (255 - alpha)) / 255) / outAlpha) | 0;
            dest[di + 1] = ((src[si + 1] * alpha + (dest[di + 1] * destAlpha * (255 - alpha)) / 255) / outAlpha) | 0;
            dest[di + 2] = ((src[si + 2] * alpha + (dest[di + 2] * destAlpha * (255 - alpha)) / 255) / outAlpha) | 0;
            dest[di + 3] = outAlpha;
        }
    }
}

// 解码 NPK 条目的指定帧并编码为 PNG（异步：zlib 解压）。
export async function decodeFrameToPng(buffer, entry, frameIndex) {
    const { frames } = readImgEntry(buffer, entry);
    if (frameIndex < 0 || frameIndex >= frames.length) throw new Error(`帧号越界：${frameIndex}`);
    const frame = frames[frameIndex];

    const raw = buffer.subarray(frame.pixelOffset, frame.pixelOffset + frame.size);
    let payload;
    if (frame.compression === 6) {
        try {
            payload = await inflate(raw);
        } catch (err) {
            throw new Error(`zlib 解压失败：${(err && err.message) || err}`);
        }
    } else {
        payload = raw; // compression 0 / 5 未压缩
    }

    const pixels = decodePixels(frame, payload);
    const canvasW = frame.maxWidth > 0 ? frame.maxWidth : frame.width;
    const canvasH = frame.maxHeight > 0 ? frame.maxHeight : frame.height;
    if (canvasW <= 0 || canvasH <= 0) throw new Error("画布尺寸异常");

    if (frame.keyX === 0 && frame.keyY === 0 && canvasW === frame.width && canvasH === frame.height) {
        return encodePng(frame.width, frame.height, pixels);
    }
    const canvas = new Uint8Array(canvasW * canvasH * 4);
    blit(canvas, canvasW, canvasH, pixels, frame.width, frame.height, frame.keyX, frame.keyY);
    return encodePng(canvasW, canvasH, canvas);
}

// ---------- PNG 编码（RGBA -> PNG，移植 S4A21GmTool PngEncoder） ----------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
}
const CRC_TABLE = crc32Table();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
}

function writeChunk(parts, type, data) {
    const typeBytes = [];
    for (let i = 0; i < 4; i++) typeBytes.push(type.charCodeAt(i));
    const typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set(typeBytes, 0);
    typeAndData.set(data, 4);
    const crc = crc32(typeAndData);
    const len = new Uint8Array(4);
    writeU32BE(len, 0, data.length);
    const crcBytes = new Uint8Array(4);
    writeU32BE(crcBytes, 0, crc);
    // PNG chunk 布局：length | type+data | crc
    parts.push(len, typeAndData, crcBytes);
}

// 把 RGB 扫描线按 PNG filter 0 逐行写入 IDAT 并 zlib 压缩。
// 浏览器用 CompressionStream("deflate")；Node 18+ 原生支持。
async function deflate(raw) {
    if (typeof CompressionStream === "undefined") throw new Error("当前环境不支持 CompressionStream");
    const cs = new CompressionStream("deflate");
    const stream = new Blob([raw]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(width, height, rgba) {
    if (width <= 0 || height <= 0 || !rgba || rgba.length < width * height * 4) {
        throw new Error("RGBA 尺寸不匹配");
    }
    const stride = width * 4;
    const raw = new Uint8Array(height * (1 + stride));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + stride)] = 0; // filter None
        raw.set(rgba.subarray(y * stride, y * stride + stride), y * (1 + stride) + 1);
    }
    const idat = await deflate(raw);

    const ihdr = new Uint8Array(13);
    writeU32BE(ihdr, 0, width);
    writeU32BE(ihdr, 4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA

    const parts = [new Uint8Array(PNG_SIGNATURE)];
    writeChunk(parts, "IHDR", ihdr);
    writeChunk(parts, "IDAT", idat);
    writeChunk(parts, "IEND", new Uint8Array(0));
    return concatBytes(parts);
}

function concatBytes(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

// ---------- BMP 编码（RGBA -> BMP 32-bit BGRA，零依赖） ----------
// 写入 LE uint32/uint16
function writeU32LE(out, offset, v) {
    out[offset] = v & 0xff;
    out[offset + 1] = (v >> 8) & 0xff;
    out[offset + 2] = (v >> 16) & 0xff;
    out[offset + 3] = (v >> 24) & 0xff;
}
function writeU16LE(out, offset, v) {
    out[offset] = v & 0xff;
    out[offset + 1] = (v >> 8) & 0xff;
}

// RGBA → BMP 32-bit（BGRA，每行 4 字节对齐，行倒序）
export function encodeBmp(width, height, rgba) {
    const rowBytes = width * 4;
    const stride = (rowBytes + 3) & ~3; // 4 字节对齐
    const pixelDataSize = stride * height;
    const headerSize = 14 + 40; // BITMAPFILEHEADER + BITMAPINFOHEADER
    const fileSize = headerSize + pixelDataSize;
    const out = new Uint8Array(fileSize);

    // BITMAPFILEHEADER (14 bytes)
    out[0] = 0x42;
    out[1] = 0x4d; // 'BM'
    writeU32LE(out, 2, fileSize);
    writeU16LE(out, 6, 0); // reserved
    writeU16LE(out, 8, 0); // reserved
    writeU32LE(out, 10, headerSize);

    // BITMAPINFOHEADER (40 bytes)
    writeU32LE(out, 14, 40); // header size
    writeI32LE(out, 18, width);
    writeI32LE(out, 22, height); // positive = bottom-up
    writeU16LE(out, 26, 1); // planes
    writeU16LE(out, 28, 32); // bpp
    writeU32LE(out, 30, 0); // compression BI_RGB
    writeU32LE(out, 34, pixelDataSize);
    writeI32LE(out, 38, 2835); // h-res (72 DPI)
    writeI32LE(out, 42, 2835); // v-res (72 DPI)
    writeU32LE(out, 46, 0); // colors used
    writeU32LE(out, 50, 0); // important colors

    // 像素数据（BMP bottom-up：从最后一行开始写入）
    for (let y = 0; y < height; y++) {
        const srcY = height - 1 - y;
        const srcOff = srcY * width * 4;
        const dstOff = headerSize + y * stride;
        for (let x = 0; x < width; x++) {
            const si = srcOff + x * 4;
            const di = dstOff + x * 4;
            out[di] = rgba[si + 2]; // B
            out[di + 1] = rgba[si + 1]; // G
            out[di + 2] = rgba[si]; // R
            out[di + 3] = rgba[si + 3]; // A
        }
    }
    return out;
}

function writeI32LE(out, offset, v) {
    if (v < 0) v = 0x100000000 + v;
    writeU32LE(out, offset, v);
}

function bytesToAscii(buffer, start, len) {
    let s = "";
    for (let i = start; i < start + len && i < buffer.byteLength; i++) s += String.fromCharCode(buffer[i]);
    return s;
}

// ---------------------------------------------------------------------------
// 写回能力（编辑 / 保存）
//
// 参考权威工具 ExtractorSharp（d-mod/ExtractorSharp）NpkCoder / Img_Version 的
// 操作逻辑：IMG 帧替换后按 ARGB 格式重新编码、NPK 保存时重建头部 + 条目名
// 加密（沿用本模块原有 XOR 算法，加密算法保持不变）+ SHA256 校验。
// 仅支持 JP（version 2）IMG，与现有只读解析保持一致。
// ---------------------------------------------------------------------------

// 条目名加密：256 字节按 NAME_KEY 逐字节 XOR（decryptName 的逆运算，算法不变）
export function encryptName(name) {
    const raw = new Uint8Array(256);
    for (let i = 0; i < name.length && i < 256; i++) raw[i] = name.charCodeAt(i) & 0xff;
    for (let i = 0; i < 256; i++) raw[i] ^= NAME_KEY[i];
    return raw;
}

// 读取 IMG 完整帧信息（含链接帧）：与 readImgEntry 一致，但不跳过链接帧，
// 链接帧记录 { linkIndex }，像素帧附带 pixelOffset（编辑时用于重建）。
export function readImgFull(buffer, entry) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (entry.size < 32) throw new Error("IMG 数据过小");
    const imgStart = entry.offset;
    const img = buffer.subarray(imgStart, imgStart + entry.size);
    if (bytesToAscii(img, 0, 15) !== "Neople Img File") throw new Error("条目数据不是 IMG 文件");

    const indexLength = readU32(view, imgStart + 16);
    const version = readU32(view, imgStart + 24);
    const frameCount = readU32(view, imgStart + 28);
    if (version !== 2 || frameCount <= 0 || frameCount > 100000) throw new Error(`不支持的 IMG 版本/帧数：v${version} frames=${frameCount}`);
    if (indexLength <= 0 || 32 + indexLength > entry.size) throw new Error("IMG 索引区越界");

    const frames = [];
    let pos = 32;
    let pixelCursor = 32 + indexLength;
    for (let i = 0; i < frameCount; i++) {
        if (pos + 4 > entry.size) throw new Error("IMG 帧索引越界");
        const type = readU32(view, imgStart + pos);
        if (type === 0x11) {
            const linkIndex = readU32(view, imgStart + pos + 4);
            frames.push({ type, linkIndex });
            pos += 8;
            continue;
        }
        if (pos + 36 > entry.size) throw new Error("IMG 像素帧索引越界");
        const compressed = readU32(view, imgStart + pos + 4);
        const width = readI32(view, imgStart + pos + 8);
        const height = readI32(view, imgStart + pos + 12);
        const size = readI32(view, imgStart + pos + 16);
        const keyX = readI32(view, imgStart + pos + 20);
        const keyY = readI32(view, imgStart + pos + 24);
        const maxWidth = readI32(view, imgStart + pos + 28);
        const maxHeight = readI32(view, imgStart + pos + 32);
        if (size < 0 || pixelCursor + size > entry.size) throw new Error("IMG 像素数据越界");
        frames.push({
            type,
            compression: compressed,
            width,
            height,
            size,
            keyX,
            keyY,
            maxWidth,
            maxHeight,
            pixelOffset: imgStart + pixelCursor
        });
        pos += 36;
        pixelCursor += size;
    }
    return { frames };
}

// RGBA（4 字节/像素）→ ARGB1555 / ARGB4444 / ARGB8888 像素编码
// 编码规则与现有 decodePixels 相反（见 docs/npk-format.md 2.5）
export function encodePixels(rgba, width, height, type) {
    const n = width * height;
    if (type === 0x10) {
        // ARGB8888：RGBA -> BGRA（与 decodePixels 0x10 对称）
        const out = new Uint8Array(n * 4);
        for (let i = 0, si = 0; i < out.length; i += 4) {
            out[i] = rgba[si + 2];
            out[i + 1] = rgba[si + 1];
            out[i + 2] = rgba[si];
            out[i + 3] = rgba[si + 3];
            si += 4;
        }
        return out;
    }
    const out = new Uint8Array(n * 2);
    for (let i = 0, si = 0; i < out.length; i += 2) {
        const a = rgba[si + 3];
        const r = rgba[si];
        const g = rgba[si + 1];
        const b = rgba[si + 2];
        si += 4;
        let pixel;
        if (type === 0x0e) {
            // ARGB1555
            const aBit = a >= 128 ? 0x8000 : 0;
            const r5 = ((r * 31) / 255 + 0.5) | 0;
            const g5 = ((g * 31) / 255 + 0.5) | 0;
            const b5 = ((b * 31) / 255 + 0.5) | 0;
            pixel = aBit | (r5 << 10) | (g5 << 5) | b5;
        } else {
            // ARGB4444
            const a4 = ((a * 15) / 255 + 0.5) | 0;
            const r4 = ((r * 15) / 255 + 0.5) | 0;
            const g4 = ((g * 15) / 255 + 0.5) | 0;
            const b4 = ((b * 15) / 255 + 0.5) | 0;
            pixel = (a4 << 12) | (r4 << 8) | (g4 << 4) | b4;
        }
        out[i] = pixel & 0xff;
        out[i + 1] = (pixel >> 8) & 0xff;
    }
    return out;
}

// zlib 压缩（浏览器 CompressionStream；Node 18+ 原生支持）
async function deflateRaw(raw) {
    if (typeof CompressionStream === "undefined") throw new Error("当前环境不支持 CompressionStream");
    const cs = new CompressionStream("deflate");
    const stream = new Blob([raw]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 重建 IMG v2（参考 ExtractorSharp Img 序列化：魔数 + indexLength + version=2
// + 帧数 + 帧索引 + 像素数据区；链接帧占 8 字节 type+linkIndex，像素帧 36 字节）。
// frames: [{ type, compression, width, height, size, keyX, keyY, maxWidth,
//            maxHeight, pixelData | linkIndex }]
export async function encodeImg(frames) {
    const frameCount = frames.length;
    // 逐帧计算索引大小与像素数据
    const idxSizes = frames.map(f => (f.type === 0x11 ? 8 : 36));
    const indexLength = idxSizes.reduce((a, b) => a + b, 0);
    const out = new Uint8Array(32 + indexLength + frames.reduce((a, f) => a + (f.type === 0x11 ? 0 : f.pixelData.length), 0));
    // 魔数（16 字节）
    const magic = "Neople Img File";
    for (let i = 0; i < 16; i++) out[i] = i < magic.length ? magic.charCodeAt(i) : 0;
    const view = new DataView(out.buffer);
    view.setUint32(16, indexLength, true);
    view.setUint32(20, 0, true); // 保留
    view.setUint32(24, 2, true); // version 2
    view.setUint32(28, frameCount, true);

    let pos = 32;
    let pixelCursor = 32 + indexLength;
    for (const f of frames) {
        if (f.type === 0x11) {
            view.setUint32(pos, 0x11, true);
            view.setUint32(pos + 4, f.linkIndex, true);
            pos += 8;
            continue;
        }
        view.setUint32(pos, f.type, true);
        view.setUint32(pos + 4, f.compression, true);
        view.setInt32(pos + 8, f.width, true);
        view.setInt32(pos + 12, f.height, true);
        view.setInt32(pos + 16, f.size, true);
        view.setInt32(pos + 20, f.keyX, true);
        view.setInt32(pos + 24, f.keyY, true);
        view.setInt32(pos + 28, f.maxWidth, true);
        view.setInt32(pos + 32, f.maxHeight, true);
        out.set(f.pixelData, pixelCursor);
        pos += 36;
        pixelCursor += f.pixelData.length;
    }
    return out;
}

// 把一张 RGBA 图片编码为一个像素帧（zlib 压缩，参考 ExtractorSharp
// Texture.CreateFromBitmap：ToArray(type) 后 Zlib.Compress）
export async function encodeFrameFromRgba(rgba, width, height, type, keyX, keyY, maxWidth, maxHeight) {
    const rawPixels = encodePixels(rgba, width, height, type);
    const compressed = await deflateRaw(rawPixels);
    return {
        type,
        compression: 6,
        width,
        height,
        size: compressed.length,
        keyX,
        keyY,
        maxWidth,
        maxHeight,
        pixelData: compressed
    };
}

// SHA256：浏览器优先用原生 WebCrypto；Node 测试回退动态 import node:crypto。
async function sha256(bytes) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
        return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    }
    try {
        const { createHash } = await import("node:crypto");
        return new Uint8Array(createHash("sha256").update(bytes).digest());
    } catch (err) {
        throw new Error(`当前环境不支持 SHA256：${(err && err.message) || err}`);
    }
}

// 重建 NPK（参考 ExtractorSharp NpkCoder.WriteNpk / CompileHash）：
// 布局：头部 20 字节（魔数 + 条目数）+ 条目表（每条 264 字节：offset/size/加密名）
// + SHA256 校验（32 字节，对头部取前 length/17*17 字节计算）+ 数据区。
// 条目数据偏移从 headerLen + 32 开始（对齐 ExtractorSharp `52 + count*264`）。
// entries: [{ name, data }]，data 为完整 IMG 字节。
export async function encodeNpk(entries) {
    const count = entries.length;
    const headerLen = 20 + count * 264;
    const dataStart = headerLen + 32;
    const magic = "NeoplePack_Bill";
    const out = new Uint8Array(dataStart + entries.reduce((a, e) => a + e.data.length, 0));

    // 头部 + 条目表
    for (let i = 0; i < 16; i++) out[i] = i < magic.length ? magic.charCodeAt(i) : 0;
    const view = new DataView(out.buffer);
    view.setUint32(16, count, true);
    let offset = dataStart;
    for (let i = 0; i < count; i++) {
        const row = 20 + i * 264;
        view.setUint32(row, offset, true);
        view.setUint32(row + 4, entries[i].data.length, true);
        out.set(encryptName(entries[i].name), row + 8);
        out.set(entries[i].data, offset);
        offset += entries[i].data.length;
    }

    // SHA256 校验（对齐 ExtractorSharp CompileHash：C# 整数除法 data.Length/17*17）
    const hash = await sha256(out.subarray(0, Math.floor(headerLen / 17) * 17));
    out.set(hash, headerLen);
    return out;
}
