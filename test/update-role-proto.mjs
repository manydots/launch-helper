/**
 * CMD_UPDATE_ROLE 对接验证脚本。
 *
 * 运行方式：node test/update-role-proto.mjs
 * 说明：受 vite 特有导入（?raw）限制无法直接 import src/utils/gateway.js，
 * 采用「gateway.proto 动态编解码验证 + gateway.js 源静态断言」双轨覆盖，
 * 详细规则见 docs/gateway-update-role.md §5。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

// protobufjs 为 CJS 包，ESM 下经 createRequire 加载（与 package.json main 入口一致）
const require = createRequire(import.meta.url);
const protobuf = require("protobufjs");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

// ---------- A. 运行时副本 .proto 解析 ----------
const protoText = readFileSync(path.join(rootDir, "src/utils/gateway.proto"), "utf8");
const root = new protobuf.Root();
protobuf.parse(protoText, root, { keepCase: true });

const enumObj = root.lookupEnumOrEnum ? null : null; // 防呆占位（下方用 tryType 统一处理）
const Req = root.lookupType("gateway.UpdateRoleRequest");
const Resp = root.lookupType("gateway.UpdateRoleResponse");

check("A1 运行时副本可解析 UpdateRoleRequest/UpdateRoleResponse", !!Req && !!Resp);

const cmdEnums = root.lookupEnum("gateway.Command");
check("A2 枚举含 CMD_UPDATE_ROLE=10", cmdEnums.values["CMD_UPDATE_ROLE"] === 10);

const optionalFields = ["name", "level", "grow_first", "grow_second"];
for (const fname of optionalFields) {
    const f = Req.fields[fname];
    check(
        `A3.${fname} 为 proto3 显式 presence`,
        !!f && f.options && f.options.proto3_optional === true,
        `options=${JSON.stringify(f && f.options)}`
    );
}
const plainFields = ["m_id", "character_id"];
for (const fname of plainFields) {
    const f = Req.fields[fname];
    check(`A4.${fname} 无 optional 标记`, !!f && !(f.options && f.options.proto3_optional));
}
check(
    "A5 UpdateRoleResponse 字段齐备",
    ["account_id", "character_id", "character_name", "name_updated", "level_updated", "grow_type_updated", "skills_reset", "level", "exp", "grow_type"].every(k => Resp.fields[k]),
    `actual=${Object.keys(Resp.fields).sort().join("|")}`
);

// ---------- B. 线缆编解码验证 ----------
function roundtrip(payload) {
    const msg = Req.create(payload);
    const bytes = Req.encode(msg).finish();
    const decoded = Req.decode(bytes);
    return { bytes, obj: Req.toObject(decoded, {}) };
}

{
    // B1 空业务字段：仅定位字段上线，业务字段不得出现（网关侧将拒绝 1019，前端先行拦截）
    const r = roundtrip({ m_id: "acct", character_id: 7 });
    const keys = Object.keys(r.obj).sort().join("|");
    check("B1 全缺省仅编码 m_id/character_id", keys === "character_id|m_id", keys);
}
{
    // B2 仅启用改名：byte 流不含 level/grow 字段 tag（field4=32/field5=40/field6=48）
    const r = roundtrip({ m_id: "acct", character_id: 7, name: "新名" });
    const keys = Object.keys(r.obj).sort().join("|");
    check("B2 仅置位 name 上线且其余业务字段缺席", keys === "character_id|m_id|name", keys);
    check("B2.b name 解码还原", r.obj.name === "新名", String(r.obj.name));
    // 级别：解码自 bytes 复查 wire tag 缺失
    let hasGrowTags = false;
    for (const b of r.bytes) {
        if (b === 32 || b === 40 || b === 48) hasGrowTags = true;
    }
    // 字符串内容可能包含上述字节，改为基于 decoded keys 判定即可（B2 已覆盖），此处不误报
    void hasGrowTags;
}
{
    // B3 零值显式置位：level=0 必须上线（presence 起效），由网关范围校验拒绝而非视为未提供
    const r = roundtrip({ m_id: "acct", character_id: 7, level: 0 });
    check("B3 level=0 显式置位仍编码字段", Object.keys(r.obj).includes("level") && r.obj.level === 0, JSON.stringify(r.obj));
    const expectTailTag = r.bytes[r.bytes.length - 2] === 32 && r.bytes[r.bytes.length - 1] === 0;
    check("B3.b 尾部出现 field4 零值对 (32,0)", expectTailTag, Array.from(r.bytes.slice(-4)).join(","));
}
{
    // B4 转职/觉醒成对置位：field5=40/field6=48 零值以上时 value 直接内联
    const r = roundtrip({ m_id: "acct", character_id: 7, grow_first: 4, grow_second: 2 });
    check("B4 成对置位解码一致", r.obj.grow_first === 4 && r.obj.grow_second === 2, JSON.stringify(r.obj));
    check("B4.b 未启用组不缺席校验(name/level)", !("name" in r.obj) && !("level" in r.obj), JSON.stringify(Object.keys(r.obj)));
}
{
    // B5 三组全部置位的组合形态（对应 UI「全开」提交）
    const payload = { m_id: "acct", character_id: 7, name: "完全体", level: 86, grow_first: 4, grow_second: 2 };
    const r = roundtrip(payload);
    const ok =
        r.obj.name === "完全体" &&
        r.obj.level === 86 &&
        r.obj.grow_first === 4 &&
        r.obj.grow_second === 2 &&
        r.obj.character_id === 7 &&
        r.obj.m_id === "acct";
    check("B5 组合置位往返还原", ok, JSON.stringify(r.obj));
}

// ---------- C. gateway.js 登记静态断言 ----------
const gwSource = readFileSync(path.join(rootDir, "src/utils/gateway.js"), "utf8");

const tables = [
    ["C1 CMD 表", "UPDATE_ROLE: 10"],
    ["C2 CMD_NAMES", "[CMD.UPDATE_ROLE]: \"UPDATE_ROLE\""],
    ["C3 RESPONSE_TYPES 登记", `[CMD.UPDATE_ROLE]: UpdateRoleResponse`],
    ["C4 REQUEST_TYPES 登记", `[CMD.UPDATE_ROLE]: UpdateRoleRequest`],
];
for (const [name, needle] of tables) {
    check(name, gwSource.includes(needle), `missing: ${needle}`);
}
check(
    "C5 类型绑定 lookupType",
    gwSource.includes('root.lookupType("gateway.UpdateRoleRequest")') &&
        gwSource.includes('root.lookupType("gateway.UpdateRoleResponse")')
);
check(
    "C6 client.updateRole 方法与 api.updateRole 导出",
    /\bupdateRole\s*\(/.test(gwSource) && /updateRole:\s*\(/.test(gwSource),
    "需同时提供 GatewayClient#updateRole 与 api.updateRole"
);
check("C7 无 CLEAR_MAILBOX 之后残留旧枚举上限写法", cmdEnums.values["CMD_CLEAR_MAILBOX"] === 9);

console.log(`\n${failed === 0 ? "ALL PASS" : "HAS FAILURES"} — pass=${passed} fail=${failed}`);
process.exit(failed === 0 ? 0 : 1);
