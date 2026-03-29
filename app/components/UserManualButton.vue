<script setup lang="ts">
defineProps<{
  title: string;
  steps: { text: string; note?: string }[];
}>();

const showModal = ref(false);

const open = (e: Event) => {
  e.stopPropagation();
  e.preventDefault();
  showModal.value = true;
};
</script>

<template>
  <div class="inline-flex">
    <!-- Info Icon Button -->
    <button
      class="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:bg-info/10 hover:text-info transition-all duration-200"
      @click="open"
      title="User Manual"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2.5"
        stroke="currentColor"
        class="w-4 h-4"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
        />
      </svg>
    </button>

    <!-- Modal -->
    <Teleport to="body">
      <dialog class="modal" :class="{ 'modal-open': showModal }">
        <div class="modal-box max-w-lg relative">
          <!-- Close button -->
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
            @click="showModal = false"
          >
            ✕
          </button>

          <!-- Header -->
          <div class="flex items-center gap-3 mb-5">
            <div
              class="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center text-info flex-shrink-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-5 h-5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                />
              </svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">{{ title }}</h3>
              <p class="text-xs text-base-content/50">User Manual</p>
            </div>
          </div>

          <div class="divider my-0"></div>

          <!-- Steps -->
          <ul class="steps steps-vertical w-full mt-4">
            <li
              v-for="(step, index) in steps"
              :key="index"
              class="step step-info"
            >
              <div class="text-left pl-2 py-2">
                <p class="text-sm font-medium leading-relaxed">{{ step.text }}</p>
                <p v-if="step.note" class="text-xs text-base-content/50 mt-1 italic">
                  {{ step.note }}
                </p>
              </div>
            </li>
          </ul>

          <!-- Footer -->
          <div class="modal-action">
            <button class="btn btn-sm" @click="showModal = false">
              Got it
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button @click="showModal = false">close</button>
        </form>
      </dialog>
    </Teleport>
  </div>
</template>
