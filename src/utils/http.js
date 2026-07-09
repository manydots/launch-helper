import axios from "axios";
const baseURL = import.meta.env.VITE_APP_BASEURL;

const client = axios.create({
    baseURL: baseURL,
    timeout: 15000,
    headers: { "Content-Type": "application/json; charset=utf-8" }
});

async function handle(request) {
    try {
        const resp = await request;
        return resp.data;
    } catch (err) {
        if (err.response) {
            return err.response.data || { success: false, code: err.response.status, message: "请求失败" };
        }
        throw err;
    }
}

export const api = {
    health: () => handle(client.get("/api/health")),
    register: (m_id, password, password_confirm) => handle(client.post("/api/register", { m_id, password, password_confirm })),
    login: (m_id, password) => handle(client.post("/api/login", { m_id, password })),
    accountInfo: (key, m_id) => handle(client.get("/api/account/info", { params: { key, m_id } })),
    changePassword: (m_id, old_password, new_password, new_password_confirm) => handle(client.post("/api/account/password", { m_id, old_password, new_password, new_password_confirm }))
};
