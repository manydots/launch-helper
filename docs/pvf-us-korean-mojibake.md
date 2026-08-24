# PVF 韩文乱码修复方案（US / protected_nkpi）

## 1. 问题现象

`PVF/90US/Script.pvf`（格式识别为 **CN / protected_nkpi**，sTrA 全局编码自动探测为 **gbk**）中，`itemname.lst`、`monstername.lst` 等 .lst 文件的物品名 / 怪物名出现韩文乱码：

```
`(▒╕)1 ~ 10╖╣║º ░í┴╫ ╣µ╛ε▒╕ ╖╣░í╜├` 7012
`(▒╕)1848 ╡σ╢≤▒║` 31035
```

要求：**不切换整个文件编码**的前提下，让上述韩文正常显示。

## 2. 根因分析（已用实际文件字节验证）

对 90US `Script.pvf` 全表扫描与逐字节分析，结论：

- 韩文乱码**全部位于 sTrW（UTF-16 字符串表）**，共 **95192 条**含 box-drawing 字符的条目；sTrA（单字节表，128 万条）完全干净，无需改动。
- 存储链路（双重转码）：
  ```
  韩文 EUC-KR/CP949 字节 → 按 CP437 解码成 box-drawing 文本 → 按 UTF-16LE 写入 sTrW
  ```
- 例：sTrW 首条原始字节 `63 25 18 25 24 25 0c 25 93 25 bf 00 34 25 7f 20` = UTF-16LE 的 `╣┘┤┌▓¿┴ⁿ`，
  其中 `╣`(U+2563)=CP437 0xB9、`┘`(U+2518)=0xD9、`┤`(U+2524)=0xB4、`┌`(U+250C)=0xDA、`▓`(U+2593)=0xB2、
  `¿`(U+00BF)=0xA8、`┴`(U+2534)=0xC1、`ⁿ`(U+207F)=0xFC。
- 英文串（如 `Sorry, I lied ó▄`）里的装饰字符（`ó`/`▄`）属同类存储，但**无 Hangul 结果，保持原样**（门控生效）。

## 3. 恢复链路（已用真实字节验证）

```text
sTrW UTF-16 字节
  → UTF-16LE 解码          → 得到 box-drawing 乱码文本 T
  → 按 CP437 反向编码      → 得到原始 EUC-KR 字节
  → EUC-KR 解码            → 得到正确韩文
```

实测（真实文件 sTrW 条目）：

| 乱码文本 | 恢复后 | 说明 |
|----------|--------|------|
| `╣┘┤┌▓¿┴ⁿ` | `바닥꺼짐` | 地面熄灭 |
| `╣╠╝╟╝÷╟α╚─` | `미션수행후` | 任务完成后 |
| `╚▐░í┤┘~!` | `휴가다~!` | 休假了~! |
| `╣╠┴ñ` | `미정` | 未定 |
| `GM ╕≡╡σ╜├└█` | `GM 모드시작` | GM 模式开始 |
| `[╟╤┼╕ : ┐└╕«┴°]` | `[한타 : 오리진]` | [韩打 : 起源] |
| `ñ╗ñ╗` | `ㅋㅋ` | 韩文拟声词（兼容字母区） |

修复后 `itemname.lst` 样本：`` `(구)1 ~ 10레벨 가죽 방어구 레가시` 7012 ``、`` `(구)1848 드라군` 31035 ``；
`monstername.lst` 样本：`` `고블린` 1 ``、`` `고블린 투척병` 2 ``。

## 4. 实现方案

### 4.1 `src/utils/encoding.js` 新增

- `CP437_HIGH`：CP437 高半区（0x80~0xFF）字符表 + `_cp437Reverse` 反向 Map（字符→字节）。
- `HANGUL_RE`（音节 + 谚文字母 + 兼容字母 + 扩展区）与 `HANGUL_SYLLABLE_RE`（仅音节 U+AC00~D7A3）。
- `recoverKoreanFromMojibakeText(text)`：核心恢复——文本含 CP437 字符 → 整串 CP437 反向编码（含任一非 CP437 字符则放弃）→ EUC-KR 解码 → **结果含 Hangul 才采纳**，否则返回 null。
- `decodeKoreanMojibake(bytes, encoding)`（sTrA 单字节）：主解码 → 文本恢复 → UTF-8 文本恢复 → 原始字节直解（**仅音节区**，避免把 GBK 日文假名区 A4xx 误判为韩文兼容字母）。
- `decodeKoreanMojibakeUtf16(bytes)`（sTrW UTF-16）：UTF-16LE 解码 → 文本恢复 → 原样兜底。

### 4.2 `src/utils/pvfTool.js` 接入三处

1. `_readUtf8String`：`decodeText(...)` → `decodeKoreanMojibake(...)`；
2. `_buildStringCaches` 的 sTrA 循环：`decodeText(...)` → `decodeKoreanMojibake(...)`；
3. `_readUnicodeString` + `_buildStringCaches` 的 sTrW 循环：`decodeUtf16LE(...)` → `decodeKoreanMojibakeUtf16(...)`。

覆盖 `resolveString` / `decodeLst` / `decodeLstWithNames` / `listLstItems` / 物品编码查看等全链路。

## 5. 自测结果（Node 直接加载 `pvfTool.js`，90US 实际文件）

| 检查项 | 结果 |
|--------|------|
| sTrW 全表回归 | 106459 条，95168 条变更为韩文，**非韩文变更 0** |
| sTrA 全表回归 | 1281932 条，**变更 0**（`ぃ` 等日文假名保持原样） |
| itemname.lst | 10696 行，10694 行正确韩文；用户样本码全部还原 |
| monstername.lst | 5368 行，5223 行韩文（`고블린`、`고블린 투척병`） |
| decodeLstWithNames 全链路 | 正常，无回归 |

解析耗时约 6.6s（原 3.3s，恢复扫描为一次性缓存构建成本，可接受）。

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| 纯 ASCII 串 | 快路径，零开销 |
| 正常 GBK 中文 / 日文假名 | 无 CP437 字符 → 原样 |
| sTrW box-drawing 韩文（90US） | 恢复为正确韩文 |
| 英文串带装饰字符（`Sorry, I lied ó▄`） | 恢复结果无 Hangul → 原样 |
| sTrA 原始 EUC-KR 韩文（其他客户端） | 仅音节区直解命中才恢复，避免假名/符号区误判 |
| 编辑保存回写 | 不在本次范围：保存仍按原编码重新编码，需另行评估（后续可对恢复串记录原始字节，保存时写回） |

## 7. 范围与后续

- 本次只做**显示层**修复：解析 / 查看 / 搜索均正常显示韩文。
- 不做整表编码切换（用户明确要求不切换整个文件编码）。
- 后续可选项（本期不做）：
  - `detectEncoding` 候选链加入 `euc-kr`，支持 KR 客户端整表；
  - 保存回写时对恢复串保留原始字节（编辑不丢原始编码）；
  - `pvfToolTw.js`（TW 独立解析层）的同类恢复接入。