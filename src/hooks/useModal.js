import { reactive } from "vue";

const state = reactive({
    show: false,
    title: "",
    message: "",
    buttons: []
});

export function openModal(config) {
    state.show = true;
    state.title = config.title || "";
    state.message = config.message || "";
    state.buttons = config.buttons || [];
}

export function closeModal() {
    state.show = false;
}

export function alertModal({ title, message, confirmText }) {
    return new Promise(resolve => {
        openModal({
            title,
            message,
            buttons: [
                {
                    text: confirmText || "确定",
                    type: "primary",
                    handler: () => {
                        closeModal();
                        resolve(true);
                    }
                }
            ]
        });
    });
}

export function confirmModal({ title, message, confirmText, cancelText }) {
    return new Promise(resolve => {
        openModal({
            title,
            message,
            buttons: [
                {
                    text: cancelText || "取消",
                    type: "secondary",
                    handler: () => {
                        closeModal();
                        resolve(false);
                    }
                },
                {
                    text: confirmText || "确定",
                    type: "primary",
                    handler: () => {
                        closeModal();
                        resolve(true);
                    }
                }
            ]
        });
    });
}

export function useModal() {
    return { state, openModal, closeModal, alertModal, confirmModal };
}
