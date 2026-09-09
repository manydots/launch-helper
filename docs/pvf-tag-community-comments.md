# PVF 标签社区注释（标签提示注释层）

## 1. 定位与来源

本文档登记 PVF 标签提示的「社区注释」数据层：为 `[xxx]` 标签提供社区维护的中文注释文本，作为标签浮窗提示的语义补充源。

- 来源为外部知识项目 `Agent-Workbench`（本机同级仓库 `../Agent-Workbench`）内置的社区标签注释，共 344 条（归一后 341 个唯一标签），其知识包以 CC0-1.0 公共领域许可发布（可自由复制、改造、再分发，无需署名）。许可文件 `LICENSE-KNOWLEDGE-CC0.md` 覆盖 `knowledge-pack/` 下全部内容。
- 原始数据形态为社区注释库行（`section` 标签名 / `comment` 注释文本 / `fileType` 数值），本项目提取规则见 §3.1。
- 该层为**展示层语义提示**，不参与解码 / 编码，不构成解析事实；与 `docs/pvf-tag-code-ref-rules.md` 的「代码引用规则」互补（一个回答「标签是什么含义」，一个回答「标签哪一列是代码引用」）。

## 2. 与既有标签定义的关系

- `src/utils/pvfTagComments.js` 条目**与 `PVF_TAGS` 相同格式**：`category`（固定 `community`）/ `description`（第一条注释）/ `remark`（其余注释以「；」连接，无则省略）/ `fileTypes`（社区库原始数值数组，仅存档不展示，含义未确证）。无 `params` / `example`。
- 两份数据在 `pvfTags.js` 内**合并为一张标签定义表**（导出名 `PVF_TAG_ENTRIES`）：社区条目为基座，人工维护的 `PVF_TAGS` 条目优先覆盖；人工条目命中社区同名标签时附带 `community` 字段（社区注释文本数组）并存展示。
- 解析方式**仅一条路径**：`getTagInfo` 按精确命中合并表 → 词边界模糊匹配合并表键 → 默认回落（`PVF_TAG_FALLBACK`）。社区数据不再作为独立回落层，不再做子串双向模糊匹配。

### 2.1 匹配缺陷修复记录（2026-09-09）

首版实现存在两处匹配缺陷，已修复并以测试固化：

| 缺陷 | 现象 | 修复 |
|---|---|---|
| 子串双向模糊匹配抢先于社区精确命中 | 341 个社区标签中 65 个被误拦截（如 hover `[skill data up]` 返回 `[skill]` 泛化定义、`[gift item]` 被 `if` 子串命中、`[magical]` 被 `[magical attack]` 反向命中），精确注释被掩盖 | 匹配顺序改为**精确优先**（合并表精确命中先于模糊匹配）；模糊匹配收紧为**词边界**判断（键作为独立词出现，`gift item` 不再被 `if` 子串命中） |
| 归一化不折叠连续空白 | `[skill  data up]`（双空格）归一后仍含双空格，与数据键（已折叠）不匹配，提示查询落空 | `parseTagName`（pvfTags.js）与标签名归一（pvfCodeRef.js）统一折叠连续空白为单空格 |

## 3. 落地实现

### 3.1 数据提取规则

- 提取自知识包内置标签事实的社区注释行，按归一标签名（去方括号、空白折叠、转小写）分组。
- 条目格式（与 `PVF_TAGS` 一致）：`category: "community"`；`description` 取第一条注释；其余注释去重后以「；」连接为 `remark`（无则省略）；`fileTypes` 保留社区库全部原始数值（与原始注释条数等长，仅存档）。
- 产物：`src/utils/pvfTagComments.js`（纯数据模块，双端可加载）。提取为一次性流程（临时脚本运行后即删，不留存于 `test/`）；更新数据时重跑提取流程替换该文件。
- 合规核查：提取前对注释文本做敏感词扫描（外部项目名称、网址、联系方式、HTML 控制字符），当前批次 0 命中、0 个 HTML 敏感字符；后续更新批次须复检。

### 3.2 集成点

