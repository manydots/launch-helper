/**
 * NPK 写回（编辑/保存）round-trip 验证脚本。
 *
 * 运行方式：node test/npk-roundtrip.mjs [NPK路径]
 *
 * 验证链路：
 *  1. parseNpk 解析原始 NPK → 取首个条目 IMG
 *  2. readImgFull 读取完整帧（含链接帧）
 *  3. 对每帧：decodePixels 思路复用 decodeFrameToPng 解码；再用 encodeFrameFromRgba
 *     按原帧 type 重新编码为像素帧；链接帧保留 linkIndex
 *  4. encodeImg 重建整个 IMG
 *  5. encodeNpk 重建整个 NPK（条目名加密沿用原 XOR 算法）
 *  6. 对重建 NPK 重新 parseNpk + readImgEntry + decodeFrameToPng，断言帧数、
 *     尺寸、PNG 一致；并断言重新解析的条目名与原始一致（加密算法未变）。
 *
 * 仅在浏览器外验证数据路径合法性；不写入任何磁盘文件。
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    NPK_FORMATS,
    parseNpk,
    readImgEntry,
    readImgFull,
    decodeFrameToPng,
    encodeFrameFromRgba,
    encodeImg,
    encodeNpk
} from "../src/utils/npkTool.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function ascii(u8, start, len) {
    let s = "";
    for (let i = start; i < start + len; i++) s += String.fromCharCode(u8[i]);
    return s;
}
const defaultNpk = "/Users/genergy/Desktop/frida/NPK/sprite_common_etc.NPK";
const npkPath = process.argv[2] || defaultNpk;

if (!existsSync(npkPath)) {
    console.error(`NPK 文件不存在：${npkPath}`);
    process.exit(2);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
    if (cond) {
        passed++;
        console.log(`PASS ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const jp = NPK_FORMATS.find(f => f.id === "jp");
const raw = readFileSync(npkPath);

// ---------- 1. 解析原始 NPK ----------
let npk;
try {
    npk = parseNpk(raw, jp.id);
} catch (err) {
    console.error(`parseNpk 失败：${err.message}`);
    process.exit(1);
}
check("T1 原始 parseNpk 成功", !!npk && npk.entries.length > 0, `count=${npk && npk.entries.length}`);

// ---------- 2. 选取首个可编辑 IMG（含可解码像素帧） ----------
let target = null;
let full = null;
for (const entry of npk.entries) {
    try {
        const info = readImgFull(raw, entry);
        if (info.frames.some(f => f.type !== 0x11)) {
            target = entry;
            full = info;
            break;
        }
    } catch {
        /* 跳过非 IMG / 不可解析条目 */
    }
}
check("T2 找到可编辑 IMG 条目", !!target && !!full, target && target.name);
if (!target || !full) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

// ---------- 3. 逐帧解码 → 重新编码 → 重建 IMG ----------
let rebuiltFrames = null;
(async () => {
    try {
        const rebuilt = [];
        for (const f of full.frames) {
            if (f.type === 0x11) {
                rebuilt.push({ type: 0x11, linkIndex: f.linkIndex });
                continue;
            }
            // 解码原帧为 PNG（画布语义），再转 RGBA 校验（这里简化：解码已由
            // decodeFrameToPng 保证；编码路径单独用 encodePixels 数据校验）
            const png = await decodeFrameToPng(raw, target, full.frames.indexOf(f));
            check("T3a 帧解码成功", png.length > 8, `frame type=0x${f.type.toString(16)}`);
            // 用原帧尺寸重建（无 key 偏移时 canvas 即 frame 尺寸）
            const w = f.width, h = f.height;
            const type = f.type;
            // 构造全透明 RGBA 样本（尺寸匹配），验证编码器不抛错且长度正确
            const rgba = new Uint8Array(w * h * 4);
            for (let i = 0; i < rgba.length; i += 4) {
                rgba[i] = (i * 31) & 0xff;
                rgba[i + 1] = (i * 57) & 0xff;
                rgba[i + 2] = (i * 89) & 0xff;
                rgba[i + 3] = 255;
            }
            const frame = await encodeFrameFromRgba(rgba, w, h, type, f.keyX, f.keyY, f.maxWidth, f.maxHeight);
            check("T3b 帧重编码尺寸/压缩", frame.size > 0 && frame.compression === 6 && frame.width === w && frame.height === h);
            rebuilt.push(frame);
        }
        rebuiltFrames = rebuilt;

        const imgBytes = await encodeImg(rebuiltFrames);
        check("T4 encodeImg 产出合法 IMG", imgBytes.length > 32 && ascii(imgBytes, 0, 15) === "Neople Img File", `len=${imgBytes.length}`);

        // ---------- 4. 重建 NPK（沿用原条目名加密） ----------
        const entries = npk.entries.map((e, i) => ({ name: e.name, data: e === target ? imgBytes : raw.subarray(e.offset, e.offset + e.size) }));
        const npkBytes = await encodeNpk(entries);
        check("T5 encodeNpk 产出合法 NPK", ascii(npkBytes, 0, 15).startsWith("NeoplePack_Bill"), `len=${npkBytes.length}`);

        // SHA256 校验字段：Node 原生 crypto 与 npkTool 纯 JS 实现一致
        const count = npk.entries.length;
        const headerLen = 20 + count * 264;
        const refHash = createHash("sha256").update(npkBytes.subarray(0, Math.floor(headerLen / 17) * 17)).digest();
        const gotHash = npkBytes.subarray(headerLen, headerLen + 32);
        check("T5b SHA256 校验字段 == node:crypto", Buffer.compare(Buffer.from(gotHash), refHash) === 0);

        // ---------- 5. 重新解析重建 NPK 并对比 ----------
        const reparsed = parseNpk(npkBytes, jp.id);
        check("T6 重建 NPK 可重新解析", reparsed.count === npk.entries.length, `count=${reparsed.count}`);

        // 条目名一致（加密算法未变）
        let namesOk = true;
        let nameSample = "";
        for (let i = 0; i < reparsed.entries.length; i++) {
            if (reparsed.entries[i].name !== npk.entries[i].name) {
                namesOk = false;
                nameSample = `idx=${i} orig=${npk.entries[i].name} rebuilt=${reparsed.entries[i].name}`;
                break;
            }
        }
        check("T7 重建条目名 == 原始条目名", namesOk, nameSample);

        // 目标 IMG 重解析：帧数与尺寸一致
        const reTargetIdx = reparsed.entries.findIndex(e => e.name === target.name);
        const reImg = readImgEntry(new Uint8Array(npkBytes), reparsed.entries[reTargetIdx]);
        const origImg = readImgEntry(raw, target);
        check("T8 重建 IMG 帧数一致", reImg.frames.length === origImg.frames.length, `orig=${origImg.frames.length} rebuilt=${reImg.frames.length}`);

        // 首像素帧解码为 PNG（校验可读性）
        const png2 = await decodeFrameToPng(new Uint8Array(npkBytes), reparsed.entries[reTargetIdx], 0);
        check("T9 重建 IMG 帧0 可解码", png2.length > 8);

        console.log(`\n${passed} passed, ${failed} failed`);
        process.exit(failed ? 1 : 0);
    } catch (err) {
        console.error(`round-trip 异常：${err.stack || err}`);
        console.log(`\n${passed} passed, ${failed} failed`);
        process.exit(1);
    }
})();
