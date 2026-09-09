// PVF 标签代码引用规则验证脚本（见 docs/pvf-tag-code-ref-rules.md §5）
//
// 模式：纯数据层验证，不依赖 PVF 归档。
//   node test/tag-code-ref-verify.mjs
//
// 验证内容：
//   ① 数据源完整性：XML 解析无异常，File 分组数 / 规则总数 / 验证条件数 / 列映射数
//      达固化管理值（配置更新后基数变化时，按 docs/pvf-tag-code-ref-rules.md §3.1 更新）
//   ② 解析正确性：抽取代表性规则逐字段断言（通配 / 精确文件、普通列 / 多列 /
//      SectionGroup / SectionRange / IgnoreItemCode / 父标签限定 / 验证条件 /
//      空标签名规则）
//   ③ 匹配 API：通配命中、精确命中（大小写不敏感）、任意标签规则命中、跨类型不命中
//   ④ 悬浮渲染：命中输出含列号 / lst 表 / 说明 / 条件文案；无命中返回空串；相同行去重
//
// 依赖：Node 内置模块 + src/utils/pvfCodeRef.js + src/utils/ItemCodeHoverConfig.xml

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const codeRef = await import(new URL("../src/utils/pvfCodeRef.js", import.meta.url).href);

let failCount = 0;
function PASS(msg) {
    console.log("PASS " + msg);
}
function FAIL(msg) {
    failCount++;
    console.log("FAIL " + msg);
}
function check(name, cond, detail) {
    if (cond) PASS(name);
    else FAIL(name + (detail !== undefined ? `（${detail}）` : ""));
}
function eqJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// ============================================================
// 一、数据源装载（Node 端显式注入；浏览器端由 ?raw 自动装配）
// ============================================================

const xmlPath = path.join(rootDir, "src", "utils", "ItemCodeHoverConfig.xml");
let xmlText = null;
try {
    xmlText = readFileSync(xmlPath, "utf8");
} catch (e) {
    FAIL(`数据源读取失败：${xmlPath}（${e.message}）`);
    console.log("\n存在 FAIL，终止后续断言");
    process.exit(1);
}
codeRef.configureCodeRef(xmlText);
PASS("数据源装载完成（src/utils/ItemCodeHoverConfig.xml）");

// ============================================================
// 二、固化管理值断言（2025-12-03 版配置：72 个 File 分组 / 410 条规则 /
//     57 个列映射子项 / 57 个验证条件）
// ============================================================

const allRules = codeRef.parseItemCodeHoverConfig(xmlText);
const fileCount = new Set(allRules.map(r => r.file)).size;
const groupItemCount = allRules.reduce((n, r) => n + (r.group ? r.group.length : 0), 0);
const validationCount = allRules.reduce((n, r) => n + r.validations.length, 0);
const rangeCount = allRules.filter(r => r.rangeStart != null).length;

check(`File 分组数 = 72（实际 ${fileCount}）`, fileCount === 72);
check(`规则总数 = 410（实际 ${allRules.length}）`, allRules.length === 410);
check(`列映射子项总数 = 57（实际 ${groupItemCount}）`, groupItemCount === 57);
check(`验证条件总数 = 57（实际 ${validationCount}）`, validationCount === 57);
check(`SectionRange 规则数 = 2（实际 ${rangeCount}）`, rangeCount === 2);

// ============================================================
// 三、解析正确性（代表性规则逐字段）
// ============================================================

function pick(file, tag, pred) {
    return allRules.filter(r => r.file === file && r.tag === tag && (!pred || pred(r)));
}

