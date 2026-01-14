<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});
</script>

<template>
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">
        Academic Planning
      </h1>
      <p class="text-sm text-base-content/60">
        Review automatically generated academic plans for students.
      </p>
    </div>

    <!-- Info Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-3">
        <h2 class="font-medium">
          How academic plans are generated
        </h2>

        <p class="text-sm text-base-content/70">
          Academic plans are generated automatically after credit transfer data
          is uploaded. The system determines the correct semester entry and
          produces a semester-by-semester course plan until graduation.
        </p>

        <p class="text-sm text-base-content/70">
          Once generated, you will be able to review, validate, and monitor
          student progression from this section.
        </p>
      </div>
    </div>

    <!-- Empty State / Placeholder -->
    <div
      class="flex flex-col items-center justify-center border border-dashed border-base-300 rounded-lg p-10 text-center"
    >
      <h3 class="font-medium mb-1">
        No academic plans yet
      </h3>
      <p class="text-sm text-base-content/60 max-w-md">
        Academic plans will appear here once credit transfer data has been
        uploaded and processed by the system.
      </p>
    </div>
  </div>
</template>
