// 物品发放分类枚举同步验证（docs/pvf-item-grant-parsing.md §14）。
// 验证 launch-helper 与 A21 权威 GM 工具（S4A21GmTool give.js / StackSegment /
// GetSlotRange）的分类语义一致：
//   ① 函数级断言：stackSegment 七段规则（含守护珠三种标签开头与两种子串命中）、
//      firstTypeTag 对 flag / flag gem / guild gem 的提取。
//   ② 可选全量统计：传入 PVF 路径时统计 stackable 各分段计数、守护珠段样例、
//      equipment 中 flag（公会勋章）标签计数。
// 运行方式：node test/item-grant-category-sync.mjs [PVF路径]
//   不传参数仅跑 ①；传回归基线路径（如 AGENTS.md §2 清单）附加 ②。
// 依赖：src/utils/pvfTool.js（Node 直接运行，无第三方依赖）。
import { readFileSync } from "node:fs";
import { PvfArchive, firstTypeTag, stackSegment } from "../src/utils/pvfTool.js";
import { TwPvfArchive } from "../src/utils/pvfToolTw.js";

let pass = 0;
const failures = [];
function eq(actual, expected, label) {
    if (actual === expected) {
        pass++;
        console.log(`PASS ${label}`);
    } else {
        failures.push(label);
        console.log(`FAIL ${label}: got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
    }
}

// ---- ① stackSegment 七段（A21 PvfIndexService.Items.StackSegment 同语义） ----
eq(stackSegment(null), "消耗品", "空输入 -> 消耗品");
eq(stackSegment("   "), "消耗品", "空白串 -> 消耗品");
eq(stackSegment("`[material]`"), "材料", "[material] -> 材料");
eq(stackSegment("`[material]` `x` 4"), "特殊材料", "[material] 尾随 4 -> 特殊材料");
eq(stackSegment("`[quest]`"), "任务品", "[quest] -> 任务品");
eq(stackSegment("`[material expert job]`"), "副职业材料", "[material expert job] -> 副职业材料");
eq(stackSegment("`[avatar emblem]`"), "徽章", "[avatar emblem] -> 徽章");
eq(stackSegment("`[flag gem]`"), "守护珠", "[flag gem] 开头 -> 守护珠");
eq(stackSegment("`[guardian gem]`"), "守护珠", "[guardian gem] 开头 -> 守护珠");
eq(stackSegment("`[guild gem]`"), "守护珠", "[guild gem] 开头 -> 守护珠");
eq(stackSegment("`[etc]` `[guardian gem]`"), "守护珠", "含 guardian gem 子串 -> 守护珠");
eq(stackSegment("`[etc]` 守护珠礼包"), "守护珠", "含 守护珠 子串 -> 守护珠");
eq(stackSegment("`[heal]`"), "消耗品", "其他标签 -> 消耗品");

// ---- ① firstTypeTag 守护珠/公会勋章标签提取 ----
eq(firstTypeTag("`[flag]`"), "flag", "firstTypeTag [flag] -> flag");
eq(firstTypeTag("`[flag gem]`"), "flag gem", "firstTypeTag [flag gem] -> flag gem");
eq(firstTypeTag("`[guild gem]`"), "guild gem", "firstTypeTag [guild gem] -> guild gem");

console.log(`\n函数级断言: ${pass} PASS / ${failures.length} FAIL`);
if (failures.length) process.exit(1);

// ---- ② 可选全量统计 ----
const pvfPath = process.argv[2];
if (!pvfPath) {
    console.log("\n未提供 PVF 路径，跳过全量统计（传入 AGENTS.md §2 回归基线路径可启用）。");
    process.exit(0);
}

console.log(`\n加载 PVF: ${pvfPath}`);
const buf = readFileSync(pvfPath);
// 先按 JP/JPAG/CN 解析，失败则按繁体 TW 解析（与 ItemCodeViewer 同降级顺序）
let arch = null;
try {
    arch = new PvfArchive(buf);
    await arch.parse();
} catch (err) {
    arch = new TwPvfArchive(buf);
    await arch.parse();
}

const findLst = re => arch.files.find(f => !f.isDir && re.test(f.fullpath || ""));
const segCount = new Map();
const guardGemSamples = [];
const stLst = findLst(/^stackable\/stackable\.lst$/i);
if (!stLst) throw new Error("归档中未找到 stackable/stackable.lst");
const stList = await arch.listLstItems(stLst);
const stMetas = await arch.listLstItemMeta(stLst, stList);
for (let i = 0; i < stList.length; i++) {
    const meta = stMetas[i];
    const seg = meta && meta.stackableType ? stackSegment(meta.stackableType) : "消耗品";
    segCount.set(seg, (segCount.get(seg) || 0) + 1);
    if (seg === "守护珠" && guardGemSamples.length < 10) guardGemSamples.push(`${stList[i].code}:${stList[i].name || stList[i].ref}`);
}
console.log("stackable 总数:", stList.length);
for (const seg of ["消耗品", "材料", "特殊材料", "任务品", "副职业材料", "徽章", "守护珠"]) {
    console.log(`  分段[${seg}] = ${segCount.get(seg) || 0}`);
}
console.log("守护珠段样例:", guardGemSamples.join(", ") || "(无)");

const eqLst = findLst(/^equipment\/equipment\.lst$/i);
if (eqLst) {
    const eqList = await arch.listLstItems(eqLst);
    const eqMetas = await arch.listLstItemMeta(eqLst, eqList);
    const flags = [];
    for (let i = 0; i < eqList.length; i++) {
        const meta = eqMetas[i];
        if (meta && firstTypeTag(meta.equipType) === "flag" && flags.length < 10) flags.push(`${eqList[i].code}:${eqList[i].name || eqList[i].ref}`);
    }
    console.log("equipment 总数:", eqList.length, "| flag(公会勋章) 标签计数:", eqMetas.filter(m => m && firstTypeTag(m.equipType) === "flag").length);
    console.log("flag 装备样例:", flags.join(", ") || "(无)");
}
