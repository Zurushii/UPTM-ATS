<script setup lang="ts">
interface CurrentSession {
  intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data, refresh } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

// Watch for updates triggered from the HOP dashboard
const sessionUpdated = useState<number>("currentSessionUpdated", () => 0);
watch(sessionUpdated, () => {
  refresh();
});

const semesterLabel = computed(() => {
  if (!data.value?.current_session) return "";
  return data.value.current_session.semester_type === "L"
    ? "Long Semester"
    : "Short Semester";
});

const intakeLabel = computed(() => {
  if (!data.value?.current_session) return "";
  return data.value.current_session.intake_period;
});
</script>

<template>
  <div
    v-if="data?.current_session"
    class="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg border border-primary/20"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      class="w-4 h-4 text-primary shrink-0"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
      />
    </svg>
    <div class="flex flex-col leading-tight">
      <span class="text-xs font-bold text-primary">{{ intakeLabel }}</span>
      <span class="text-[10px] text-primary/70">{{ semesterLabel }}</span>
    </div>
  </div>
  <div
    v-else
    class="flex items-center gap-2 px-3 py-1.5 bg-base-200/50 rounded-lg border border-base-300"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      class="w-4 h-4 text-base-content/40 shrink-0"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
      />
    </svg>
    <span class="text-xs text-base-content/40">Session Not Set</span>
  </div>
</template>
