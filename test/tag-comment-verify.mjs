// PVF 标签社区注释层验证脚本（见 docs/pvf-tag-community-comments.md §4）
//
// 模式：纯数据层验证，不依赖 PVF 归档。
//   node test/tag-comment-verify.mjs
//
// 验证内容：
//   ① 数据完整性：pvfTagComments.js 为 PVF_TAGS 条目格式（category/description/
//      remark/fileTypes），341 组、fileTypes 总数 344
//   ② 数据正确性：金样本条目断言（含多注释 remark 与重复注释去重）
//   ③ 统一解析：精确优先（子串模糊不再抢先拦截）、词边界模糊、双未命中回落、
//      连续空白归一（docs/pvf-tag-community-comments.md §2.1 缺陷修复回归）
//   ④ 合并与渲染：PVF_TAG_ENTRIES 合并表、人工定义优先且并存 community、
//      renderTagTooltip 渲染路径
//
// 依赖：Node 内置模块 + src/utils/pvfTagComments.js + src/utils/pvfTags.js

import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PVF_TAG_COMMENTS } = await import(new URL("../src/utils/pvfTagComments.js", import.meta.url).href);
const pvfTags = await import(new URL("../src/utils/pvfTags.js", import.meta.url).href);

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

// ============================================================
// 一、数据完整性（固化管理值见 docs/pvf-tag-community-comments.md §6）
// ============================================================

const groups = Object.entries(PVF_TAG_COMMENTS);
const fileTypeTotal = groups.reduce((n, [, v]) => n + v.fileTypes.length, 0);
const remarkGroups = groups.filter(([, v]) => v.remark).length;
check(`标签分组数 = 341（实际 ${groups.length}）`, groups.length === 341);
check(`fileTypes 总数 = 344（实际 ${fileTypeTotal}）`, fileTypeTotal === 344);
check(`含 remark 组数 = 2（实际 ${remarkGroups}）`, remarkGroups === 2);
check(
    "条目为 PVF_TAGS 兼容格式：category 均为 community 且 description 全非空",
    groups.every(([, v]) => v.category === "community" && typeof v.description === "string" && v.description.trim().length > 0)
);
check(
    "条目无多余字段（仅 category/description/remark?/fileTypes）",
    groups.every(([, v]) => {
        const keys = Object.keys(v);
        return keys.every(k => ["category", "description", "remark", "fileTypes"].includes(k));
    })
);
check(
    "分组键归一（小写 / 无方括号 / 无连续空白）",
    groups.every(([k]) => k === k.toLowerCase() && !k.includes("[") && !k.includes("]") && k === k.trim() && !/\s{2,}/.test(k))
);

// ============================================================
// 二、数据正确性（金样本条目）
// ============================================================

check(
    "金样本：attack box（单注释）",
    JSON.stringify(PVF_TAG_COMMENTS["attack box"]) === JSON.stringify({ category: "community", description: "攻击范围判定框", fileTypes: [1] }),
    JSON.stringify(PVF_TAG_COMMENTS["attack box"])
);
check(
    "金样本：on appear（多注释 -> remark）",
    JSON.stringify(PVF_TAG_COMMENTS["on appear"]) === JSON.stringify({ category: "community", description: "游走", remark: "出现在自身附近时", fileTypes: [11, 11] }),
    JSON.stringify(PVF_TAG_COMMENTS["on appear"])
);
check(
    "金样本：ai pattern（重复注释去重，无 remark）",
    JSON.stringify(PVF_TAG_COMMENTS["ai pattern"]) === JSON.stringify({ category: "community", description: "AI逻辑", fileTypes: [21, 8] }),
    JSON.stringify(PVF_TAG_COMMENTS["ai pattern"])
);
check(
    "金样本：level（多注释 -> remark）",
    JSON.stringify(PVF_TAG_COMMENTS["level"]) === JSON.stringify({ category: "community", description: "等级", remark: "在任务里代表接取任务角色的等级区间", fileTypes: [2, 11] }),
    JSON.stringify(PVF_TAG_COMMENTS["level"])
);

// ============================================================
// 三、统一解析（精确优先 / 词边界模糊 / 回落 / 空白归一）
// ============================================================

