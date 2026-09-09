# TW 明文 Squirrel 脚本（.nut）解码与代码高亮（70TW）

## 1. 问题现象

`PVF/70TW/Script.pvf` 的 `sqr/init_character.nut` 等明文 Squirrel 脚本在 PVF 编辑器中存在两个问题：

1. **注释乱码**：`//` 注释内容显示为无意义汉字噪声（如「嚙踝蕭」），部分外部工具按 EUC-KR 解码则显示「占쏙옙」类字符，均不可读；
2. **无代码风格高亮**：`.nut` 在 TW 层 `dataType` 恒为 1，编辑器 `highlightMode` 判定为「pvf」模式，按 PVF token 脚本语法（`#` 注释 / 反引号字符串 / `[标签]`）渲染 Squirrel 代码，关键字、字符串、数字均不着色，且 `[` `]` 等字符可能被误染为标签色。

## 2. 字节级定性（已用实际文件字节验证）

### 2.1 样本留存

按「解析异常样本留存（PVF）」门控，自归档数据区一次性切片留存**未解密原始流**：

| 项目 | 值 |
|---|---|
| 归档内路径 | `sqr/init_character.nut` |
| 留存位置 | `test/70TW/sqr/init_character.nut` |
| checksum | `0x126DB5C1` |
| dataSize / trueLen | 2906 / 2908 字节（4 字节对齐） |
| 归档内偏移 | dataOffset 47906296 + 数据区基址 14640864 |
| 现场还原方式 | `pvfDecryptTw(字节流, TW_DECRYPT_KEY, 0x126DB5C1)` 后截取前 2906 字节 |

### 2.2 明文形态与损坏定性（2026-09-10 修正：混合编码流）

- 还原后头部字节 `0d 0a 66 75 6e 63 74 69 6f 6e ...`（`\r\nfunction ...`）：**明文文本**，无 `#PVF_File` 前缀、无 `0xB0 0xD0` token 魔数，代码部分为 ASCII。
- 注释区字节为**混合编码流**：大部分原始 EUC-KR 谚文字节已被 UTF-8 净化为 `EF BF BD`（U+FFFD），但**少量「恰好构成合法 UTF-8 序列」的 EUC-KR 双字节对（高字节 `C2`~`DF` + 低字节 `80`~`BF`）原样残留**。样本（`sqr/init_character.nut`）统计：`EF BF BD` 序列 192 处 + 残留对 31 处。
- 净化机制还原：第三方打包工具以 UTF-8 解码器读取原 EUC-KR 韩文注释——高字节 `B0`~`BF` / 低字节 `C0`~`FE` 的对与越界序列非法 → U+FFFD；高字节 `C2`~`DF` 且低字节 `80`~`BF` 的对恰好合法 → 被解码为 U+0080~U+07FF 的拉丁/西里尔占位字符原样保留字节；随后以合法 UTF-8 写回归档（这解释了 §2.3 的 95/95 严格 UTF-8 成功）。
- **残留对可精确恢复**（已用实际字节验证）：`C5 B8`→`타`、`C4 B5`→`캔`、`C3 B3`→`처`、`C4 B3`→`캐`、`C6 AE`→`트`、`C8 A3`→`호`、`C7 B4`→`풔`、`C5 A9`→`크`；落在 KS 汉字区（`CA`~`DF` 高字节）的对按 CP949 解出对应汉字（如 `D2 B6`→`秊`、`CE BC`→`關`）。WHATWG euc-kr 表对用户定义区（如 `C9 B6`）映射到私有区（U+E0xx）——属无法还原的 UDC 残留，按损坏（U+FFFD）呈现。
- **定性**：`EF BF BD` 部分为数据本体损坏、信息不可逆丢失（非解析错误），与 `event/event.kor.str`（`docs/pvf-tw-format.md` §8.7）同源同性质，任何展示层恢复均为伪造；**残留双字节对部分语义完整、可精确恢复**——展示层按其原始字节以 CP949（euc-kr）解读，恢复原谚文/汉字，属正确解读而非净化改写。

