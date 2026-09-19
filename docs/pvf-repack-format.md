# PVF 重打包归档格式（60CN，只读解析）

本文档记录 60CN 基线归档所使用的**重打包归档格式**的定性结论、字节级格式定义与本仓实现边界。该格式非官方加密 PVF 头部（ORIGINAL / GUARD / PROTECTED / TW 之外的第五种归档形态），由外部消费端管线使用，本仓以**只读解析**方式接入。

## 1. 定性与来源

- 60CN 基线归档（`PVF/60CN/Script.pvf`）以**明文归档魔数**开头（字面值以源码 `src/utils/pvfCodec.js` 的 `REPACK_MAGIC` 常量为准），与官方加密 PVF 头部（解密后签名 `0x69706b6e`，见 `docs/pvf-tw-format.md`）截然不同，四种既有头部探测（ORIGINAL / GUARD / PROTECTED / TW）均无法识别。
- 同级消费端仓库（本机对照副本 `../DFLegacy`，C# 实现）含该格式的读取端实现（归档读取与文件系统两个类），是本仓实现的**对照参考**（权威性低于本仓文档与字节级验证结论）。
- 定性方法：对本仓与消费端 C# 实现分别对同一基线做独立解析对照——两者的文件树、路径、明文内容逐字节一致（Node 探针与 .NET 10 探针均为一次性验证手段，结论以本文档与验证脚本为准，探针不落库）。⚠️ 注意：对密文流做逐 dword 解密时必须使用**无符号逻辑右移**（有符号算术右移会对最高位为 1 的 dword 产生符号扩展错误，表现为路径中零星出现 `0xFF`/`0xFE` 坏字节——该现象为验证脚本自身缺陷，非归档数据损坏）。
- 该归档为**重打包产物**：归档内文件已是明文文本形态（§3），而非官方 PVF 的 5 字节 token 流；推测由消费端管线自原始官方归档转换而来。本仓按字节级事实处理，不依赖该推测。

## 2. 格式定义（字节级）

全部多字节整数为**小端**。

### 2.1 头部（27 字节）

| 偏移 | 长度 | 字段              | 说明                                       |
| ---- | ---- | ----------------- | ------------------------------------------ |
| 0    | 15   | 归档魔数          | 明文比对，字面值以源码 `REPACK_MAGIC` 为准 |
| 15   | 4    | 树区长度 int32    | 须 > 0 且 4 对齐；60CN 基线为 3619688      |
| 19   | 4    | 树区校验值 uint32 | 兼作树区解密密钥；60CN 基线为 `0x86e52ccf` |
| 23   | 4    | 文件总数 uint32   | 60CN 基线为 48351                          |

- 数据区起点 = 27 + 树区长度（60CN 基线为 3619715）。
- 树区长度校验：`27 + treeLength ≤ 文件总长`。

### 2.2 加密算法

- 与 TW 格式的 ROR6 族算法同形但独立：按小端 dword 分组，**明文 dword = 循环右移 6 位（密文 dword XOR 密钥）**，无进位、无反馈、逐 dword 独立。
- 树区密钥 = 头部树区校验值；文件数据密钥 = 该条目登记的校验值（§2.3）。
- 校验值语义：为打包管线登记值，**仅作解密密钥**；实测与解密明文的 IEEE CRC-32 不对应（树区与条目均不对应），不得用于完整性断言。

### 2.3 树区条目（流式排列，无总长字段）

共文件总数个条目依次排列，每条目为「5 × 4 字节字段 + 路径字节」：

| 字段         | 类型         | 说明                                                            |
| ------------ | ------------ | --------------------------------------------------------------- |
| 文件编号     | uint32       | 消费端未消费；60CN 基线自 27157 起递增                          |
| 数据区偏移   | uint32       | 相对数据区起点                                                  |
| 数据长度     | int32        | 明文长度（非对齐值）                                            |
| 条目校验值   | uint32       | 兼作该文件数据解密密钥（§2.2）                                  |
| 路径字节长度 | int32        | 须 > 0 且 ≤ 树区剩余长度                                        |
| 路径字节     | pathLen 字节 | 路径编码按消费端语义为 EUC-KR（CP949）；尾部 NUL 填充不截断树流 |

