<script>
import { ElButton, ElCascader, ElCheckbox, ElInput, ElSelect, ElOption, ElInputNumber } from "element-plus";
import { useGameStore } from "@/stores/game";
import { alertModal, confirmModal } from "@/hooks/useModal";
import { api } from "@/utils/gateway";
import { getBranchOptions, getAwakeningOptions, growLabel, JOB_NAMES } from "@/utils/jobGrowNames";

// 物品种类（对齐网关 ItemCore 枚举与 validateItemSpec 校验，kind 必填 1-14）：
// 主背包(0|2)配 1=装备/2=消耗品/3=材料/4=任务品/9=时装徽章/10=副职业材料/12=公会勋章/13=守护珠；
// 时装(1)配 8=时装；宠物(3|7)配 5=宠物本体/6=宠物装备/7=宠物消耗品。
// 0=未知非法；11=特殊材料（账号仓库物品）与 14=史诗碎片（账号图鉴通道）拒收。
const ITEM_TYPE_OPTIONS = [
    { value: 0, label: "主背包" },
    { value: 1, label: "时装" },
    { value: 3, label: "宠物" }
];

// 限时天数固定档位（0=无期限），协议 expire_time 按提交时刻 + 天数换算
const EXPIRE_DAY_OPTIONS = [0, 1, 3, 5, 7, 15, 30];

// 清空背包分类（对齐网关 CMD_CLEAR_INVENTORY categories 白名单 1-10、12、13，
// 取值 = 权威 ItemKind 值；分组仅作前端展示，下发保持原值）。不在清除范围：
// 个人/账号仓库、穿戴栏、快捷栏、货币槽、晶块/灵魂、特殊材料、史诗碎片。
const INVENTORY_CATEGORY_OPTIONS = [
    { value: 1, label: "物品栏·装备", group: "物品栏" },
    { value: 2, label: "物品栏·消耗品", group: "物品栏" },
    { value: 3, label: "物品栏·材料", group: "物品栏" },
    { value: 4, label: "物品栏·任务", group: "物品栏" },
    { value: 10, label: "物品栏·副职业", group: "物品栏" },
    { value: 9, label: "装扮·徽章", group: "装扮" },
    { value: 8, label: "装扮·装扮", group: "装扮" },
    { value: 5, label: "宠物·宠物", group: "宠物" },
    { value: 6, label: "宠物·宠物装备", group: "宠物" },
    { value: 7, label: "宠物·消耗品", group: "宠物" },
    { value: 12, label: "勋章·勋章", group: "勋章" },
    { value: 13, label: "勋章·守护珠", group: "勋章" }
];

// 清空背包分组选项（级联/分组展示用）
const INVENTORY_CATEGORY_GROUPS = [
    { value: "item", label: "物品栏", children: [] },
    { value: "avatar", label: "装扮", children: [] },
    { value: "pet", label: "宠物", children: [] },
    { value: "medal", label: "勋章", children: [] }
].map(g => ({
    ...g,
    children: INVENTORY_CATEGORY_OPTIONS.filter(o => o.group === g.label).map(o => ({ value: o.value, label: o.label.replace(`${g.label}·`, "") }))
}));

// 清空背包分类展示文案（结果明细用）
const INVENTORY_CATEGORY_NAMES = INVENTORY_CATEGORY_OPTIONS.reduce((acc, o) => {
    acc[o.value] = o.label;
    return acc;
}, {});

// 转职分支（grow_first 0-5）与觉醒档位（grow_second 0-2），对齐网关 grow_type 编码 (second<<4|first)
const GROW_FIRST_OPTIONS = [
    { value: 0, label: "未转职" },
    { value: 1, label: "转职分支 1" },
    { value: 2, label: "转职分支 2" },
    { value: 3, label: "转职分支 3" },
    { value: 4, label: "转职分支 4" },
    { value: 5, label: "转职分支 5" }
];
const GROW_SECOND_OPTIONS = [
    { value: 0, label: "未觉醒" },
    { value: 1, label: "一次觉醒" },
    { value: 2, label: "二次觉醒" }
];
// 转职/觉醒档位的参考等级门槛（86 版本：15 级转职、50 级一觉、75 级二觉；
// 前端展示层约定，防误操作；协议层只校验取值范围与组合关系，见 docs/gateway-update-role.md §3.3）
const TRANSFER_MIN_LEVEL = 15;
const AWAKEN_MIN_LEVEL = { 1: 50, 2: 75 };
const ROLE_LEVEL_MAX = 86;

