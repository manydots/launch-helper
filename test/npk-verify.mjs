/**
 * NPK 归档预览验证脚本（JP 格式）。
 *
 * 运行方式：node test/npk-verify.mjs <NPK路径> [加密AVI路径] [带音频加密AVI路径]
 * 默认目标：本机回归用日服 NPK 文件（见 docs/npk-format.md §4）；
 * 路径定位失败时按 AGENTS.md「工作流前置」询问用户实际位置。
 * 第 2 参数可选：独立加密 AVI 文件（docs/npk-format.md §6.2 断言，样例 PVF/test/creator.avi）。
 * 第 3 参数可选：带音频的加密 AVI（W6 组音频完整性断言，样例 PVF/test/ATFighterGrappler.avi）。
 *
 * 直接加载 src/utils/npkTool.js（零依赖，Node 18+ 原生 DecompressionStream），
 * 断言 NPK 魔数 / 条目数 / 名称解密 / IMG 帧头 / zlib 解压长度 / PNG 编码合法性；
 * NPK 含 .ogg / .avi 条目时追加媒体条目断言（M 组，docs/npk-format.md §6.1）。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

import { NPK_FORMATS, parseNpk, readImgEntry, decodeFrameToPng, encodePng, readEntryData, isNeopleVideo, decryptNeopleVideo, detectMediaKind, extractAviVideoStream, isMpegVideoEs, muxMpegEsToTs } from "../src/utils/npkTool.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultNpk = "PVF/test/sprite_common_etc.NPK";
const npkPath = process.argv[2] || defaultNpk;
const aviPath = process.argv[3] || "";
const audioAviPath = process.argv[4] || "";

if (!existsSync(npkPath)) {
    console.error(`NPK 文件不存在：${npkPath}`);
    console.error(`请提供路径：node test/npk-verify.mjs <NPK路径> [加密AVI路径] [带音频加密AVI路径]`);
    process.exit(2);
}
if (aviPath && !existsSync(aviPath)) {
    console.error(`加密 AVI 文件不存在：${aviPath}`);
    process.exit(2);
}
if (audioAviPath && !existsSync(audioAviPath)) {
    console.error(`带音频加密 AVI 文件不存在：${audioAviPath}`);
    process.exit(2);
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, cond, detail) {
    if (cond) {
        passed++;
        console.log(`PASS ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

function skip(name, detail) {
    skipped++;
    console.log(`SKIP ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------- 1. 格式注册表 ----------
const jp = NPK_FORMATS.find(f => f.id === "jp");
check("F1 格式注册表含 JP", !!jp && !!jp.label && typeof jp.parse === "function");

// ---------- 2. 加载并解析 NPK ----------
let npk;
try {
    npk = parseNpk(readFileSync(npkPath), jp.id);
} catch (err) {
    check("N1 parseNpk 成功", false, String(err && err.message || err));
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

check("N1 parseNpk 成功", !!npk && Array.isArray(npk.entries));
const count = npk ? npk.entries.length : 0;
check("N2 条目数 > 0", count > 0, `count=${count}`);

// 魔数校验
const raw = readFileSync(npkPath);
check("N3 魔数 NeoplePack_Bill", raw.subarray(0, 15).toString("ascii").startsWith("NeoplePack_Bill"));
check("N4 条目数 == 头字段", raw.readUInt32LE(16) === count, `head=${raw.readUInt32LE(16)} entries=${count}`);

// ---------- 3. 名称解密（对照独立 XOR 实现） ----------
const prefix = "puchikon@neople dungeon and fighter ";
const nameKey = Buffer.alloc(256);
nameKey.write(prefix, 0, "ascii");
const dnf = Buffer.from("DNF", "ascii");
for (let i = prefix.length; i < 256; i++) nameKey[i] = dnf[(i - prefix.length) % 3];
function decryptRef(rawBytes) {
    const out = Buffer.alloc(rawBytes.length);
    for (let i = 0; i < rawBytes.length; i++) out[i] = rawBytes[i] ^ nameKey[i];
    const end = out.indexOf(0);
    return out.subarray(0, end < 0 ? out.length : end).toString("ascii").replace(/\\/g, "/");
}

let nameOk = true;
let nameSample = "";
for (let i = 0; i < count; i++) {
    const row = 20 + i * 264;
    const ref = decryptRef(raw.subarray(row + 8, row + 256));
    const actual = npk.entries[i].name;
    if (ref !== actual) {
        nameOk = false;
        nameSample = `idx=${i} ref=${ref} actual=${actual}`;
        break;
    }
}
check("N5 名称解密 == 独立 XOR 实现", nameOk, nameSample);

// IMG 组断言目标：第一个 .img 条目（SoundPacks 等纯媒体包无 .img 条目时跳过 IMG 组）
const imgEntry = npk.entries.find(e => /\.img$/i.test(e.name)) || null;
if (imgEntry) {
    check("N6 存在 .img 条目", /\.img$/i.test(imgEntry.name), imgEntry.name);
} else {
    skip("N6 存在 .img 条目（无 .img 条目，媒体包）", `${count} 条均为非 IMG 条目`);
}

// ---------- 4. IMG 帧解析 ----------
let img = null;
let imgError = "";
if (imgEntry) {
    try {
        img = readImgEntry(raw, imgEntry);
    } catch (err) {
        imgError = String(err && err.message || err);
    }
    check("I1 readImgEntry 成功", !!img && Array.isArray(img.frames), imgError);
    if (img && img.frames.length) {
        const f = img.frames[0];
        check("I2 帧0 尺寸 > 0", f.width > 0 && f.height > 0, `w=${f.width} h=${f.height}`);
        check("I3 帧0 像素格式为 0x0E/0x0F/0x10", [0x0e, 0x0f, 0x10].includes(f.type), `type=0x${f.type.toString(16)}`);
    }
} else {
    skip("I1 readImgEntry 成功（无 .img 条目）");
    skip("I2 帧0 尺寸 > 0（无 .img 条目）");
    skip("I3 帧0 像素格式为 0x0E/0x0F/0x10（无 .img 条目）");
}

// ---------- 5. decodeFrameToPng 全链路（含 zlib + PNG 编码） ----------
(async () => {
    // ---------- 5. decodeFrameToPng 全链路（含 zlib + PNG 编码） ----------
    let png = null;
    let pngError = "";
    if (imgEntry) {
        try {
            png = await decodeFrameToPng(raw, imgEntry, 0);
        } catch (err) {
            pngError = String(err && err.message || err);
        }
        check("D1 decodeFrameToPng 帧0 成功", !!png && png.length > 8, pngError);
        if (png) {
            const sig = Array.from(png.subarray(0, 8));
            const expectSig = [137, 80, 78, 71, 13, 10, 26, 10];
            check("D2 PNG 签名合法", sig.every((v, i) => v === expectSig[i]), sig.join(","));
            // IHDR 尺寸（PNG 头 16 起，8 字节大端宽高）
            const pv = new DataView(png.buffer, png.byteOffset, png.byteLength);
            const w = pv.getUint32(16);
            const h = pv.getUint32(20);
            if (img && img.frames[0]) {
                check("D3 IHDR 尺寸 == 帧画布尺寸", w > 0 && h > 0 && (w === img.frames[0].width || img.frames[0].maxWidth), `w=${w} h=${h} frameW=${img.frames[0].width}`);
            }
        }
    } else {
        skip("D1 decodeFrameToPng 帧0 成功（无 .img 条目）");
        skip("D2 PNG 签名合法（无 .img 条目）");
        skip("D3 IHDR 尺寸 == 帧画布尺寸（无 .img 条目）");
    }
    // ---------- 6. encodePng 独立合法性 ----------
    try {
        const w = 4, h = 3;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 0xff;
        const p = await encodePng(w, h, rgba);
        const sigOk = Array.from(p.subarray(0, 8)).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]);
        const pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        const pw = pv.getUint32(16), ph = pv.getUint32(20);
        check("E1 encodePng 签名合法", sigOk);
        check("E2 encodePng IHDR 尺寸一致", pw === w && ph === h, `w=${pw} h=${ph}`);
    } catch (err) {
        check("E1 encodePng 成功", false, String(err && err.message || err));
        check("E2 encodePng IHDR 尺寸一致", false, "");
    }

    // ---------- 7. 非 NPK 文件拒绝 ----------
    try {
        parseNpk(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), jp.id);
        check("R1 非 NPK 魔数拒绝", false, "should have thrown");
    } catch {
        check("R1 非 NPK 魔数拒绝", true);
    }

    // ---------- 8. 媒体条目断言（.ogg / .avi，不转码预览，docs/npk-format.md §6.1） ----------
    const oggEntries = npk.entries.filter(e => detectMediaKind(e.name) === "audio");
    const aviEntries = npk.entries.filter(e => detectMediaKind(e.name) === "video");
    if (oggEntries.length || aviEntries.length) {
        let kindOk = true;
        for (const e of oggEntries.slice(0, 5)) if (detectMediaKind(e.name) !== "audio") kindOk = false;
        for (const e of aviEntries.slice(0, 5)) if (detectMediaKind(e.name) !== "video") kindOk = false;
        check("M1 detectMediaKind 后缀分类正确", kindOk, `ogg=${oggEntries.length} avi=${aviEntries.length}`);

        let sliceOk = true;
        for (const e of [...oggEntries, ...aviEntries]) {
            const data = readEntryData(raw, e);
            if (data.length !== e.size) { sliceOk = false; break; }
        }
        check("M2 readEntryData 切片长度 == 条目 size", sliceOk);

        if (oggEntries.length) {
            const head = readEntryData(raw, oggEntries[0]).subarray(0, 4);
            check("M3 ogg 条目数据头 OggS", Buffer.from(head).toString("latin1") === "OggS", Buffer.from(head).toString("hex"));
        } else {
            skip("M3 ogg 条目数据头 OggS（无 .ogg 条目）");
        }

        if (aviEntries.length) {
            let aviOk = true;
            let aviDetail = "";
            for (const e of aviEntries) {
                const data = readEntryData(raw, e);
                let plain;
                if (isNeopleVideo(data)) {
                    plain = decryptNeopleVideo(data).data;
                } else {
                    plain = data;
                }
                const magic = Buffer.from(plain.subarray(0, 12)).toString("latin1");
                if (magic.slice(0, 4) !== "RIFF" || magic.slice(8, 12) !== "AVI ") {
                    aviOk = false;
                    aviDetail = `${e.name} magic=${JSON.stringify(magic)}`;
                    break;
                }
            }
            check("M4 avi 条目解密后为 RIFF/AVI 容器", aviOk, aviDetail);
        } else {
            skip("M4 avi 条目解密后为 RIFF/AVI 容器（无 .avi 条目）");
        }
    } else {
        skip("M 组媒体条目断言（NPK 无 .ogg/.avi 条目）");
    }

    // ---------- 9. 独立加密 AVI 断言（docs/npk-format.md §6.2） ----------
    if (aviPath) {
        const aviRaw = readFileSync(aviPath);
        check("V1 isNeopleVideo 签名检测", isNeopleVideo(aviRaw) === true);
        let dec = null;
        let decError = "";
        try {
            dec = decryptNeopleVideo(aviRaw);
        } catch (err) {
            decError = String(err && err.message || err);
        }
        check("V2 解密输出大小 == originalSize", !!dec && dec.data.length === dec.originalSize,
            decError || (dec ? `out=${dec.data.length} original=${dec.originalSize}` : ""));
        if (dec) {
            const head = Buffer.from(dec.data.subarray(0, 12)).toString("latin1");
            check("V3 解密头 RIFF/AVI", head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "AVI ", JSON.stringify(head));
            const dv = new DataView(aviRaw.buffer, aviRaw.byteOffset, aviRaw.byteLength);
            const alignedSize = dv.getUint32(0x1c, true);
            check("V4 头部一致性（count==1 且 0x20+alignedSize==文件长）",
                dv.getUint32(0x10, true) === 1 && 0x20 + alignedSize === aviRaw.length,
                `count=${dv.getUint32(0x10, true)} aligned=${alignedSize} file=${aviRaw.length}`);
            // V5 解密全量自洽：加密端自引用 密文[i] = 明文[i] ^ 明文[i-1024]，
            // 以解密输出重加密后应与原始密文媒体区逐字节一致（覆盖含音频区在内的全部输出）
            let selfConsistent = true;
            let firstDiff = -1;
            for (let i = 1024; i < dec.data.length; i++) {
                if ((dec.data[i] ^ dec.data[i - 1024]) !== aviRaw[0x20 + i]) {
                    selfConsistent = false;
                    firstDiff = i;
                    break;
                }
            }
            check("V5 解密全量自洽", selfConsistent, firstDiff >= 0 ? `firstDiff@0x20+${firstDiff}` : "");
        } else {
            check("V3 解密头 RIFF/AVI", false, decError);
            check("V4 头部一致性", false, decError);
            check("V5 解密全量自洽", false, decError);
        }

        // ---------- AVI 软解链路断言（W 组，docs/npk-format.md §6.4） ----------
        if (dec) {
            let stream = null;
            let streamError = "";
            try {
                stream = extractAviVideoStream(dec.data);
            } catch (err) {
                streamError = String(err && err.message || err);
            }
            check("W1 extractAviVideoStream ES 提取", !!stream && stream.frameCount > 0 && stream.fps > 0,
                streamError || (stream ? `frames=${stream.frameCount} fps=${stream.fps.toFixed(2)}` : ""));
            if (stream) {
                const f0 = stream.frames[0];
                check("W2a isMpegVideoEs 序列头判定", isMpegVideoEs(f0) === true);
                // 解析序列头尺寸（B3 后 4 字节大端：宽 12bit + 高 12bit）
                let w = 0, h = 0;
                for (let i = 0; i + 7 < f0.length; i++) {
                    if (f0[i] === 0 && f0[i + 1] === 0 && f0[i + 2] === 1 && f0[i + 3] === 0xb3) {
                        const v = (f0[i + 4] << 24) | (f0[i + 5] << 16) | (f0[i + 6] << 8) | f0[i + 7];
                        w = (v >>> 20) & 0xfff;
                        h = (v >>> 8) & 0xfff;
                        break;
                    }
                }
                check("W2b 序列头尺寸 800×600", w === 800 && h === 600, `w=${w} h=${h}`);

                    const tsBytes = muxMpegEsToTs(stream.frames, stream.fps);
                    const playFrames = stream.frames.filter(f => f.length > 0); // 0 字节占位帧不封装
                    check("W3a TS 188 字节对齐", tsBytes.length % 188 === 0, `len=${tsBytes.length}`);
                check("W3b 首包 sync + PES 起始码",
                    tsBytes[0] === 0x47 &&
                    tsBytes[4] === 0 && tsBytes[5] === 0 && tsBytes[6] === 1 && tsBytes[7] === 0xe0);
                let allSync = true;
                for (let i = 0; i < tsBytes.length; i += 188) {
                    if (tsBytes[i] !== 0x47) { allSync = false; break; }
                }
                check("W3c 全部包 sync 0x47", allSync);

                // mux/demux 回环：JSMpeg Demuxer.TS（Node 侧加载软解库脚本）反解，payload 应逐字节还原 ES
                try {
                    globalThis.window = globalThis;
                    // JSMpeg IIFE 末尾按 document.readyState 触发 DOM 初始化，Node 侧提供最小 stub
                    globalThis.document = { readyState: "loading", addEventListener: () => {} };
                    const vendorCode = readFileSync(new URL("../src/utils/jsmpeg.min.js", import.meta.url), "utf8");
                    const JSMpeg = new Function(vendorCode + "\n;return JSMpeg;").call(globalThis);
                    const demuxer = new JSMpeg.Demuxer.TS({});
                    const sink = { pts: [], buffers: [] };
                    demuxer.connect(0xe0, { write: (pts, buffers) => { sink.pts.push(pts); sink.buffers.push(...buffers); } });
                    demuxer.write(tsBytes);
                    const esLen = playFrames.reduce((a, f) => a + f.length, 0);
                    const gotLen = sink.buffers.reduce((a, b) => a + b.length, 0);
                    check("W4a demux payload 长度 == ES 长度", gotLen === esLen, `es=${esLen} got=${gotLen} frames=${sink.pts.length}`);
                    let bytesEq = gotLen === esLen;
                    if (bytesEq) {
                        const esAll = Buffer.concat(playFrames.map(f => Buffer.from(f)));
                        const gotAll = Buffer.concat(sink.buffers.map(b => Buffer.from(b)));
                        bytesEq = esAll.equals(gotAll);
                    }
                    check("W4b demux payload 逐字节一致", bytesEq);
                    let ptsOk = sink.pts.length === playFrames.length && sink.pts[0] === 0;
                    for (let i = 1; ptsOk && i < sink.pts.length; i++) ptsOk = sink.pts[i] > sink.pts[i - 1];
                    check("W4c PTS 数量一致且单调递增", ptsOk, `pts=${sink.pts.length} playFrames=${playFrames.length}`);
                } catch (err) {
                    check("W4 mux/demux 回环", false, String(err && err.message || err));
                }

                // ---------- W5 合成含 MP2 音频 AVI 的音视频双流回环（音频封装链路） ----------
                try {
                    const put32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
                    const mkChunk = (id, data) => {
                        const b = Buffer.alloc(8 + data.length + (data.length % 2));
                        b.write(id, 0, "latin1");
                        b.writeUInt32LE(data.length, 4);
                        data.copy(b, 8);
                        return b;
                    };
                    const mkList = (type, inner) => mkChunk("LIST", Buffer.concat([Buffer.from(type, "latin1"), inner]));
                    // 视频 2 帧（MPEG 序列头 / 图像头起始），音频 2 个 MP2 帧块
                    const v0 = Buffer.from([0, 0, 1, 0xb3, 0x32, 0x02, 0x58, 0xe4, 0xff, 0xff, 0xe1, 0xa0]);
                    const v1 = Buffer.from([0, 0, 1, 0, 0x57, 0xff, 0xf8, 0x00, 0x00, 0x01, 0xb8, 0x00]);
                    const a0 = Buffer.alloc(900); a0[0] = 0xff; a0[1] = 0xfe;
                    const a1 = Buffer.alloc(900); a1[0] = 0xff; a1[1] = 0xfe;
                    const strh = fcc => { const b = Buffer.alloc(56); b.write(fcc, 0, "latin1"); return mkChunk("strh", b); };
                    const vidStrl = mkList("strl", Buffer.concat([strh("vids"), mkChunk("strf", Buffer.alloc(40))]));
                    const wave = Buffer.alloc(18);
                    wave.writeUInt16LE(0x55, 0);   // wFormatTag: MPEG Layer 3
                    wave.writeUInt16LE(2, 2);      // nChannels
                    wave.writeUInt32LE(44100, 4);  // nSamplesPerSec
                    wave.writeUInt32LE(16000, 8);  // nAvgBytesPerSec
                    const audStrl = mkList("strl", Buffer.concat([strh("auds"), mkChunk("strf", wave)]));
                    const avih = mkChunk("avih", (() => { const b = Buffer.alloc(56); b.writeUInt32LE(33366, 0); return b; })());
                    const hdrl = mkList("hdrl", Buffer.concat([avih, vidStrl, audStrl]));
                    const movi = mkList("movi", Buffer.concat([mkChunk("00dc", v0), mkChunk("00dc", v1), mkChunk("01wb", a0), mkChunk("01wb", a1)]));
                    const inner = Buffer.concat([Buffer.from("AVI ", "latin1"), hdrl, movi]);
                    const avi = Buffer.concat([Buffer.from("RIFF", "latin1"), put32(inner.length), inner, mkChunk("idx1", Buffer.alloc(0))]);

                    const stream2 = extractAviVideoStream(new Uint8Array(avi));
                    check("W5a 合成 AVI 视频音频提取", stream2.frameCount === 2 && stream2.audioChunks.length === 2 && stream2.audioByteRate === 16000 && stream2.audioFormatTag === 0x55,
                        `v=${stream2.frameCount} a=${stream2.audioChunks.length} rate=${stream2.audioByteRate} tag=0x${stream2.audioFormatTag.toString(16)}`);

                    const ts2 = muxMpegEsToTs(stream2.frames, stream2.fps, stream2.audioChunks, stream2.audioByteRate);
                    globalThis.window = globalThis;
                    globalThis.document = globalThis.document || { readyState: "loading", addEventListener: () => {} };
                    const vendorCode2 = readFileSync(new URL("../src/utils/jsmpeg.min.js", import.meta.url), "utf8");
                    const JSMpeg2 = new Function(vendorCode2 + "\n;return JSMpeg;").call(globalThis);
                    const demuxer2 = new JSMpeg2.Demuxer.TS({});
                    const vsink = { pts: [], buffers: [] };
                    const asink = { pts: [], buffers: [] };
                    demuxer2.connect(0xe0, { write: (pts, buffers) => { vsink.pts.push(pts); vsink.buffers.push(...buffers); } });
                    demuxer2.connect(0xc0, { write: (pts, buffers) => { asink.pts.push(pts); asink.buffers.push(...buffers); } });
                    demuxer2.write(ts2);

                    const aGot = Buffer.concat(asink.buffers.map(b => Buffer.from(b)));
                    const aExp = Buffer.concat([a0, a1]);
                    check("W5b demux 音频 payload 逐字节一致", asink.pts.length === 2 && aGot.equals(aExp), `writes=${asink.pts.length} len=${aGot.length}/${aExp.length}`);
                    check("W5c 音频 PTS 从 0 单调递增", asink.pts.length === 2 && asink.pts[0] === 0 && asink.pts[1] > asink.pts[0],
                        `pts0=${asink.pts[0]} pts1=${asink.pts[1]}`);
                    check("W5d demux 视频 payload 仍逐字节一致", vsink.pts.length === 2 && Buffer.concat(vsink.buffers.map(b => Buffer.from(b))).equals(Buffer.concat([v0, v1])),
                        `writes=${vsink.pts.length}`);
                } catch (err) {
                    check("W5 合成音频回环", false, String(err && err.message || err));
                }
            }
        }

        // ---------- W6 带音频加密 AVI 音频完整性（第 3 参数，docs/npk-format.md §6.4） ----------
        if (audioAviPath) {
            const aRaw = readFileSync(audioAviPath);
            let aDec = null;
            let aDecError = "";
            try {
                aDec = decryptNeopleVideo(aRaw);
            } catch (err) {
                aDecError = String(err && err.message || err);
            }
            let as = null;
            let asError = "";
            if (aDec) {
                try {
                    as = extractAviVideoStream(aDec.data);
                } catch (err) {
                    asError = String(err && err.message || err);
                }
            } else {
                asError = aDecError;
            }
            check("W6a 音频流存在（NNwb chunk + auds 字节率）", !!as && as.audioChunks.length > 0 && as.audioByteRate > 0,
                asError || (as ? `chunks=${as.audioChunks.length} rate=${as.audioByteRate}` : ""));
            check("W6b 音频格式 MPEG 层 II/III", !!as && (as.audioFormatTag === 0x50 || as.audioFormatTag === 0x55),
                as ? `tag=0x${as.audioFormatTag.toString(16)}` : asError);
            let allSync = !!as && as.audioChunks.length > 0;
            if (as) {
                for (const c of as.audioChunks) {
                    if (c.length < 2 || (c[0] & 0xff) !== 0xff || (c[1] & 0xe0) !== 0xe0) {
                        allSync = false;
                        break;
                    }
                }
            }
            check("W6c 音频帧头全部合法（MPEG 同步字）", allSync, as ? `chunks=${as.audioChunks.length}` : asError);
            let selfOk = !!aDec;
            let aDiff = -1;
            if (aDec) {
                for (let i = 1024; selfOk && i < aDec.data.length; i++) {
                    if ((aDec.data[i] ^ aDec.data[i - 1024]) !== aRaw[0x20 + i]) {
                        selfOk = false;
                        aDiff = i;
                    }
                }
            }
            check("W6d 解密自洽（含音频区）", selfOk, aDiff >= 0 ? `firstDiff@0x20+${aDiff}` : aDecError);
        } else {
            skip("W6 带音频加密 AVI 断言（未传第 3 参数）");
        }
    } else {
        skip("V 组独立加密 AVI 断言（未传第 2 参数）");
    }

    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed ? 1 : 0);
})();