- 条目流结束后树区可能有 **1~3 字节对齐填充**（60CN 基线：条目流终值 3619685 = 树区长度 3619688 − 3）。
- 路径规范化（对齐消费端）：反斜杠转正斜杠、转小写。归档无目录条目，全部为文件。
- 60CN 基线路径经统计全 ASCII（验证脚本断言），EUC-KR 与其它单字节扩展在 ASCII 区一致；非 ASCII 路径一旦出现按 EUC-KR 解码并登记，不做修正。

### 2.4 数据区

- 文件数据位于 `数据区起点 + 数据区偏移`，按 `(数据长度 + 3) & ~3` 读取（4 对齐补齐），按条目校验值解密后取前 `数据长度` 字节为明文。
- 越界防护：`数据区起点 + 偏移 + 补齐长度 ≤ 文件总长`。
- 60CN 基线数据区覆盖验证：全部条目 `偏移 + 长度` 的最大值 = 数据区大小 = 62338320（精确吻合，无空洞无越界）。

## 3. 内容形态

- 归档内文件为**明文文本**（无 `#PVF_File` 前缀）：**非 .str 文件**内容编码为 **GBK（CP936）**，与消费端脚本编码（936）一致。
- `.str` 文件分**两类文件级编码**（60CN 基线实测 40 个，文件级采样判定零误判）：① **EUC-KR 韩文文件**（33 个，`.kor.str` 全部与 `map.chn.str` / `quest.chn.str` 等未翻译韩文模板）——一律 GBK 解码会把韩文误解为汉字（「한국」→「茄惫」）；② **GBK 主导文件**（7 个，`npc.jpn.str` / `monster.jpn.str` / `npc.chn.str` 等国服翻译文件）——文件级含 GBK 简体中文，且 `.jpn.str` / `.chn.str` 底部混有**未翻译的 Shift-JIS 日文行**（如 `monster.jpn.str` 的 `name_470>デンドロイド`），GBK 解码会把日文误解为和字（「僨儞僪儘僀僪」）。
- 行级判定的边界（门控）：GBK 中文字节与 EUC-KR 谚文区（0xB0A1–0xC8FE）高度重叠，**行级 EUC-KR 判定会把 GBK 中文行误判为韩文行**（「韩文脚本字符串数据文件」→「벴匡신굶俚륜눔鑒앴匡숭」，谚文占比可达 60%），因此行级修正仅限 GBK 判定文件内的 SJIS 日文行，不做行级 EUC-KR 判定；`.chn.str` 内残留的官方韩文行（如 `npc.chn.str` 237 行）在 GBK 判定下显示为汉字化韩文，属已知局限（保中文行不回归优先）。
- 个别文件存在转换时已固化的字符净化：字面问号字节 0x3F（如 `map.chn.str` 97 个，原字符已不可逆丢失，属**数据本体损坏**，展示层无法恢复，任何编码下均为问号）与零星坏字节（如 `monster.kor.str` 数据区 16KB 外 1 处，解码为 U+FFFD）。
- `.lst` 为文本列表：行格式为「编号 空白 反引号路径反引号」（60CN 条目行自带行尾官方名称注释 `// xxx`），`//` 开头为注释行；脚本与资源描述文件为文本标签格式（消费端以正则解析 `[name]`、`[grade]` 等标签）；`.str` 为「key>text」行格式（与 TW/CN 的 str 展示规则一致）。
- 与官方加密 PVF 的结构差异：无 GRPI 分组、无字符串池（sTrA / sTrW）、无 5 字节 token 流、无 dataType 分类——归档内一切文件按文本处理。

## 4. 本仓实现（只读）

