// ============================================================
// 脚本反编译缩进验证（docs/pvfine-external-reference.md §4）
// 运行：node test/indent-verify.mjs [70TW pvf路径] [86JP pvf路径]
//   基线缺省相对运行时工作目录：PVF/70TW/Script.pvf、PVF/86JP/Script.pvf
//   （基线根目录各机器不同，定位失败按 AGENTS.md「工作流前置」传参）
// 依赖：src/utils/pvfTool.js（实现接入后自动启用集成断言段）
// 分阶段：
//   PHASE-1 缩进状态机算法断言（内嵌参考实现，独立于 src，始终执行）
//   PHASE-2 src 实现与参考实现一致性（src 导出 PvfScriptIndenter 后启用）
//   PHASE-3 JP 集成：stub 字符串池实例 decodeToken 输出逐行断言
//   PHASE-4 基线抽查：TW 行首 Tab 结构 + JP/TW roundtrip 互逆（需基线文件）
// ============================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
let failCount = 0;
const FAIL = msg => {
    failCount++;
    console.log("  FAIL: " + msg);
};
const PASS = msg => console.log("  PASS: " + msg);

// ================= PHASE-1 参考实现（docs/pvfine-external-reference.md §2.4/§2.5 直接翻译） =================
// 标签解析：[inner] 且 inner 非空；'/' 前缀为闭合（'/' 单独不算）；其余（含裸串）返回 null。
function refParseSectionTag(text) {
    if (typeof text !== "string" || text.length < 3 || text[0] !== "[" || text[text.length - 1] !== "]") return null;
    const inner = text.slice(1, -1);
    if (!inner) return null;
    if (inner.charCodeAt(0) === 47) {
        if (inner.length === 1) return null;
        return { name: inner.slice(1), closing: true };
    }
    return { name: inner, closing: false };
}

// 缩进状态机（参考实现）：预扫描收集「出现过闭合形式」的标签名；仅这些开标签入栈；
// 标签行缩进 = 输出时栈深（闭合先弹栈、开标签先输出后入栈）；值区首值 = 栈深、
// 后续值行 = 栈深+1（栈空 = 1）；文件首个输出 token 前 = 0；子标签出现结束外层首值状态。
class RefIndenter {
    constructor() {
        this.closers = new Set();
        this.stack = [];
        this.seenAny = false;
    }
    preScanTag(text) {
        const t = refParseSectionTag(text);
        if (t && t.closing) this.closers.add(t.name);
    }
    tagLine(text) {
        this.seenAny = true;
        const t = refParseSectionTag(text);
        if (!t) return this.stack.length;
        if (t.closing) {
            let i = -1;
            for (let k = this.stack.length - 1; k >= 0; k--) {
                if (this.stack[k].name === t.name) {
                    i = k;
                    break;
                }
            }
            if (i >= 0) this.stack.length = i; // 弹出该 frame 及其上层全部
            return this.stack.length;
        }
        const depth = this.stack.length;
        if (this.stack.length > 0) this.stack[this.stack.length - 1].first = false;
        if (this.closers.has(t.name)) this.stack.push({ name: t.name, first: true });
        return depth;
    }
    valueIndent() {
        const first = !this.seenAny;
        this.seenAny = true;
        if (first) return 0;
        const d = this.stack.length;
        if (d === 0) return 1;
        return this.stack[this.stack.length - 1].first ? d : d + 1;
    }
    onValue() {
        if (this.stack.length > 0) this.stack[this.stack.length - 1].first = false;
    }
}

