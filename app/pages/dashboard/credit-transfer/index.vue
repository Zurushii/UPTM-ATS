<script setup lang="ts">
definePageMeta({
  layout: "dashboard"
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">Credit Transfer</h1>

    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Credit Transfer Requests</h2>
        <p class="opacity-70 mb-4">
          Review and approve student credit transfer applications.
        </p>

        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>Student</th>
                <th>From Course</th>
                <th>To Course</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ali Ahmad</td>
                <td>Intro to IT</td>
                <td>Fundamentals of CS</td>
                <td>
                  <span class="badge badge-warning">Pending</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  </div>
</template>