### 2.3 全量编码分布（70TW 归档 95 个 .nut）

对归档内全部 `.nut` 明文做严格编码判定（`utf-8` / `big5` / `gbk` 依次 fatal 解码）：

| 分类 | 数量 | 说明 |
|---|---|---|
| 严格 UTF-8 成功、无 U+FFFD | 77 | 纯 ASCII 或完好 UTF-8 注释 |
| 严格 UTF-8 成功、含 U+FFFD | 18 | 注释净化损坏（含 §2.1 样本） |
| 仅 big5 / 仅 gbk 可解码 | 0 | 无反例 |

结论：**70TW 的 `.nut` 明文全部为 UTF-8 字节流，无 Big5/GBK 反例**，按 UTF-8 优先解码规则无副作用。

### 2.4 韩文注释可恢复性全量验证（2026-09-10 修正）

对 95 个 `.nut` 全部 `//` 注释行逐行统计（严格 UTF-8 解码后判定；**初版统计将「谚文残留 + U+FFFD 混合行」整体归入损坏，结论「完好韩文 0 行」表述失准——混合行中残留对部分可恢复，本节为修正后的定性**）：

| 注释行分类 | 行数 | 说明 |
|---|---|---|
| 含 U+FFFD | 75（16 个文件） | 韩文注释净化损坏形态（大部分谚文字节已不可逆丢失） |
| 同时含可恢复残留对 | 17（全部含 U+FFFD） | 残留 `C2`~`DF`/`80`~`BF` 对，恢复后可读谚文/汉字（`타`、`캔`、`처`、`캐`、`트`、`호` 等） |
| 含完好 CJK 汉字 | 10 | 第三方技能打包者的繁体署名水印（`swordman_throw.nut`、`ap_skill38.nut` 等，后加的完好 UTF-8 注释，无痕迹字符、不受恢复影响） |
| 纯 ASCII | 88 | 代码标记类注释 |
| 空（仅 `//`） | 10 | — |

- 全量字符级恢复原型统计：恢复输出谚文 169 + 汉字 220 + 私有区/UDC 残留 5（按 U+FFFD 呈现）+ 替换符 0；**含残留对的 17 个文件全部同时含 U+FFFD**（零漏网），「含 U+FFFD」即可作为恢复门控，纯 UTF-8 文件（77 个，含水印）无痕迹字符不受影响。
- 证据链：① 大部分谚文字节（高字节 `B0`~`BF`）净化后不可逆，任何展示层恢复均为伪造；② 残留对语义完整且按 CP949 解码得到正确谚文/汉字，与第三方工具（CP949 解码）所见的可读片段（`1타 캔`、`처…캐…트…호풔`）一一对应；③ 完好繁体水印注释的存在证明「UTF-8 编码的注释可完整存活」，排除「解码方式选错导致韩文不可读」的可能。

## 3. 解决方式

### 3.1 解码（`src/utils/pvfToolTw.js`）

- `decodeContent` 内 `.nut` 分流至 `_twDecodeNutText`，按**编码形态二分**（2026-09-10 经用户确认为「按原始字节解析、不做替换净化」的展示原则）：
  1. **纯 UTF-8 文件**（严格 UTF-8 成功且不含 U+FFFD，77 个，含第三方繁体水印注释）：按 UTF-8 直解展示；
  2. **净化混合流文件**（严格 UTF-8 成功但含 U+FFFD，18 个）与严格解码失败文件的防御回落：按**原始编码 CP949（euc-kr）直解**展示——残留 EUC-KR 对自然显示原谚文 / KS 汉字（`타`、`캔`、`처`、`캐`、`트`、`호`、`풔`、`크`、`秊`、`關` 等，与字符级恢复方案结果一致），净化损坏字节（`EF BF BD` 循环）自然显示为「占쏙옙」（CP949 对该循环的标准映射，与外部参照工具形态一致）；解码器对孤立字节产生的少量 U+FFFD 为固有行为，**不再叠加任何恢复 / 净化 / 替换处理**。
  3. **替换符密度门控（防误判）**：严格 UTF-8 成功但含 U+FFFD 的文件，先以 CP949 **试解码**并统计替换符占比——占比低（净化流的孤立字节固有替换，实测样本 4/1064 ≈ 0.4%，阈值 5%）→ 判定为净化流，走 CP949 直解；占比高（UTF-8 语义文件，如「旧版保存或外部工具产生的 UTF-8 + 零星替换符」，实测 ~50%）→ 保持 UTF-8 直解原样呈现，避免把 UTF-8 字节当 CP949 二次误解为乱码。
