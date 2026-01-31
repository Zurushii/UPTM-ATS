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
  <div class="h-[80vh] flex flex-col items-center justify-center gap-4">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-base-content/70 font-medium">Redirecting to your dashboard...</p>
  </div>
</template>
