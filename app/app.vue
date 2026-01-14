<script setup lang="ts">
import { onMounted } from "vue";

onMounted(() => {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
});
</script>

<template>
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <ThemeSwitcher />
  </NuxtLayout>
</template>