- 展示形态选择记录：「字符级恢复 + U+FFFD」与「CP949 直解 + 占쏙옙」两方案的可读内容完全一致（同一批残留字节），差异仅在损坏处形态；经用户确认为 CP949 原始形态。
- **三 / 四字节残留边界（已验证、不单独处理）**：净化流中另存在 UTF-8 三 / 四字节形态的 EUC-KR 残留（如 `E2 BA BB`→U+2EBB、`EE BA A5`→U+EEA5 私有区），95 个文件共 17 处（11 个文件），随 CP949 直解自然呈现（产出 KS 汉字 + 替换符 / 私有区占位），不单独恢复。
- `EF BF BD` 损坏部分原样呈现（U+FFFD），不做任何变换（门控）。

### 3.2 编码 / 回写（`src/utils/pvfToolTw.js` + 新增 `src/utils/euckrEncoder.js`）

- 修复现存隐患：`encodeContent` 对非 .lst 文件一律走 `encodeTwToken`，`.nut` 编辑保存会被误 token 化而损坏。新增 `.nut` 分支：不做 token 化，按**显示文本的编码语义**对称回写（2026-09-10 二次修正——此前「U+FFFD→`?` 后 UTF-8 回写」方案改变了文件编码语义，外部 CP949 工具读取全乱，已废弃）：
  - **净化混合流文本**（含 U+FFFD 或谚文音节，CP949 直解语义）：经 **CP949 反查编码**回写。新增 `src/utils/euckrEncoder.js`（对齐 `gbkEncoder.js` 模式：加载时以 `TextDecoder("euc-kr")` 枚举双字节空间（高 `0x81`~`0xFD` × 低 `0x40`~`0xFE` 除 `0x7F`）构建反查表，**排除 U+FFFD 映射**；导出 `encodeEUCKR` / `euckrCode`）。可编码字符（谚文 / KS 汉字 / 损坏标记「占쏙옙」/ UDC 残留私有区）逐字节还原原字节——**交织对称性**：`EF BF BD` 循环解码为「占쏙옙」循环，字符反查编码精确还原字节（实测 roundtrip 2906B ↔ 2906B，仅 4 个孤立字节替换符不可逆、显式降级 `?` 0x3F，沿用 `encodeGBK` 惯例）。保存后文件保持 CP949 字节语义：外部 CP949 工具与本仓（密度门控 → CP949 直解）读回显示一致。
  - **纯 UTF-8 文本**（无 U+FFFD 且无谚文音节，繁体水印 / 纯 ASCII）：`encodeText(text, "utf-8")` 原样回写，与源明文逐字节一致。
- 展示层文本经 `_normalizeLines` 行尾归一化（`\r\n` → `\n`，与既有 `#PVF_File` 明文行为一致），编辑保存的行尾按展示层 `\n` 写回，属既有明文回写惯例。

### 3.3 代码风格高亮（`src/utils/pvfHighlight.js` / `src/components/PvfEditor.vue`）

