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
  <div class="min-h-screen flex items-center justify-center bg-base-200 px-4">
    <div class="card w-full max-w-md bg-base-100 shadow-xl">
      <div class="card-body">
        <!-- Header -->
        <div class="text-center mb-4">
          <h1 class="text-2xl font-bold text-base-content">
            Create Account
          </h1>
          <p class="text-sm text-base-content/60">
            Academic Tracking System – UPTM
          </p>
        </div>

        <!-- Form -->
        <form class="space-y-4" @submit.prevent="handleSignUp">
          <div class="grid grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">First Name</span>
              </label>
              <input
                v-model="firstName"
                type="text"
                required
                placeholder="Max"
                class="input input-bordered"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Last Name</span>
              </label>
              <input
                v-model="lastName"
                type="text"
                required
                placeholder="Robinson"
                class="input input-bordered"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Email</span>
            </label>
            <input
              v-model="email"
              type="email"
              required
              placeholder="student@uptm.edu.my"
              class="input input-bordered"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Password</span>
            </label>
            <input
              v-model="password"
              type="password"
              required
              class="input input-bordered"
            />
          </div>

          <button type="submit" class="btn btn-primary w-full mt-2">
            Create Account
          </button>
        </form>

        <div class="text-center text-sm mt-4 text-base-content/60">
          Already have an account?
          <NuxtLink to="/sign-in" class="link link-primary ml-1">
            Sign in
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
