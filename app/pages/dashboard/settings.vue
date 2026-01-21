<script setup lang="ts">
// This page has been merged into /dashboard/profile
// Redirect to the new unified profile page
definePageMeta({ layout: "dashboard" });
await navigateTo("/dashboard/profile", { replace: true });
</script>

<template>
  <div class="flex justify-center py-12">
    <span class="loading loading-spinner loading-lg"></span>
  </div>
</template>
