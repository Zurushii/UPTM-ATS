<script setup lang="ts">
definePageMeta({
  middleware: () => {
    return navigateTo("/dashboard");
  }
});
</script>

<template>
  <!-- Optional: loading state -->
  <div class="flex items-center justify-center min-h-screen">
    <span class="loading loading-spinner loading-lg"></span>
  </div>
</template>
