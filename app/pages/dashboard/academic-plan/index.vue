<script setup lang="ts">
definePageMeta({
  layout: "dashboard"
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">Academic Plan</h1>

    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Automated Academic Planning</h2>
        <p class="opacity-70 mb-4">
          Generate and review academic plans until graduation.
        </p>

        <button class="btn btn-primary btn-sm">
          Generate Plan
        </button>

        <div class="mt-6">
          <p class="font-medium mb-2">Latest Generated Plan</p>
          <div class="alert">
            <span>No academic plan generated yet.</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
