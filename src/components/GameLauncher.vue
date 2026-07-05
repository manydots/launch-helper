<script>
import { useGameStore } from "@/stores/game";
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
            account: "123456",
            password: "123456",
            accountError: "",
            passwordError: "",
            inputPath: this.store.gamePath || "",
            inputParam: this.store.launchParam || "",
            pathError: "",
            showProtocolError: false,
            loading: false
        };
    },
    computed: {
        isPathValid() {
            return /^[A-Za-z]:\\+.+\.exe$/i.test(this.inputPath.trim());
        }
    },
    watch: {
        "store.gamePath"(val) {
            this.inputPath = val || "";
            this.pathError = "";
        },
        "store.launchParam"(val) {
            this.inputParam = val || "";
        }
    },
    methods: {
        generateRegistry() {
            this.pathError = "";
            const path = this.inputPath.trim();
            if (!path) {
                this.pathError = "请输入游戏 exe 的完整路径";
                return;
            }
            if (!this.isPathValid) {
                this.pathError = "路径格式不正确，需为完整路径";
                return;
            }
            this.store.downloadRegistry(path, this.inputParam.trim());
        },
        handleLogin() {
            this.accountError = "";
            this.passwordError = "";
            this.pathError = "";
            let valid = true;
            if (!this.account.trim()) {
                this.accountError = "请输入账号";
                valid = false;
            }
            if (!this.password.trim()) {
                this.passwordError = "请输入密码";
                valid = false;
            }
            const path = this.inputPath.trim();
            if (!path) {
                this.pathError = "请输入游戏 exe 的完整路径";
                valid = false;
            } else if (!this.isPathValid) {
                this.pathError = "路径格式不正确，需为完整路径";
                valid = false;
            }
            if (!valid) return;
            this.loading = true;
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
                    this.showProtocolError = true;
                }
            }, 2000);
            function cleanup() {
                window.removeEventListener("blur", onBlur);
                clearTimeout(timer);
            }
            window.addEventListener("blur", onBlur);
            this.store.launchGame(this.inputParam.trim());
        },
        closeProtocolError() {
            this.showProtocolError = false;
        },
        downloadRegistryFromModal() {
            this.showProtocolError = false;
            this.generateRegistry();
        }
    }
};
</script>

<template>
    <div class="launcher">
        <div class="launcher-card">
            <div class="launcher-header">
                <h1>LaunchHelper</h1>
                <p class="subtitle">游戏快速启动工具</p>
            </div>

            <div class="form">
                <MaterialTextField v-model="account" label="账号" :error="accountError" />
                <MaterialTextField v-model="password" label="密码" type="password" :error="passwordError" />

                <div class="section-title">游戏路径</div>
                <MaterialTextField v-model="inputPath" label="游戏 exe 路径" :error="pathError" />

                <div class="section-title">启动参数</div>
                <MaterialTextField v-model="inputParam" label="例如 99?127.0.0.1?7001?10038?..." />

                <div class="actions registry-actions">
                    <button class="btn btn-sm btn-outline-primary" :disabled="!isPathValid" @click="generateRegistry">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        生成注册表
                    </button>
                    <button class="btn btn-sm btn-outline-danger" @click="store.downloadUninstallRegistry">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        卸载注册表
                    </button>
                </div>

                <div class="divider"></div>

                <div class="actions login-actions">
                    <button class="btn btn-primary btn-login" :disabled="loading" @click="handleLogin">
                        <span v-if="loading" class="spinner"></span>
                        {{ loading ? "启动中..." : "登录并启动" }}
                    </button>
                </div>
            </div>
        </div>

        <Transition name="modal">
            <div v-if="showProtocolError" class="modal-overlay" @click.self="closeProtocolError">
                <div class="modal">
                    <h3 class="modal-title">协议未注册</h3>
                    <p class="modal-body">未检测到 <code>LaunchHelper:</code> 协议，请先点击「生成注册表」下载并运行注册表文件以注册协议。</p>
                    <div class="modal-actions">
                        <button class="btn btn-outline-secondary" @click="closeProtocolError">关闭</button>
                        <button class="btn btn-primary" @click="downloadRegistryFromModal">生成注册表</button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.launcher {
    max-width: 480px;
    margin: 60px auto;
    font-family: system-ui, sans-serif;
}
.launcher-card {
    background: var(--surface);
    border-radius: 16px;
    box-shadow: 0 2px 16px var(--shadow-card);
    padding: 40px 36px;
}
.launcher-header {
    text-align: center;
    margin-bottom: 28px;
}
.launcher-header h1 {
    font-size: 1.75rem;
    margin: 0 0 4px;
    color: var(--text);
}
.subtitle {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
}
.form {
    text-align: left;
}
.section-title {
    margin-top: 20px;
    margin-bottom: 2px;
    padding-left: 10px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-label);
    letter-spacing: 0.5px;
    border-left: 3px solid var(--section-accent);
}
.actions {
    display: flex;
    gap: 12px;
    margin-top: 18px;
}
.registry-actions {
    margin-top: 22px;
    gap: 8px;
}
.btn-sm {
    padding: 6px 14px;
    font-size: 0.82rem;
    border-radius: 6px;
}
.btn-sm .btn-icon {
    width: 14px;
    height: 14px;
}
.registry-actions .btn {
    flex: 1;
}
.divider {
    height: 1px;
    background: var(--divider);
    margin: 28px 0 0;
}
.login-actions {
    justify-content: center;
    margin-top: 24px;
}
.btn-login {
    min-width: 200px;
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
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    transition:
        background 0.2s,
        color 0.2s,
        border-color 0.2s,
        box-shadow 0.2s;
}
.btn-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}
.btn:disabled {
    opacity: 0.4;
    cursor: default;
}
.btn-primary {
    background: var(--accent);
    color: #fff;
}
.btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 2px 8px var(--accent-shadow);
}
.btn-outline-primary {
    background: transparent;
    color: var(--outline-1);
    border: 1.5px solid var(--outline-1);
}
.btn-outline-primary:hover:not(:disabled) {
    background: var(--outline-1);
    color: #fff;
}
.btn-outline-danger {
    background: transparent;
    color: var(--outline-2);
    border: 1.5px solid var(--outline-2);
}
.btn-outline-danger:hover:not(:disabled) {
    background: var(--outline-2);
    color: #fff;
}
.btn-outline-secondary {
    background: transparent;
    color: var(--outline-3-text);
    border: 1.5px solid var(--outline-3-border);
}
.btn-outline-secondary:hover {
    background: var(--outline-3-hover-bg);
    border-color: var(--outline-3-hover-border);
}
.modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}
.modal {
    background: var(--surface);
    border-radius: 16px;
    padding: 32px;
    max-width: 380px;
    width: 90%;
    box-shadow: 0 12px 40px var(--shadow-modal);
}
.modal-title {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 12px;
    color: var(--error);
}
.modal-body {
    font-size: 0.9rem;
    color: var(--text-label);
    line-height: 1.6;
    margin: 0 0 24px;
}
.modal-body code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.85rem;
}
.modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}
.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.2s ease;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
    transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
    transform: scale(0.9);
}
</style>
