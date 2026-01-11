<script setup lang="ts">
definePageMeta({
  layout: "dashboard"
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">Settings</h1>

    <div class="card bg-base-100 shadow max-w-xl">
      <div class="card-body">
        <h2 class="card-title">Account Settings</h2>

        <div class="form-control">
          <label class="label">
            <span class="label-text">Display Name</span>
          </label>
          <input
            type="text"
            class="input input-bordered"
            placeholder="Your name"
          />
        </div>

        <div class="form-control mt-4">
          <label class="label">
            <span class="label-text">Email</span>
          </label>
          <input
            type="email"
            class="input input-bordered"
            disabled
            value="user@uptm.edu.my"
          />
        </div>

        <div class="card-actions justify-end mt-6">
          <button class="btn btn-primary btn-sm">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
