// Encoding utilities using native browser TextDecoder/TextEncoder

import { encodeGBK, gbkCode } from "./gbkEncoder.js";
import { encodeBig5 } from "./big5Encoder.js";

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
    if (enc === "big5") {
        return encodeBig5(text);
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

// ---- 韩文乱码恢复（CP437 → EUC-KR 反向链路）----
// 部分海外客户端（如 90US）制作时发生了双重转码：
//   韩文 EUC-KR/CP949 → 按 CP437 解码 → 存为 UTF-8 文本
// 恢复链路：文本 → CP437 反向编码 → EUC-KR 解码。仅对含 CP437
// 装饰字符（或 U+FFFD）的串触发，且恢复结果必须含 Hangul 才采纳，
// 正常英文 / 中文 / 韩文串完全不受影响（见 docs/pvf-us-korean-mojibake.md）。

// CP437 高半区（0x80~0xFF）字符表（字节 → 字符）
const CP437_HIGH =
    "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5" +
    "\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192" +
    "\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb" +
    "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510" +
    "\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567" +
    "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580" +
    "\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229" +
    "\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0";

const _cp437Reverse = new Map(); // charCode -> byte（仅 0x80~0xFF）
for (let b = 0x80; b < 0x100; b++) _cp437Reverse.set(CP437_HIGH.charCodeAt(b - 0x80), b);

// Hangul 音节 / 字母 / 相容字母 / 扩展区
const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uA960-\uA97f\uAC00-\uD7A3\uD7B0-\uD7ff]/;
// 仅 Hangul 音节（EUC-KR 韩文正文对应 B0~C8 前导字节）；用于 sTrA 原始字节直解分支，
// 避免与 GBK 日文假名区（A4xx）/符号区（A1xx）等撞车误判
const HANGUL_SYLLABLE_RE = /[\uAC00-\uD7A3]/;
// 非 ASCII 且非韩文音节（用于 sTrA 原始字节直解的全音节判定）
const NON_SYLLABLE_NON_ASCII_RE = /[^\x00-\x7f\uAC00-\uD7A3]/;
// 非 ASCII 且非韩文（音节/谚文字母/兼容字母）且非 CJK 汉字（统一/扩展 A/兼容汉字）。
// GBK 乱码恢复结果允许韩文文本内嵌汉字（如 `체이서 : 공(無)` 的谚文汉字标注），
// 但拒绝假名/希腊/西里尔/符号等，避免误恢复非韩文来源文本。
const NON_CJK_NON_HANGUL_RE = /[^\x00-\x7f\uAC00-\uD7A3\u3130-\u318F\uF900-\uFAFF\u3400-\u9FFF]/;
// 韩文装饰符号（GBK 符号区 A1xx/A2xx → EUC-KR 符号区解码结果）：♡♥♠★☆†‡≠≮≯ 带圈数字 ①~⑳ ⒈~⒛ 等。
// 韩文装饰文本（如 `던파♡해피빈`、`☆GBL교 명예 신도☆`）常内嵌这些符号；
// 仅名字型 .lst 行内白名单路径（allowKsc=true）放行——行内名字纯韩文，符号放行安全；
// 字符串表层（全局）不放行，避免放大中文误伤面。
const KR_DECO_SYMBOL_RE = /[\u2020\u2021\u2260\u226E\u226F\u2460-\u2473\u2488-\u249B\u2605\u2606\u2660-\u2667]/g;

function _hasCp437Char(s) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0x80 && (_cp437Reverse.has(c) || c === 0xfffd)) return true;
    }
    return false;
}

function _cp437Encode(text) {
    const out = [];
    for (const ch of text) {
        const c = ch.codePointAt(0);
        if (c < 0x80) {
            out.push(c);
            continue;
        }
        const b = _cp437Reverse.get(c);
        if (b == null) return null;
        out.push(b);
    }
    return Uint8Array.from(out);
}

/**
 * 解码 sTrA 单字节字符串，并在必要时恢复韩文乱码。
 * 先用 primaryEncoding 正常解码；仅当结果含 CP437 装饰字符或 U+FFFD 时，
 * 依次尝试：文本 → CP437 反向编码 → EUC-KR；UTF-8 文本 → CP437 → EUC-KR；
 * 原始字节直接 EUC-KR。恢复结果必须含 Hangul 才采纳，否则原样返回。
 * @param {Uint8Array} bytes  原始字节
 * @param {string} encoding   归档全局编码（strEncoding）
 * @returns {string}
 */
export function decodeKoreanMojibake(bytes, encoding) {
    const s = decodeText(bytes, encoding);
    const kr = recoverKoreanFromMojibakeText(s);
    if (kr != null) return kr;
    const krGbk = recoverKoreanFromGbkText(s);
    if (krGbk != null) return krGbk;

    // 存储可能是 UTF-8 编码的 box-drawing 乱码文本
    let text = null;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        /* 非合法 UTF-8 */
    }
    if (text != null) {
        const kr2 = recoverKoreanFromMojibakeText(text);
        if (kr2 != null) return kr2;
        const kr2Gbk = recoverKoreanFromGbkText(text);
        if (kr2Gbk != null) return kr2Gbk;
    }

    // 原始字节本身是 EUC-KR 韩文（仅音节区，避免误判 GBK 假名/符号区）
    const kr3 = new TextDecoder("euc-kr").decode(bytes);
    if (HANGUL_SYLLABLE_RE.test(kr3)) return kr3;

    return s;
}