// 通配 + 大写标签名归一 + 父标签限定
const actIndex = pick("*.act", "index");
check("*.act [INDEX] 规则 2 条且标签归一为小写", actIndex.length === 2 && actIndex.every(r => r.parentTag), JSON.stringify(actIndex.map(r => r.parentTag)));
check(
    "*.act [INDEX] parentTag=[summon monster] lst=[monster] 描述=怪物 / parentTag=[summon apc] lst=[aicharacter] 描述=APC",
    actIndex.some(r => r.parentTag === "summon monster" && eqJson(r.lst, ["monster"]) && r.description === "怪物") &&
        actIndex.some(r => r.parentTag === "summon apc" && eqJson(r.lst, ["aicharacter"]) && r.description === "APC")
);

// 验证条件（字符串值 + CurrentLine）
const equSdu = pick("*.equ", "skill data up");
check("*.equ [skill data up] 规则条数 = 5", equSdu.length === 5, String(equSdu.length));
const swordmanRule = equSdu.find(r => r.validations.some(v => v.value === "`[swordman]`" && v.currentLine === true));
check(
    'ValidationSection Name="" Index=0 CurrentLine=True 完整解析',
    !!swordmanRule && swordmanRule.indexes.length === 1 && swordmanRule.indexes[0] === 1 && eqJson(swordmanRule.lst, ["skill/swordman"]) && swordmanRule.description === "鬼剑士技能",
    swordmanRule ? JSON.stringify(swordmanRule.validations) : "未命中"
);
const gunnerRule = equSdu.find(r => r.validations.some(v => v.value === "`[gunner]`" && v.currentLine === false && v.tag === "skill data up"));
check(
    "ValidationSection 带标签名且 CurrentLine 缺省为 False",
    !!gunnerRule && gunnerRule.validations[0].index === 1 && gunnerRule.parentTag === "piece set ability",
    gunnerRule ? JSON.stringify(gunnerRule.validations) : "未命中"
);

// 多列 Index
const cashAvatar = pick("etc/newcashshop.etc", "avatar");
check(
    'etc/newcashshop.etc [avatar] Index="1,7" lst=[equipment]',
    cashAvatar.length === 1 && eqJson(cashAvatar[0].indexes, [1, 7]) && eqJson(cashAvatar[0].lst, ["equipment"]),
    cashAvatar.length ? JSON.stringify(cashAvatar[0].indexes) : "未命中"
);

// SectionRange
const mapSpec = pick("*.dgn", "map specification");
check(
    "*.dgn [map specification] SectionRange StartIndex=2 lst=[map]",
    mapSpec.length === 1 && mapSpec[0].rangeStart === 2 && eqJson(mapSpec[0].indexes, []) && eqJson(mapSpec[0].lst, ["map"]),
    mapSpec.length ? JSON.stringify(mapSpec[0]) : "未命中"
);

// 同标签多条不同列规则
const reqItem = pick("*.dgn", "required item");
check(
    "*.dgn [required item] 两条规则（不限定列 + 列 0）",
    reqItem.length === 2 && reqItem.some(r => eqJson(r.indexes, [])) && reqItem.some(r => eqJson(r.indexes, [0])),
    JSON.stringify(reqItem.map(r => r.indexes))
);

// SectionGroup 列映射 + 验证条件
const qstIntDataGroups = allRules.filter(r => r.file === "*.qst" && r.tag === "int data" && r.group);
const huntMonster = qstIntDataGroups.find(r => r.validations.some(v => v.value === "`[hunt monster]`"));
check(
    "*.qst [int data] SectionGroup 列 0=dungeon / 列 2=monster + 验证 [type]",
    !!huntMonster &&
        huntMonster.group.length === 2 &&
        huntMonster.group[0].index === 0 &&
        eqJson(huntMonster.group[0].lst, ["dungeon"]) &&
        huntMonster.group[1].index === 2 &&
        eqJson(huntMonster.group[1].lst, ["monster"]),
    huntMonster ? JSON.stringify(huntMonster.group) : "未命中"
);
const underClear = allRules.find(r => r.file === "*.qst" && r.tag === "int data" && r.validations.some(v => v.tag === "sub type" && v.value === "0"));
check(
    'ValidationSection 数字值（[sub type] = "0"）',
    !!underClear &&
        underClear.validations.length === 2 &&
        underClear.validations.some(v => v.tag === "sub type" && v.value === "0") &&
        underClear.validations.some(v => v.tag === "type" && v.value === "`[clear map]`"),
    underClear ? JSON.stringify(underClear.validations) : "未命中"
);

