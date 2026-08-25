# 设计文档：大文件全量浏览（虚拟滚动）

- 状态：已确认（方案 A）
- 涉及文件：`src/components/PvfEditor.vue`
- 背景：`Script.pvf` 内存在数万行级文件（如 `stackable/stackable.lst` 约 34,809 行），当前仅只读预览前 2,000 行。

## 1. 背景与问题

`PvfEditor.vue` 的文本编辑器基于「textarea + 高亮层 + 行号 gutter」叠加实现，高亮、校验、渲染均为 `O(行数)` 且非虚拟化。为避免卡死，超过 `LARGE_FILE_CHAR_LIMIT`（500,000 字符）的文件进入只读预览分支，仅渲染前 `LARGE_FILE_PREVIEW_LINES`（2,000）行，无法浏览完整内容。

用户诉求：大文件（如 `stackable/stackable.lst`）可查看全量内容。

## 2. 需求

1. 大文件可浏览全部行（含行号），支持纵向/横向滚动。
2. 滚动流畅，10 万行级文件不掉帧、不卡死界面。
3. 保留现有能力：语法高亮、`.lst` 反引号引用路径点击跳转、行号灰色名称。
4. 大文件仍保持只读，不进入可编辑模式（textarea 渲染数万行会卡死）。
5. 切换/重新加载文件时状态完全重置。

## 3. 方案对比与选型

| 方案 | 说明 | 结论 |
|---|---|---|
| A 虚拟滚动 | 只渲染可视区 ± 缓冲行的 DOM，行号固定列 | 采用 |
| B 分页浏览 | 每页 N 行 + 上/下页/页码跳转 | 滚动不连续，体验差 |
| C 提高预览上限 | 预览行数 2000 → 10000 | 治标不治本 |

采用方案 A：仅渲染视口内的行，任意大文件 DOM 行数恒定（≈ 可视行数 + 缓冲），滚动开销与总行数无关。

## 4. 设计细节

### 4.1 入口与状态切换

- 大文件 banner 增加「加载全部内容」按钮；进入全量视图后变为「已加载全部内容 · 收起为预览」。
- 全量视图为**只读**，不加载 textarea / 不进入高亮-编辑链路。

### 4.2 数据来源（零二次解码）

`loadFileContent` 的大文件分支中，全量解码文本 `text` 已经生成（仅展示被截断），直接保存行数组：

```js
this.largeFullLines = lines; // text.split("\n")
```

「加载全部」按钮直接复用该数组；仅当数组为空（异常场景）才重新解码。

### 4.3 滚动模型（固定行高）

- 常量：`LARGE_VIRTUAL_LINE_H = 20`（px，与 CSS 行高一致）、`LARGE_VIRTUAL_BUFFER = 20`。
- 内容区为滚动容器（`overflow: auto`），内部放一个高度 = `行数 × 行高` 的 spacer 撑出滚动条。
- 可见行 `absolute` 定位，`top = (no - 1) × 行高`。
- 行号 gutter 为左侧固定列（`overflow: hidden`，横向滚动不跟随），纵向滚动时整体 `translateY(-scrollTop)` 同步。

### 4.4 可见行计算

```js
start = max(0, floor(scrollTop / LINE_H) - BUFFER)
end   = min(total, ceil((scrollTop + viewHeight) / LINE_H) + BUFFER)
```

可视区高度通过 `ResizeObserver` 观察滚动容器获取，编辑器拖拽调高/调低时自动刷新。

### 4.5 行级高亮与缓存

- 对可见行逐行执行 `hljs.highlight(line, { language: mode })`，再依次套用 `annotateTagSpans` → `grayLstNames`（仅 `.lst`）→ `annotateRefs`（仅 `.lst`，注入 `data-ref`）。
- 按行号 LRU 缓存渲染结果（上限 6,000 行），滚动回看秒开，且控制内存膨胀。
- 若某行内容变化（本视图只读，不会发生），缓存按需清空。

### 4.6 交互

- 反引号引用路径行内点击继续复用 `onHlClick` 实现文件跳转。
- 行号列 `user-select: none`。

### 4.7 内容搜索（支持 name 映射中文）

- 全量视图时，banner 与滚动区之间显示搜索工具条（输入框 + 上/下一个按钮 + 命中计数 + 清除）。
- 输入防抖 300ms 后执行搜索，不阻塞滚动与高亮；加载名称映射时计数区显示「加载名称映射...」。
- 匹配规则：
  1. 对每行原始文本做大小写不敏感子串匹配；
  2. 未命中时，用字符串表 `name_数字 → 中文名称` 映射替换行内 token 后再匹配（如搜「金锭」命中 `name_97`）。
- 结果存 `largeSearchMatches`（0-based 行索引数组），`largeSearchIndex` 指向当前项；Enter/Shift+Enter 或 ↑/↓ 切换。
- 跳转：`scrollTop = 行索引×行高 - 视口高/2 + 行高/2`，将当前行滚到视口中央；当前行行号与整行背景高亮（`current` 类），行内搜索词注入 `<mark>`。
- 状态清理：收起为预览、切换/重新加载文件、组件卸载时清空搜索词/结果/定时器。

### 4.8 生命周期与重置

`loadFileContent` 重置（含切换文件/重新加载）时清空：

```js
largeFullLines = []
largeFullView = false
largeFullLoading = false
largeScrollTop = 0
largeViewHeight = 0
largeRowCache.clear()
clearLargeSearch()
```

## 5. 性能与内存

- DOM：任意大文件仅 ≈（视口行数 + 2 × 缓冲）个节点。
- 内存：全量行数组（数 MB，34,809 行规模）+ 行高亮缓存（上限 6,000 条）。
- 滚动：每次滚动仅重渲染/重高亮 ~40 行，并命中缓存。

## 6. 边界与限制

- 固定行高假设等宽字体每行高度恒定；若未来更换非等宽字体或可变行高，需改为测量式布局。
- 全量视图只读；编辑大文件仍需右键「导出原始字节」后外部处理。
- 超过 100 万行仍允许加载（DOM 恒定），仅内存随行数增长。

## 7. 实施清单

- [x] 新增常量 `LARGE_VIRTUAL_LINE_H` / `LARGE_VIRTUAL_BUFFER` 与 data 状态
- [x] `loadFileContent`：大文件分支保存 `largeFullLines`；切换时重置虚拟状态
- [x] 新增方法 `loadLargeFileFull` / `exitLargeFileFull` / `onLargeScroll` / `_largeRowHtml` 与 computed `largeVisibleRows`
- [x] 模板重构大文件区（banner + 按钮 + 预览/虚拟滚动双视图）
- [x] 新增虚拟滚动 CSS（固定行高、gutter 固定列）
- [x] 搜索工具条：防抖搜索 + name 映射中文命中 + 上/下一个跳转 + 计数 + 清除
- [x] 当前匹配行高亮（行号/整行背景 + 行内 `<mark>`），搜索状态随收起/切文件/卸载清理
- [x] 构建验证
