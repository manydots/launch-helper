<script>
import { ElButton, ElCascader, ElInput, ElSelect, ElOption, ElInputNumber } from "element-plus";
import { useGameStore } from "@/stores/game";
import { alertModal, confirmModal } from "@/hooks/useModal";
import { api } from "@/utils/gateway";

// 物品种类（对齐网关 ItemCore 枚举与 validateItemSpec 校验，kind 必填 1-14）：
// 主背包(0|2)配 1=装备/2=消耗品/3=材料/9=时装徽章/10=副职业材料/12=公会勋章/13=守护珠；
// 时装(1)配 8=时装；宠物(3|7)配 5=宠物本体/6=宠物装备/7=宠物消耗品。
// 0=未知非法；4=任务品暂未开放；11=特殊材料（账号仓库物品）与 14=史诗碎片（账号图鉴通道）拒收。
const ITEM_TYPE_OPTIONS = [
    { value: 0, label: "主背包" },
    { value: 1, label: "时装" },
    { value: 3, label: "宠物" }
];

// 限时天数固定档位（0=无期限），协议 expire_time 按提交时刻 + 天数换算
const EXPIRE_DAY_OPTIONS = [0, 1, 3, 5, 7, 15, 30];

export default {
    name: "SendItemView",
    components: { ElButton, ElCascader, ElInput, ElSelect, ElOption, ElInputNumber },
    setup() {
        const store = useGameStore();
        return { store };
    },
    data() {
        return {
            gatewayEnabled: import.meta.env.VITE_GATEWAY_ENABLED === "true",
            serviceOnline: null,
            itemsMid: this.store.account || "",
            // 授权密钥成功使用过一次后缓存于本地，进入本页自动填充，免重复输入
            itemsKey: this.store.adminAuthKey || "",
            itemsRoles: [],
            itemsRoleId: "",
            itemsLoadingRoles: false,
            clearingMailbox: false,
            itemsTitle: "GM物品发放",
            itemsBody: "",
            itemsList: [],
            itemsErrors: { mid: "", key: "", role: "", title: "" },
            loading: false,
            itemTypeOptions: ITEM_TYPE_OPTIONS,
            expireDayOptions: EXPIRE_DAY_OPTIONS
        };
    },
    computed: {
        keyRemembered() {
            const key = this.itemsKey.trim();
            return !!key && key === this.store.adminAuthKey;
        },
        // 投递封数预估：堆叠类按每附件 2000 拆分、每封 10 个附件（对齐网关 expandItems / splitMails 默认值）
        mailEstimate() {
            if (!this.itemsList.length) return 0;
            const parts = this.itemsList.reduce((sum, a) => {
                if (this.isNonStackable(a.kind)) return sum + 1;
                return sum + Math.max(1, Math.ceil((Number(a.count) || 0) / 2000));
            }, 0);
            return Math.ceil(parts / 10);
        },
        // 级联选项：一级背包类型，二级限定为该背包合法的物品种类（对齐 validKinds 约束）
        typeKindOptions() {
            return this.itemTypeOptions.map(t => ({
                value: t.value,
                label: t.label,
                children: this.validKinds(t.value).map(k => ({ value: k, label: this.kindName(k) }))
            }));
        }
    },
    async mounted() {
        if (!this.gatewayEnabled) {
            await alertModal({ title: "物品发放", message: "请通过管理后台发放物品。" });
            this.$router.replace({ name: "Game" });
            return;
        }
        if (!(await this.ensureGatewayOnline())) {
            this.$router.replace({ name: "Game" });
        }
    },
    methods: {
        backToLogin() {
            this.$router.push({ name: "Game" });
        },
        saveAuthKey() {
            const key = this.itemsKey.trim();
            if (key && key !== this.store.adminAuthKey) this.store.setAdminAuthKey(key);
        },
        forgetKey() {
            this.store.setAdminAuthKey("");
        },
        async ensureGatewayOnline() {
            if (!this.gatewayEnabled) return true;
            let online = false;
            try {
                const data = await api.health();
                online = !!data && data.success && data.status === "ok";
            } catch {
                online = false;
            }
            this.serviceOnline = online;
            if (online) return true;
            await alertModal({
                title: "网关不可用",
                message: "网关服务未启动或无法连接，请确认网关已正常运行。"
            });
            return false;
        },
        jobName(job) {
            const names = {
                0: "鬼剑士(男)",
                1: "格斗家(女)",
                2: "神枪手(男)",
                3: "魔法师(女)",
                4: "圣职者",
                5: "神枪手(女)",
                6: "暗夜使者",
                7: "格斗家(男)",
                8: "魔法师(男)",
                9: "黑暗武士",
                10: "缔造者",
                11: "鬼剑士(女)",
                12: "守护者"
            };
            return names[job ?? 0] || `职业${job}`;
        },
        roleLabel(role) {
            return `${role.name} (Lv${role.level} / ${this.jobName(role.job)})`;
        },
        validKinds(itemType) {
            switch (itemType) {
                case 1:
                    return [8];
                case 3:
                case 7:
                    return [5, 6, 7];
                default:
                    // item_type 0 与 2（主背包次要入口）允许集一致
                    return [1, 2, 3, 9, 10, 12, 13];
            }
        },
        isNonStackable(kind) {
            return kind === 1 || kind === 5 || kind === 6 || kind === 8 || kind === 12;
        },
        isEquipLike(kind) {
            return kind === 1 || kind === 12;
        },
        // 协议 expire_time 仅对限时时装（item_type=1）与限时宠物本体（宠物背包 kind=5）开放，其余恒永久
        expireEnabled(att) {
            return att.item_type === 1 || ((att.item_type === 3 || att.item_type === 7) && att.kind === 5);
        },
        kindName(kind) {
            const names = { 0: "未知", 1: "装备", 2: "消耗品", 3: "材料", 5: "宠物本体", 6: "宠物装备", 7: "宠物消耗品", 8: "时装", 9: "时装徽章", 10: "副职业材料", 12: "公会勋章", 13: "守护珠" };
            return names[kind] || `种类${kind}`;
        },
        async loadRoles() {
            const mid = this.itemsMid.trim();
            if (!mid) {
                this.itemsErrors = { ...this.itemsErrors, mid: "账号不能为空" };
                return;
            }
            if (!this.itemsKey.trim()) {
                this.itemsErrors = { ...this.itemsErrors, key: "管理密钥不能为空" };
                return;
            }
            this.itemsErrors = { mid: "", key: "", role: "", title: "" };
            this.itemsLoadingRoles = true;
            this.itemsRoles = [];
            this.itemsRoleId = "";
            const data = await this.callApi(api.getRoles(mid, this.itemsKey.trim()), { errorTitle: "查询角色失败" });
            this.itemsLoadingRoles = false;
            if (!data) return;
            this.saveAuthKey();
            const roles = data.roles || [];
            if (!roles.length) {
                await alertModal({ title: "无角色", message: `账号 ${mid} 下没有角色。` });
                return;
            }
            this.itemsRoles = roles;
            this.itemsRoleId = String(roles[0].character_id);
        },
        async doClearMailbox() {
            const mid = this.itemsMid.trim();
            if (!mid) {
                this.itemsErrors = { ...this.itemsErrors, mid: "账号不能为空" };
                return;
            }
            if (!this.itemsKey.trim()) {
                this.itemsErrors = { ...this.itemsErrors, key: "管理密钥不能为空" };
                return;
            }
            if (!this.itemsRoleId) {
                this.itemsErrors = { ...this.itemsErrors, role: "请选择角色" };
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            const role = this.itemsRoles.find(r => String(r.character_id) === this.itemsRoleId);
            const roleName = role ? role.name : `角色ID ${this.itemsRoleId}`;
            const confirmed = await confirmModal({
                title: "清空邮件确认",
                message: `将清空角色「${roleName}」收件箱内全部未删除邮件（含保管与已过期邮件，未领取的附件与金币一并失效），该操作不可恢复。确认继续？`,
                confirmText: "确认清空",
                cancelText: "取消"
            });
            if (!confirmed) return;
            this.clearingMailbox = true;
            const data = await this.callApi(api.clearMailbox(mid, Number(this.itemsRoleId), this.itemsKey.trim()), { errorTitle: "清空邮件失败" });
            this.clearingMailbox = false;
            if (!data) return;
            this.saveAuthKey();
            await alertModal({
                title: data.deleted_count ? "清空成功" : "无需清理",
                message: data.deleted_count
                    ? `已对角色「${data.character_name || roleName}」的 ${data.deleted_count} 封邮件打删除标记。`
                    : `角色「${data.character_name || roleName}」收件箱没有可清理的邮件。`
            });
        },
        addAttachment() {
            const incomplete = this.itemsList.find(a => a.item_type === "" || !a.kind || !a.item_id || a.count < 1);
            if (incomplete) {
                alertModal({ title: "附件不完整", message: "请将当前物品填写完整（物品类型、物品ID、数量），再添加下一个物品。" });
                return;
            }
            this.itemsList.push(this.createAttachment());
        },
        createAttachment() {
            return { item_id: 0, count: 1, kind: 3, upgrade_level: 0, amplify_type: 0, item_type: 0, pet_serial_or_handle: 0, expire_time: 0, expire_days: 0 };
        },
        removeAttachment(index) {
            this.itemsList.splice(index, 1);
        },
        // 级联选择回调：路径 [item_type, kind]；按序复用既有字段联动重置逻辑
        onTypeKindChange(att, val) {
            const [itemType, kind] = Array.isArray(val) ? val : [];
            if (itemType === undefined || kind === undefined) return;
            this.updateAttachment(att, "item_type", itemType);
            this.updateAttachment(att, "kind", kind);
        },
        updateAttachment(att, field, value) {
            const num = Number(value) || 0;
            att[field] = num;
            if (field === "item_type") {
                const valid = this.validKinds(num);
                if (!valid.includes(att.kind)) att.kind = valid[0] || 0;
                if (this.isNonStackable(att.kind)) att.count = 1;
                att.upgrade_level = 0;
                att.amplify_type = 0;
                if (!this.expireEnabled(att)) {
                    att.expire_days = 0;
                    att.expire_time = 0;
                }
            }
            if (field === "kind") {
                if (this.isNonStackable(num)) att.count = 1;
                att.upgrade_level = 0;
                att.amplify_type = 0;
                if (num !== 5) {
                    att.pet_serial_or_handle = 0;
                }
                if (!this.expireEnabled(att)) {
                    att.expire_days = 0;
                    att.expire_time = 0;
                }
            }
            if (field === "expire_days") {
                att.expire_time = this.expireEnabled(att) && num > 0 ? Math.floor(Date.now() / 1000) + num * 86400 : 0;
                if (!this.expireEnabled(att) && num > 0) att.expire_days = 0;
            }
            if (field === "amplify_type" && num === 128) {
                att.upgrade_level = 0;
            }
        },
        validateSendItems() {
            const e = { mid: "", key: "", role: "", title: "" };
            if (!this.itemsMid.trim()) e.mid = "账号不能为空";
            if (!this.itemsKey.trim()) e.key = "管理密钥不能为空";
            if (!this.itemsRoleId) e.role = "请选择角色";
            if (!this.itemsTitle.trim()) e.title = "邮件标题不能为空";
            this.itemsErrors = e;
            return !e.mid && !e.key && !e.role && !e.title;
        },
        async doSendItems() {
            if (!this.validateSendItems()) return;
            if (!(await this.ensureGatewayOnline())) return;
            if (!this.itemsList.length) {
                await alertModal({ title: "物品为空", message: "请至少添加一个物品附件。" });
                return;
            }
            const incomplete = this.itemsList.find(a => !a.item_id || !a.kind || a.count < 1);
            if (incomplete) {
                await alertModal({ title: "附件不完整", message: "每个附件都需要填写物品ID、选择物品种类，且数量不能小于 1。" });
                return;
            }
            // 非堆叠类型数量恒为 1；堆叠类型（2/3/7/9/10/13）无单条上限，
            // 网关按同 item_id 合并后自动拆分附件与多封投递
            const invalidCount = this.itemsList.find(a => this.isNonStackable(a.kind) && a.count !== 1);
            if (invalidCount) {
                await alertModal({ title: "数量超限", message: "不可堆叠物品（装备/时装/宠物本体/宠物装备/公会勋章）数量必须为 1。" });
                return;
            }
            const mismatch = this.itemsList.find(a => !this.validKinds(a.item_type).includes(a.kind));
            if (mismatch) {
                await alertModal({ title: "种类与背包不匹配", message: "物品种类与背包类型不匹配，请检查后重试。" });
                return;
            }
            this.loading = true;
            this.itemsList.forEach(a => {
                a.expire_time = this.expireEnabled(a) && a.expire_days > 0 ? Math.floor(Date.now() / 1000) + a.expire_days * 86400 : 0;
            });
            const data = await this.callApi(api.sendItems(this.itemsMid.trim(), Number(this.itemsRoleId), this.itemsTitle.trim(), this.itemsBody.trim(), this.itemsList, this.itemsKey.trim()), {
                errorTitle: "发放失败"
            });
            this.loading = false;
            if (!data) return;
            this.saveAuthKey();
            const summary = [];
            if (data.character_name) summary.push(`角色：${data.character_name}`);
            if (data.mail_count) summary.push(`${data.mail_count} 封邮件`);
            await alertModal({
                title: "发放成功",
                message: `物品已通过系统邮件投递${summary.length ? "（" + summary.join("，") + "）" : ""}。`
            });
        },
        async callApi(promise, { errorTitle = "操作失败" } = {}) {
            try {
                const data = await promise;
                if (!data || !data.success) {
                    await alertModal({ title: errorTitle, message: (data && data.message) || "操作失败" });
                    return null;
                }
                return data;
            } catch (err) {
                await alertModal({
                    title: errorTitle,
                    message: "网络错误，请确认本地开发代理已启用（仅开发环境可访问网关）。"
                });
                return null;
            }
        }
    }
};
</script>

<template>
    <div class="send-item">
        <header class="page-head">
            <div class="head-text">
                <h1 class="page-title">物品发放</h1>
                <p class="page-desc">通过系统邮件向角色投递物品，大数量堆叠由网关自动拆分为多封</p>
            </div>
            <span class="service-badge" :class="{ online: serviceOnline === true, offline: serviceOnline === false }">
                <span class="dot"></span>{{ serviceOnline === true ? "网关在线" : serviceOnline === false ? "网关离线" : "检测中" }}
            </span>
        </header>

        <section class="panel">
            <div class="panel-title">收件目标</div>
            <div class="target-row">
                <div class="field grow" :class="{ 'is-error': itemsErrors.mid }">
                    <span class="field-label">账号</span>
                    <el-input v-model="itemsMid" placeholder="目标账号" clearable @update:model-value="itemsErrors.mid = ''" />
                    <span v-if="itemsErrors.mid" class="field-error">{{ itemsErrors.mid }}</span>
                </div>
                <div class="field grow" :class="{ 'is-error': itemsErrors.key }">
                    <span class="field-label">
                        管理密钥
                        <span v-if="keyRemembered" class="key-chip">
                            已记忆
                            <button class="key-forget" title="清除缓存的密钥" @click="forgetKey">×</button>
                        </span>
                    </span>
                    <el-input v-model="itemsKey" type="password" show-password placeholder="管理接口授权密钥" @update:model-value="itemsErrors.key = ''" />
                    <span v-if="itemsErrors.key" class="field-error">{{ itemsErrors.key }}</span>
                </div>
                <el-button class="query-btn" plain :loading="itemsLoadingRoles" @click="loadRoles">查询角色</el-button>
            </div>

            <template v-if="itemsRoles.length">
                <div class="target-row">
                    <div class="field grow" :class="{ 'is-error': itemsErrors.role }">
                        <span class="field-label">收件角色</span>
                        <el-select v-model="itemsRoleId" placeholder="请选择角色" filterable popper-class="ep-popper-dark" @update:model-value="itemsErrors.role = ''">
                            <el-option v-for="r in itemsRoles" :key="r.character_id" :value="String(r.character_id)" :label="roleLabel(r)" />
                        </el-select>
                        <span v-if="itemsErrors.role" class="field-error">{{ itemsErrors.role }}</span>
                    </div>
                    <el-button class="clear-btn" type="danger" plain :loading="clearingMailbox" @click="doClearMailbox">清空邮件</el-button>
                </div>
            </template>
        </section>

        <section class="panel">
            <div class="panel-head">
                <div class="panel-title">
                    邮件附件
                    <span class="count-chip">{{ itemsList.length }}</span>
                </div>
                <el-button plain size="small" @click="addAttachment">＋ 添加物品</el-button>
            </div>

            <div v-if="!itemsList.length" class="empty-state">
                <p>尚未添加物品附件</p>
                <p class="empty-sub">支持全部可发放类型：装备、消耗品、材料、时装、宠物系、时装徽章、副职业材料、公会勋章、守护珠</p>
                <el-button plain size="small" @click="addAttachment">＋ 添加第一个物品</el-button>
            </div>

            <div v-else class="attachment-grid">
                <div v-for="(att, idx) in itemsList" :key="idx" class="att-card">
                    <div class="att-top">
                        <span class="att-no">#{{ idx + 1 }}</span>
                        <button class="att-remove" title="移除" @click="removeAttachment(idx)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                    <div class="att-fields">
                        <div class="field">
                            <span class="att-label">类型 / 种类</span>
                            <el-cascader
                                :model-value="[att.item_type, att.kind]"
                                :options="typeKindOptions"
                                placeholder="背包类型 / 物品种类"
                                popper-class="ep-popper-dark"
                                @change="v => onTypeKindChange(att, v)" />
                        </div>
                        <div class="field">
                            <span class="att-label">物品ID</span>
                            <el-input-number
                                :model-value="att.item_id"
                                :min="0"
                                :max="2147483647"
                                step-strictly
                                controls-position="right"
                                placeholder="物品模板ID"
                                class="block-input"
                                @change="v => updateAttachment(att, 'item_id', v)" />
                        </div>
                        <div class="field">
                            <span class="att-label">数量{{ isNonStackable(att.kind) ? "（固定 1）" : "" }}</span>
                            <el-input-number
                                :model-value="att.count"
                                :min="1"
                                controls-position="right"
                                placeholder="1"
                                class="block-input"
                                :disabled="isNonStackable(att.kind)"
                                @change="v => updateAttachment(att, 'count', v)" />
                        </div>
                        <template v-if="isEquipLike(att.kind)">
                            <div class="field">
                                <span class="att-label">红字类型</span>
                                <el-select :model-value="att.amplify_type" popper-class="ep-popper-dark" @change="v => updateAttachment(att, 'amplify_type', v)">
                                    <el-option :value="0" label="无红字" />
                                    <el-option :value="1" label="体力" />
                                    <el-option :value="2" label="精神" />
                                    <el-option :value="3" label="力量" />
                                    <el-option :value="4" label="智力" />
                                    <el-option :value="128" label="未净化" />
                                </el-select>
                            </div>
                            <div class="field">
                                <span class="att-label">强化等级</span>
                                <el-input-number
                                    :model-value="att.upgrade_level"
                                    :min="0"
                                    :max="att.amplify_type === 128 ? 0 : 31"
                                    controls-position="right"
                                    class="block-input"
                                    :disabled="att.amplify_type === 128"
                                    @change="v => updateAttachment(att, 'upgrade_level', v)" />
                            </div>
                        </template>
                        <div v-if="expireEnabled(att)" class="field">
                            <span class="att-label">限时天数</span>
                            <el-select :model-value="att.expire_days" popper-class="ep-popper-dark" @change="v => updateAttachment(att, 'expire_days', v)">
                                <el-option v-for="d in expireDayOptions" :key="d" :value="d" :label="d === 0 ? '无期限' : `${d} 天`" />
                            </el-select>
                        </div>
                    </div>
                    <p class="att-tip">
                        种类须与物品 ID 实际类型一致，否则领取后落入错误背包{{ isEquipLike(att.kind) ? "；强化/红字仅对装备与公会勋章生效" : ""
                        }}{{ expireEnabled(att) ? "；到期时间以提交时刻起算" : "" }}
                    </p>
                </div>
            </div>
        </section>

        <footer class="action-bar">
            <span class="stat-text"
                >共 {{ itemsList.length }} 个附件<template v-if="itemsList.length"> · 预计投递 {{ mailEstimate }} 封邮件</template></span
            >
            <div class="bar-actions">
                <el-button link @click="backToLogin">返回登录</el-button>
                <el-button type="primary" :disabled="!itemsRoles.length" :loading="loading" @click="doSendItems">确认发放</el-button>
            </div>
        </footer>
    </div>
</template>

<style scoped>
.send-item {
    max-width: 1040px;
    width: 100%;
    margin: auto;
    font-family: system-ui, sans-serif;
}
.page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
}
.page-title {
    margin: 0 0 6px;
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text);
}
.page-desc {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
}
.service-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    background: var(--outline-3-hover-bg);
    border: 1px solid var(--surface-border);
    font-size: 0.72rem;
    color: var(--text-muted);
    user-select: none;
    white-space: nowrap;
}
.service-badge .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
}
.service-badge.online {
    color: #3ddc84;
}
.service-badge.online .dot {
    background: #3ddc84;
    box-shadow: 0 0 6px rgba(61, 220, 132, 0.6);
}
.service-badge.offline {
    color: var(--error);
}
.service-badge.offline .dot {
    background: var(--error);
}

