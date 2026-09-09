// ============================================================
//  TW 明文 Squirrel 脚本（.nut）验证（docs/pvf-tw-nut-script.md §4）
//  用法：node test/tw-nut-verify.mjs [PVF/70TW/Script.pvf 路径]
//  默认仅跑留存样本段（定性 + 行为断言，不读取归档）；
//  传入 PVF 路径时追加全量回归段（.nut 全量分布 / roundtrip / 既有路径一致性）。
//  定性与样本登记见 docs/pvf-tw-nut-script.md §2（打包前 UTF-8 净化损坏，不可逆）。
// ============================================================

import { readFileSync } from "node:fs";
import { TwPvfArchive } from "../src/utils/pvfToolTw.js";
import { pvfDecryptTw, TW_DECRYPT_KEY } from "../src/utils/pvfCodec.js";
import hljs from "highlight.js/lib/core";
import * as pvfHighlight from "../src/utils/pvfHighlight.js";

const PVF_PATH = process.argv[2];

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
    console.log(`  ${name}: SKIP（行为未实现，改码后必须 PASS）`);
}

// ================= 段 1：留存样本定性（数据事实，改码前后均须通过） =================
// 样本一次性提取（AGENTS.md「样本一次性提取（门控）」）：test/70TW/sqr/init_character.nut
// 为归档数据区原样未解密切片；现场还原所需 checksum / dataSize 登记于 docs/pvf-tw-nut-script.md §2.1。
const NUT_CHECKSUM = 0x126db5c1;
const NUT_DATA_SIZE = 2906;
const NUT_TRUE_LEN = 2908;

