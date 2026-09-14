# AGENTS.md — launch-helper 项目协作规则

本文件是 AI 助手在本仓库工作时必须遵守的规则。优先于一般指令；与用户新指令冲突时以用户新指令为准。

## 权威参考

解析/编码语义的**最高优先级权威**为本仓库自身资料，不引用任何第三方源码（含路径与文件名）；除非有特别重大说明，开源仓库可以添加：

- `docs/` 下格式文档（`pvf-tw-format.md` §9 等）：已固化的格式规则与解码输出格式定义。
- 固定回归基线（§2 清单）：全量回归验证输入。
- 用户提供的实导出样例：仅作**对照参考**；经用户**权威确认**的样例为权威依据，与文档冲突时以权威确认为准。
- `docs/pvfine-external-reference.md`（外部参考规则）：外部参考项目 pvfine（`https://github.com/dof-dev/pvfine`，Go）的归档模型 / 头部解密 / GRPI 分块 / 脚本反编译格式化与层级缩进规则总结；仅作**对照参考**，权威性低于前列来源，upstream 演进不自动生效。
- `docs/pvf-tag-community-comments.md` §5（外部参考规则）：外部参考项目 Agent-Workbench（`https://github.com/Qswhisper/PVF-Ai-Agent-Workbench`，Node 知识工作台）的社区标签注释、registry 提示构建流程、已知 lst 拼写候选与 PVF 解析 / 反编译排版对照结论（§5.1）登记；仅作**对照参考**，权威性低于前列来源，upstream 演进不自动生效。
- `docs/pvf-tw-nut-script.md` §3.4（外部参考规则）：外部参考项目 vscode-squirrel（`https://bitbucket.org/marcinbar91/vscode-squirrel`，MIT）的 Squirrel 缩进格式化规则借鉴与缺陷修正要点（同作者 `vscode-squirrel_linter` 为语法 linter，无格式化内容）；仅作**对照参考**，权威性低于前列来源，upstream 演进不自动生效。
- `docs/pvf-tw-nut-script.md` §3.4（外部参考规则）：外部参考项目 code-server（`https://github.com/coder/code-server`，MIT，VS Code 的开源服务端包装实现）所服务的编辑器格式化语义——格式化器经 FormattingOptions 接收编辑器按文件检测出的 `tabSize` / `insertSpaces`，缩进风格随文件而定；其仓库自身不含代码格式化规则（仅一份 Prettier 风格配置，与本仓 .nut 排版无关）；仅作**对照参考**，权威性低于前列来源，upstream 演进不自动生效。

已登记外部开源仓库：pvfine（规则总结与对照差异见 `docs/pvfine-external-reference.md`；本机对照副本为同级仓库 `../pvfine`，按「文档路径脱敏（门控）」以相对形式书写）。其 §2 脚本反编译版式已按同文档 §4 落地为 PVF 编辑展示缩进（新增缩进版方法，**不改动既有解码方法**，验证脚本 `test/indent-verify.mjs`）。

已登记外部开源仓库：Agent-Workbench（本机副本为同级仓库 `../Agent-Workbench`，其 `knowledge-pack/` 知识包以 CC0-1.0 公共领域许可发布，可自由复用）。其内置社区标签注释（344 条）已提取落地为本仓标签提示注释层（`src/utils/pvfTagComments.js`，验证脚本 `test/tag-comment-verify.mjs`）；其 registry 提示构建流程所解析的配置结构与本仓代码引用规则数据源同源，已知拼写候选登记于 `docs/pvf-tag-community-comments.md` §5，数据一律原样保留、不做静默改写。其 PVF 只读后端中仓库内有源码的 TypeScript fallback（`tools/pvf-bridge/fallback/`）与本仓 TW 层的解析 / 反编译排版对照结论（2026-09，两侧为不同展示方言，维持本仓版式不改码；文件名解码编码不对称登记为存疑待验证项）见同文档 §5.1。