.panel {
    background: var(--surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--surface-border);
    border-radius: 14px;
    padding: 18px 20px 20px;
    margin-bottom: 16px;
}
.panel-head,
.panel-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-label);
    letter-spacing: 1px;
}
.panel-head {
    justify-content: space-between;
}
.panel-title::before {
    content: "";
    width: 4px;
    height: 14px;
    background: var(--accent-gradient);
    border-radius: 2px;
}
.panel-head .panel-title {
    margin-bottom: 0;
}
.count-chip {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: rgba(91, 140, 255, 0.15);
    color: var(--accent);
    font-size: 0.7rem;
    letter-spacing: 0;
}

.target-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
}
.target-row + .target-row {
    margin-top: 14px;
}
.field.grow,
.grow {
    flex: 1;
}
.field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
}
.field-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.74rem;
    color: var(--text-muted);
}
.att-label {
    font-size: 0.7rem;
    color: var(--text-muted);
}
.field-error {
    font-size: 0.72rem;
    color: var(--error);
}
.field.is-error :deep(.el-input__wrapper),
.field.is-error :deep(.el-select__wrapper) {
    box-shadow: 0 0 0 1px var(--error) inset;
}
.query-btn,
.clear-btn {
    margin-top: 21px;
    flex-shrink: 0;
}
.key-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border-radius: 4px;
    background: rgba(61, 220, 132, 0.12);
    color: #3ddc84;
    font-size: 0.66rem;
    letter-spacing: 0;
}
.key-forget {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.7;
}
.key-forget:hover {
    opacity: 1;
}

