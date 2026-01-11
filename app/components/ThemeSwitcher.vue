<template>
  <!-- 🎨 Floating Button -->
  <button
    class="btn btn-primary btn-circle fixed bottom-5 right-5 shadow-lg z-50"
    @click="openModal"
    aria-label="Theme switcher"
  >
    🎨
  </button>

  <!-- DaisyUI Dialog -->
  <dialog ref="dialogRef" class="modal">
    <!-- backdrop (click outside closes modal) -->
    <form method="dialog" class="modal-backdrop">
      <button aria-label="close"></button>
    </form>

    <!-- modal content -->
    <div class="modal-box max-w-2xl p-5">
      <h3 class="font-bold text-lg">Theme</h3>
      <p class="text-sm opacity-70 mb-4">
        Choose your preferred appearance
      </p>

      <!-- Theme cards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div
          v-for="theme in themes"
          :key="theme"
          :data-theme="theme"
          @click="applyTheme(theme)"
          class="cursor-pointer rounded-lg border
                 bg-base-100 text-base-content
                 transition hover:shadow hover:scale-[1.02]"
          :class="{
            'ring-2 ring-primary': currentTheme === theme
          }"
        >
          <div class="p-3 space-y-2">
            <!-- header -->
            <div class="flex justify-between items-center">
              <span class="font-medium capitalize text-sm">
                {{ theme }}
              </span>
              <span
                v-if="currentTheme === theme"
                class="badge badge-primary badge-xs"
              >
                Active
              </span>
            </div>

            <!-- preview -->
            <div class="rounded-md p-2 bg-base-200">
              <p class="text-xs font-semibold">Title</p>
              <p class="text-[10px] opacity-70 mb-1">Body text</p>
              <button class="btn btn-primary btn-xs">
                Primary
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- footer -->
      <div class="modal-action mt-4">
        <button class="btn btn-sm btn-ghost" @click="closeModal">
          Close
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

const dialogRef = ref<HTMLDialogElement | null>(null);
const currentTheme = ref("");

/**
 * Latest DaisyUI themes (deduplicated & verified)
 */
const themes = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
  "caramellatte",
  "abyss",
  "silk"
];

const openModal = () => {
  dialogRef.value?.showModal();
};

const closeModal = () => {
  dialogRef.value?.close();
};

const applyTheme = (theme: string) => {
  currentTheme.value = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
};

onMounted(() => {
  const saved = localStorage.getItem("theme");
  currentTheme.value = saved && themes.includes(saved) ? saved : "light";
});
</script>
