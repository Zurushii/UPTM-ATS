<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const route = useRoute();
const intakeId = route.params.id as string;

// Types
interface StudentData {
  student_id: number;
  matric_no: string;
  student_name: string;
  entry_semester: number | null;
  total_credit_transferred: number | null;
  academic_plan_id: number | null;
  plan_status: string | null;
}

interface IntakeDetail {
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
  students: StudentData[];
}

interface PreviewStudent {
  matric_no: string;
  student_name: string;
  entry_semester: number | null;
  total_credit_transferred: number | null;
  status: "ready" | "missing_entry_semester" | "already_has_plan";
  reason?: string;
}

interface FailedRecord {
  row: number;
  matric_no: string | null;
  reason: string;
}

// Toast state
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
  }, 4000);
};

// State
const searchQuery = ref("");
const filterStatus = ref<string>("all");
const markAsCompletedLoading = ref(false);

// Regenerate modal state
const isRegenerateModalOpen = ref(false);
const regenStep = ref(1); // 1=upload, 2=preview, 3=results
const regenFileInput = ref<HTMLInputElement | null>(null);
const regenSelectedFile = ref<File | null>(null);
const regenIsDragging = ref(false);
const regenIsPreviewLoading = ref(false);
const regenIsGenerating = ref(false);

const regenPreviewResult = ref<{
  summary: {
    total_in_excel: number;
    ready_to_generate: number;
    will_be_skipped: number;
    missing_entry_semester: number;
    failed_records: number;
  };
  preview_students: PreviewStudent[];
  failed_records: FailedRecord[];
} | null>(null);

const regenGenerateResult = ref<{
  summary: {
    total_processed: number;
    successful: number;
    failed: number;
    skipped_existing: number;
  };
  failed_students: Array<{
    student_id: number;
    matric_no: string;
    reason: string;
  }>;
} | null>(null);

// Fetch intake details
const {
  data: intakeData,
  pending: loading,
  refresh,
} = await useFetch<IntakeDetail>(`/api/hop/academic-planning/${intakeId}`);

// Check if intake exists
if (!loading.value && !intakeData.value) {
  await navigateTo("/dashboard/hop/academic-planning");
}

// Filtered students
const filteredStudents = computed(() => {
  if (!intakeData.value?.students) return [];

  let students = intakeData.value.students;

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    students = students.filter(
      (s) =>
        s.matric_no.toLowerCase().includes(query) ||
        (s.student_name && s.student_name.toLowerCase().includes(query))
    );
  }

  // Filter by status
  if (filterStatus.value === "no_plan") {
    students = students.filter((s) => !s.academic_plan_id);
  } else if (filterStatus.value !== "all") {
    students = students.filter((s) => s.plan_status === filterStatus.value);
  }

  return students;
});

// Stats
const stats = computed(() => {
  if (!intakeData.value?.students) {
    return { total: 0, withPlan: 0, noPlan: 0, draftPlanned: 0, approved: 0 };
  }

  const students = intakeData.value.students;
  return {
    total: students.length,
    withPlan: students.filter((s) => s.academic_plan_id).length,
    noPlan: students.filter((s) => !s.academic_plan_id).length,
    draftPlanned: students.filter((s) => s.plan_status === "draft").length,
    approved: students.filter((s) => s.plan_status === "approved").length,
    completed: students.filter((s) => s.plan_status === "completed").length,
  };
});

// Check if all students are marked as completed to show the Mark as Completed button
const canMarkAsCompleted = computed(() => {
  if (!intakeData.value || !intakeData.value.students || intakeData.value.students.length === 0) return false;
  return stats.value.total > 0 && stats.value.completed === stats.value.total;
});

// Check if there are students without plans (for showing regenerate button)
const hasStudentsWithoutPlans = computed(() => stats.value.noPlan > 0);

// Format intake year
const formatIntake = (intake: string) => {
  if (!intake || intake.length !== 4) return intake;
  const month = parseInt(intake.substring(0, 2));
  const year = parseInt(intake.substring(2, 4));
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  return `${monthNames[month - 1]} ${fullYear}`;
};

// Format date
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Get status badge class
const getStatusBadgeClass = (status: string | null) => {
  switch (status) {
    case "draft":
      return "badge-warning";
    case "approved":
      return "badge-success";
    case "completed":
      return "badge-info";
    default:
      return "badge-ghost";
  }
};

