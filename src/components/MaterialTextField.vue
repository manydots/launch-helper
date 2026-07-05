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
        }
    },
    methods: {
        onInput(e) {
            this.$emit("update:modelValue", e.target.value);
        }
    }
};
</script>

<template>
    <div class="material-field" :class="{ focused: isFloating, error: isError }">
        <input :type="inputType" :value="modelValue" class="material-input" @focus="isFocused = true" @blur="isFocused = false" @input="onInput" />
        <label class="material-label">{{ label }}</label>
        <span class="material-underline"></span>
        <button v-if="type === 'password' && hasValue" type="button" class="toggle-pwd" @click="showPassword = !showPassword">
            {{ showPassword ? "隐藏" : "显示" }}
        </button>
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
    position: absolute;
    right: 0;
    top: 28px;
    border: none;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 2px 4px;
}
.material-error {
    margin: 6px 0 0;
    font-size: 0.78rem;
    color: var(--error);
    min-height: 1em;
}
</style>
