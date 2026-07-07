export const PROTO = "LaunchHelper";

export function normalizePath(p) {
    return p.replace(/\\+/g, "\\");
}

export function splitPath(p) {
    const exe = p;
    let dir = p.substring(0, p.lastIndexOf("\\"));
    if (/^[A-Za-z]:$/.test(dir)) dir = dir + "\\";
    return { exe, dir };
}

export function escapeForPowerShell(s) {
    return s.replace(/'/g, "''");
}

export function escapeForReg(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildLaunchCommand(exe, dir) {
    const psExe = escapeForPowerShell(exe);
    const psDir = escapeForPowerShell(dir);
    const script = `$u='%1';$p=$u.Substring($u.IndexOf(':')+1);Start-Process -FilePath '${psExe}' -ArgumentList $p -WorkingDirectory '${psDir}'`;
    return `powershell -NoProfile -WindowStyle Hidden -Command "${script}"`;
}

export function generateRegistryContent(path) {
    const p = normalizePath((path || "").trim());
    if (!p) return "";
    const { exe, dir } = splitPath(p);
    const cmd = escapeForReg(buildLaunchCommand(exe, dir));
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

export function generateUninstallRegistryContent() {
    return `Windows Registry Editor Version 5.00

[-HKEY_CLASSES_ROOT\\${PROTO}]
`;
}
