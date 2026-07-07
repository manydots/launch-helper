import { createRouter, createWebHistory } from "vue-router";

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
    // history 模式；base 取自 vite 配置（本地 / ，GitHub Pages /launch-helper/）
    history: createWebHistory(import.meta.env.BASE_URL),
    routes
});

// 切换路由时更新浏览器标题为 meta.title
router.afterEach(to => {
    const title = to.meta?.title;
    document.title = title ? `LaunchHelper - ${title}` : "LaunchHelper";
});

export default router;
