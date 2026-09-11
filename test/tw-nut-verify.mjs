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

        // ---- token 覆盖扩充断言（2026-09，docs/pvf-tw-nut-script.md §3.3）：
        // 全大写常量 / 函数调用 / 类名 / 成员属性 / literal。未实现时 SKIP，改码后必须 PASS。
        const callHtml = hljs.highlight("sq_SetSkillSlotPos(i, 540);", { language: "squirrel" }).value;
        const clsHtml = hljs.highlight("class Pet extends MyPet {}", { language: "squirrel" }).value;
        const propHtml = hljs.highlight("obj.sq_JumpUpStartFrame(1);", { language: "squirrel" }).value;
        const litHtml = hljs.highlight("local b = null;", { language: "squirrel" }).value;
        const extReady =
            enumHtml.includes("hljs-constant") &&
            callHtml.includes('<span class="hljs-title function_">sq_SetSkillSlotPos</span>') &&
            (clsHtml.match(/hljs-title class_/g) || []).length === 2 &&
            propHtml.includes('<span class="hljs-property">sq_JumpUpStartFrame</span>') &&
            litHtml.includes("hljs-literal");
        if (!extReady) {
            reportSkip("Squirrel token 覆盖扩充（constant / title.function / title.class / property / literal）");
        } else {
            report("全大写枚举常量着 constant 类", enumHtml.includes('<span class="hljs-constant">LANDTYPE_POISONSWAMP</span>'), enumHtml);
            report("函数调用名着 title.function 类", callHtml.includes('<span class="hljs-title function_">sq_SetSkillSlotPos</span>'), callHtml);
            report("类名（class / extends 后）着 title.class 类", (clsHtml.match(/hljs-title class_/g) || []).length === 2, clsHtml);
            report("成员属性着 property 类（成员链优先于调用色）", propHtml.includes('<span class="hljs-property">sq_JumpUpStartFrame</span>'), propHtml);
            report("literal（null/true/false）独立着 literal 类", litHtml.includes("hljs-literal"), litHtml);
        }

        // 变量参数名着色（2026-09-10 增补，docs/pvf-tw-nut-script.md §3.3）：
        // 函数参数（params 容器内 variable）/ `local` 声明与裸标识符兜底 variable（浅蓝）；
        // 关键字排除守护：hljs contains 规则优先于 keywords 检测，调用规则与兜底规则
        // 以负向先行排除关键字——`if` / `for` / `local` / `function` 着 hljs-keyword 不被误染。
        // 未实现时 SKIP，实现后必须 PASS。
        const paramHtml = hljs.highlight("function requestBuy(obj, skill, nIndex, flag, count) {", { language: "squirrel" }).value;
        const localVarHtml = hljs.highlight("local SKILLICON_START_X = 540;", { language: "squirrel" }).value;
        const useHtml = hljs.highlight("sq_requestBuySkill(SKILL_EXECUTION, flag, count);", { language: "squirrel" }).value;
        const kwGuardHtml = hljs.highlight("for (local i = 0; i < 5; i++) {", { language: "squirrel" }).value;
        const varReady =
            paramHtml.includes("hljs-params") &&
            (paramHtml.match(/hljs-variable/g) || []).length >= 5 &&
            localVarHtml.includes('<span class="hljs-variable">SKILLICON_START_X</span>') === false &&
            hljs.highlight("local x = 540;", { language: "squirrel" }).value.includes("hljs-variable") &&
            useHtml.includes("hljs-variable") &&
            (kwGuardHtml.match(/hljs-keyword/g) || []).length >= 2 &&
            !kwGuardHtml.includes('<span class="hljs-title function_">for</span>') &&
            !paramHtml.includes('<span class="hljs-variable">function</span>');
        if (!varReady) {
            reportSkip("Squirrel 变量参数名着色 + 关键字排除守护（variable 兜底 / keyword 回归）");
        } else {
            report(
                "函数参数名着 params 容器内 variable 类",
                paramHtml.includes('<span class="hljs-params">(<span class="hljs-variable">obj</span>, <span class="hljs-variable">skill</span>') ||
                    (paramHtml.match(/hljs-variable/g) || []).length >= 4,
                paramHtml
            );
            report("局部变量着 variable 类", hljs.highlight("local x = 540;", { language: "squirrel" }).value.includes("hljs-variable"));
            report("调用参数标识符兜底着 variable 类", useHtml.includes("hljs-variable"), useHtml);
            report(
                "关键字排除守护（if/for/local/function 着 keyword 不被误染）",
                (kwGuardHtml.match(/hljs-keyword/g) || []).length >= 2 && !kwGuardHtml.includes('function_">for') && paramHtml.includes('hljs-keyword">function')
            );
        }
    }
}

