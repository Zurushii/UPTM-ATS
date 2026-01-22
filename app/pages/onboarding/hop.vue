<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

const { data: session } = await authClient.useSession(useFetch);
const programs = ref<{ id: number; program_name: string }[]>([]);
const error = ref("");
const loading = ref(false);

const form = reactive({
  program_id: "" as number | "",
  password: "",
});
const showPassword = ref(false);

onMounted(async () => {
  programs.value = await $fetch("/api/programs");
});

const isValid = computed(
  () => form.program_id !== "" && form.password.length >= 8,
);

const handleSubmit = async () => {
  if (!isValid.value) return;
  error.value = "";
  loading.value = true;

  try {
    await $fetch("/api/onboarding/hop", {
      method: "POST",
      body: { program_id: form.program_id, password: form.password },
    });
    // Update user state to reflect onboarded status
    const userState = useState<any>("user");
    if (userState.value) {
      userState.value.is_onboarded = true;
      userState.value.isOnboarded = true;
    }
    navigateTo("/dashboard/hop");
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Failed to complete onboarding";
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
      <div class="card bg-base-100 shadow-lg border border-base-300">
        <div class="card-body space-y-6">
          <div class="text-center">
            <h1 class="text-xl font-semibold">
              Welcome, {{ session?.user?.name }}!
            </h1>
            <p class="text-sm text-base-content/60">Select your program</p>
          </div>

          <div v-if="error" class="alert alert-error text-sm">{{ error }}</div>

          <form class="space-y-4" @submit.prevent="handleSubmit">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Password</span>
              </label>
              <div class="relative">
                <input
                  v-model="form.password"
                  :type="showPassword ? 'text' : 'password'"
                  class="input input-bordered w-full pr-10"
                  placeholder="Min. 8 characters"
                  minlength="8"
                  required
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
              <label
                v-if="form.password && form.password.length < 8"
                class="label"
              >
                <span class="label-text-alt text-error">
                  Password must be at least 8 characters
                </span>
              </label>
            </div>

            <div class="form-control">
              <label class="label"
                ><span class="label-text">Program</span></label
              >
              <select
                v-model="form.program_id"
                class="select select-bordered w-full"
                required
              >
                <option disabled value="">Select program</option>
                <option v-for="p in programs" :key="p.id" :value="p.id">
                  {{ p.program_name }}
                </option>
              </select>
            </div>

            <button
              type="submit"
              class="btn btn-primary btn-block"
              :disabled="!isValid || loading"
            >
              <span
                v-if="loading"
                class="loading loading-spinner loading-sm"
              ></span>
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