// View student plan
const viewStudentPlan = (student: StudentData) => {
  if (student.academic_plan_id) {
    navigateTo(
      `/dashboard/hop/academic-planning/student/${student.academic_plan_id}`
    );
  }
};

// View student schedule
const viewStudentSchedule = (student: StudentData) => {
  if (student.academic_plan_id) {
    navigateTo(
      `/dashboard/hop/academic-planning/schedule/${student.academic_plan_id}`
    );
  }
};

// Go back
const goBack = () => {
  navigateTo("/dashboard/hop/academic-planning");
};

const isCompleteModalOpen = ref(false);

const openCompleteModal = () => {
  isCompleteModalOpen.value = true;
};

const closeCompleteModal = () => {
  isCompleteModalOpen.value = false;
};

const confirmMarkAsCompleted = async () => {
  isCompleteModalOpen.value = false;
  markAsCompletedLoading.value = true;
  try {
    await ($fetch as any)(`/api/hop/academic-planning/${intakeId}/complete`, {
      method: "PUT" as any
    });
    showToast("Intake marked as completed successfully", "success");
    await refresh();
  } catch (error: any) {
    showToast(error.data?.message || error.message || "Failed to mark as completed", "error");
  } finally {
    markAsCompletedLoading.value = false;
  }
};

// ── Regenerate Logic ──

const openRegenerateModal = () => {
  regenStep.value = 1;
  regenSelectedFile.value = null;
  regenPreviewResult.value = null;
  regenGenerateResult.value = null;
  isRegenerateModalOpen.value = true;
};

const closeRegenerateModal = () => {
  isRegenerateModalOpen.value = false;
  regenSelectedFile.value = null;
  regenPreviewResult.value = null;
  regenGenerateResult.value = null;
  if (regenFileInput.value) {
    regenFileInput.value.value = "";
  }
};

// File handling
const regenHandleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    regenValidateAndSetFile(target.files[0]);
  }
};

const regenHandleDrop = (event: DragEvent) => {
  event.preventDefault();
  regenIsDragging.value = false;
  if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
    regenValidateAndSetFile(event.dataTransfer.files[0]);
  }
};

const regenHandleDragOver = (event: DragEvent) => {
  event.preventDefault();
  regenIsDragging.value = true;
};

const regenHandleDragLeave = () => {
  regenIsDragging.value = false;
};

const regenValidateAndSetFile = (file: File) => {
  const validTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  const validExtensions = [".xlsx", ".xls"];

  const hasValidType = validTypes.includes(file.type);
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );

  if (!hasValidType && !hasValidExtension) {
    showToast("Please select a valid Excel file (.xlsx or .xls)", "error");
    return;
  }

  regenSelectedFile.value = file;
};

const regenRemoveFile = () => {
  regenSelectedFile.value = null;
  if (regenFileInput.value) {
    regenFileInput.value.value = "";
  }
};

const regenTriggerFileInput = () => {
  regenFileInput.value?.click();
};

// Preview
const regenPreview = async () => {
  if (!regenSelectedFile.value) return;

  regenIsPreviewLoading.value = true;
  regenPreviewResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", regenSelectedFile.value);
    formData.append("intake_id", intakeId);

    const response = await $fetch("/api/hop/academic-planning/preview", {
      method: "POST",
      body: formData,
    });

    regenPreviewResult.value = response as unknown as typeof regenPreviewResult.value;
    regenStep.value = 2;
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Preview failed",
      "error",
    );
  } finally {
    regenIsPreviewLoading.value = false;
  }
};

// Generate
const regenGenerate = async () => {
  if (!regenSelectedFile.value) return;

  regenIsGenerating.value = true;
  regenGenerateResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", regenSelectedFile.value);
    formData.append("intake_id", intakeId);

    const response = await $fetch("/api/hop/academic-planning/generate", {
      method: "POST",
      body: formData,
    });

    regenGenerateResult.value = response as unknown as typeof regenGenerateResult.value;
    regenStep.value = 3;
    await refresh();
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Generation failed",
      "error",
    );
  } finally {
    regenIsGenerating.value = false;
  }
};
</script>