已登记外部开源仓库：code-server（`https://github.com/coder/code-server`，MIT；本机无对照副本，规则对照见 `docs/pvf-tw-nut-script.md` §3.4 / §3.5 / §3.6）。其编辑器缩进检测语义（VS Code 同款：由文件缩进风格决定一级缩进单位）已落地为本仓 .nut 「格式化」的一级缩进单位检测（`src/utils/pvfNutFormat.js` 新增 `detectNutIndentUnit`，**无缩进证据时仍为 Tab 单级**）；其编辑器折叠控件渲染语义（VS Code 同源：gutter 折叠箭头图标、已折叠常显 / 未折叠悬停才显、折叠行底色，配色仍由本仓主题变量决定、不整体替换编辑器皮肤）作为 `.nut` 折叠观感对照（箭头为自绘 SVG、不内嵌第三方图标资源）；其编辑器装饰语义（VS Code 同源，见其 §3.6：折叠区**整行**底色、**区块区域辅助线**（只对跨行 `{}` 区块的区域内部行绘制，即开括号下一行 ~ 闭括号前一行；同行 `{}`、悬挂单语句体 / 条件续行 / `case` 体更深缩进不产生）与活动块高亮、光标处 / 选中词同类词高亮、当前行 1px 边框）已落地为 .nut 编辑器的**装饰覆盖层**（`src/utils/pvfNutFormat.js` 新增区块辅助线层级 / 活动块 / 同类词工具层，展示层绘制于文字之下、`pointer-events: none`、不改文本模型；未实现项与有意差异见其 §3.6 / §5），验证脚本同为 `test/tw-nut-verify.mjs`。

- 文档与实现如有分歧，先做**字节级验证**（dump 原始字节逐字段核对）再定论，不得直接引用或复述第三方源码内容。

## 项目概况

- 核心解析层：`src/utils/pvfTool.js`（JP/JPL/JPAG/CN）、`src/utils/pvfToolTw.js`（繁体 TW 独立层）。PVF 编辑器脚本展示走缩进版解码：JP `decodeContentForEdit`/`decodeTokenIndented`、TW `decodeTwTokenIndented`（标签 / 值区层级缩进，共享 `PvfScriptIndenter`；**新增方法，既有解码方法输出不变**，版式与边界见 `docs/pvfine-external-reference.md` §4）。两层导出（`exportFile`）共用**同一契约** `{ filename, blob, size }`（编辑器唯一消费点 `PvfEditor.vue` `exportNode`）：文本走权威无缩进 `decodeContent`（缩进仅供展示），二进制保留原始字节——TW 文件树 `dataType` 恒为 1，故以解码回退占位文本判定（见 `docs/pvf-tw-format.md` §12.5，验证脚本 `test/tw-export-verify.mjs`）。
- NPK 归档预览与编辑：`docs/npk-format.md`（JP `ImagePacks2` NPK/IMG 格式与加解密算法注册表；解析与重建层 `src/utils/npkTool.js`，界面 `src/components/NpkView.vue`，验证脚本 `test/npk-verify.mjs` 与 `test/npk-roundtrip.mjs`；编辑/保存沿用原有加密算法不变；SHA256 两级策略：有 WebCrypto（含 Node 18+ 全局 `crypto.subtle`）走 `crypto.subtle`，否则动态加载 `crypto-es` 兜底，`npkTool.js` 不引用 `node:crypto`、测试脚本以 `node:crypto` 生成参考值；音频/视频条目（SoundPacks `.ogg`、`.avi`）与独立加密 AVI 走不转码预览，MPEG 编码 AVI 经 TS 封装由 `src/utils/jsmpeg.min.js`（JSMpeg，MIT，单文件 IIFE，`?raw` 动态加载）软解播放，格式与预览行为见其 §6）。
- 二进制协议文档：`docs/pvf-tw-format.md`（TW）、`docs/pvf-jp-korean-mojibake.md` / `docs/pvf-us-korean-mojibake.md`（编码修复）、`docs/pvf-item-grant-parsing.md`（脚本语义）、`docs/pvf-tw-nut-script.md`（TW 明文 Squirrel 脚本 `.nut`：打包前 UTF-8 净化损坏定性、UTF-8 优先解码与原样回写、Squirrel 代码高亮、缩进格式化（工具栏「格式化」显式触发，见其 §3.4）、花括号纯展示折叠（严格对照 VS Code 编辑器：折叠后保留闭括号行、gutter 折叠箭头图标「已折叠常显 / 未折叠悬停才显」且标记列固定宽度不随悬停变化、⋯ 占位符可点击展开（覆盖层渲染，锚点取折叠起始行**行末之后一格**；覆盖层为「固定视口裁剪层 + 内容平移层」两面结构，裁剪层不得带滚动跟随 transform，见 `buildNutFoldMarkerAnchors`）、折叠态保留 textarea 且非折叠区照常可编辑、折叠仅隐藏视图而不改文本模型；箭头为自绘 SVG 图标、不内嵌第三方图标资源，见其 §3.5），验证脚本 `test/tw-nut-verify.mjs`）、`docs/pvfine-external-reference.md`（外部参考规则：pvfine 归档模型与脚本反编译格式化 / 层级缩进对照，仅作对照参考）。
- 网关管理协议对接：`docs/gateway-update-role.md`（CMD_UPDATE_ROLE 角色数据修改：proto 同步来源、optional 置位语义、前端前置关系校验与验证脚本；86 版本等级门槛 15 级转职 / 50 级一觉 / 75 级二觉为展示层约定，含等级与觉醒双向约束；物品发放页 `SendItemView.vue` 采用 header / side / main 三区布局——顶部通栏菜单、左侧查询账号角色、右侧功能卡片）。协议真源为同级网关仓库 `proto/gateway.proto`，本仓 `src/utils/gateway.proto` 为运行时副本，两者改动须同步。
- 职业枚举固化：`docs/pvf-job-grow-names.md`（86JPL `character.lst`/`.chr` 职业→转职→觉醒名单提取语义与快照登记；常量 `src/utils/jobGrowNames.js` 供展示层消费，5 转未定案分支不收录，`test/job-grow-enums.mjs` 为唯一验证脚本）。
- 标签提示与代码引用：`src/utils/pvfTags.js`（标签定义表 / 块标签集，社区注释回落层见 `src/utils/pvfTagComments.js`）；代码引用规则（「文件 × 标签 × 参数列 → lst 表」悬浮提示）由 `src/utils/pvfCodeRef.js` 解析与匹配，数据源 `src/utils/ItemCodeHoverConfig.xml` 为外部配置原样归档（`.prettierignore` 豁免 `*.xml`，更新时整文件替换），编辑器 `PvfEditor.vue` 悬浮标签时追加「代码引用」区块；规则语义与验证见 `docs/pvf-tag-code-ref-rules.md`（脚本 `test/tag-code-ref-verify.mjs`）与 `docs/pvf-tag-community-comments.md`（脚本 `test/tag-comment-verify.mjs`）。
- 前端性能设计：`docs/design-large-file-virtual-scroll.md`（大文件虚拟滚动方案）。

