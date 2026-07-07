<script setup>
import { useModal } from "@/hooks/useModal";

const { state, closeModal } = useModal();

const BUTTON_CLASS = {
    primary: "btn-primary",
    outline: "btn-outline-primary",
    secondary: "btn-outline-secondary"
};

function handleClick(btn) {
    if (btn.handler) btn.handler();
    else closeModal();
}
</script>

<template>
    <Transition name="modal">
        <div v-if="state.show" class="modal-overlay" @click.self="closeModal">
            <div class="modal">
                <h3 class="modal-title">{{ state.title }}</h3>
                <p class="modal-body" v-html="state.message"></p>
                <div class="modal-actions">
                    <button v-for="(btn, i) in state.buttons" :key="i" :class="['btn', BUTTON_CLASS[btn.type] || BUTTON_CLASS.secondary]" @click="handleClick(btn)">
                        {{ btn.text }}
                    </button>
                </div>
            </div>
        </div>
    </Transition>
</template>