- 底层常量与解密：`src/utils/pvfCodec.js` 新增 `PvfFormat.REPACK`（显示标签 **60CN**）、`REPACK_MAGIC` 魔数常量与 `pvfDecryptRepack` 逐 dword 解密函数。
- 解析层：`src/utils/pvfToolRepack.js` 新增 `RepackPvfArchive`（只读），接口对齐既有两层（PvfArchive / TwPvfArchive）中编辑器消费的**全部**方法：`sniff`（魔数探测）、`parse`、`files`（字段对齐 TW 结构，`dataType` 恒为 0）、`getFileData` / `getFilesData`、`decodeContent`（GBK 文本）/ `decodeContentForEdit`、`isLstFile` / `decodeLst` / `decodeLstWithNames`、`getLstRefTarget` / `getLstNameMap`、`extractNameTag` / `extractNameTags`、`exportFile`（契约 `{ filename, blob, size }`，与既有两层一致）。`decodeContent` 对 `.str` 文件两级判定：**文件级**（`_detectStrEncoding`：前 16KB 采样、尾部双字节残半回退 1 字节，EUC-KR 严格成功 → euc-kr 韩文文件，否则 GBK 严格成功 → gbk 主导文件，双失败按 `.kor.str` 后验走非严格 EUC-KR）+ **GBK 主导文件的行级 SJIS 修正**（`_decodeStrLines`：SJIS 严格成功且文本含全角假名 → 日文行；含 GBK 扩展区字符（re-encode 后双字节首字节 0x81–0xA0，GB2312 常用字不含）→ 纯汉字日文行；其余行按 GBK）。不做行级 EUC-KR 判定（GBK 中文字节与谚文区重叠会误判中文行，见 §3 行级边界）。`.str` 之外的文件固定 GBK。只读不变式与安全禁用（对齐 TwPvfArchive 既有语义）：修改类查询 `isFileModified` / `isFileDeleted` / `isFileRenamed` 恒 false、`getStrNameMap` / `buildPathMappings` / `findReferencesMulti` / `fixReferences` 返回空态、`revertFile` / `revertAll` / `undeleteFile` / `setEncoding` 为无操作；修改类操作 `setFileContent` / `setFileRawData` / `deleteFile` / `renameFile` / `renameFolder` / `saveAs` 一律显式抛错（经调用点既有 catch 弹窗反馈）。
- 编辑器接线（`PvfEditor.vue`）：`loadPvf` 以 `sniff` 魔数探测**优先**分派（27 字节明文魔数无歧义，先于既有 JP/TW 探测链）；保存函数对 REPACK 归档显式拦截提示；新增 `isReadonlyArchive` computed，右键菜单的「导入替换 / 重命名 / 撤销修改 / 删除」入口对只读归档隐藏，仅保留「导出文件」。
- 只读内容预览（`PvfEditor.vue`）：60CN 归档内为明文文本而 `dataType` 恒 0，既有只读占位分支不含内容渲染——新增 `pvf-ro-preview` 预览分支：`loadFileContent` 生成预览 HTML（**强制 PVF 语法高亮**，标签着色 / lst 名称染灰与既有 token 展示一致，`highlightMode` 不受 `dataType 0` 影响仍为 plaintext），`.str` 文件走 `_renderKeyValueText`（TW/CN 同款 key>text 行格式：前缀红 / > 淡蓝 / 内容灰、注释行注释绿）；悬浮（`onReadonlyMouseMove`）按行号命中标签并追加「标签说明 + 代码引用」区块——60CN 明文形态标签可与参数同行（`[rarity] 2`），匹配不锚定行尾；文件树文本图标对只读归档按 `pvf-ico-script` 蓝色（#5b8cff）着色。hljs token 配色选择器组（`.pvf-code-highlight` / `.pvf-largefile-preview`）已同步扩展至 `.pvf-ro-preview`（24 组），预览高亮配色与大文件预览、编辑区正文一致；`hljs-comment` 已从源头去除斜体（等宽小字号合成斜体渲染发虚，全场景生效）。
- 物品编码支持（`ItemCodeView.vue` 与解析层）：加载分派同款 `sniff` 优先；`listLstItems` 条目解析对 60CN lst 条目行自带的行尾官方名称注释（`1 \t\`coin.stk\` \t\t// 复活币`）兼容——`decodeLstWithNames`行解析放宽以建立引用映射、展示名剥离注释前缀、追加`[name]` 提取名与注释正文相同则去重；`listLstItemMeta`对齐 TW（品质 / 等级 / 类型 / 期限元数据），60CN 明文形态的标签提取由`_repackTagFromText`提供（标签与参数同行，与`extractTagFromText`的标签独占一行语义不同）；格式徽章新增`pvf-format-repack`/`ivc-format-repack`（绿色 #3ecf8e）。60CN 基线实测：`stackable.lst` 1703 条编码（1702 条有名称）、`equipment.lst` 9258 条编码（全部有名称）。
- **只读边界（门控）**：编辑回写未实现。理由：消费端仓库仅有读取端实现，重打包（树区重建 + 校验值重算 + 逐文件再加密）无权威写入端可对照；仅有自打包-自解包往返不足以验证产物可被消费端加载。在取得可被消费端加载的写入端权威对照前，不实现保存 / 导入，也不在 UI 提供可写假象。
- `.nut` 语法高亮判定与本层无关（归档无 `.nut` 明文脚本之外的特殊形态，按 plaintext 展示）。