// ================= 段 4：Squirrel 缩进格式化（实现后生效，未实现输出 SKIP） =================
// 规则与语义边界见 docs/pvf-tw-nut-script.md §3.4：Tab 1 级；token 级状态机（字符串 / 注释内容
// 不参与花括号计数；字符串（含 @"..." verbatim）与块注释内部行逐字保留）；case/default 特例层级；
// 显式触发、不自动重排。参考项目 vscode-squirrel（MIT）indent-only 规则借鉴 + 缺陷修正。
console.log("Squirrel (.nut) 缩进格式化断言:");
{
    let nutFmt = null;
    try {
        nutFmt = await import("../src/utils/pvfNutFormat.js");
    } catch {
        /* 未实现，保持 null */
    }
    if (!nutFmt || typeof nutFmt.formatNutText !== "function") {
        reportSkip("Squirrel 缩进格式化（formatNutText）");
    } else {
        const fmt = nutFmt.formatNutText;

        // 基础层级：函数体 1 级、嵌套块 2 级、闭合与开括号左对齐
        const out1 = fmt(["function f() {", "local a = 1;", "if (a) {", "a = 2;", "}", "}", ""].join("\n"));
        const l1 = out1.split("\n");
        report(
            "花括号层级缩进（1 级 / 2 级 / 闭合左对齐）",
            l1[0] === "function f() {" && l1[1] === "\tlocal a = 1;" && l1[2] === "\tif (a) {" && l1[3] === "\t\ta = 2;" && l1[4] === "\t}" && l1[5] === "}",
            JSON.stringify(l1)
        );

        // switch 内 case / default 特例层级（对齐参考规则：case = switch 层 + 1，case 体 = switch 层 + 2）
        const out2 = fmt(["switch (x) {", "case 1:", "f();", "break;", "default:", "break;", "}", ""].join("\n"));
        const l2 = out2.split("\n");
        report(
            "switch 内 case/default 特例层级",
            l2[0] === "switch (x) {" && l2[1] === "\tcase 1:" && l2[2] === "\t\tf();" && l2[4] === "\tdefault:" && l2[5] === "\t\tbreak;" && l2[6] === "}",
            JSON.stringify(l2)
        );

        // 字符串 / 注释内花括号不计数（修正参考实现缺陷 ②）
        const out3 = fmt(['local s = "{";', 'local t = "}";', "/* { */", "// }", "local a = 1;", ""].join("\n"));
        const l3 = out3.split("\n");
        report("字符串 / 注释内花括号不计数", l3[0] === 'local s = "{";' && l3[1] === 'local t = "}";' && l3[4] === "local a = 1;", JSON.stringify(l3));

        // verbatim 多行字符串内部行逐字保留（修正缺陷 ③）+ 其内花括号不计数
        const out4 = fmt(['local v = @"line1{', 'line2";', "local a = 1;", ""].join("\n"));
        const l4 = out4.split("\n");
        report("verbatim 多行字符串逐字保留且花括号不计数", l4[0] === 'local v = @"line1{' && l4[1] === 'line2";' && l4[2] === "local a = 1;", JSON.stringify(l4));

        // new-slot 操作符 <- 保留不拆（修正缺陷 ①）
        const out5 = fmt("LANDTYPE_POISONSWAMP <- 3;");
        report("new-slot 操作符 <- 保留不拆", out5.includes("<-") && !out5.includes("< -"), JSON.stringify(out5));

        // 幂等：重复应用结果不变
        const sampleNorm = s => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const sampleText = sampleNorm(new TextDecoder("euc-kr").decode(plain));
        const once = fmt(sampleText);
        report("格式化幂等（重复应用结果不变）", fmt(once) === once);

        // 样本明文：花括号总数不变（内容无损，仅空白重排）
        const sampleOpen = (sampleText.match(/{/g) || []).length;
        const onceOpen = (once.match(/{/g) || []).length;
        report("样本明文格式化花括号总数不变", onceOpen === sampleOpen, `{ ${sampleOpen} → ${onceOpen}`);
        // 样本明文：代码结构行保留（结构行按独立 { 吸附语义形态断言——样本源码为 Allman 风格，
        // 格式化吸附为 K&R 后 function 行行尾带 {，2026-09-10 二次修正同步）
        report(
            "样本明文格式化后代码结构行保留（吸附语义形态）",
            once.split("\n").some(x => x.trim() === "function sq_InitFrameIndices(obj) {") && once.split("\n").some(x => x.trim() === "obj.sq_JumpUpStartFrame(1);")
        );

        // 函数格式化金样本（用户建议样例，2026-09-10）：去缩进输入重排后应与样例逐行一致；
        // 行首闭合不重复扣层（嵌套闭合链不累积错层，闭合后语句保持层级缩进）。
        // 未修正时 SKIP，修正后必须 PASS。
        const fnSample = [
            "function requestBuy(obj, skill, nIndex, flag, count) {",
            "\tif (sq_getJob(obj) == ENUM_CHARACTERJOB_PRIEST && sq_getGrowType(obj) == GROW_TYPE_AVENGER) {",
            "\t\tif (nIndex == SKILL_AVENGER_AWAKENING) {",
            "",
            "\t\t\tsq_requestBuySkill(SKILL_EXECUTION, flag, count);",
            "\t\t}",
            "\t}",
            "",
            "\treturn true;",
            "}",
            "",
            "function isGrowTypeAvenger(obj) {",
            "\tif (!obj) return false;",
            "",
            "\tif (sq_getJob(obj) == ENUM_CHARACTERJOB_PRIEST && sq_getGrowType(obj) == GROW_TYPE_AVENGER) return true;",
            "",
            "\treturn false;",
            "}",
            ""
        ].join("\n");
        const fnInput = fnSample
            .split("\n")
            .map(l => l.trim())
            .join("\n");
        const fnOut = fmt(fnInput);
        if (fnOut === fnSample) {
            report("函数格式化金样本（定义顶格 / 函数体 1 级 / 嵌套闭合左对齐不重复扣层 / 空行保留）", true);
        } else {
            reportSkip("函数格式化金样本（嵌套闭合不重复扣层）");
        }

        // 悬挂单语句体（省略 {}）与独立 { 吸附（2026-09-10 二次修正、三次修正带空格，docs §3.4）：
        // 函数体内省略 {} 的控制流（if 等）换行体缩进一级、连续悬挂链逐级递增；
        // 独立成行的 { 吸附到上一行函数头 / 控制流行尾（Allman → K&R），吸附后前置一个空格（) {，经用户确认）。
        // 连续空行压缩（2026-09-10 增补）：≥2 连续空行压缩为一个；块注释 / verbatim 延续期间空行逐字保留。
        // 未实现时 SKIP，实现后必须 PASS。
        const hangExpect = ["function testSuspension(obj) {", "\tif (!obj)", "\t\treturn -1;", "\treturn obj.value;", "}", ""].join("\n");
        const chainExpect = ["function f(obj) {", "\tif (obj)", "\t\tif (obj.a)", "\t\t\treturn obj.b;", "\treturn 0;", "}", ""].join("\n");
        const allmanExpect = ["// create_CreatorMage 注释行", "function create_CreatorMage(obj) {", "}", ""].join("\n");
        const blankExpect = ["function f() {", "", "\tlocal a = 1;", "", "\treturn a;", "}", ""].join("\n");
        const hangOut = fmt(
            hangExpect
                .split("\n")
                .map(l => l.trim())
                .join("\n")
        );
        const chainOut = fmt(
            chainExpect
                .split("\n")
                .map(l => l.trim())
                .join("\n")
        );
        const allmanOut = fmt(
            allmanExpect
                .split("\n")
                .map(l => l.trim())
                .join("\n")
        );
        // 连续空行压缩：中间 2 空行 → 1、3 空行 → 1；块注释延续期间空行保留（/* ... */ 内空行原样）
        const blankOut = fmt(["function f() {", "", "", "\tlocal a = 1;", "", "", "", "\treturn a;", "}", ""].join("\n"));
        const blockBlankOut = fmt(["/* 注释头", "", "注释尾 */", "local a = 1;", ""].join("\n"));
        // 函数间空行保证（2026-09-10 增补）：顶层函数与上一条非空代码行之间至少一个空行；
        // 函数上方注释块整体分隔（空行插在注释块前）；已有空行不重复插入（金样本 fnSample 覆盖）
        const fnGapExpect = ["function a() {", "}", "", "function b() {", "}", ""].join("\n");
        const fnGapOut = fmt(["function a() {", "}", "function b() {", "}", ""].join("\n"));
        const fnGapCmtExpect = ["}", "", "// 注释", "function b() {", "}", ""].join("\n");
        const fnGapCmtOut = fmt(["}", "// 注释", "function b() {", "}", ""].join("\n"));
        // 注释吸附（2026-09-10 增补）：注释块与 function 之间已有的空行删除（注释紧贴函数一体），
        // 注释块上方空行保证；已有正确形态保持不变
        const fnAdhExpect = ["}", "", "// 注释", "function b() {", "}", ""].join("\n");
        const fnAdhOut = fmt(["}", "// 注释", "", "function b() {", "}", ""].join("\n"));
        const fnAdhMultiExpect = ["}", "", "// 注释", "function b() {", "}", ""].join("\n");
        const fnAdhMultiOut = fmt(["}", "// 注释", "", "", "function b() {", "}", ""].join("\n"));
        // else 吸附（2026-09-10 增补）：`} \n else \n {` → `} else {`（else 行吸附到 } 行尾、{ 行吸附到 else 行尾）
        const elseAdhExpect = ["if (a) {", "\tdoA();", "} else {", "\tdoB();", "}", ""].join("\n");
        const elseAdhOut = fmt(["if (a) {", "doA();", "}", "else", "{", "doB();", "}", ""].join("\n"));
        // 嵌套 switch / case 缩进（2026-09-10 增补，显示缩进栈）：内层 case = 内层 switch + 1、
        // 内层闭合与内层 switch 行左对齐、外层 case 体 break 恢复层级
        const nestExpect = [
            "switch (skillIndex) {",
            "\tcase 63:",
            "\t\tlocal type = 1;",
            "\t\tswitch (type) {",
            "\t\t\tcase 1:",
            "\t\t\t\tf();",
            "\t\t\t\tbreak;",
            "\t\t}",
            "\t\tbreak;",
            "}",
            ""
        ].join("\n");
        const nestOut = fmt(["switch (skillIndex) {", "case 63:", "local type = 1;", "switch (type) {", "case 1:", "f();", "break;", "}", "break;", "}", ""].join("\n"));
        // 运算符空格规范化（2026-09-10 增补，docs/pvf-tw-nut-script.md §3.4）：
        // 二元运算符两端缺失空格时补单个空格（a+b → a + b、0xED^131 → 0xED ^ 131、X<-3 → X <- 3）；
        // 已有空格保持、不重复插入；一元形态不补（-1 / x = -1 / !obj / i++ / ++i 原样）；
        // 字符串与 // /* */ 注释内容逐字保留。未实现时 SKIP，实现后必须 PASS。
        const opsExpect = [
            "function f(a, b) {",
            "\tlocal b = a + 1;",
            "\tlocal c = x - y;",
            "\tlocal d = -1;",
            "\tif (x == 1) {",
            "\t\tdoA();",
            "\t} else {",
            "\t\tdoB();",
            "\t}",
            "\tX <- 3;",
            "\tlocal n = (0xED ^ 131).tochar();",
            '\tlocal s = "a" + obj + "b";',
            "}",
            ""
        ].join("\n");
        const opsInput = [
            "function f(a, b) {",
            "local b = a+1;",
            "\tlocal c = x-y;",
            "\tlocal d = -1;",
            "\tif (x==1) {",
            "\t\tdoA();",
            "\t}",
            "else",
            "{",
            "\t\tdoB();",
            "\t}",
            "\tX<-3;",
            "\tlocal n = (0xED^131).tochar();",
            '\tlocal s = "a"+obj+"b";',
            "}",
            ""
        ].join("\n");
        const opsOut = fmt(opsInput);
        if (
            hangOut === hangExpect &&
            chainOut === chainExpect &&
            allmanOut === allmanExpect &&
            blankOut === blankExpect &&
            blockBlankOut === ["/* 注释头", "", "注释尾 */", "local a = 1;", ""].join("\n") &&
            fnGapOut === fnGapExpect &&
            fnGapCmtOut === fnGapCmtExpect &&
            fnAdhOut === fnAdhExpect &&
            fnAdhMultiOut === fnAdhMultiExpect &&
            elseAdhOut === elseAdhExpect &&
            nestOut === nestExpect &&
            opsOut === opsExpect
        ) {
            report("悬挂单语句体 + 独立 { 吸附 + 空行压缩 + 函数间空行保证 + 注释吸附 + else 吸附 + 嵌套 switch 缩进 + 运算符空格规范化", true);
        } else {
            reportSkip("悬挂单语句体 + 独立 { 吸附 + 空行压缩 + 函数间空行保证 + 注释吸附 + else 吸附 + 嵌套 switch 缩进 + 运算符空格规范化");
        }

        // else 吸附内容保留（2026-09-11 修正，docs/pvf-tw-nut-script.md §3.4）：吸附时必须把 else 行
        // `else` 之后的剩余原文（含条件）一并拼接，不得只拼关键字字面量——旧实现丢弃 else 之后全部内容，
        // Allman 三行形态 `}` / `else if (cond)` / `{` 输出退化为 `} else {`，多条分支相互混淆、语义破坏。
        // 覆盖：多级 else-if 链（各级条件互不混淆、`&&` 经运算符空格归一）、`else` 单行（其后无内容）、
        // `}else{` 紧凑单行形态（行首为 } 不触发吸附、行内不重排、内容不丢）。
        const elseIfChainExpect = ["if (a) {", "\tdoA();", "} else if (b) {", "\tdoB();", "} else if (c && d) {", "\tdoC();", "} else {", "\tdoD();", "}", ""].join("\n");
        const elseIfChainOut = fmt(["if (a) {", "doA();", "}", "else if (b)", "{", "doB();", "}", "else if (c&&d) {", "doC();", "}", "else", "{", "doD();", "}", ""].join("\n"));
        const elseCompactExpect = ["if (a) {", "\tdoA();", "}else{", "\tdoB();", "}", ""].join("\n");
        const elseCompactOut = fmt(["if (a) {", "doA();", "}else{", "doB();", "}", ""].join("\n"));
        report(
            "else 吸附内容保留（else-if 链条件完整、多级不混淆、else{ 紧凑形态不丢内容）",
            elseIfChainOut === elseIfChainExpect && elseCompactOut === elseCompactExpect,
            JSON.stringify({ elseIfChainOut, elseCompactOut })
        );

        // ---- 缩进风格检测（对照 VS Code 编辑器格式化语义：一级缩进单位随文件既有风格）----
        if (typeof nutFmt.detectNutIndentUnit !== "function") {
            reportSkip("缩进风格检测（detectNutIndentUnit）");
        } else {
            const space4Src = ["function f() {", "    local a = 1;", "    if (a) {", "        b();", "    }", "}"].join("\n");
            const space2Src = ["function f() {", "  local a = 1;", "  if (a) {", "    b();", "  }", "}"].join("\n");
            const tabSrc = ["function f() {", "\tlocal a = 1;", "\tif (a) {", "\t\tb();", "\t}", "}"].join("\n");
            const flatSrc = ["function f() {", "local a = 1;", "}"].join("\n");
            const tieSrc = ["function f() {", "    local a = 1;", "\tlocal b = 2;", "}"].join("\n");
            report("检测：4 格空格文件 → 4 空格一级单位", nutFmt.detectNutIndentUnit(space4Src) === "    ", JSON.stringify(nutFmt.detectNutIndentUnit(space4Src)));
            report("检测：2 格空格文件 → 2 空格一级单位", nutFmt.detectNutIndentUnit(space2Src) === "  ", JSON.stringify(nutFmt.detectNutIndentUnit(space2Src)));
            report("检测：tab 文件 → Tab 一级单位", nutFmt.detectNutIndentUnit(tabSrc) === "\t");
            report("检测：无缩进证据 → Tab 一级单位（本仓既定回落）", nutFmt.detectNutIndentUnit(flatSrc) === "\t");
            report("检测：tab / 空格行数持平 → 回落默认（Tab）", nutFmt.detectNutIndentUnit(tieSrc) === "\t", JSON.stringify(nutFmt.detectNutIndentUnit(tieSrc)));
            const out4 = fmt(space4Src);
            const out2 = fmt(space2Src);
            report("格式化：4 格空格文件输出 4 空格层级、不含 tab", out4 === space4Src && !out4.includes("\t"), JSON.stringify(out4));
            report("格式化：2 格空格文件输出 2 空格层级、不含 tab", out2 === space2Src && !out2.includes("\t"), JSON.stringify(out2));
            report("格式化：tab 文件维持 Tab 单级（既有行为不变）", fmt(tabSrc) === tabSrc, JSON.stringify(fmt(tabSrc)));
            report("格式化：空格风格幂等", fmt(out4) === out4 && fmt(out2) === out2);
        }
    }
}

// ============ 段 5：Squirrel 花括号折叠（实现后生效，未实现输出 SKIP） ============
// 规则与边界见 docs/pvf-tw-nut-script.md §3.5：纯展示折叠（不改文本模型），严格对照 VS Code。
// findNutFoldRanges 配对 {} 得折叠区间（开闭行之间至少一行可隐藏内容）；buildNutFoldLines 生成
// 可见行描述（起始行 + 闭括号行保留、仅区间内隐藏、行号取原始编号跳号）；buildNutGutterMarks 生成
// gutter 语义标记（collapsed / expanded / ""，字形由展示层图标承担）；toggleNutFoldRange 归一化区间
// （被包含不登记、包含则吸收）；末段静态守卫核对组件渲染接线（:deep 样式 / pointer-events / SVG 图标）。
console.log("Squirrel (.nut) 花括号折叠断言:");
{
    let nutFold = null;
    try {
        nutFold = await import("../src/utils/pvfNutFormat.js");
    } catch {
        /* 未实现，保持 null */
    }
    if (!nutFold || typeof nutFold.findNutFoldRanges !== "function" || typeof nutFold.buildNutFoldLines !== "function" || typeof nutFold.toggleNutFoldRange !== "function") {
        reportSkip("Squirrel 花括号折叠（findNutFoldRanges / buildNutFoldLines / toggleNutFoldRange）");
    } else {
        // 基础：函数体跨行区块 open 0 → close 2
        const base = ["function f() {", "\tlocal a = 1;", "}"].join("\n");
        const r1 = nutFold.findNutFoldRanges(base);
        report("跨行函数体区块配对（open 0 → close 2）", r1.get(0) === 2 && r1.size === 1, JSON.stringify([...r1]));

        // 嵌套：外层 0→5、内层 1→3（两层均登记折叠区）
        const nest = ["function f() {", "\tif (a) {", "\t\tb();", "\t}", "\tc();", "}"].join("\n");
        const r2 = nutFold.findNutFoldRanges(nest);
        report("嵌套区块双折叠区（外层 0→5 / 内层 1→3）", r2.get(0) === 5 && r2.get(1) === 3 && r2.size === 2, JSON.stringify([...r2]));

        // 同行 { ... } 不折叠；未闭合 { 不产生折叠区；相邻开闭行（空体）无可隐藏内容不成区
        report("同行 { ... } 不折叠", nutFold.findNutFoldRanges("function f() { return 1; }").size === 0);
        report("未闭合 { 不产生折叠区", nutFold.findNutFoldRanges(["function f() {", "\tlocal a = 1;"].join("\n")).size === 0);
        report("相邻开闭行（空体）不产生折叠区", nutFold.findNutFoldRanges(["function f() {", "}"].join("\n")).size === 0);

        // 字符串 / 行注释 / 块注释 / verbatim 内花括号不参与配对
        const inert = ['local s = "{";', 'local t = "}";', "// {", "/* {", "} */", 'local v = @"a{', 'b";', "local a = 1;"].join("\n");
        report("字符串 / 注释 / verbatim 内花括号不配对", nutFold.findNutFoldRanges(inert).size === 0, JSON.stringify([...nutFold.findNutFoldRanges(inert)]));

        // `} else {` 行同时作为前块闭行与后块开行（前块 0→2、后块 2→4）
        const elseText = ["if (a) {", "\tdoA();", "} else {", "\tdoB();", "}"].join("\n");
        const r3 = nutFold.findNutFoldRanges(elseText);
        report("} else { 行双重角色（前块 0→2 / 后块 2→4）", r3.get(0) === 2 && r3.get(2) === 4 && r3.size === 2, JSON.stringify([...r3]));

        // ---- 折叠视图（buildNutFoldLines）：纯展示折叠，不改文本、行号跳号，闭括号行保留 ----
        const doc = ["// head", "function f() {", "\tlocal a = 1;", "}", "// tail"].join("\n");
        const view1 = nutFold.buildNutFoldLines(doc, [{ open: 1, close: 3 }]);
        report(
            "折叠视图（起始行保留 + 闭括号行保留 + 仅区间内隐藏 + 原始行号跳号）",
            view1.length === 4 &&
                view1[0].line === 0 &&
                view1[0].no === 1 &&
                !view1[0].folded &&
                view1[1].line === 1 &&
                view1[1].no === 2 &&
                view1[1].folded &&
                view1[2].line === 3 &&
                view1[2].no === 4 &&
                !view1[2].folded &&
                view1[3].line === 4 &&
                view1[3].no === 5 &&
                !view1[3].folded,
            JSON.stringify(view1)
        );
        const view0 = nutFold.buildNutFoldLines(doc, []);
        report("无折叠时全行可见且无折叠标记", view0.length === 5 && view0.every(r => !r.folded && r.no === r.line + 1), JSON.stringify(view0.map(r => r.no)));
        const viewNest = nutFold.buildNutFoldLines(nest, [{ open: 1, close: 3 }]);
        report(
            "嵌套折叠视图（内层区间隐藏、闭括号行保留 + 后续行跳号）",
            viewNest.length === 5 &&
                viewNest[1].line === 1 &&
                viewNest[1].folded &&
                viewNest[2].line === 3 &&
                viewNest[2].no === 4 &&
                !viewNest[2].folded &&
                viewNest[3].line === 4 &&
                viewNest[3].no === 5 &&
                viewNest[4].no === 6,
            JSON.stringify(viewNest)
        );
        const viewOuter = nutFold.buildNutFoldLines(nest, [{ open: 0, close: 5 }]);
        report(
            "外层折叠视图（区间内全部隐藏，起始行与闭括号行保留）",
            viewOuter.length === 2 && viewOuter[0].no === 1 && viewOuter[0].folded && viewOuter[1].line === 5 && viewOuter[1].no === 6 && !viewOuter[1].folded,
            JSON.stringify(viewOuter)
        );
        // 双重角色行（`} else {`）：前块 0→2 与后块 2→4 同时折叠时，闭行 2 仍可见且带 folded 标记
        // （该行是后块开行，正文需在行尾给出可点击 ⋯；按「首个命中区间」判定会漏标）
        const viewElse = nutFold.buildNutFoldLines(elseText, [
            { open: 0, close: 2 },
            { open: 2, close: 4 }
        ]);
        report(
            "双重角色行折叠视图（} else { 行保留且带 folded 标记，前后块体均隐藏）",
            viewElse.length === 3 &&
                viewElse[0].line === 0 &&
                viewElse[0].folded &&
                viewElse[1].line === 2 &&
                viewElse[1].no === 3 &&
                viewElse[1].folded &&
                viewElse[2].line === 4 &&
                !viewElse[2].folded,
            JSON.stringify(viewElse)
        );

        // ---- 折叠区间归一化（toggleNutFoldRange）----
        report("新增区间包含已折叠子区间 → 原子区间被吸收", JSON.stringify(nutFold.toggleNutFoldRange([{ open: 3, close: 5 }], 0, 7)) === JSON.stringify([{ open: 0, close: 7 }]));
        report("新增区间被已有区间包含 → 不重复登记", nutFold.toggleNutFoldRange([{ open: 0, close: 7 }], 3, 5).length === 1);
        report(
            "非法区间被过滤（同行 / 逆序 / 非整数）",
            nutFold.toggleNutFoldRange([], 3, 3).length === 0 && nutFold.toggleNutFoldRange([], 5, 2).length === 0 && nutFold.toggleNutFoldRange([], 1.5, 4).length === 0
        );
        report(
            "区间视图：被包含区间与起始行渲染一致（内层被外层吸收后仍显示外层起始行）",
            (() => {
                const merged = nutFold.toggleNutFoldRange([{ open: 1, close: 3 }], 0, 5);
                const v = nutFold.buildNutFoldLines(nest, merged);
                return merged.length === 1 && merged[0].open === 0 && v.length === 2 && v[0].line === 0 && v[0].folded && v[1].line === 5;
            })()
        );

        // ---- Gutter 折叠标记（buildNutGutterMarks）：严格对照 VS Code 默认「已折叠常显、未折叠悬停才显」----
        // 标记为语义值 collapsed / expanded / ""（字形由展示层决定，工具层不输出字符字形）
        if (typeof nutFold.buildNutGutterMarks !== "function") {
            reportSkip("gutter 折叠标记（buildNutGutterMarks）");
        } else {
            const gRows = [
                { line: 0, no: 1 },
                { line: 1, no: 2 },
                { line: 3, no: 4 }
            ];
            const foldable = new Set([0, 1]);
            const marksIdle = nutFold.buildNutGutterMarks(gRows, foldable, [{ open: 0, close: 3 }], false);
            const marksHover = nutFold.buildNutGutterMarks(gRows, foldable, [{ open: 0, close: 3 }], true);
            const marksEdit = nutFold.buildNutGutterMarks(gRows, foldable, [], true);
            report("gutter 标记：已折叠起始行常显 collapsed（悬停与否不变）", marksIdle[0].mark === "collapsed" && marksHover[0].mark === "collapsed", JSON.stringify(marksIdle.map(m => m.mark)));
            report(
                "gutter 标记：未折叠可折叠行仅鼠标移入 gutter 时给出 expanded",
                marksIdle[1].mark === "" && marksHover[1].mark === "expanded",
                JSON.stringify({ idle: marksIdle[1].mark, hover: marksHover[1].mark })
            );
            report("gutter 标记：非可折叠行为空标记（悬停亦不显示）", marksIdle[2].mark === "" && marksHover[2].mark === "", JSON.stringify(marksHover.map(m => m.mark)));
            report("gutter 标记：无折叠（编辑态）时悬停给出全部可折叠行 expanded", marksEdit[0].mark === "expanded" && marksEdit[1].mark === "expanded" && marksEdit[2].mark === "");
            report(
                "gutter 标记：行号与原行号一致（空标记不改列宽，行号不跳）",
                marksIdle.every((m, i) => m.line === gRows[i].line && m.no === gRows[i].no),
                JSON.stringify(marksIdle.map(m => m.no))
            );
            report(
                "gutter 标记：不输出字符字形（▸ / ▾ 仅由展示层图标承担）",
                marksIdle.every(m => !/[▸▾]/.test(m.mark)),
                JSON.stringify(marksHover.map(m => m.mark))
            );
        }

        // ---- 折叠态可编辑（§3.5，2026-09-11 对齐 VS Code）：折叠只隐藏视图，非折叠区照常编辑 ----
        // textarea 只承载可见行；编辑结果按行差分并回完整文本，折叠区间按行数差平移；跨折叠边界
        // （会删除隐藏行、或把新行插入隐藏区）不直接执行（blocked），由展示层展开区间后由用户继续。
        if (typeof nutFold.buildNutFoldEditableText !== "function" || typeof nutFold.mergeNutFoldEdit !== "function") {
            reportSkip("折叠态可编辑（buildNutFoldEditableText / mergeNutFoldEdit）");
        } else {
            const foldDoc = ["// head", "function f() {", "\tlocal a = 1;", "\tlocal b = 2;", "}", "// tail"].join("\n");
            const foldRanges = [{ open: 1, close: 4 }];
            const foldVis = "// head\nfunction f() {\n}\n// tail";
            report(
                "折叠态可见行文本：仅输出非隐藏行（区间开行 / 闭行保留），无折叠即全文",
                nutFold.buildNutFoldEditableText(foldDoc, foldRanges) === foldVis &&
                    nutFold.buildNutFoldEditableText(foldDoc, []) === foldDoc &&
                    nutFold.buildNutFoldEditableText("a\r\nb\r\n", []) === "a\nb\n",
                JSON.stringify(nutFold.buildNutFoldEditableText(foldDoc, foldRanges))
            );

            // 行内改字（折叠起始行 / 闭括号行）：仅该行变化，其余隐藏行原样，区间不变
            const mEdit = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\nfunction g() {\n}\n// tail");
            const mClose = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\nfunction f() {\n} // end\n// tail");
            report(
                "折叠态编辑：起始行 / 闭括号行行内改字并回全文（隐藏行原样、区间不变、textarea 值自洽）",
                mEdit.blocked === false &&
                    mEdit.text === "// head\nfunction g() {\n\tlocal a = 1;\n\tlocal b = 2;\n}\n// tail" &&
                    JSON.stringify(mEdit.folds) === JSON.stringify(foldRanges) &&
                    nutFold.buildNutFoldEditableText(mEdit.text, mEdit.folds) === "// head\nfunction g() {\n}\n// tail" &&
                    mClose.blocked === false &&
                    mClose.text === "// head\nfunction f() {\n\tlocal a = 1;\n\tlocal b = 2;\n} // end\n// tail" &&
                    JSON.stringify(mClose.folds) === JSON.stringify(foldRanges),
                JSON.stringify(mEdit.folds)
            );

            // 折叠区间上方增 / 删整行：区间整体平移（+1 / -1）
            const mIns = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// new\n// head\nfunction f() {\n}\n// tail");
            const mDel = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "function f() {\n}\n// tail");
            report(
                "折叠态编辑：折叠区间上方增 / 删整行 → 区间整体平移且非隐藏行保留",
                mIns.blocked === false &&
                    JSON.stringify(mIns.folds) === JSON.stringify([{ open: 2, close: 5 }]) &&
                    mIns.text === "// new\n// head\nfunction f() {\n\tlocal a = 1;\n\tlocal b = 2;\n}\n// tail" &&
                    mDel.blocked === false &&
                    JSON.stringify(mDel.folds) === JSON.stringify([{ open: 0, close: 3 }]) &&
                    mDel.text === "function f() {\n\tlocal a = 1;\n\tlocal b = 2;\n}\n// tail",
                JSON.stringify({ ins: mIns.folds, del: mDel.folds })
            );

            // 可见区末尾追加：区间不变
            const mTail = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\nfunction f() {\n}\n// tail\n// extra");
            report(
                "折叠态编辑：可见区末尾追加行 → 区间不变、追加行保留",
                mTail.blocked === false && JSON.stringify(mTail.folds) === JSON.stringify(foldRanges) && mTail.text.endsWith("// tail\n// extra"),
                JSON.stringify(mTail.folds)
            );

            // 跨折叠边界（退格合并开闭行 / 起始行行尾换行 / 删除起始行）：保护，不执行并给出待展开区间
            const mJoin = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\nfunction f() {}\n// tail");
            const mEnter = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\nfunction f() {\n\n}\n// tail");
            const mDropOpen = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, "// head\n}\n// tail");
            report(
                "折叠态编辑：跨折叠边界（合并开闭行 / 边界换行 / 删起始行）→ blocked 且给出待展开区间，隐藏内容不丢",
                mJoin.blocked === true &&
                    JSON.stringify(mJoin.expand) === JSON.stringify([1]) &&
                    mJoin.text === foldDoc &&
                    JSON.stringify(mJoin.folds) === JSON.stringify(foldRanges) &&
                    mEnter.blocked === true &&
                    JSON.stringify(mEnter.expand) === JSON.stringify([1]) &&
                    mEnter.text === foldDoc &&
                    mDropOpen.blocked === true &&
                    JSON.stringify(mDropOpen.expand) === JSON.stringify([1]) &&
                    mDropOpen.text === foldDoc,
                JSON.stringify({ join: mJoin.expand, enter: mEnter.expand, dropOpen: mDropOpen.expand })
            );

            // 行尾风格沿用源文件主流行尾；无改动时原样返回
            const crlfDoc = "a\r\nfunction f() {\r\n\tx;\r\n}\r\nz";
            const mCrlf = nutFold.mergeNutFoldEdit(crlfDoc, [{ open: 1, close: 3 }], "a\nfunction g() {\n}\nz");
            const mNoop = nutFold.mergeNutFoldEdit(foldDoc, foldRanges, foldVis);
            report(
                "折叠态编辑：CRLF 文件保持 CRLF；无改动时文本与区间原样返回",
                mCrlf.blocked === false &&
                    mCrlf.text === "a\r\nfunction g() {\r\n\tx;\r\n}\r\nz" &&
                    mNoop.text === foldDoc &&
                    JSON.stringify(mNoop.folds) === JSON.stringify(foldRanges) &&
                    mNoop.blocked === false,
                JSON.stringify(mCrlf.text)
            );
        }

        // 真实留存样本（test/70TW/sqr/init_character.nut 现场还原后的 CP949 明文）：
        // 注释区含 U+FFFD / 韩文残留不破坏花括号扫描；折叠后可见行数减少（闭括号行保留）且行号跳号
        const sampleFoldText = new TextDecoder("euc-kr").decode(plain).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const sr = nutFold.findNutFoldRanges(sampleFoldText);
        const totalLines = sampleFoldText.split("\n").length;
        const firstOpen = sr.size ? Math.min(...sr.keys()) : -1;
        const firstClose = firstOpen >= 0 ? sr.get(firstOpen) : -1;
        const sampleView = firstOpen >= 0 ? nutFold.buildNutFoldLines(sampleFoldText, [{ open: firstOpen, close: firstClose }]) : [];
        report("留存样本明文可折叠区块（函数体配对，开闭行间至少一行）", sr.size > 0 && [...sr.entries()].every(([o, c]) => c - o >= 2), `ranges=${sr.size}, [${[...sr].slice(0, 4).join(" ")}]`);
        report(
            "留存样本折叠后可见行数减少（闭括号行保留）且行号跳号",
            sampleView.length === totalLines - (firstClose - firstOpen - 1) && !sampleView.some(r => r.line > firstOpen && r.line < firstClose) && sampleView.some(r => r.line === firstClose),
            `visible=${sampleView.length}, total=${totalLines}, hidden=${firstClose - firstOpen - 1}`
        );

        // ---- 折叠切换视口锚点（§3.5，2026-09-11 修正）：编辑视图与折叠视图是 v-if / v-else 两棵
        // 互斥子树，首次折叠（或「展开全部」）会整体替换编辑区 DOM，新滚动容器 scrollTop 归零——
        // 原实现只同步滚动量、不恢复位置，200 行以后折叠会跳回文件顶部。锚点取「视口顶部真实行号 +
        // 行内像素偏移」，还原时在新可见行集合里映射回视图行序（精确命中 → 该行；被此次折叠隐藏 →
        // 退到其之前的最后一个可见行，内容上方保持不动；早于全部可见行 → 首行）。
        if (typeof nutFold.captureNutScrollAnchor !== "function" || typeof nutFold.resolveNutScrollTop !== "function") {
            reportSkip("折叠切换视口锚点（captureNutScrollAnchor / resolveNutScrollTop）");
        } else {
            const PAD = 14;
            const LH = 20;
            const allLines = Array.from({ length: 100 }, (_, i) => ({ line: i, no: i + 1, folded: false }));
            // 编辑态：scrollTop = 上内边距 + 37 行 + 行内 7px → 锚点 { line: 37, intra: 7 }
            const aEdit = nutFold.captureNutScrollAnchor(allLines, PAD + LH * 37 + 7, PAD, LH);
            report(
                "视口锚点：行取 ⌊(scrollTop − 上内边距) / 行高⌋、行内偏移取余量，可原样还原（不跳回顶部）",
                aEdit.line === 37 && Math.abs(aEdit.intra - 7) < 1e-9 && nutFold.resolveNutScrollTop(allLines, aEdit, PAD, LH) === PAD + LH * 37 + 7,
                JSON.stringify({ aEdit, back: nutFold.resolveNutScrollTop(allLines, aEdit, PAD, LH) })
            );
            // 折叠视图（行号跳号：3 / 4 被隐藏）：视图行序 3 → 真实行号 5
            const jumpRows = [0, 1, 2, 5, 6, 7].map(n => ({ line: n, no: n + 1, folded: false }));
            const aJump = nutFold.captureNutScrollAnchor(jumpRows, PAD + LH * 3, PAD, LH);
            report(
                "视口锚点：折叠视图按视图行序取真实行号（跳号行可见行 → line 5 / row 序 3），还原后位置一致",
                aJump.line === 5 && aJump.intra === 0 && nutFold.resolveNutScrollTop(jumpRows, aJump, PAD, LH) === PAD + LH * 3,
                JSON.stringify({ aJump, back: nutFold.resolveNutScrollTop(jumpRows, aJump, PAD, LH) })
            );
            report(
                "视口锚点：锚点行被本次折叠隐藏 → 退到其之前最后一个可见行（不退到其后可见行）",
                nutFold.resolveNutScrollTop(jumpRows, { line: 3, intra: 0 }, PAD, LH) === PAD + LH * 2 && nutFold.resolveNutScrollTop(jumpRows, { line: 4, intra: 0 }, PAD, LH) === PAD + LH * 2,
                String(nutFold.resolveNutScrollTop(jumpRows, { line: 3, intra: 0 }, PAD, LH))
            );
            report(
                "视口锚点：锚点行早于全部可见行取首行、超出末行取末行、行内偏移保留、结果不为负",
                nutFold.resolveNutScrollTop([{ line: 10 }, { line: 11 }], { line: 3, intra: 0 }, PAD, LH) === PAD &&
                    nutFold.resolveNutScrollTop(jumpRows, { line: 99, intra: 5 }, PAD, LH) === PAD + LH * 5 + 5 &&
                    nutFold.resolveNutScrollTop(jumpRows, { line: 2, intra: 13 }, PAD, LH) === PAD + LH * 2 + 13 &&
                    nutFold.resolveNutScrollTop(jumpRows, { line: 0, intra: -40 }, PAD, LH) === 0,
                JSON.stringify({
                    before: nutFold.resolveNutScrollTop([{ line: 10 }, { line: 11 }], { line: 3, intra: 0 }, PAD, LH),
                    beyond: nutFold.resolveNutScrollTop(jumpRows, { line: 99, intra: 5 }, PAD, LH),
                    intra: nutFold.resolveNutScrollTop(jumpRows, { line: 2, intra: 13 }, PAD, LH),
                    neg: nutFold.resolveNutScrollTop(jumpRows, { line: 0, intra: -40 }, PAD, LH)
                })
            );
            report(
                "视口锚点：空可见行集合返回 0；行高非法（0 / NaN）回落 1 不产生 NaN",
                nutFold.resolveNutScrollTop([], { line: 3, intra: 0 }, PAD, LH) === 0 &&
                    nutFold.resolveNutScrollTop(allLines, { line: 3, intra: 0 }, PAD, 0) === PAD + 3 &&
                    Number.isFinite(nutFold.captureNutScrollAnchor(allLines, 50, PAD, NaN).intra),
                ""
            );
        }
    }

    // ---- 折叠渲染接线静态守卫（组件源码）：见文档 §3.5「Gutter 版式 / 渲染观感对照 / 渲染接线修正」----
    // gutter 行序必须为「行号在前、折叠箭头列在后」（VS Code 的装饰槽位在行号右侧、正文左侧）；
    // gutter 标记与正文均为 v-html 注入内容，样式必须走 :deep()（否则空标记宽度塌缩、悬停抖动）；
    // 折叠视图正文层的 pointer-events 必须以双类选择器覆盖高亮层 none（否则 ⋯ 不可点击）；
    // 折叠箭头为自绘 SVG 图标，工具层与组件均不输出 ▸ / ▾ 字符字形。
    const editorSrc = readFileSync(new URL("../src/components/PvfEditor.vue", import.meta.url), "utf8");
    if (!editorSrc.includes("buildNutGutterMarks")) {
        reportSkip("折叠渲染接线静态守卫（组件未接入折叠 gutter）");
    } else {
        const cssRuleBody = selector => {
            const at = editorSrc.indexOf(selector);
            if (at < 0) return null;
            const open = editorSrc.indexOf("{", at);
            const close = editorSrc.indexOf("}", open);
            return open < 0 || close < 0
                ? null
                : editorSrc
                      .slice(open + 1, close)
                      .replace(/\s+/g, " ")
                      .trim();
        };
        const markRule = cssRuleBody(":deep(.pvf-fold-mark)");
        const iconRule = cssRuleBody(":deep(.pvf-fold-icon)");
        const ellipsisRule = cssRuleBody(":deep(.pvf-fold-ellipsis)");
        report(
            "折叠渲染：gutter 标记列经 :deep() 固定 16px（VS Code 装饰槽位宽度，scoped 样式命中 v-html 注入内容，悬停不抖动）",
            !!markRule && /width: 16px/.test(markRule) && /flex-shrink: 0/.test(markRule) && !!iconRule && /width: 16px/.test(iconRule),
            String(markRule)
        );
        report("折叠渲染：gutter 行序为「行号在前、箭头列在后」（对齐 VS Code 行号右侧装饰槽位）", editorSrc.includes('${m.no}<span class="pvf-fold-mark">') && !/<\/span>\$\{m\.no\}/.test(editorSrc));
        // 2026-09-11「折叠态可编辑」修正：折叠正文层（<pre>）改为纯展示层、不再接收鼠标事件，输入由
        // 覆盖其上的折叠态 textarea 承担；⋯ 点击改由覆盖层承担——仅占位符自身 pointer-events: auto，
        // 层容器仍为 none（否则整层会遮住 textarea 使正文无法编辑）。
        const markerLayerRule = cssRuleBody(".pvf-fold-markers {");
        report(
            "折叠渲染：折叠正文为纯展示层，⋯ 点击由覆盖层承担（仅占位符自身可交互、不遮蔽 textarea 输入）",
            !!markerLayerRule &&
                /pointer-events: none/.test(markerLayerRule) &&
                !!ellipsisRule &&
                /pointer-events: auto/.test(ellipsisRule) &&
                !/\.pvf-fold-body\s*\{[^}]*pointer-events: auto/.test(editorSrc),
            String(markerLayerRule)
        );
        report(
            "折叠渲染：⋯ 占位符经 :deep() 着色可点击（cursor: pointer + data-line + 点击接线）",
            !!ellipsisRule &&
                /cursor: pointer/.test(ellipsisRule) &&
                /pointer-events: auto/.test(ellipsisRule) &&
                editorSrc.includes('class="pvf-fold-ellipsis"') &&
                editorSrc.includes("onNutFoldBodyClick"),
            String(ellipsisRule)
        );
        report(
            "折叠渲染：折叠箭头以自绘 SVG 图标渲染（工具层与组件均无 ▸ / ▾ 字形）",
            /<svg[^>]*class="pvf-fold-icon"/.test(editorSrc) && editorSrc.includes("nutFoldIcon(") && !/[▸▾]/.test(editorSrc)
        );
        // 工具栏「展开全部」按钮版式（§3.5 按钮版式修正）：不得复用纯图标方形类 .pvf-icon-btn
        // （其 30×30 + .pvf-largefile-btn 的 2px 10px 内边距使内容盒仅 8px，四字标签被压成每行一个
        // 汉字并纵向溢出按钮）；图标尺寸须由独立类作用域规则给出，以覆盖 .pvf-icon-btn svg（0,1,1）。
        const iconTextRule = cssRuleBody(".pvf-icon-text-btn {");
        report(
            "折叠渲染：工具栏「展开全部」按钮用独立类（不复用纯图标方形类，标签单行横排、图标 12px）",
            editorSrc.includes('class="pvf-largefile-btn pvf-icon-text-btn"') &&
                !editorSrc.includes('class="pvf-largefile-btn pvf-icon-btn"') &&
                (editorSrc.match(/^\.pvf-icon-btn\s*\{/gm) || []).length === 1 &&
                (editorSrc.match(/^\.pvf-icon-text-btn\s*\{/gm) || []).length === 1 &&
                !!iconTextRule &&
                /display: inline-flex/.test(iconTextRule) &&
                /gap: 4px/.test(iconTextRule) &&
                /\.pvf-icon-text-btn \.pvf-btn-icon\s*\{[^}]*width: 12px/.test(editorSrc),
            String(iconTextRule)
        );
        // 折叠箭头列靠右（§3.5）：gutter 内容自适应 + 行内容右对齐，箭头列右侧间距只由 .pvf-gutter-pre 的
        // 右内边距决定；收紧右内边距（8px → 2px）使行号与箭头列整体右移。编辑 / 折叠两视图共用同一条规则
        // （只为折叠态收紧会让行号列在切换折叠时横跳 6px），故断言该规则全文件只出现一次。
        const gutterPreRule = cssRuleBody(".pvf-gutter-pre {");
        report(
            "折叠渲染：折叠箭头列靠右（gutter 右内边距收紧至 2px，编辑 / 折叠两视图共用同一规则不横跳）",
            !!gutterPreRule && /padding: 14px 2px 14px 10px/.test(gutterPreRule) && (editorSrc.match(/^\.pvf-gutter-pre\s*\{/gm) || []).length === 1,
            String(gutterPreRule)
        );
        // 折叠态可编辑接线（§3.5，2026-09-11）：折叠视图保留 textarea（只承载可见行）并以 mergeNutFoldEdit
        // 并回完整文本；占位符由覆盖层渲染（正文层不再注入 ⋯）。
        const foldHtmlAt = editorSrc.indexOf("nutFoldHtml()");
        const foldHtmlBody = foldHtmlAt < 0 ? "" : editorSrc.slice(foldHtmlAt, editorSrc.indexOf("nutDecorRows()", foldHtmlAt));
        report(
            "折叠渲染：折叠视图保留可编辑 textarea（可见行取值 + @input 经 mergeNutFoldEdit 并回 editText，blocked 时回退并展开区间）",
            editorSrc.includes('class="pvf-code-textarea pvf-fold-input"') &&
                editorSrc.includes("mergeNutFoldEdit") &&
                editorSrc.includes("onNutFoldInput") &&
                editorSrc.includes("nutFoldEditableText") &&
                editorSrc.includes(".blocked"),
            ""
        );
        report(
            "折叠渲染：折叠视图 ⋯ 由覆盖层渲染（正文高亮层不再注入占位符，textarea 可全宽接收输入）",
            editorSrc.includes("nutFoldMarkers") && editorSrc.includes('v-for="m in nutFoldMarkers"') && !foldHtmlBody.includes("pvf-fold-ellipsis"),
            foldHtmlBody.slice(0, 60)
        );
        // 占位符锚点纯函数（§3.5，2026-09-11 修正）：锚点列一律取「行末之后一格」（可见宽度 + 1），
        // 不再取末字符格（否则 ⋯ 叠在行末字符上）；row 为折叠视图行序；制表符按 4 列折算；
        // 不做可见性过滤（视口外的折叠行同样产出锚点，裁剪由 CSS 裁剪层负责）。
        if (typeof nutFold.buildNutFoldMarkerAnchors !== "function") {
            reportSkip("占位符锚点（buildNutFoldMarkerAnchors：行末之后一格 + 视图行序 + tab 计 4 列 + 不做可见性过滤）");
        } else {
            // 本块为静态守卫作用域，纯函数断言用的样本在此就地构造（不依赖前置折叠段的局部变量）
            const anchorElseText = ["if (a) {", "\tdoA();", "} else {", "\tdoB();", "}"].join("\n");
            const anchorNestText = ["function f() {", "\tif (a) {", "\t\tb();", "\t}", "\tc();", "}"].join("\n");
            const elseLines = anchorElseText.split("\n");
            const viewBoth = nutFold.buildNutFoldLines(anchorElseText, [
                { open: 0, close: 2 },
                { open: 2, close: 4 }
            ]);
            const anchors = nutFold.buildNutFoldMarkerAnchors(viewBoth, elseLines);
            const byLine = new Map(anchors.map(a => [a.line, a]));
            report(
                "占位符锚点：每个 folded 行一个锚点、column = 行可见宽度 + 1（行末之后一格）",
                anchors.length === 2 &&
                    !!byLine.get(0) &&
                    byLine.get(0).row === 0 &&
                    byLine.get(0).column === "if (a) {".length + 1 &&
                    !!byLine.get(2) &&
                    byLine.get(2).row === 1 &&
                    byLine.get(2).column === "} else {".length + 1,
                JSON.stringify(anchors)
            );
            const nestLines = anchorNestText.split("\n");
            const nestAnchors = nutFold.buildNutFoldMarkerAnchors(nutFold.buildNutFoldLines(anchorNestText, [{ open: 1, close: 3 }]), nestLines);
            const nestAnchor = nestAnchors.find(a => a.line === 1);
            report(
                "占位符锚点：制表符按 4 列折算（\\tif (a) { → column 13）且非折叠行无锚点",
                !!nestAnchor && nestAnchor.column === 4 + "if (a) {".length + 1 && nestAnchors.every(a => a.line === 1),
                JSON.stringify(nestAnchors)
            );
            const longLines = Array.from({ length: 80 }, (_, i) => (i === 60 ? "if (x) {" : i === 62 ? "}" : "\ta();"));
            const longAnchors = nutFold.buildNutFoldMarkerAnchors(nutFold.buildNutFoldLines(longLines.join("\n"), [{ open: 60, close: 62 }]), longLines);
            report(
                "占位符锚点：视口外折叠行同样产出锚点（row 为视图行序，不做可见性过滤）",
                longAnchors.length === 1 && longAnchors[0].line === 60 && longAnchors[0].row === 60 && longAnchors[0].column === "if (x) {".length + 1,
                JSON.stringify(longAnchors)
            );
            report(
                "占位符锚点：无折叠 / 折叠视图为空 → 无锚点",
                nutFold.buildNutFoldMarkerAnchors(nutFold.buildNutFoldLines(anchorElseText, []), elseLines).length === 0 && nutFold.buildNutFoldMarkerAnchors([], elseLines).length === 0
            );
        }
        // 覆盖层两面结构（§3.5 裁剪修正）：外层只做固定视口裁剪（inset + overflow: hidden、不带 transform），
        // 内层承载滚动反向平移；同元素既 overflow:hidden 又带跟随滚动的 transform 会使裁剪窗口随内容平移，
        // 只有首屏内容内的占位符能被绘制（折叠行底色 / gutter 箭头正常、唯独 ⋯ 缺失的根因）。
        const markerScrollRule = cssRuleBody(".pvf-fold-marker-scroll {");
        const markerOpenTag = (editorSrc.match(/<div class="pvf-fold-markers"[^>]*>/) || [""])[0] || "";
        report(
            "折叠渲染：占位符覆盖层两面结构（外层固定裁剪不带 transform、内层承载反向平移、left 由锚点函数给出）",
            !!markerLayerRule &&
                /overflow: hidden/.test(markerLayerRule) &&
                !/transform/.test(markerLayerRule) &&
                !/:style=/.test(markerOpenTag) &&
                !!markerScrollRule &&
                /transform: translate3d\(calc\(-1 \* var\(--decor-x/.test(markerScrollRule) &&
                editorSrc.includes('class="pvf-fold-marker-scroll" :style="decorScroll"') &&
                editorSrc.includes("buildNutFoldMarkerAnchors") &&
                !editorSrc.replace(/\s+/g, " ").includes("_nutVisibleColumn(raw, raw.length) - 1"),
            `${String(markerLayerRule)} || ${String(markerScrollRule)}`
        );
        // 折叠切换视口锚点接线（§3.5）：编辑 / 折叠两视图为 v-if / v-else 互斥子树，任何折叠状态变更
        // 都会重建滚动容器（scrollTop 归零），三个变更入口必须统一「先取锚点 → 改 nutFolds →
        // $nextTick 内先还原 scrollTop 再同步各层」，否则 200 行以后折叠会跳回顶部。
        const normEditorSrc = editorSrc.replace(/\s+/g, " ");
        report(
            "折叠渲染：折叠切换保持视口锚点（三入口先取锚点、nextTick 内先恢复再同步各层）",
            editorSrc.includes("captureNutScrollAnchor") &&
                editorSrc.includes("resolveNutScrollTop") &&
                (editorSrc.match(/this\._nutFoldScrollAnchor\(\)/g) || []).length === 3 &&
                (editorSrc.match(/this\._afterNutFoldChange\(anchor\)/g) || []).length === 3 &&
                normEditorSrc.includes("this._restoreNutFoldScroll(anchor); this.syncScroll(); this.onNutFoldScroll();"),
            `anchorCalls=${(editorSrc.match(/this\._nutFoldScrollAnchor\(\)/g) || []).length}`
        );
    }
}

// ================= 段 6：编辑器装饰语义（§3.6，VS Code 对照） =================
// 折叠整行底色 / 区块区域辅助线（含活动块高亮）/ 同类词与选区高亮 / 当前行边框。
// 工具层为纯函数（可在 Node 直接断言，列一律为可见列、制表符按 4 列折算）；
// 末段静态守卫核对组件装饰覆盖层的渲染接线（绘制层次 / pointer-events / 整行底色 / 光标接线）。
console.log("编辑器装饰语义断言 (docs/pvf-tw-nut-script.md §3.6):");
{
    let nutDecor = null;
    try {
        nutDecor = await import("../src/utils/pvfNutFormat.js");
    } catch {
        /* 未实现，保持 null */
    }
    const need = ["computeNutBlockGuideLevels", "findNutActiveIndentGuide", "nutWordAtColumn", "findNutWordOccurrences"];
    if (!nutDecor || need.some(n => typeof nutDecor[n] !== "function")) {
        reportSkip("编辑器装饰语义（区块区域辅助线 / 活动块 / 同类词高亮）");
    } else {
        // ---- 区块区域辅助线层级（docs §3.6：只对跨行 {} 区块、只在其区域内部行绘制）----
        // 区域内部行 = 开括号行的下一行 ~ 闭括号行的前一行；同行 {}、相邻开闭行（无内部行）、
        // 字符串 / 注释内花括号均不产生区域；从未由花括号开出的缩进（悬挂单语句体 / 条件续行 /
        // case 体更深缩进）不产生辅助线。
        const b1 = ["function f() {", "\tif (a)", "\t\treturn 1;", "\treturn 2;", "}"].join("\n");
        const bl1 = nutDecor.computeNutBlockGuideLevels(b1);
        report("区块辅助线：区域内层行取 1 级；悬挂单语句体缩进不再产生额外辅助线", JSON.stringify(bl1) === JSON.stringify([0, 1, 1, 1, 0]), JSON.stringify(bl1));

        const b2 = ["function f() {", "\tif (a) {", "\t\tb();", "\t}", "}"].join("\n");
        const bl2 = nutDecor.computeNutBlockGuideLevels(b2);
        report("区块辅助线：嵌套区块逐层递增；闭括号行只取外层区域层级", JSON.stringify(bl2) === JSON.stringify([0, 1, 2, 1, 0]), JSON.stringify(bl2));

        const b3 = ["function f() { return 1; }", "local a = 1;"].join("\n");
        const bl3 = nutDecor.computeNutBlockGuideLevels(b3);
        report("区块辅助线：同行 {} 不产生区域（单行展示无辅助线）", JSON.stringify(bl3) === JSON.stringify([0, 0]), JSON.stringify(bl3));

        const b4 = ["function f() {", "}"].join("\n");
        const bl4 = nutDecor.computeNutBlockGuideLevels(b4);
        report("区块辅助线：相邻开闭行（无内部行）不产生区域", JSON.stringify(bl4) === JSON.stringify([0, 0]), JSON.stringify(bl4));

        const b5 = ['local s = "{";', "local a = 1;", "// }"].join("\n");
        const bl5 = nutDecor.computeNutBlockGuideLevels(b5);
        report("区块辅助线：字符串 / 注释内花括号不参与配对", JSON.stringify(bl5) === JSON.stringify([0, 0, 0]), JSON.stringify(bl5));

        const b6 = ["function f() {", "", "\ta();", "", "}"].join("\n");
        const bl6 = nutDecor.computeNutBlockGuideLevels(b6);
        report("区块辅助线：区域内部空白行辅助线连续；区域外空白行取 0", JSON.stringify(bl6) === JSON.stringify([0, 1, 1, 1, 0]), JSON.stringify(bl6));

        const b7 = ["switch (x) {", "\tcase 1:", "\t\ta();", "\t\tbreak;", "\tcase 2:", "}"].join("\n");
        const bl7 = nutDecor.computeNutBlockGuideLevels(b7);
        report("区块辅助线：case 体更深一层缩进不产生额外辅助线", JSON.stringify(bl7) === JSON.stringify([0, 1, 1, 1, 1, 0]), JSON.stringify(bl7));

        // 用户样例（test/70TW/example/common.nut）实文件回归：第 38 行（1 基）位于 function →
        // if (passiveobj) → if (pChr) 三层跨行 {} 区块内 → 3 级；第 45 行悬挂体 / 第 133 行悬挂
        // return 未被花括号开出更深区域 → 只取外层区块层级。
        const exampleSrc = readFileSync(new URL("./70TW/example/common.nut", import.meta.url), "utf8");
        const blEx = nutDecor.computeNutBlockGuideLevels(exampleSrc);
        report(
            "区块辅助线：用户样例实文件（第 38 行 3 级 / 第 45 行悬挂体 3 级而非 4 级 / 第 133 行悬挂 return 1 级而非 2 级）",
            blEx[37] === 3 && blEx[44] === 3 && blEx[132] === 1 && blEx[36] === 2 && blEx[45] === 2 && blEx[49] === 0,
            `38=${blEx[37]} 45=${blEx[44]} 133=${blEx[132]} 37=${blEx[36]} 46=${blEx[45]} 50=${blEx[49]}`
        );

        // ---- 活动缩进块（VS Code getActiveIndentGuide 语义，含两处特判）----
        const a1 = nutDecor.findNutActiveIndentGuide([0, 1, 1, 1, 0], 2);
        report("活动块：块内行取所在块范围与层级", a1 && a1.startLine === 1 && a1.endLine === 3 && a1.indent === 1, JSON.stringify(a1));
        const a2 = nutDecor.findNutActiveIndentGuide([0, 1, 1, 0], 0);
        report("活动块特判：光标位于开括号行 → 取子块辅助线", a2 && a2.startLine === 1 && a2.endLine === 2 && a2.indent === 1, JSON.stringify(a2));
        const a3 = nutDecor.findNutActiveIndentGuide([0, 1, 1, 0], 3);
        report("活动块特判：光标位于块尾闭行 → 取父块辅助线", a3 && a3.startLine === 1 && a3.endLine === 2 && a3.indent === 1, JSON.stringify(a3));
        const a4 = nutDecor.findNutActiveIndentGuide([0, 0], 0);
        report("活动块：层级 0 不延伸（仅当前行）", a4 && a4.startLine === 0 && a4.endLine === 0 && a4.indent === 0, JSON.stringify(a4));

        // ---- 光标处词提取（VS Code getWordAtPosition + 词定义，含两端包含判定）----
        const w1 = nutDecor.nutWordAtColumn("local a = foo;", 11);
        report("词提取：标识符范围与可见列", w1 && w1.word === "foo" && w1.startColumn === 11 && w1.endColumn === 14, JSON.stringify(w1));
        const w2 = nutDecor.nutWordAtColumn("local a = foo;", 14);
        report("词提取：光标紧邻词尾同样命中（matchIndex <= pos && lastIndex >= pos）", w2 && w2.word === "foo", JSON.stringify(w2));
        report("词提取：光标落在空白 / 分隔符上不命中", nutDecor.nutWordAtColumn("local a = foo;", 10) === null);
        const w4 = nutDecor.nutWordAtColumn("foo.bar", 5);
        report("词提取：`.` 为分隔符（成员名独立成词）", w4 && w4.word === "bar" && w4.startColumn === 5 && w4.endColumn === 8, JSON.stringify(w4));
        const w5 = nutDecor.nutWordAtColumn("\tfoo = foo;", 11);
        report("词提取：tab 行可见列按 4 列折算", w5 && w5.word === "foo" && w5.startColumn === 11 && w5.endColumn === 14, JSON.stringify(w5));

        // ---- 同类词高亮（VS Code 文本型路径：整词边界 + 区分大小写，全文件）----
        const occText = ["local a = 1;", "local b = 2;", "local c = a + 1;"].join("\n");
        const occ1 = nutDecor.findNutWordOccurrences(occText, 2, 11);
        report(
            "同类词：命中文档内全部整词出现处（含光标处自身）",
            occ1 &&
                occ1.word === "a" &&
                occ1.kind === "word" &&
                occ1.matches.length === 2 &&
                occ1.matches[0].line === 0 &&
                occ1.matches[0].startColumn === 7 &&
                occ1.matches[1].line === 2 &&
                occ1.matches[1].startColumn === 11,
            JSON.stringify(occ1)
        );
        const occ2 = nutDecor.findNutWordOccurrences(["local foo = 1;", "foobar();", "_foo();"].join("\n"), 0, 7);
        report("同类词：整词边界（`foobar` / `_foo` 不命中）", occ2 && occ2.matches.length === 1 && occ2.matches[0].line === 0, JSON.stringify(occ2));
        const occ3 = nutDecor.findNutWordOccurrences(["Foo();", "foo();"].join("\n"), 0, 1);
        report("同类词：区分大小写", occ3 && occ3.matches.length === 1 && occ3.matches[0].line === 0, JSON.stringify(occ3));
        // 词尾后一列属命中区间（getWordAtText：matchIndex <= column - 1 <= lastIndex），
        // 故「不在词上」须取既不落在任何词内、也不是任何词起始 / 结尾边界的分隔符空隙（此处为 "=" 所在列）。
        report("同类词：光标位于分隔符空隙（非任何词的起始 / 结尾边界）时不产生高亮", nutDecor.findNutWordOccurrences(occText, 0, 9) === null);
        const occT = nutDecor.findNutWordOccurrences("\tfoo = foo;", 0, 5);
        report("同类词：匹配列按可见列（tab 行）", occT && occT.matches.length === 2 && occT.matches[0].startColumn === 5 && occT.matches[1].startColumn === 11, JSON.stringify(occT));

        // ---- 选区门控（VS Code wordHighlighter._run）----
        const selText = ["local foo = foo;", "local bar = 1;"].join("\n");
        const sel1 = nutDecor.findNutWordOccurrences(selText, 0, 8, { selection: { startLine: 0, startColumn: 6, endLine: 1, endColumn: 2 } });
        report("选区门控：多行选区不参与高亮", sel1 === null, JSON.stringify(sel1));
        const sel2 = nutDecor.findNutWordOccurrences(selText, 0, 1, { selection: { startLine: 0, startColumn: 1, endLine: 0, endColumn: 9 } });
        report("选区门控：选区跨越两个词不参与高亮", sel2 === null, JSON.stringify(sel2));
        const sel3 = nutDecor.findNutWordOccurrences(selText, 0, 6, { selection: { startLine: 0, startColumn: 7, endLine: 0, endColumn: 9 } });
        report("选区高亮：选区落在同一个词内 → 同类色呈现（kind = selection）", sel3 && sel3.kind === "selection" && sel3.word === "foo" && sel3.matches.length === 2, JSON.stringify(sel3));
        const longWord = "a".repeat(201);
        const sel4 = nutDecor.findNutWordOccurrences(`${longWord}();`, 0, 1, { selection: { startLine: 0, startColumn: 1, endLine: 0, endColumn: 202 } });
        report("选区门控：选区长度超过 selectionHighlightMaxLength（200）不参与高亮", sel4 === null, JSON.stringify(sel4));

        // ---- 装饰覆盖层静态守卫（组件源码）：见文档 §3.6 绘制层次与差异登记 ----
        const editorSrc = readFileSync(new URL("../src/components/PvfEditor.vue", import.meta.url), "utf8");
        if (!editorSrc.includes("pvf-code-decor")) {
            reportSkip("编辑器装饰覆盖层静态守卫（组件未接入装饰层）");
        } else {
            const cssRuleBody = selector => {
                const at = editorSrc.indexOf(selector);
                if (at < 0) return null;
                const open = editorSrc.indexOf("{", at);
                const close = editorSrc.indexOf("}", open);
                return open < 0 || close < 0
                    ? null
                    : editorSrc
                          .slice(open + 1, close)
                          .replace(/\s+/g, " ")
                          .trim();
            };
            const windowAfter = (selector, len = 400) => {
                const at = editorSrc.indexOf(selector);
                return at < 0 ? "" : editorSrc.slice(at, at + len);
            };
            const decorRule = cssRuleBody(".pvf-code-decor");
            report(
                "装饰渲染：覆盖层绝对定位、pointer-events: none（不夺取 textarea 鼠标与光标行为）且 z-index 低于正文层",
                !!decorRule && /pointer-events: none/.test(decorRule) && /z-index: 0/.test(decorRule),
                String(decorRule)
            );
            report(
                "装饰渲染：装饰绘制于文字之下（正文层背景透明、编辑器底色移至容器）",
                /background:\s*transparent/.test(windowAfter(".pvf-code-highlight {")) && /background:\s*var\(--bg\)/.test(windowAfter(".pvf-code-main {")),
                windowAfter(".pvf-code-highlight {", 160)
            );
            report(
                "装饰渲染：折叠整行底色改由整行矩形承担（不再有行内底色包裹元素）",
                editorSrc.includes("pvf-decor-vrows") && /pvf-decor-fold/.test(editorSrc) && !/pvf-nut-folded-line/.test(editorSrc)
            );
            report(
                "装饰渲染：区块辅助线 / 活动块 / 同类词 / 当前行矩形类齐备",
                [".pvf-decor-guide", ".pvf-decor-guide-active", ".pvf-decor-occurrence", ".pvf-decor-occurrence-selection", ".pvf-decor-current"].every(c => editorSrc.includes(c))
            );
            report(
                "装饰渲染：工具层接线与光标 / 选区同步（光标换算 + @select 接线 + 滚动偏移同步）",
                editorSrc.includes("computeNutBlockGuideLevels") &&
                    editorSrc.includes("findNutActiveIndentGuide") &&
                    editorSrc.includes("findNutWordOccurrences") &&
                    editorSrc.includes("syncCaret") &&
                    editorSrc.includes('@select="syncCaret"') &&
                    editorSrc.includes("decorScroll")
            );
            report(
                "装饰渲染：辅助线列位置取 (层级 - 1) × 一级缩进宽（对齐 VS Code 缩进辅助线几何，深一层不压在文字上）",
                /\(g\s*-\s*1\)\s*\*\s*unitColumns/.test(editorSrc) && !/g\s*\*\s*unitColumns\s*\*\s*m\.charWidth/.test(editorSrc)
            );
            report(
                "装饰渲染：整行矩形与列锚定矩形分层（横向滚动只影响列锚定层）",
                editorSrc.includes("nutDecorRowRects") && editorSrc.includes("nutDecorCellRects") && editorSrc.includes("pvf-decor-cells")
            );
            // 行网格几何（§3.6「行坐标约定」）：装饰矩形纵坐标按 paddingTop + 行序 × lineHeight 换算，
            // 行高必须为整数固定值且四处（正文层 / gutter 行号层 / 装饰层 / 装饰矩形高度）共用同一变量。
            // 非整数行高（相对值 1.6 在 0.8rem 字号下为 20.48px）与浏览器按 LayoutUnit(1/64px) 取整后的
            // 实际逐行推进（20.46875px）相差 0.01125px/行，线性累积导致矩形随行号偏移（2000 行约 22px）。
            const lineGridUses = (editorSrc.match(/var\(--nut-editor-line-height/g) || []).length;
            report(
                "装饰渲染：行网格取整数固定行高（CSS 变量四处共用，声明于编辑器容器）",
                editorSrc.includes("--nut-editor-line-height: 20px") && lineGridUses >= 4 && !/line-height:\s*1\.6\s*;/.test(editorSrc) && !/height:\s*1\.6em/.test(editorSrc),
                `uses=${lineGridUses}`
            );
            report("装饰渲染：装饰矩形高度取同一行格变量（不再用 1.6em，避免与行盒差半像素）", /\.pvf-decor-cells > div\s*\{[^}]*height:\s*var\(--nut-editor-line-height/.test(editorSrc));
            report(
                "装饰渲染：指标行高回落取行格变量（不再回落 fontSize × 1.6，避免重现相对行高漂移）",
                editorSrc.includes('getPropertyValue("--nut-editor-line-height")') && !editorSrc.includes("fontSize * 1.6")
            );
        }
    }
}

// ================= 段 7：全量回归段（传入 PVF 路径时执行） =================
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
