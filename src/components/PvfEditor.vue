<script>
import hljs from "highlight.js/lib/core";
import { PvfArchive, formatBytes, buildFileTree, bytesToHex } from "@/utils/pvfTool";
import { registerPvfLanguage } from "@/utils/pvfHighlight";
import { getTagInfo, parseTagName, renderTagTooltip } from "@/utils/pvfTags";
import { validatePvfText } from "@/utils/pvfValidator";
import { alertModal, confirmModal } from "@/hooks/useModal";

registerPvfLanguage(hljs);

const ENCODINGS = [
    { value: "utf-8", label: "UTF-8" },
    { value: "gbk", label: "GBK (简体中文)" },
    { value: "big5", label: "Big5 (繁體中文)" },
    { value: "euc-kr", label: "EUC-KR (韩文)" }
];

export default {
    name: "PvfEditor",
    beforeRouteLeave(to, from, next) {
        if (this.archive && this.hasChanges) {
            const total = this.modifiedCount + this.deletedCount + this.renamedCount;
            confirmModal({ title: "确认离开", message: `有 ${total} 项未保存的修改，确认离开编辑器？` }).then(ok => {
                if (ok) next();
                else next(false);
            });
        } else {
            next();
        }
    },
    data() {
        return {
            archive: null,
            fileName: "",
            loading: false,
            loadingMessage: "",
            searchQuery: "",
            currentFile: null,
            editText: "",
            originalText: "",
            hexViewText: "",
            viewMode: "text",
            isStaging: false,
            saving: false,
            saveProgress: 0,
            saveProgressText: "",
            scrollTop: 0,
            containerHeight: 0,
            selectedPath: "",
            expandedPaths: new Set(),
            contextMenu: { show: false, x: 0, y: 0, node: null },
            importTarget: null,
            strEncoding: "utf-8",
            textDirty: false,
            highlightedHtml: "",
            highlightTimer: null,
            refreshKey: 0,
            rowHeight: 24,
            ENCODINGS,
            tooltip: { show: false, x: 0, y: 0, html: "" },
            validationErrors: [],
            validationVisible: false,
            logs: [],
            sidebarWidth: 280,
            logHeight: 160,
            drag: null
        };
    },
    computed: {
        isCurrentModified() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileModified(this.currentFile.index);
        },
        isCurrentDeleted() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileDeleted(this.currentFile.index);
        },
        isCurrentRenamed() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileRenamed(this.currentFile.index);
        },
        modifiedCount() {
            return this.archive ? this.archive.modifiedCount : 0;
        },
        deletedCount() {
            return this.archive ? this.archive.deletedCount : 0;
        },
        renamedCount() {
            return this.archive ? this.archive.renamedCount : 0;
        },
        hasChanges() {
            return this.archive ? this.archive.hasChanges : false;
        },
        headerStats() {
            if (!this.archive || !this.archive.header) return null;
            const h = this.archive.header;
            const totalOrig = this.archive.groups.length > 0 ? this.archive.groups[this.archive.groups.length - 1].originalSize : 0;
            return {
                fileCount: h.fileCount,
                groupCount: h.groupCount,
                bodySize: formatBytes(h.bodySize),
                totalOrig: formatBytes(totalOrig)
            };
        },
        isEditable() {
            return this.currentFile && (this.currentFile.dataType === 1 || this.currentFile.dataType === 3);
        },
        highlightMode() {
            if (!this.currentFile) return "pvf";
            return this.currentFile.dataType === 1 ? "pvf" : "plaintext";
        },
        dataTypeLabel() {
            if (!this.currentFile) return "";
            const t = this.currentFile.dataType;
            if (t === 1) return "脚本";
            if (t === 3) return "文本";
            return "二进制";
        },
        editLines() {
            return this.editText ? this.editText.split("\n") : [];
        },
        fileTree() {
            this.refreshKey;
            if (!this.archive) return null;
            const files = this.archive.files.filter(f => !this.archive.isFileDeleted(f.index));
            return buildFileTree(files);
        },
        isSearching() {
            return this.searchQuery.toLowerCase().trim().length > 0;
        },
        visibleNodes() {
            const tree = this.fileTree;
            if (!tree) return [];
            const result = [];
            const searching = this.isSearching;
            const expanded = this.expandedPaths;
            function walk(node, depth) {
                for (const child of node.children) {
                    result.push({ node: child, depth });
                    if (child.isDir && (searching || expanded.has(child.path))) {
                        walk(child, depth + 1);
                    }
                }
            }
            walk(tree, 0);
            return result;
        },
        renderWindow() {
            const items = this.visibleNodes;
            const start = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - 8);
            const end = Math.min(items.length, start + Math.ceil(this.containerHeight / this.rowHeight) + 16);
            return {
                start,
                end,
                items: items.slice(start, end),
                total: items.length
            };
        },
        visibleFileCount() {
            if (!this.archive) return 0;
            return this.archive.files.filter(f => !this.archive.isFileDeleted(f.index)).length;
        },
        hasSyntaxErrors() {
            return this.validationErrors.length > 0;
        },
        syntaxSummary() {
            if (this.validationErrors.length === 0) return "语法检查通过";
            return `语法错误 ${this.validationErrors.length} 处`;
        }
    },
    watch: {
        editText() {
            this.textDirty = true;
            this.scheduleHighlight();
            this.scheduleValidation();
        },
        currentFile() {
            this.textDirty = false;
            this.validationErrors = [];
            this.validationVisible = false;
        }
    },
    mounted() {
        window.addEventListener("keydown", this.onWindowKeydown);
        window.addEventListener("resize", this.onWindowResize);
        window.addEventListener("click", this.hideContextMenu);
    },
    beforeUnmount() {
        window.removeEventListener("keydown", this.onWindowKeydown);
        window.removeEventListener("resize", this.onWindowResize);
        window.removeEventListener("click", this.hideContextMenu);
        document.removeEventListener("mousemove", this.onDragMove);
        document.removeEventListener("mouseup", this.onDragEnd);
        if (this.highlightTimer) clearTimeout(this.highlightTimer);
        if (this.validationTimer) clearTimeout(this.validationTimer);
        this.archive = null;
    },
    methods: {
        formatBytes,
        // ---- File loading ----
        handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) this.loadPvf(file);
            event.target.value = "";
        },
        async loadPvf(file) {
            this.loading = true;
            this.loadingMessage = "读取文件中...";
            try {
                const buffer = await file.arrayBuffer();
                this.loadingMessage = "正在解析中...";
                const arch = new PvfArchive(buffer);
                await arch.parse();
                this.archive = arch;
                this.fileName = file.name;
                // Use auto-detected encoding from archive
                this.strEncoding = arch.strEncoding;
                this.expandedPaths.clear();
                this.selectedPath = "";
                this.currentFile = null;
                this.editText = "";
                this.originalText = "";
                this.hexViewText = "";
                this.textDirty = false;
                this.loading = false;
                this.$nextTick(() => this.updateContainerHeight());
                this.addLog(`加载 ${file.name} 成功：${arch.header.fileCount} 文件，${arch.header.groupCount} 分块`, "success");
            } catch (err) {
                this.loading = false;
                console.warn("PVF load failed:", err);
                const msg = err && err.message ? err.message : "未知错误，请确认选择的是有效的 Script.pvf 文件。";
                this.addLog(`加载失败：${msg}`, "error");
                alertModal({ title: "PVF 文件错误", message: msg });
            }
        },
        updateContainerHeight() {
            if (this.$refs.listEl) this.containerHeight = this.$refs.listEl.clientHeight;
        },
        onListScroll() {
            this.scrollTop = this.$refs.listEl ? this.$refs.listEl.scrollTop : 0;
        },
        // ---- Tree interactions ----
        toggleFolder(node) {
            if (this.expandedPaths.has(node.path)) {
                this.expandedPaths.delete(node.path);
            } else {
                this.expandedPaths.add(node.path);
            }
        },
        onNodeClick(node) {
            this.selectedPath = node.path;
            if (node.isDir) {
                this.toggleFolder(node);
            } else {
                this.switchToFile(node.file);
            }
        },
        switchToFile(file) {
            // Deferred check: compare only when switching
            if (this.textDirty && this.editText !== this.originalText && this.isEditable) {
                confirmModal({
                    title: "未保存的修改",
                    message: `当前文件有未保存的修改，是否保存后切换？`,
                    confirmText: "保存并切换",
                    cancelText: "丢弃修改"
                }).then(ok => {
                    if (ok) {
                        this.stageChange().then(() => this.loadFileContent(file));
                    } else {
                        this.loadFileContent(file);
                    }
                });
            } else {
                this.loadFileContent(file);
            }
        },
        onNodeContext(e, node) {
            e.preventDefault();
            e.stopPropagation();
            this.contextMenu.show = true;
            this.contextMenu.x = e.clientX;
            this.contextMenu.y = e.clientY;
            this.contextMenu.node = node;
        },
        hideContextMenu() {
            this.contextMenu.show = false;
            this.contextMenu.node = null;
        },
        // ---- File content loading ----
        async loadFileContent(file) {
            this.currentFile = file;
            this.editText = "";
            this.originalText = "";
            this.hexViewText = "";
            this.viewMode = "text";
            this.highlightedHtml = "";
            this.textDirty = false;

            if (file.isDir) {
                this.originalText = "[目录标记]";
                this.editText = "[目录标记]";
                return;
            }

            this.loading = true;
            this.loadingMessage = "加载文件内容...";
            try {
                const data = await this.archive.getFileData(file);
                if (!data) {
                    this.originalText = "[无法读取文件数据]";
                    this.editText = this.originalText;
                    this.loading = false;
                    return;
                }
                const text = this.archive.decodeContent(file, data);
                this.originalText = text;
                this.editText = text;
                this.hexViewText = bytesToHex(data);
                this.loading = false;
                this.$nextTick(() => {
                    if (this.$refs.editorEl) this.$refs.editorEl.scrollTop = 0;
                    this.syncScroll();
                    this.updateHighlight();
                    this.runValidation();
                    this.validationVisible = false;
                });
            } catch (err) {
                this.loading = false;
                alertModal({ title: "加载失败", message: err.message });
            }
        },
        // ---- Editing ----
        async stageChange() {
            if (!this.currentFile || !this.textDirty) return;
            if (this.currentFile.isDir || (this.currentFile.dataType !== 1 && this.currentFile.dataType !== 3)) {
                alertModal({ title: "无法编辑", message: "仅支持编辑 Type 1 (脚本) 和 Type 3 (文本) 文件。" });
                return;
            }
            // 语法检查：脚本文件不通过则禁止保存
            if (this.highlightMode === "pvf" && !this.ensureValid("保存")) return;

            this.isStaging = true;
            await new Promise(r => setTimeout(r, 50));

            try {
                this.archive.setFileContent(this.currentFile.index, this.editText);
                this.originalText = this.editText;
                this.textDirty = false;
                const data = await this.archive.getFileData(this.currentFile);
                this.hexViewText = bytesToHex(data);
            } catch (err) {
                alertModal({ title: "编码失败", message: err.message });
            }
            this.isStaging = false;
        },
        revertCurrent() {
            if (!this.currentFile || (!this.isCurrentModified && !this.isCurrentDeleted && !this.archive.isFileRenamed(this.currentFile.index))) return;
            confirmModal({ title: "撤销修改", message: `确认撤销 <code>${this.currentFile.fullpath}</code> 的修改？` }).then(ok => {
                if (ok) {
                    const idx = this.currentFile.index;
                    this.archive.revertFile(idx);
                    // Reload from archive
                    const file = this.archive.files[idx];
                    this.loadFileContent(file);
                    this.refreshKey++;
                }
            });
        },
        revertAll() {
            if (!this.archive || !this.hasChanges) return;
            const total = this.modifiedCount + this.deletedCount + this.renamedCount;
            confirmModal({ title: "撤销全部修改", message: `确认撤销全部 ${total} 项修改？` }).then(ok => {
                if (ok) {
                    this.archive.revertAll();
                    this.strEncoding = this.archive.strEncoding;
                    this.refreshKey++;
                    if (this.currentFile) {
                        this.loadFileContent(this.archive.files[this.currentFile.index]);
                    }
                }
            });
        },
        // ---- Delete ----
        deleteNode(node) {
            if (!node) return;
            if (node.isDir) {
                const files = this.archive.files.filter(f => !this.archive.isFileDeleted(f.index) && f.fullpath.startsWith(node.path + "/"));
                if (files.length === 0) {
                    alertModal({ title: "无法删除", message: "该目录为空。" });
                    return;
                }
                confirmModal({ title: "删除目录", message: `确认删除目录 <code>${node.path}</code> 及其下 ${files.length} 个文件？` }).then(ok => {
                    if (ok) {
                        files.forEach(f => this.archive.deleteFile(f.index));
                        if (this.currentFile && files.some(f => f.index === this.currentFile.index)) {
                            this.currentFile = null;
                            this.editText = "";
                            this.originalText = "";
                        }
                        this.refreshKey++;
                    }
                });
            } else {
                confirmModal({
                    title: "删除文件",
                    message: `确认删除 <code>${node.file.fullpath}</code>？<br/><span style="font-size:0.75rem;color:var(--text-muted)">删除后可在保存时生效，撤销全部修改可恢复。</span>`
                }).then(ok => {
                    if (ok) {
                        this.archive.deleteFile(node.file.index);
                        if (this.currentFile && this.currentFile.index === node.file.index) {
                            this.currentFile = null;
                            this.editText = "";
                            this.originalText = "";
                            this.hexViewText = "";
                        }
                        this.refreshKey++;
                    }
                });
            }
        },
        // ---- Rename with full reference checking ----
        async renameNode(node) {
            if (!node) return;
            const isFolder = node.isDir;
            const oldName = isFolder ? node.name : node.file.name;
            const newName = window.prompt(`重命名${isFolder ? "目录" : "文件"} "${oldName}" 为:`, oldName);
            if (!newName || newName === oldName) return;

            this.loading = true;
            this.loadingMessage = "重命名并检查引用中...";
            try {
                let renameMappings = [];

                if (isFolder) {
                    const result = this.archive.renameFolder(node.path, newName);
                    renameMappings = result.mappings;
                } else {
                    const fileIndex = node.file.index;
                    const result = this.archive.renameFile(fileIndex, newName);
                    renameMappings = [{ old: result.oldFullpath, new: result.newFullpath }];
                }

                // Build thorough search mappings (with and without extension)
                const searchMappings = this.archive.buildPathMappings(renameMappings);
                const searchPaths = searchMappings.map(m => m.old);

                // Full reference search across all files
                const refs = await this.archive.findReferencesMulti(searchPaths);

                let fixedCount = 0;
                if (refs.length > 0) {
                    const proceed = await confirmModal({
                        title: "发现引用",
                        message: `在 ${refs.length} 个文件中发现 ${searchPaths.length} 个路径的引用，是否全量修复这些引用？`,
                        confirmText: "全量修复",
                        cancelText: "仅重命名"
                    });
                    if (proceed) {
                        fixedCount = await this.archive.fixReferences(searchMappings, refs);
                    }
                }

                this.loading = false;
                this.refreshKey++;

                // Reload current file if it was affected
                if (this.currentFile) {
                    const affected = renameMappings.some(m => m.old === this.currentFile.fullpath);
                    if (affected) {
                        this.currentFile = this.archive.files[this.currentFile.index];
                    }
                }

                const msg =
                    `已重命名${isFolder ? "目录" : "文件"}为 <code>${newName}</code>。` +
                    (isFolder ? ` 影响 ${renameMappings.length} 个文件。` : "") +
                    (refs.length > 0 ? ` 引用修复: ${fixedCount}/${refs.length}` : " 无外部引用");
                alertModal({ title: "重命名完成", message: msg });
            } catch (err) {
                this.loading = false;
                alertModal({ title: "重命名失败", message: err.message });
            }
        },
        // ---- Export ----
        async exportNode(node) {
            if (!node || node.isDir) {
                alertModal({ title: "无法导出", message: "暂不支持导出整个目录。" });
                return;
            }
            this.loading = true;
            this.loadingMessage = "导出文件中...";
            try {
                const result = await this.archive.exportFile(node.file);
                if (!result) {
                    alertModal({ title: "导出失败", message: "无法读取文件数据。" });
                    this.loading = false;
                    return;
                }
                const url = URL.createObjectURL(result.blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.loading = false;
            } catch (err) {
                this.loading = false;
                alertModal({ title: "导出失败", message: err.message });
            }
        },
        // ---- Import ----
        triggerImport(node) {
            if (!node || node.isDir) {
                alertModal({ title: "无法导入", message: "请选择一个文件进行导入替换。" });
                return;
            }
            if (node.file.dataType !== 1 && node.file.dataType !== 3) {
                confirmModal({
                    title: "导入二进制文件",
                    message: `将以原始字节替换 <code>${node.file.fullpath}</code> 的内容，确认继续？`
                }).then(ok => {
                    if (ok) {
                        this.importTarget = { kind: "binary", fileIndex: node.file.index };
                        this.$nextTick(() => this.$refs.importInputEl && this.$refs.importInputEl.click());
                    }
                });
            } else {
                this.importTarget = { kind: "text", fileIndex: node.file.index };
                this.$nextTick(() => this.$refs.importInputEl && this.$refs.importInputEl.click());
            }
        },
        async handleImportSelect(event) {
            const file = event.target.files[0];
            event.target.value = "";
            if (!file || !this.importTarget) return;

            const target = this.importTarget;
            this.importTarget = null;
            this.loading = true;
            this.loadingMessage = "导入文件中...";
            try {
                const arch = this.archive;
                const targetFile = arch.files[target.fileIndex];
                if (target.kind === "text") {
                    const text = await file.text();
                    arch.setFileContent(target.fileIndex, text);
                    if (this.currentFile && this.currentFile.index === target.fileIndex) {
                        this.originalText = text;
                        this.editText = text;
                        this.textDirty = false;
                        const data = await arch.getFileData(targetFile);
                        this.hexViewText = bytesToHex(data);
                        this.updateHighlight();
                    }
                } else {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    arch.setFileRawData(target.fileIndex, buf);
                    if (this.currentFile && this.currentFile.index === target.fileIndex) {
                        const data = await arch.getFileData(targetFile);
                        this.hexViewText = bytesToHex(data);
                        const text = arch.decodeContent(targetFile, data);
                        this.originalText = text;
                        this.editText = text;
                        this.textDirty = false;
                        this.updateHighlight();
                    }
                }
                this.loading = false;
                alertModal({ title: "导入成功", message: `已将 <code>${file.name}</code> 的内容导入到 <code>${targetFile.fullpath}</code>。` });
            } catch (err) {
                this.loading = false;
                alertModal({ title: "导入失败", message: err.message });
            }
        },
        // ---- Encoding switching ----
        changeEncoding(enc) {
            if (!this.archive || this.strEncoding === enc) return;
            // 有未保存的编辑时提示：切换编码会按新编码重新解码，未保存内容将丢失
            const apply = () => {
                this.loading = true;
                this.loadingMessage = "切换编码中...";
                this.$nextTick(async () => {
                    try {
                        // setEncoding 会清空字符串缓存并按新编码重新解析所有文件名/路径
                        this.archive.setEncoding(enc);
                        this.strEncoding = enc;
                        this.refreshKey++;
                        // 重新读取当前文件（按新编码解码）
                        if (this.currentFile && !this.currentFile.isDir) {
                            const file = this.archive.files[this.currentFile.index];
                            this.currentFile = file;
                            const data = await this.archive.getFileData(file);
                            if (data) {
                                const text = this.archive.decodeContent(file, data);
                                this.originalText = text;
                                this.editText = text;
                                this.hexViewText = bytesToHex(data);
                                this.textDirty = false;
                                this.selectedPath = file.fullpath;
                                this._editorMetrics = null;
                                this.$nextTick(() => {
                                    this.updateHighlight();
                                    this.runValidation();
                                    this.validationVisible = false;
                                    this.syncScroll();
                                });
                            }
                        }
                    } catch (err) {
                        alertModal({ title: "编码切换失败", message: err.message });
                    }
                    this.loading = false;
                });
            };
            if (this.textDirty && this.editText !== this.originalText && this.isEditable) {
                confirmModal({
                    title: "未保存的修改",
                    message: "切换编码将丢弃当前文件未保存的修改，是否继续？",
                    confirmText: "继续切换",
                    cancelText: "取消"
                }).then(ok => {
                    if (ok) apply();
                });
            } else {
                apply();
            }
        },
        // ---- Save PVF ----
        async downloadPvf() {
            if (!this.archive) return;
            // 自动暂存当前文件的未保存编辑
            if (this.textDirty && this.isEditable) {
                if (this.highlightMode === "pvf" && !this.ensureValid("保存")) return;
                this.isStaging = true;
                await new Promise(r => setTimeout(r, 50));
                try {
                    this.archive.setFileContent(this.currentFile.index, this.editText);
                    this.originalText = this.editText;
                    this.textDirty = false;
                    const data = await this.archive.getFileData(this.currentFile);
                    this.hexViewText = bytesToHex(data);
                    this.addLog(`已暂存：${this.currentFile.fullpath}`, "info");
                } catch (err) {
                    alertModal({ title: "编码失败", message: err.message });
                    this.isStaging = false;
                    return;
                }
                this.isStaging = false;
            }
            if (!this.hasChanges) {
                alertModal({ title: "无修改", message: "尚未修改任何文件，无需导出。" });
                return;
            }

            this.saving = true;
            this.saveProgress = 0;
            this.saveProgressText = "准备重建 PVF...";

            try {
                const result = await this.archive.saveAs((curr, total) => {
                    this.saveProgress = Math.round((curr / total) * 100);
                    this.saveProgressText = `重建分块 ${curr} / ${total}...`;
                });
                this.saveProgressText = "下载中...";

                const blob = new Blob([result], { type: "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = this.fileName.replace(/\.pvf$/i, "") + ".modified.pvf";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.saving = false;
                this.addLog(`导出完成：${this.modifiedCount} 修改、${this.deletedCount} 删除、${this.renamedCount} 重命名，大小 ${formatBytes(result.length)}`, "success");
                alertModal({
                    title: "导出完成",
                    message: `已导出 ${this.modifiedCount} 个修改、${this.deletedCount} 个删除、${this.renamedCount} 个重命名，新 PVF 大小 ${formatBytes(result.length)}。`
                });
            } catch (err) {
                this.saving = false;
                console.error(err);
                this.addLog(`导出失败：${err.message}`, "error");
                alertModal({ title: "导出失败", message: err.message });
            }
        },
        // ---- Keyboard navigation ----
        handleKeydown(e) {
            if (!this.archive) return;
            if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                this.selectByOffset(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                this.selectByOffset(-1);
            }
        },
        selectByOffset(delta) {
            const items = this.visibleNodes;
            if (items.length === 0) return;
            let curIdx = items.findIndex(it => it.node.path === this.selectedPath);
            if (curIdx < 0) curIdx = -1 + delta;
            let next = Math.max(0, Math.min(items.length - 1, curIdx + delta));
            while (next < items.length && items[next].node.isDir) {
                next = next + delta;
                if (next < 0 || next >= items.length) return;
            }
            if (next >= 0 && next < items.length && !items[next].node.isDir) {
                this.onNodeClick(items[next].node);
                const top = next * this.rowHeight;
                const bottom = top + this.rowHeight;
                if (this.$refs.listEl) {
                    if (top < this.$refs.listEl.scrollTop) this.$refs.listEl.scrollTop = top;
                    else if (bottom > this.$refs.listEl.scrollTop + this.$refs.listEl.clientHeight) this.$refs.listEl.scrollTop = bottom - this.$refs.listEl.clientHeight;
                }
            }
        },
        close() {
            if (this.archive && this.hasChanges) {
                const total = this.modifiedCount + this.deletedCount + this.renamedCount;
                confirmModal({ title: "确认关闭", message: `有 ${total} 项未保存的修改，确认关闭编辑器？` }).then(ok => {
                    if (ok) this.$router.push({ name: "Game" });
                });
            } else {
                this.$router.push({ name: "Game" });
            }
        },
        // ---- Window handlers ----
        onWindowKeydown(e) {
            // Ctrl/Cmd + S：保存当前文件（暂存到归档）
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                if (this.archive) {
                    e.preventDefault();
                    if (this.currentFile && this.isEditable) this.stageChange();
                }
                return;
            }
            // Ctrl/Cmd + Z：撤销当前文件已保存的修改（无修改时放行原生文本撤销）
            if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
                if (this.archive && this.currentFile && (this.isCurrentModified || this.isCurrentDeleted || this.isCurrentRenamed)) {
                    e.preventDefault();
                    this.revertCurrent();
                }
                return;
            }
            if (e.key === "Escape" && this.contextMenu.show) {
                this.hideContextMenu();
            }
        },
        onWindowResize() {
            this.updateContainerHeight();
        },
        // ---- Overlay editor: scroll sync + tab + highlight ----
        syncScroll() {
            if (this.$refs.highlightEl && this.$refs.editorEl) {
                this.$refs.highlightEl.scrollTop = this.$refs.editorEl.scrollTop;
                this.$refs.highlightEl.scrollLeft = this.$refs.editorEl.scrollLeft;
            }
        },
        onEditorKeydown(e) {
            if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.target;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const indent = "    ";
                this.editText = this.editText.slice(0, start) + indent + this.editText.slice(end);
                this.$nextTick(() => {
                    ta.selectionStart = ta.selectionEnd = start + indent.length;
                    this.syncScroll();
                });
            }
        },
        scheduleHighlight() {
            if (this.highlightTimer) clearTimeout(this.highlightTimer);
            // textarea 文本透明、可见文本来自高亮层 <pre>，因此高亮刷新越快输入回显越及时。
            // 小文件高亮耗时极低，用 0ms（下一宏任务）近乎实时刷新；大文件拉长延时避免逐键阻塞主线程。
            const len = this.editText ? this.editText.length : 0;
            const delay = len > 80000 ? 300 : len > 20000 ? 100 : 0;
            this.highlightTimer = setTimeout(() => this.updateHighlight(), delay);
        },
        updateHighlight() {
            if (this.highlightTimer) {
                clearTimeout(this.highlightTimer);
                this.highlightTimer = null;
            }
            const text = this.editText || "";
            const mode = this.highlightMode;
            // 缓存命中：文本与模式均未变化则跳过重复高亮（避免加载/编码切换等处重复计算）
            if (this._hlCache && this._hlCache.text === text && this._hlCache.mode === mode) {
                return;
            }
            let html;
            if (!text || text.length > 500000) {
                html = this.annotateTagSpans(this.escapeHtml(text)) + "\n";
            } else if (mode !== "pvf") {
                // Only PVF script (Type 1) has a registered language; Type 3 falls back to escaped text
                html = this.annotateTagSpans(this.escapeHtml(text)) + "\n";
            } else {
                try {
                    const result = hljs.highlight(text, { language: "pvf" });
                    html = this.annotateTagSpans(result.value) + "\n";
                } catch (e) {
                    html = this.annotateTagSpans(this.escapeHtml(text)) + "\n";
                }
            }
            this._hlCache = { text, mode, html };
            this.highlightedHtml = html;
        },
        // 为 [xxx] 标签的 hljs-type span 注入 data-tag 属性，便于浮窗解析
        annotateTagSpans(html) {
            if (!html) return html;
            return html.replace(/<span class="hljs-type">(\[[^\]<]*\])<\/span>/g, (m, tag) => {
                const name = parseTagName(tag);
                const info = getTagInfo(name);
                const known = info && info.category !== "other" ? " known" : "";
                const block = info && info.block ? " block" : "";
                return `<span class="hljs-type pvf-tag${known}${block}" data-tag="${this.escapeAttr(name)}">${tag}</span>`;
            });
        },
        escapeAttr(s) {
            return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        },
        // ---- 标签浮窗：依据鼠标所在行判断是否为 [xxx] 标签 ----
        // 高亮层 pre 设有 pointer-events:none 且位于 textarea 之下，无法直接命中；
        // PVF 中每个 [xxx] 标签独占一行（解码器将每个 type-3 token 输出为单独一行），
        // 因此在 textarea 上按行命中即可，避免坐标→字符偏移的复杂换算。
        onEditorMouseMove(e) {
            if (!this.editText || this.highlightMode !== "pvf") {
                if (this.tooltip.show) this.tooltip.show = false;
                return;
            }
            const ta = this.$refs.editorEl;
            if (!ta) {
                this.tooltip.show = false;
                return;
            }
            const m = this.getEditorMetrics();
            if (!m) {
                this.tooltip.show = false;
                return;
            }
            const rect = ta.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            const row = Math.floor((relY + ta.scrollTop - m.paddingTop) / m.lineHeight);
            if (row < 0) {
                this.tooltip.show = false;
                return;
            }
            const lines = this.editLines;
            if (row >= lines.length) {
                this.tooltip.show = false;
                return;
            }
            const mm = /^\s*(\[\/?[^\]\[`{}]+\])\s*$/.exec(lines[row]);
            if (mm) {
                const html = renderTagTooltip(mm[1]);
                if (html) {
                    this.tooltip.show = true;
                    this.tooltip.html = html;
                    this.positionTooltip(e);
                    return;
                }
            }
            this.tooltip.show = false;
        },
        onEditorMouseLeave() {
            this.tooltip.show = false;
        },
        getEditorMetrics() {
            if (this._editorMetrics) return this._editorMetrics;
            const ta = this.$refs.editorEl;
            if (!ta) return null;
            const cs = getComputedStyle(ta);
            const fontSize = parseFloat(cs.fontSize) || 13;
            let lineHeight = parseFloat(cs.lineHeight);
            if (isNaN(lineHeight) || lineHeight === 0) lineHeight = fontSize * 1.6;
            const paddingTop = parseFloat(cs.paddingTop) || 0;
            this._editorMetrics = { fontSize, lineHeight, paddingTop };
            return this._editorMetrics;
        },
        positionTooltip(e) {
            const w = 360;
            const x = e.clientX + 14;
            this.tooltip.x = x + w > window.innerWidth ? Math.max(8, e.clientX - w - 14) : x;
            this.tooltip.y = e.clientY + 14;
        },
        // ---- 语法格式检查（防抖）----
        scheduleValidation() {
            if (this.validationTimer) clearTimeout(this.validationTimer);
            // 校验结果在输入时不可见（面板默认收起），可较大延时；大文件进一步拉长以减少阻塞。
            const len = this.editText ? this.editText.length : 0;
            const delay = len > 80000 ? 700 : len > 20000 ? 350 : 150;
            this.validationTimer = setTimeout(() => this.runValidation(), delay);
        },
        runValidation() {
            if (!this.isEditable || this.highlightMode !== "pvf") {
                this.validationErrors = [];
                this._valCache = null;
                return;
            }
            const text = this.editText;
            // 缓存命中：文本未变化则复用上次结果
            if (this._valCache && this._valCache.text === text) {
                return;
            }
            this.validationErrors = validatePvfText(text);
            this._valCache = { text, errors: this.validationErrors };
            if (this.validationErrors.length === 0) {
                this.addLog(`语法检查通过：${this.currentFile.fullpath}`, "success");
            } else {
                this.addLog(`语法错误 ${this.validationErrors.length} 处：${this.currentFile.fullpath}`, "error");
            }
        },
        // 阻断保存/下载入口：返回 true 表示通过
        ensureValid(action) {
            this.runValidation();
            this.validationVisible = true;
            if (this.validationErrors.length > 0) {
                const list = this.validationErrors
                    .slice(0, 5)
                    .map(e => `第 ${e.line} 行：${e.message}`)
                    .join("<br/>");
                const more = this.validationErrors.length > 5 ? `<br/>…等共 ${this.validationErrors.length} 处错误` : "";
                alertModal({ title: `${action}失败`, message: `语法格式存在错误，请先修复：<br/>${list}${more}` });
                return false;
            }
            return true;
        },
        escapeHtml(s) {
            return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        },
        addLog(message, type = "info") {
            const time = new Date().toLocaleTimeString();
            this.logs.push({ time, message, type });
            if (this.logs.length > 200) this.logs.shift();
            this.$nextTick(() => {
                const el = this.$refs.logEl;
                if (el) el.scrollTop = el.scrollHeight;
            });
        },
        clearLogs() {
            this.logs = [];
        },
        startDrag(type, e) {
            e.preventDefault();
            e.stopPropagation();
            this.drag = {
                type,
                startX: e.clientX,
                startY: e.clientY,
                initWidth: this.sidebarWidth,
                initHeight: this.logHeight
            };
            document.addEventListener("mousemove", this.onDragMove);
            document.addEventListener("mouseup", this.onDragEnd);
        },
        onDragMove(e) {
            if (!this.drag) return;
            if (this.drag.type === "sidebar") {
                const delta = e.clientX - this.drag.startX;
                this.sidebarWidth = Math.max(180, Math.min(500, this.drag.initWidth + delta));
            } else if (this.drag.type === "log") {
                const delta = this.drag.startY - e.clientY;
                this.logHeight = Math.max(80, Math.min(400, this.drag.initHeight + delta));
            }
        },
        onDragEnd() {
            this.drag = null;
            document.removeEventListener("mousemove", this.onDragMove);
            document.removeEventListener("mouseup", this.onDragEnd);
            this.$nextTick(() => this.updateContainerHeight());
        }
    }
};
</script>

<template>
    <Teleport to="body">
        <div class="pvf-overlay" @contextmenu.prevent>
            <!-- Loading overlay -->
            <div v-if="loading" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p class="pvf-loading-text">{{ loadingMessage }}<span class="pvf-loading-dots"><span>.</span><span>.</span><span>.</span></span></p>
            </div>

            <!-- Saving overlay -->
            <div v-if="saving" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p>{{ saveProgressText }}</p>
                <div class="progress-bar"><div class="progress-fill" :style="{ width: saveProgress + '%' }"></div></div>
            </div>

            <!-- Staging overlay -->
            <div v-if="isStaging" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p>保存中...</p>
            </div>

            <!-- Context menu -->
            <Transition name="ctx">
                <div v-if="contextMenu.show" class="pvf-ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
                    <template v-if="contextMenu.node">
                        <div class="pvf-ctx-header">{{ contextMenu.node.isDir ? "📁 " + contextMenu.node.name : contextMenu.node.name }}</div>
                        <button
                            v-if="!contextMenu.node.isDir"
                            class="pvf-ctx-item"
                            @click="
                                exportNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>导出文件</span>
                        </button>
                        <button
                            v-if="!contextMenu.node.isDir"
                            class="pvf-ctx-item"
                            @click="
                                triggerImport(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>导入替换</span>
                        </button>
                        <button
                            class="pvf-ctx-item"
                            @click="
                                renameNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>重命名</span>
                        </button>
                        <button
                            v-if="!contextMenu.node.isDir && contextMenu.node.file && archive.isFileModified(contextMenu.node.file.index)"
                            class="pvf-ctx-item"
                            @click="
                                selectedPath = contextMenu.node.path;
                                currentFile = contextMenu.node.file;
                                revertCurrent();
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            <span>撤销修改</span>
                        </button>
                        <div class="pvf-ctx-divider"></div>
                        <button
                            class="pvf-ctx-item danger"
                            @click="
                                deleteNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            <span>删除{{ contextMenu.node.isDir ? "目录" : "文件" }}</span>
                        </button>
                    </template>
                </div>
            </Transition>

            <!-- File picker (no archive loaded) -->
            <div v-if="!archive" class="pvf-picker-screen">
                <div class="pvf-picker-card">
                    <div class="pvf-picker-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                            <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                    </div>
                    <!-- <h2>PVF 编辑器</h2> -->
                    <!-- <p>选择 Script.pvf 文件进行在线编辑</p> -->
                    <button class="btn btn-primary" @click="$refs.fileInputEl && $refs.fileInputEl.click()">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        选择 Script.pvf 文件
                    </button>
                    <input ref="fileInputEl" type="file" accept=".pvf" style="display: none" @change="handleFileSelect" />
                    <button class="btn btn-outline-secondary pvf-cancel-btn" @click="close">取消</button>
                    <p class="pvf-picker-hint">所有解析与编辑在浏览器中完成</p>
                </div>
            </div>

            <!-- Editor workspace -->
            <div v-if="archive" class="pvf-workspace">
                <!-- Top toolbar -->
                <div class="pvf-topbar">
                    <div class="pvf-topbar-left">
                        <button class="pvf-icon-btn" @click="close" title="返回">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
                        </button>
                        <span class="pvf-topbar-title">
                            <svg class="pvf-topbar-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                            </svg>
                            <span class="pvf-topbar-title-text">{{ fileName }}</span>
                        </span>
                        <span v-if="headerStats" class="pvf-topbar-stats">
                            {{ headerStats.fileCount.toLocaleString() }} 文件 · {{ headerStats.groupCount.toLocaleString() }} 分块 · {{ headerStats.bodySize }} / {{ headerStats.totalOrig }}
                        </span>
                        <div class="pvf-topbar-search">
                            <svg class="pvf-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input v-model="searchQuery" type="text" class="pvf-search" placeholder="搜索文件路径..." />
                        </div>
                    </div>
                    <div class="pvf-topbar-right">
                        <select v-if="archive" class="pvf-encoding-select" :value="strEncoding" title="字符串编码（影响 Type 1 脚本内容与文件名解析）" @change="changeEncoding($event.target.value)">
                            <option v-for="enc in ENCODINGS" :key="enc.value" :value="enc.value">{{ enc.label }}</option>
                        </select>
                        <span v-if="hasChanges" class="pvf-mod-count">
                            <span v-if="modifiedCount > 0">{{ modifiedCount }} 修改</span>
                            <span v-if="modifiedCount > 0 && deletedCount > 0"> · </span>
                            <span v-if="deletedCount > 0">{{ deletedCount }} 删除</span>
                            <span v-if="(modifiedCount > 0 || deletedCount > 0) && renamedCount > 0"> · </span>
                            <span v-if="renamedCount > 0">{{ renamedCount }} 重命名</span>
                        </span>
                        <button v-if="hasChanges" class="btn btn-sm btn-outline-secondary" @click="revertAll">全部撤销</button>
                        <button class="pvf-icon-btn" @click="exportNode(currentFile ? { file: currentFile, isDir: false } : null)" :disabled="!currentFile" data-tip="导出当前文件">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                        <button class="pvf-icon-btn" @click="triggerImport(currentFile ? { file: currentFile, isDir: false } : null)" :disabled="!currentFile" data-tip="导入文件到当前目录">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                        </button>
                        <button class="pvf-icon-btn" :disabled="!hasChanges" @click="downloadPvf" data-tip="导出 PVF">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                <polyline points="17 21 17 13 7 13 7 21" />
                                <polyline points="7 3 7 8 15 8" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Body -->
                <div class="pvf-body">
                    <!-- Top zone: sidebar + editor -->
                    <div class="pvf-body-top">
                        <!-- Sidebar (file tree) -->
                        <div class="pvf-sidebar" :style="{ width: sidebarWidth + 'px', flexShrink: 0 }">
                            <div ref="listEl" class="pvf-list" @scroll="onListScroll" @keydown="handleKeydown" tabindex="0">
                                <div v-if="renderWindow.total === 0" class="pvf-list-empty">
                                    {{ isSearching ? "无匹配文件" : "无文件" }}
                                </div>
                                <div :style="{ height: renderWindow.start * rowHeight + 'px' }"></div>
                                <div
                                    v-for="(item, idx) in renderWindow.items"
                                    :key="renderWindow.start + '-' + idx"
                                    class="pvf-tree-row"
                                    :class="{
                                        selected: item.node.path === selectedPath,
                                        folder: item.node.isDir
                                    }"
                                    :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
                                    :title="item.node.path"
                                    @click="onNodeClick(item.node)"
                                    @contextmenu="onNodeContext($event, item.node)">
                                    <span v-if="item.node.isDir" class="pvf-tree-chevron" :class="{ expanded: isSearching || expandedPaths.has(item.node.path) }">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                                    </span>
                                    <span v-else class="pvf-tree-chevron"></span>
                                    <span class="pvf-tree-icon">
                                        <svg v-if="item.node.isDir" class="pvf-tree-ico pvf-ico-folder" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                                        </svg>
                                        <svg v-else-if="item.node.file.dataType === 1" class="pvf-tree-ico pvf-ico-script" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                        <svg v-else-if="item.node.file.dataType === 3" class="pvf-tree-ico pvf-ico-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                        <svg v-else class="pvf-tree-ico pvf-ico-binary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                    </span>
                                    <span class="pvf-tree-name">{{ item.node.name }}</span>
                                    <span v-if="!item.node.isDir && item.node.file && archive.isFileModified(item.node.file.index)" class="pvf-mod-dot">●</span>
                                </div>
                                <div :style="{ height: Math.max(0, (renderWindow.total - renderWindow.end) * rowHeight) + 'px' }"></div>
                            </div>
                            <div class="pvf-list-footer">
                                <span>{{ visibleNodes.length.toLocaleString() }} / {{ visibleFileCount.toLocaleString() }} 项</span>
                                <span v-if="deletedCount > 0" class="pvf-footer-deleted">已删 {{ deletedCount }}</span>
                            </div>
                        </div>

                        <!-- Drag handle: sidebar <-> editor -->
                        <div class="pvf-drag-v" @mousedown="startDrag('sidebar', $event)"></div>

                        <!-- Editor -->
                        <div class="pvf-editor">
                            <div v-if="currentFile" class="pvf-editor-toolbar">
                                <span class="pvf-editor-path">{{ currentFile.fullpath }}</span>
                                <span class="pvf-editor-tag">{{ dataTypeLabel }}</span>
                                <span class="pvf-editor-meta">{{ formatBytes(currentFile.dataSize) }}</span>
                                <span v-if="textDirty || isCurrentModified" class="pvf-mod-badge dirty">已修改</span>
                                <div class="pvf-editor-spacer"></div>
                                <div v-if="isEditable" class="pvf-view-switch">
                                    <button :class="{ active: viewMode === 'text' }" @click="viewMode = 'text'">文本</button>
                                    <button :class="{ active: viewMode === 'hex' }" @click="viewMode = 'hex'">十六进制</button>
                                </div>
                            </div>
                            <div v-if="currentFile && isEditable && viewMode === 'text'" class="pvf-editor-area">
                                <div class="pvf-code-editor">
                                    <pre ref="highlightEl" class="pvf-code-highlight" aria-hidden="true" v-html="highlightedHtml"></pre>
                                    <textarea
                                        ref="editorEl"
                                        v-model="editText"
                                        class="pvf-code-textarea"
                                        spellcheck="false"
                                        @scroll="syncScroll"
                                        @keydown="onEditorKeydown"
                                        @mousemove="onEditorMouseMove"
                                        @mouseleave="onEditorMouseLeave"
                                        placeholder="编辑文件内容..."></textarea>
                                </div>
                                <!-- 语法错误面板 -->
                                <Transition name="ctx">
                                    <div v-if="hasSyntaxErrors && validationVisible" class="pvf-syntax-panel">
                                        <div class="pvf-syntax-panel-head">
                                            <span>语法错误 ({{ validationErrors.length }})</span>
                                            <button class="pvf-syntax-panel-close" @click="validationVisible = false">×</button>
                                        </div>
                                        <ul class="pvf-syntax-list">
                                            <li v-for="(err, i) in validationErrors" :key="i">
                                                <span class="pvf-err-line">L{{ err.line }}</span>
                                                <span class="pvf-err-msg">{{ err.message }}</span>
                                            </li>
                                        </ul>
                                    </div>
                                </Transition>
                                <!-- 标签浮窗 -->
                                <Transition name="tip">
                                    <div v-if="tooltip.show" class="pvf-tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }" v-html="tooltip.html"></div>
                                </Transition>
                            </div>
                            <div v-else-if="currentFile && viewMode === 'hex'" class="pvf-editor-area">
                                <pre class="pvf-hexview">{{ hexViewText }}</pre>
                            </div>
                            <div v-else-if="currentFile" class="pvf-editor-area">
                                <div class="pvf-readonly">
                                    <p>该文件类型 (Type {{ currentFile.dataType }}) 不支持文本编辑。</p>
                                    <p class="pvf-readonly-hint">可切换至十六进制视图查看，或使用右键导出原始字节。</p>
                                    <button class="btn btn-sm btn-outline-secondary" @click="viewMode = 'hex'">查看十六进制</button>
                                </div>
                            </div>
                            <div v-else class="pvf-empty">
                                <div class="pvf-empty-icon">📂</div>
                                <p>从左侧选择文件查看内容</p>
                                <p class="pvf-empty-hint">右键文件可导出、导入、重命名、删除</p>
                            </div>
                        </div>
                    </div>

                    <!-- Drag handle: top zone <-> log -->
                    <div class="pvf-drag-h" @mousedown="startDrag('log', $event)"></div>

                    <!-- Bottom log panel -->
                    <div class="pvf-log-panel" :style="{ height: logHeight + 'px' }">
                        <div class="pvf-log-header">
                            <div class="pvf-log-header-left">
                                <span class="pvf-log-title">日志</span>
                                <span v-if="currentFile && isEditable && highlightMode === 'pvf'" class="pvf-syntax-state" :class="{ ok: !hasSyntaxErrors, err: hasSyntaxErrors }">
                                    <span class="pvf-syntax-dot"></span>{{ syntaxSummary }}
                                </span>
                            </div>
                            <button class="pvf-log-clear" @click="clearLogs">清空</button>
                        </div>
                        <div ref="logEl" class="pvf-log-content">
                            <div v-if="logs.length === 0" class="pvf-log-empty">暂无日志</div>
                            <div v-for="(log, i) in logs" :key="i" class="pvf-log-item" :class="'pvf-log-' + log.type">
                                <span class="pvf-log-time">{{ log.time }}</span>
                                <span class="pvf-log-msg">{{ log.message }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Hidden inputs -->
                <input ref="importInputEl" type="file" style="display: none" @change="handleImportSelect" />
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.pvf-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
}

/* ---- Loading / Saving overlay ---- */
.pvf-modal-loading {
    position: fixed;
    inset: 0;
    z-index: 2100;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
}
.pvf-loading-icon {
    width: 56px;
    height: 56px;
    color: var(--accent);
    animation: pvf-pulse 1.2s ease-in-out infinite;
}
.pvf-loading-icon svg {
    width: 100%;
    height: 100%;
}
@keyframes pvf-pulse {
    0%, 100% {
        transform: scale(1);
        opacity: 0.6;
    }
    50% {
        transform: scale(1.12);
        opacity: 1;
    }
}
.pvf-loading-text {
    color: var(--text);
    font-size: 0.9rem;
}
.pvf-loading-dots span {
    animation: pvf-dots 1.4s infinite;
    opacity: 0;
}
.pvf-loading-dots span:nth-child(1) {
    animation-delay: 0s;
}
.pvf-loading-dots span:nth-child(2) {
    animation-delay: 0.2s;
}
.pvf-loading-dots span:nth-child(3) {
    animation-delay: 0.4s;
}
@keyframes pvf-dots {
    0%, 60%, 100% {
        opacity: 0;
    }
    30% {
        opacity: 1;
    }
}
.spinner-lg {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
.pvf-modal-loading p {
    color: var(--text);
    font-size: 0.9rem;
}
.progress-bar {
    width: 300px;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
}
.progress-fill {
    height: 100%;
    background: var(--accent-gradient);
    transition: width 0.2s ease;
    border-radius: 3px;
}

/* ---- File picker ---- */
.pvf-picker-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.pvf-picker-card {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px;
}
.pvf-picker-icon {
    color: var(--accent);
    line-height: 0;
}
.pvf-picker-icon svg {
    width: 56px;
    height: 56px;
}
.pvf-picker-card h2 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text);
}
.pvf-picker-card > p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 16px;
}
.pvf-picker-card .btn {
    min-width: 180px;
}
.pvf-cancel-btn {
    margin-top: 8px;
    min-width: 180px;
}
.pvf-picker-hint {
    margin-top: 20px;
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.6;
}

/* ---- Workspace ---- */
.pvf-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* ---- Top toolbar ---- */
.pvf-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 48px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
    gap: 12px;
}
.pvf-topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}
.pvf-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s;
}
.pvf-icon-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.pvf-icon-btn svg {
    width: 18px;
    height: 18px;
}
.pvf-icon-btn[data-tip] {
    position: relative;
}
.pvf-icon-btn[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 0.7rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 2100;
}
.pvf-icon-btn[data-tip]:hover::after {
    opacity: 1;
}
.pvf-topbar-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
    white-space: nowrap;
    min-width: 0;
}
.pvf-topbar-title-icon {
    width: 17px;
    height: 17px;
    color: var(--accent);
    flex-shrink: 0;
}
.pvf-topbar-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pvf-topbar-search {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: 4px;
}
.pvf-topbar-search .pvf-search-icon {
    left: 9px;
}
.pvf-topbar-search .pvf-search {
    width: 220px;
    height: 30px;
    padding: 0 12px 0 30px;
    box-sizing: border-box;
    border-radius: 6px;
}
.pvf-topbar-stats {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.pvf-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.pvf-mod-count {
    font-size: 0.78rem;
    color: var(--accent);
    font-weight: 500;
    white-space: nowrap;
}
.btn-sm {
    height: 30px;
    padding: 0 12px;
    font-size: 0.78rem;
    border-radius: 6px;
    box-sizing: border-box;
}
.btn-icon {
    width: 14px;
    height: 14px;
}

/* ---- Body ---- */
.pvf-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.pvf-body-top {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
}

/* ---- Drag handles ---- */
.pvf-drag-v {
    width: 4px;
    cursor: col-resize;
    background: var(--surface-border);
    flex-shrink: 0;
    transition: background 0.15s;
}
.pvf-drag-v:hover {
    background: var(--accent);
}
.pvf-drag-h {
    height: 4px;
    cursor: row-resize;
    background: var(--surface-border);
    flex-shrink: 0;
    transition: background 0.15s;
}
.pvf-drag-h:hover {
    background: var(--accent);
}

/* ---- Log panel ---- */
.pvf-log-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--bg-2);
    border-top: 1px solid var(--surface-border);
    overflow: hidden;
}
.pvf-log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.pvf-log-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
}
.pvf-log-title {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--text-muted);
}
.pvf-log-clear {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.68rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
}
.pvf-log-clear:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.pvf-log-content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 12px;
    font-size: 0.72rem;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
}
.pvf-log-content::-webkit-scrollbar {
    width: 6px;
}
.pvf-log-content::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-log-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
}
.pvf-log-empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 8px 0;
}
.pvf-log-item {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    line-height: 1.5;
}
.pvf-log-time {
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 0.6;
}
.pvf-log-msg {
    word-break: break-all;
}
.pvf-log-success .pvf-log-msg {
    color: #9ece6a;
}
.pvf-log-error .pvf-log-msg {
    color: var(--error);
}
.pvf-log-warning .pvf-log-msg {
    color: #e0af68;
}
.pvf-log-info .pvf-log-msg {
    color: var(--text);
}

/* ---- Sidebar ---- */
.pvf-sidebar {
    border-right: 1px solid var(--surface-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-2);
}
.pvf-search-icon {
    position: absolute;
    left: 18px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    pointer-events: none;
}
.pvf-search {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 6px 12px 6px 30px;
    color: var(--text);
    font-size: 0.8rem;
    outline: none;
    font-family: system-ui, sans-serif;
    box-sizing: border-box;
}
.pvf-search:focus {
    border-color: var(--accent);
}
.pvf-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    outline: none;
}
.pvf-list::-webkit-scrollbar {
    width: 8px;
}
.pvf-list::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
}
.pvf-list::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}
.pvf-list {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}
.pvf-list::-webkit-scrollbar,
.pvf-code-highlight::-webkit-scrollbar,
.pvf-code-textarea::-webkit-scrollbar,
.pvf-hexview::-webkit-scrollbar,
.pvf-syntax-panel::-webkit-scrollbar,
.pvf-syntax-list::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.pvf-list::-webkit-scrollbar-track,
.pvf-code-highlight::-webkit-scrollbar-track,
.pvf-code-textarea::-webkit-scrollbar-track,
.pvf-hexview::-webkit-scrollbar-track,
.pvf-syntax-panel::-webkit-scrollbar-track,
.pvf-syntax-list::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-list::-webkit-scrollbar-thumb,
.pvf-code-highlight::-webkit-scrollbar-thumb,
.pvf-code-textarea::-webkit-scrollbar-thumb,
.pvf-hexview::-webkit-scrollbar-thumb,
.pvf-syntax-panel::-webkit-scrollbar-thumb,
.pvf-syntax-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
}
.pvf-list::-webkit-scrollbar-thumb:hover,
.pvf-code-highlight::-webkit-scrollbar-thumb:hover,
.pvf-code-textarea::-webkit-scrollbar-thumb:hover,
.pvf-hexview::-webkit-scrollbar-thumb:hover,
.pvf-syntax-panel::-webkit-scrollbar-thumb:hover,
.pvf-syntax-list::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}
.pvf-list-empty {
    padding: 24px 14px;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
}
.pvf-tree-row {
    height: 24px;
    display: flex;
    align-items: center;
    padding-right: 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    border-left: 2px solid transparent;
    user-select: none;
    font-size: 0.78rem;
}
.pvf-tree-row:hover {
    background: rgba(255, 255, 255, 0.04);
}
.pvf-tree-row.selected {
    background: rgba(91, 140, 255, 0.14);
    border-left-color: var(--accent);
}
.pvf-tree-row.folder.selected {
    background: rgba(91, 140, 255, 0.08);
    border-left-color: rgba(91, 140, 255, 0.5);
}
.pvf-tree-chevron {
    width: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
}
.pvf-tree-chevron svg {
    width: 12px;
    height: 12px;
    transition: transform 0.15s ease;
}
.pvf-tree-chevron.expanded svg {
    transform: rotate(90deg);
}
.pvf-tree-icon {
    width: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin: 0 4px;
}
.pvf-tree-ico {
    width: 15px;
    height: 15px;
    color: var(--text-muted);
}
.pvf-ico-folder {
    color: #dcb67a;
}
.pvf-ico-script {
    color: #5b8cff;
}
.pvf-ico-text {
    color: #9ece6a;
}
.pvf-ico-binary {
    color: #e0af68;
}
.pvf-tree-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    color: var(--text);
}
.pvf-tree-row.folder .pvf-tree-name {
    font-weight: 500;
}
.pvf-mod-dot {
    color: var(--error);
    font-size: 0.6rem;
    margin-left: 4px;
    flex-shrink: 0;
}
.pvf-list-footer {
    padding: 5px 12px;
    border-top: 1px solid var(--surface-border);
    font-size: 0.65rem;
    color: var(--text-muted);
    flex-shrink: 0;
    font-family: "SF Mono", monospace;
    display: flex;
    justify-content: space-between;
}
.pvf-footer-deleted {
    color: var(--error);
}

/* ---- Context menu ---- */
.pvf-ctx-menu {
    position: fixed;
    z-index: 2200;
    min-width: 180px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    padding: 4px;
    font-family: system-ui, sans-serif;
}
.pvf-ctx-header {
    padding: 6px 10px;
    font-size: 0.72rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--surface-border);
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
}
.pvf-ctx-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 0.8rem;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
}
.pvf-ctx-item:hover {
    background: rgba(91, 140, 255, 0.12);
}
.pvf-ctx-item.danger {
    color: var(--error);
}
.pvf-ctx-item.danger:hover {
    background: rgba(255, 91, 110, 0.12);
}
.pvf-ctx-item svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}
.pvf-ctx-divider {
    height: 1px;
    background: var(--surface-border);
    margin: 4px 0;
}
.ctx-enter-active,
.ctx-leave-active {
    transition:
        opacity 0.12s ease,
        transform 0.12s ease;
}
.ctx-enter-from,
.ctx-leave-to {
    opacity: 0;
    transform: scale(0.96);
}

/* ---- Editor ---- */
.pvf-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
}
.pvf-editor-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 38px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
    background: var(--bg-2);
}
.pvf-editor-path {
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.76rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.pvf-editor-tag {
    font-size: 0.66rem;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(187, 154, 247, 0.12);
    color: #bb9af7;
    font-weight: 500;
    flex-shrink: 0;
    font-family: "SF Mono", monospace;
}
.pvf-encoding-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.76rem;
    height: 30px;
    padding: 0 8px;
    outline: none;
    flex-shrink: 0;
    cursor: pointer;
    box-sizing: border-box;
    font-family: "SF Mono", monospace;
}
.pvf-encoding-select:focus {
    border-color: var(--accent);
}
.pvf-encoding-select option {
    background: var(--bg-2);
    color: var(--text);
}
.pvf-editor-meta {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-family: "SF Mono", monospace;
    flex-shrink: 0;
}
.pvf-editor-spacer {
    flex: 1;
}
.pvf-mod-badge {
    font-size: 0.62rem;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(255, 91, 110, 0.16);
    color: var(--error);
    font-weight: 500;
    flex-shrink: 0;
}
.pvf-view-switch {
    display: flex;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px;
    flex-shrink: 0;
}
.pvf-view-switch button {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.7rem;
    padding: 3px 10px;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s;
}
.pvf-view-switch button.active {
    background: rgba(91, 140, 255, 0.18);
    color: var(--accent);
}
.pvf-editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
/* ---- Overlay code editor (highlighted pre + transparent textarea) ---- */
.pvf-code-editor {
    position: relative;
    flex: 1;
    overflow: hidden;
}
.pvf-code-highlight,
.pvf-code-textarea {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 14px 18px;
    border: none;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.8rem;
    line-height: 1.6;
    tab-size: 4;
    white-space: pre;
    overflow: auto;
    box-sizing: border-box;
}
.pvf-code-highlight {
    background: var(--bg);
    color: var(--text);
    pointer-events: none;
    z-index: 1;
}
.pvf-code-textarea {
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    resize: none;
    outline: none;
    z-index: 2;
}
.pvf-code-textarea::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
}
.pvf-code-textarea::selection {
    background: rgba(91, 140, 255, 0.3);
}
/* ---- highlight.js token colors (VS Code Dark+ inspired) ---- */
.pvf-code-highlight :deep(.hljs-comment) {
    color: #6a9955;
    font-style: italic;
}
.pvf-code-highlight :deep(.hljs-string) {
    color: #ce9178;
}
.pvf-code-highlight :deep(.hljs-keyword) {
    color: #c586c0;
    font-weight: 500;
}
.pvf-code-highlight :deep(.hljs-type) {
    color: #4ec9b0;
}
.pvf-code-highlight :deep(.hljs-number) {
    color: #b5cea8;
}
.pvf-code-highlight :deep(.hljs-title) {
    color: #9cdcfe;
}
.pvf-code-highlight :deep(.hljs-char.escape) {
    color: #d7ba7d;
}
.pvf-hexview {
    flex: 1;
    margin: 0;
    padding: 14px 18px;
    background: var(--bg);
    color: var(--text);
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.55;
    overflow: auto;
    white-space: pre;
    user-select: text;
}
.pvf-readonly {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.85rem;
}
.pvf-readonly-hint {
    font-size: 0.72rem;
    opacity: 0.7;
}
.pvf-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--text-muted);
}
.pvf-empty-icon {
    font-size: 48px;
    opacity: 0.3;
}
.pvf-empty-hint {
    font-size: 0.72rem;
    opacity: 0.6;
}

/* ---- 标签浮窗 ---- */
.pvf-tooltip {
    position: fixed;
    z-index: 2200;
    max-width: 360px;
    min-width: 180px;
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    font-family:
        system-ui,
        -apple-system,
        sans-serif;
    font-size: 0.74rem;
    line-height: 1.55;
    color: var(--text);
    pointer-events: none;
    user-select: none;
}
.pvf-tip-name {
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.82rem;
    font-weight: 600;
    color: #4ec9b0;
    margin-bottom: 2px;
}
.pvf-tip-cat {
    display: inline-block;
    font-size: 0.62rem;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(91, 140, 255, 0.14);
    color: var(--accent);
    margin-bottom: 6px;
}
.pvf-tip-block {
    display: inline-block;
    font-size: 0.62rem;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 91, 110, 0.14);
    color: var(--error);
    margin-bottom: 6px;
    margin-left: 4px;
}
.pvf-tip-desc {
    color: var(--text);
    margin-bottom: 8px;
}
.pvf-tip-section {
    font-size: 0.64rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 6px 0 4px;
}
.pvf-tip-param {
    display: grid;
    grid-template-columns: auto auto auto 1fr;
    gap: 6px;
    align-items: center;
    margin-bottom: 3px;
    font-size: 0.7rem;
}
.pvf-tip-pname {
    font-family: "SF Mono", monospace;
    color: #9cdcfe;
    font-weight: 500;
}
.pvf-tip-ptype {
    font-family: "SF Mono", monospace;
    font-size: 0.62rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
}
.pvf-tip-req {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 91, 110, 0.14);
    color: var(--error);
}
.pvf-tip-opt {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
}
.pvf-tip-pdesc {
    color: var(--text-muted);
}
.pvf-tip-example {
    display: block;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 7px;
    border-radius: 4px;
    color: #ce9178;
    word-break: break-all;
}
.pvf-tip-remark {
    margin-top: 6px;
    font-size: 0.66rem;
    color: var(--text-muted);
    font-style: italic;
}
.tip-enter-active,
.tip-leave-active {
    transition: opacity 0.12s ease;
}
.tip-enter-from,
.tip-leave-to {
    opacity: 0;
}

/* 已收录标签下划线提示 */
.pvf-code-highlight :deep(.pvf-tag.known) {
    cursor: help;
    border-bottom: 1px dashed rgba(78, 201, 176, 0.5);
}
.pvf-code-highlight :deep(.pvf-tag) {
    cursor: help;
}

/* ---- 语法状态徽章 ---- */
.pvf-syntax-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.pvf-syntax-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
}
.pvf-syntax-state.ok {
    color: #9ece6a;
}
.pvf-syntax-state.ok .pvf-syntax-dot {
    background: #9ece6a;
}
.pvf-syntax-state.err {
    color: var(--error);
}
.pvf-syntax-state.err .pvf-syntax-dot {
    background: var(--error);
    animation: pvf-blink 1s ease-in-out infinite;
}
@keyframes pvf-blink {
    50% {
        opacity: 0.3;
    }
}

/* ---- 语法错误面板 ---- */
.pvf-syntax-panel {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: 320px;
    max-height: 40%;
    overflow-y: auto;
    background: var(--bg-2);
    border: 1px solid rgba(255, 91, 110, 0.4);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    z-index: 40;
    font-family: system-ui, sans-serif;
}
.pvf-syntax-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--error);
    border-bottom: 1px solid var(--surface-border);
}
.pvf-syntax-panel-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
}
.pvf-syntax-panel-close:hover {
    color: var(--text);
}
.pvf-syntax-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
}
.pvf-syntax-list li {
    display: flex;
    gap: 8px;
    padding: 5px 12px;
    font-size: 0.72rem;
    border-bottom: 1px solid var(--surface-border);
}
.pvf-syntax-list li:last-child {
    border-bottom: none;
}
.pvf-err-line {
    font-family: "SF Mono", monospace;
    color: var(--error);
    font-weight: 600;
    flex-shrink: 0;
}
.pvf-err-msg {
    color: var(--text-muted);
    word-break: break-all;
}
</style>