## 硬性规则

### 0. 基础协作约束

**协作语言与元规则**

- **思考过程必须使用中文**（内部推理、规划、总结均以中文进行）。
- 修复过程中若发现新的重要规则（格式约束、边界行为、权威语义等），**必须同步更新到本文件**，保证规则可被后续会话复用。

**工作流前置**

- 开始任何任务前，**必须先阅读 `docs/` 下相关文档和 `src/utils/` 核心实现**，再动手修改或编写测试；不得在未了解既有文档/实现的情况下直接改码（改码的完整硬性顺序见 §4）。
- 回归验证基线等本机路径文件（§2 清单中的 PVF 路径）找不到时，**必须先询问用户**确认实际位置，不得自行猜测或跳过验证。

**合规约束**

- **文档中不得出现现有网游或知名游戏（含其开发企业）的名称及其派生标识**（含文件名、目录名、文档正文；引用验证基线文件路径、历史对话记录时除外），一律以中性名称（如"台服文件"、"日服文件"）或本文档定义的技术称谓代替，避免侵权与敏感信息。**二进制格式魔数 / 签名 / 算法密钥常量等不可更改的技术标识**属格式事实，仅存在于源码与测试逻辑中；`docs/` 与本文件**不出现其字面内容**，以中性称谓（归档魔数 / IMG 魔数 / 加密视频签名等）描述并注明「字面值以源码为准」；文档引用源码 API 按功能描述，不写含企业名的标识符字面；**既有源码标识符**（函数 / 变量名等）**暂不强制改名**，新增标识符避免使用企业名；叙述性文本一律以中性表述代替，不在此列举示例。此约束适用于 `docs/` 下所有文档、AGENTS.md 自身、`test/` 下脚本（注释与输出文案），以及 **git 提交信息**（见「代码提交规范」）。
- **文档路径脱敏（门控）**：`docs/` 下文档与本文件中登记的本机文件路径（回归验证基线、参考项目等）一律以**相对路径**书写（如 `PVF/86JPL/Script.pvf`、`JP/S4A21GmTool`），不得保存含盘符或用户主目录的绝对路径；相对路径在本机无法定位时，按「工作流前置」流程询问用户确认实际位置。
- **测试脚本路径脱敏（门控）**：`test/` 下脚本不得出现含盘符或用户主目录的本机绝对路径（如 `C:/Users/Administrator/Desktop/...`、`/Users/<用户名>/...`）——默认目标、注释与输出落盘路径均在约束范围内；回归基线等本机文件一律以相对路径书写默认值（如 `PVF/86JP/Script.pvf`，基线根目录为运行时工作目录），实际位置不符时按「工作流前置」以命令行参数传入；输出落盘相对脚本自身目录解析（`import.meta.url`）。

