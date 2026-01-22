<script setup lang="ts">
import { signIn } from "@@/utils/auth-client.js";

const email = ref("");
const password = ref("");
const showPassword = ref(false);

const handleSignIn = async () => {
  await signIn.email(
    {
      email: email.value,
      password: password.value,
      callbackURL: "/onboarding",
    },
    {
      onError(context) {
        alert(context.error.message);
      },
    },
  );
};

const signInWithGoogle = async () => {
  await signIn.social({
    provider: "google",
    callbackURL: "/onboarding",
  });
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
      <!-- Card -->
      <div class="card bg-base-100 shadow-lg border border-base-300">
        <div class="card-body space-y-6">
          <!-- Header -->
          <div class="text-center space-y-1">
            <h1 class="text-2xl font-semibold">Welcome back</h1>
            <p class="text-sm text-base-content/60">
              Sign in to continue to your dashboard
            </p>
          </div>

          <!-- Form -->
          <form class="space-y-4" @submit.prevent="handleSignIn">
            <!-- Email -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Email</span>
              </label>
              <input
                v-model="email"
                type="email"
                required
                placeholder="student@uptm.edu.my"
                class="input input-bordered w-full"
              />
            </div>

            <!-- Password -->
            <div class="form-control">
              <label class="label justify-between">
                <span class="label-text">Password</span>
              </label>
              <div class="relative">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  placeholder="••••••••"
                  class="input input-bordered w-full pr-10"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                  @click="showPassword = !showPassword"
                >
                  <svg
                    v-if="showPassword"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                    />
                  </svg>
                  <svg
                    v-else
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                </button>
              </div>
              <NuxtLink to="/forget-password" class="link link-hover text-xs">
                Forgot password?
              </NuxtLink>
            </div>

            <!-- Submit -->
            <button type="submit" class="btn btn-block">Sign in</button>
          </form>

          <!-- Divider -->
          <div class="divider text-xs">OR CONTINUE WITH</div>

          <!-- Social Login -->
          <button
            type="button"
            class="btn btn-outline btn-block"
            @click="signInWithGoogle"
          >
            Continue with Google
          </button>

          <!-- Footer -->
          <p class="text-center text-sm text-base-content/60">
            Don’t have an account?
            <NuxtLink to="/sign-up" class="link link-hover ml-1">
              Sign up
            </NuxtLink>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