- `src/utils/pvfTags.js`：
  - `PVF_TAG_CATEGORIES` 新增 `community`（社区注释）分类。
  - 合并表 `PVF_TAG_ENTRIES`（导出）：社区条目为基座、人工 `PVF_TAGS` 优先；人工条目命中社区同名标签时附加 `community` 字段（注释文本数组）。
  - `getTagInfo`：精确命中合并表 → 词边界模糊匹配（返回键定义，`block` 按实际查询标签判断）→ 默认回落。
  - `parseTagName`：追加连续空白折叠。
  - `renderTagTooltip`：浮窗结构为标题区（`.pvf-tip-head` 内标签名 + 分类徽标 + 块标签徽标同行）→ 描述 → 「社区注释」区块（`.pvf-tip-cmt` 逐条）→ 参数 → 示例 → 备注。纯社区条目以 `description` / `remark` 直接呈现（分类徽标即为「社区注释」），不重复渲染该区块。
  - **着色区分**：分类徽标按 `PVF_TAG_CATEGORIES` 类别着色（`cat-<category>` 修饰类，如 `cat-skill` / `cat-item` / `cat-community` 等，样式定义于 `PvfEditor.vue`）；说明文本区分来源——人工项目说明用正常文本色，社区说明（纯社区条目的 `description` / `remark` 与并存条目的「社区注释」区块）统一用注释绿（`.pvf-tip-desc-c` / `.pvf-tip-cmt`）。
- `src/utils/pvfCodeRef.js`：标签名归一追加连续空白折叠（代码引用匹配与注释层归一口径一致）。
- `src/components/PvfEditor.vue`：浮窗样式与布局见 `docs/pvf-tag-code-ref-rules.md` §3.3；标签高亮 `known` 标记判定为 `category !== "other"`（社区条目 `category` 为 `community`，自动视为已收录）。

## 4. 测试脚本与验证内容

测试脚本：`test/tag-comment-verify.mjs`（运行方式：`node test/tag-comment-verify.mjs`，无需 PVF 归档，纯数据层验证）。验证内容：

| 验证点 | 断言 |
|---|---|
| 数据完整性 | 341 个标签分组、条目为 `PVF_TAGS` 兼容格式（`category: "community"`、`description` 全非空）、`fileTypes` 总数 344（与原始注释条数等长） |
| 数据正确性 | 金样本条目断言（`attack box` / `on appear` 多注释 `remark` / `ai pattern` 重复注释去重无 `remark` / `level`）；分组键归一（小写、无方括号、无连续空白） |
| 统一解析 | 精确优先（社区标签不再被子串模糊拦截：`skill data up` / `gift item` / `item info` / `level info` 走社区注释）；词边界模糊（`item list` → `item` 定义）；双未命中维持回落；连续空格输入归一命中 |
| 合并与渲染 | 人工 `PVF_TAGS` 条目优先且并存 `community` 注释数组（如 `item`）；`renderTagTooltip` 渲染「社区注释」区块、纯社区条目以 `description` 呈现 |

## 5. 外部参考登记

- 参考项目：`Agent-Workbench`（知识包 CC0-1.0；`knowledge-pack/dictionaries/`、`knowledge-pack/indexes/` 下另有按领域组织的标签字段词典与路由索引，可作后续扩充「标签提示 / 字段语义」的内容源；其标签观察、registry 提示构建流程亦可作解析规则对照参考）。登记性质与 pvfine 相同：仅作对照参考，upstream 演进不自动生效。
- 已知拼写候选（源自其 registry 提示构建流程，与本仓代码引用规则数据同源）：外部配置中的 lst 名 `wown`（候选 `town`）、`tackable`（候选 `stackable`）。本仓**数据原样保留、不做静默改写**，仅在此登记现象；展示层照原文展示。

## 6. 变更记录

| 日期 | 来源版本 | 规模 | 说明 |
|---|---|---|---|
| 2026-09-09 | Agent-Workbench 内置社区标签注释（344 条） | 341 组 / 344 条 | 首次提取落地，敏感词扫描 0 命中；断言全部通过；Vite 生产构建验证通过 |
| 2026-09-09 | 同上 | 同上 | 条目格式重构为与 `PVF_TAGS` 一致（category/description/remark/fileTypes）；合并为单一标签定义表 `PVF_TAG_ENTRIES`，解析路径统一为精确 → 词边界模糊 → 回落；修复子串模糊匹配抢先拦截（65/341）与连续空白不归一两处缺陷 |
