<script>
import { useGameStore } from "@/stores/game";
import { openModal, alertModal, useModal } from "@/hooks/useModal";
import { api } from "@/utils/gateway";
import MaterialTextField from "@/components/MaterialTextField.vue";

export default {
    name: "GameLauncher",
    components: { MaterialTextField },
    setup() {
        const store = useGameStore();
        return { store };
    },
    data() {
        return {
            inputPath: this.store.gamePath || "",
            loading: false,
            showConfig: !this.store.gamePath,
            subtitleFull: "游戏快速启动工具",
            typedSubtitle: "",
            mode: "login",
            gatewayEnabled: import.meta.env.VITE_GATEWAY_ENABLED === "true",
            platformCheck: import.meta.env.VITE_PLATFORM_CHECK === "true",
            healthInterval: (Number(import.meta.env.VITE_HEALTH_INTERVAL) || 5) * 1000,
            regMid: this.store.account || "",
            regPassword: "",
            regConfirm: "",
            regErrors: { mid: "", password: "", confirm: "" },
            pwdMid: this.store.account || "",
            pwdOld: "",
            pwdNew: "",
            pwdConfirm: "",
            pwdErrors: { mid: "", old: "", neo: "", confirm: "" },
            resetMid: this.store.account || "",
            resetKey: "",
            resetNew: "",
            resetConfirm: "",
            resetErrors: { mid: "", key: "", neo: "", confirm: "" },
            itemsMid: this.store.account || "",
            itemsKey: "",
            itemsRoles: [],
            itemsRoleId: "",
            itemsLoadingRoles: false,
            itemsTitle: "",
            itemsBody: "",
            itemsList: [],
            itemsErrors: { mid: "", key: "", role: "", title: "" },
            serviceStatus: this.store.gatewayStatus || "checking",
            notifiedStatus: null
        };
    },
    computed: {
        account: {
            get() {
                return this.store.account;
            },
            set(v) {
                this.store.setAccount(v);
            }
        },
        password: {
            get() {
                return this.store.password;
            },
            set(v) {
                this.store.setPassword(v);
            }
        },
        isWindows() {
            return /Windows/i.test(navigator.userAgent);
        },
        isPathValid() {
            return /^[A-Za-z]:\\+.+\.exe$/i.test(this.inputPath.trim());
        },
        statusInfo() {
            switch (this.serviceStatus) {
                case "online":
                    return { text: "服务在线", cls: "online" };
                case "service-down":
                    return { text: "服务未启动", cls: "offline" };
                case "gateway-down":
                    return { text: "网关未启动", cls: "offline" };
                default:
                    return { text: "检测中", cls: "checking" };
            }
        }
    },
    mounted() {
        this.typeSubtitle();

        // if (!this.isWindows) {
        //     this.showUnsupportedModal();
        // }

        if (this.gatewayEnabled) {
            this.checkHealth();
            this.healthTimer = setInterval(() => this.checkHealth(), this.healthInterval);
        }
    },
    watch: {
        "store.gamePath"(val) {
            this.inputPath = val || "";
        }
    },
    beforeUnmount() {
        clearInterval(this.subtitleTimer);
        if (this.healthTimer) clearInterval(this.healthTimer);
    },
    methods: {
        typeSubtitle() {
            const full = this.subtitleFull;
            let i = 0;
            this.subtitleTimer = setInterval(() => {
                if (i < full.length) {
                    this.typedSubtitle = full.slice(0, i + 1);
                    i++;
                } else {
                    clearInterval(this.subtitleTimer);
                }
            }, 110);
        },
        showUnsupportedModal() {
            alertModal({
                title: "不支持当前系统",
                message: "本工具仅支持 Windows 系统，无法在 macOS、Linux 或移动端使用。"
            });
        },
        async checkHealth(silent = false) {
            if (!this.gatewayEnabled) return;
            if (this.serviceStatus !== "online") this.serviceStatus = "checking";
            let next;
            try {
                const data = await api.health();
                if (!data || !data.success) {
                    next = "gateway-down";
                } else if (data.status === "ok") {
                    next = "online";
                } else {
                    next = "service-down";
                }
            } catch {
                next = "gateway-down";
            }
            this.serviceStatus = next;
            this.store.setGatewayStatus(next);
            if (next === "online") {
                this.notifiedStatus = null;
            } else if (next !== "checking" && this.notifiedStatus !== next) {
                this.notifiedStatus = next;
                if (!silent) this.notifyStatus(next);
            }
        },
        notifyStatus(status) {
            if (useModal().state.show) return;
            const messages = {
                "gateway-down": {
                    title: "网关异常",
                    message: "网关服务未启动或无法连接，请确认网关已正常运行。"
                },
                "service-down": {
                    title: "服务异常",
                    message: "游戏服务未启动，相关操作暂不可用，请稍后再试。"
                }
            };
            const cfg = messages[status];
            if (cfg) alertModal(cfg);
        },
        async ensureGatewayOnline() {
            if (!this.gatewayEnabled) return true;
            await this.checkHealth(true);
            if (this.serviceStatus === "online") return true;
            const messages = {
                "gateway-down": {
                    title: "网关不可用",
                    message: "网关服务未启动或无法连接，请确认网关已正常运行。"
                },
                "service-down": {
                    title: "服务不可用",
                    message: "游戏服务未启动，请稍后再试。"
                }
            };
            const cfg = messages[this.serviceStatus] || {
                title: "服务不可用",
                message: "网关服务当前不可用，请检查网络或稍后再试。"
            };
            await alertModal(cfg);
            return false;
        },
        async handleRegister() {
            if (!this.gatewayEnabled) {
                alertModal({
                    title: "注册账号",
                    message: "请前往游戏官网完成账号注册。"
                });
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            this.regMid = this.store.account || this.regMid;
            this.regPassword = "";
            this.regConfirm = "";
            this.regErrors = { mid: "", password: "", confirm: "" };
            this.mode = "register";
        },
        async handleChangePassword() {
            if (!this.gatewayEnabled) {
                alertModal({
                    title: "修改密码",
                    message: "请前往游戏官网修改密码。"
                });
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            this.pwdMid = this.store.account || this.pwdMid;
            this.pwdOld = "";
            this.pwdNew = "";
            this.pwdConfirm = "";
            this.pwdErrors = { mid: "", old: "", neo: "", confirm: "" };
            this.mode = "password";
        },
        async handleResetPassword() {
            if (!this.gatewayEnabled) {
                alertModal({
                    title: "重置密码",
                    message: "请前往游戏官网重置密码。"
                });
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            this.resetMid = this.store.account || this.resetMid;
            this.resetKey = "";
            this.resetNew = "";
            this.resetConfirm = "";
            this.resetErrors = { mid: "", key: "", neo: "", confirm: "" };
            this.mode = "reset";
        },
        backToLogin() {
            this.mode = "login";
        },
        async handleSendItems() {
            if (!this.gatewayEnabled) {
                alertModal({ title: "物品发放", message: "请通过管理后台发放物品。" });
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            this.itemsMid = this.store.account || this.itemsMid;
            this.itemsKey = "";
            this.itemsRoles = [];
            this.itemsRoleId = "";
            this.itemsTitle = "LaunchHelper 物品发放";
            this.itemsBody = "LaunchHelper 管理工具的物品发放";
            this.itemsList = [];
            this.itemsErrors = { mid: "", key: "", role: "", title: "" };
            this.mode = "items";
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
            const roles = data.roles || [];
            if (!roles.length) {
                await alertModal({ title: "无角色", message: `账号 ${mid} 下没有角色。` });
                return;
            }
            this.itemsRoles = roles;
            this.itemsRoleId = String(roles[0].character_id);
        },
        addAttachment() {
            this.itemsList.push(this.createAttachment());
        },
        createAttachment() {
            return { item_id: 0, count: 1, kind: 0, upgrade_level: 0, amplify_type: 0, item_type: 0, pet_serial_or_handle: 0, expire_time: 0 };
        },
        removeAttachment(index) {
            this.itemsList.splice(index, 1);
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
            return names[job] || `职业${job}`;
        },
        validKinds(itemType) {
            switch (itemType) {
                case 1:
                    return [8];
                case 3:
                    return [5, 6];
                default:
                    return [1, 2, 3];
            }
        },
        kindName(kind) {
            const names = { 0: "未知", 1: "装备", 2: "消耗品", 3: "材料", 5: "宠物", 6: "宠物装备", 8: "时装" };
            return names[kind] || `种类${kind}`;
        },
        updateAttachment(att, field, value) {
            const num = Number(value) || 0;
            att[field] = num;
            if (field === "item_type") {
                const valid = this.validKinds(num);
                if (!valid.includes(att.kind)) att.kind = valid[0] || 0;
                if (att.kind === 1 || att.kind === 5 || att.kind === 6) att.count = 1;
            }
            if (field === "kind") {
                if (num === 1 || num === 5 || num === 6) att.count = 1;
                if (num !== 1) {
                    att.upgrade_level = 0;
                    att.amplify_type = 0;
                }
                if (num !== 5) {
                    att.pet_serial_or_handle = 0;
                }
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
            this.loading = true;
            const data = await this.callApi(api.sendItems(this.itemsMid.trim(), Number(this.itemsRoleId), this.itemsTitle.trim(), this.itemsBody.trim(), this.itemsList, this.itemsKey.trim()), {
                errorTitle: "发放失败"
            });
            this.loading = false;
            if (!data) return;
            const summary = [];
            if (data.character_name) summary.push(`角色：${data.character_name}`);
            if (data.mail_count) summary.push(`${data.mail_count} 封邮件`);
            await alertModal({
                title: "发放成功",
                message: `物品已通过系统邮件投递${summary.length ? "（" + summary.join("，") + "）" : ""}。`
            });
        },
        validateRegister() {
            const e = { mid: "", password: "", confirm: "" };
            const mid = this.regMid.trim();
            if (!mid) e.mid = "账号不能为空";
            else if (!/^[a-zA-Z0-9]{3,20}$/.test(mid)) e.mid = "账号仅限字母数字，3-20 位";
            const pwd = this.regPassword;
            if (!pwd) e.password = "密码不能为空";
            else if (pwd.length < 6 || pwd.length > 32) e.password = "密码长度 6-32 位";
            if (this.regConfirm !== pwd) e.confirm = "两次密码输入不一致";
            this.regErrors = e;
            return !e.mid && !e.password && !e.confirm;
        },
        async doRegister() {
            if (!this.validateRegister()) return;
            if (!(await this.ensureGatewayOnline())) return;
            this.loading = true;
            const data = await this.callApi(api.register(this.regMid.trim(), this.regPassword, this.regConfirm), { errorTitle: "注册失败" });
            this.loading = false;
            if (!data) return;
            this.account = this.regMid.trim();
            this.password = "";
            await alertModal({ title: "注册成功", message: `账号 ${data.m_id} 已创建，请使用该账号登录。` });
            this.mode = "login";
        },
        validateChangePassword() {
            const e = { mid: "", old: "", neo: "", confirm: "" };
            const mid = this.pwdMid.trim();
            if (!mid) e.mid = "账号不能为空";
            if (!this.pwdOld) e.old = "旧密码不能为空";
            const neo = this.pwdNew;
            if (!neo) e.neo = "新密码不能为空";
            else if (neo.length < 6 || neo.length > 32) e.neo = "新密码长度 6-32 位";
            else if (neo === this.pwdOld) e.neo = "新密码不能与旧密码相同";
            if (this.pwdConfirm !== neo) e.confirm = "两次密码输入不一致";
            this.pwdErrors = e;
            return !e.mid && !e.old && !e.neo && !e.confirm;
        },
        async doChangePassword() {
            if (!this.validateChangePassword()) return;
            if (!(await this.ensureGatewayOnline())) return;
            this.loading = true;
            const data = await this.callApi(api.changePassword(this.pwdMid.trim(), this.pwdOld, this.pwdNew, this.pwdConfirm), { errorTitle: "修改失败" });
            this.loading = false;
            if (!data) return;
            this.account = this.pwdMid.trim();
            this.password = "";
            await alertModal({ title: "修改成功", message: "密码已更新，请使用新密码登录。" });
            this.mode = "login";
        },
        validateResetPassword() {
            const e = { mid: "", key: "", neo: "", confirm: "" };
            const mid = this.resetMid.trim();
            if (!mid) e.mid = "账号不能为空";
            if (!this.resetKey) e.key = "管理密钥不能为空";
            const neo = this.resetNew;
            if (!neo) e.neo = "新密码不能为空";
            else if (neo.length < 6 || neo.length > 32) e.neo = "新密码长度 6-32 位";
            if (this.resetConfirm !== neo) e.confirm = "两次密码输入不一致";
            this.resetErrors = e;
            return !e.mid && !e.key && !e.neo && !e.confirm;
        },
        async doResetPassword() {
            if (!this.validateResetPassword()) return;
            if (!(await this.ensureGatewayOnline())) return;
            this.loading = true;
            const data = await this.callApi(api.adminResetPassword(this.resetMid.trim(), this.resetNew, this.resetConfirm, this.resetKey.trim()), { errorTitle: "重置失败" });
            this.loading = false;
            if (!data) return;
            this.account = this.resetMid.trim();
            this.password = "";
            await alertModal({ title: "重置成功", message: "密码已重置，请使用新密码登录。" });
            this.mode = "login";
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
        },
        generateRegistry() {
            if (this.platformCheck && !this.isWindows) {
                this.showUnsupportedModal();
                return;
            }
            const path = this.inputPath.trim();
            if (!path) {
                alertModal({
                    title: "请设置游戏路径",
                    message: "尚未填写游戏 exe 路径，请先填写完整路径再生成注册表。"
                });
                return;
            }
            if (!this.isPathValid) {
                alertModal({
                    title: "路径格式不正确",
                    message: "游戏路径需为完整路径，如 D:\Games\Game.exe"
                });
                return;
            }
            this.store.downloadRegistry(path);
        },
        async handleLogin() {
            if (this.platformCheck && !this.isWindows) {
                this.showUnsupportedModal();
                return;
            }
            if (!(await this.ensureGatewayOnline())) return;
            const missing = [];
            if (!this.account.trim()) missing.push("账号");
            if (!this.password.trim()) missing.push("密码");

            const path = this.inputPath.trim();
            let pathIssue = false;
            if (!path) {
                missing.push("游戏路径");
                pathIssue = true;
            } else if (!this.isPathValid) {
                missing.push("游戏路径（格式不正确）");
                pathIssue = true;
            }

            if (missing.length) {
                if (pathIssue) this.showConfig = true;
                alertModal({
                    title: "信息不完整",
                    message: `请检查以下项：${missing.join("、")}`
                });
                return;
            }

            if (this.gatewayEnabled) {
                this.loginViaGateway();
            } else {
                this.loading = true;
                this.launchWithDetect();
            }
        },
        async loginViaGateway() {
            this.loading = true;
            const data = await this.callApi(api.login(this.account.trim(), this.password), {
                errorTitle: "登录失败"
            });
            if (!data) {
                this.loading = false;
                return;
            }
            if (data.launch_args) {
                this.store.setLaunchParam(data.launch_args);
            }
            const path = this.inputPath.trim();
            if (path) {
                this.store.setGamePath(path);
            }
            this.launchWithDetect();
        },
        launchWithDetect() {
            let launched = false;
            const onBlur = () => {
                launched = true;
                cleanup();
                this.loading = false;
            };
            const timer = setTimeout(() => {
                cleanup();
                this.loading = false;
                if (!launched) {
                    openModal({
                        title: "协议未注册",
                        message: "未检测到 <code>LaunchHelper:</code> 协议，请先点击「生成注册表」下载并运行注册表文件以注册协议。",
                        buttons: [
                            { text: "取消", type: "secondary" },
                            {
                                text: "重试",
                                type: "outline",
                                handler: () => {
                                    this.loading = true;
                                    this.launchWithDetect();
                                }
                            },
                            {
                                text: "生成注册表",
                                type: "primary",
                                handler: () => this.generateRegistry()
                            }
                        ]
                    });
                }
            }, 3000);
            function cleanup() {
                window.removeEventListener("blur", onBlur);
                clearTimeout(timer);
            }
            window.addEventListener("blur", onBlur);
            this.store.launchGame();
        }
    }
};
</script>

<template>
    <div class="launcher">
        <div class="launcher-card">
            <div v-if="gatewayEnabled" class="service-status" :class="statusInfo.cls" :title="statusInfo.text">
                <span class="status-dot"></span>
                <span class="status-text">{{ statusInfo.text }}</span>
            </div>
            <button v-if="mode === 'login'" class="config-toggle" :class="{ active: showConfig }" @click="showConfig = !showConfig">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path
                        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
            <div class="launcher-header">
                <div class="logo-mark">Launch</div>
                <p class="subtitle">{{ typedSubtitle }}<span class="cursor"></span></p>
            </div>

            <div class="form">
                <template v-if="mode === 'login'">
                    <MaterialTextField v-model="account" label="账号" />
                    <MaterialTextField v-model="password" label="密码" type="password" />

                    <Transition name="config">
                        <div v-if="showConfig" class="config-section">
                            <div class="section-divider"><span>游戏配置</span></div>

                            <MaterialTextField v-model="inputPath" label="游戏 exe 路径" />

                            <div class="actions registry-actions">
                                <button class="btn btn-sm btn-outline-primary" :disabled="!isPathValid" @click="generateRegistry">
                                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    生成
                                </button>
                                <button class="btn btn-sm btn-outline-danger" @click="store.downloadUninstallRegistry">
                                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                    卸载
                                </button>
                            </div>
                        </div>
                    </Transition>

                    <div class="actions login-actions">
                        <button class="btn btn-primary btn-login" :disabled="loading" @click="handleLogin">
                            <span v-if="loading" class="spinner"></span>
                            {{ loading ? "启动中..." : "登录并启动" }}
                        </button>
                    </div>

                    <div class="auth-links">
                        <a href="#" @click.prevent="handleRegister">注册账号</a>
                        <span class="link-divider">·</span>
                        <a href="#" @click.prevent="handleChangePassword">修改密码</a>
                        <span class="link-divider">·</span>
                        <a href="#" @click.prevent="handleResetPassword">重置密码</a>
                        <span class="link-divider">·</span>
                        <a href="#" @click.prevent="handleSendItems">物品发放</a>
                    </div>
                </template>

                <template v-else-if="mode === 'register'">
                    <div class="section-divider"><span>注册账号</span></div>
                    <MaterialTextField v-model="regMid" label="账号（字母数字 3-20）" :error="regErrors.mid" />
                    <MaterialTextField v-model="regPassword" label="密码（6-32）" type="password" :error="regErrors.password" />
                    <MaterialTextField v-model="regConfirm" label="确认密码" type="password" :error="regErrors.confirm" />

                    <div class="actions login-actions">
                        <button class="btn btn-primary btn-login" :disabled="loading" @click="doRegister">
                            <span v-if="loading" class="spinner"></span>
                            {{ loading ? "注册中..." : "注册" }}
                        </button>
                    </div>

                    <div class="auth-links">
                        <a href="#" @click.prevent="backToLogin">返回登录</a>
                    </div>
                </template>

                <template v-else-if="mode === 'password'">
                    <div class="section-divider"><span>修改密码</span></div>
                    <MaterialTextField v-model="pwdMid" label="账号" :error="pwdErrors.mid" />
                    <MaterialTextField v-model="pwdOld" label="旧密码" type="password" :error="pwdErrors.old" />
                    <MaterialTextField v-model="pwdNew" label="新密码（6-32）" type="password" :error="pwdErrors.neo" />
                    <MaterialTextField v-model="pwdConfirm" label="确认新密码" type="password" :error="pwdErrors.confirm" />

                    <div class="actions login-actions">
                        <button class="btn btn-primary btn-login" :disabled="loading" @click="doChangePassword">
                            <span v-if="loading" class="spinner"></span>
                            {{ loading ? "提交中..." : "确认修改" }}
                        </button>
                    </div>

                    <div class="auth-links">
                        <a href="#" @click.prevent="backToLogin">返回登录</a>
                    </div>
                </template>

                <template v-else-if="mode === 'reset'">
                    <div class="section-divider"><span>重置密码</span></div>
                    <MaterialTextField v-model="resetMid" label="账号" :error="resetErrors.mid" />
                    <MaterialTextField v-model="resetKey" label="管理密钥" type="password" :error="resetErrors.key" />
                    <MaterialTextField v-model="resetNew" label="新密码（6-32）" type="password" :error="resetErrors.neo" />
                    <MaterialTextField v-model="resetConfirm" label="确认新密码" type="password" :error="resetErrors.confirm" />

                    <div class="actions login-actions">
                        <button class="btn btn-primary btn-login" :disabled="loading" @click="doResetPassword">
                            <span v-if="loading" class="spinner"></span>
                            {{ loading ? "提交中..." : "确认重置" }}
                        </button>
                    </div>

                    <div class="auth-links">
                        <a href="#" @click.prevent="backToLogin">返回登录</a>
                    </div>
                </template>

                <template v-else-if="mode === 'items'">
                    <div class="section-divider"><span>物品发放</span></div>
                    <MaterialTextField v-model="itemsMid" label="账号" :error="itemsErrors.mid" />
                    <MaterialTextField v-model="itemsKey" label="管理密钥" type="password" :error="itemsErrors.key" />

                    <div class="items-load-roles">
                        <button class="btn btn-sm btn-outline-primary" :disabled="itemsLoadingRoles" @click="loadRoles">
                            <span v-if="itemsLoadingRoles" class="spinner spinner-sm"></span>
                            {{ itemsLoadingRoles ? "查询中..." : "查询角色" }}
                        </button>
                    </div>

                    <template v-if="true">
                        <div class="role-field" :class="{ focused: itemsRoleId }">
                            <select class="role-select" v-model="itemsRoleId">
                                <option value="" disabled>请选择角色</option>
                                <option v-for="r in itemsRoles" :key="r.character_id" :value="String(r.character_id)">{{ r.name }} (Lv.{{ r.level }} / {{ jobName(r.job) }})</option>
                            </select>
                            <label class="role-label">角色</label>
                            <span class="role-underline"></span>
                            <p v-if="itemsErrors.role" class="role-error">{{ itemsErrors.role }}</p>
                        </div>

                        <MaterialTextField v-model="itemsTitle" label="邮件标题" :error="itemsErrors.title" />
                        <MaterialTextField v-model="itemsBody" label="邮件正文（可选）" />

                        <div class="section-divider"><span>邮件附件</span></div>

                        <div v-for="(att, idx) in itemsList" :key="idx" class="attachment-card">
                            <div class="attachment-header">
                                <span class="attachment-index">#{{ idx + 1 }}</span>
                                <button class="attachment-remove" @click="removeAttachment(idx)" title="移除">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                            <div class="attachment-grid">
                                <label class="att-field">
                                    <span class="att-label">背包类型</span>
                                    <select class="att-input" :value="att.item_type" @change="updateAttachment(att, 'item_type', $event.target.value)">
                                        <option :value="0">主背包</option>
                                        <option :value="1">时装</option>
                                        <option :value="3">宠物</option>
                                    </select>
                                </label>
                                <label class="att-field">
                                    <span class="att-label">物品种类</span>
                                    <select class="att-input" :value="att.kind" @change="updateAttachment(att, 'kind', $event.target.value)">
                                        <option v-for="k in validKinds(att.item_type)" :key="k" :value="k">{{ kindName(k) }}</option>
                                    </select>
                                </label>
                                <label class="att-field">
                                    <span class="att-label">物品ID</span>
                                    <input type="number" class="att-input" :value="att.item_id" min="0" @input="updateAttachment(att, 'item_id', $event.target.value)" />
                                </label>
                                <label class="att-field">
                                    <span class="att-label">物品数量</span>
                                    <input
                                        type="number"
                                        class="att-input"
                                        :value="att.count"
                                        min="1"
                                        :max="att.kind === 1 || att.kind === 5 || att.kind === 6 ? 1 : 100000"
                                        :disabled="att.kind === 1 || att.kind === 5 || att.kind === 6"
                                        @input="updateAttachment(att, 'count', $event.target.value)" />
                                </label>
                                <label class="att-field">
                                    <span class="att-label">红字类型</span>
                                    <select class="att-input" :value="att.amplify_type" :disabled="att.kind !== 1" @change="updateAttachment(att, 'amplify_type', $event.target.value)">
                                        <option :value="0">无红字</option>
                                        <option :value="1">体力</option>
                                        <option :value="2">精神</option>
                                        <option :value="3">力量</option>
                                        <option :value="4">智力</option>
                                        <option :value="128">未净化</option>
                                    </select>
                                </label>
                                <label class="att-field">
                                    <span class="att-label">强化等级</span>
                                    <input
                                        type="number"
                                        class="att-input"
                                        :value="att.upgrade_level"
                                        min="0"
                                        :max="att.amplify_type === 128 ? 0 : 31"
                                        :disabled="att.kind !== 1 || att.amplify_type === 128"
                                        @input="updateAttachment(att, 'upgrade_level', $event.target.value)" />
                                </label>
                            </div>
                        </div>

                        <button class="btn btn-sm btn-outline-secondary add-attachment-btn" @click="addAttachment">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            添加物品
                        </button>
                    </template>

                    <div class="actions login-actions">
                        <button class="btn btn-primary btn-login" :disabled="loading || !itemsRoles.length" @click="doSendItems">
                            <span v-if="loading" class="spinner"></span>
                            {{ loading ? "发放中..." : "确认发放" }}
                        </button>
                    </div>

                    <div class="auth-links">
                        <a href="#" @click.prevent="backToLogin">返回登录</a>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.launcher {
    max-width: 420px;
    width: 100%;
    margin: auto;
    font-family: system-ui, sans-serif;
}
.launcher-card {
    position: relative;
    background: var(--surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--surface-border);
    border-radius: 20px;
    box-shadow: var(--shadow-card);
    padding: 40px 36px;
}
.config-toggle {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
        color 0.2s,
        background 0.2s,
        transform 0.3s ease;
}
.config-toggle:hover {
    color: var(--text);
    background: var(--outline-3-hover-bg);
}
.config-toggle.active {
    transform: rotate(90deg);
    color: var(--accent);
}
.config-toggle svg {
    width: 18px;
    height: 18px;
}
.service-status {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 8px;
    border-radius: 20px;
    background: var(--outline-3-hover-bg);
    font-size: 0.72rem;
    color: var(--text-muted);
    user-select: none;
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.3s;
}
.service-status.online .status-dot {
    background: #3ddc84;
    animation: statusPulse 2s infinite;
}
.service-status.online .status-text {
    color: #3ddc84;
}
.service-status.offline .status-dot {
    background: var(--error);
}
.service-status.offline .status-text {
    color: var(--error);
}
.service-status.checking .status-dot {
    animation: statusBlink 1s infinite;
}
@keyframes statusPulse {
    0% {
        box-shadow: 0 0 0 0 rgba(61, 220, 132, 0.5);
    }
    70% {
        box-shadow: 0 0 0 6px rgba(61, 220, 132, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(61, 220, 132, 0);
    }
}
@keyframes statusBlink {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.3;
    }
}
.launcher-header {
    text-align: center;
    margin-bottom: 32px;
}
.logo-mark {
    width: fit-content;
    margin: 0 auto 16px;
    padding: 12px 18px;
    border-radius: 14px;
    background: var(--accent-gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: #fff;
    box-shadow: 0 8px 24px var(--accent-shadow);
}
.launcher-header h1 {
    font-size: 1.75rem;
    margin: 0 0 4px;
    color: var(--text);
    font-weight: 700;
    letter-spacing: 0.5px;
}
.subtitle {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    min-height: 1em;
    display: inline-flex;
    align-items: center;
}
.subtitle .cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    margin-left: 2px;
    background: var(--text-muted);
    animation: cursorBlink 0.8s step-end infinite;
}
@keyframes cursorBlink {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0;
    }
}
.form {
    text-align: left;
}
.config-section {
    overflow: hidden;
}
.config-enter-active {
    transition:
        opacity 0.25s ease,
        max-height 0.3s ease;
    max-height: 500px;
}
.config-leave-active {
    transition:
        opacity 0.2s ease,
        max-height 0.2s ease;
    max-height: 500px;
}
.config-enter-from,
.config-leave-to {
    opacity: 0;
    max-height: 0;
}
.section-divider {
    display: flex;
    align-items: center;
    margin: 24px 0 4px;
    color: var(--text-label);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 1px;
}
.section-divider:first-child {
    margin-top: 0;
}
.section-divider::before,
.section-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--divider);
}
.section-divider span {
    padding: 0 12px;
}
.actions {
    display: flex;
    gap: 12px;
    margin-top: 18px;
}
.registry-actions {
    margin-top: 20px;
    gap: 8px;
}
.registry-actions .btn {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 4px 8px;
    opacity: 0.7;
}
.registry-actions .btn:hover:not(:disabled) {
    background: var(--outline-3-hover-bg);
    opacity: 1;
}
.registry-actions .btn-icon {
    width: 13px;
    height: 13px;
}
.login-actions {
    justify-content: center;
    margin-top: 28px;
}
.btn-login {
    min-width: 220px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}
.spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
.auth-links {
    text-align: center;
    margin-top: 18px;
    font-size: 0.82rem;
}
.auth-links a {
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.2s;
}
.auth-links a:hover {
    color: var(--accent);
}
.link-divider {
    margin: 0 10px;
    color: var(--divider);
}
.items-load-roles {
    display: flex;
    margin: 12px 0 8px;
}
.items-load-roles .btn {
    padding: 4px 12px;
    font-size: 0.75rem;
    border-radius: 8px;
}
.role-field {
    position: relative;
    width: 100%;
    padding-top: 14px;
    margin-bottom: 8px;
}
.role-select {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 0 8px;
    border: none;
    border-bottom: 1px solid var(--input-border);
    background: transparent;
    font-size: 1rem;
    outline: none;
    color: var(--input-text);
    transition: border-color 0.2s;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
}
.role-select:focus {
    border-bottom-color: var(--accent);
}
.role-label {
    position: absolute;
    left: 0;
    top: 24px;
    font-size: 1rem;
    color: var(--input-border);
    pointer-events: none;
    transform-origin: left center;
    transition:
        transform 0.2s ease,
        color 0.2s ease;
}
.role-field.focused .role-label {
    transform: translateY(-22px) scale(0.8);
    color: var(--accent);
}
.role-underline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: center;
    transition: transform 0.25s ease;
}
.role-field.focused .role-underline {
    transform: scaleX(1);
}
.role-error {
    margin: 6px 0 0;
    font-size: 0.78rem;
    color: var(--error);
    min-height: 1em;
}
.spinner-sm {
    width: 13px;
    height: 13px;
    border-width: 1.5px;
}
.attachment-card {
    border: 1px solid var(--divider);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 8px;
    background: var(--outline-3-hover-bg);
}
.attachment-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}
.attachment-index {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-label);
}
.attachment-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition:
        color 0.2s,
        background 0.2s;
}
.attachment-remove:hover {
    color: var(--error);
    background: rgba(255, 91, 110, 0.1);
}
.attachment-remove svg {
    width: 14px;
    height: 14px;
}
.attachment-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 10px;
}
.att-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.att-label {
    font-size: 0.7rem;
    color: var(--text-muted);
}
.att-input {
    width: 100%;
    box-sizing: border-box;
    padding: 5px 6px;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: transparent;
    font-size: 0.82rem;
    color: var(--input-text);
    outline: none;
    transition: border-color 0.2s;
}
.att-input:focus {
    border-color: var(--accent);
}
.att-input:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}
.att-input::-webkit-inner-spin-button,
.att-input::-webkit-outer-spin-button {
    opacity: 0.5;
}
select.att-input {
    appearance: auto;
    cursor: pointer;
}
.add-attachment-btn {
    width: 100%;
    margin-top: 4px;
    margin-bottom: 8px;
}
.add-attachment-btn svg {
    width: 14px;
    height: 14px;
}
</style>
