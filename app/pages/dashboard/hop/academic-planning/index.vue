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
  }, 3000);
};

// Types
interface IntakeData {
  id: number;
  intake_year: string;
  intake_name: string;
  session_id: number;
  session_name: string;
  intake_type: string;
  status: "draft" | "generated" | "finalized";
  total_students: number;
  successful_plans: number;
  failed_plans: number;
  created_at: string;
  updated_at: string;
}

interface ConfigData {
  sessions: Array<{
    id: number;
    session_name: string;
    intake_year: string;
    is_active: boolean;
  }>;
  intake_types: string[];
  intake_years: Array<{ intake_year: string }>;
  existing_intake_years: string[];
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

// State
const searchQuery = ref("");
const isCreateModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const selectedIntakeToDelete = ref<IntakeData | null>(null);
const currentStep = ref(1);
const totalSteps = 4;

// Create form state
const createForm = ref({
  intake_name: "",
  intake_year: "",
  session_id: null as number | null,
  intake_type: "",
});

// File upload state
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isDragging = ref(false);

// New intake ID after creation
const newIntakeId = ref<number | null>(null);

// Preview state
const isPreviewLoading = ref(false);
const previewResult = ref<{
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

// Generate state
const isGenerating = ref(false);
const generateResult = ref<{
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

// Loading states
const createLoading = ref(false);
const deleteLoading = ref(false);

// Fetch intakes
const {
  data: intakes,
  pending: intakesPending,
  refresh: refreshIntakes,
} = await useFetch<IntakeData[]>("/api/hop/academic-planning");

// Fetch config for create form
const { data: configData } = await useFetch<ConfigData>(
  "/api/hop/academic-planning/config",
);

// Filtered intakes based on search
const filteredIntakes = computed(() => {
  if (!intakes.value) return [];
  if (!searchQuery.value) return intakes.value;

  const query = searchQuery.value.toLowerCase();
  return intakes.value.filter(
    (intake) =>
      intake.intake_name.toLowerCase().includes(query) ||
      intake.intake_year.includes(query) ||
      intake.session_name.toLowerCase().includes(query),
  );
});

// Computed
const canProceedToStep2 = computed(
  () =>
    createForm.value.intake_name &&
    createForm.value.intake_year &&
    createForm.value.session_id &&
    createForm.value.intake_type,
);

const canProceedToStep3 = computed(() => selectedFile.value !== null);

// Format intake year (MMYY -> Month Year)
const formatIntake = (intake: string) => {
  if (!intake || intake.length !== 4) return intake;
  const month = parseInt(intake.substring(0, 2));
  const year = parseInt(intake.substring(2, 4));
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

// Format date
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Get status badge class
const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "draft":
      return "badge-warning";
    case "generated":
      return "badge-success";
    case "finalized":
      return "badge-info";
    default:
      return "badge-ghost";
  }
};

// Open create modal
const openCreateModal = () => {
  resetCreateForm();
  isCreateModalOpen.value = true;
};

// Close create modal
const closeCreateModal = () => {
  isCreateModalOpen.value = false;
  resetCreateForm();
};

// Reset create form
const resetCreateForm = () => {
  currentStep.value = 1;
  createForm.value = {
    intake_name: "",
    intake_year: "",
    session_id: null,
    intake_type: "",
  };
  selectedFile.value = null;
  previewResult.value = null;
  generateResult.value = null;
  newIntakeId.value = null;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
};

// File handling
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    validateAndSetFile(target.files[0]);
  }
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  isDragging.value = false;
  if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
    validateAndSetFile(event.dataTransfer.files[0]);
  }
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  isDragging.value = true;
};

const handleDragLeave = () => {
  isDragging.value = false;
};

const validateAndSetFile = (file: File) => {
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
    showToast("Please select a valid Excel file (.xlsx or .xls)");
    return;
  }

  selectedFile.value = file;
};

const removeFile = () => {
  selectedFile.value = null;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
};

