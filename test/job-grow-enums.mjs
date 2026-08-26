// 职业枚举固化常量断言脚本（见 docs/pvf-job-grow-names.md）
//
// 模式：
//   ① 无参运行：静态口径断言——src/utils/jobGrowNames.js 结构合法性 + 关键金样本点
//   ② 传入 PVF 路径：现场从归档重新提取 character/character.lst -> *.chr 的
//      转职名与觉醒名单，与 JOB_GROWS 全量逐项比对
//
// 运行方式：
//   node test/job-grow-enums.mjs                       # 静态口径断言
//   node test/job-grow-enums.mjs <PVF路径>             # 提取 + 全量比对
//   （86JPL 常量快照仅与同版本归档精确比对，见文档 §7）
//
// 依赖：Node 内置模块 + src/utils/pvfTool.js + src/utils/jobGrowNames.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { PvfArchive, extractTagFromText } = await import(new URL("../src/utils/pvfTool.js", import.meta.url).href);
const { JOB_NAMES, JOB_GROWS, getBranchOptions, getAwakeningOptions, growLabel } = await import(new URL("../src/utils/jobGrowNames.js", import.meta.url).href);

// ============================================================
// 一、PVF 现场提取（解析语义见 docs/pvf-job-grow-names.md §2）
// ============================================================

