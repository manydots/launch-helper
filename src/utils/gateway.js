import protobuf from "protobufjs";
import protoText from "./gateway.proto?raw";

const root = new protobuf.Root();
protobuf.parse(protoText, root, { keepCase: true });

const Request = root.lookupType("gateway.Request");
const Response = root.lookupType("gateway.Response");
const HealthResponse = root.lookupType("gateway.HealthResponse");
const RegisterRequest = root.lookupType("gateway.RegisterRequest");
const RegisterResponse = root.lookupType("gateway.RegisterResponse");
const LoginRequest = root.lookupType("gateway.LoginRequest");
const LoginResponse = root.lookupType("gateway.LoginResponse");
const ChangePasswordRequest = root.lookupType("gateway.ChangePasswordRequest");
const AccountInfoRequest = root.lookupType("gateway.AccountInfoRequest");
const AccountInfoResponse = root.lookupType("gateway.AccountInfoResponse");
const AccountResetPasswordRequest = root.lookupType("gateway.AccountResetPasswordRequest");
const SendItemsRequest = root.lookupType("gateway.SendItemsRequest");
const SendItemsResponse = root.lookupType("gateway.SendItemsResponse");
const GetRolesRequest = root.lookupType("gateway.GetRolesRequest");
const AccountRoleTree = root.lookupType("gateway.AccountRoleTree");
const ClearMailboxRequest = root.lookupType("gateway.ClearMailboxRequest");
const ClearMailboxResponse = root.lookupType("gateway.ClearMailboxResponse");

const CMD = {
    HEALTH: 1,
    REGISTER: 2,
    LOGIN: 3,
    CHANGE_PASSWORD: 4,
    ACCOUNT_INFO: 5,
    ACCOUNT_RESET: 6,
    SEND_ITEMS: 7,
    GET_ROLES: 8,
    CLEAR_MAILBOX: 9
};

const RESPONSE_TYPES = {
    [CMD.HEALTH]: HealthResponse,
    [CMD.REGISTER]: RegisterResponse,
    [CMD.LOGIN]: LoginResponse,
    [CMD.CHANGE_PASSWORD]: null,
    [CMD.ACCOUNT_INFO]: AccountInfoResponse,
    [CMD.ACCOUNT_RESET]: null,
    [CMD.SEND_ITEMS]: SendItemsResponse,
    [CMD.GET_ROLES]: AccountRoleTree,
    [CMD.CLEAR_MAILBOX]: ClearMailboxResponse
};

const CMD_NAMES = {
    [CMD.HEALTH]: "HEALTH",
    [CMD.REGISTER]: "REGISTER",
    [CMD.LOGIN]: "LOGIN",
    [CMD.CHANGE_PASSWORD]: "CHANGE_PASSWORD",
    [CMD.ACCOUNT_INFO]: "ACCOUNT_INFO",
    [CMD.ACCOUNT_RESET]: "ACCOUNT_RESET",
    [CMD.SEND_ITEMS]: "SEND_ITEMS",
    [CMD.GET_ROLES]: "GET_ROLES",
    [CMD.CLEAR_MAILBOX]: "CLEAR_MAILBOX"
};

const REQUEST_TYPES = {
    [CMD.HEALTH]: null,
    [CMD.REGISTER]: RegisterRequest,
    [CMD.LOGIN]: LoginRequest,
    [CMD.CHANGE_PASSWORD]: ChangePasswordRequest,
    [CMD.ACCOUNT_INFO]: AccountInfoRequest,
    [CMD.ACCOUNT_RESET]: AccountResetPasswordRequest,
    [CMD.SEND_ITEMS]: SendItemsRequest,
    [CMD.GET_ROLES]: GetRolesRequest,
    [CMD.CLEAR_MAILBOX]: ClearMailboxRequest
};

const TIMEOUT_MS = 15000;

class GatewayClient {
    constructor() {
        this.ws = null;
        this.sequence = 0;
        this.pending = new Map();
        this.connectPromise = null;
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const gatewayPath = import.meta.env.VITE_GATEWAY_PATH || "/gateway";
        const url = `${protocol}//${window.location.host}${gatewayPath}`;

        this.connectPromise = new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);
            this.ws.binaryType = "arraybuffer";

            this.ws.onopen = () => {
                this.connectPromise = null;
                resolve();
            };

            this.ws.onerror = () => {
                this.connectPromise = null;
                reject(new Error("WebSocket 连接失败"));
            };

            this.ws.onmessage = event => {
                const bytes = new Uint8Array(event.data);
                let resp;
                try {
                    resp = Response.decode(bytes);
                } catch {
                    return;
                }
                const seq = resp.sequence;
                const entry = this.pending.get(seq);
                if (entry) {
                    this.pending.delete(seq);
                    entry.resolve(this.unwrap(resp, entry.responseType));
                }
            };

