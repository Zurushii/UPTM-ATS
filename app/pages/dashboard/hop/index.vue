<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">HoP Dashboard</h1>
      <p class="text-sm text-base-content/60">
        Overview of students and academic tracking status.
      </p>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <!-- Total Students -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body space-y-1">
          <h2 class="text-sm font-medium text-base-content/70">
            Total Students
          </h2>
          <p class="text-2xl font-semibold">—</p>
          <p class="text-xs text-base-content/60">
            Registered under your program
          </p>
        </div>
      </div>

      <!-- Pending Credit Transfer -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body space-y-1">
          <h2 class="text-sm font-medium text-base-content/70">
            Pending Credit Transfer
          </h2>
          <p class="text-2xl font-semibold">—</p>
          <p class="text-xs text-base-content/60">
            Awaiting upload or processing
          </p>
        </div>
      </div>

      <!-- Academic Plans Generated -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body space-y-1">
          <h2 class="text-sm font-medium text-base-content/70">
            Academic Plans Generated
          </h2>
          <p class="text-2xl font-semibold">—</p>
          <p class="text-xs text-base-content/60">
            Ready for review or approval
          </p>
        </div>
      </div>
    </div>

    <!-- Empty State / Guidance -->
    <div
      class="border border-dashed border-base-300 rounded-lg p-8 text-center"
    >
      <h3 class="font-medium mb-1">Getting started</h3>
      <p class="text-sm text-base-content/60 max-w-xl mx-auto">
        Begin by uploading credit transfer data. Once processed, the system will
        automatically determine semester entry and generate academic plans for
        students.
      </p>
    </div>
  </div>
</template>