function parseLstEntries(text) {
    const entries = [];
    const re = /(\d+)\s+`([^`]+)`/g;
    let m;
    while ((m = re.exec(text))) entries.push({ id: parseInt(m[1], 10), rel: m[2].replace(/\\/g, "/") });
    return entries;
}

// 反引号串解壳（含 `` 转义）
function unquote(line) {
    const m = /^`((?:[^`]|``)*)`$/.exec(line);
    return m ? m[1].replace(/``/g, "`") : null;
}

// [growtype name] 名单：首项=基础名，其后依次为转职分支 first=1..N 名称
function parseGrowtypeName(text) {
    const res = extractTagFromText(text, "growtype name");
    if (!res) return { baseName: "", branches: {} };
    const names = res.raw.map(unquote).filter(v => v != null);
    const branches = {};
    for (let k = 1; k < names.length; k++) branches[k] = names[k];
    return { baseName: names[0] || "", branches };
}

// 单个 .chr 明文 -> { baseName, grows: { first -> { name, awakens[] } } }
// 常规映射：分支 first=N 的数据段为 [growtype N+1]（N≥1），段内首个 [awakening name]
// 即该分支觉醒名单（首块为准）；无对应段则 awakens 为空数组。
// 直进职业回退：全部名单与首项相同且不存在任何 [growtype N≥2] 段时（黑暗武士/缔造者），
// 仅保留分支 first=1，觉醒名单取 [growtype 1] 段（见 docs/pvf-job-grow-names.md §2.2）。
function parseChrToJob(chrText) {
    const lines = String(chrText)
        .split("\n")
        .map(l => l.trim());
    const { baseName, branches } = parseGrowtypeName(chrText);
    // 数值段范围切分：segStarts[n] = [growtype n] 行下标
    const segStarts = new Map();
    lines.forEach((l, i) => {
        const m = /^\[growtype (\d+)\]$/.exec(l);
        if (m) segStarts.set(parseInt(m[1], 10), i);
    });
    // 数值段内首个 [awakening name] 反引号名单（首块为准）
    const readSegmentAwakens = startIdx => {
        if (startIdx == null) return [];
        const endIdx = (() => {
            for (let i = startIdx + 1; i < lines.length; i++) {
                if (/^\[growtype \d+\]$/.test(lines[i])) return i;
            }
            return lines.length;
        })();
        const res = extractTagFromText(lines.slice(startIdx, endIdx).join("\n"), "awakening name");
        return res
            ? res.raw
                  .map(unquote)
                  .filter(v => v != null)
                  .slice(0, 2)
            : [];
    };
    const branchList = Object.keys(branches)
        .map(Number)
        .sort((a, b) => a - b);
    const hasUpperSeg = [...segStarts.keys()].some(n => n >= 2);
    if (branchList.length && !hasUpperSeg && branchList.every(k => branches[k] === branches[branchList[0]])) {
        return { baseName: branches[branchList[0]], grows: { 1: { name: branches[1], awakens: readSegmentAwakens(segStarts.get(1)) } } };
    }
    const grows = {};
    for (const first of branchList) {
        grows[first] = { name: branches[first], awakens: readSegmentAwakens(segStarts.get(first + 1)) };
    }
    return { baseName, grows };
}

async function extractFromPvf(pvfPath) {
    const buf = readFileSync(pvfPath);
    const arch = new PvfArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    await arch.parse();
    // 归档 fullpath 统一小写；lst 内引用混合大小写，匹配前归一（文档 §2.1）
    const byPath = new Map();
    for (const f of arch.files) if (!f.isDir && f.fullpath) byPath.set(f.fullpath.toLowerCase(), f);
    const lstFile = byPath.get("character/character.lst");
    if (!lstFile) throw new Error("归档中未找到 character/character.lst");
    const lstText = arch.decodeContent(lstFile, await arch.getFileData(lstFile));
    const jobs = {};
    for (const { id, rel } of parseLstEntries(lstText)) {
        const chrFile = byPath.get(("character/" + rel).toLowerCase());
        if (!chrFile) continue;
        const data = await arch.getFileData(chrFile);
        if (!data || !data.length) continue;
        const text = arch.decodeContent(chrFile, data);
        if (!text) continue;
        jobs[id] = parseChrToJob(text);
    }
    return jobs;
}

// ============================================================
// 二、断言执行
// ============================================================

let passCount = 0;
let failCount = 0;
const ok = (name, cond, detail = "") => {
    if (cond) {
        passCount++;
        console.log(`PASS  ${name}`);
    } else {
        failCount++;
        console.log(`FAIL  ${name}${detail ? " | " + detail : ""}`);
    }
};

// ---- 模式①：静态口径 ----
function runStaticAssertions() {
    ok("JOB_NAMES 覆盖 14 个职业(0-13)", Object.keys(JOB_NAMES).length === 14 && ["0", "13"].every(k => k in JOB_NAMES));
    ok("JOB_GROWS 键集与 JOB_NAMES 一致", JSON.stringify(Object.keys(JOB_GROWS).sort((a, b) => a - b)) === JSON.stringify(Object.keys(JOB_NAMES).sort((a, b) => a - b)));

    let structureOk = true;
    let detail = "";
    for (const [jobIdStr, grows] of Object.entries(JOB_GROWS)) {
        for (const [firstStr, g] of Object.entries(grows)) {
            const first = Number(firstStr);
            // 5 转未定案分支刻意不收录（见 docs/pvf-job-grow-names.md §4.2），表内仅 1-4
            if (!(first >= 1 && first <= 4)) {
                structureOk = false;
                detail = `job${jobIdStr} first 越界 ${first}`;
            }
            if (!g.name || typeof g.name !== "string") {
                structureOk = false;
                detail = `job${jobIdStr}/first${first} 分支名缺失`;
            }
            if (!Array.isArray(g.awakens) || g.awakens.length > 2 || g.awakens.some(s => !s || typeof s !== "string")) {
                structureOk = false;
                detail = `job${jobIdStr}/first${first} 觉醒名单非法`;
            }
            if (first === 0) {
                structureOk = false;
                detail = `job${jobIdStr} 不应含 first=0`;
            }
        }
    }
    ok("JOB_GROWS 结构合法（分支键 1-4 / 觉醒名单 ≤2 项）", structureOk, detail);
    ok(
        "5 转分支一律不收录（所有职业无 first=5 键）",
        Object.values(JOB_GROWS).every(grows => !(5 in grows))
    );

    // SendItemView.vue 接入口径：三个下拉选项成员必须是计算属性（误放 methods 会导致
    // 模板 v-for 遍历函数对象，角色查询后转职/觉醒无可选项——2026-08-27 实测缺陷）。
    // 不依赖 computed/methods 块顺序：成员定义起点落在 computed 起点与其块尾之间即为 computed
    const vueSrc = readFileSync(path.join(rootDir, "src/components/SendItemView.vue"), "utf8");
    const regionOf = key => {
        const start = vueSrc.indexOf(`\n        ${key}(`);
        if (start < 0) return "";
        const cStart = vueSrc.indexOf("\n    computed: {");
        const cEnd = vueSrc.indexOf("\n    },", cStart);
        return start > cStart && start < cEnd ? "computed" : "other";
    };
    for (const key of ["roleJobIndexed", "roleBranchOptions", "roleAwakenOptions"]) {
        ok(`SendItemView ${key} 位于 computed（非 methods）`, regionOf(key) === "computed");
    }
    // roleAwakenOptions 不得受启用开关门控：未勾选时下拉缺项会导致已二觉角色当前值回显空白
    {
        const segStart = vueSrc.indexOf("roleAwakenOptions");
        const seg = vueSrc.slice(segStart);
        const body = seg.slice(0, seg.indexOf("\n        }"));
        ok("roleAwakenOptions 不受启用开关门控（禁用态也回显当前觉醒名）", !body.includes("roleEnableGrow"));
    }
    // 修改角色卡片默认回显查询结果：resetRoleForm 以角色当前值初始化各输入控件
    ok(
        "resetRoleForm 回显当前名/等级/档位",
        vueSrc.includes("this.roleName = role?.name") && vueSrc.includes("Number(role.level)") && /\n        resetRoleForm\([\s\S]*?parts\.first[\s\S]*?parts\.second/.test(vueSrc)
    );

    // 金样本点（docs/pvf-job-grow-names.md §3 抽样）
    ok("金样本 job0/3 狂战士 狱血魔神|帝血弑天", JOB_GROWS[0][3]?.name === "狂战士" && JSON.stringify(JOB_GROWS[0][3]?.awakens) === JSON.stringify(["狱血魔神", "帝血弑天"]));
    ok("金样本 job12/1 精灵骑士 星辰之光|大地女神", JOB_GROWS[12]?.[1]?.name === "精灵骑士" && JSON.stringify(JOB_GROWS[12]?.[1]?.awakens) === JSON.stringify(["星辰之光", "大地女神"]));
    ok("金样本 job13/1 征战者 战魂|不灭战神", JOB_GROWS[13]?.[1]?.name === "征战者" && JSON.stringify(JOB_GROWS[13]?.[1]?.awakens) === JSON.stringify(["战魂", "不灭战神"]));
    ok("金样本 job9 黑暗武士 直进同名名单", JOB_GROWS[9]?.[1]?.name === "黑暗武士" && JSON.stringify(JOB_GROWS[9]?.[1]?.awakens) === JSON.stringify(["黑暗武士", "黑暗武士"]));
    ok("金样本 占位键照原样保留 growtype_name_219", JOB_GROWS[12]?.[3]?.name === "growtype_name_219" && JOB_GROWS[12]?.[3]?.awakens.length === 0);

    // grow_type 位编码解码链路（docs/pvf-job-grow-names.md §2.3 走查实例：job7 + 33）
    const parts33 = { first: 33 & 0xf, second: (33 >> 4) & 0xf };
    ok("金样本 job7/grow_type=33 位拆分 first=1 second=2", parts33.first === 1 && parts33.second === 2);
    ok("金样本 job7/first1 气功师 觉醒名单 狂虎帝|念皇", JOB_GROWS[7]?.[1]?.name === "气功师" && JSON.stringify(JOB_GROWS[7]?.[1]?.awakens) === JSON.stringify(["狂虎帝", "念皇"]));
    ok("金样本 growLabel(7,1,2) = 气功师·念皇（二觉）", growLabel(7, 1, 2) === "气功师·念皇");
    ok("金样本 growLabel(7,1,1)/(7,1,0) 一觉与未觉醒文案", growLabel(7, 1, 1) === "气功师·狂虎帝" && growLabel(7, 1, 0) === "气功师");
    ok("反向构造 (2<<4)|1=33 与线缆编码一致", (2 << 4) | (1 === 33));

    // 辅助函数口径
    const branchOpts = getBranchOptions(0);
    ok("getBranchOptions(0)：未转职首项 + 分支名（无 5 转）", branchOpts?.[0]?.value === 0 && branchOpts[0].label === "未转职" && branchOpts[3]?.label === "狂战士" && branchOpts.length === 5);
    ok("getBranchOptions 未知 job 返回 null（回退泛化文案）", getBranchOptions(999) === null);
    const awOpts = getAwakeningOptions(0, 3);
    ok("getAwakeningOptions(0,3)：一觉+二觉两项", awOpts.length === 2 && awOpts[0].value === 1 && awOpts[0].label === "狱血魔神" && awOpts[1].value === 2 && awOpts[1].label === "帝血弑天");
    ok("getAwakeningOptions 无觉醒数据返回 []（锁定未觉醒）", getAwakeningOptions(12, 3).length === 0 && getAwakeningOptions(12, 5).length === 0 && getAwakeningOptions(0, 0).length === 0);
}

// ---- 模式②：归档全量比对 ----
async function runArchiveComparison(pvfArg) {
    console.log(`加载归档：${pvfArg}`);
    const extracted = await extractFromPvf(pvfArg);
    let compareTotal = 0;
    let compareFail = 0;
    for (const jobIdStr of Object.keys(JOB_GROWS)) {
        const jobId = Number(jobIdStr);
        const ext = extracted[jobId];
        if (!ext) {
            console.log(`FAIL  job${jobId} 归档提取缺失`);
            compareFail++;
            continue;
        }
        const consts = JOB_GROWS[jobId];
        for (const firstStr of Object.keys(consts)) {
            const first = Number(firstStr);
            compareTotal += 2;
            const e = ext.grows[first];
            const c = consts[first];
            const eAw = e?.awakens ?? [];
            if (c.name !== e?.name) {
                console.log(`FAIL  job${jobId}/first${first} 转职名：常量「${c.name}」 vs 归档「${e?.name}」`);
                compareFail++;
            }
            if (JSON.stringify(c.awakens) !== JSON.stringify(eAw)) {
                console.log(`FAIL  job${jobId}/first${first} 觉醒名单：常量 ${JSON.stringify(c.awakens)} vs 归档 ${JSON.stringify(eAw)}`);
                compareFail++;
            }
        }
    }
    if (compareFail === 0) {
        ok(`归档逐项比对（共 ${compareTotal} 项：转职名 + 觉醒名单）`, true);
    } else {
        failCount++;
        console.log(`FAIL  归档逐项比对失败 ${compareFail}/${compareTotal} 项`);
    }
    // 归档存在而常量未收录的分支清点（信息性输出；当前口径为 5 转未定案分支刻意排除，
    // 见 docs/pvf-job-grow-names.md §4.2——若清单中出现 first<=4 的分支说明新版本
    // 实装了未登记分支，须评估后补录常量）
    const extra = [];
    for (const jobIdStr of Object.keys(extracted)) {
        for (const firstStr of Object.keys(extracted[jobIdStr].grows)) {
            if (!(firstStr in JOB_GROWS[jobIdStr] ?? {})) {
                extra.push(`job${jobIdStr}/first${firstStr}=${extracted[jobIdStr].grows[firstStr]?.name}`);
            }
        }
    }
    if (extra.length) {
        console.log(`INFO  常量未收录分支（当前口径为刻意排除）：${extra.join("、")}`);
    }
}

// ============================================================
// 三、入口
// ============================================================

runStaticAssertions();

const pvfArg = process.argv[2];
if (pvfArg) {
    await runArchiveComparison(pvfArg);
}

console.log(`\n合计：${passCount} PASS / ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
