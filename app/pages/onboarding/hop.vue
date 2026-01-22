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
              <input
                v-model="form.password"
                type="password"
                class="input input-bordered w-full"
                placeholder="Min. 8 characters"
                minlength="8"
                required
              />
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