### 1. #PVF_File 明文处理（所有类型解码通用）

- `#PVF_File` 开头标识 pvfUtility 导出的**明文文本**（ani / 脚本 / 其它类型）。**该前缀可能存在于文件开头，也可能没有**（如部分明文 ani 直接从 `[FRAME` 开头）：检测到 `#PVF_File` 前缀（或明文 ani 的 `[FRAME MAX]`）即**不解析**，按注释文本原样展示（不加 `//` 前缀）；未检测到则走正常二进制解析。
- 该规则必须应用到**所有类型的解码**上：解码路径统一拦截明文前缀并返回明文——`decodeContent` 在一切分发（stringtable / ani / token / lst / 普通文本）之前检测 `#PVF_File`；明文 ani 的 `[FRAME MAX]` 由 ani 层（`_twDecodeAni`）另检。
- 编码侧：`encodeContent` 对以 `#PVF_File` 开头的文本不做 token 化，按源文件格式（区域编码字节）原样写回。
- 实现与文档同步：此规则已记录在 `docs/pvf-tw-format.md` §9.3，改动时必须同步更新。

### 2. 测试脚本管理

- **每个修复项目只创建一个修复脚本**（`test/` 目录）；不同修复项目可有各自脚本，但禁止为同一修复反复新建探针/验证脚本，后续验证一律在既有脚本中追加或修改。
- 每个修复文档（docs 下对应 .md）必须明确列出该修复的**测试脚本位置与验证内容**（参考 `docs/pvf-tw-format.md` §12.3 的表格格式）。
- 测试脚本可直接加载 `src/utils/*.js`（Node 运行），必须注明运行方式与依赖的目标 PVF 路径。
- **验证入口**：本项目 `package.json` 仅有 `prettier format`，**无 lint / typecheck 脚本**；以 `test/` 脚本为唯一验证入口，不得以"无 lint"为由跳过自测。验证脚本无法运行时，询问用户验证命令并建议写入本文件。格式化豁免 `*.min.js`（第三方压缩库不格式化，见 `.prettierignore`）。
- **禁止端到端复现（门控）**：**不得以驱动运行中的应用来复现或验证问题**——含无头 / 有头浏览器（CDP、headless、Playwright 等）驱动界面、手工打开文件或界面目视比对截图、以及对应用运行时状态（DOM 尺寸 / 计算样式 / 滚动位置等）的现场取值。此类方式不作为缺陷定性依据，也不作为修复验证依据；**UI 与交互类缺陷的验证只能由 `test/` 脚本完成**——能抽成纯函数的逻辑一律抽到 `src/utils/*.js` 并做纯函数断言（如视口锚点换算、折叠视图映射），DOM / 样式 / 组件接线类不变式按既有惯例做**源码静态守卫断言**（读取组件源码核对选择器、属性绑定、样式规则与调用次序）。文档与提交信息不得登记端到端复现的过程、截图或运行时取值作为验证结果；临时诊断脚本一律不得进入仓库（`test/` 目录只放回归脚本）。
- **解析异常样本留存（PVF）**：解析中发现异常文件——异常信号包括解析失败、字段错位、乱码/U+FFFD、hex 回退、超大数值（如坐标 65535）、帧数 0 等非预期输出——时，必须把该文件的**原始二进制未解密文件流**自归档数据区原样切片落盘（禁止手工构造）。留存物为归档内原样存储字节——含容器加密层时保持**未解密**形态及 4 字节对齐完整区段，**不得解密、解码、重编码或净化等任何变换，不得以还原/解码后的版本替代留存**；测试脚本加载留存样本后按解析层同款算法现场还原再做展示层断言；存入 `test/` 下对应版本文件夹并保留归档内相对路径，如 `test/<版本>/stackable/xxx.stk`、`test/<版本>/equipment/xxx.eqp`；样本作为脱离完整归档的最小复现，修复脚本应优先加载留存样本断言，再跑 §2 清单全量回归验证。对应修复文档必须登记样本位置与复现要点；文档中引用样本路径按「文档路径脱敏（门控）」以相对形式书写。
- **样本一次性提取（门控）**：异常文件自归档**只提取一次**。落盘后，该问题的所有后续分析、定性、修复与回归一律以留存样本为输入，**禁止为同一问题反复解析原始 PVF 归档**（仅 §2 全量回归验证时才整体加载归档）；处理异常问题时只提取该问题相关的原始文件，不得顺带扫描或提取无关文件。需要对照文件（如同名其它语言版本）时，对照文件同样走一次性提取留存流程后再使用。
- **样本元数据登记（门控）**：留存落盘时必须在对应修复文档同步登记现场还原所需的最小元数据：解密校验值 checksum、dataSize / trueLen、归档内来源偏移。TW 格式的文件 checksum = `CreateBuffKey(明文数据, 文件名哈希)`（CRC32 变体），**无法由密文或文件名离线推导**（解密它又需要它自身），只能取自归档文件树条目——不登记则最小复现将永远依赖完整归档，违背留存初衷。
- **密文直析禁令（门控）**：留存样本为**未解密形态**，禁止未经现场还原（解析层同款算法 + 登记的 checksum）直接对样本做字节级/编码/文本定性分析；密文上得出的任何统计或编码结论均无效。先还原、再定性。示例（70TW 繁体）：解析 `event/event.kor.str` 出现乱码时——① 自 `PVF/70TW/Script.pvf` 提取原始未解密文件流存为 `test/70TW/event/event.kor.str`（仅此一次，checksum `0x47273696` 登记于 `docs/pvf-tw-format.md` §8.7）；② 加载留存样本并以登记 checksum 现场还原后做字节级验证定性：该文件制作时已损坏（**繁体 Big5 字节流被 UTF-8 解码器净化产生 U+FFFD**，非韩文 EUC-KR），U+FFFD 处原文不可逆丢失，属数据本体损坏、展示层无法真正修复，**不得修改项目源码**（见「未修复问题不动源码（门控）」与 `docs/pvf-tw-format.md` §8.7）；③ 将样本作为固定回归输入，`test/verify-authoritative-scan.mjs` 以其做「净化损坏 strlst」特征断言（不再依赖归档），定性与样本位置登记于同文档 §12.4。
- **回归验证文件**（固定基线，勿改动；仅本机回归用，CI 环境需另行配置）。路径按「文档路径脱敏（门控）」以相对形式书写，基线根目录各机器不同（定位失败时按「工作流前置」询问用户）：
    - `PVF/70TW/Script.pvf`（TW）
    - `PVF/86JP/Script.pvf`（JP）
    - `PVF/86JPL/Script.pvf`（JPL）
    - `PVF/86JPAG/Script.pvf`（JPAG）
    - `PVF/90CN/Script.pvf`（CN）
    - `PVF/90US/Script.pvf`（US）
    - 繁体默认加载 `PVF/70TW/Script.pvf`，其它版本以 `node test/<script>.mjs <pvf路径>` 传入。
    - NPK/AVI 回归样例：`sprite_common_etc.NPK`（IMG 基线归档，`test/npk-verify.mjs` 默认目标；本机实际位于基线根下 `NPK/JP/`，TW 样例在 `NPK/TW/`）、`sounds_char_creator.npk`（SoundPacks 音频包）、`creator.avi`（纯视频加密 AVI，V/W 组样例）、`ATFighterGrappler.avi`（带 MP2 音频加密 AVI，W6 组样例，后三项样例本机位置待确认）；清单与断言见 `docs/npk-format.md` §4。