const triggerFileInput = () => {
  fileInput.value?.click();
};

// Navigation
const nextStep = async () => {
  if (currentStep.value === 1) {
    // Create the intake first
    await createIntake();
  } else if (currentStep.value === 2) {
    // Preview the file
    await previewFile();
  } else if (currentStep.value < totalSteps) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

// Create intake
const createIntake = async () => {
  if (!canProceedToStep2.value) return;

  createLoading.value = true;
  try {
    const response = await $fetch<{ id: number; message: string }>(
      "/api/hop/academic-planning",
      {
        method: "POST",
        body: createForm.value,
      },
    );

    newIntakeId.value = response.id;
    currentStep.value = 2;
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to create intake",
      "error",
    );
  } finally {
    createLoading.value = false;
  }
};

// Preview file
const previewFile = async () => {
  if (!selectedFile.value || !newIntakeId.value) return;

  isPreviewLoading.value = true;
  previewResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", selectedFile.value);
    formData.append("intake_id", newIntakeId.value.toString());

    const response = await $fetch("/api/hop/academic-planning/preview", {
      method: "POST",
      body: formData,
    });

    previewResult.value = response as typeof previewResult.value;
    currentStep.value = 3;
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Preview failed",
      "error",
    );
  } finally {
    isPreviewLoading.value = false;
  }
};

// Generate plans
const generatePlans = async () => {
  if (!selectedFile.value || !newIntakeId.value) return;

  isGenerating.value = true;
  generateResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", selectedFile.value);
    formData.append("intake_id", newIntakeId.value.toString());

    const response = await $fetch("/api/hop/academic-planning/generate", {
      method: "POST",
      body: formData,
    });

    generateResult.value = response as typeof generateResult.value;
    currentStep.value = 4;
    await refreshIntakes();
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Generation failed",
      "error",
    );
  } finally {
    isGenerating.value = false;
  }
};

// Delete intake
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
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to delete intake",
      "error",
    );
  } finally {
    deleteLoading.value = false;
  }
};

