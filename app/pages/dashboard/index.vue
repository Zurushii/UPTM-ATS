<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
  middleware: [],
});

const user = useState<any>("user");

watchEffect(() => {
  if (!user.value) return;

  if (user.value.role === "HOP") {
    navigateTo("/dashboard/hop");
  }

  if (user.value.role === "STUDENT") {
    navigateTo("/dashboard/student");
  }
});
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-2">Dashboard</h1>
    <p class="text-gray-600">
      Redirecting to your dashboard...
    </p>
  </div>
</template>