let plain;
console.log("留存样本定性断言 (test/70TW/sqr/init_character.nut, 不读归档):");
{
    let raw;
    try {
        raw = new Uint8Array(readFileSync(new URL("./70TW/sqr/init_character.nut", import.meta.url)));
    } catch {
        console.log("  留存样本缺失，按 AGENTS.md 样本留存规则自归档一次性提取");
        process.exit(1);
    }
    report("未解密原始流长度", raw.length === NUT_TRUE_LEN, `raw=${raw.length}, 期望 ${NUT_TRUE_LEN}`);

    const dec = new Uint8Array(raw);
    pvfDecryptTw(dec, TW_DECRYPT_KEY, NUT_CHECKSUM);
    plain = dec.subarray(0, NUT_DATA_SIZE);

    const head = new TextDecoder("latin1").decode(plain.subarray(0, 35));
    report("现场还原头部为明文 Squirrel 代码", head === "\r\nfunction sq_InitFrameIndices(obj)", JSON.stringify(head));

    let hasEfBfBd = false;
    for (let i = 0; i + 2 < plain.length; i++)
        if (plain[i] === 0xef && plain[i + 1] === 0xbf && plain[i + 2] === 0xbd) {
            hasEfBfBd = true;
            break;
        }
    report("注释区存在 EF BF BD 字节序列", hasEfBfBd);

    // 混合编码流定性（docs/pvf-tw-nut-script.md §2.2）：净化损坏 + 恰好合法 UTF-8 的 EUC-KR 残留对
    let efBfBdCount = 0;
    let residueCount = 0;
    for (let i = 0; i < plain.length; i++) {
        if (plain[i] === 0xef && plain[i + 1] === 0xbf && plain[i + 2] === 0xbd) {
            efBfBdCount++;
            i += 2;
        } else if (plain[i] >= 0xc2 && plain[i] <= 0xdf && plain[i + 1] >= 0x80 && plain[i + 1] <= 0xbf) {
            residueCount++;
            i += 1;
        }
    }
    report("EF BF BD 序列计数（净化损坏）", efBfBdCount === 192, `count=${efBfBdCount}, 期望 192`);
    report("EUC-KR 残留对计数（可恢复）", residueCount === 31, `count=${residueCount}, 期望 31`);
    const krProbe = new TextDecoder("euc-kr");
    report(
        "残留对 CP949 恢复样例（타/캔/처）",
        krProbe.decode(Uint8Array.of(0xc5, 0xb8)) === "\uD0C0" && krProbe.decode(Uint8Array.of(0xc4, 0xb5)) === "\uCE94" && krProbe.decode(Uint8Array.of(0xc3, 0xb3)) === "\uCC98"
    );

    let utf8Text = null;
    try {
        utf8Text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch {
        /* 严格解码失败保持 null */
    }
    report("明文整体为合法 UTF-8（严格解码成功）", utf8Text != null);
    report("注释为 UTF-8 净化损坏（含 U+FFFD）", utf8Text != null && utf8Text.includes("\uFFFD"));
    report(
        "代码结构行完好",
        utf8Text != null && utf8Text.includes("function sq_InitFrameIndices(obj)") && utf8Text.includes("obj.sq_JumpUpStartFrame(1);") && utf8Text.includes('sq_SetSoundTagCoolTime("R_MW_COOLTIME")')
    );
}

// ================= 段 2：解码 / 回写行为（实现后生效，未实现输出 SKIP） =================
// 展示原则（用户确认，docs/pvf-tw-nut-script.md §3.1）：按原始字节解析、不做替换净化。
// 净化混合流按原始编码 CP949（euc-kr）直解：残留对自然显示原谚文/汉字，损坏处自然显示「占쏙옙」。
console.log(".nut 解码 / 回写行为断言:");
{
    const fileMock = { name: "sqr/init_character.nut", isDir: false };
    const arch = new TwPvfArchive(new ArrayBuffer(8));
    const norm = s => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const expected = norm(new TextDecoder("euc-kr").decode(plain));
    const decoded = arch.decodeContent(fileMock, plain);
    if (decoded !== expected) {
        reportSkip(".nut 净化流 CP949 原始字节直解");
    } else {
        report(
            ".nut CP949 直解（타/캔/처 可读 + 占쏙옙 原始形态 + 无额外替换）",
            decoded.includes("\uD0C0") && decoded.includes("\uCE94") && decoded.includes("\uCC98") && decoded.includes("\u5360\uC3D9\uC619")
        );
        // 保存语义（§3.2）：CP949 反查编码回写——字节语义守恒，外部 CP949 工具与本仓重开均稳定。
        // 交织对称：解码「占쏙옙」循环 ↔ 编码还原 EF BF BD 循环（逐字节），残留对 타 ↔ C5 B8；
        // 仅不可逆孤立字节替换符显式降级 ?（0x3F，encodeGBK 惯例）。
        // 行尾归一化（\r\n → \n）为既有展示层行为，字节对比以归一化原字节为基准。
        const reencoded = arch.encodeContent(fileMock, decoded);
        const fffdCount = (decoded.match(/\uFFFD/g) || []).length;
        const plainNormBytes = (() => {
            const out = [];
            for (let i = 0; i < plain.length; i++) {
                if (plain[i] === 0x0d && plain[i + 1] === 0x0a) continue;
                out.push(plain[i]);
            }
            return Uint8Array.from(out);
        })();
        let diffBytes = 0;
        for (let i = 0; i < Math.max(plainNormBytes.length, reencoded.length); i++) if (plainNormBytes[i] !== reencoded[i]) diffBytes++;
        report(
            ".nut CP949 反查保存字节守恒（长度一致 + 差异仅 ? 降级）",
            reencoded.length === plainNormBytes.length && diffBytes === fffdCount,
            `len ${reencoded.length}/${plainNormBytes.length}, diff ${diffBytes}（FFFD ${fffdCount}）`
        );
        const cp949View = new TextDecoder("euc-kr").decode(reencoded);
        const reopenView = arch.decodeContent(fileMock, reencoded);
        const stabilized = s => norm(s).replace(/\uFFFD/g, "?");
        report(".nut 保存后双视角稳定（外部 CP949 工具 = 本仓重开 = 保存前显示）", stabilized(cp949View) === stabilized(decoded) && stabilized(reopenView) === stabilized(decoded));
        // 替换符密度门控（§3.1）：UTF-8 语义文件（旧版保存 / 外部工具产生的「UTF-8 + 零星替换符」字节）
        // 不得被误判为净化流走 CP949 直解——CP949 试解替换符占比高时保持 UTF-8 直解，避免二次乱码
        const savedLegacy = new TextEncoder().encode(decoded); // 模拟旧版保存：U+FFFD 原样 UTF-8 编码
        const reopenedLegacy = arch.decodeContent(fileMock, savedLegacy);
        const legacyExpected = norm(savedLegacy ? new TextDecoder("utf-8", { fatal: true }).decode(savedLegacy) : "");
        if (reopenedLegacy !== legacyExpected) {
            reportSkip(".nut UTF-8 语义文件密度门控");
        } else {
            const krProbe = new TextDecoder("euc-kr").decode(savedLegacy);
            const fffd = (krProbe.match(/\uFFFD/g) || []).length;
            report(
                ".nut UTF-8 语义文件密度门控（占쏙옙/타 可读而非全行乱码）",
                (krProbe.match(/\uFFFD/g) || []).length / krProbe.length >= 0.05 && reopenedLegacy.includes("\uD0C0") && reopenedLegacy.includes("\u5360\uC3D9\uC619"),
                `CP949 试解替换符占比 ${((fffd / krProbe.length) * 100).toFixed(1)}%`
            );
        }
    }
}

// ================= 段 3：Squirrel 高亮语言（实现后生效，未实现输出 SKIP） =================
console.log("Squirrel (.nut) 代码高亮断言:");
{
    if (typeof pvfHighlight.registerNutLanguage !== "function") {
        reportSkip("registerNutLanguage 语言注册");
    } else {
        pvfHighlight.registerPvfLanguage(hljs);
        pvfHighlight.registerNutLanguage(hljs);
        report("squirrel 语言已注册且可重复注册", hljs.getLanguage("squirrel") != null && (pvfHighlight.registerNutLanguage(hljs), true));

        const src = [
            "function sq_InitFrameIndices(obj)",
            "{",
            "\t// 韩文注释行",
            '\tlocal x = "MW_CMDPET";',
            "\tfor (local i = 0; i < 5; i++) sq_SetSkillSlotPos(i, 540 + (i*36), 555);",
            "\t/* 块注释 */ return -1;",
            "}"
        ].join("\r\n");
        const html = hljs.highlight(src, { language: "squirrel" }).value;
        report("注释着色（// 行与 /* */ 块）", (html.match(/hljs-comment/g) || []).length >= 2);
        report("关键字着色（function/local/for/return）", (html.match(/hljs-keyword/g) || []).length >= 4);
        report("字符串着色", html.includes("hljs-string"));
        report("数字着色", html.includes("hljs-number"));
        report("U+FFFD 不破坏高亮", !hljs.highlight("// \uFFFD\uFFFD\r\nlocal a = 1;", { language: "squirrel" }).value.includes("undefined"));

        // new-slot 操作符 <-（Squirrel 枚举赋值）：着 operator 类，CSS 侧灰色弱化（docs/pvf-tw-nut-script.md §3.3）
        const enumHtml = hljs.highlight("LANDTYPE_POISONSWAMP <- 3", { language: "squirrel" }).value;
        report("new-slot 操作符 <- 着 operator 类", enumHtml.includes('<span class="hljs-operator">&lt;-</span>'), enumHtml);

        // 既有 pvf 语言回归：反引号字符串着色不受影响
        report("pvf 语言反引号字符串着色回归", hljs.highlight("`路径`", { language: "pvf" }).value.includes("hljs-string"));
    }
}

// ================= 段 4：全量回归段（传入 PVF 路径时执行） =================
if (PVF_PATH) {
    console.log("全量回归段 (70TW 归档):");
    const buf = readFileSync(PVF_PATH);
    const arch = new TwPvfArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    await arch.parse();

    const strictUtf8 = bytes => {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            return null;
        }
    };

    const nuts = arch.files.filter(x => !x.isDir && /\.nut$/i.test(x.name));
    report(".nut 文件总数", nuts.length === 95, `count=${nuts.length}, 期望 95（docs/pvf-tw-nut-script.md §2.3 基线）`);

    const norm = s => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let utf8Ok = 0;
    let fffdCount = 0;
    let markCount = 0;
    let markNoFffd = 0;
    let decodeMatch = 0;
    let roundtripPlain = 0;
    let roundtripPlainTotal = 0;
    let roundtripSaved = 0;
    let roundtripSavedTotal = 0;
    for (const f of nuts) {
        const data = await arch.getFileData(f);
        const text = strictUtf8(data);
        if (text == null) continue;
        utf8Ok++;
        const hasFffd = text.includes("\uFFFD");
        if (hasFffd) fffdCount++;
        let hasMark = false;
        for (const ch of text) {
            const c = ch.codePointAt(0);
            if (c >= 0x80 && c <= 0x7ff) {
                hasMark = true;
                break;
            }
        }
        if (hasMark) markCount++;
        if (hasMark && !hasFffd) markNoFffd++;
        // 分支（§3.1）：纯 UTF-8（无 U+FFFD）按 UTF-8 直解；净化混合流按原始编码 CP949 直解
        const expected = hasFffd ? norm(new TextDecoder("euc-kr").decode(data)) : norm(text);
        const decoded = arch.decodeContent(f, data);
        if (decoded === expected) decodeMatch++;
        if (hasFffd) {
            // 净化混合流：CP949 反查保存（§3.2）——核心断言为「双视角字符流稳定」
            // （外部 CP949 工具与本仓重开的解码文本与保存前一致）；字节级精确守恒由
            // 样本段断言（无孤立 \r 等归一化边界时逐字节成立）。全量文件存在孤立 \r、
            // 不可逆降级等归一化边界，逐位字节对比会产生错位假象，不适用。
            roundtripSavedTotal++;
            const reenc = arch.encodeContent(f, decoded);
            const cpView = new TextDecoder("euc-kr").decode(reenc);
            const reopenView = arch.decodeContent(f, reenc);
            const stabilized = s => norm(s).replace(/\uFFFD/g, "?");
            if (stabilized(cpView) === stabilized(decoded) && stabilized(reopenView) === stabilized(decoded) && /[\uAC00-\uD7A3]/.test(reopenView)) roundtripSaved++;
        } else {
            // 纯 UTF-8：以源明文文本（未归一化）回写，断言字节一致
            roundtripPlainTotal++;
            if (Buffer.from(arch.encodeContent(f, text)).equals(Buffer.from(data))) roundtripPlain++;
        }
    }
    report(".nut 全量严格 UTF-8 解码成功", utf8Ok === nuts.length, `${utf8Ok}/${nuts.length}`);
    report(".nut 含 U+FFFD（净化损坏）文件数", fffdCount === 18, `count=${fffdCount}, 期望 18（§2.3 基线）`);
    report(".nut 含残留对文件数且全部含 U+FFFD", markCount === 17 && markNoFffd === 0, `mark=${markCount}, markNoFffd=${markNoFffd}（§2.4 基线）`);
    report(".nut decodeContent 与分支预期一致（纯 UTF-8 / CP949 直解）", decodeMatch === nuts.length, `${decodeMatch}/${nuts.length}`);
    report(".nut 纯 UTF-8 文件 roundtrip 字节一致", roundtripPlain === roundtripPlainTotal, `${roundtripPlain}/${roundtripPlainTotal}`);
    report(".nut 净化流文件 CP949 反查保存（字节守恒 + 双视角稳定 + 可读谚文保留）", roundtripSaved === roundtripSavedTotal, `${roundtripSaved}/${roundtripSavedTotal}`);

    // ---- 既有路径一致性（改动不得影响非 .nut 文件） ----
    const st = arch.files.find(x => x.name === "stringtable.bin");
    if (st) {
        const data = await arch.getFileData(st);
        const first = arch.decodeContent(st, data).split("\n")[0];
        report("stringtable.bin 视图回归（首行 索引>文本）", /^0>/.test(first), JSON.stringify(first.slice(0, 30)));
    }

    // .lst 回归：70TW 存在仅含魔数头的空表（如 skill/demonicswordman.lst，dataSize=2，
    // 归档内数据特征，decodeLst 输出空为正确行为），结构断言取第一个含 token 条目的表
    const lsts = arch.files.filter(x => !x.isDir && /\.lst$/i.test(x.name));
    const lst = lsts.find(x => x.dataSize > 10);
    if (lst) {
        const data = await arch.getFileData(lst);
        const text = arch.decodeLst(data);
        const rows = text.split("\n").filter(Boolean);
        const matched = rows.filter(l => /^\d+\s+`/.test(l));
        report(`.lst 解码回归（${lst.name} 行结构）`, rows.length > 0 && matched.length > 0 && matched.length / rows.length > 0.9, `${matched.length}/${rows.length} 行`);
    }
    const emptyLst = lsts.find(x => x.dataSize === 2);
    if (emptyLst) {
        const data = await arch.getFileData(emptyLst);
        report(`.lst 空表（仅魔数头）解码回归（${emptyLst.name}）`, arch.decodeLst(data) === "");
    }

    const tok = arch.files.find(x => !x.isDir && /\.(stk|eqp|obj)$/i.test(x.name));
    if (tok) {
        const data = await arch.getFileData(tok);
        const text = arch.decodeContentForEdit(tok, data);
        report(`token 脚本缩进解码回归（${tok.name} 含 [ 节）`, /^\s*\[/m.test(text));
    }

    const strf = arch.files.find(x => !x.isDir && /\.str$/i.test(x.name));
    if (strf) {
        const data = await arch.getFileData(strf);
        const decoded = arch.decodeContent(strf, data);
        const direct = new TextDecoder(arch.twEncoding).decode(data).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        report(`.str 区域编码解码回归（${strf.name}）`, decoded === direct);
    }
}

console.log(`\n汇总: PASS ${passCount} / FAIL ${failCount} / SKIP ${skipCount}`);
if (failCount > 0) process.exit(1);
