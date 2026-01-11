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
  <div class="min-h-screen flex items-center justify-center bg-base-200 px-4">
    <div class="card w-full max-w-md bg-base-100 shadow-xl">
      <div class="card-body">
        <!-- Header -->
        <div class="text-center mb-4">
          <h1 class="text-2xl font-bold text-base-content">
            Login
          </h1>
          <p class="text-sm text-base-content/60">
            Enter your email below to login to your account
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
              placeholder="m@example.com"
              class="input input-bordered"
            />
          </div>

          <!-- Password -->
          <div class="form-control">
            <label class="label justify-between">
              <span class="label-text">Password</span>
              <NuxtLink
                to="/forget-password"
                class="link link-hover text-sm"
              >
                Forgot password?
              </NuxtLink>
            </label>
            <input
              v-model="password"
              type="password"
              required
              placeholder="••••••••"
              class="input input-bordered"
            />
          </div>

          <!-- Submit -->
          <button type="submit" class="btn btn-primary w-full mt-2">
            Login
          </button>
        </form>

        <!-- Divider -->
        <div class="divider">OR</div>

        <!-- Social Login -->
        <button
          class="btn btn-outline w-full"
          @click="signInWithGoogle"
        >
          Login with Google
        </button>

        <!-- Footer -->
        <div class="text-center text-sm mt-4 text-base-content/60">
          Don&apos;t have an account?
          <NuxtLink to="/sign-up" class="link link-primary ml-1">
            Sign up
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