### 3. 修复文档

- 修复完成后必须在对应文档（`docs/pvf-tw-format.md` 或相关修复文档）中记录：问题原因、解决方式、验证结果、测试脚本位置。
- 删除冗余测试脚本时同步更新文档中的脚本清单，保持一一对应。
- **新增的文档（修复、新实现的等相关说明）必须在 AGENTS.md 中登记**：创建新文档时同步在「项目概况」或对应章节补记文档路径与用途，保证文档清单可被后续会话直接发现；已有文档新增章节不在此限，但涉及新的解析层/格式规则时仍应更新 AGENTS.md。

### 4. 自测自检约束（先文档、后自测、再改码）

- **硬性顺序**：修改 `src/utils/*.js` 前必须先完成——① 更新修复文档（`docs/` 下对应 .md，写明问题/方案/预期输出格式）→ ② 重构/更新对应 `test/` 修复脚本使自测自检**成功通过** → ③ 才允许修改项目代码。顺序颠倒即视为违规。
- 修改 `src/utils/*.js` 后必须再次运行对应 `test/` 脚本做**全量验证**，以脚本断言输出确认无 FAIL、无回归。
- **修复验证完成后必须更新对应修复文档**（`docs/` 下 .md），记录问题原因、解决方式、验证结果、测试脚本位置；文档**不得过于口语化**（避免口头禅、随意语气，使用规范书面表述，条目化、可复核）。
- 发现 §2「解析异常样本留存」所列异常信号时，必须先做**字节级验证**（dump 原始字节对照权威格式逐字段核对），确认是文件真实数据还是解析错位；确认为真实数据后在修复文档中记录"已知数据特征（非解析错误）"，不得直接修改解析器。
- **未修复问题不动源码（门控）**：经字节级验证定性为**数据本体损坏、信息不可逆丢失或已知数据特征**（非解析错位）的问题，凡展示层无法使其真正恢复原貌的，**一律不得修改项目源码**——解析器、展示层、编码侧均在内。任何「检测损坏 -> 变换展示」「占位符替换」「净化输出」「跨文件对照补全」类处理都属于掩盖而非修复，禁止以此为由改动源码。此类问题保持既有解码与展示行为，仅在对应修复文档登记定性与验证结论；此前已实施的此类处理必须废弃还原。实例：`event/event.kor.str` 的「逆净化还原」展示已废弃还原，定性与实施经过见 §2「密文直析禁令」示例及 `docs/pvf-tw-format.md` §8.7。
- 关键样例文件（`docs/pvf-tw-format.md` §12.3 验证表中列出）的输出每次运行都要抽查，确认无回归。