// View intake details
const viewIntake = (intake: IntakeData) => {
  navigateTo(`/dashboard/hop/academic-planning/${intake.id}`);
};
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto w-full space-y-6">
    <!-- Toast Notification -->
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
    <!-- Page Header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Academic Planning</h1>
        <p class="text-sm text-base-content/60">
          Create and manage academic plans for student intakes.
        </p>
      </div>
      <button class="btn btn-primary gap-2" @click="openCreateModal">
        <span>➕</span>
        Create Academic Planning
      </button>
    </div>

    <!-- Search Bar -->
    <div class="form-control w-full max-w-md">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search intakes..."
        class="input input-bordered w-full"
      />
    </div>

    <!-- Loading State -->
    <div v-if="intakesPending" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-md"></span>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!intakes || intakes.length === 0"
      class="flex flex-col items-center justify-center border border-dashed border-base-300 rounded-lg p-10 text-center"
    >
      <div class="text-6xl mb-4">📋</div>
      <h3 class="font-medium mb-1">No academic planning intakes yet</h3>
      <p class="text-sm text-base-content/60 max-w-md mb-4">
        Create your first academic planning intake to start generating academic
        plans for students.
      </p>
      <button class="btn btn-primary btn-sm" @click="openCreateModal">
        Create Academic Planning
      </button>
    </div>

    <!-- Intakes Table -->
    <div
      v-else
      class="card bg-base-100 border border-base-300 shadow-sm overflow-hidden"
    >
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th>Intake</th>
              <th>Session</th>
              <th>Rule Set</th>
              <th>Status</th>
              <th>Students</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="intake in filteredIntakes"
              :key="intake.id"
              class="hover"
            >
              <td>
                <div>
                  <div class="font-medium">{{ intake.intake_name }}</div>
                  <div class="text-sm text-base-content/60">
                    {{ formatIntake(intake.intake_year) }}
                  </div>
                </div>
              </td>
              <td>{{ intake.session_name }}</td>
              <td>{{ intake.intake_type }}</td>
              <td>
                <span
                  class="badge badge-sm"
                  :class="getStatusBadgeClass(intake.status)"
                >
                  {{ intake.status }}
                </span>
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <span class="text-success">{{
                    intake.successful_plans
                  }}</span>
                  <span class="text-base-content/30">/</span>
                  <span class="text-base-content/60">{{
                    intake.total_students
                  }}</span>
                  <span
                    v-if="intake.failed_plans > 0"
                    class="text-error text-xs"
                  >
                    ({{ intake.failed_plans }} failed)
                  </span>
                </div>
              </td>
              <td class="text-sm text-base-content/60">
                {{ formatDate(intake.created_at) }}
              </td>
              <td>
                <div class="flex gap-2">
                  <button
                    class="btn btn-ghost btn-xs"
                    @click="viewIntake(intake)"
                  >
                    View
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
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
    </div>

    <!-- Create Modal -->
    <dialog :class="{ 'modal modal-open': isCreateModalOpen }">
      <div class="modal-box max-w-3xl">
        <h3 class="font-bold text-lg mb-4">Create Academic Planning</h3>

        <!-- Progress Steps -->
        <ul class="steps steps-horizontal w-full mb-6">
          <li class="step" :class="{ 'step-primary': currentStep >= 1 }">
            <span class="text-xs">Configuration</span>
          </li>
          <li class="step" :class="{ 'step-primary': currentStep >= 2 }">
            <span class="text-xs">Upload Excel</span>
          </li>
          <li class="step" :class="{ 'step-primary': currentStep >= 3 }">
            <span class="text-xs">Preview</span>
          </li>
          <li class="step" :class="{ 'step-primary': currentStep >= 4 }">
            <span class="text-xs">Results</span>
          </li>
        </ul>

        <!-- Step 1: Configuration -->
        <div v-if="currentStep === 1" class="space-y-4">
          <div class="form-control w-full">
            <label class="label">
              <span class="label-text font-medium">Intake Name</span>
            </label>
            <input
              v-model="createForm.intake_name"
              type="text"
              placeholder="e.g., August 2024 Intake"
              class="input input-bordered w-full"
            />
          </div>

          <div class="grid md:grid-cols-2 gap-4">
            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-medium">Intake Year</span>
              </label>
              <select
                v-model="createForm.intake_year"
                class="select select-bordered w-full"
              >
                <option value="">Select intake year...</option>
                <option
                  v-for="year in configData?.intake_years"
                  :key="year.intake_year"
                  :value="year.intake_year"
                >
                  {{ formatIntake(year.intake_year) }} ({{ year.intake_year }})
                </option>
              </select>
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  Only intakes without existing plans are shown
                </span>
              </label>
            </div>

            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-medium">Program Session</span>
              </label>
              <select
                v-model="createForm.session_id"
                class="select select-bordered w-full"
              >
                <option :value="null">Select session...</option>
                <option
                  v-for="sess in configData?.sessions"
                  :key="sess.id"
                  :value="sess.id"
                >
                  {{ sess.session_name }}
                </option>
              </select>
            </div>
          </div>

          <div class="form-control w-full">
            <label class="label">
              <span class="label-text font-medium"
                >Semester Rules (Intake Type)</span
              >
            </label>
            <select
              v-model="createForm.intake_type"
              class="select select-bordered w-full"
            >
              <option value="">Select intake type...</option>
              <option
                v-for="type in configData?.intake_types"
                :key="type"
                :value="type"
              >
                {{ type }}
              </option>
            </select>
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Credit plan rules to determine courses per semester
              </span>
            </label>
          </div>

          <!-- Warnings -->
          <div
            v-if="configData?.intake_years?.length === 0"
            class="alert alert-warning"
          >
            <span>
              No available intake years. All intakes already have academic plans
              or no students are registered.
            </span>
          </div>
        </div>

        <!-- Step 2: File Upload -->
        <div v-else-if="currentStep === 2" class="space-y-4">
          <div class="bg-base-200 rounded-lg p-4 mb-4">
            <h4 class="font-medium mb-2">Configuration Summary</h4>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span class="text-base-content/60">Intake:</span>
                <span class="ml-2">{{ createForm.intake_name }}</span>
              </div>
              <div>
                <span class="text-base-content/60">Session:</span>
                <span class="ml-2">
                  {{
                    configData?.sessions.find(
                      (s) => s.id === createForm.session_id,
                    )?.session_name
                  }}
                </span>
              </div>
            </div>
          </div>

          <!-- File Upload Area -->
          <div
            class="border-3 border-dashed rounded-xl p-6 md:p-8 transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative group"
            :class="{
              'border-primary bg-primary/5 shadow-sm': isDragging,
              'border-base-300 hover:border-primary/50 hover:bg-base-200/30': !isDragging,
            }"
            @drop="handleDrop"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @click="triggerFileInput"
          >
            <!-- Ambient upload glow on hover -->
            <div class="absolute inset-0 bg-gradient-to-r from-transparent via-base-content/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>

            <input
              ref="fileInput"
              type="file"
              accept=".xlsx,.xls"
              class="hidden"
              @change="handleFileSelect"
            />

            <div v-if="!selectedFile" class="flex flex-col sm:flex-row items-center gap-6 w-full max-w-2xl mx-auto relative z-10 pointer-events-none">
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
                  @click.stop="triggerFileInput"
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
                <p class="font-extrabold text-xl text-base-content truncate" :title="selectedFile.name">
                  {{ selectedFile.name }}
                </p>
                <p class="text-sm font-medium text-base-content/60 mt-0.5">
                  {{ (selectedFile.size / 1024).toFixed(2) }} KB
                </p>
              </div>
              <div class="shrink-0 mt-4 sm:mt-0 pointer-events-auto">
                <button
                  class="btn btn-ghost btn-sm text-error font-bold hover:bg-error/10 border border-transparent hover:border-error/20 transition-colors"
                  @click.stop="removeFile"
                >
                  Remove File
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 ml-1 inline">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Expected Format -->
          <div class="bg-info/10 rounded-lg p-4">
            <h4 class="font-medium mb-2">ℹ️ Expected Excel Format</h4>
            <p class="text-sm text-base-content/70 mb-2">
              The Excel file must contain a column:
            </p>
            <ul class="text-sm text-base-content/70 list-disc list-inside">
              <li>
                <code class="bg-base-300 px-1 rounded">matric_no</code> -
                Student matric number
              </li>
            </ul>
            <p class="text-xs text-base-content/50 mt-2">
              Note: Students must have completed Intake Assessment first to have
              their entry semester set.
            </p>
          </div>
        </div>

        <!-- Step 3: Preview -->
        <div v-else-if="currentStep === 3 && previewResult" class="space-y-4">
          <!-- Summary Stats -->
          <div class="stats shadow w-full">
            <div class="stat">
              <div class="stat-title">Total</div>
              <div class="stat-value text-xl">
                {{ previewResult.summary.total_in_excel }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Ready</div>
              <div class="stat-value text-xl text-success">
                {{ previewResult.summary.ready_to_generate }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Skipped</div>
              <div class="stat-value text-xl text-warning">
                {{ previewResult.summary.will_be_skipped }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Missing Entry</div>
              <div class="stat-value text-xl text-error">
                {{ previewResult.summary.missing_entry_semester }}
              </div>
            </div>
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
                  v-for="student in previewResult.preview_students"
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
                        'badge-error':
                          student.status === 'missing_entry_semester',
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
            v-if="previewResult.failed_records.length > 0"
            class="alert alert-error"
          >
            <div>
              <h4 class="font-medium">
                {{ previewResult.failed_records.length }} Failed Records
              </h4>
              <ul class="text-sm mt-1">
                <li
                  v-for="rec in previewResult.failed_records.slice(0, 5)"
                  :key="rec.row"
                >
                  Row {{ rec.row }}: {{ rec.matric_no }} - {{ rec.reason }}
                </li>
                <li v-if="previewResult.failed_records.length > 5">
                  ... and {{ previewResult.failed_records.length - 5 }} more
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Step 4: Results -->
        <div v-else-if="currentStep === 4 && generateResult" class="space-y-4">
          <div class="alert alert-success">
            <span> ✅ Academic plans generated successfully! </span>
          </div>

          <div class="stats shadow w-full">
            <div class="stat">
              <div class="stat-title">Total Processed</div>
              <div class="stat-value text-xl">
                {{ generateResult.summary.total_processed }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Successful</div>
              <div class="stat-value text-xl text-success">
                {{ generateResult.summary.successful }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Failed</div>
              <div class="stat-value text-xl text-error">
                {{ generateResult.summary.failed }}
              </div>
            </div>
          </div>

          <!-- Failed Students -->
          <div
            v-if="generateResult.failed_students.length > 0"
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
                  v-for="student in generateResult.failed_students"
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
            v-if="currentStep > 1 && currentStep < 4"
            class="btn btn-ghost"
            :disabled="createLoading || isPreviewLoading || isGenerating"
            @click="prevStep"
          >
            Back
          </button>
          <button class="btn btn-ghost" @click="closeCreateModal">
            {{ currentStep === 4 ? "Close" : "Cancel" }}
          </button>
          <button
            v-if="currentStep === 1"
            class="btn btn-primary"
            :disabled="!canProceedToStep2 || createLoading"
            @click="nextStep"
          >
            <span
              v-if="createLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ createLoading ? "Creating..." : "Continue" }}
          </button>
          <button
            v-else-if="currentStep === 2"
            class="btn btn-primary"
            :disabled="!canProceedToStep3 || isPreviewLoading"
            @click="nextStep"
          >
            <span
              v-if="isPreviewLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ isPreviewLoading ? "Loading..." : "Preview" }}
          </button>
          <button
            v-else-if="currentStep === 3"
            class="btn btn-primary"
            :disabled="
              isGenerating ||
              (previewResult?.summary.ready_to_generate || 0) === 0
            "
            @click="generatePlans"
          >
            <span
              v-if="isGenerating"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ isGenerating ? "Generating..." : "Generate Academic Plans" }}
          </button>
          <button
            v-else-if="currentStep === 4 && newIntakeId"
            class="btn btn-primary"
            @click="viewIntake({ id: newIntakeId } as IntakeData)"
          >
            View Intake Details
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeCreateModal">close</button>
      </form>
    </dialog>

    <!-- Delete Confirmation Modal -->
    <dialog :class="{ 'modal modal-open': isDeleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Delete Academic Planning</h3>
        <p class="py-4">
          Are you sure you want to delete
          <strong>{{ selectedIntakeToDelete?.intake_name }}</strong
          >? This will also delete all generated academic plans for this intake.
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeDeleteModal">
            Cancel
          </button>
          <button
            class="btn btn-error"
            :disabled="deleteLoading"
            @click="deleteIntake"
          >
            <span
              v-if="deleteLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ deleteLoading ? "Deleting..." : "Delete" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeDeleteModal">close</button>
      </form>
    </dialog>

    <!-- Next Step Prompt -->
    <div class="mt-8 card bg-base-200 shadow-sm">
      <div class="card-body flex-row items-center justify-between py-4">
        <div>
          <p class="text-sm text-base-content/60">Next Step</p>
          <p class="font-semibold">Review Your Students</p>
          <p class="text-sm text-base-content/70">
            View student profiles and monitor their academic progress
          </p>
        </div>
        <NuxtLink to="/dashboard/hop/students" class="btn btn-primary btn-sm">
          Students &rarr;
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