// IgnoreItemCode（负值与多值）
const wdmDungeon = allRules.find(r => r.file === "*.wdm" && r.tag === "dungeon" && r.group);
check(
    "*.wdm [dungeon] SectionGroup IgnoreItemCode=-1",
    !!wdmDungeon && wdmDungeon.group.length === 3 && wdmDungeon.group[1].ignoreCodes[0] === -1 && wdmDungeon.group[2].ignoreCodes[0] === -1,
    wdmDungeon ? JSON.stringify(wdmDungeon.group.map(g => g.ignoreCodes)) : "未命中"
);
const compoundHat = allRules.find(r => r.file === "etc/compoundavatar_fighter.etc" && r.tag === "hat avatar");
check(
    "compoundavatar [hat avatar] IgnoreItemCode 多值 9,1,2,3,4,5,6,7,8",
    !!compoundHat && eqJson(compoundHat.ignoreCodes, [9, 1, 2, 3, 4, 5, 6, 7, 8]),
    compoundHat ? JSON.stringify(compoundHat.ignoreCodes) : "未命中"
);

// 空标签名（任意标签）
const itemDict = allRules.filter(r => r.file === "etc/itemdictionary/(r)itemdictionary.etc");
check(
    "(r)itemdictionary.etc 空标签名规则 Index=1 lst=[monster]",
    itemDict.length === 1 && itemDict[0].tag === "" && eqJson(itemDict[0].indexes, [1]) && eqJson(itemDict[0].lst, ["monster"]),
    itemDict.length ? JSON.stringify(itemDict[0]) : "未命中"
);
const lotteryEmpty = allRules.filter(r => r.file === "etc/itemdictionary/(r)lotterylistmakeequip.etc" && r.tag === "");
check(
    "(r)lotterylistmakeequip.etc 空 Section（lst 空 + 当前行验证值 1）",
    lotteryEmpty.length === 1 &&
        eqJson(lotteryEmpty[0].lst, []) &&
        lotteryEmpty[0].validations.length === 1 &&
        lotteryEmpty[0].validations[0].index === 0 &&
        lotteryEmpty[0].validations[0].value === "1" &&
        lotteryEmpty[0].validations[0].currentLine === true,
    lotteryEmpty.length ? JSON.stringify(lotteryEmpty[0].validations) : "未命中"
);

// ============================================================
// 四、匹配 API
// ============================================================

const m1 = codeRef.matchCodeRefRules("etc/newcashshop.etc", "avatar");
check("精确路径 + 标签命中（newcashshop [avatar]）", m1.length === 1 && eqJson(m1[0].indexes, [1, 7]) && m1[0].file === "etc/newcashshop.etc", JSON.stringify(m1.map(r => r.file)));
const m2 = codeRef.matchCodeRefRules("ETC/NewCashShop.ETC", "[AVATAR]");
check("匹配大小写不敏感（文件与标签双向归一）", m2.length === 1 && eqJson(m2[0].indexes, [1, 7]));
const m3 = codeRef.matchCodeRefRules("character/sword/xxx.equ", "skill data up");
check("通配 *.equ 命中多条 [skill data up] 规则", m3.length === 5 && m3.some(r => r.validations.some(v => v.value === "`[swordman]`" && v.currentLine)), String(m3.length));
const m4 = codeRef.matchCodeRefRules("etc/itemdictionary/(r)itemdictionary.etc", "any-unknown-tag");
check("空标签名规则对任意标签命中", m4.length === 1 && eqJson(m4[0].lst, ["monster"]) && eqJson(m4[0].indexes, [1]), String(m4.length));
const m5 = codeRef.matchCodeRefRules("quest/xxx.qst", "skill data up");
check("跨文件类型不命中（*.equ 规则对 .qst）", m5.length === 0, String(m5.length));
const m6 = codeRef.matchCodeRefRules("etc/newcashshop.etc", "avatar2");
check("未收录标签不命中", m6.length === 0, String(m6.length));

