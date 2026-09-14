// ============================================================
//  TW 导出文件接口契约验证（docs/pvf-tw-format.md §12.5）
//  用法：node test/tw-export-verify.mjs [TW PVF 路径]
//  段 1：源码静态守卫（不读归档，任何环境下均运行）
//  段 2：归档契约与分支行为（默认 PVF/70TW/Script.pvf，缺失则整段 SKIP）
//
//  缺陷背景：TwPvfArchive.exportFile 曾返回 { data, name }，与 PvfArchive
//  的 { filename, blob, size } 不一致，编辑器 exportNode 取 result.blob 得到
//  undefined，URL.createObjectURL 触发 "Overload resolution failed"。
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { TwPvfArchive } from "../src/utils/pvfToolTw.js";
import { sanitizeFilename } from "../src/utils/pvfTool.js";
import { PvfFormat } from "../src/utils/pvfCodec.js";

// 二进制回退占位文本（_twDecodeBinaryText 末级回退，§12.5）：可观测契约字面
const BINARY_PLACEHOLDER_RE = /^\[二进制文件 \d+ 字节\]$/;

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function report(name, cond, detail = "") {
    if (cond) {
        passCount++;
        console.log(`  ${name}: PASS${detail ? " (" + detail + ")" : ""}`);
    } else {
        failCount++;
        console.log(`  ${name}: FAIL${detail ? " (" + detail + ")" : ""}`);
    }
}

function reportSkip(name) {
    skipCount++;
    console.log(`  ${name}: SKIP`);
}

// 取类方法体：自方法签名起至首个 4 空格缩进的闭合花括号
function sliceMethod(src, signature) {
    const start = src.indexOf(signature);
    if (start < 0) return "";
    const end = src.indexOf("\n    }", start);
    return end < 0 ? src.slice(start) : src.slice(start, end);
}

// ================= 段 1：源码静态守卫 =================
console.log("\n[段 1] 导出契约源码静态守卫");
const twSrc = readFileSync(new URL("../src/utils/pvfToolTw.js", import.meta.url), "utf8");
const jpSrc = readFileSync(new URL("../src/utils/pvfTool.js", import.meta.url), "utf8");
const editorSrc = readFileSync(new URL("../src/components/PvfEditor.vue", import.meta.url), "utf8");

const twExport = sliceMethod(twSrc, "async exportFile(file)");
const jpExport = sliceMethod(jpSrc, "async exportFile(file)");

