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
      intake.session_name.toLowerCase().includes(query)
  );
});

// Computed
const canProceedToStep2 = computed(
  () =>
    createForm.value.intake_name &&
    createForm.value.intake_year &&
    createForm.value.session_id &&
    createForm.value.intake_type
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
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidType && !hasValidExtension) {
    alert("Please select a valid Excel file (.xlsx or .xls)");
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
      }
    );

    newIntakeId.value = response.id;
    currentStep.value = 2;
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to create intake");
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

    previewResult.value = response as NonNullable<typeof previewResult.value>;
    currentStep.value = 3;
  } catch (error: any) {
    alert(error.data?.message || error.message || "Preview failed");
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

    generateResult.value = response as NonNullable<typeof generateResult.value>;
    currentStep.value = 4;
    await refreshIntakes();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Generation failed");
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
    await $fetch(`/api/hop/academic-planning/${selectedIntakeToDelete.value.id}`, {
      method: "DELETE",
    });

    await refreshIntakes();
    closeDeleteModal();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to delete intake");
  } finally {
    deleteLoading.value = false;
  }
};

// View intake details
const viewIntake = (intake: IntakeData) => {
  navigateTo(`/dashboard/hop/academic-planning/${intake.id}`);
};

// Computed Stats
const stats = computed(() => {
  if (!intakes.value) return { total: 0, draft: 0, finalized: 0, students: 0 };
  
  return {
    total: intakes.value.length,
    draft: intakes.value.filter(i => i.status === 'draft').length,
    finalized: intakes.value.filter(i => i.status === 'finalized').length,
    students: intakes.value.reduce((acc, curr) => acc + curr.total_students, 0)
  };
});
</script>

