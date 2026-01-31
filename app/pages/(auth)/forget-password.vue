<script setup lang="ts">
import { requestPasswordReset } from "@@/utils/auth-client";

const email = ref("");
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

const submit = async () => {
  message.value = null;
  error.value = null;
  loading.value = true;

  try {
    const trimmedEmail = email.value.trim();
    if (!trimmedEmail) {
      error.value = "Please enter your email.";
      return;
    }

    await requestPasswordReset({ email: trimmedEmail });
    message.value =
      "If an account exists for this email, a reset link has been sent.";
  } catch (e: any) {
    // Avoid leaking account existence; show generic message.
    message.value =
      "If an account exists for this email, a reset link has been sent.";
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
    <div class="w-full max-w-md card bg-base-100 shadow-xl">
      <div class="card-body">
        <h1 class="card-title text-2xl font-bold justify-center">Forgot password</h1>
        <p class="text-sm opacity-70 text-center">
          Enter your email and we’ll send a password reset link.
        </p>

        <form class="mt-4 space-y-4" @submit.prevent="submit">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-medium">Email</span>
            </div>
            <input
              v-model="email"
              type="email"
              class="input input-bordered focus:input-primary w-full transition-all"
              placeholder="you@example.com"
              autocomplete="email"
              required
            />
          </label>

          <button
            class="btn btn-primary w-full"
            type="submit"
            :disabled="loading"
          >
            <span v-if="loading" class="loading loading-spinner loading-sm"></span>
            {{ loading ? "Sending…" : "Send reset link" }}
          </button>

          <p v-if="error" class="text-sm text-error text-center">{{ error }}</p>
          <p v-if="message" class="text-sm text-success text-center">{{ message }}</p>

          <div class="text-sm mt-4 text-center">
            <NuxtLink to="/sign-in" class="link link-primary link-hover font-medium">Back to sign in</NuxtLink>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
