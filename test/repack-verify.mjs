import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================
// 重打包归档（REPACK/60CN）验证脚本
// 文档：docs/pvf-repack-format.md（§6 断言清单）
// 运行：node test/repack-verify.mjs [pvf路径]
//   默认目标 PVF/60CN/Script.pvf（基线根目录为运行时工作目录）；
//   实际位置不符时以命令行参数传入。
// 分部：Part A 格式级断言（脚本内独立解密，不依赖解析层实现）；
//       Part B 解析层断言（加载 src/utils/pvfToolRepack.js）；
//       Part C 源码静态守卫（PvfEditor.vue 加载分派与保存拦截）。
// ============================================================

let passCount = 0;
let failCount = 0;
function check(name, cond, detail) {
    if (cond) {
        passCount++;
        console.log(`  PASS ${name}`);
    } else {
        failCount++;
        console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    }
}

const PVF_PATH = process.argv[2] || "PVF/60CN/Script.pvf";

// ---------------- Part A：格式级断言（docs/pvf-repack-format.md §2） ----------------
// 解密算法：按小端 dword 分组，明文 = 循环右移 6 位（密文 XOR 密钥）；必须使用无符号逻辑移位。
const ror6 = v => ((v >>> 6) | (v << 26)) >>> 0;
// 归档魔数（15 字节明文，字面值以 src/utils/pvfCodec.js REPACK_MAGIC 为准）
const MAGIC_BYTES = Buffer.from([0x44, 0x4e, 0x46, 0x5f, 0x53, 0x43, 0x52, 0x49, 0x50, 0x54, 0x5f, 0x50, 0x41, 0x43, 0x4b]);

let buf;
try {
    buf = new Uint8Array(readFileSync(resolve(PVF_PATH)));
} catch {
    console.log(`重打包归档验证: 基线文件 ${PVF_PATH} 无法读取，按 AGENTS.md 流程确认实际位置后以命令行参数传入`);
    process.exit(1);
}
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const treeLength = dv.getInt32(15, true);
const treeChecksum = dv.getUint32(19, true) >>> 0;
const fileCount = dv.getUint32(23, true) >>> 0;
const bodyOffset = 27 + treeLength;

console.log("\nPart A 格式级断言（脚本内独立解密）:");
check("A1 归档魔数", buf.length > 27 && Buffer.from(buf.slice(0, 15)).equals(MAGIC_BYTES));

const headerOk = treeLength > 0 && treeLength % 4 === 0 && bodyOffset <= buf.length && fileCount > 0;
check("A2 头部参数合法性", headerOk, `treeLength=${treeLength} fileCount=${fileCount}`);
check("A3 头部字段值（基线）", treeLength === 3619688 && fileCount === 48351 && bodyOffset === 3619715, `treeLength=${treeLength} fileCount=${fileCount} bodyOffset=${bodyOffset}`);

// 树区解密
const dwordCount = treeLength / 4;
const u32 = new Uint32Array(dwordCount);
for (let i = 0; i < dwordCount; i++) u32[i] = dv.getUint32(27 + i * 4, true);
for (let i = 0; i < dwordCount; i++) u32[i] = ror6((u32[i] ^ treeChecksum) >>> 0);
const tree = Buffer.alloc(treeLength);
for (let i = 0; i < dwordCount; i++) tree.writeUInt32LE(u32[i] >>> 0, i * 4);

// 条目流解析
const EXPECT_FIRST5 = [
    "passiveobject/monster/ghoul/animation/skullbombsub.ani",
    "equipment/character/mage/avatar/hair/hair_a/rest.ani",
    "equipment/character/gunner/avatar/pants/pants_d/overturn.ani",
    "passiveobject/mapobject/trap/animation/entanglevinereleasebranch.ani",
    "monster/drake/particle/chain1.ptl"
];
const entries = [];
let cursor = 0;
let treeStreamOk = true;
let treeErr = "";
for (let i = 0; i < fileCount; i++) {
    if (cursor + 20 > treeLength) {
        treeStreamOk = false;
        treeErr = `条目 ${i} 头部越界`;
        break;
    }
    const fileNumber = tree.readUInt32LE(cursor);
    const dataOffset = tree.readUInt32LE(cursor + 4);
    const dataSize = tree.readInt32LE(cursor + 8);
    const checksum = tree.readUInt32LE(cursor + 12);
    const pathLen = tree.readInt32LE(cursor + 16);
    cursor += 20;
    if (dataSize < 0 || pathLen <= 0 || cursor + pathLen > treeLength) {
        treeStreamOk = false;
        treeErr = `条目 ${i} 字段异常`;
        break;
    }
    const pathBytes = tree.slice(cursor, cursor + pathLen);
    cursor += pathLen;
    entries.push({ fileNumber, dataOffset, dataSize, checksum, pathBytes });
}
check("A4 树区条目流完整", treeStreamOk, treeErr);
check("A5 条目流终值 = 树区长度 − 3（尾部对齐填充）", cursor === treeLength - 3, `终值=${cursor} 树区长度=${treeLength}`);