            this.ws.onclose = () => {
                for (const [seq, entry] of this.pending) {
                    const errResult = { success: false, code: -1, message: "连接已断开" };
                    console.log(`%c[gateway <-] seq=${seq} DISCONNECTED`, "color:#ff5b6e", errResult);
                    entry.resolve(errResult);
                }
                this.pending.clear();
                this.ws = null;
                this.connectPromise = null;
            };
        });

        return this.connectPromise;
    }

    async send(command, bodyBytes, authKey = "") {
        await this.connect();

        const seq = ++this.sequence;
        const requestMsg = Request.create({
            command: command,
            timestamp: Math.floor(Date.now() / 1000),
            auth_key: authKey,
            body: bodyBytes,
            sequence: seq
        });
        const encoded = Request.encode(requestMsg).finish();

        const cmdName = CMD_NAMES[command] || `CMD_${command}`;
        const reqType = REQUEST_TYPES[command];
        let reqBody = "(empty)";
        if (reqType && bodyBytes.length > 0) {
            try {
                reqBody = reqType.toObject(reqType.decode(bodyBytes), { longs: String });
            } catch {}
        }
        const keyLen = authKey ? authKey.length : 0;
        console.log(`%c[gateway ->] ${cmdName} seq=${seq} auth_key[len=${keyLen}]="${authKey || ""}"`, "color:#5b8cff", reqBody);

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                if (this.pending.has(seq)) {
                    this.pending.delete(seq);
                    const errResult = { success: false, code: -1, message: "请求超时" };
                    console.log(`%c[gateway <-] ${cmdName} seq=${seq} TIMEOUT`, "color:#ff5b6e", errResult);
                    resolve(errResult);
                }
            }, TIMEOUT_MS);

            this.pending.set(seq, {
                responseType: RESPONSE_TYPES[command] || null,
                resolve: data => {
                    clearTimeout(timer);
                    resolve(data);
                }
            });

            this.ws.send(encoded);
        });
    }

    unwrap(resp, responseType) {
        const result = {
            success: resp.success,
            code: resp.code,
            message: resp.message
        };

        if (!resp.success || !responseType || !resp.body || resp.body.length === 0) {
            console.log(`%c[gateway <-] seq=${resp.sequence}`, "color:#3ddc84", result);
            return result;
        }

        try {
            const decoded = responseType.decode(resp.body);
            const obj = responseType.toObject(decoded, { longs: String });
            Object.assign(result, obj);
        } catch {}

        console.log(`%c[gateway <-] seq=${resp.sequence}`, "color:#3ddc84", result);
        return result;
    }

    async health() {
        return this.send(CMD.HEALTH, new Uint8Array(0));
    }

    async register(m_id, password, password_confirm) {
        const body = RegisterRequest.encode(RegisterRequest.create({ m_id, password, password_confirm })).finish();
        return this.send(CMD.REGISTER, body);
    }

    async login(m_id, password) {
        const body = LoginRequest.encode(LoginRequest.create({ m_id, password })).finish();
        return this.send(CMD.LOGIN, body);
    }

    async changePassword(m_id, old_password, new_password, new_password_confirm) {
        const body = ChangePasswordRequest.encode(
            ChangePasswordRequest.create({
                m_id,
                old_password,
                new_password,
                new_password_confirm
            })
        ).finish();
        return this.send(CMD.CHANGE_PASSWORD, body);
    }

    async accountInfo(m_id) {
        const body = AccountInfoRequest.encode(AccountInfoRequest.create({ m_id })).finish();
        return this.send(CMD.ACCOUNT_INFO, body);
    }

    async accountResetPassword(m_id, new_password, new_password_confirm, authKey) {
        const body = AccountResetPasswordRequest.encode(
            AccountResetPasswordRequest.create({
                m_id,
                new_password,
                new_password_confirm
            })
        ).finish();
        return this.send(CMD.ACCOUNT_RESET, body, authKey);
    }

    async sendItems(m_id, character_id, title, body_text, attachments, authKey) {
        const body = SendItemsRequest.encode(
            SendItemsRequest.create({
                m_id,
                character_id,
                title,
                body: body_text,
                attachments
            })
        ).finish();
        return this.send(CMD.SEND_ITEMS, body, authKey);
    }

    async getRoles(m_id, authKey) {
        const body = GetRolesRequest.encode(GetRolesRequest.create({ m_id })).finish();
        return this.send(CMD.GET_ROLES, body, authKey);
    }

    async clearMailbox(m_id, character_id, authKey) {
        const body = ClearMailboxRequest.encode(ClearMailboxRequest.create({ m_id, character_id })).finish();
        return this.send(CMD.CLEAR_MAILBOX, body, authKey);
    }
}

const client = new GatewayClient();

export const api = {
    health: () => client.health(),
    register: (m_id, password, password_confirm) => client.register(m_id, password, password_confirm),
    login: (m_id, password) => client.login(m_id, password),
    changePassword: (m_id, old_password, new_password, new_password_confirm) => client.changePassword(m_id, old_password, new_password, new_password_confirm),
    accountInfo: m_id => client.accountInfo(m_id),
    accountResetPassword: (m_id, new_password, new_password_confirm, authKey) => client.accountResetPassword(m_id, new_password, new_password_confirm, authKey),
    sendItems: (m_id, character_id, title, body, attachments, authKey) => client.sendItems(m_id, character_id, title, body, attachments, authKey),
    getRoles: (m_id, authKey) => client.getRoles(m_id, authKey),
    clearMailbox: (m_id, character_id, authKey) => client.clearMailbox(m_id, character_id, authKey),
    // 向后兼容别名
    adminResetPassword: (m_id, new_password, new_password_confirm, authKey) => client.accountResetPassword(m_id, new_password, new_password_confirm, authKey)
};