<template>
  <div class="p-6 w-full space-y-8">
    <!-- Page Header & Stats -->
    <div class="space-y-6">
       <!-- Header -->
       <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-3xl font-bold">Academic Planning</h1>
            <p class="text-base text-base-content/70">
              Manage student intakes and generate academic plans.
            </p>
          </div>
          <button class="btn btn-primary shadow-lg shadow-primary/20 gap-2" @click="openCreateModal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Create New Plan
          </button>
       </div>

       <!-- Stats Grid -->
       <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Total Intakes -->
          <div class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20">
             <div class="card-body p-6 flex flex-row items-center justify-between">
                <div>
                   <div class="text-sm font-medium text-base-content/60 mb-1">Total Intakes</div>
                   <div class="text-3xl font-bold font-mono">{{ stats.total }}</div>
                </div>
                <div class="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                </div>
             </div>
          </div>

           <!-- Draft Plans -->
          <div class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20">
             <div class="card-body p-6 flex flex-row items-center justify-between">
                <div>
                   <div class="text-sm font-medium text-base-content/60 mb-1">Draft Plans</div>
                   <div class="text-3xl font-bold font-mono">{{ stats.draft }}</div>
                </div>
                <div class="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center text-warning">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                </div>
             </div>
          </div>

           <!-- Finalized -->
          <div class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20">
             <div class="card-body p-6 flex flex-row items-center justify-between">
                <div>
                   <div class="text-sm font-medium text-base-content/60 mb-1">Finalized</div>
                   <div class="text-3xl font-bold font-mono">{{ stats.finalized }}</div>
                </div>
                <div class="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center text-success">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
             </div>
          </div>

           <!-- Students -->
          <div class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20">
             <div class="card-body p-6 flex flex-row items-center justify-between">
                <div>
                   <div class="text-sm font-medium text-base-content/60 mb-1">Total Students</div>
                   <div class="text-3xl font-bold font-mono">{{ stats.students }}</div>
                </div>
                <div class="w-12 h-12 rounded-2xl bg-info/10 flex items-center justify-center text-info">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
                </div>
             </div>
          </div>
       </div>
    </div>

    <!-- Filters & Content -->
    <div class="space-y-4">
       <div class="flex flex-col md:flex-row justify-between gap-4">
          <div class="form-control w-full max-w-sm">
             <div class="relative">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search intakes..."
                  class="input input-bordered w-full pl-10 bg-base-100/50 backdrop-blur"
                />
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-base-content/40">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clip-rule="evenodd" /></svg>
                </div>
             </div>
          </div>
       </div>

        <!-- Loading State -->
        <div v-if="intakesPending" class="flex justify-center py-20">
          <span class="loading loading-spinner loading-lg"></span>
        </div>

        <!-- Empty State -->
        <div v-else-if="!intakes || intakes.length === 0" class="card bg-base-100/60 backdrop-blur border-dashed border-2 border-base-300 p-12 text-center">
            <div class="max-w-md mx-auto space-y-4">
               <div class="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
               </div>
               <h3 class="font-bold text-lg">No academic planning intakes yet</h3>
               <p class="text-base-content/60">Create your first intake to start generating student academic plans.</p>
               <button class="btn btn-primary btn-sm" @click="openCreateModal">
                  Create Academic Planning
               </button>
            </div>
        </div>

        <!-- Intakes Table -->
        <div v-else class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20 overflow-hidden">
           <div class="overflow-x-auto">
             <table class="table table-lg w-full">
               <thead>
                 <tr class="bg-base-200/50">
                   <th class="font-bold uppercase text-xs text-base-content/50">Intake</th>
                   <th class="font-bold uppercase text-xs text-base-content/50">Session</th>
                   <th class="font-bold uppercase text-xs text-base-content/50">Rule Set</th>
                   <th class="font-bold uppercase text-xs text-base-content/50">Status</th>
                   <th class="font-bold uppercase text-xs text-base-content/50">Students</th>
                   <th class="font-bold uppercase text-xs text-base-content/50">Created</th>
                   <th class="font-bold uppercase text-xs text-base-content/50 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody>
                  <tr v-for="intake in filteredIntakes" :key="intake.id" class="hover:bg-base-200/50 transition-colors">
                     <td>
                       <div class="flex flex-col">
                          <span class="font-bold">{{ intake.intake_name }}</span>
                          <span class="text-xs text-base-content/60 font-mono">{{ formatIntake(intake.intake_year) }}</span>
                       </div>
                     </td>
                     <td>{{ intake.session_name }}</td>
                     <td>
                        <div class="badge badge-ghost badge-sm">{{ intake.intake_type }}</div>
                     </td>
                     <td>
                        <div class="badge badge-sm" :class="getStatusBadgeClass(intake.status)">{{ intake.status }}</div>
                     </td>
                     <td>
                        <div class="flex items-center gap-2 text-sm">
                           <span class="font-bold text-success">{{ intake.successful_plans }}</span>
                           <span class="text-base-content/30">/</span>
                           <span>{{ intake.total_students }}</span>
                           <div v-if="intake.failed_plans > 0" class="tooltip tooltip-right text-error" :data-tip="intake.failed_plans + ' failed'">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" /></svg>
                           </div>
                        </div>
                         <!-- Progress bar if needed -->
                         <progress class="progress progress-success w-20 h-1.5 mt-1" :value="intake.successful_plans" :max="intake.total_students"></progress>
                     </td>
                     <td class="text-sm text-base-content/60">{{ formatDate(intake.created_at) }}</td>
                     <td class="text-right">
                        <div class="flex justify-end gap-1">
                           <button class="btn btn-ghost btn-sm" @click="viewIntake(intake)">View</button>
                           <button class="btn btn-ghost btn-sm btn-square text-error" @click="openDeleteModal(intake)">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                           </button>
                        </div>
                     </td>
                  </tr>
               </tbody>
             </table>
           </div>
        </div>
    </div>

    <!-- Create Modal -->
    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isCreateModalOpen }">
       <div class="modal-box w-11/12 max-w-4xl p-0 overflow-hidden text-base-content text-left">
          <!-- Step Header -->
          <div class="p-6 bg-base-200/50 border-b border-base-200">
             <div class="flex items-center justify-between mb-6">
                <div>
                   <h3 class="font-bold text-xl">Create Academic Planning</h3>
                   <p class="text-sm text-base-content/60">Generate academic plans for a new intake.</p>
                </div>
                <!-- Step Indicator -->
                <div class="flex items-center gap-2 text-sm font-medium">
                   <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors" :class="currentStep >= 1 ? 'bg-primary text-primary-content' : 'bg-base-300'">1</div>
                   <div class="w-8 h-1 bg-base-300 rounded-full overflow-hidden">
                      <div class="h-full bg-primary transition-all duration-300" :style="{ width: currentStep > 1 ? '100%' : '0%' }"></div>
                   </div>
                   <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors" :class="currentStep >= 2 ? 'bg-primary text-primary-content' : 'bg-base-300'">2</div>
                   <div class="w-8 h-1 bg-base-300 rounded-full overflow-hidden">
                      <div class="h-full bg-primary transition-all duration-300" :style="{ width: currentStep > 2 ? '100%' : '0%' }"></div>
                   </div>
                   <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors" :class="currentStep >= 3 ? 'bg-primary text-primary-content' : 'bg-base-300'">3</div>
                   <div class="w-8 h-1 bg-base-300 rounded-full overflow-hidden">
                      <div class="h-full bg-primary transition-all duration-300" :style="{ width: currentStep > 3 ? '100%' : '0%' }"></div>
                   </div>
                   <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors" :class="currentStep >= 4 ? 'bg-primary text-primary-content' : 'bg-base-300'">4</div>
                </div>
             </div>
          </div>
          
          <div class="p-8 h-[60vh] overflow-y-auto">
             <!-- Step 1: Configuration -->
            <div v-if="currentStep === 1" class="space-y-6 max-w-2xl mx-auto">
               <div class="form-control w-full">
                  <label class="label">
                    <span class="label-text font-bold uppercase text-xs text-base-content/50">Intake Name</span>
                  </label>
                  <input
                    v-model="createForm.intake_name"
                    type="text"
                    placeholder="e.g., August 2024 Intake"
                    class="input input-bordered w-full input-lg"
                  />
               </div>

                <div class="grid md:grid-cols-2 gap-6">
                   <div class="form-control w-full">
                      <label class="label"><span class="label-text font-bold uppercase text-xs text-base-content/50">Intake Year</span></label>
                      <select v-model="createForm.intake_year" class="select select-bordered w-full">
                        <option value="">Select intake year...</option>
                        <option v-for="year in configData?.intake_years" :key="year.intake_year" :value="year.intake_year">
                          {{ formatIntake(year.intake_year) }} ({{ year.intake_year }})
                        </option>
                      </select>
                      <label class="label"><span class="label-text-alt text-base-content/50">Only available intakes show.</span></label>
                   </div>
                   
                   <div class="form-control w-full">
                      <label class="label"><span class="label-text font-bold uppercase text-xs text-base-content/50">Program Session</span></label>
                      <select v-model="createForm.session_id" class="select select-bordered w-full">
                        <option :value="null">Select session...</option>
                        <option v-for="sess in configData?.sessions" :key="sess.id" :value="sess.id">
                          {{ sess.session_name }}
                        </option>
                      </select>
                   </div>
                </div>
                
                <div class="form-control w-full">
                   <label class="label"><span class="label-text font-bold uppercase text-xs text-base-content/50">Semester Rules</span></label>
                   <select v-model="createForm.intake_type" class="select select-bordered w-full">
                     <option value="">Select intake type...</option>
                     <option v-for="type in configData?.intake_types" :key="type" :value="type">{{ type }}</option>
                   </select>
                   <label class="label"><span class="label-text-alt text-base-content/50">Determines credit plan rules.</span></label>
                </div>
            </div>

            <!-- Step 2: File Upload -->
            <div v-else-if="currentStep === 2" class="space-y-6 max-w-2xl mx-auto">
              <div class="bg-base-200/50 rounded-xl p-4 flex gap-4 items-center">
                 <div class="badge badge-lg badge-primary">{{ createForm.intake_year }}</div>
                 <div class="flex-1">
                    <div class="font-bold">{{ createForm.intake_name }}</div>
                    <div class="text-xs opacity-70">
                       Using session <span class="font-semibold">{{ configData?.sessions.find(s => s.id === createForm.session_id)?.session_name }}</span>
                    </div>
                 </div>
              </div>

               <div
                class="border-4 border-dashed rounded-2xl p-10 text-center transition-all duration-300"
                :class="isDragging ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-base-300 hover:border-primary/50 hover:bg-base-200/50'"
                @drop="handleDrop"
                @dragover="handleDragOver"
                @dragleave="handleDragLeave"
               >
                 <input ref="fileInput" type="file" accept=".xlsx,.xls" class="hidden" @change="handleFileSelect" />
                 
                 <div v-if="!selectedFile" class="space-y-4 py-8">
                   <div class="w-20 h-20 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10 text-base-content/40"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                   </div>
                   <div>
                     <p class="text-xl font-bold">Upload Student List</p>
                     <p class="text-base-content/60">Drag and drop or click to browse</p>
                   </div>
                   <button class="btn btn-primary btn-sm" @click="triggerFileInput">Select File</button>
                    <p class="text-xs text-base-content/40 mt-4">Required column: 'matric_no'</p>
                 </div>
                 
                 <div v-else class="space-y-4 py-8">
                   <div class="w-20 h-20 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                   </div>
                   <div>
                      <p class="text-lg font-bold">{{ selectedFile.name }}</p>
                      <p class="text-sm opacity-60">{{ (selectedFile.size / 1024).toFixed(2) }} KB</p>
                   </div>
                   <button class="btn btn-ghost text-error btn-sm" @click="removeFile">Remove</button>
                 </div>
               </div>
            </div>

            <!-- Step 3: Preview -->
            <div v-else-if="currentStep === 3 && previewResult" class="space-y-6">
               <div class="grid grid-cols-4 gap-4">
                  <div class="stat bg-base-200/50 rounded-xl p-4">
                     <div class="stat-title text-xs uppercase font-bold text-base-content/50">Total</div>
                     <div class="stat-value text-2xl">{{ previewResult.summary.total_in_excel }}</div>
                  </div>
                  <div class="stat bg-success/10 text-success rounded-xl p-4">
                     <div class="stat-title text-xs uppercase font-bold opacity-70 text-current">Ready</div>
                     <div class="stat-value text-2xl">{{ previewResult.summary.ready_to_generate }}</div>
                  </div>
                   <div class="stat bg-warning/10 text-warning rounded-xl p-4">
                     <div class="stat-title text-xs uppercase font-bold opacity-70 text-current">Skipped</div>
                     <div class="stat-value text-2xl">{{ previewResult.summary.will_be_skipped }}</div>
                  </div>
                   <div class="stat bg-error/10 text-error rounded-xl p-4">
                     <div class="stat-title text-xs uppercase font-bold opacity-70 text-current">Missing Entry</div>
                     <div class="stat-value text-2xl">{{ previewResult.summary.missing_entry_semester }}</div>
                  </div>
               </div>
               
               <div class="card border border-base-200 h-96 overflow-hidden flex flex-col">
                  <div class="overflow-x-auto flex-1">
                     <table class="table table-pin-rows">
                        <thead>
                           <tr>
                              <th>Matric No</th>
                              <th>Name</th>
                              <th>Entry Semester</th>
                              <th>Status</th>
                           </tr>
                        </thead>
                        <tbody>
                           <tr v-for="student in previewResult.preview_students" :key="student.matric_no" class="hover">
                              <td class="font-mono">{{ student.matric_no }}</td>
                              <td>{{ student.student_name }}</td>
                              <td>Sem {{ student.entry_semester || '-' }}</td>
                              <td>
                                 <span class="badge badge-sm" :class="{
                                    'badge-success': student.status === 'ready',
                                    'badge-warning': student.status === 'already_has_plan',
                                    'badge-error': student.status === 'missing_entry_semester'
                                 }">{{ student.status.replace(/_/g, ' ') }}</span>
                              </td>
                           </tr>
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
            
            <!-- Step 4: Results -->
            <div v-else-if="currentStep === 4 && generateResult" class="max-w-xl mx-auto text-center space-y-6 py-10">
               <div class="w-24 h-24 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto animate-bounce">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
               </div>
               <div>
                  <h3 class="text-2xl font-bold">Academic Plans Generated!</h3>
                  <p class="text-base-content/60 mt-2">The academic plans have been successfully created.</p>
               </div>
               
               <div class="bg-base-200 rounded-xl p-6">
                  <div class="grid grid-cols-2 gap-4 text-left">
                     <div>
                        <div class="text-xs uppercase font-bold text-base-content/50">Processed</div>
                        <div class="text-2xl font-bold">{{ generateResult.summary.total_processed }}</div>
                     </div>
                     <div>
                        <div class="text-xs uppercase font-bold text-base-content/50">Successful</div>
                        <div class="text-2xl font-bold text-success">{{ generateResult.summary.successful }}</div>
                     </div>
                      <div>
                        <div class="text-xs uppercase font-bold text-base-content/50">Skipped</div>
                        <div class="text-lg font-bold">{{ generateResult.summary.skipped_existing }}</div>
                     </div>
                      <div>
                        <div class="text-xs uppercase font-bold text-base-content/50">Failed</div>
                        <div class="text-lg font-bold text-error">{{ generateResult.summary.failed }}</div>
                     </div>
                  </div>
               </div>
            </div>

          </div>
          
          <!-- Footer -->
          <div class="p-6 bg-base-100 border-t border-base-200 flex justify-end gap-3 z-20">
             <button v-if="currentStep > 1 && currentStep < 4" class="btn btn-ghost" @click="prevStep">Back</button>
             
             <button v-if="currentStep === 1" class="btn btn-primary px-8" @click="nextStep" :disabled="!canProceedToStep2 || createLoading">
                <span v-if="createLoading" class="loading loading-spinner loading-sm"></span>
                Next: Upload File
             </button>
             
             <button v-if="currentStep === 2" class="btn btn-primary px-8" @click="nextStep" :disabled="!canProceedToStep3 || isPreviewLoading">
                <span v-if="isPreviewLoading" class="loading loading-spinner loading-sm"></span>
                Next: Preview
             </button>
             
             <button v-if="currentStep === 3" class="btn btn-primary px-8" @click="generatePlans" :disabled="isGenerating">
                <span v-if="isGenerating" class="loading loading-spinner loading-sm"></span>
                Generate Plans
             </button>
             
             <button v-if="currentStep === 4" class="btn btn-primary px-8" @click="closeCreateModal">
                Done
             </button>
             
             <button v-if="currentStep < 4" class="btn btn-ghost" @click="closeCreateModal">Cancel</button>
          </div>
       </div>
       <form method="dialog" class="modal-backdrop">
          <button @click="closeCreateModal">close</button>
       </form>
    </dialog>

    <!-- Delete Modal -->
     <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isDeleteModalOpen }">
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-error/10 text-error-content border-b border-error/10">
           <h3 class="font-bold text-lg text-error">Delete Academic Planning?</h3>
           <p class="text-sm opacity-70">This action cannot be undone.</p>
        </div>
        
        <div class="p-6">
            <p>Are you sure you want to delete <span class="font-bold">{{ selectedIntakeToDelete?.intake_name }}</span>?</p>
            <p class="text-sm text-base-content/60 mt-2">This will remove all generated academic plans associated with this intake.</p>
            
            <div class="modal-action mt-6">
               <button class="btn btn-ghost" @click="closeDeleteModal">Cancel</button>
               <button class="btn btn-error" :disabled="deleteLoading" @click="deleteIntake">
                  <span v-if="deleteLoading" class="loading loading-spinner loading-sm"></span>
                  Confirm Delete
               </button>
            </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeDeleteModal">close</button>
      </form>
    </dialog>
  </div>
</template>