import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
    { path: "/", redirect: { name: "Game" } },
    {
        path: "/Game",
        name: "Game",
        component: () => import("@/components/GameLauncher.vue"),
        meta: { title: "游戏启动" }
    },
    {
        path: "/PvfTool",
        name: "Pvf",
        component: () => import("@/components/PvfEditor.vue"),
        meta: { title: "PVF编辑" }
    }
];

const router = createRouter({
    // hash 模式；GitHub Pages 是纯静态服务器，hash 路由不触发服务端请求，避免 404
    history: createWebHashHistory(import.meta.env.BASE_URL),
    routes
});

// 切换路由时更新浏览器标题为 meta.title
router.afterEach(to => {
    const title = to.meta?.title;
    document.title = title ? `LaunchHelper - ${title}` : "LaunchHelper";
});

export default router;
