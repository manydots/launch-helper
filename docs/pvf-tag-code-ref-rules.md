# PVF 标签代码引用规则（ItemCodeHoverConfig）

## 1. 定位与来源

本文档固化 PVF 脚本中「文件 × 标签 × 参数列 → lst 引用表」的代码引用规则：

- 规则回答的问题是——某类文件里某个标签块下的第 N 个参数，是一个**代码引用**（物品代码、怪物代码、副本代码、任务代码、技能代码等），悬浮提示时应当用**哪个（哪些）`.lst` 名称表**把代码解析成名称。
- 规则来源为外部代码智能提示配置，由用户权威提供（本机参考路径 `PVF/Options/ItemCodeHoverConfig.xml`，按文档路径脱敏门控以相对形式书写）。该配置在本项目中**原样归档**为数据源：`src/utils/ItemCodeHoverConfig.xml`，后续配置更新直接整文件替换，不改代码。
- 该规则属于**展示层增强**（悬浮提示），不参与解码 / 编码语义；解码层与既有行为不变。

## 2. 配置字段语义

XML 顶层为 `<root>`，其下按 `<File>` 分组。以下字段语义为本项目固化定义（配置文件内注释已省略，以本节为准）：

| XML 节点 / 属性 | 语义 |
|---|---|
| `<File FileName="...">` | 规则作用文件。`*.xxx` 表示该扩展名的所有文件；具体路径（如 `etc/newcashshop.etc`）表示仅该文件。匹配对归档内文件路径进行，大小写不敏感 |
| `<Section SectionName="[xxx]">` | 作用标签名（含方括号书写）。`SectionName=""` 表示**任意标签**均生效 |
| `Index="0,1"` | 参数列索引，**0 起**计数，指标签块后的第 n 个参数。逗号分隔多个；属性缺省表示不限定列（整标签生效） |
| `LstFileName="a,b"` | 代码应查询的 lst 表名（如 `stackable`、`equipment`、`monster`、`skill/swordman`），逗号分隔多个 |
| `Description="..."` | 说明文案，原样保留配置文字（含问号、备注语气，不做净化改写） |
| `ParentSectionName="[yyy]"` | 限定条件：该标签须位于指定父标签块内 |
| `IgnoreItemCode="0,1"` | 忽略的代码值列表，命中不提示 |
| `<SectionGroup SectionName="[xxx]">` + 子 `<Index Value="n">` | 同一标签内**不同列映射不同 lst**：每个子 `Index Value` 即列号，各自携带 `LstFileName` / `Description` / `IgnoreItemCode` |
| `<SectionRange SectionName="[xxx]" StartIndex="n">` | 自第 n 列**起的所有列**同映射 |
| `<ValidationSection Name="[x]" Value="..." Index="n" CurrentLine="True">` | 生效条件：`Name` 为须验证的标签名（空串表示验证**当前行**）；`Value` 为期望参数值（反引号字符串或数字，原样保存）；`Index` 为被验证标签的参数列（缺省不限定）；`CurrentLine="True"` 表示验证对象与引用列同处一行，否则为所属上下文中的独立标签块 |

`ValidationSection` 可出现在 `<Section>` 与 `<SectionGroup>` 之下，同一规则可带多条验证条件（全部满足才生效，匹配层不执行判定，仅随规则展示）。

## 3. 落地实现

### 3.1 数据源

- `src/utils/ItemCodeHoverConfig.xml`：来源配置原样归档（字节级一致，不重排、不改写；`.prettierignore` 豁免 `*.xml` 以保证不被格式化）。Vite 下经 `?raw` 动态导入后由解析层解析（构建产物为独立 chunk）；Node 测试脚本直接读文件后调用 `configureCodeRef` 注入。
- 配置更新流程：整文件替换该 XML → 运行 `test/tag-code-ref-verify.mjs`（§5）→ 测试内固化计数断言如因规则增减失败，按新配置更新断言基数并同步本档 §6 变更记录。
- 数据源内含外部配置的 lst 拼写现象（如 `*.mm` 城镇规则的 `wown`，候选 `town`）：数据原样保留、不做静默改写，登记见 `docs/pvf-tag-community-comments.md` §5。

### 3.2 解析层 `src/utils/pvfCodeRef.js`

轻量解析器不依赖 DOM（Node 与浏览器通用），仅识别本配置用到的固定节点集合（`root` / `File` / `Section` / `SectionGroup` / `Index` / `ValidationSection`），忽略声明与注释。解析结果规则模型：

```
{
  file: "*.equ",                 // 原样文件模式
  tag: "skill data up",          // 标签名，去方括号转小写；空串 = 任意标签
  indexes: [1],                  // 生效列；[] = 不限定列
  rangeStart: null,              // SectionRange：自该列起全部生效；普通规则为 null
  group: null | [                // SectionGroup 的列映射；普通规则为 null
    { index: 0, lst: [...], description, ignoreCodes: [...] }
  ],
  lst: [...],                    // lst 表（SectionGroup 规则此处为空）
  description: "...",            // Description 原文
  parentTag: null | "yyy",       // ParentSectionName（小写）
  ignoreCodes: [65535],          // IgnoreItemCode 数值数组
  validations: [                 // ValidationSection 列表
    { tag: "", index: 0, value: "`[swordman]`", currentLine: true }
  ]
}
```

