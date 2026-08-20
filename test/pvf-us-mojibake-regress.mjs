import { readFileSync } from "node:fs";
import { PvfArchive } from "../src/utils/pvfTool.js";
import { decodeUtf16LE, decodeKoreanMojibakeUtf16 } from "../src/utils/encoding.js";

const buf = readFileSync(process.argv[2] || "C:/Users/Administrator/Desktop/PVF/90US/Script.pvf");
const archive = new PvfArchive(buf);
await archive.parse();
console.log("format:", archive.headerFormatLabel, "| strEncoding:", archive.strEncoding);

// 90US 的 npcname/monstername 也命中白名单 loose=true；确认输出与修复前一致（韩文/英文，无破坏）
for (const f of ["monstername.lst", "itemname.lst", "npcname.lst"]) {
    const node = archive.files.find(x => x.name === f);
    const text = await archive.decodeLstWithNames(node);
    const lines = text.split("\n").filter(l => l.trim());
    console.log(`\n==== 90US ${f} (${lines.length} 行, loose=${archive._isLooseNameLst(node)}) 前 8 行 ====`);
    for (const ln of lines.slice(0, 8)) console.log("  " + ln);
    // 校验：不允许出现「恢复失败的中文乱码或 box-drawing」残留
    const bad = lines.filter(l => /[\u2500-\u257F]/.test(l));
    if (bad.length) console.log(`  !! 残留 box-drawing: ${bad.length} 行，例: ${bad[0]}`);
}

// sTrW 回归：与 90US 修复基线一致（95168 韩文变更）
const strW = archive.strWBuf;
let total = 0, changed = 0;
let wp = 0;
while (wp + 1 < strW.length) {
    let end = wp;
    while (end + 1 < strW.length && !(strW[end] === 0 && strW[end + 1] === 0)) end += 2;
    if (end > wp) {
        total++;
        const raw = decodeUtf16LE(strW.subarray(wp, end));
        const fixed = decodeKoreanMojibakeUtf16(strW.subarray(wp, end));
        if (fixed !== raw) changed++;
    }
    wp = end + 2;
}
console.log(`\nsTrW: total=${total} changed=${changed}（基线 95168）`);