// 算法场景表：每例为一系列调用 -> 期望缩进序列
const ALGO_CASES = [
    {
        name: "单层闭合：开 0 / 首值 1 / 次值 2 / 闭合与开标签对齐",
        run: ind => {
            ind.preScanTag("[a]");
            ind.preScanTag("[/a]");
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.valueIndent());
            r.push(ind.tagLine("[/a]"));
            return r;
        },
        expect: [0, 1, 2, 0]
    },
    {
        name: "嵌套：外层 0 / 内层标签 1 / 内层首值 2 / 内层闭合 1 / 外层后续值 2 / 外层闭合 0",
        run: ind => {
            ind.preScanTag("[a]");
            ind.preScanTag("[/a]");
            ind.preScanTag("[b]");
            ind.preScanTag("[/b]");
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.tagLine("[b]")); // 子标签出现：外层首值状态结束
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.tagLine("[/b]"));
            r.push(ind.valueIndent()); // 外层 frame 的 first 已被子标签置 false -> 栈深+1
            ind.onValue();
            r.push(ind.tagLine("[/a]"));
            return r;
        },
        expect: [0, 1, 2, 1, 2, 0]
    },
    {
        name: "无闭合配对的开标签不改变层级（预扫描集合为空）",
        run: ind => {
            const r = [];
            r.push(ind.tagLine("[x]"));
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.tagLine("[y]"));
            r.push(ind.valueIndent());
            return r;
        },
        expect: [0, 1, 0, 1]
    },
    {
        name: "文件首个输出 token 缩进 0（值开头）",
        run: ind => {
            const r = [];
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.valueIndent());
            return r;
        },
        expect: [0, 1]
    },
    {
        name: "文件首个输出 token 缩进 0（标签开头，后续值不受 tokenSeen 影响）",
        run: ind => {
            ind.preScanTag("[a]");
            ind.preScanTag("[/a]");
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.tagLine("[/a]"));
            return r;
        },
        expect: [0, 1, 0]
    },
    {
        name: "非标签裸 type3 行按当前栈深整行缩进，不入栈且不结束外层首值状态（仅子标签结束）",
        run: ind => {
            ind.preScanTag("[a]");
            ind.preScanTag("[/a]");
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.tagLine("behold"));
            r.push(ind.valueIndent()); // first 仍为 true -> 栈深 1
            ind.onValue();
            r.push(ind.tagLine("[/a]"));
            return r;
        },
        expect: [0, 1, 1, 0]
    },
    {
        name: "闭合与开启大小写不一致：开标签不入栈、闭合不弹栈（与参考实现一致，区分大小写）",
        run: ind => {
            ind.preScanTag("[/a]");
            const r = [];
            r.push(ind.tagLine("[A]"));
            r.push(ind.valueIndent());
            ind.onValue();
            r.push(ind.tagLine("[/a]"));
            return r;
        },
        expect: [0, 1, 0]
    },
    {
        name: "闭合弹栈截断多层（弹出该 frame 及其上层全部）",
        run: ind => {
            for (const t of ["[a]", "[/a]", "[b]", "[/b]", "[c]", "[/c]"]) ind.preScanTag(t);
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.tagLine("[b]"));
            r.push(ind.tagLine("[c]")); // 栈 [a,b,c]
            r.push(ind.tagLine("[/a]")); // 弹 a 及其上全部 -> 栈空
            r.push(ind.tagLine("[b2]")); // 顶层
            return r;
        },
        expect: [0, 1, 2, 0, 0]
    },
    {
        name: "同层重复开标签：闭合弹最近同名",
        run: ind => {
            for (const t of ["[a]", "[/a]", "[a]", "[/a]"]) ind.preScanTag(t);
            const r = [];
            r.push(ind.tagLine("[a]"));
            r.push(ind.tagLine("[a]")); // 同名嵌套入栈
            r.push(ind.tagLine("[/a]")); // 弹最近（内层）-> 栈深 1
            r.push(ind.tagLine("[/a]")); // 弹外层 -> 0
            return r;
        },
        expect: [0, 1, 1, 0]
    },
    {
        name: "标签解析边界：'[]'、'[/]'、'ab'、'[a' 均非标签",
        run: () => {
            return [refParseSectionTag("[]"), refParseSectionTag("[/]"), refParseSectionTag("ab"), refParseSectionTag("[a")];
        },
        expect: [null, null, null, null]
    }
];

console.log("\nPHASE-1 缩进状态机算法断言（内嵌参考实现）:");
for (const c of ALGO_CASES) {
    const ind = new RefIndenter();
    const got = c.run(ind);
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    if (ok) PASS(c.name);
    else FAIL(`${c.name}（got=${JSON.stringify(got)} expect=${JSON.stringify(c.expect)}）`);
}

// ================= src 实现接入检测 =================
let src = null;
try {
    src = await import(path.join(here, "..", "src", "utils", "pvfTool.js"));
} catch (e) {
    console.log("\n[src] 加载失败：" + e.message);
}
const hasSrcImpl = !!(src && src.PvfScriptIndenter && src.parseSectionTagText);

