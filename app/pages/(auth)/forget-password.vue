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
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md card bg-base-100 shadow">
      <div class="card-body">
        <h1 class="card-title">Forgot password</h1>
        <p class="text-sm text-base-content/70">
          Enter your email and we’ll send a password reset link.
        </p>

        <form class="mt-4 space-y-3" @submit.prevent="submit">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text">Email</span>
            </div>
            <input
              v-model="email"
              type="email"
              class="input input-bordered w-full"
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
            {{ loading ? "Sending…" : "Send reset link" }}
          </button>

          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <p v-if="message" class="text-sm text-success">{{ message }}</p>

          <div class="text-sm mt-2">
            <NuxtLink to="/sign-in" class="link">Back to sign in</NuxtLink>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