export default {
    name: "SendItemView",
    components: { ElButton, ElCascader, ElCheckbox, ElInput, ElSelect, ElOption, ElInputNumber },
    setup() {
        const store = useGameStore();
        return {
            store,
            // 模板内直接使用的协议常量（Options API 下经 setup 返回值暴露）
            GROW_FIRST_OPTIONS,
            GROW_SECOND_OPTIONS,
            TRANSFER_MIN_LEVEL,
            AWAKEN_MIN_LEVEL,
            ROLE_LEVEL_MAX,
            INVENTORY_CATEGORY_GROUPS
        };
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
            // ── 清空背包（CMD_CLEAR_INVENTORY）面板状态 ──
            clearInvSelected: [],
            clearingInventory: false,
            // ── 修改角色（CMD_UPDATE_ROLE）面板状态：三组修改独立启用，未启用组不下发 ──
            roleEnableName: false,
            roleEnableLevel: false,
            roleEnableGrow: false,
            roleName: "",
            roleLevel: null,
            roleGrowFirst: null,
            roleGrowSecond: null,
            updatingRole: false,
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
        },
        // 当前选中角色（修改角色面板的参照值来源）
        selectedRole() {
            return this.itemsRoles.find(r => String(r.character_id) === this.itemsRoleId) || null;
        },
        // 参考等级：启用等级修改时取目标输入等级，否则取所选角色当前等级
        roleRefLevel() {
            if (this.roleEnableLevel && this.roleLevel != null) return Number(this.roleLevel);
            return this.selectedRole ? Number(this.selectedRole.level) || 0 : 0;
        },
        // 前置关系判定（详见 docs/gateway-update-role.md §3）：
        // 未转职 -> 觉醒锁定为未觉醒；转职与觉醒档位受参考等级门槛约束（15 级转职 / 50 级一觉 / 75 级二觉）
        roleGrowBlocked() {
            if (!this.roleEnableGrow) return null;
            const first = this.roleGrowFirst;
            const second = this.roleGrowSecond;
            if (first == null || second == null) return "请选择转职分支与觉醒档位";
            if (first === 0 && second !== 0) return "未转职的角色不能设置觉醒档位";
            const ref = this.roleRefLevel;
            if (first !== 0 && ref < TRANSFER_MIN_LEVEL) {
                return `转职要求参考等级 ≥ ${TRANSFER_MIN_LEVEL}，当前参考等级为 ${ref}（请将目标等级一并调高后提交）`;
            }
            const min = AWAKEN_MIN_LEVEL[second];
            if (min != null && ref < min) {
                return `一次/二次觉醒要求参考等级 ≥ ${min}，当前参考等级为 ${ref}（请将目标等级一并调高后提交）`;
            }
            return null;
        },
        // 等级与觉醒双向约束（docs/gateway-update-role.md §3.4）：
        // 设等级时以最终形态（启用转职/觉醒取下拉值，否则角色当前档位）校验门槛，
        // 拦截「高觉醒角色把等级改至门槛之下」的反向破坏形态；仅改名不触发
        roleLevelBlocked() {
            if (!this.roleEnableLevel || this.roleLevel == null) return null;
            const target = Number(this.roleLevel);
            const role = this.selectedRole;
            const cur = role ? this.growParts(role.grow_type) : { first: 0, second: 0 };
            const finalFirst = this.roleEnableGrow ? this.roleGrowFirst : cur.first;
            const finalSecond = this.roleEnableGrow ? this.roleGrowSecond : cur.second;
            if (finalFirst !== 0 && target < TRANSFER_MIN_LEVEL) {
                return `等级 ${target} 低于转职门槛 ${TRANSFER_MIN_LEVEL}，无法保持当前转职状态（需 ≥ ${TRANSFER_MIN_LEVEL}）`;
            }
            if (finalSecond === 1 && target < AWAKEN_MIN_LEVEL[1]) {
                return `等级 ${target} 低于一次觉醒门槛 ${AWAKEN_MIN_LEVEL[1]}，无法保持当前一觉状态（需 ≥ ${AWAKEN_MIN_LEVEL[1]}）`;
            }
            if (finalSecond === 2 && target < AWAKEN_MIN_LEVEL[2]) {
                return `等级 ${target} 低于二次觉醒门槛 ${AWAKEN_MIN_LEVEL[2]}，无法保持当前二觉状态（需 ≥ ${AWAKEN_MIN_LEVEL[2]}）`;
            }
            return null;
        },
        // 至少启用一组修改才可提交（避免网关 1019 往返），且须通过等级门槛双向校验
        roleUpdateReady() {
            const nameOn = this.roleEnableName && !!this.roleName.trim();
            const levelOn = this.roleEnableLevel && this.roleLevel != null && !this.roleLevelBlocked;
            const growOn = this.roleEnableGrow && !this.roleGrowBlocked;
            return nameOn || levelOn || growOn;
        },
        // 角色基础职业是否在枚举表中（不在时觉醒下拉回退泛化档位文案）
        roleJobIndexed() {
            return getBranchOptions(this.selectedRole?.job) != null;
        },
        // 转职下拉选项：按角色基础职业动态生成（真实分支名），无表回退泛化选项。
        // 角色当前已落在表外分支（如协议允许但枚举未收录的 5 转）时，追加当前值兜底项避免显示裸数字
        roleBranchOptions() {
            const options = getBranchOptions(this.selectedRole?.job);
            if (!options) return GROW_FIRST_OPTIONS;
            if (!this.selectedRole) return options;
            const curFirst = this.growParts(this.selectedRole.grow_type).first;
            if (curFirst && !options.some(o => o.value === curFirst)) {
                options.push({ value: curFirst, label: `${this.jobName(this.selectedRole.job)}·分支${curFirst}（当前）` });
            }
            return options;
        },
        // 觉醒下拉选项：按所选分支觉醒名单驱动；二觉名缺失则不出二觉选项。
        // 注意不受「转职/觉醒」启用开关门控——否则查询后未勾选时下拉缺项，
        // 已二觉角色的当前值（如「二次觉醒：帝血弑天」）会回显为空白（2026-08-27 实测缺陷）；
        // 是否可改由 :disabled 控制
        roleAwakenOptions() {
            const prefix = { 1: "一次觉醒", 2: "二次觉醒" };
            return getAwakeningOptions(this.selectedRole?.job, this.roleGrowFirst).map(o => ({ ...o, label: `${prefix[o.value]}：${o.label}` }));
        },
        // 当前觉醒档位不在选项集内时的兜底项（如表外分支无名单而角色实际二觉），null 表示不需要
        roleSecondFallback() {
            const second = this.roleGrowSecond;
            if (!(second > 0)) return null;
            if (this.roleAwakenOptions.some(o => o.value === second)) return null;
            if (!this.roleJobIndexed && [1, 2].includes(second)) return null;
            return { value: second, label: `${this.growOptionLabel(GROW_SECOND_OPTIONS, second)}（当前）` };
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
            const v = job ?? 0;
            return JOB_NAMES[v] || `职业${job}`;
        },
        // 角色标签：基础职业（RoleInfo.job，proto3 下 job=0 缺失回退鬼剑士男）+
        // 完整成长形态（转职·觉醒，经职业枚举表解析，未知分支回退泛化文案）
        roleLabel(role) {
            const job = Number(role.job) || 0;
            const parts = this.growParts(role.grow_type);
            const grow = growLabel(job, parts.first, parts.second);
            const growText = grow != null ? grow : this.growComboLabel(job, parts.first, parts.second);
            return `${role.name} (Lv${role.level} / ${this.jobName(job)}${growText ? ` · ${growText}` : ""})`;
        },
        // grow_type 解码：低 4 位转职分支、高 4 位觉醒档位（(second<<4)|first）
        growParts(growType) {
            const v = Number(growType) || 0;
            return { first: v & 0xf, second: (v >> 4) & 0xf };
        },
        growOptionLabel(options, value) {
            const hit = options.find(o => o.value === value);
            return hit ? hit.label : `档位${value}`;
        },
        // 组合展示文案：有枚举表时用「转职名·觉醒名」，否则回退泛化档位文案
        growComboLabel(job, first, second) {
            const label = growLabel(job, first, second);
            if (label != null) return label;
            return `${this.growOptionLabel(GROW_FIRST_OPTIONS, first)} + ${this.growOptionLabel(GROW_SECOND_OPTIONS, second)}`;
        },
        onRoleEnableGrowToggle(on) {
            this.roleEnableGrow = !!on;
            if (!on) return;
            if (this.roleGrowFirst == null) this.roleGrowFirst = this.selectedRole ? this.growParts(this.selectedRole.grow_type).first : 0;
            if (this.roleGrowSecond == null) this.roleGrowSecond = this.selectedRole ? this.growParts(this.selectedRole.grow_type).second : 0;
            // 未转职前置：分支为 0 时锁定觉醒为未觉醒
            if (this.roleGrowFirst === 0) this.roleGrowSecond = 0;
        },
        onRoleGrowFirstChange(v) {
            this.roleGrowFirst = v;
            // 未转职 -> 觉醒必须为未觉醒；切到无可觉醒数据的分支时同样归零
            if (!v || !getAwakeningOptions(this.selectedRole?.job, v).length) {
                this.roleGrowSecond = 0;
                return;
            }
            // 切换后当前觉醒档位超出新分支名单（如新分支仅一觉）时钳回一觉
            if (this.roleGrowSecond > 0 && !getAwakeningOptions(this.selectedRole?.job, v).some(o => o.value === this.roleGrowSecond)) {
                this.roleGrowSecond = 1;
            }
        },
        async doUpdateRole() {
            if (!this.itemsMid.trim()) {
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
            const role = this.selectedRole;
            if (!role) return;
            if (this.roleEnableGrow && this.roleGrowBlocked) {
                await alertModal({ title: "转职/觉醒门槛未满足", message: this.roleGrowBlocked });
                return;
            }
            if (this.roleEnableLevel && this.roleLevelBlocked) {
                await alertModal({ title: "等级门槛未满足", message: this.roleLevelBlocked });
                return;
            }
            if (!this.roleUpdateReady) {
                await alertModal({ title: "未选择修改项", message: "请至少启用并填写一项修改内容。" });
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;

            const changes = {};
            const summaryLines = [];
            let nameOn = false;
            if (this.roleEnableName && this.roleName.trim()) {
                // 回显机制下启用改名但未改动（与当前名相同）视为无操作，不进入变更集
                if (this.roleName.trim() === role.name) {
                    await alertModal({ title: "改名未变化", message: `新角色名与当前角色名「${role.name}」相同，如需改名请修改内容。` });
                    return;
                }
                nameOn = true;
                changes.name = this.roleName.trim();
                summaryLines.push(`改名：${role.name} → ${changes.name}`);
            } else if (this.roleEnableName) {
                await alertModal({ title: "改名未填写", message: "已启用改名但未填写新角色名。" });
                return;
            }
            if (this.roleEnableLevel && this.roleLevel != null) {
                if (this.roleLevel < 1 || this.roleLevel > ROLE_LEVEL_MAX) {
                    await alertModal({ title: "等级超出范围", message: `等级须为 1-${ROLE_LEVEL_MAX}。` });
                    return;
                }
                changes.level = Number(this.roleLevel);
                summaryLines.push(`等级：Lv${role.level} → Lv${changes.level}`);
            }
            if (this.roleEnableGrow && !this.roleGrowBlocked) {
                const cur = this.growParts(role.grow_type);
                changes.grow_first = Number(this.roleGrowFirst);
                changes.grow_second = Number(this.roleGrowSecond);
                summaryLines.push(`转职/觉醒：${this.growComboLabel(role.job, cur.first, cur.second)} → ${this.growComboLabel(role.job, changes.grow_first, changes.grow_second)}`);
            }

            const willResetSkills =
                (changes.level != null && changes.level !== role.level) ||
                (changes.grow_first != null && (changes.grow_first !== this.growParts(role.grow_type).first || changes.grow_second !== this.growParts(role.grow_type).second));
            const confirmed = await confirmModal({
                title: "修改角色确认",
                message: [
                    `目标角色：「${role.name}」`,
                    ...summaryLines.map(l => `· ${l}`),
                    "",
                    willResetSkills ? "实际变更等级或转职/觉醒将清空该角色全部已学技能，下次选角自动重建。" : "",
                    "仅对离线角色生效；在线角色的修改会被服务端内存态覆盖。是否继续？"
                ]
                    .filter(Boolean)
                    .join("\n"),
                confirmText: "确认修改",
                cancelText: "取消"
            });
            if (!confirmed) return;

            this.updatingRole = true;
            const data = await this.callApi(api.updateRole(this.itemsMid.trim(), Number(this.itemsRoleId), changes, this.itemsKey.trim()), { errorTitle: "修改角色失败" });
            this.updatingRole = false;
            if (!data) return;
            this.saveAuthKey();
            const flags = [];
            if (data.name_updated) flags.push("改名");
            if (data.level_updated) flags.push(`等级 Lv${data.level}`);
            if (data.grow_type_updated) flags.push("转职/觉醒");
            if (data.skills_reset) flags.push("已清空技能（下次选角重建）");
            await alertModal({
                title: "修改成功",
                message: [
                    flags.length ? `本次生效：${flags.join("、")}。` : "请求成功，但所有字段与当前值相同，均未发生变更。",
                    `当前值：${data.character_name} · Lv${data.level} · 累计经验 ${data.exp}`,
                    "若角色在线，需下线后重新选角才能看到修改结果。"
                ].join("\n")
            });
            // 成功后重查角色列表，刷新下拉中的名字/等级标签
            const mid = this.itemsMid.trim();
            const key = this.itemsKey.trim();
            const refreshed = await this.callApi(api.getRoles(mid, key), { errorTitle: "刷新角色失败" });
            if (refreshed && Array.isArray(refreshed.roles) && refreshed.roles.length) {
                this.itemsRoles = refreshed.roles;
                if (refreshed.roles.some(r => String(r.character_id) === this.itemsRoleId)) {
                    this.resetRoleForm(refreshed.roles.find(r => String(r.character_id) === this.itemsRoleId));
                }
            }
        },
        // 重置修改角色面板：各组开关关闭，但输入控件一律回显所查询角色的当前值
        // （名/等级/转职觉醒档位），启用开关仅解锁编辑——未启用时也能看到现状
        resetRoleForm(role) {
            const parts = role ? this.growParts(role.grow_type) : { first: 0, second: 0 };
            this.roleEnableName = false;
            this.roleEnableLevel = false;
            this.roleEnableGrow = false;
            this.roleName = role?.name ?? "";
            this.roleLevel = role ? Number(role.level) || null : null;
            this.roleGrowFirst = parts.first;
            this.roleGrowSecond = parts.second;
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
                    return [1, 2, 3, 4, 9, 10, 12, 13];
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
            const names = {
                0: "未知",
                1: "装备",
                2: "消耗品",
                3: "材料",
                4: "任务品",
                5: "宠物本体",
                6: "宠物装备",
                7: "宠物消耗品",
                8: "时装",
                9: "时装徽章",
                10: "副职业材料",
                12: "公会勋章",
                13: "守护珠"
            };
            return names[kind] || `种类${kind}`;
        },
        onRoleSelectChange(v) {
            this.itemsErrors.role = "";
            const role = this.itemsRoles.find(r => String(r.character_id) === String(v));
            this.resetRoleForm(role);
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
            this.resetRoleForm(roles[0]);
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
        onClearInvCategoryChange(v) {
            // 多选级联下第一级分组节点（value 为字符串）会随联动进入数组，需过滤，
            // 只保留叶子分类的数字值，避免分组占位值（NaN）混入提交的 categories
            this.clearInvSelected = (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        },
        clearInvCategoryName(category) {
            return INVENTORY_CATEGORY_NAMES[category] || `分类${category}`;
        },
        // 校验账号/密钥/角色（与 doClearMailbox 同一套前置检查），返回目标角色名
        async clearInvPreflight() {
            const mid = this.itemsMid.trim();
            if (!mid) {
                this.itemsErrors = { ...this.itemsErrors, mid: "账号不能为空" };
                return null;
            }
            if (!this.itemsKey.trim()) {
                this.itemsErrors = { ...this.itemsErrors, key: "管理密钥不能为空" };
                return null;
            }
            if (!this.itemsRoleId) {
                this.itemsErrors = { ...this.itemsErrors, role: "请选择角色" };
                return null;
            }
            if (!(await this.ensureGatewayOnline())) return null;
            const role = this.itemsRoles.find(r => String(r.character_id) === this.itemsRoleId);
            return role ? role.name : `角色ID ${this.itemsRoleId}`;
        },
        async doClearInventory() {
            const roleName = await this.clearInvPreflight();
            if (roleName == null) return;
            const categories = this.clearInvSelected;
            if (!categories.length) {
                await alertModal({ title: "未选择分类", message: "请至少选择一个清除分类。" });
                return;
            }
            const scopeLine = `分类：${categories.map(c => this.clearInvCategoryName(c)).join("、")}`;
            const confirmed = await confirmModal({
                title: "清空背包确认",
                message: [
                    `目标角色：「${roleName}」`,
                    `清除范围：${scopeLine}`,
                    "",
                    "将对选中分类的背包槽位执行物理删除（数量清为 0 的物品行一并移除），不可恢复。",
                    "不含仓库与穿戴栏：装备/货币/晶块/灵魂等始终保留。",
                    "仅对离线角色生效；在线角色的背包会被服务端内存态覆盖，请先下线再操作。是否继续？"
                ].join("\n"),
                confirmText: "确认清空",
                cancelText: "取消"
            });
            if (!confirmed) return;
            this.clearingInventory = true;
            const data = await this.callApi(api.clearInventory(this.itemsMid.trim(), Number(this.itemsRoleId), categories, this.itemsKey.trim()), { errorTitle: "清空背包失败" });
            this.clearingInventory = false;
            if (!data) return;
            this.saveAuthKey();
            const lines = [`目标角色：${data.character_name || roleName}`];
            const detail = (data.results || []).filter(r => r && r.deleted_count > 0);
            if (data.deleted_count > 0) {
                if (detail.length) {
                    lines.push(`共清除 ${data.deleted_count} 行物品，明细如下：`);
                    detail.forEach(r => lines.push(`· ${this.clearInvCategoryName(r.category)}：${r.deleted_count} 行`));
                } else {
                    lines.push(`共清除 ${data.deleted_count} 行物品。`);
                }
            } else {
                lines.push("所选分类下没有可清除的物品。");
            }
            lines.push("若角色在线，需下线后重新选角才能看到清理结果。");
            await alertModal({
                title: data.deleted_count ? "清空成功" : "无需清理",
                message: lines.join("\n")
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
        <!-- 顶部通栏菜单（header） -->
        <header class="app-header">
            <div class="header-brand">
                <span class="brand-mark">T</span>
                <div class="brand-text">
                    <h1 class="header-title">物品发放</h1>
                    <p class="header-desc">通过系统邮件向角色投递物品，大数量堆叠由网关自动拆分为多封</p>
                </div>
            </div>

            <div class="header-right">
                <button class="header-back" @click="backToLogin">返回登录</button>
                <span class="service-badge" :class="{ online: serviceOnline === true, offline: serviceOnline === false }">
                    <span class="dot"></span>{{ serviceOnline === true ? "网关在线" : serviceOnline === false ? "网关离线" : "检测中" }}
                </span>
            </div>
        </header>

        <div class="layout-body">
            <!-- 左侧 side：查询账号角色 -->
            <aside class="side">
                <section class="panel">
                    <div class="panel-title">查询账号角色</div>
                    <div class="target-col">
                        <div class="field" :class="{ 'is-error': itemsErrors.mid }">
                            <span class="field-label">账号</span>
                            <el-input v-model="itemsMid" placeholder="目标账号" clearable @update:model-value="itemsErrors.mid = ''" />
                            <span v-if="itemsErrors.mid" class="field-error">{{ itemsErrors.mid }}</span>
                        </div>
                        <div class="field" :class="{ 'is-error': itemsErrors.key }">
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
                        <div class="side-divider"></div>
                        <div class="field" :class="{ 'is-error': itemsErrors.role }">
                            <span class="field-label">收件角色</span>
                            <el-select v-model="itemsRoleId" placeholder="请选择角色" filterable popper-class="ep-popper-dark" @update:model-value="onRoleSelectChange">
                                <el-option v-for="r in itemsRoles" :key="r.character_id" :value="String(r.character_id)" :label="roleLabel(r)" />
                            </el-select>
                            <span v-if="itemsErrors.role" class="field-error">{{ itemsErrors.role }}</span>
                        </div>
                        <div class="side-divider"></div>
                        <div class="field">
                            <span class="field-label">清空背包分类</span>
                            <el-cascader
                                v-model="clearInvSelected"
                                :options="INVENTORY_CATEGORY_GROUPS"
                                :props="{ multiple: true, checkStrictly: false, emitPath: false, value: 'value', label: 'label', children: 'children' }"
                                :show-all-levels="false"
                                collapse-tags-tooltip
                                tag-type="primary"
                                tag-effect="plain"
                                clearable
                                filterable
                                placeholder="选择要清除的分类（可多选）"
                                popper-class="ep-popper-dark"
                                @update:model-value="onClearInvCategoryChange" />
                            <p class="att-tip">按物品类别清除对应背包槽位；不含仓库与穿戴栏，仅离线角色生效。</p>
                        </div>
                        <div class="side-actions">
                            <el-button class="clear-btn" type="danger" plain :loading="clearingMailbox" @click="doClearMailbox">清空邮件</el-button>
                            <el-button v-if="clearInvSelected.length" class="clear-btn" type="danger" plain :loading="clearingInventory" @click="doClearInventory">清空背包</el-button>
                        </div>
                    </template>
                </section>
            </aside>

            <!-- 右侧 main：其余功能卡片 -->
            <main class="main">
                <section v-if="itemsRoles.length" class="panel">
                    <div class="panel-head">
                        <div class="panel-title">修改角色</div>
                        <div v-if="selectedRole" class="role-baseline">
                            <span class="role-current"
                                >当前：<b>{{ selectedRole.name }}</b> · Lv{{ selectedRole.level }} · {{ jobName(selectedRole.job) }} ·
                                {{ growComboLabel(selectedRole.job, growParts(selectedRole.grow_type).first, growParts(selectedRole.grow_type).second) }}</span
                            >
                            <span class="role-update-hint">仅离线角色生效 · 改等级/转职觉醒会清空已学技能（下次选角自动重建）</span>
                        </div>
                    </div>

                    <div class="role-update-grid">
                        <div class="att-card role-group">
                            <el-checkbox :model-value="roleEnableName" @update:model-value="v => (roleEnableName = v)">改名</el-checkbox>
                            <div class="field">
                                <el-input v-model="roleName" :disabled="!roleEnableName" maxlength="9" show-word-limit placeholder="新角色名（中文/英文/数字）" clearable />
                                <p class="att-tip">默认回显当前名；修改后提交（2-18 个 GBK 字节，全服唯一）。</p>
                            </div>
                        </div>

                        <div class="att-card role-group">
                            <el-checkbox :model-value="roleEnableLevel" @update:model-value="v => (roleEnableLevel = v)">设等级</el-checkbox>
                            <div class="field">
                                <el-input-number v-model="roleLevel" :min="1" :max="ROLE_LEVEL_MAX" :disabled="!roleEnableLevel" controls-position="right" placeholder="1-86" class="block-input" />
                                <p class="att-tip">
                                    1-{{ ROLE_LEVEL_MAX }}；累计经验按内置阈值表联动写入。{{ TRANSFER_MIN_LEVEL }} 级转职、{{ AWAKEN_MIN_LEVEL[1] }} 级一觉、{{ AWAKEN_MIN_LEVEL[2] }} 级二觉。
                                </p>
                                <p v-if="roleLevelBlocked" class="grow-block-tip">{{ roleLevelBlocked }}</p>
                            </div>
                        </div>

                        <div class="att-card role-group">
                            <el-checkbox :model-value="roleEnableGrow" @update:model-value="onRoleEnableGrowToggle">转职 / 觉醒</el-checkbox>
                            <div class="role-grow-row">
                                <el-select v-model="roleGrowFirst" :disabled="!roleEnableGrow" popper-class="ep-popper-dark" placeholder="转职分支" @update:model-value="onRoleGrowFirstChange">
                                    <el-option v-for="o in roleBranchOptions" :key="o.value" :value="o.value" :label="o.label" />
                                </el-select>
                                <el-select v-model="roleGrowSecond" :disabled="!roleEnableGrow || roleGrowFirst === 0" popper-class="ep-popper-dark" placeholder="觉醒档位">
                                    <el-option :value="0" label="未觉醒" />
                                    <el-option v-if="roleSecondFallback" :key="'cur-' + roleSecondFallback.value" :value="roleSecondFallback.value" :label="roleSecondFallback.label" />
                                    <template v-if="roleAwakenOptions.length">
                                        <el-option v-for="o in roleAwakenOptions" :key="o.value" :value="o.value" :label="o.label" />
                                    </template>
                                    <template v-else-if="!roleJobIndexed && roleGrowFirst > 0">
                                        <el-option :value="1" label="一次觉醒" />
                                        <el-option :value="2" label="二次觉醒" />
                                    </template>
                                </el-select>
                            </div>
                            <p class="att-tip">
                                未转职或分支不支持觉醒时锁定未觉醒；转职要求参考等级 ≥ {{ TRANSFER_MIN_LEVEL
                                }}<template v-if="roleEnableGrow && roleGrowSecond > 0"
                                    >；{{ roleGrowSecond === 2 ? "二次" : "一次" }}觉醒要求参考等级 ≥ {{ AWAKEN_MIN_LEVEL[roleGrowSecond] }}</template
                                >。
                            </p>
                        </div>
                    </div>

                    <p v-if="roleGrowBlocked && roleEnableGrow" class="grow-block-tip">{{ roleGrowBlocked }}</p>

                    <div class="bar-actions role-submit-bar">
                        <el-button link @click="resetRoleForm(selectedRole)">重置信息</el-button>
                        <el-button type="primary" plain :disabled="!roleUpdateReady" :loading="updatingRole" @click="doUpdateRole">提交修改</el-button>
                    </div>
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

                    <div class="send-bar">
                        <span class="stat-text"
                            >共 {{ itemsList.length }} 个附件<template v-if="itemsList.length"> · 预计投递 {{ mailEstimate }} 封邮件</template></span
                        >
                        <div class="bar-actions">
                            <el-button type="primary" plain :disabled="!itemsRoles.length" :loading="loading" @click="doSendItems">确认发放</el-button>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    </div>
</template>

<style scoped>
.send-item {
    width: 100%;
    font-family: system-ui, sans-serif;
}

/* ── 顶部通栏菜单（header）── */
.app-header {
    position: sticky;
    top: 0;
    z-index: 50;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 20px;
    margin-bottom: 20px;
    background: rgba(10, 14, 26, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--surface-border);
}
.header-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
}
.brand-mark {
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--accent-gradient);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 1px;
    box-shadow: 0 4px 14px var(--accent-shadow);
    user-select: none;
}
.header-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text);
    line-height: 1.2;
}
.header-desc {
    margin: 2px 0 0;
    font-size: 0.72rem;
    color: var(--text-muted);
}
.header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    margin-left: auto;
}
.header-back {
    padding: 7px 14px;
    border: 1px solid var(--surface-border);
    background: var(--surface);
    color: var(--text-muted);
    border-radius: 8px;
    font-size: 0.78rem;
    cursor: pointer;
    transition:
        color 0.2s,
        border-color 0.2s,
        background 0.2s;
    white-space: nowrap;
}
.header-back:hover {
    color: var(--text);
    border-color: var(--outline-3-hover-border);
    background: var(--outline-3-hover-bg);
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

/* ── 主体左右布局（side + main）── */
.layout-body {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    width: 100%;
    padding: 0 20px;
    box-sizing: border-box;
}
.side {
    width: 340px;
    flex-shrink: 0;
    flex-grow: 0;
    position: sticky;
    top: 84px;
}
.main {
    flex: 1 1 auto;
    min-width: 0;
}
.target-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.side-divider {
    height: 1px;
    background: var(--divider);
    margin: 16px 0;
}
.side-actions {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.query-btn,
.clear-btn {
    width: 100%;
    /* 压掉 EP 的 .el-button + .el-button { margin-left: 12px } 相邻间距，
       本处垂直排列由 .side-actions 的 column flex + gap 控制 */
    margin-left: 0;
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

/* ── 修改角色面板 ── */
.role-baseline {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    text-align: right;
    font-size: 0.74rem;
    color: var(--text-muted);
}
.role-current {
    line-height: 1.4;
}
.role-baseline b {
    color: var(--text);
}
.role-update-hint {
    font-size: 0.68rem;
    color: var(--text-muted);
    opacity: 0.85;
}
.role-update-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
}
.role-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.role-grow-row {
    display: flex;
    gap: 8px;
}
.role-grow-row > * {
    flex: 1;
    min-width: 0;
}
.grow-block-tip {
    margin: 10px 0 0;
    font-size: 0.74rem;
    line-height: 1.5;
    color: var(--error);
}
.role-submit-bar {
    justify-content: flex-end;
    margin-top: 14px;
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

.send-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--divider);
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

@media (max-width: 960px) {
    .layout-body {
        flex-direction: column;
    }
    .side {
        width: 100%;
        position: static;
    }
    .main {
        width: 100%;
        flex: 1 0 auto;
    }
    .app-header {
        flex-wrap: wrap;
    }
}
@media (max-width: 720px) {
    .attachment-grid {
        grid-template-columns: 1fr;
    }
}
</style>