- 标签名统一**去方括号、转小写**后存储（`[skill data up]` → `"skill data up"`）；`LstFileName` 按逗号切分为数组、保留原文大小写。
- 模块加载即解析并构建索引：`byTag: Map<tag, 规则[]>`（`tag=""` 的任意标签规则单独归入 `anyTag` 数组）。

### 3.3 匹配 API 与悬浮渲染

- `matchCodeRefRules(fileName, tagName)`：返回文件模式匹配且标签名匹配的全部规则（含任意标签规则）。**不执行**父标签 / 验证条件的上下文判定——悬浮场景没有完整块结构上下文，候选规则连同其条件一并展示，由阅读者自行甄别。
- `renderCodeRefTipHtml(fileName, tagName)`：返回可嵌入现有标签浮窗的 HTML 片段（复用 `pvfTags.js` 浮窗样式类）；无命中规则返回空串。展示内容：
  - 整个片段包裹于 `.pvf-tip-refs` 区块容器（与标签说明部分形成视觉分区）。
  - 按文件模式分组，每组以 `.pvf-tip-section` 小标题展示（如 `代码引用（*.qst）`）。
  - 每条规则一行：`列 n → a.lst | b.lst — 说明`；不限定列写作「全部列」；SectionRange 写作「列 n 起」；SectionGroup 按列逐行展开。
  - 条件修饰以 `.pvf-tip-cond` 行紧随其规则行（`位于 [xxx] 内`、`当 [xxx] 值为 ...`、`忽略 0,1`），间距紧凑。
  - 文件模式展示于区块标题（如 `代码引用 · *.qst`）。
- **截断规则**：同一浮窗内规则行（含 SectionGroup 展开行）超过 10 条时只展示前 10 条，末尾以 `.pvf-tip-more` 计数行提示「⋯ 另有 N 条引用规则」；展示顺序与配置出现顺序一致（精确标签规则先于任意标签规则）。
- 浮窗整体限高（CSS `max-height`，超出部分隐藏不滚动——浮窗为 `pointer-events: none` 无滚动交互）。

### 3.4 编辑器集成（`src/components/PvfEditor.vue`）

- PVF 编辑器悬浮已有标签说明浮窗（`renderTagTooltip`）。集成方式：悬浮命中的行仍为 `[xxx]` 独占一行标签时，以 `currentFile.name` 与标签名调用 `renderCodeRefTipHtml`，将返回片段**追加**到既有浮窗 HTML 末尾；无命中则浮窗保持原状。
- **浮窗样式作用域约束**：`PvfEditor.vue` 的浮窗内容经 `v-html` 注入（不带 Vue scoped 的 `data-v` 属性），浮窗全部样式（`.pvf-tooltip` / `.pvf-tip-*` / `.pvf-fold-preview`）必须位于文件末尾**非 scoped** 的 `<style>` 块中（类名全局唯一，无泄漏风险）；放入 scoped 块的浮窗样式对 v-html 内容不生效（此问题已于 2026-09-09 修复——此前浮窗内部样式整体未生效，仅容器外观生效）。
- 浮窗整体限高 `min(70vh, 520px)`，`positionTooltip` 贴近视口底部时上移避免溢出。
- 集成不影响折叠预览浮窗与 `.lst` 引用跳转等既有行为。

## 4. 与既有标签定义的关系

- `src/utils/pvfTags.js` 的 `PVF_TAGS` 回答「标签本身是什么含义」；本文档规则回答「标签下哪一列参数是代码引用、该查哪张 lst 表」。两者互补，互不替代。
- `PVF_BLOCK_TAGS`（块标签集）、`getTagInfo`、`parseTagName` 等既有逻辑不改。

## 5. 测试脚本与验证内容

测试脚本：`test/tag-code-ref-verify.mjs`（运行方式：`node test/tag-code-ref-verify.mjs`，无需 PVF 归档，纯数据层验证）。验证内容：

| 验证点 | 断言 |
|---|---|
| 数据源完整性 | XML 文件存在、解析无异常，`File` 分组数与规则总数达固化管理值（见 §6） |
| 解析正确性 | 抽取代表性规则逐字段断言：通配文件 / 精确文件 / 普通列 / 多列 / SectionGroup / SectionRange / IgnoreItemCode / 父标签限定 / 验证条件（字符串值与数字值、CurrentLine）/ 空标签名规则 |
| 匹配 API | 通配命中、精确路径命中（大小写不敏感）、任意标签规则命中、跨类型不命中 |
| 悬浮渲染 | 命中规则输出含列号、lst 表、说明、条件文案；无命中返回空串 |

## 6. 变更记录

| 日期 | 来源版本 | 规模（File 分组 / 规则总数 / 列映射子项 / 验证条件 / SectionRange） | 说明 |
|---|---|---|---|
| 2026-09-09 | `PVF/Options/ItemCodeHoverConfig.xml`（59,594 字节，2025-12-03 版） | 72 / 410 / 57 / 57 / 2 | 首次登记，规则全量落地；`test/tag-code-ref-verify.mjs` 33 项断言全部通过；Vite 生产构建验证通过（XML 以 `?raw` 动态导入成独立 chunk，源文件字节级一致） |

规则总数口径：`Section` + `SectionGroup` + `SectionRange` 节点数之和（380 + 28 + 2 = 410）。
