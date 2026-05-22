<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const toast = reactive({ show: false, message: "", type: "info" });
const showToast = (
  message: string,
  type: "info" | "success" | "warning" | "error" = "info",
) => {
  toast.message = message;
  toast.type = type;
  toast.show = true;
  setTimeout(() => {
    toast.show = false;
  }, 3000);
};

interface IntakeData {
  id: number;
  intake_year: string;
  intake_name: string;
  session_id: number;
  session_name: string;
  intake_type: string;
  status: "draft" | "generated" | "completed";
  total_students: number;
  successful_plans: number;
  failed_plans: number;
  created_at: string;
  updated_at: string;
}

const searchQuery = ref("");
const isDeleteModalOpen = ref(false);
const deleteLoading = ref(false);
const selectedIntakeToDelete = ref<IntakeData | null>(null);

const {
  data: intakes,
  pending: intakesPending,
  refresh: refreshIntakes,
} = await useFetch<IntakeData[]>("/api/hop/academic-planning");

const filteredIntakes = computed(() => {
  if (!intakes.value) return [];
  if (!searchQuery.value) return intakes.value;

  const query = searchQuery.value.toLowerCase();
  return intakes.value.filter(
    (intake) =>
      intake.intake_name.toLowerCase().includes(query) ||
      intake.intake_year.includes(query) ||
      intake.session_name.toLowerCase().includes(query) ||
      intake.intake_type.toLowerCase().includes(query),
  );
});

const formatIntake = (intake: string) => {
  if (!intake || intake.length !== 4) return intake;
  const month = parseInt(intake.substring(0, 2), 10);
  const year = parseInt(intake.substring(2, 4), 10);
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  return `${monthNames[month - 1]} ${fullYear}`;
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "draft":
      return "badge-warning";
    case "generated":
      return "badge-success";
    case "completed":
      return "badge-primary badge-outline border-primary/30 bg-primary/10 text-primary";
    default:
      return "badge-ghost";
  }
};

const openDeleteModal = (intake: IntakeData) => {
  selectedIntakeToDelete.value = intake;
  isDeleteModalOpen.value = true;
};

const closeDeleteModal = () => {
  isDeleteModalOpen.value = false;
  selectedIntakeToDelete.value = null;
};

const deleteIntake = async () => {
  if (!selectedIntakeToDelete.value) return;

  deleteLoading.value = true;
  try {
    await $fetch(
      `/api/hop/academic-planning/${selectedIntakeToDelete.value.id}`,
      {
        method: "DELETE",
      },
    );

    await refreshIntakes();
    closeDeleteModal();
    showToast("Academic planning batch deleted", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to delete intake",
      "error",
    );
  } finally {
    deleteLoading.value = false;
  }
};

const viewIntake = (intake: IntakeData) => {
  navigateTo(`/dashboard/hop/academic-planning/${intake.id}`);
};

const manualSteps = [
  {
    text: 'Use "Student Intake Check" to process the intake file, review starting semesters, and generate academic plans.',
  },
  {
    text: "This page is for tracking batches that have already been created and opening student-level planning details.",
  },
  {
    text: 'Click "View" on any batch to open the intake details, inspect student plans, and manage schedules.',
  },
  {
    text: 'Use "Delete" only when you need to remove a batch and all of its linked academic plans.',
    note: "This action is irreversible.",
  },
];
</script>