// ================= PHASE-2 src 实现一致性（实现接入后启用） =================
if (hasSrcImpl) {
    console.log("\nPHASE-2 src PvfScriptIndenter 与参考实现一致性:");
    let mismatch = 0;
    for (const c of ALGO_CASES) {
        const ref = new RefIndenter();
        const imp = new src.PvfScriptIndenter();
        // 同一场景对两个实现各跑一遍（tagLine/valueIndent/onValue 同名 API）
        const a = c.run(ref);
        const b = c.run(imp);
        if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(b) !== JSON.stringify(c.expect)) {
            mismatch++;
            FAIL(`${c.name}（src=${JSON.stringify(b)} ref=${JSON.stringify(a)} expect=${JSON.stringify(c.expect)}）`);
        }
    }
    // 标签解析一致
    for (const s of ["[a]", "[/a]", "[]", "[/]", "ab", "[a", "[a b]", "[/a b]"]) {
        if (JSON.stringify(src.parseSectionTagText(s)) !== JSON.stringify(refParseSectionTag(s))) {
            mismatch++;
            FAIL(`parseSectionTagText(${s}) 与参考实现不一致`);
        }
    }
    if (mismatch === 0) PASS(`全部 ${ALGO_CASES.length} 场景 + 标签解析边界一致`);
} else {
    console.log("\nPHASE-2 跳过：src/utils/pvfTool.js 尚未导出 PvfScriptIndenter（实现接入后自动启用）");
}

// ================= PHASE-3 JP 集成（stub 字符串池实例 decodeToken） =================
// 构造绕过 parse 的最小实例：resolveString 偶数偏移走 _strAValueCache[idx]（idx = magicOff >> 1）。
function makeStubJpArch(strings) {
    const a = Object.create(src.PvfArchive.prototype);
    a._strAValueCache = strings;
    a._strWValueCache = [];
    a.getOrAddStringOffset = s => {
        const idx = strings.indexOf(s);
        if (idx >= 0) return idx << 1;
        strings.push(s);
        return (strings.length - 1) << 1;
    };
    return a;
}
function jpTokens(pairs) {
    // pairs: [type, value][]（value 为字符串时按 stub 池解析为偏移）
    return pairs;
}

if (hasSrcImpl) {
    console.log("\nPHASE-3 JP 集成断言（stub 实例 decodeToken）:");
    const strings = ["[equipment]", "[name]", "[/name]", "[/equipment]", "[orphan]", "behold"];
    const off = i => i << 1;
    const arch = makeStubJpArch(strings);
    // token 流：[equipment] / [name] / 1 / `守护` / [/name] / 2 3 / [orphan]（无闭合）/ behold（裸串）/ [/equipment]
    const data = new Uint8Array(10 * 5);
    const seq = [
        [3, off(0)],
        [3, off(1)],
        [0, 1],
        [6, off(9)], // `守护`（字符串池 idx 9，下方补足）
        [3, off(2)],
        [0, 2],
        [0, 3],
        [3, off(4)],
        [3, off(5)],
        [3, off(3)]
    ];
    seq.forEach(([t, v], k) => {
        data[k * 5] = t;
        data[k * 5 + 1] = v & 0xff;
        data[k * 5 + 2] = (v >> 8) & 0xff;
        data[k * 5 + 3] = (v >> 16) & 0xff;
        data[k * 5 + 4] = (v >> 24) & 0xff;
    });
    // 解码前补足字符串池（resolveString 越界回退 _readUtf8String 需要 strABuf 存在的前提）
    while (strings.length < 10) strings.push("");
    strings[9] = "守护";
    const out2 = arch.decodeTokenIndented(data);
    const got = out2.replace(/\n+/g, "\n").replace(/^\n/, "").replace(/\n$/, "").split("\n");
    // [equipment] 入栈（有闭合）；[name] 缩进 1（equipment 栈深）并入栈；首值 1 = 栈深 1；
    // `守护` = 栈深+1 = 2；[/name] 弹栈 = 1；「2 3」= equipment.first 已被子标签置 false -> 栈深+1 = 2；
    // [orphan] / behold 不入栈，按当前栈深 1；[/equipment] 弹栈 = 0
    const want = ["[equipment]", "\t[name]", "\t\t1", "\t\t\t`守护`", "\t[/name]", "\t\t2 3", "\t[orphan]", "\tbehold", "[/equipment]"];
    if (got.join("\n") === want.join("\n")) PASS("decodeTokenIndented 嵌套缩进输出逐行一致");
    else {
        FAIL("decodeTokenIndented 输出与预期不符");
        console.log("    got:  " + JSON.stringify(got));
        console.log("    want: " + JSON.stringify(want));
    }
    // 原方法保持无缩进（输出不含 Tab，既有路径不受影响）
    const plain = arch.decodeToken(data);
    if (!plain.includes("\t")) PASS("原 decodeToken 输出保持无缩进（不受新方法影响）");
    else FAIL("原 decodeToken 输出被污染（含 Tab）");
    // roundtrip（stub）：decode 输出 -> encodeTokenText -> token 序列与原 seq 等价
    const re = arch.encodeTokenText(out2);
    const reTok = [];
    for (let k = 0; k < re.length; k += 5) {
        reTok.push([re[k], re[k + 1] | (re[k + 2] << 8) | (re[k + 3] << 16) | (re[k + 4] << 24)]);
    }
    // 原序 [6, off(9)] 再编码后为 [6, 反查"守护"偏移]；字符串池在 getOrAddStringOffset 中追加过一次，
    // 反查 idx 与 off(9) 一致才视为等价
    const norm = reTok.map(([t, v]) => (t === 6 && strings[v >> 1] === "守护" ? [6, off(9)] : [t, v]));
    const same = JSON.stringify(norm) === JSON.stringify(seq);
    if (same) PASS("stub roundtrip：decode -> encode -> token 序列等价（缩进被丢弃）");
    else {
        FAIL("stub roundtrip 不等价");
        console.log("    reTok: " + JSON.stringify(reTok));
        console.log("    seq:   " + JSON.stringify(seq));
    }
} else {
    console.log("\nPHASE-3 跳过：src 实现未接入");
}

