<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

const { data: session } = await authClient.useSession(useFetch);
const programs = ref<{ id: number; program_name: string }[]>([]);
const error = ref("");
const loading = ref(false);

const form = reactive({
  full_name: "",
  matric_no: "",
  intake_year: "",
  program_id: "" as number | "",
});

onMounted(async () => {
  // Pre-fill name from session if available
  if (session.value?.user?.name) {
    form.full_name = session.value.user.name;
  }
  programs.value = await $fetch("/api/programs");
});

// MMYY format: 01-12 for month, 00-99 for year
const intakeValid = computed(() => {
  if (!/^\d{4}$/.test(form.intake_year)) return false;
  const month = parseInt(form.intake_year.substring(0, 2), 10);
  return month >= 1 && month <= 12;
});

const isValid = computed(() => {
  return (
    form.full_name.trim().length >= 2 &&
    form.matric_no.length >= 6 &&
    intakeValid.value &&
    form.program_id !== ""
  );
});

const handleSubmit = async () => {
  if (!isValid.value) return;
  error.value = "";
  loading.value = true;

  try {
    await $fetch("/api/onboarding/student", {
      method: "POST",
      body: {
        full_name: form.full_name,
        matric_no: form.matric_no,
        intake_year: form.intake_year,
        program_id: form.program_id,
      },
    });
    navigateTo("/dashboard/student");
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
            <p class="text-sm text-base-content/60">
              Complete your student profile
            </p>
          </div>

          <div v-if="error" class="alert alert-error text-sm">{{ error }}</div>

          <form class="space-y-4" @submit.prevent="handleSubmit">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Full Name</span>
              </label>
              <input
                v-model="form.full_name"
                type="text"
                class="input input-bordered w-full"
                placeholder="e.g. John Doe"
                required
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Student ID (Matric No)</span>
              </label>
              <input
                v-model="form.matric_no"
                type="text"
                class="input input-bordered w-full"
                placeholder="e.g. CS2312345"
                required
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Intake (MMYY)</span>
              </label>
              <input
                v-model="form.intake_year"
                type="text"
                class="input input-bordered w-full"
                placeholder="e.g. 0824 (Aug 2024)"
                maxlength="4"
                required
              />
              <label v-if="form.intake_year && !intakeValid" class="label">
                <span class="label-text-alt text-error">
                  Format: MMYY (e.g., 0824)
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
