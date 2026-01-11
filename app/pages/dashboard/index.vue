<script setup lang="ts">
definePageMeta({
  layout: "dashboard"
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">Dashboard</h1>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">Students</h2>
          <p>Total registered students</p>
          <p class="text-3xl font-bold">120</p>
        </div>
      </div>

      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">Academic Plans</h2>
          <p>Generated plans</p>
          <p class="text-3xl font-bold">98</p>
        </div>
      </div>

      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">Credit Transfers</h2>
          <p>Processed requests</p>
          <p class="text-3xl font-bold">45</p>
        </div>
      </div>
    </div>
  </div>
</template>