- `pvfHighlight.js` 新增 Squirrel 语言定义 `registerNutLanguage(hljs)`（注册名 `squirrel`，highlight.js 无内置同名语言）：`//` 与 `/* */` 注释、`"..."` 与 `'...'` 字符串（含转义）、Squirrel 关键字（function/local/if/else/for/foreach/while/do/class/extends/constructor/return/break/continue/in/base/this/null/true/false/switch/case/default/try/catch/throw/typeof/instanceof/delete/static/const 等）、数字（十进制 / 十六进制 `0x` / 浮点）、函数名（title）、**new-slot 操作符 `<-`（operator，如 `sqr/dnf_enum_header.nut` 的 `LANDTYPE_POISONSWAMP <- 3` 枚举赋值）**。
- `PvfEditor.vue`：`highlightMode` 对 `.nut` 返回 `"nut"`；`updateHighlight` 与 `_renderHighlighted` 新增 `"nut"` 分支调用 `hljs.highlight(text, { language: "squirrel" })`，不叠加 PVF 标签注解（`annotateTagSpans` / `annotateRefs` / `grayLstNames`）；样式段新增 `.hljs-operator` 灰色（`#9a9a9a`，与既有 `.hljs-pvf-name` / `.hljs-pvf-bin-text` 灰一致），枚举赋值的 `<-` 弱化为灰色以突出名字与值。
- `applyFormatting` 对 `.nut` 跳过 PVF token 文本重排（Squirrel 源码自带缩进，重排会破坏版式）。
- 保存链路自然受益：`.nut` 的 `highlightMode` 非 `"pvf"`，`stageChange` 中的 PVF 语法校验自动跳过；`runValidation` 在 TW 层本就停用。

## 4. 测试脚本位置与验证内容

| 脚本 | 验证内容 |
|---|---|
| `test/tw-nut-verify.mjs` | 默认（无参数）加载留存样本 `test/70TW/sqr/init_character.nut`：① 登记元数据（trueLen/checksum）核对；② 现场还原（解析层同款算法）头部断言；③ 严格 UTF-8 成功且含 U+FFFD 的净化损坏特征断言；④ 代码结构行完好断言；⑤ `decodeContent` → `encodeContent` 字节级 roundtrip 断言；⑥ Squirrel 高亮语言注册与关键 token 着色断言。传入 PVF 路径参数时追加全量回归段 |

运行方式：`node test/tw-nut-verify.mjs [PVF/70TW/Script.pvf 路径]`（基线根目录为运行时工作目录，实际位置不符时按「工作流前置」以命令行参数传入）。

全量回归段（传 PVF 路径参数时执行）：`.nut` 全量严格 UTF-8 分布断言（含 U+FFFD 计数）；`.nut` 全量 decode/encode roundtrip 断言；既有路径一致性断言（.lst 行结构、stringtable 视图、token 脚本 `[` 节、.str 按区域编码解码输出与区域编码直解一致）。

## 5. 边界与已知限制

| 场景 | 行为 |
|---|---|
| 净化混合流文件的损坏字节（18 个文件） | 数据本体损坏（§2.2），按原始编码 CP949 直解自然显示「占쏙옙」（用户确认形态，§3.1），不叠加恢复 / 净化 / 替换 |
| 纯 UTF-8 文件（77 个，含水印） | UTF-8 直解（§3.1 分支 1） |
| `.nut` 严格 UTF-8 解码失败（未来版本） | 回落 CP949 直解路径（§3.1 分支 2），属「按原始字节解析」原则的自然延伸 |
| `.nut` 编辑保存 | 不 token 化（§3.2）；纯 UTF-8 文本原样回写；CP949 直解文本按 UTF-8 回写且 U+FFFD 显式降级为 `?`（沿用 `encodeGBK` 不可编码降级惯例），重开走 UTF-8 直解分支稳定显示 |
| `.nut` 语法高亮 | 仅做着色展示，不解析 Squirrel 语义（无折叠 / 悬浮提示） |
| JP / JPAG / CN / US 层 `.nut` | 独立解析层（PvfArchive），不在本次范围，维持既有行为 |
| 外部参考项目 Agent-Workbench | 其 `nut-api` 仅为 Squirrel 运行时 API 符号目录与写入边界规则，无 `.nut` 存储形态 / 注释编码规则；本文件定性以本仓字节级验证为准 |

## 6. 验证结果（2026-09）

`node test/tw-nut-verify.mjs <PVF/70TW/Script.pvf 路径>`（全量段）实测 **33 PASS / 0 FAIL / 0 SKIP**（样本段独立运行 21 PASS / 0 FAIL / 0 SKIP）：

