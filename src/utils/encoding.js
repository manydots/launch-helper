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

export function decodeText(bytes, encoding) {
    return new TextDecoder(resolveEnc(encoding)).decode(bytes);
}

export function encodeText(text, encoding) {
    const enc = resolveEnc(encoding);
    if (enc === "utf-8") {
        return new TextEncoder().encode(text);
    }
    if (enc === "gbk" || enc === "gb2312") {
        return encodeGBK(text);
    }
    // Other encodings: fall back to UTF-8 (native TextEncoder limitation)
    return new TextEncoder().encode(text);
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
    const candidates = ["utf-8", "gbk", "big5"];
    for (const enc of candidates) {
        try {
            new TextDecoder(enc, { fatal: true }).decode(bytes);
            return enc;
        } catch {
            /* try next */
        }
    }
    return "gbk";
}