<template>
  <div class="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8 relative">
    <div class="absolute -top-10 -left-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>
    <div class="absolute top-40 -right-10 w-64 h-64 bg-secondary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>

    <div v-if="toast.show" class="toast toast-top toast-end z-50">
      <div
        class="alert shadow-lg"
        :class="{
          'alert-info': toast.type === 'info',
          'alert-success': toast.type === 'success',
          'alert-warning': toast.type === 'warning',
          'alert-error': toast.type === 'error',
        }"
      >
        <span>{{ toast.message }}</span>
      </div>
    </div>

    <div
      class="flex flex-col md:flex-row md:items-end justify-between gap-4 relative z-10"
    >
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
            Academic <span class="text-primary">Planning</span>
          </h1>
          <UserManualButton
            title="Academic Planning"
            :steps="manualSteps"
          />
        </div>
        <p class="text-base-content/60 font-medium max-w-2xl">
          Review generated intake batches, open student plans, and manage schedules after the intake-to-plan flow is complete.
        </p>
      </div>
      <NuxtLink
        to="/dashboard/hop/intake-assessment"
        class="btn btn-primary shadow-lg shadow-primary/20 gap-2 hover:-translate-y-0.5 transition-transform rounded-xl"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-5 h-5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Student Intake Check
      </NuxtLink>
    </div>

    <div class="card bg-base-100 border border-base-200 shadow-sm">
      <div class="card-body flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p class="text-sm font-semibold text-base-content/70">
            Planning batches are now created from the Student Intake Check flow.
          </p>
          <p class="text-sm text-base-content/55 mt-1">
            Use this page to monitor generated batches and continue into student-level planning work.
          </p>
        </div>
        <div class="form-control w-full md:max-w-sm">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search intakes, sessions, or rule sets..."
            class="input input-bordered w-full"
          />
        </div>
      </div>
    </div>

    <div v-if="intakesPending" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-md"></span>
    </div>

    <div
      v-else-if="!intakes || intakes.length === 0"
      class="flex flex-col items-center justify-center border border-dashed border-base-300 rounded-lg p-10 text-center bg-base-100"
    >
      <div class="text-5xl mb-4">Plan</div>
      <h3 class="font-medium mb-1">No academic planning batches yet</h3>
      <p class="text-sm text-base-content/60 max-w-md mb-4">
        Start from Student Intake Check to process an intake, review the starting semester, and generate the first academic planning batch.
      </p>
      <NuxtLink to="/dashboard/hop/intake-assessment" class="btn btn-primary btn-sm">
        Open Student Intake Check
      </NuxtLink>
    </div>

    <div
      v-else
      class="overflow-x-auto rounded-xl border border-base-200 mt-4 bg-base-100 shadow-sm"
    >
      <table class="table w-full">
        <thead class="bg-base-200/50 text-base-content/70 uppercase text-xs tracking-wider">
          <tr>
            <th class="pl-6 rounded-tl-lg text-center">Intake</th>
            <th class="text-center">Session</th>
            <th class="text-center">Rule Set</th>
            <th class="text-center">Status</th>
            <th class="text-center">Students</th>
            <th class="text-center">Created</th>
            <th class="pr-6 text-center rounded-tr-lg">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-base-200">
          <tr
            v-for="intake in filteredIntakes"
            :key="intake.id"
            class="hover:bg-base-200/30 transition-colors"
          >
            <td class="pl-6 text-center">
              <div>
                <div class="font-medium text-base-content">{{ intake.intake_name }}</div>
                <div class="text-xs text-base-content/60 font-mono mt-0.5">
                  {{ formatIntake(intake.intake_year) }}
                </div>
              </div>
            </td>
            <td class="text-base-content/80 text-center">{{ intake.session_name }}</td>
            <td class="font-mono text-sm text-base-content/80 text-center">{{ intake.intake_type }}</td>
            <td class="text-center">
              <span
                class="badge badge-sm font-medium shadow-sm capitalize"
                :class="getStatusBadgeClass(intake.status)"
              >
                {{ intake.status }}
              </span>
            </td>
            <td class="text-center">
              <div class="flex items-center justify-center gap-1">
                <span class="text-success font-semibold px-1">{{ intake.successful_plans }}</span>
                <span class="text-base-content/30">/</span>
                <span class="text-base-content/60 px-1">{{ intake.total_students }}</span>
                <span
                  v-if="intake.failed_plans > 0"
                  class="text-error text-xs font-medium ml-1 bg-error/10 px-1.5 py-0.5 rounded"
                >
                  {{ intake.failed_plans }} failed
                </span>
              </div>
            </td>
            <td class="text-sm text-base-content/50 font-mono text-center">
              {{ formatDate(intake.created_at) }}
            </td>
            <td class="pr-6 text-center">
              <div class="flex justify-center gap-2">
                <button
                  class="btn btn-xs bg-primary/10 text-primary hover:bg-primary hover:text-white border-0 shadow-sm transition-all rounded-lg"
                  @click="viewIntake(intake)"
                >
                  View
                </button>
                <button
                  class="btn btn-xs bg-error/10 text-error hover:bg-error hover:text-white border-0 shadow-sm transition-all rounded-lg"
                  @click="openDeleteModal(intake)"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <dialog :class="{ 'modal modal-open': isDeleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">Delete Academic Planning?</h3>
        <p class="py-4 text-sm text-base-content/70">
          This will remove the selected batch and all linked academic plans.
        </p>
        <div
          v-if="selectedIntakeToDelete"
          class="rounded-lg border border-base-200 bg-base-200/40 p-4 text-sm"
        >
          <div class="font-semibold">{{ selectedIntakeToDelete.intake_name }}</div>
          <div class="text-base-content/60">
            {{ formatIntake(selectedIntakeToDelete.intake_year) }} ·
            {{ selectedIntakeToDelete.session_name }}
          </div>
        </div>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeDeleteModal">Cancel</button>
          <button
            class="btn btn-error"
            :disabled="deleteLoading"
            @click="deleteIntake"
          >
            {{ deleteLoading ? "Deleting..." : "Delete Batch" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeDeleteModal">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
