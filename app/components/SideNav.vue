<script setup lang="ts">
import { useRoute } from "#app";

const emit = defineEmits(["navigate"]);
const route = useRoute();

const isActive = (basePath: string) => {
  if (basePath === "/dashboard") return route.path === "/dashboard";
  return route.path.startsWith(basePath);
};

const handleClick = () => {
  emit("navigate");
};
</script>

<template>
  <aside class="w-64 bg-base-100 min-h-full border-r">
    <div class="h-16 flex items-center px-6 font-bold text-lg">
      ATS Admin
    </div>

    <nav class="px-4 space-y-1">
      <NuxtLink
        to="/dashboard"
        @click="handleClick"
        class="flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition hover:bg-base-200"
        :class="isActive('/dashboard') && 'bg-primary text-primary-content font-medium'"
      >
        📊 Dashboard
      </NuxtLink>

      <NuxtLink
        to="/dashboard/students"
        @click="handleClick"
        class="flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition hover:bg-base-200"
        :class="isActive('/dashboard/students') && 'bg-primary text-primary-content font-medium'"
      >
        🎓 Students
      </NuxtLink>

      <NuxtLink
        to="/dashboard/academic-plan"
        @click="handleClick"
        class="flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition hover:bg-base-200"
        :class="isActive('/dashboard/academic-plan') && 'bg-primary text-primary-content font-medium'"
      >
        🗂 Academic Plan
      </NuxtLink>

      <NuxtLink
        to="/dashboard/credit-transfer"
        @click="handleClick"
        class="flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition hover:bg-base-200"
        :class="isActive('/dashboard/credit-transfer') && 'bg-primary text-primary-content font-medium'"
      >
        🔄 Credit Transfer
      </NuxtLink>

      <NuxtLink
        to="/dashboard/settings"
        @click="handleClick"
        class="flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition hover:bg-base-200"
        :class="isActive('/dashboard/settings') && 'bg-primary text-primary-content font-medium'"
      >
        ⚙️ Settings
      </NuxtLink>
    </nav>
  </aside>
</template>