## 代码提交规范

**不主动提交 git**；用户要求时才提交。用户要求提交时，按以下规范执行（遵循仓库既有 Conventional Commits 风格）：

- **格式**：`<type>(<scope>): <描述>`，描述使用中文，简洁陈述变更内容。同一笔提交可包含多个修改点，提交信息正文使用 Markdown 列表逐条列出。
- **type**：`feat`（新功能）/ `fix`（缺陷修复）/ `perf`（性能优化）/ `docs`（文档）/ `style`（样式/非逻辑调整）/ `refactor`（重构）/ `chore`（杂项，如依赖、配置）/ `test`（测试）。
- **scope**：按影响模块填写，如 `pvf`（PVF 解析/编码）、`items`（物品相关）、`gateway`（网关）、`plugin`（插件）、`readme`（README）、`ci`（CI）等；影响面广或无明确模块时可省略。
- 提交前必须 `git status` / `git diff` 确认只暂存本任务相关文件，不得混入无关改动；禁止提交密钥、本地路径（如 `D:\game\...`）等敏感信息。
- **提交信息合规（门控）**：提交信息（标题与正文）同样遵守「合规约束」——不得出现现有网游或知名游戏的名称，一律以中性名称或本文档定义的技术称谓表述；亦不得出现含盘符或用户主目录的本地路径。
- 一个任务一个提交；提交信息首行不超过 50 字符，必要时正文以 Markdown 列表分点说明修改内容（如 `- 修复 XX` / `- 调整 YY`）。
- **提交信息精简（门控）**：标题一行点明主题（类型 + 范围 + 一句话概述）；正文仅在存在非显而易见的动机或影响时保留少量要点，不逐文件罗列改动、不复述 diff。
- 提交前先运行相关 `test/` 脚本与 lint/类型检查确认通过（如适用）。
