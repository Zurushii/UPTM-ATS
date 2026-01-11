<script setup lang="ts">
definePageMeta({
  layout: "dashboard"
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">Students</h1>

    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Student List</h2>
        <p class="opacity-70 mb-4">
          Manage enrolled students under your program.
        </p>

        <button class="btn btn-primary btn-sm">
          Add Student
        </button>

        <!-- placeholder table -->
        <div class="overflow-x-auto mt-4">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>Name</th>
                <th>Matric No</th>
                <th>Program</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ali Ahmad</td>
                <td>UPTM12345</td>
                <td>Computer Science</td>
                <td>Active</td>
              </tr>
              <tr>
                <td>Siti Aminah</td>
                <td>UPTM67890</td>
                <td>Information Systems</td>
                <td>Active</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  </div>
</template>
