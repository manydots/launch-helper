// 职业枚举固化常量（86JPL 快照，提取语义与全量登记见 docs/pvf-job-grow-names.md）。
// 应用运行时不加载 PVF，仅消费本模块；数据由 test/job-grow-enums.mjs 从归档提取比对维护。

// jobId -> 显示名（用户口径含性别后缀，job13 魔枪士为 PVF 提取名补记）
export const JOB_NAMES = {
    0: "鬼剑士(男)",
    1: "格斗家(女)",
    2: "神枪手(男)",
    3: "魔法师(女)",
    4: "圣职者",
    5: "神枪手(女)",
    6: "暗夜使者",
    7: "格斗家(男)",
    8: "魔法师(男)",
    9: "黑暗武士",
    10: "缔造者",
    11: "鬼剑士(女)",
    12: "守护者",
    13: "魔枪士"
};

// jobId -> { first -> { name: 转职名, awakens: 觉醒名单 } }。
// 仅收录已实装分支 first=1-4 与直进职业（9/10 仅 first=1）；各职业的 5 转分支在
// 86JPL 内均为未定案占位（[growtype name] 自带 //(后续确认) 前缀或复用邻段数据的
// 空置同名槽，见文档 §4.2），一律不收录——协议仍允许 grow_first=0-5，
// 角色已落在 5 转分支时由调用方回退泛化文案兜底展示。
// awakens 长度语义：2 = 支持一觉+二觉；1 = 仅支持一觉（无二觉选项）；
// 0 = 该分支无可觉醒数据（展示层锁定未觉醒）。值均为 86JPL 归档原文，不做净化。
export const JOB_GROWS = {
    0: {
        1: { name: "剑魂", awakens: ["剑圣", "剑神"] },
        2: { name: "鬼泣", awakens: ["弑魂", "黑暗君主"] },
        3: { name: "狂战士", awakens: ["狱血魔神", "帝血弑天"] },
        4: { name: "阿修罗", awakens: ["大暗黑天", "天帝"] }
    },
    1: {
        1: { name: "气功师", awakens: ["百花缭乱", "念帝"] },
        2: { name: "散打", awakens: ["武神", "极武圣"] },
        3: { name: "街霸", awakens: ["毒王", "毒神绝"] },
        4: { name: "柔道家", awakens: ["暴风眼", "暴风女皇"] }
    },
    2: {
        1: { name: "漫游枪手", awakens: ["枪神", "掠天之翼"] },
        2: { name: "枪炮师", awakens: ["狂暴者", "毁灭者"] },
        3: { name: "机械师", awakens: ["机械战神", "机械元首"] },
        4: { name: "弹药专家", awakens: ["大将军", "战场统治者"] }
    },
    3: {
        1: { name: "元素师", awakens: ["大魔导师", "元素圣灵"] },
        2: { name: "召唤师", awakens: ["月之女皇", "月蚀"] },
        3: { name: "战斗法师", awakens: ["贝亚娜斗神", "伊斯塔战灵"] },
        4: { name: "魔道学者", awakens: ["魔术师", "古灵精怪"] }
    },
    4: {
        1: { name: "圣骑士", awakens: ["天启者", "神思者"] },
        2: { name: "蓝拳圣使", awakens: ["神之手", "正义仲裁者"] },
        3: { name: "驱魔师", awakens: ["龙斗士", "真龙星君"] },
        4: { name: "复仇者", awakens: ["末日审判者", "永生者"] }
    },
    5: {
        1: { name: "漫游枪手", awakens: ["沾血蔷薇", "绯红玫瑰"] },
        2: { name: "枪炮师", awakens: ["重炮掌控者", "风暴骑兵"] },
        3: { name: "机械师", awakens: ["机械之心", "机械之灵"] },
        4: { name: "弹药专家", awakens: ["战争女神", "芙蕾雅"] }
    },
    6: {
        1: { name: "刺客", awakens: ["银月", "月影星劫"] },
        2: { name: "死灵术士", awakens: ["灵魂收割者", "亡魂主宰"] },
        3: { name: "忍者", awakens: ["毕方之炎", "不知火"] },
        4: { name: "影舞者", awakens: ["梦魇", "幽冥"] }
    },
    7: {
        1: { name: "气功师", awakens: ["狂虎帝", "念皇"] },
        2: { name: "散打", awakens: ["武极", "极武皇"] },
        3: { name: "街霸", awakens: ["千手罗汉", "暗街之王"] },
        4: { name: "柔道家", awakens: ["风林火山", "宗师"] }
    },
    8: {
        1: { name: "元素爆破师", awakens: ["魔皇", "湮灭之瞳"] },
        2: { name: "冰结师", awakens: ["冰冻之心", "刹那永恒"] },
        3: { name: "战斗法师", awakens: ["贝亚娜斗神", "伊斯塔战灵"] },
        4: { name: "魔道学者", awakens: ["魔术师", "古灵精怪"] }
    },
    9: {
        1: { name: "黑暗武士", awakens: ["黑暗武士", "黑暗武士"] }
    },
    10: {
        1: { name: "缔造者", awakens: ["缔造者", "缔造者"] }
    },
    11: {
        1: { name: "驭剑士", awakens: ["剑宗", "剑皇"] },
        2: { name: "暗殿骑士", awakens: ["暗帝", "裁决女神"] },
        3: { name: "契魔者", awakens: ["剑魔", "弑神者"] },
        4: { name: "流浪武士", awakens: ["剑豪", "剑帝"] }
    },
    12: {
        1: { name: "精灵骑士", awakens: ["星辰之光", "大地女神"] },
        2: { name: "混沌魔灵", awakens: ["黑魔后", "黑曜神"] },
        3: { name: "growtype_name_219", awakens: [] },
        4: { name: "growtype_name_222", awakens: [] }
    },
    13: {
        1: { name: "征战者", awakens: ["战魂", "不灭战神"] },
        2: { name: "决战者", awakens: ["无双之魂", "圣武枪魂"] },
        3: { name: "growtype_name_232", awakens: [] },
        4: { name: "growtype_name_235", awakens: [] }
    }
};