| 检查项 | 结果 |
|--------|------|
| 留存样本现场还原（checksum `0x126DB5C1`） | 头部 `\r\nfunction sq_InitFrameIndices(obj)` 断言 PASS，解密链路正确 |
| 样本混合流定性（§2.2） | `EF BF BD` 序列 192 处、EUC-KR 残留对 31 处、残留对 CP949 解码样例（`C5 B8`→`타`、`C4 B5`→`캔`、`C3 B3`→`처`），全部 PASS |
| `.nut` 解码行为（样本） | 净化流按原始编码 CP949 直解生效（`타`/`캔`/`처` 可读 + 损坏处「占쏙옙」原始形态，与外部参照工具逐字符一致）；**CP949 反查保存字节守恒**（归一化原字节 2804B ↔ 保存 2804B，差异仅 4 个不可逆孤立字节降级 `?`）；**保存后双视角稳定**（外部 CP949 工具解读 = 本仓重开 = 保存前显示，FFFD/`?` 归一化后逐字符一致）；替换符密度门控（UTF-8 语义文件「旧版保存字节」重开保持 UTF-8 直解、可读内容保留而非二次乱码，实测占比 15.4% > 5% 阈值），全部 PASS |
| Squirrel 高亮 | 语言注册、`//` 与 `/* */` 注释、关键字、字符串、数字着色、new-slot 操作符 `<-` 着 operator 类、U+FFFD 不破坏高亮、既有 pvf 语言反引号串着色回归，全部 PASS |
| `.nut` 全量（70TW 归档） | 95/95 严格 UTF-8 成功；含 U+FFFD 文件 18、含残留对文件 17（全部含 U+FFFD，§2.4 基线）；95/95 解码与分支预期一致（纯 UTF-8 → UTF-8 直解 77 + 净化流 → CP949 直解 18）；纯 UTF-8 文件 roundtrip 字节一致 77/77；净化流文件 CP949 反查保存双视角稳定（外部 CP949 工具解读 = 本仓重开 = 保存前显示，FFFD/`?` 归一化后逐字符一致）+ 可读谚文保留 18/18 |
| 既有路径一致性（70TW 归档） | stringtable 视图首行 `0>[name]`、`.lst` 行结构（`creature/script/creature.lst` 35/35 行）、仅魔数头空表（`skill/demonicswordman.lst`，dataSize=2，归档内数据特征，解码输出空为正确行为）、token 脚本 `[` 节缩进解码、`.str` 区域编码直解一致，全部 PASS |
| 既有回归脚本 | `verify-authoritative-scan.mjs`（含 §8.7 净化损坏 strlst 特征断言）、`indent-verify.mjs`、`item-grant-category-sync.mjs` 均通过（exit 0），无回归 |

格式化：`test/tw-nut-verify.mjs` 通过 `prettier --check`；`src/utils/pvfToolTw.js` 的 CRLF 行尾为既有文件状态（HEAD 版本同样不过 check），本次未做整文件行尾改写，新增行风格与文件一致。

**配套改动**：`src/utils/encoding.js` 的 `ENCODING_ALIASES` 注册韩文编码别名（`euc-kr` / `euckr` / `cp949` → `euc-kr`，WHATWG 标准标签，仅新增不修改既有映射）——此前 `decodeText(data, "euc-kr")` 会因别名缺失被静默回落为 UTF-8。

**定性更正记录**：初版定性（2026-09-09）依据头部 240 字节 dump 与「注释行逐行含完好韩文 0」的统计，误判「韩文注释全部不可逆」；经完整注释区字节复核发现混合流中存在可恢复残留对（§2.2、§2.4）。显示形态历经两版：字符级恢复 + U+FFFD → 经外部参照工具逐字符对照验证（其输出与 CP949 直解完全一致，无额外信息）后，**经用户确认改为「按原始字节解析、不做替换净化」的 CP949 直解形态**（§3.1），并按「先文档、后测试、再改码」顺序落地。
