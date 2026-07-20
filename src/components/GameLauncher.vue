<script>
import { useGameStore } from "@/stores/game";
import { openModal, alertModal } from "@/hooks/useModal";
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
            inputParam: this.store.launchParam || "",
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
            serviceStatus: "checking"
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
                case "offline":
                    return { text: "服务离线", cls: "offline" };
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
        },
        "store.launchParam"(val) {
            this.inputParam = val || "";
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
        async checkHealth() {
            if (!this.gatewayEnabled) return;
            if (this.serviceStatus !== "online") this.serviceStatus = "checking";
            try {
                const data = await api.health();
                this.serviceStatus = data && data.success && data.status === "ok" ? "online" : "offline";
            } catch {
                this.serviceStatus = "offline";
            }
        },
        handleRegister() {
            if (!this.gatewayEnabled) {
                alertModal({
                    title: "注册账号",
                    message: "请前往游戏官网完成账号注册。"
                });
                return;
            }
            this.regMid = this.store.account || this.regMid;
            this.regPassword = "";
            this.regConfirm = "";
            this.regErrors = { mid: "", password: "", confirm: "" };
            this.mode = "register";
        },
        handleChangePassword() {
            if (!this.gatewayEnabled) {
                alertModal({
                    title: "修改密码",
                    message: "请前往游戏官网修改密码。"
                });
                return;
            }
            this.pwdMid = this.store.account || this.pwdMid;
            this.pwdOld = "";
            this.pwdNew = "";
            this.pwdConfirm = "";
            this.pwdErrors = { mid: "", old: "", neo: "", confirm: "" };
            this.mode = "password";
        },
        backToLogin() {
            this.mode = "login";
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
            this.loading = true;
            const data = await this.callApi(api.changePassword(this.pwdMid.trim(), this.pwdOld, this.pwdNew, this.pwdConfirm), { errorTitle: "修改失败" });
            this.loading = false;
            if (!data) return;
            this.account = this.pwdMid.trim();
            this.password = "";
            await alertModal({ title: "修改成功", message: "密码已更新，请使用新密码登录。" });
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
            this.store.downloadRegistry(path, this.inputParam.trim());
        },
        handleLogin() {
            if (this.platformCheck && !this.isWindows) {
                this.showUnsupportedModal();
                return;
            }
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
                this.inputParam = data.launch_args;
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
            this.store.launchGame(this.inputParam.trim());
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
                            <MaterialTextField v-model="inputParam" label="启动 bat 参数" />

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
</style>
