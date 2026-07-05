import { ref } from "vue";
import { defineStore } from "pinia";

const PROTO = "LaunchHelper";
const DEFAULT_PARAM = "99?127.0.0.1?7001?10038?de509f65e9ccaae621cb7278fc2b8e6c?01?1?0?0?0?0?1?9n2b1c8r3w7y?0?0?19847";

function normalizePath(p) {
    return p.replace(/\\+/g, "\\");
}

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

        function setGamePath(path) {
            gamePath.value = path;
        }

        function setLaunchParam(param) {
            launchParam.value = param;
        }

        function generateRegistryContent(path) {
            const p = normalizePath((path || gamePath.value || "").trim());
            if (!p) return "";
            const exe = p.replace(/\\/g, "\\\\");
            let dir = p.substring(0, p.lastIndexOf("\\"));
            if (/^[A-Za-z]:$/.test(dir)) dir = dir + "\\";
            dir = dir.replace(/\\/g, "\\\\");
            const cmd = `cmd /v:on /c set \\"url=%1\\"&set \\"p=!url:${PROTO}:=!\\"&start \\"\\" /d \\"${dir}\\" \\"${exe}\\" !p!`;
            return `Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\\${PROTO}]
@="URL:LaunchHelper Protocol"
"URL Protocol"=""

[HKEY_CLASSES_ROOT\\${PROTO}\\shell]

[HKEY_CLASSES_ROOT\\${PROTO}\\shell\\open]

[HKEY_CLASSES_ROOT\\${PROTO}\\shell\\open\\command]
@="${cmd}"
`;
        }

        function generateUninstallRegistryContent() {
            return `Windows Registry Editor Version 5.00

[-HKEY_CLASSES_ROOT\\${PROTO}]
`;
        }

        function downloadRegistry(path, param) {
            const p = normalizePath((path || gamePath.value || "").trim());
            if (!p) return;
            if (p !== gamePath.value) setGamePath(p);
            const arg = (param !== undefined ? param : launchParam.value).trim();
            if (arg !== launchParam.value) setLaunchParam(arg);
            download(`register-${PROTO}.reg`, generateRegistryContent(p));
        }

        function downloadUninstallRegistry() {
            download(`uninstall-${PROTO}.reg`, generateUninstallRegistryContent());
        }

        function launchGame(param) {
            const arg = (param !== undefined ? param : launchParam.value).trim();
            if (arg !== launchParam.value) setLaunchParam(arg);
            window.location.href = `${PROTO}:${arg}`;
        }

        return {
            gamePath,
            launchParam,
            setGamePath,
            setLaunchParam,
            generateRegistryContent,
            downloadRegistry,
            downloadUninstallRegistry,
            launchGame
        };
    },
    {
        persist: {
            key: "launch-helper:game",
            pick: ["gamePath", "launchParam"]
        }
    }
);
