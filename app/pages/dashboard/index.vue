<script setup lang="ts">
import { authClient } from '~~/utils/auth-client';

definePageMeta({
  layout: "dashboard",
  middleware: [],
});

const { data: session } = await authClient.useSession(useFetch);

  if (!session.value?.user) {
    navigateTo("/sign-in");
  }

  if (session.value?.user.role === "HOP" && session.value?.user.is_onboarded == true) {
    navigateTo("/dashboard/hop");
  }

  if (session.value?.user.role === "STUDENT" && session.value?.user.is_onboarded == true) {
    navigateTo("/dashboard/student");
  }

</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-2">Dashboard</h1>
    <p class="text-gray-600">
      Redirecting to your dashboard...
    </p>
  </div>
</template>
