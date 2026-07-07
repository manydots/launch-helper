import { ref } from "vue";
import { defineStore } from "pinia";
import { PROTO, normalizePath, generateRegistryContent as buildRegistry, generateUninstallRegistryContent as buildUninstallRegistry } from "@/utils/registry";

const STORE_KEY = "launch-helper:game";
const DEFAULT_PARAM = "99?127.0.0.1?7001?10038?de509f65e9ccaae621cb7278fc2b8e6c?01?1?0?0?0?0?1?9n2b1c8r3w7y?0?0?19847";

function download(filename, content) {
    const blob = new Blob([content], { type: "application/octet-stream" });
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
            setGamePath,
            setLaunchParam,
            setAccount,
            setPassword,
            generateRegistryContent,
            downloadRegistry,
            downloadUninstallRegistry,
            launchGame
        };
    },
    {
        persist: { key: STORE_KEY, storage: localStorage, pick: ["gamePath", "launchParam", "account", "password"] }
    }
);
