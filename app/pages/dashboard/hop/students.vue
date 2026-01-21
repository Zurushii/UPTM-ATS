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
  <div class="p-6 max-w-6xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Students</h1>
      <p class="text-sm text-base-content/60">
        List of students under your program.
      </p>
    </div>

    <!-- Students Table Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-4">
        <!-- Table Header -->
        <div class="flex items-center justify-between">
          <h2 class="font-medium">Student Directory</h2>

          <!-- Placeholder for future controls -->
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Search student…"
              class="input input-sm input-bordered"
              disabled
            />
          </div>
        </div>

        <!-- Table -->
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full">
            <thead>
              <tr>
                <th class="text-left">Matric No</th>
                <th class="text-left">Name</th>
                <th class="text-left">Email</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>A22CS001</td>
                <td>Ali Ahmad</td>
                <td>ali@uptm.edu.my</td>
              </tr>
              <tr>
                <td>A22CS002</td>
                <td>Siti Noor</td>
                <td>siti@uptm.edu.my</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Info -->
        <p class="text-sm text-base-content/60">
          Student records are synchronized automatically and used for credit
          transfer processing and academic plan generation.
        </p>
      </div>
    </div>
  </div>
</template>