## 5. 与官方加密 PVF 格式的差异对照

| 维度     | 官方加密 PVF（JP/JPAG/CN/TW）                        | 重打包归档（REPACK/60CN）                  |
| -------- | ---------------------------------------------------- | ------------------------------------------ |
| 头部     | 加密 0x30 头部（TW 为 GUID 头），签名解密后校验      | 明文魔数 + 12 字节参数                     |
| 加密     | 多套分组 / seed 密钥流（见 `docs/pvf-tw-format.md`） | 逐 dword ROR6 XOR，密钥取自头部 / 条目字段 |
| 树结构   | 文件表 + 字符串池 + GRPI 分组                        | 单一加密条目流（内联路径），无分组         |
| 文件内容 | 5 字节 token 流 / UTF-16 文本 / 二进制               | 全部为 GBK 明文文本                        |
| 写入     | 本仓支持编辑回写（两层既有能力）                     | 只读，回写未实现（§4）                     |

## 6. 验证

- 测试脚本：`test/repack-verify.mjs`（Node 运行：`node test/repack-verify.mjs [pvf路径]`；默认目标 `PVF/60CN/Script.pvf`，基线根目录为运行时工作目录，实际位置不符时按 AGENTS.md 流程以命令行参数传入）。
- 固定回归基线：`PVF/60CN/Script.pvf`（已登记 AGENTS.md §2 清单）。
- 断言清单：

| #   | 断言项       | 期望                                                                                                                      |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 头部字段     | treeLength=3619688、文件总数=48351、数据区起点=3619715                                                                    |
| 2   | 树区条目流   | 前 5 条路径精确匹配（§6.1）；条目流终值=树区长度−3（尾部对齐填充）                                                        |
| 3   | 数据区覆盖   | 全条目 `偏移+长度` 最大值 = 62338320 = 文件总长 − 数据区起点                                                              |
| 4   | 内容解码     | `aicharacter/aicharacter.lst` 解密后 126 字节，GBK 解码首行 `// AI角色总结文档 //`，含条目 `cuwaki/cuwaki.aic`            |
| 5   | 路径规范     | 全部路径 ASCII、无反斜杠、无大写                                                                                          |
| 6   | 只读不变式   | hasChanges=false、修改/删除/重命名计数=0、groups=[]                                                                       |
| 7   | 导出契约     | exportFile 返回 `{ filename, blob, size }`，blob 为 UTF-8 文本字节流（size 为文本长度，对齐 TW 契约）                     |
| 8   | 修改类接口   | 查询恒空态、引用修复禁用、修改类操作显式抛错、撤销/编码切换无操作（Part B12~B14）                                         |
| 9   | 物品编码链路 | `stackable.lst` 1703 条编码且命名≥1700，首 3 条名称精确；nrcp 样本 meta rarity=2 / minLevel=44 / stackableType（B15~B16） |
| 10  | 源码静态守卫 | PvfEditor 加载分派 sniff 优先、保存拦截、右键菜单隐藏、只读预览与悬浮接线、树图标着色（Part C1~C7）                       |

### 6.1 前 5 条路径（条目流物理顺序）

```text
passiveobject/monster/ghoul/animation/skullbombsub.ani
equipment/character/mage/avatar/hair/hair_a/rest.ani
equipment/character/gunner/avatar/pants/pants_d/overturn.ani
passiveobject/mapobject/trap/animation/entanglevinereleasebranch.ani
monster/drake/particle/chain1.ptl
```