// ============================================================
// 五、悬浮渲染
// ============================================================

const r1 = codeRef.renderCodeRefTipHtml("etc/newcashshop.etc", "avatar");
check("渲染含列号 / lst 表 / 说明", r1.includes("列 1、7") && r1.includes("equipment.lst") && r1.includes("时装") && r1.includes("代码引用（etc/newcashshop.etc）"), r1.slice(0, 120));
const r2 = codeRef.renderCodeRefTipHtml("quest/xxx.qst", "int data");
check("渲染含验证条件文案（*.qst [int data]）", r2.includes("当 [type] 值为 `[seeking]`") && r2.includes("stackable.lst | equipment.lst") && r2.includes("物品/装备"), r2.slice(0, 120));
const r2b = codeRef.renderCodeRefTipHtml("item/xxx.stk", "int data");
check("渲染含忽略文案与父标签限定（*.stk [int data]）", r2b.includes("忽略 1,2,3") && r2b.includes("当 [stackable type] 值为 `[recipe]`0"), r2b.slice(0, 200));
const r3 = codeRef.renderCodeRefTipHtml("dungeon/xxx.dgn", "map specification");
check("SectionRange 渲染为「列 2 起」", r3.includes("列 2 起") && r3.includes("map.lst"), r3.slice(0, 120));
// 截断：qst [int data] 26 条规则展开 32 行，仅展示前 10 行并以计数行提示剩余
const rBig = codeRef.renderCodeRefTipHtml("quest/xxx.qst", "int data");
check(
    "截断：refs 区块包裹 + 计数行提示剩余规则",
    rBig.startsWith('<div class="pvf-tip-refs">') && rBig.endsWith("</div>") && rBig.includes("pvf-tip-more") && /⋯ 另有 \d+ 条引用规则/.test(rBig),
    rBig.slice(0, 100)
);
const paramLineCount = (rBig.match(/class="pvf-tip-param"/g) || []).length;
check(`截断：规则行数 = 10（实际 ${paramLineCount}）`, paramLineCount === 10);
const moreCount = (rBig.match(/pvf-tip-more/g) || []).length;
check("截断：计数行恰好 1 条", moreCount === 1);
const condCount = (rBig.match(/pvf-tip-cond/g) || []).length;
check(`截断：条件行使用 cond 样式且出现（实际 ${condCount} 行）`, condCount > 0);
const r4 = codeRef.renderCodeRefTipHtml("etc/unknown.xyz", "nonexistent-tag");
check("无命中返回空串", r4 === "");
const r5 = codeRef.renderCodeRefTipHtml("etc/globaltutorialinfo/at_fighter.etc", "dungeonindex");
check("展示层对完全相同的规则行去重（at_fighter.etc [dungeonindex] 重复 2 条渲染 1 行）", r5 !== "" && (r5.match(/副本/g) || []).length === 1, r5.slice(0, 120));
const r6 = codeRef.renderCodeRefTipHtml("etc/itemdictionary/(r)itemdictionary.etc", "whatever");
check("任意标签规则渲染含文件模式标题与怪物 lst", r6.includes("monster.lst") && r6.includes("怪物"), r6.slice(0, 120));

// ============================================================
// 六、汇总
// ============================================================

console.log("\n" + (failCount === 0 ? "全部断言通过" : `存在 ${failCount} 个 FAIL`));
process.exit(failCount === 0 ? 0 : 1);