let asciiOk = true;
const first5 = [];
let maxEnd = 0;
for (const e of entries) {
    for (const b of e.pathBytes)
        if (b < 0x20 || b > 0x7e) {
            asciiOk = false;
            break;
        }
    if (first5.length < 5) first5.push(e.pathBytes.toString("latin1"));
    maxEnd = Math.max(maxEnd, e.dataOffset + e.dataSize);
}
check("A6 前 5 条路径精确匹配", first5.join("\n") === EXPECT_FIRST5.join("\n"), first5.join(" | "));
check("A7 路径全 ASCII 可打印", asciiOk);
check("A8 数据区覆盖 = 文件总长 − 数据区起点", maxEnd === buf.length - bodyOffset, `覆盖=${maxEnd} 数据区=${buf.length - bodyOffset}`);

// 内容解密断言（docs/pvf-repack-format.md §6 #4）
let lstEntry = null;
for (const e of entries) {
    if (e.pathBytes.toString("latin1") === "aicharacter/aicharacter.lst") {
        lstEntry = e;
        break;
    }
}
let lstText = "";
if (lstEntry) {
    const padded = (lstEntry.dataSize + 3) & ~3;
    const d = Buffer.from(buf.slice(bodyOffset + lstEntry.dataOffset, bodyOffset + lstEntry.dataOffset + padded));
    for (let j = 0; j < d.length; j += 4) d.writeUInt32LE(ror6((d.readUInt32LE(j) ^ lstEntry.checksum) >>> 0), j);
    const plain = Buffer.from(d.slice(0, lstEntry.dataSize));
    // GBK 解码：优先 Node 内置 TextDecoder("gbk")，不可用时按 latin1 降级比对字节
    try {
        lstText = new TextDecoder("gbk").decode(plain);
    } catch {
        lstText = plain.toString("latin1");
    }
}
check("A9 lst 内容长度（基线）", lstEntry && lstEntry.dataSize === 126, `实际=${lstEntry ? lstEntry.dataSize : "未找到"}`);
check("A10 lst GBK 首行", lstText.startsWith("// AI角色总结文档 //"), JSON.stringify(lstText.slice(0, 24)));
check("A11 lst 引用条目", lstText.includes("`cuwaki/cuwaki.aic`"));

// ---------------- Part B：解析层断言（加载 src/utils/pvfToolRepack.js） ----------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
let RepackPvfArchive = null;
let PvfFormat = null;
try {
    const codec = await import(pathToFileURL(join(scriptDir, "../src/utils/pvfCodec.js")));
    const mod = await import(pathToFileURL(join(scriptDir, "../src/utils/pvfToolRepack.js")));
    RepackPvfArchive = mod.RepackPvfArchive;
    PvfFormat = codec.PvfFormat;
} catch (err) {
    console.log("\nPart B 解析层断言: 跳过（src/utils/pvfToolRepack.js 尚未就绪）— " + (err && err.message));
}