.empty-state {
    border: 1px dashed var(--divider);
    border-radius: 12px;
    padding: 36px 16px;
    text-align: center;
}
.empty-state p {
    margin: 0 0 6px;
    font-size: 0.85rem;
    color: var(--text-muted);
}
.empty-state .empty-sub {
    font-size: 0.72rem;
    opacity: 0.75;
    margin-bottom: 14px;
}

.attachment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 12px;
}
.att-card {
    position: relative;
    border: 1px solid var(--divider);
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--outline-3-hover-bg);
    transition: border-color 0.2s;
}
.att-card:hover {
    border-color: var(--outline-3-hover-border);
}
.att-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}
.att-no {
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
}
.att-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 3px;
    display: flex;
    border-radius: 5px;
    transition:
        color 0.2s,
        background 0.2s;
}
.att-remove:hover {
    color: var(--error);
    background: rgba(255, 91, 110, 0.1);
}
.att-remove svg {
    width: 13px;
    height: 13px;
}
.att-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
}
.block-input {
    width: 100%;
}
.block-input :deep(.el-input__inner) {
    text-align: left;
}
.att-tip {
    margin: 10px 0 0;
    font-size: 0.68rem;
    line-height: 1.5;
    color: var(--text-muted);
    opacity: 0.85;
}

.action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 2px 8px;
}
.stat-text {
    font-size: 0.78rem;
    color: var(--text-muted);
}
.bar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
}

@media (max-width: 720px) {
    .target-row {
        flex-wrap: wrap;
    }
    .query-btn,
    .clear-btn {
        margin-top: 0;
    }
    .attachment-grid {
        grid-template-columns: 1fr;
    }
}
</style>
