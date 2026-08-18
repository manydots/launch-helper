// Encoding utilities using native browser TextDecoder/TextEncoder

import { encodeGBK } from "./gbkEncoder.js";

const ENCODING_ALIASES = {
    utf8: "utf-8",
    "utf-8": "utf-8",
    gbk: "gbk",
    gb2312: "gbk",
    big5: "big5"
};

const DEFAULT_ENCODING = "utf8";

function resolveEnc(enc) {
    return ENCODING_ALIASES[(enc || DEFAULT_ENCODING).toLowerCase()] || DEFAULT_ENCODING;
}

// TextDecoder 实例可重复 decode（无内部状态），复用避免每次 new 的开销
// （字符串表逐条解码时可能调用数十万次，new TextDecoder 是显著成本）。
const _decoderCache = new Map();
const _encoderCache = new Map();

function getDecoder(encoding) {
    const enc = resolveEnc(encoding);
    let d = _decoderCache.get(enc);
    if (!d) {
        d = new TextDecoder(enc);
        _decoderCache.set(enc, d);
    }
    return d;
}

function getEncoder(encoding) {
    const enc = resolveEnc(encoding);
    if (enc !== "utf-8") {
        let e = _encoderCache.get(enc);
        if (!e) {
            e = new TextEncoder();
            _encoderCache.set(enc, e);
        }
        return e;
    }
    return new TextEncoder();
}

export function decodeText(bytes, encoding) {
    return getDecoder(encoding).decode(bytes);
}

export function encodeText(text, encoding) {
    const enc = resolveEnc(encoding);
    if (enc === "utf-8") {
        return getEncoder("utf-8").encode(text);
    }
    if (enc === "gbk" || enc === "gb2312") {
        return encodeGBK(text);
    }
    // Other encodings: fall back to UTF-8 (native TextEncoder limitation)
    return getEncoder("utf-8").encode(text);
}

export function decodeUtf16LE(bytes) {
    return new TextDecoder("utf-16le").decode(bytes);
}

export function encodeUtf16LE(text) {
    const u16 = new Uint16Array(text.length);
    for (let i = 0; i < text.length; i++) u16[i] = text.charCodeAt(i);
    return new Uint8Array(u16.buffer, 0, text.length * 2);
}

export function detectEncoding(bytes) {
    if (!bytes || bytes.length === 0) return DEFAULT_ENCODING;
    // 采样前 8KB：含非 ASCII 即可快速判定（编码特征字节在任意位置出现即足以判定，
    // 且 utf-8 fatal 对 GBK/Big5 数据在首个非 ASCII 字节即抛，采样判定结果与全量一致），
    // 避免对可能达数 MB 的 sTrA 字符串表做全量 3 次解码尝试。
    const sample = bytes.length > 8192 ? bytes.subarray(0, 8192) : bytes;
    let hasNonAscii = false;
    for (let i = 0; i < sample.length; i++) {
        if (sample[i] >= 0x80) {
            hasNonAscii = true;
            break;
        }
    }
    if (hasNonAscii) return detectFromSample(sample);
    // 采样全 ASCII：特征字节可能在采样区间之外，退化为全量检测保持原语义
    return detectFromSample(bytes);
}

function detectFromSample(sample) {
    const candidates = ["utf-8", "gbk", "big5"];
    for (const enc of candidates) {
        try {
            new TextDecoder(enc, { fatal: true }).decode(sample);
            return enc;
        } catch {
            /* try next */
        }
    }
    return "gbk";
}