// ================= PHASE-4 基线抽查（需基线文件） =================
const TW_PATH = process.argv[2] || "PVF/70TW/Script.pvf";
const JP_PATH = process.argv[3] || "PVF/86JP/Script.pvf";

async function loadBaseline(pvfPath, label, kind) {
    let buf;
    try {
        buf = readFileSync(pvfPath);
    } catch {
        console.log(`\nPHASE-4 跳过：${label} 基线不可读（${pvfPath}）——按 AGENTS.md「工作流前置」确认位置后传参`);
        return null;
    }
    if (kind === "jp") {
        const arch = new src.PvfArchive(buf);
        await arch.parse();
        return arch;
    }
    const { TwPvfArchive } = await import(path.join(here, "..", "src", "utils", "pvfToolTw.js"));
    const arch = new TwPvfArchive(buf);
    await arch.parse();
    arch._twInitStringTables();
    return arch;
}

const tokenEq = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};

if (hasSrcImpl) {
    // ---- TW 行首 Tab 结构断言 + TW roundtrip（一次加载 70TW） ----
    {
        const arch = await loadBaseline(TW_PATH, "70TW", "tw");
        if (arch) {
            console.log("\nPHASE-4 TW 行首 Tab 结构断言（70TW 抽样）:");
            let checked = 0;
            let badAlign = 0;
            let indented = 0;
            const files = arch.files.filter(f => !f.isDir && f.dataType === 1 && /\.etc$/i.test(f.name)).slice(0, 40);
            for (const f of files) {
                const data = await arch.getFileData(f);
                if (!data || data.length < 2 || data[0] !== 0xb0 || data[1] !== 0xd0) continue;
                const text = arch.decodeTwTokenIndented(data);
                const lines = text.split("\n");
                // 同名开/闭标签行首 Tab 数必须一致（栈语义），且至少出现一次非零缩进才计数
                const openDepth = new Map();
                let pairChecked = 0;
                for (const line of lines) {
                    const m = /^(\t*)(\[\/?[^[\]]*\])$/.exec(line);
                    if (!m) continue;
                    const tag = m[2];
                    const name = tag.replace(/^\[\/?/, "").replace(/\]$/, "");
                    if (tag.startsWith("[/")) {
                        if (openDepth.has(name)) {
                            pairChecked++;
                            if (openDepth.get(name) !== m[1].length) badAlign++;
                            openDepth.delete(name);
                        }
                    } else {
                        openDepth.set(name, m[1].length);
                    }
                }
                if (pairChecked > 0) {
                    checked++;
                    if (lines.some(l => l.startsWith("\t"))) indented++;
                }
            }
            if (checked > 0 && badAlign === 0) {
                PASS(`70TW 抽样 ${checked} 个含闭合标签的 .etc：开/闭标签 Tab 对齐全部一致（含缩进的文件 ${indented} 个）`);
            } else if (checked === 0) {
                console.log(`  SKIP：抽样未覆盖含闭合标签的 .etc（files=${files.length}）`);
            } else {
                FAIL(`70TW 开/闭标签 Tab 对齐不一致 ${badAlign} 处`);
            }

            console.log("\nPHASE-4 TW roundtrip（70TW 抽样 200 个 0xD0B0 token 流，对照式归因）:");
            let total = 0;
            let ok = 0;
            let skipped = 0;
            let legacyFail = 0; // 原方法（无缩进）同样失败：既有编码器边角，非缩进引入
            let indentFail = 0; // 原方法成功而缩进方法失败：缩进引入的互逆破坏
            const failSamples = [];
            const cand = arch.files.filter(f => !f.isDir && f.dataType === 1 && !/\.lst$/i.test(f.name));
            for (let i = 0; i < cand.length && total < 200; i++) {
                const f = cand[i];
                const data = await arch.getFileData(f);
                if (!data || data.length < 2 || data[0] !== 0xb0 || data[1] !== 0xd0) continue;
                const text = arch.decodeContentForEdit(f, data);
                if (text.includes("?(")) {
                    skipped++;
                    continue;
                }
                total++;
                const re = arch.encodeContent(f, text);
                if (tokenEq(re, data)) ok++;
                else if (tokenEq(arch.encodeContent(f, arch.decodeContent(f, data)), data)) {
                    indentFail++;
                    if (failSamples.length < 3) failSamples.push(f.fullpath);
                } else legacyFail++;
            }
            const rate = total ? Math.round((ok / total) * 100) : 0;
            if (total > 0 && indentFail === 0)
                PASS(
                    `70TW roundtrip 缩进无互逆破坏（成功 ${ok}/${total}=${rate}%；既有边角失败 ${legacyFail} 个不计入，跳过含未知类型占位 ${skipped} 个）${failSamples.length ? "，缩进引入失败示例：" + failSamples.join(" / ") : ""}`
                );
            else if (total === 0) console.log("  SKIP：未取得可抽样文件");
            else FAIL(`70TW roundtrip 缩进引入互逆破坏 ${indentFail} 个，失败示例：${failSamples.join(" / ")}`);
        }
    }

    // ---- roundtrip：decode -> encode -> token 序列逐字节一致（对照式归因） ----

    {
        const arch = await loadBaseline(JP_PATH, "86JP", "jp");
        if (arch) {
            console.log("\nPHASE-4 JP roundtrip（86JP 抽样 200 个 dataType=1，对照式归因）:");
            let total = 0;
            let ok = 0;
            let skipped = 0;
            let legacyFail = 0;
            let indentFail = 0;
            const failSamples = [];
            const cand = arch.files.filter(f => !f.isDir && f.dataType === 1 && !/\.lst$/i.test(f.name || ""));
            for (let i = 0; i < cand.length && total < 200; i++) {
                const f = cand[i];
                const data = await arch.getFileData(f);
                if (!data || data.length === 0) continue;
                const text = arch.decodeContentForEdit(f, data);
                if (text.includes("?(")) {
                    skipped++;
                    continue;
                }
                total++;
                const re = arch.encodeContent(f, text);
                if (tokenEq(re, data)) ok++;
                else if (tokenEq(arch.encodeContent(f, arch.decodeContent(f, data)), data)) {
                    indentFail++;
                    if (failSamples.length < 3) failSamples.push(f.fullpath);
                } else legacyFail++;
            }
            const rate = total ? Math.round((ok / total) * 100) : 0;
            if (total > 0 && indentFail === 0)
                PASS(
                    `86JP roundtrip 缩进无互逆破坏（成功 ${ok}/${total}=${rate}%；既有边角失败 ${legacyFail} 个不计入，跳过含未知类型占位 ${skipped} 个）${failSamples.length ? "，缩进引入失败示例：" + failSamples.join(" / ") : ""}`
                );
            else if (total === 0) console.log("  SKIP：未取得可抽样文件");
            else FAIL(`86JP roundtrip 缩进引入互逆破坏 ${indentFail} 个，失败示例：${failSamples.join(" / ")}`);
        }
    }
} else {
    console.log("\nPHASE-4 跳过：src 实现未接入");
}

console.log("\n" + (failCount === 0 ? "全部断言通过" : `存在 ${failCount} 个 FAIL`));
process.exit(failCount === 0 ? 0 : 1);