const c1 = pvfTags.getTagInfo("skill levelup");
check(
    "精确优先：[skill levelup] 走社区注释（不再被 level 子串拦截为 [level]）",
    c1.name === "skill levelup" && c1.category === "community" && c1.description === "装备时提升的技能和等级限制",
    JSON.stringify({ name: c1.name, description: c1.description })
);
const c2 = pvfTags.getTagInfo("quick item");
check("精确优先：[quick item] 走社区注释（不再被 item 子串拦截）", c2.name === "quick item" && c2.category === "community" && c2.description === "快捷栏道具");
const c3 = pvfTags.getTagInfo("mp_regenrate");
check("精确优先：[mp_regenrate] 走社区注释（不再被 mp 子串拦截）", c3.name === "mp_regenrate" && c3.category === "community" && c3.description === "每分钟恢复魔法值");
const c4 = pvfTags.getTagInfo("basis level");
check("精确优先：[basis level] 走社区注释", c4.name === "basis level" && c4.category === "community" && c4.description === "副本内怪物的平均等级");
const c4b = pvfTags.getTagInfo("magical");
check("精确优先：[magical] 不再被 [magical attack] 反向命中", c4b.name === "magical" && c4b.category === "community", JSON.stringify({ name: c4b.name }));
const c5 = pvfTags.getTagInfo("[skill  levelup]");
check("连续空白折叠：[skill  levelup] 归一后精确命中社区注释", c5.name === "skill levelup" && c5.category === "community", JSON.stringify({ name: c5.name }));
const c6 = pvfTags.getTagInfo("item list");
check("词边界模糊：[item list] 命中 [item] 定义", c6.name === "item" && c6.description === "道具引用", JSON.stringify({ name: c6.name, description: c6.description }));
const c7 = pvfTags.getTagInfo("level up");
check("词边界模糊：[level up] 命中 [level] 定义", c7.name === "level" && c7.description === "等级数值");
const c7b = pvfTags.getTagInfo("skill data up");
check(
    "词边界模糊：未收录的 [skill data up] 按词边界命中 [skill] 定义（不再含无边界子串误命中）",
    c7b.name === "skill" && c7b.description === "技能标识",
    JSON.stringify({ name: c7b.name, description: c7b.description })
);
const c7c = pvfTags.getTagInfo("item info");
check("词边界模糊：未收录的 [item info] 命中 [item] 定义", c7c.name === "item" && c7c.description === "道具引用");
const c8 = pvfTags.getTagInfo("totally-unknown-tag-xyz");
check("双未命中：维持默认回落", c8.name === "totally-unknown-tag-xyz" && c8.category === "other" && !c8.community, JSON.stringify({ description: c8.description }));
const c8b = pvfTags.getTagInfo("giftif");
check("非独立词不命中：[giftif] 与 [if] 无词边界关系，维持回落", c8b.name === "giftif" && c8b.category === "other");

// ============================================================
// 四、合并表与渲染
// ============================================================

const entryCount = Object.keys(pvfTags.PVF_TAG_ENTRIES).length;
check(`合并表 PVF_TAG_ENTRIES 导出且规模 = 360（341 社区 + 27 人工 − 8 重名覆盖）（实际 ${entryCount}）`, entryCount === 360);
const m1 = pvfTags.getTagInfo("item");
check(
    "人工定义优先并存社区注释：[item] 保留人工描述 + community 注释数组",
    m1.description === "道具引用" && Array.isArray(m1.community) && m1.community[0] === "该标签位于怪物面板时",
    JSON.stringify({ description: m1.description, community: m1.community })
);
check("人工原表 PVF_TAGS 不被合并污染（item 无 community 字段）", !pvfTags.PVF_TAGS.item.community);
const m2 = pvfTags.getTagInfo("avatar");
check(
    "人工定义优先并存：[avatar] community 含「时装店出售的商品列表」",
    m2.description === "角色头像 / 立绘资源引用" && m2.community && m2.community[0] === "时装店出售的商品列表",
    JSON.stringify(m2.community)
);
function tipHas(html, parts) {
    return parts.every(p => html.includes(p));
}
const tip1 = pvfTags.renderTagTooltip("attack box");
check("渲染：纯社区条目含标签名与注释描述（分类为社区注释）", tipHas(tip1, ["[attack box]", "社区注释", "攻击范围判定框"]), tip1.slice(0, 120));
const tip2 = pvfTags.renderTagTooltip("item");
check("渲染：并存条目含人工描述与「社区注释」区块", tipHas(tip2, ["道具引用", "社区注释", "该标签位于怪物面板时"]), tip2.slice(0, 160));
const tip3 = pvfTags.renderTagTooltip("totally-unknown-tag-xyz");
check("渲染：双未命中不渲染社区注释区块", !tip3.includes("社区注释"));
// 着色区分：分类徽标按类别着色，社区说明与项目说明用不同色类
check("着色：纯社区条目分类徽标为 cat-community、说明文本为社区绿", tip1.includes("cat-community") && tip1.includes("pvf-tip-desc-c"), tip1.slice(0, 160));
check(
    "着色：人工条目 [item] 分类徽标为 cat-item、说明保持项目说明样式（无社区绿 desc 类）",
    tip2.includes("cat-item") && !tip2.includes("pvf-tip-desc-c") && tip2.includes("pvf-tip-cmt"),
    tip2.slice(0, 160)
);
const tipSkill = pvfTags.renderTagTooltip("skill");
check("着色：人工条目 [skill] 分类徽标为 cat-skill", tipSkill.includes("cat-skill") && !tipSkill.includes("pvf-tip-desc-c"), tipSkill.slice(0, 120));

// ============================================================
// 五、汇总
// ============================================================

console.log("\n" + (failCount === 0 ? "全部断言通过" : `存在 ${failCount} 个 FAIL`));
process.exit(failCount === 0 ? 0 : 1);