report("TwPvfArchive.exportFile 存在", twExport.length > 0);
report("TW 导出返回 filename 字段", /\bfilename\b/.test(twExport));
report("TW 导出返回 blob 字段", /\bblob\b/.test(twExport));
report("TW 导出返回 size 字段", /\bsize\s*:/.test(twExport));
report("TW 导出复用 sanitizeFilename（与 JP 同一实现）", /sanitizeFilename\(/.test(twExport) && /sanitizeFilename/.test(twSrc.split("\n").slice(0, 20).join("\n")));
report("TW 导出不再返回旧字段 data / name", !/\breturn\s*\{\s*data\s*,\s*name\s*\}/.test(twExport) && !/\bdata\s*,\s*name\b/.test(twExport));
report("PvfArchive.exportFile 契约对照基线（JP 侧同形状）", jpExport.length > 0 && /\bfilename\b/.test(jpExport) && /\bblob\b/.test(jpExport) && /\bsize\s*:/.test(jpExport));
report("编辑器消费 result.blob", /URL\.createObjectURL\(result\.blob\)/.test(editorSrc));
report("编辑器消费 result.filename", /\.download\s*=\s*result\.filename/.test(editorSrc));
// 导出/解码共用占位文本定义：字面只在 twBinaryPlaceholder 中构造，导出侧用同一正则匹配
report("占位文本定义单点（构造与匹配共用）", /function twBinaryPlaceholder\(/.test(twSrc) && /TW_BINARY_PLACEHOLDER_RE/.test(twExport) && !/\[二进制文件/.test(twExport));
// 导出不得走缩进展示解码（§12.5 版式分层；缩进版方法仅供编辑器展示）
report("TW 导出走权威无缩进解码", /this\.decodeContent\(/.test(twExport) && !/decodeContentForEdit/.test(twExport));

// ================= 段 2：归档契约与分支行为 =================
console.log("\n[段 2] 归档导出契约（全量）+ 文本 / 二进制分支");
const PVF_PATH = process.argv[2] || "PVF/70TW/Script.pvf";
if (!existsSync(PVF_PATH)) {
    reportSkip(`归档段（未找到 ${PVF_PATH}，以命令行参数传入实际路径）`);
} else {
    const buf = readFileSync(PVF_PATH);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const arch = new TwPvfArchive(ab);
    await arch.parse();
    report("归档为 TW 层解析", arch.headerFormat === PvfFormat.TW, `${arch.files.length} 条目`);

    // ---- 全量契约 + 二进制回退分布 ----
    let checked = 0;
    const contractBad = [];
    const binaryFiles = [];
    for (const f of arch.files) {
        if (f.isDir) continue;
        const r = await arch.exportFile(f);
        checked++;
        const ok = !!r && typeof r.filename === "string" && r.filename.length > 0 && !/[\\/]/.test(r.filename) && r.blob instanceof Blob && typeof r.size === "number";
        if (!ok) {
            contractBad.push(f.name);
            continue;
        }
        if (r.blob.type === "application/octet-stream") binaryFiles.push({ name: f.name, size: r.size });
    }
    report("全量非目录条目导出契约完整", contractBad.length === 0 && checked > 0, `${checked} 条，异常 ${contractBad.length}${contractBad.length ? " 例：" + contractBad[0] : ""}`);
    // 基线数据特征：70TW 全量仅 1 个二进制回退文件（可执行体，90047B）
    report("二进制回退文件计数基线（1 个，非占位文本写盘）", binaryFiles.length === 1 && binaryFiles[0].size === 90047, JSON.stringify(binaryFiles));

    // ---- 文本分支：导出文本 == 权威无缩进 decodeContent ----
    async function checkTextBranch(label, predicate) {
        const f = arch.files.find(x => !x.isDir && x.dataSize > 10 && predicate(x));
        if (!f) {
            reportSkip(`${label} 文本分支（基线无该类型文件）`);
            return null;
        }
        const data = await arch.getFileData(f);
        const text = arch.decodeContent(f, data);
        if (BINARY_PLACEHOLDER_RE.test(text)) {
            reportSkip(`${label} 文本分支（取样落二进制回退）`);
            return null;
        }
        const r = await arch.exportFile(f);
        // 契约不符时先报 FAIL 再中止该取样，避免抛错中断后续断言（缺陷现场：blob 为 undefined）
        if (!r || !(r.blob instanceof Blob)) {
            const got = r ? `{ ${Object.keys(r).join(", ")} }` : String(r);
            report(`${label} 导出返回 blob`, false, `实际返回 ${got}`);
            report(`${label} 导出文本 == decodeContent`, false, "无 blob，无法比对");
            report(`${label} MIME / size / filename`, false, "无 blob，无法比对");
            return null;
        }
        const blobText = await r.blob.text();
        report(`${label} 导出文本 == decodeContent`, blobText === text, `逐字比对 ${f.name}`);
        report(
            `${label} MIME / size / filename`,
            r.blob.type === "text/plain;charset=utf-8" && r.size === text.length && r.filename === sanitizeFilename(f.name),
            `type=${r.blob.type} size=${r.size}/${text.length} name=${r.filename}`
        );
        return { f, data, text };
    }

    await checkTextBranch(".stk token 脚本", x => /\.stk$/i.test(x.name));
    await checkTextBranch(".lst 引用表", x => /\.lst$/i.test(x.name));
    await checkTextBranch(".ani 动画", x => /\.ani$/i.test(x.name));
    await checkTextBranch(".nut 明文脚本", x => /\.nut$/i.test(x.name));
    await checkTextBranch(".str 字符串表", x => /\.str$/i.test(x.name) && !/^stringtable\.bin$/i.test(x.name));

    // ---- 导出与缩进展示解码分层（§12.5 / pvfine 参考 §4）----
    const tok = arch.files.find(x => !x.isDir && /\.(stk|eqp|obj)$/i.test(x.name) && x.dataSize > 200);
    if (tok) {
        const data = await arch.getFileData(tok);
        const plain = arch.decodeContent(tok, data);
        const indented = arch.decodeContentForEdit(tok, data);
        const r = await arch.exportFile(tok);
        const blobText = r && r.blob instanceof Blob ? await r.blob.text() : null;
        report("导出保持权威无缩进（缩进仅编辑器展示）", blobText === plain && (indented === plain || blobText !== indented), `indented≠plain: ${indented !== plain} (${tok.name})`);
    } else {
        reportSkip("导出与缩进展示分层（基线无 token 脚本样本）");
    }

    // ---- 二进制分支：保留原始字节 ----
    if (binaryFiles.length > 0) {
        const bf = arch.files.find(x => x.name === binaryFiles[0].name);
        const data = await arch.getFileData(bf);
        const decoded = arch.decodeContent(bf, data);
        const r = await arch.exportFile(bf);
        const bytes = r && r.blob instanceof Blob ? new Uint8Array(await r.blob.arrayBuffer()) : new Uint8Array(0);
        const same = bytes.length === data.length && bytes.every((b, i) => b === data[i]);
        report("二进制回退判定依据（decodeContent 落占位文本）", BINARY_PLACEHOLDER_RE.test(decoded), JSON.stringify(decoded));
        report("二进制文件导出保留原始字节", same && r.blob.type === "application/octet-stream" && r.size === data.length, `bytes=${bytes.length}/${data.length} size=${r.size}`);
        report("二进制不按占位文本写盘（size 为字节数）", same && r.size === data.length && r.size !== decoded.length, `size=${r.size} 占位文本长=${decoded.length}`);
    } else {
        reportSkip("二进制分支断言（基线无二进制回退文件）");
    }
}

console.log(`\n汇总: PASS ${passCount} / FAIL ${failCount} / SKIP ${skipCount}`);
if (failCount > 0) process.exit(1);
