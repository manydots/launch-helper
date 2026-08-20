import { ref } from "vue";
import { defineStore } from "pinia";
import { PROTO, normalizePath, generateRegistryContent as buildRegistry, generateUninstallRegistryContent as buildUninstallRegistry } from "@/utils/registry";
import { encodeUtf16LE } from "@/utils/encoding";

const STORE_KEY = "launch-helper:game";
const DEFAULT_PARAM = "99?127.0.0.1?7001?10038?de509f65e9ccaae621cb7278fc2b8e6c?01?1?0?0?0?0?1?9n2b1c8r3w7y?0?0?19847";

// Windows .reg 文件需为 UTF-16 LE 带 BOM，否则 regedit 会按系统 ANSI 码页解析
// 非 ASCII 内容，含中文的游戏路径会被写入乱码，导致协议无法启动游戏。
function toRegFileBytes(content) {
    const body = encodeUtf16LE(content);
    const bytes = new Uint8Array(body.length + 2);
    bytes[0] = 0xff; // UTF-16 LE BOM
    bytes[1] = 0xfe;
    bytes.set(body, 2);
    return bytes;
}

function download(filename, content) {
    const blob = new Blob([toRegFileBytes(content)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export const useGameStore = defineStore(
    "game",
    () => {
        const gamePath = ref("");
        const launchParam = ref(DEFAULT_PARAM);
        const account = ref("");
        const password = ref("");
        const gatewayStatus = ref("checking");

        function setGamePath(path) {
            gamePath.value = path;
        }

        function setLaunchParam(param) {
            launchParam.value = param;
        }

        function setAccount(val) {
            account.value = val;
        }

        function setPassword(val) {
            password.value = val;
        }

        function setGatewayStatus(status) {
            gatewayStatus.value = status;
        }

        function generateRegistryContent(path) {
            return buildRegistry(path || gamePath.value);
        }

        function generateUninstallRegistryContent() {
            return buildUninstallRegistry();
        }

        function downloadRegistry(path, param) {
            const p = normalizePath((path || gamePath.value || "").trim());
            if (!p) return;
            if (p !== gamePath.value) setGamePath(p);
            const arg = (param !== undefined ? param : launchParam.value).trim();
            if (arg !== launchParam.value) setLaunchParam(arg);
            download(`register-${PROTO}.reg`, buildRegistry(p));
        }

        function downloadUninstallRegistry() {
            download(`uninstall-${PROTO}.reg`, buildUninstallRegistry());
        }

        function launchGame(param) {
            const arg = (param !== undefined ? param : launchParam.value).trim();
            if (arg !== launchParam.value) setLaunchParam(arg);
            window.location.href = `${PROTO}:${arg}`;
        }

        return {
            gamePath,
            launchParam,
            account,
            password,
            gatewayStatus,
            setGamePath,
            setLaunchParam,
            setAccount,
            setPassword,
            setGatewayStatus,
            generateRegistryContent,
            downloadRegistry,
            downloadUninstallRegistry,
            launchGame
        };
    },
    {
        persist: { key: STORE_KEY, storage: localStorage, pick: ["gamePath", "account", "password", "gatewayStatus"] }
    }
);
