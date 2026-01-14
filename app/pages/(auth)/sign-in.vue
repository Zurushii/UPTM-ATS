<script setup lang="ts">
import { signIn } from "@@/utils/auth-client.js";

const email = ref("");
const password = ref("");

const handleSignIn = async () => {
  await signIn.email(
    {
      email: email.value,
      password: password.value,
      callbackURL: "/dashboard",
    },
    {
      onError(context) {
        alert(context.error.message);
      },
    }
  );
};

const signInWithGoogle = async () => {
  await signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
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
            <h1 class="text-2xl font-semibold">
              Welcome back
            </h1>
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
              <input
                v-model="password"
                type="password"
                required
                placeholder="••••••••"
                class="input input-bordered w-full"
              />
                              <NuxtLink
                  to="/forget-password"
                  class="link link-hover text-xs"
                >
                  Forgot password?
                </NuxtLink>
            </div>

            <!-- Submit -->
            <button type="submit" class="btn btn-block">
              Sign in
            </button>
          </form>

          <!-- Divider -->
          <div class="divider text-xs">
            OR CONTINUE WITH
          </div>

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