// 显示名；未知 job 返回空串（调用方回退泛化文案）
export function getJobDisplayName(jobId) {
    const v = jobId == null ? 0 : jobId;
    if (!(v in JOB_NAMES)) return "";
    return JOB_NAMES[v];
}

// 转职下拉选项：[{ value: 0, label: "未转职" }, ...表内分支]；
// job 无枚举表返回 null（调用方回退既有泛化选项）。
// jobId 缺失（undefined/null，proto3 默认 0 不序列化）按 0 归一化，不视为无表
export function getBranchOptions(jobId) {
    const v = jobId == null ? 0 : jobId;
    const grows = JOB_GROWS[v];
    if (!grows) return null;
    const options = [{ value: 0, label: "未转职" }];
    for (const first of Object.keys(grows)
        .map(Number)
        .sort((a, b) => a - b)) {
        options.push({ value: first, label: grows[first].name });
    }
    return options;
}

// 觉醒下拉选项（按所选分支觉醒名单驱动）：
// [{ value: 1, label: 一觉名 }, (存在二觉时){ value: 2, label: 二觉名 }]；
// 未转职或分支无可觉醒数据返回 []（调用方锁定未觉醒）。jobId 缺失按 0 归一化
export function getAwakeningOptions(jobId, first) {
    if (!first) return [];
    const v = jobId == null ? 0 : jobId;
    const g = JOB_GROWS[v]?.[first];
    if (!g || !g.awakens.length) return [];
    const options = [{ value: 1, label: g.awakens[0] }];
    if (g.awakens.length > 1) options.push({ value: 2, label: g.awakens[1] });
    return options;
}

// 按档位取展示文案（转职 first / 觉醒 second），未知时返回 null 回退泛化文案。jobId 缺失按 0 归一化
export function growLabel(jobId, first, second = 0) {
    if (!first) return second ? null : "未转职";
    const v = jobId == null ? 0 : jobId;
    const g = JOB_GROWS[v]?.[first];
    if (!g) return null;
    if (!second) return g.name;
    return `${g.name}·${g.awakens[second - 1] || `觉醒${second}`}`;
}
