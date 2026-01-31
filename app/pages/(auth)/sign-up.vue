<script lang="ts" setup>
import { signIn, signUp } from "@@/utils/auth-client.js";

const firstName = ref("");
const lastName = ref("");
const email = ref("");
const password = ref("");
const showPassword = ref(false);

const router = useRouter();

const handleSignUp = async () => {
  await signUp.email({
    email: email.value,
    password: password.value,
    name: `${firstName.value} ${lastName.value}`,
    callbackURL: "/onboarding",
    fetchOptions: {
      onError(context) {
        alert(context.error.message);
      },
      onSuccess() {
        router.push("/onboarding");
      },
    },
  });
};

const signUpWithGoogle = async () => {
  await signIn.social({
    provider: "google",
    callbackURL: "/onboarding",
  });
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-base-200 px-4">
    <div class="w-full max-w-md">
      <!-- Card -->
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body space-y-4">
          <!-- Header -->
          <div class="text-center space-y-1 mb-2">
            <h1 class="text-2xl font-bold">Create your account</h1>
            <p class="text-sm opacity-70">
              Academic Tracking System – UPTM
            </p>
          </div>

          <!-- Form -->
          <form class="space-y-4" @submit.prevent="handleSignUp">
            <!-- Name -->
            <div class="grid grid-cols-2 gap-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text font-medium">First name</span>
                </label>
                <input
                  v-model="firstName"
                  type="text"
                  required
                  placeholder="Max"
                  class="input input-bordered focus:input-primary w-full transition-all"
                />
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text font-medium">Last name</span>
                </label>
                <input
                  v-model="lastName"
                  type="text"
                  required
                  placeholder="Robinson"
                  class="input input-bordered focus:input-primary w-full transition-all"
                />
              </div>
            </div>

            <!-- Email -->
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Email</span>
              </label>
              <input
                v-model="email"
                type="email"
                required
                placeholder="student@uptm.edu.my"
                class="input input-bordered focus:input-primary w-full transition-all"
              />
            </div>

            <!-- Password -->
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Password</span>
              </label>
              <div class="relative">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  placeholder="••••••••"
                  class="input input-bordered focus:input-primary w-full pr-10 transition-all"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
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
            </div>

            <!-- Submit -->
            <button type="submit" class="btn btn-primary btn-block">Create account</button>
          </form>

          <!-- Divider -->
          <div class="divider text-xs opacity-50">OR CONTINUE WITH</div>

          <!-- Social Sign-up -->
          <button
            type="button"
            class="btn btn-outline btn-block"
            @click="signUpWithGoogle"
          >
           <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <!-- Footer -->
          <p class="text-center text-sm opacity-70 mt-4">
            Already have an account?
            <NuxtLink to="/sign-in" class="link link-primary link-hover font-medium">
              Sign in
            </NuxtLink>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
