<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

if (!(import.meta.server && import.meta.prerender)) {
  const { data: session } = await authClient.useSession(useFetch);

  if (!session.value?.user) {
    navigateTo("/sign-in");
  } else if (session.value.user.is_onboarded) {
    navigateTo("/dashboard");
  } else if (session.value.user.role === "STUDENT") {
    navigateTo("/onboarding/student");
  } else if (session.value.user.role === "HOP") {
    navigateTo("/onboarding/hop");
  } else {
    navigateTo("/sign-in");
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <span class="loading loading-spinner loading-lg"></span>
  </div>
</template>