if (RepackPvfArchive) {
    console.log("\nPart B 解析层断言:");
    const arch = new RepackPvfArchive(buf);
    await arch.parse();
    check("B1 魔数探测 sniff", RepackPvfArchive.sniff(buf) === true);
    check("B2 文件数与头部", arch.header.fileCount === 48351 && arch.files.length === 48351);
    check("B3 格式标签", arch.headerFormat === PvfFormat.REPACK && arch.headerFormatLabel === "60CN");
    check(
        "B4 files 字段结构",
        (() => {
            const f = arch.files[0];
            return (
                f &&
                f.name === EXPECT_FIRST5[0] &&
                f.fullpath === EXPECT_FIRST5[0] &&
                f.isDir === false &&
                f.dataType === 0 &&
                f.index === 0 &&
                f.dataSize === entries[0].dataSize &&
                f.dataOffset === entries[0].dataOffset
            );
        })()
    );
    let sumLen = 0;
    for (const e of entries) sumLen += e.dataSize;
    check("B5 只读不变式", arch.hasChanges === false && arch.modifiedCount === 0 && arch.deletedCount === 0 && arch.renamedCount === 0 && arch.groups.length === 0 && arch.bodySize === sumLen);
    check("B6 strEncoding 为 GBK", arch.strEncoding === "gbk");

    const lstFile = arch.files.find(f => f.name === "aicharacter/aicharacter.lst");
    const data = await arch.getFileData(lstFile);
    check("B7 getFileData 明文", data && data.length === 126);
    const text = arch.decodeContent(lstFile, data);
    check("B8 decodeContent GBK 文本", text.startsWith("// AI角色总结文档 //"));
    check("B9 isLstFile 判定", arch.isLstFile(lstFile) === true && arch.isLstFile(arch.files[0]) === false);
    const lstNamed = await arch.decodeLstWithNames(lstFile);
    check("B10 decodeLstWithNames 行结构", typeof lstNamed === "string" && lstNamed.includes("`cuwaki/cuwaki.aic`"));

    const exp = await arch.exportFile(lstFile);
    // 契约对齐 TW 层：size 为文本长度（字符数），blob 为 UTF-8 字节流（中文内容两者不等值）
    const expTextOk = exp && exp.blob && exp.size === text.length && exp.blob.size > 0;
    let expContentOk = false;
    if (expTextOk) {
        try {
            const blobBytes = Buffer.from(await exp.blob.arrayBuffer());
            expContentOk = new TextDecoder("utf-8").decode(blobBytes) === text;
        } catch {
            expContentOk = false;
        }
    }
    check("B11 导出契约", exp && typeof exp.filename === "string" && exp.filename === "aicharacter.lst" && expTextOk && expContentOk);

    // 修改类查询恒为空态 + 修改类操作显式拒绝（docs/pvf-repack-format.md §4）
    const f0 = arch.files[0];
    const emptyQuery = arch.isFileModified(f0.index) === false && arch.isFileDeleted(f0.index) === false && arch.isFileRenamed(f0.index) === false;
    const strMap = await arch.getStrNameMap();
    const rejectOk = (async () => {
        // async 操作（renameFile/renameFolder/saveAs）须 await 才能捕获 Promise 拒绝
        const ops = [
            () => arch.setFileContent(f0.index, "x"),
            () => arch.setFileRawData(f0.index, new Uint8Array(1)),
            () => arch.deleteFile(f0.index),
            () => arch.renameFile(f0.index, "x"),
            () => arch.renameFolder("a/", "b/"),
            () => arch.saveAs()
        ];
        for (const op of ops) {
            try {
                await op();
                return false;
            } catch (e) {
                if (!/只读/.test(e && e.message)) return false;
            }
        }
        return true;
    })();
    const noOpOk = (() => {
        try {
            arch.revertFile(f0.index);
            arch.revertAll();
            arch.undeleteFile(f0.index);
            arch.setEncoding("big5");
            return true;
        } catch {
            return false;
        }
    })();
    check(
        "B12 修改类查询空态与引用修复禁用",
        emptyQuery &&
            strMap instanceof Map &&
            strMap.size === 0 &&
            Array.isArray(arch.buildPathMappings()) &&
            (await arch.findReferencesMulti()).length === 0 &&
            (await arch.fixReferences()) === 0 &&
            arch.decodeContentForEdit(lstFile, data) === text
    );
    check("B13 修改类操作显式拒绝", await rejectOk);
    check("B14 撤销与编码切换为安全空操作", noOpOk);

    // 物品编码链路（ItemCodeView 消费，docs/pvf-repack-format.md §4）：
    // lst 条目行内注释规整为展示名 + [name] 标签提取 + meta（品质/等级/类型）
    const stLst = arch.files.find(f => f.name === "stackable/stackable.lst");
    const stItems = await arch.listLstItems(stLst);
    const stNamed = stItems.filter(it => it.name).length;
    const stFirst3Ok = stItems.length === 1703 && stItems[0].name === "复活币" && stItems[1].name === "决斗胜点" && stItems[2].name === "遗忘河之水";
    check("B15 stackable.lst 编码与名称", stFirst3Ok && stNamed >= 1700, `items=${stItems.length} 命名=${stNamed}`);
    const stMetas = await arch.listLstItemMeta(stLst, stItems);
    const nrcpIdx = stItems.findIndex(it => it.ref === "recipe/nrcp_tra_rudechantre.stk");
    const nrcpMeta = nrcpIdx >= 0 ? stMetas[nrcpIdx] : null;
    check("B16 listLstItemMeta 品质/等级/类型", nrcpMeta && nrcpMeta.rarity === 2 && nrcpMeta.minLevel === 44 && nrcpMeta.stackableType === "`[recipe]` 1", JSON.stringify(nrcpMeta));

    // .str 编码探测（docs/pvf-repack-format.md §3）：
    // 40 个 .str 实测 33 个 EUC-KR 韩文 / 4 个 GBK 简中 / 3 个混合，GBK 一律解码会把韩文误解为汉字
    const korStr = arch.files.find(f => f.name === "equipment/equipment.kor.str");
    const korText = arch.decodeContent(korStr, await arch.getFileData(korStr));
    const korOk = /[\uac00-\ud7a3]/.test(korText) && korText.includes("upperset_name_cap>") && !korText.includes("茄惫");
    check("B17 .kor.str EUC-KR 韩文解码", korOk, JSON.stringify(korText.slice(0, 40)));
    const jpnStr = arch.files.find(f => f.name === "npc/npc.jpn.str");
    const jpnText = arch.decodeContent(jpnStr, await arch.getFileData(jpnStr));
    check("B18 .jpn.str GBK 简中解码", jpnText.includes("韩文脚本字符串数据文件"));
    const chnStr = arch.files.find(f => f.name === "map/map.chn.str");
    const chnText = arch.decodeContent(chnStr, await arch.getFileData(chnStr));
    check("B19 .chn.str 探测（韩文模板按 EUC-KR）", /[\uac00-\ud7a3]/.test(chnText), JSON.stringify(chnText.slice(0, 40)));
    // 行级 SJIS 日文行修正 + GBK 中文行不回归（GBK 中文字节与谚文区重叠，
    // 行级 EUC-KR 判定会把中文行误判为谚文行——回归教训，见 §3 行级边界）
    const mjStr = arch.files.find(f => f.name === "monster/monster.jpn.str");
    const mjText = arch.decodeContent(mjStr, await arch.getFileData(mjStr));
    const mjHeadOk = mjText.includes("韩文脚本字符串数据文件");
    const mjIdx = mjText.indexOf("name_470");
    const mjTailOk = mjIdx >= 0 && mjText.slice(mjIdx, mjIdx + 24).startsWith("name_470>デンドロイド");
    check("B20 .jpn.str 顶部中文保持 + 底部日文还原", mjHeadOk && mjTailOk, JSON.stringify(mjText.slice(0, 24)) + " / " + JSON.stringify(mjText.slice(mjIdx, mjIdx + 24)));
    const nkStr = arch.files.find(f => f.name === "npc/npc.kor.str");
    const nkText = arch.decodeContent(nkStr, await arch.getFileData(nkStr));
    check("B21 双失败 .kor.str 后验 EUC-KR", nkText.includes("한국스크립트용") && !nkText.includes("茄惫"));
}