/**
 * 解码 sTrW UTF-16 字符串，并在必要时恢复韩文乱码。
 * 海外客户端（如 90US）把韩文以「EUC-KR → CP437 解码 → UTF-16 存储」存入
 * sTrW，先按 UTF-16 解码得到 box-drawing 乱码文本，再走 CP437 → EUC-KR 恢复。
 * 恢复结果必须含 Hangul 才采纳，否则原样返回。
 * @param {Uint8Array} bytes  UTF-16LE 原始字节
 * @returns {string}
 */
export function decodeKoreanMojibakeUtf16(bytes) {
    const s = decodeUtf16LE(bytes);
    const kr = recoverKoreanFromMojibakeText(s);
    if (kr != null) return kr;
    const krGbk = recoverKoreanFromGbkText(s);
    return krGbk != null ? krGbk : s;
}

// 核心恢复：把「box-drawing 乱码文本」按 CP437 反向编码后以 EUC-KR 解码，
// 结果含 Hangul 才返回，否则 null（调用方保持原样）。
function recoverKoreanFromMojibakeText(text) {
    if (!_hasCp437Char(text)) return null;
    const b = _cp437Encode(text);
    if (!b) return null;
    const kr = new TextDecoder("euc-kr").decode(b);
    return HANGUL_RE.test(kr) ? kr : null;
}

// 核心恢复：把「GBK 乱码文本」按 GBK 编码后以 EUC-KR 解码。
// 汉化版 PVF（如 86JP 等）把未翻译的韩文以「EUC-KR → GBK 解码 → 存储」转码。
// 判别（保守，避免误伤正常中文）：
//   1. 所有汉字 GBK 前导字节 ∈ B0~C8（实测确认 EUC-KR 韩文音节区为 B0~C8，
//      C9 起为 PUA / KSC 汉字区）。字符串表层（全局）必须严格限制 B0~C8，
//      否则含 CA~F7 汉字的正常中文句（如 `是`/`成`）会被误恢复（实测 22324 条）；
//      仅名字型 .lst 白名单行内（allowKsc=true）可放宽到 B0~F7，以恢复韩文文本中
//      内嵌的谚文汉字标注（如 `체이서 : 공(無)` 括号内的 KSC 汉字）。
//   2. requireSpace 时：串含词间空格（韩文分词特征；中文几乎不用空格分词）
//   3. GBK 编码 → EUC-KR 解码后，非 ASCII 字符全为韩文（音节/谚文字母/兼容字母）
//      或 CJK 汉字（允许韩文文本内嵌谚文汉字，如 `체이서 : 화(火)`）且至少一个音节
// 注：无空格短词（如「父柳」）与正常中文（如「龙人」）在字节层面完全同构，
// 全局字符串表无法可靠区分（requireSpace=true），仅名字型 .lst 行内白名单
// 文件可用 requireSpace=false 激进恢复（见 docs/pvf-jp-korean-mojibake.md）。
function _recoverKoreanFromGbkText(text, requireSpace, allowKsc) {
    if (!text) return null;
    if (requireSpace && !/\s/.test(text)) return null;
    // 已含 Hangul（音节/谚文字母/兼容字母/扩展区）的串不是 GBK 乱码：
    // 90US 等文件的正规韩文文本会内嵌汉字（如 `改`、`赤`、`美人`），
    // 若不加此门控会被误恢复；真乱码（86JP）的串必然不含韩文字符。
    if (HANGUL_RE.test(text)) return null;
    let hasCjk = false;
    const maxLead = allowKsc ? 0xf7ff : 0xc8ff;
    for (const ch of text) {
        const c = ch.codePointAt(0);
        if (c >= 0x4e00 && c <= 0x9fff) {
            hasCjk = true;
            const g = gbkCode(ch);
            if (g == null || g < 0xb000 || g > maxLead) return null;
        } else if (c >= 0x3400 && c <= 0x4dbf) {
            return null; // 扩展 A 区汉字：非 GBK 汉字区
        }
    }
    if (!hasCjk) return null;
    const kr = new TextDecoder("euc-kr").decode(encodeGBK(text));
    if (!HANGUL_SYLLABLE_RE.test(kr)) return null;
    // 中文属性文本特征（`攻击力 +8%%`、`成长胶囊 (1%%)`、多行属性串）：
    // 86JP 汉化属性文本被误恢复实测 357 条含 %、24 条含换行，韩文乱码恢复结果不含二者
    if (/%|\n/.test(kr)) return null;
    // 行内白名单路径放行韩文装饰符号（♡★☆†≠ 等，见 KR_DECO_SYMBOL_RE 注释）
    const result = allowKsc ? kr.replace(KR_DECO_SYMBOL_RE, "") : kr;
    if (NON_CJK_NON_HANGUL_RE.test(result)) return null;
    return kr;
}

// 字符串表全局恢复：必须含词间空格（保守，避免误伤正常中文）
export function recoverKoreanFromGbkText(text) {
    return _recoverKoreanFromGbkText(text, true, false);
}

// 名字型 .lst 行内名字恢复：不要求空格（激进，仅由 decodeLst 白名单路径调用），
// 且允许恢复含 KSC 谚文汉字标注的行（如 `체이서 : 공(無)`、`십문자도 - 자(者)`）
export function recoverKoreanNameFromGbkText(text) {
    return _recoverKoreanFromGbkText(text, false, true);
}
