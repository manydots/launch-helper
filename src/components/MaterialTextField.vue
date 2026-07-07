<script>
export default {
    name: "MaterialTextField",
    props: {
        modelValue: { type: String, default: "" },
        label: { type: String, required: true },
        type: { type: String, default: "text" },
        error: { type: String, default: "" }
    },
    emits: ["update:modelValue"],
    data() {
        return {
            isFocused: false,
            showPassword: false
        };
    },
    computed: {
        hasValue() {
            return this.modelValue.length > 0;
        },
        isFloating() {
            return this.isFocused || this.hasValue;
        },
        isError() {
            return !!this.error;
        },
        inputType() {
            return this.type === "password" ? (this.showPassword ? "text" : "password") : this.type;
        },
        actionClass() {
            if (!this.hasValue) return null;
            return this.type === "password" ? "actions-double" : "actions-single";
        }
    },
    methods: {
        onInput(e) {
            this.$emit("update:modelValue", e.target.value);
        },
        clearValue() {
            this.$emit("update:modelValue", "");
        }
    }
};
</script>

<template>
    <div class="material-field" :class="[{ focused: isFloating, error: isError }, actionClass]">
        <input :type="inputType" :value="modelValue" class="material-input" @focus="isFocused = true" @blur="isFocused = false" @input="onInput" />
        <label class="material-label">{{ label }}</label>
        <span class="material-underline"></span>
        <div v-if="hasValue" class="field-actions">
            <button v-if="type === 'password'" type="button" class="toggle-pwd" @mousedown.prevent @click="showPassword = !showPassword">
                {{ showPassword ? "隐藏" : "显示" }}
            </button>
            <button type="button" class="clear-btn" :class="{ 'is-hidden': !isFocused }" aria-label="清除" @mousedown.prevent @click="clearValue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
        <p v-if="error" class="material-error">{{ error }}</p>
    </div>
</template>

<style scoped>
.material-field {
    position: relative;
    width: 100%;
    padding-top: 14px;
    margin-bottom: 8px;
}
.material-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 0 8px;
    border: none;
    border-bottom: 1px solid var(--input-border);
    background: transparent;
    font-size: 1rem;
    outline: none;
    color: var(--input-text);
    transition: border-color 0.2s;
}
.material-input:-webkit-autofill {
    -webkit-box-shadow: 0 0 0 1000px var(--autofill-bg) inset;
    -webkit-text-fill-color: var(--input-text);
    transition: background-color 9999s ease-out;
}
.material-label {
    position: absolute;
    left: 0;
    top: 24px;
    font-size: 1rem;
    color: var(--input-border);
    pointer-events: none;
    transform-origin: left center;
    transition:
        transform 0.2s ease,
        color 0.2s ease;
}
.focused .material-label {
    transform: translateY(-22px) scale(0.8);
    color: var(--accent);
}
.material-underline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: center;
    transition: transform 0.25s ease;
}
.focused .material-underline {
    transform: scaleX(1);
}
.error .material-underline {
    transform: scaleX(0);
}
.error .material-input {
    border-bottom-color: var(--error);
    transition: none;
}
.error .material-label {
    color: var(--error);
    transition: none;
}
.toggle-pwd {
    border: none;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 2px 4px;
}
.field-actions {
    position: absolute;
    right: 0;
    top: 14px;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.clear-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition:
        color 0.2s,
        background 0.2s;
}
.clear-btn:hover {
    color: var(--text);
    background: var(--outline-3-hover-bg);
}
.clear-btn.is-hidden {
    visibility: hidden;
}
.clear-btn svg {
    width: 16px;
    height: 16px;
    display: block;
}
.actions-single .material-input {
    padding-right: 30px;
}
.actions-double .material-input {
    padding-right: 66px;
}
.material-error {
    margin: 6px 0 0;
    font-size: 0.78rem;
    color: var(--error);
    min-height: 1em;
}
</style>