<template>
  <div class="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8 relative">
    <!-- Ambient glow -->
    <div class="absolute -top-10 -left-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>
    <div class="absolute top-40 -right-10 w-64 h-64 bg-secondary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>

    <!-- Toast Notification -->
    <div v-if="toast.show" class="toast toast-bottom toast-center z-50 mb-6">
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

    <!-- Page Header -->
    <div class="flex flex-col md:flex-row md:items-start justify-between gap-4 relative z-10">
      <div class="flex items-start gap-4">
        <button class="btn btn-ghost btn-sm mt-2 border border-base-200 shadow-sm" @click="goBack">
          &larr; Back
        </button>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
              {{ intakeData?.intake_name || "Loading..." }}
            </h1>
          </div>
          <p class="text-base-content/60 font-medium max-w-xl">
            {{ formatIntake(intakeData?.intake_year || "") }} &bull;
            {{ intakeData?.session_name }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <!-- Regenerate Button -->
        <button
          v-if="intakeData && hasStudentsWithoutPlans && intakeData.status !== 'completed'"
          class="btn btn-primary shadow-lg shadow-primary/20 gap-2 hover:-translate-y-0.5 transition-transform rounded-xl"
          @click="openRegenerateModal"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
          </svg>
          Regenerate Plans
        </button>
        
        <!-- Mark as Completed Button -->
        <button
          v-if="intakeData?.status === 'generated' && canMarkAsCompleted"
          class="btn btn-info shadow-lg shadow-info/20 gap-2 hover:-translate-y-0.5 transition-transform rounded-xl text-white"
          :disabled="markAsCompletedLoading"
          @click="openCompleteModal"
        >
          <span v-if="markAsCompletedLoading" class="loading loading-spinner loading-sm"></span>
          <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Mark as Completed
        </button>
          <span
            v-if="intakeData"
            class="badge badge-lg shadow-sm font-bold capitalize"
            :class="{
              'badge-warning badge-outline border-warning/30 bg-warning/10': intakeData.status === 'draft',
              'badge-success badge-outline border-success/30 bg-success/10': intakeData.status === 'generated',
              'badge-primary badge-outline border-primary/30 bg-primary/10 text-primary': intakeData.status === 'completed',
            }"
          >
            {{ intakeData.status }}
          </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="intakeData">
      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">Total Students</div>
          <div class="stat-value text-2xl">{{ stats.total }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">With Plans</div>
          <div class="stat-value text-2xl text-success">{{ stats.withPlan }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">No Plan</div>
          <div class="stat-value text-2xl" :class="stats.noPlan > 0 ? 'text-error' : 'text-base-content/30'">{{ stats.noPlan }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">Draft</div>
          <div class="stat-value text-2xl text-warning">{{ stats.draftPlanned }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">Approved</div>
          <div class="stat-value text-2xl text-info">{{ stats.approved }}</div>
        </div>
      </div>

      <!-- Alert for students without plans -->
      <div v-if="hasStudentsWithoutPlans" class="alert alert-warning shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <div>
          <h3 class="font-bold">{{ stats.noPlan }} student(s) don't have academic plans</h3>
          <p class="text-sm">You can re-upload the Excel file to generate plans for these students using the <strong>"Regenerate Plans"</strong> button.</p>
        </div>
      </div>

      <!-- Intake Info Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base">Intake Details</h2>
          <div class="grid md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Semester Rules:</span>
              <div class="font-medium">{{ intakeData.intake_type }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Created:</span>
              <div class="font-medium">{{ formatDate(intakeData.created_at) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Last Updated:</span>
              <div class="font-medium">{{ formatDate(intakeData.updated_at) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Generation Stats:</span>
              <div class="font-medium">
                {{ intakeData.successful_plans }} successful,
                {{ intakeData.failed_plans }} failed
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Students Table Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 class="card-title text-base">Students</h2>

            <div class="flex gap-2">
              <!-- Search -->
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search students..."
                class="input input-bordered input-sm w-48"
              />

              <!-- Filter -->
              <select
                v-model="filterStatus"
                class="select select-bordered select-sm"
              >
                <option value="all">All Status</option>
                <option value="no_plan">No Plan</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-if="filteredStudents.length === 0"
            class="text-center py-8 text-base-content/60"
          >
            <p>No students found matching your criteria.</p>
          </div>

          <!-- Students Table -->
          <div v-else class="overflow-x-auto rounded-lg border border-base-200 mt-2">
            <table class="table w-full">
              <thead class="bg-base-200/50 text-base-content/70 uppercase text-xs tracking-wider">
                <tr>
                  <th class="pl-6 rounded-tl-lg text-center">Matric No</th>
                  <th class="text-center">Student Name</th>
                  <th class="text-center">Entry Semester</th>
                  <th class="text-center">Credits Transferred</th>
                  <th class="text-center">Plan Status</th>
                  <th class="pr-6 text-center rounded-tr-lg">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-base-200">
                <tr
                  v-for="student in filteredStudents"
                  :key="student.student_id"
                  class="hover:bg-base-200/30 transition-colors"
                >
                  <td class="font-mono text-sm pl-6 text-base-content/70 text-center">{{ student.matric_no }}</td>
                  <td class="font-medium text-base-content text-center">{{ student.student_name || '—' }}</td>
                  <td class="text-center">
                    <span v-if="student.entry_semester" class="badge badge-sm badge-info badge-outline bg-info/10 shadow-sm border-info/30">
                      Semester {{ student.entry_semester }}
                    </span>
                    <span v-else class="text-base-content/40">-</span>
                  </td>
                  <td class="font-mono text-base-content/80 text-center">{{ student.total_credit_transferred ?? "-" }}</td>
                  <td class="text-center">
                    <span
                      v-if="student.academic_plan_id"
                      class="badge badge-sm shadow-sm capitalize"
                      :class="getStatusBadgeClass(student.plan_status)"
                    >
                      {{ student.plan_status }}
                    </span>
                    <span v-else class="badge badge-sm badge-error badge-outline bg-error/10 border-error/30">No plan</span>
                  </td>
                  <td class="pr-6 text-center">
                    <div v-if="student.academic_plan_id" class="flex justify-center gap-2">
                      <button
                        class="btn btn-xs bg-primary/10 text-primary hover:bg-primary hover:text-white border-0 shadow-sm transition-all rounded-lg"
                        @click="viewStudentPlan(student)"
                      >
                        View Plan
                      </button>
                      <button
                        class="btn btn-xs bg-secondary/10 text-secondary hover:bg-secondary hover:text-white border-0 shadow-sm transition-all rounded-lg"
                        @click="viewStudentSchedule(student)"
                      >
                        View Schedule
                      </button>
                    </div>
                    <span v-else class="text-xs text-base-content/40">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Results count -->
          <div class="text-sm text-base-content/60 mt-4">
            Showing {{ filteredStudents.length }} of {{ intakeData.students.length }} students
          </div>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- Complete Intake Modal -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <dialog :class="{ 'modal modal-open': isCompleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-primary flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Complete Intake?
        </h3>
        <p class="py-4 text-base-content/80">
          Are you sure you want to mark this intake as completed?
          <br><br>
          <strong class="text-error">Warning:</strong> This is a permanent action that will lock the intake and all of its associated academic plans. You will no longer be able to regenerate plans, modify student plan status, or change courses once it is finalized.
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeCompleteModal" :disabled="markAsCompletedLoading">Cancel</button>
          <button class="btn btn-info text-white" @click="confirmMarkAsCompleted" :disabled="markAsCompletedLoading">
            <span v-if="markAsCompletedLoading" class="loading loading-spinner loading-sm"></span>
            Confirm Completion
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeCompleteModal" :disabled="markAsCompletedLoading">close</button>
      </form>
    </dialog>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- Regenerate Plans Modal -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <dialog :class="{ 'modal modal-open': isRegenerateModalOpen }">
      <div class="modal-box max-w-3xl">
        <h3 class="font-bold text-lg mb-1">Regenerate Academic Plans</h3>
        <p class="text-sm text-base-content/60 mb-4">
          Re-upload the Excel file to generate plans for students who don't have one yet.
          Students with existing plans will be automatically skipped.
        </p>

        <!-- Progress Steps -->
        <ul class="steps steps-horizontal w-full mb-6">
          <li class="step" :class="{ 'step-primary': regenStep >= 1 }">
            <span class="text-xs">Upload Excel</span>
          </li>
          <li class="step" :class="{ 'step-primary': regenStep >= 2 }">
            <span class="text-xs">Preview</span>
          </li>
          <li class="step" :class="{ 'step-primary': regenStep >= 3 }">
            <span class="text-xs">Results</span>
          </li>
        </ul>

        <!-- Step 1: File Upload -->
        <div v-if="regenStep === 1" class="space-y-4">
          <!-- Info banner -->
          <div class="alert alert-info text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span><strong>{{ stats.noPlan }}</strong> student(s) currently have no academic plan. Upload the same Excel file used during initial generation.</span>
          </div>

          <!-- File Upload Area -->
          <div
            class="border-3 border-dashed rounded-xl p-6 md:p-8 transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative group"
            :class="{
              'border-primary bg-primary/5 shadow-sm': regenIsDragging,
              'border-base-300 hover:border-primary/50 hover:bg-base-200/30': !regenIsDragging,
            }"
            @drop="regenHandleDrop"
            @dragover="regenHandleDragOver"
            @dragleave="regenHandleDragLeave"
            @click="regenTriggerFileInput"
          >
            <div class="absolute inset-0 bg-gradient-to-r from-transparent via-base-content/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>

            <input
              ref="regenFileInput"
              type="file"
              accept=".xlsx,.xls"
              class="hidden"
              @change="regenHandleFileSelect"
            />

            <div v-if="!regenSelectedFile" class="flex flex-col sm:flex-row items-center gap-6 w-full max-w-2xl mx-auto relative z-10 pointer-events-none">
              <div class="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-base-300 group-hover:border-primary/30 group-hover:text-primary transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-base-content/50 group-hover:text-primary transition-colors">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <div class="text-center sm:text-left flex-1">
                <p class="text-xl font-bold text-base-content">Drag & Drop Excel File</p>
                <p class="text-sm font-medium text-base-content/60 mt-0.5">
                  or click anywhere to browse from your computer
                </p>
                <div class="mt-2 text-[10px] font-bold tracking-wider text-base-content/40 uppercase bg-base-200/50 inline-block px-2 py-0.5 rounded border border-base-200">
                  Supported formats: .xlsx, .xls
                </div>
              </div>
              <div class="shrink-0 mt-4 sm:mt-0 pointer-events-auto">
                <button
                  class="btn btn-outline btn-sm rounded-lg shadow-sm font-bold border-base-300 hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors"
                  @click.stop="regenTriggerFileInput"
                >
                  Choose File
                </button>
              </div>
            </div>

            <div v-else class="flex flex-col sm:flex-row items-center gap-6 w-full max-w-2xl mx-auto relative z-10 pointer-events-none">
              <div class="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center shrink-0 border border-success/20 text-success shadow-sm shadow-success/10">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-8 h-8">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <div class="text-center sm:text-left flex-1 truncate">
                <p class="font-extrabold text-xl text-base-content truncate" :title="regenSelectedFile.name">
                  {{ regenSelectedFile.name }}
                </p>
                <p class="text-sm font-medium text-base-content/60 mt-0.5">
                  {{ (regenSelectedFile.size / 1024).toFixed(2) }} KB
                </p>
              </div>
              <div class="shrink-0 mt-4 sm:mt-0 pointer-events-auto">
                <button
                  class="btn btn-ghost btn-sm text-error font-bold hover:bg-error/10 border border-transparent hover:border-error/20 transition-colors"
                  @click.stop="regenRemoveFile"
                >
                  Remove File
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 ml-1 inline">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2: Preview -->
        <div v-else-if="regenStep === 2 && regenPreviewResult" class="space-y-4">
          <!-- Summary Stats -->
          <div class="stats shadow w-full">
            <div class="stat">
              <div class="stat-title">Total</div>
              <div class="stat-value text-xl">
                {{ regenPreviewResult.summary.total_in_excel }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Ready</div>
              <div class="stat-value text-xl text-success">
                {{ regenPreviewResult.summary.ready_to_generate }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Skipped (Has Plan)</div>
              <div class="stat-value text-xl text-warning">
                {{ regenPreviewResult.summary.will_be_skipped }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Missing Entry</div>
              <div class="stat-value text-xl text-error">
                {{ regenPreviewResult.summary.missing_entry_semester }}
              </div>
            </div>
          </div>

          <!-- Preview note -->
          <div v-if="regenPreviewResult.summary.will_be_skipped > 0" class="alert alert-info text-sm py-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>Students who already have plans will be automatically skipped during generation.</span>
          </div>

          <!-- Preview Table -->
          <div class="overflow-x-auto max-h-64">
            <table class="table table-sm">
              <thead class="sticky top-0 bg-base-100">
                <tr>
                  <th>Matric No</th>
                  <th>Name</th>
                  <th>Entry Semester</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in regenPreviewResult.preview_students"
                  :key="student.matric_no"
                  :class="{
                    'text-success': student.status === 'ready',
                    'text-warning': student.status === 'already_has_plan',
                    'text-error': student.status === 'missing_entry_semester',
                  }"
                >
                  <td class="font-mono">{{ student.matric_no }}</td>
                  <td>{{ student.student_name }}</td>
                  <td>{{ student.entry_semester || "-" }}</td>
                  <td>
                    <span
                      class="badge badge-sm"
                      :class="{
                        'badge-success': student.status === 'ready',
                        'badge-warning': student.status === 'already_has_plan',
                        'badge-error': student.status === 'missing_entry_semester',
                      }"
                    >
                      {{ student.status.replace(/_/g, " ") }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Failed Records -->
          <div
            v-if="regenPreviewResult.failed_records.length > 0"
            class="alert alert-error"
          >
            <div>
              <h4 class="font-medium">
                {{ regenPreviewResult.failed_records.length }} Failed Records
              </h4>
              <ul class="text-sm mt-1">
                <li
                  v-for="rec in regenPreviewResult.failed_records.slice(0, 5)"
                  :key="rec.row"
                >
                  Row {{ rec.row }}: {{ rec.matric_no }} - {{ rec.reason }}
                </li>
                <li v-if="regenPreviewResult.failed_records.length > 5">
                  ... and {{ regenPreviewResult.failed_records.length - 5 }} more
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Step 3: Results -->
        <div v-else-if="regenStep === 3 && regenGenerateResult" class="space-y-4">
          <div class="alert alert-success">
            <span> ✅ Academic plans regenerated successfully! </span>
          </div>

          <div class="stats shadow w-full">
            <div class="stat">
              <div class="stat-title">Total Processed</div>
              <div class="stat-value text-xl">
                {{ regenGenerateResult.summary.total_processed }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Successful</div>
              <div class="stat-value text-xl text-success">
                {{ regenGenerateResult.summary.successful }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Failed</div>
              <div class="stat-value text-xl text-error">
                {{ regenGenerateResult.summary.failed }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Skipped (Had Plan)</div>
              <div class="stat-value text-xl text-base-content/50">
                {{ regenGenerateResult.summary.skipped_existing }}
              </div>
            </div>
          </div>

          <!-- Failed Students -->
          <div
            v-if="regenGenerateResult.failed_students.length > 0"
            class="overflow-x-auto"
          >
            <h4 class="font-medium mb-2">Failed Students</h4>
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Matric No</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in regenGenerateResult.failed_students"
                  :key="student.student_id"
                  class="text-error"
                >
                  <td class="font-mono">{{ student.matric_no }}</td>
                  <td>{{ student.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Modal Actions -->
        <div class="modal-action">
          <button
            v-if="regenStep === 2"
            class="btn btn-ghost"
            :disabled="regenIsGenerating"
            @click="regenStep = 1"
          >
            Back
          </button>
          <button class="btn btn-ghost" @click="closeRegenerateModal">
            {{ regenStep === 3 ? "Close" : "Cancel" }}
          </button>
          <button
            v-if="regenStep === 1"
            class="btn btn-primary"
            :disabled="!regenSelectedFile || regenIsPreviewLoading"
            @click="regenPreview"
          >
            <span
              v-if="regenIsPreviewLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ regenIsPreviewLoading ? "Loading..." : "Preview" }}
          </button>
          <button
            v-else-if="regenStep === 2"
            class="btn btn-primary"
            :disabled="
              regenIsGenerating ||
              (regenPreviewResult?.summary.ready_to_generate || 0) === 0
            "
            @click="regenGenerate"
          >
            <span
              v-if="regenIsGenerating"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ regenIsGenerating ? "Generating..." : "Generate Academic Plans" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeRegenerateModal">close</button>
      </form>
    </dialog>
  </div>
</template>
