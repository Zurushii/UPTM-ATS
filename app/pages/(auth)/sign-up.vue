<script lang="ts" setup>
import { signUp } from "@@/utils/auth-client.js";

const firstName = ref("");
const lastName = ref("");
const email = ref("");
const password = ref("");

const router = useRouter();

const handleSignUp = async () => {
  await signUp.email({
    email: email.value,
    password: password.value,
    name: `${firstName.value} ${lastName.value}`,
    callbackURL: "/sign-in",
    fetchOptions: {
      onError(context) {
        alert(context.error.message);
      },
      onSuccess() {
        router.push("/dashboard");
      },
    },
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
            <h1 class="text-2xl font-semibold">Create your account</h1>
            <p class="text-sm text-base-content/60">
              Academic Tracking System – UPTM
            </p>
          </div>

          <!-- Form -->
          <form class="space-y-4" @submit.prevent="handleSignUp">
            <!-- Name -->
            <div class="grid grid-cols-2 gap-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text">First name</span>
                </label>
                <input
                  v-model="firstName"
                  type="text"
                  required
                  placeholder="Max"
                  class="input input-bordered w-full"
                />
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text">Last name</span>
                </label>
                <input
                  v-model="lastName"
                  type="text"
                  required
                  placeholder="Robinson"
                  class="input input-bordered w-full"
                />
              </div>
            </div>

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
              <label class="label">
                <span class="label-text">Password</span>
              </label>
              <input
                v-model="password"
                type="password"
                required
                placeholder="••••••••"
                class="input input-bordered w-full"
              />
            </div>

            <!-- Submit -->
            <button type="submit" class="btn btn-block">Create account</button>
          </form>

          <!-- Footer -->
          <p class="text-center text-sm text-base-content/60">
            Already have an account?
            <NuxtLink to="/sign-in" class="link link-hover ml-1">
              Sign in
            </NuxtLink>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