// ---------------- Part C：源码静态守卫（PvfEditor.vue 接线次序） ----------------
{
    console.log("\nPart C 源码静态守卫:");
    let editorSrc = "";
    try {
        editorSrc = readFileSync(join(scriptDir, "../src/components/PvfEditor.vue"), "utf8");
    } catch {
        console.log("  FAIL 读取 PvfEditor.vue 源码失败");
        failCount++;
    }
    if (editorSrc) {
        const importIdx = editorSrc.indexOf("RepackPvfArchive");
        check("C1 编辑器导入解析层", importIdx >= 0);
        const sniffIdx = editorSrc.indexOf(".sniff(");
        const jpIdx = editorSrc.indexOf("new PvfArchive(");
        check("C2 魔数探测先于 JP 探测链", sniffIdx > 0 && jpIdx > 0 && sniffIdx < jpIdx);
        const saveGuard = editorSrc.includes("PvfFormat.REPACK");
        check("C3 保存链含 REPACK 拦截", saveGuard);
        const roIdx = editorSrc.indexOf("isReadonlyArchive()");
        const menuGuard = editorSrc.includes("!isReadonlyArchive");
        check("C4 右键菜单修改类入口按只读归档隐藏", roIdx > 0 && menuGuard);
        // 只读内容预览：模板分支（PVF 高亮渲染 + 标签/代码引用悬浮）与文件树图标蓝色 script
        const previewGuard =
            editorSrc.includes('class="pvf-ro-preview"') &&
            editorSrc.includes("onReadonlyMouseMove") &&
            /isReadonlyArchive && readonlyPreviewHtml/.test(editorSrc) &&
            editorSrc.includes('language: "pvf"');
        check("C5 只读归档文本预览与悬浮接线", previewGuard);
        const icoGuard = /item\.node\.file\.dataType === 1 \|\| isReadonlyArchive/.test(editorSrc);
        check("C6 文件树文本图标按只读归档着色（script 蓝）", icoGuard);
        const codeRefGuard = editorSrc.includes("renderCodeRefTipHtml(this.currentFile && this.currentFile.name, mm[1])");
        check("C7 只读预览悬浮含代码引用区块", codeRefGuard);
        const strRenderGuard = editorSrc.includes("this.isStrFile || this.isStringTable") && editorSrc.includes("_renderKeyValueText(formatted)");
        check("C8 .str 预览走 key>text 行格式渲染", strRenderGuard);
    }
}

console.log(`\n合计: ${passCount} PASS, ${failCount} FAIL`);
process.exit(failCount ? 1 : 0);
