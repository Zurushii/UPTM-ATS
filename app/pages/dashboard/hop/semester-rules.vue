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
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Semester Entry Rules</h1>
      <p class="text-sm text-base-content/60">
        Define rules to determine a student’s starting semester based on
        transferred credit hours.
      </p>
    </div>

    <!-- Rules Table Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-4">
        <!-- Table Header -->
        <div class="flex items-center justify-between">
          <h2 class="font-medium">Credit-to-Semester Mapping</h2>

          <!-- Placeholder for future action -->
          <button class="btn btn-sm">Add rule</button>
        </div>

        <!-- Table -->
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full">
            <thead>
              <tr>
                <th>Min Credit</th>
                <th>Max Credit</th>
                <th>Starting Semester</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>0</td>
                <td>20</td>
                <td>Semester 1</td>
              </tr>
              <tr>
                <td>21</td>
                <td>40</td>
                <td>Semester 2</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Info -->
        <p class="text-sm text-base-content/60">
          These rules are applied automatically after credit transfer data is
          uploaded to determine the correct semester entry for each student.
        </p>
      </div>
    </div>
  </div>
</template>
