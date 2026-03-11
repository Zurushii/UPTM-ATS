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

// Step management
const currentStep = ref(1);
const totalSteps = 4;

// Step 1: Configuration state
const selectedIntake = ref<string>("");
const selectedRuleSet = ref<string>("");
const intakeInputTouched = ref(false);

// Validate intake format (MMYY)
const isValidIntakeFormat = (value: string): boolean => {
  if (!value || value.length !== 4) return false;
  const month = parseInt(value.substring(0, 2));
  const year = parseInt(value.substring(2, 4));
  return !isNaN(month) && !isNaN(year) && month >= 1 && month <= 12;
};

const intakeValidation = computed(() => {
  if (!intakeInputTouched.value || !selectedIntake.value) {
    return { valid: false, message: "" };
  }
  if (!isValidIntakeFormat(selectedIntake.value)) {
    return {
      valid: false,
      message: "Invalid format. Use MMYY (e.g., 0126 for Jan 2026)",
    };
  }
  return { valid: true, message: "" };
});

// Step 2: File upload state
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isDragging = ref(false);

// Step 3: Processing state
const isProcessing = ref(false);
const processingResult = ref<{
  summary: {
    total_records: number;
    successful: number;
    failed: number;
    new_students: number;
    updated_students: number;
  };
  processed_students: Array<{
    student_id: number;
    matric_no: string;
    intake_year: string;
    total_credit_transferred: number;
    starting_semester: number;
    program_code: string;
    transferred_courses: string;
    entry_semester: number;
    is_new_student: boolean;
  }>;
  failed_records: Array<{
    row: number;
    matric_no: string | null;
    student_id: number | null;
    reason: string;
  }>;
} | null>(null);

// Types for API responses
interface ConfigData {
  programId: number;
  intakes: string[];
  ruleSets: Array<{
    intake_type: string;
    rule_count: number;
    min_credit: number;
    max_credit: number;
  }>;
}

interface RuleData {
  id: number;
  credit_transfer: number;
  entry_semester: number;
}

// Fetch current session
interface CurrentSession {
  active_intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data: sessionData } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

// Pre-fill intake from current session
watchEffect(() => {
  if (sessionData.value?.current_session) {
    selectedIntake.value =
      sessionData.value.current_session.active_intake_period;
  }
});

// Fetch configuration options
const { data: configData, pending: configPending } = await useFetch<ConfigData>(
  "/api/hop/intake-assessment/config",
);

// Fetch rules when rule set is selected
const rulesQuery = computed(() => ({
  intake_type: selectedRuleSet.value || undefined,
}));

const { data: rulesData } = await useFetch<RuleData[]>(
  "/api/hop/intake-assessment/rules",
  {
    query: rulesQuery,
    watch: [selectedRuleSet],
    immediate: false,
  },
);

// Computed
const canProceedToStep2 = computed(
  () =>
    sessionData.value?.current_session &&
    selectedIntake.value &&
    isValidIntakeFormat(selectedIntake.value) &&
    selectedRuleSet.value,
);

const sessionLabel = computed(() => {
  if (!sessionData.value?.current_session) return "";
  return sessionData.value.current_session.semester_type === "L"
    ? "Long Semester"
    : "Short Semester";
});

const canProceedToStep3 = computed(() => selectedFile.value !== null);

const canExport = computed(
  () =>
    processingResult.value &&
    processingResult.value.processed_students.length > 0,
);

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

// Process file
const processFile = async () => {
  if (!selectedFile.value || !selectedIntake.value || !selectedRuleSet.value) {
    return;
  }

  isProcessing.value = true;
  processingResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", selectedFile.value);
    formData.append("intake", selectedIntake.value);
    formData.append("intake_type", selectedRuleSet.value);

    const response = await $fetch("/api/hop/intake-assessment/process", {
      method: "POST",
      body: formData,
    });

    processingResult.value = response as NonNullable<
      typeof processingResult.value
    >;
    currentStep.value = 4;
  } catch (error: any) {
    alert(error.data?.message || error.message || "Processing failed");
  } finally {
    isProcessing.value = false;
  }
};

// Export to Excel
const exportToExcel = async () => {
  if (!processingResult.value || !canExport.value) return;

  try {
    const response = await $fetch("/api/hop/intake-assessment/export", {
      method: "POST",
      body: {
        intake_year: selectedIntake.value,
      },
      responseType: "blob",
    });

    // Download the file
    const blob = new Blob([response as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `intake_assessment_${selectedIntake.value}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    alert(error.data?.message || error.message || "Export failed");
  }
};

// Navigation
const goToStep = (step: number) => {
  if (step < currentStep.value) {
    currentStep.value = step;
  }
};

const nextStep = () => {
  if (currentStep.value < totalSteps) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

// Reset entire process
const resetProcess = () => {
  currentStep.value = 1;
  selectedIntake.value = "";
  selectedRuleSet.value = "";
  selectedFile.value = null;
  processingResult.value = null;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
};

// Results filtering
const processedSearchQuery = ref("");
const processedStatusFilter = ref("");

const filteredProcessedStudents = computed(() => {
  if (!processingResult.value) return [];

  let result = processingResult.value.processed_students;

  // Filter by status
  if (processedStatusFilter.value) {
    const isNew = processedStatusFilter.value === "new";
    result = result.filter((s) => s.is_new_student === isNew);
  }

  // Filter by search query
  if (processedSearchQuery.value) {
    const query = processedSearchQuery.value.toLowerCase();
    result = result.filter(
      (s) =>
        s.matric_no.toLowerCase().includes(query) ||
        (s.program_code && s.program_code.toLowerCase().includes(query)),
    );
  }

  return result;
});
</script>

<template>
  <div class="p-6 w-full space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Intake Assessment</h1>
      <p class="text-sm text-base-content/60">
        Process credit transfer data and determine entry semesters for students
        in a specific intake.
      </p>
    </div>

    <!-- Progress Steps -->
    <div class="w-full max-w-4xl mx-auto">
      <ul class="steps steps-vertical md:steps-horizontal w-full">
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 1 }"
          @click="goToStep(1)"
        >
          <span class="text-xs font-bold tracking-wide mt-2 uppercase"
            >Configuration</span
          >
        </li>
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 2 }"
          @click="canProceedToStep2 ? goToStep(2) : null"
        >
          <span class="text-xs font-bold tracking-wide mt-2 uppercase"
            >Upload Excel</span
          >
        </li>
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 3 }"
          @click="canProceedToStep3 ? goToStep(3) : null"
        >
          <span class="text-xs font-bold tracking-wide mt-2 uppercase"
            >Process</span
          >
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 4 }">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase"
            >Results</span
          >
        </li>
      </ul>
    </div>

    <!-- Loading State -->
    <div v-if="configPending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <div
      v-else
      :class="[currentStep === 4 ? 'w-full' : 'max-w-4xl mx-auto']"
      class="transition-all duration-300"
    >
      <!-- Step 1: Configuration -->
      <div
        v-if="currentStep === 1"
        class="card bg-base-100 border border-base-200 shadow-xl"
      >
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div
              class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-6 h-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.1.597.58.96 1.12.756.46-.174.935-.308 1.424-.486.53-.193 1.125.13 1.294.665l.383 1.205c.17.534-.1.1.134-1.294.665l-.479.799c-.31.516-.25 1.171.168 1.636a10.02 10.02 0 0 1 2.222 3.193c.31.84.975 1.576 1.83.84l1.205-.383c.535-.17.858-.765.665-1.294-.178-.489-.312-.964-.486-1.424-.204-.54.16-1.02.756-1.12l.894-.15c.542-.09.94-.56.94-1.11V7.82c0-.55-.398-1.02-.94-1.11l-.894-.15c-.596-.1-.96-.58-.756-1.12.174-.46.308-.935.486-1.424.193-.53-.13-1.125-.665-1.294l-1.205-.383c-.534-.17-1.294.13-1.636.665-.36.566-.99.516-1.636.168a10.02 10.02 0 0 1-3.193-2.222c-.84-.31-1.576-.975-.84-1.83l.383-1.205c.17-.535.765-.858 1.294-.665.489.178.964.312 1.424.486.54.204 1.02-.16 1.12-.756l.15-.894c.09-.542.56-.94 1.11-.94h1.094c.55 0 1.02.398 1.11.94l.15.894c.1.597.58.96 1.12.756.46-.174.935-.308 1.424-.486.53-.193 1.125.13 1.294.665l.383 1.205c.17.534-.1.1.134-1.294.665l-.479.799c-.31.516-.25 1.171.168 1.636a10.02 10.02 0 0 1 2.222 3.193c.31.84.975 1.576 1.83.84l1.205-.383c.535-.17.858-.765.665-1.294-.178-.489-.312-.964-.486-1.424-.204-.54.16-1.02.756-1.12l.894-.15c.542-.09.94-.56.94-1.11V16.18c0-.55-.398-1.02-.94-1.11l-.894-.15c-.596-.1-.96-.58-.756-1.12.174-.46.308-.935.486-1.424.193-.53-.13-1.125-.665-1.294l-1.205-.383c-.534-.17-1.294.13-1.636.665-.36.566-.99.516-1.636.168a10.02 10.02 0 0 1-3.193-2.222c-.84-.31-1.576-.975-.84-1.83l.383-1.205c.17-.535.765-.858 1.294-.665.489.178.964.312 1.424.486.54.204 1.02-.16 1.12-.756l.15-.894Z"
                />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Intake Configuration</h2>
              <p class="text-sm text-base-content/60">
                Configure the assessment parameters for this batch.
              </p>
            </div>
          </div>

          <!-- Current Session Banner -->
          <div
            v-if="sessionData?.current_session"
            class="alert alert-info shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-5 h-5 shrink-0"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
              />
            </svg>
            <div>
              <span class="font-semibold">Current Session:</span>
              {{ formatIntake(sessionData.current_session.intake_period) }} ·
              {{ sessionLabel }}
            </div>
          </div>
          <div v-else class="alert alert-warning shadow-sm">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span
              >Current session is not set. Please configure it in
              <NuxtLink
                to="/dashboard/hop"
                class="link link-primary font-medium"
                >Settings</NuxtLink
              >
              before processing an intake.</span
            >
          </div>

          <div class="grid md:grid-cols-2 gap-6">
            <!-- Intake Selection (locked to current session) -->
            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-medium">Intake Code</span>
              </label>
              <input
                :value="selectedIntake"
                type="text"
                maxlength="4"
                class="input input-bordered w-full h-12 font-mono tracking-wider bg-base-200"
                :class="{
                  'input-success': intakeValidation.valid,
                }"
                disabled
              />
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  Locked to current session intake
                </span>
                <span
                  v-if="selectedIntake && intakeValidation.valid"
                  class="label-text-alt text-success"
                >
                  {{ formatIntake(selectedIntake) }}
                </span>
              </label>
            </div>

            <!-- Rule Set Selection -->
            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-medium"
                  >Semester Entry Rule Set</span
                >
              </label>
              <select
                v-model="selectedRuleSet"
                class="select select-bordered w-full h-12"
              >
                <option value="">Choose rule set...</option>
                <option
                  v-for="ruleSet in configData?.ruleSets"
                  :key="ruleSet.intake_type"
                  :value="ruleSet.intake_type"
                >
                  {{ ruleSet.intake_type }} ({{ ruleSet.rule_count }}
                  rules)
                </option>
              </select>
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  Applied credit transfer logic
                </span>
              </label>
            </div>
          </div>

          <!-- Show selected rules preview -->
          <div
            v-if="rulesData && rulesData.length > 0"
            class="bg-base-200/50 rounded-xl p-6 border border-base-200"
          >
            <h3 class="font-medium mb-3 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
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
              Rule Set Preview
            </h3>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Credit Transfer Range</th>
                    <th>Entry Semester</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="rule in rulesData"
                    :key="rule.id"
                    class="hover:bg-base-100/50"
                  >
                    <td class="font-mono">
                      ≥ {{ rule.credit_transfer }} credits
                    </td>
                    <td>
                      <span class="badge badge-neutral badge-sm"
                        >Semester {{ rule.entry_semester }}</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Info about manual intake entry -->
          <div
            v-if="configData?.intakes?.length === 0"
            class="alert alert-info shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="stroke-current shrink-0 w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span
              >No existing students found. Enter the intake code manually
              (format: MMYY).</span
            >
          </div>

          <div
            v-if="configData?.ruleSets?.length === 0"
            class="alert alert-warning shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>No rule sets found. Configure Semester Rules first.</span>
          </div>

          <div class="card-actions justify-end mt-4">
            <button
              class="btn btn-primary px-8"
              :disabled="!canProceedToStep2"
              @click="nextStep"
            >
              Next Step
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2: File Upload -->
      <div
        v-else-if="currentStep === 2"
        class="card bg-base-100 border border-base-200 shadow-xl"
      >
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div
              class="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-6 h-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Upload Data</h2>
              <p class="text-sm text-base-content/60">
                Upload the Excel file containing credit transfer records.
              </p>
            </div>
          </div>

          <!-- Configuration Summary -->
          <div class="bg-base-200/50 rounded-lg p-4 flex gap-8">
            <div>
              <span class="text-xs text-base-content/50 uppercase tracking-wide"
                >Selected Intake</span
              >
              <div class="font-medium">{{ formatIntake(selectedIntake) }}</div>
            </div>
            <div>
              <span class="text-xs text-base-content/50 uppercase tracking-wide"
                >Rule Set</span
              >
              <div class="font-medium">{{ selectedRuleSet }}</div>
            </div>
          </div>

          <!-- File Upload Area -->
          <div
            class="border-3 border-dashed rounded-xl p-12 text-center transition-all duration-300"
            :class="{
              'border-primary bg-primary/5 scale-[1.01]': isDragging,
              'border-base-300 hover:border-primary/50 hover:bg-base-200/30':
                !isDragging,
            }"
            @drop="handleDrop"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
          >
            <input
              ref="fileInput"
              type="file"
              accept=".xlsx,.xls"
              class="hidden"
              @change="handleFileSelect"
            />

            <div v-if="!selectedFile" class="space-y-4">
              <div
                class="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-8 h-8 text-base-content/60"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
              </div>
              <div>
                <p class="text-lg font-medium">Drag & Drop Excel File</p>
                <p class="text-sm text-base-content/60 mt-1">
                  or click to browse
                </p>
              </div>
              <button
                class="btn btn-outline btn-sm mt-4"
                @click="triggerFileInput"
              >
                Choose File
              </button>
              <p class="text-xs text-base-content/40 mt-4">
                Supported formats: .xlsx, .xls
              </p>
            </div>

            <div v-else class="space-y-6">
              <div
                class="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto text-success"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  class="w-8 h-8"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m4.5 12.75 6 6 9-13.5"
                  />
                </svg>
              </div>
              <div>
                <p class="font-bold text-lg">{{ selectedFile.name }}</p>
                <p class="text-sm text-base-content/60">
                  {{ (selectedFile.size / 1024).toFixed(2) }} KB
                </p>
              </div>
              <button
                class="btn btn-ghost btn-sm text-error hover:bg-error/10"
                @click="removeFile"
              >
                Remove File
              </button>
            </div>
          </div>

          <!-- Expected Format Info -->
          <div
            class="collapse collapse-arrow bg-base-200/50 border border-base-200"
          >
            <input type="checkbox" />
            <div class="collapse-title font-medium flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-5 h-5 text-info"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                />
              </svg>
              View Expected File Format
            </div>
            <div class="collapse-content">
              <p class="text-sm text-base-content/70 mb-3">
                Ensure your Excel file contains these exact column headers:
              </p>
              <div
                class="grid grid-cols-2 lg:grid-cols-3 gap-2 text-xs font-mono"
              >
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  matric_no
                </div>
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  intake_year
                </div>
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  total_credit_transferred
                </div>
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  starting_semester
                </div>
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  program_code
                </div>
                <div class="bg-base-100 p-2 rounded border border-base-200">
                  transferred_courses
                </div>
              </div>
            </div>
          </div>

          <div class="card-actions justify-between mt-6">
            <button class="btn btn-ghost" @click="prevStep">Back</button>
            <button
              class="btn btn-primary px-8"
              :disabled="!canProceedToStep3"
              @click="nextStep"
            >
              Continue
            </button>
          </div>
        </div>
      </div>

      <!-- Step 3: Process Confirmation -->
      <div
        v-if="currentStep === 3"
        class="card bg-base-100 border border-base-200 shadow-xl"
      >
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div
              class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-6 h-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Process Assessment</h2>
              <p class="text-sm text-base-content/60">
                Review configuration and start processing.
              </p>
            </div>
          </div>

          <!-- Processing Summary -->
          <div class="bg-base-200/50 rounded-xl p-6 border border-base-200">
            <h3 class="font-medium mb-4 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.1.597.58.96 1.12.756.46-.174.935-.308 1.424-.486.53-.193 1.125.13 1.294.665l.383 1.205c.17.534-.1.1.134-1.294.665l-.479.799c-.31.516-.25 1.171.168 1.636a10.02 10.02 0 0 1 2.222 3.193c.31.84.975 1.576 1.83.84l1.205-.383c.535-.17.858-.765.665-1.294-.178-.489-.312-.964-.486-1.424-.204-.54.16-1.02.756-1.12l.894-.15c.542-.09.94-.56.94-1.11V7.82c0-.55-.398-1.02-.94-1.11l-.894-.15c-.596-.1-.96-.58-.756-1.12.174-.46.308-.935.486-1.424.193-.53-.13-1.125-.665-1.294l-1.205-.383c-.534-.17-1.294.13-1.636.665-.36.566-.99.516-1.636.168a10.02 10.02 0 0 1-3.193-2.222c-.84-.31-1.576-.975-.84-1.83l.383-1.205c.17-.535.765-.858 1.294-.665.489.178.964.312 1.424.486.54.204 1.02-.16 1.12-.756l.15-.894c.09-.542.56-.94 1.11-.94h1.094c.55 0 1.02.398 1.11.94l.15.894c.1.597.58.96 1.12.756.46-.174.935-.308 1.424-.486.53-.193 1.125.13 1.294.665l.383 1.205c.17.534-.1.1.134-1.294.665l-.479.799c-.31.516-.25 1.171.168 1.636a10.02 10.02 0 0 1 2.222 3.193c.31.84.975 1.576 1.83.84l1.205-.383c.535-.17.858-.765.665-1.294-.178-.489-.312-.964-.486-1.424-.204-.54.16-1.02.756-1.12l.894-.15c.542-.09.94-.56.94-1.11V16.18c0-.55-.398-1.02-.94-1.11l-.894-.15c-.596-.1-.96-.58-.756-1.12.174-.46.308-.935.486-1.424.193-.53-.13-1.125-.665-1.294l-1.205-.383c-.534-.17-1.294.13-1.636.665-.36.566-.99.516-1.636.168a10.02 10.02 0 0 1-3.193-2.222c-.84-.31-1.576-.975-.84-1.83l.383-1.205c.17-.535.765-.858 1.294-.665.489.178.964.312 1.424.486.54.204 1.02-.16 1.12-.756l.15-.894Z"
                />
              </svg>
              Processing Configuration
            </h3>
            <div class="grid md:grid-cols-3 gap-6 text-sm">
              <div>
                <span
                  class="text-base-content/60 text-xs uppercase tracking-wide block mb-1"
                  >Target Intake</span
                >
                <div class="font-medium text-lg">
                  {{ formatIntake(selectedIntake) }}
                </div>
              </div>
              <div>
                <span
                  class="text-base-content/60 text-xs uppercase tracking-wide block mb-1"
                  >Rule Set</span
                >
                <div class="font-medium text-lg">{{ selectedRuleSet }}</div>
              </div>
              <div>
                <span
                  class="text-base-content/60 text-xs uppercase tracking-wide block mb-1"
                  >Source File</span
                >
                <div
                  class="font-medium text-lg truncate"
                  :title="selectedFile?.name"
                >
                  {{ selectedFile?.name }}
                </div>
              </div>
            </div>
          </div>

          <!-- Warning -->
          <div class="alert alert-warning shadow-sm">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h3 class="font-bold">This action will modify student records</h3>
              <p class="text-sm">
                System will calculate total credits and determine entry semester
                for all valid students in the file.
              </p>
            </div>
          </div>

          <div class="card-actions justify-between mt-4">
            <button
              class="btn btn-ghost"
              :disabled="isProcessing"
              @click="prevStep"
            >
              Back
            </button>
            <button
              class="btn btn-primary px-8"
              :disabled="isProcessing"
              @click="processFile"
            >
              <span
                v-if="isProcessing"
                class="loading loading-spinner loading-sm"
              ></span>
              {{ isProcessing ? "Processing Data..." : "Start Processing" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Step 4: Results -->
      <div v-if="currentStep === 4 && processingResult" class="space-y-6">
        <!-- Summary Card -->
        <div class="card bg-base-100 border border-base-300 shadow-sm">
          <div class="card-body space-y-6">
            <div>
              <h2 class="card-title text-lg">Processing Results</h2>
              <p class="text-sm text-base-content/60">
                Summary of the intake assessment processing.
              </p>
            </div>

            <!-- Stats -->
            <div class="stats shadow w-full">
              <div class="stat">
                <div class="stat-title">Total Records</div>
                <div class="stat-value text-2xl">
                  {{ processingResult.summary.total_records }}
                </div>
                <div class="stat-desc">From uploaded file</div>
              </div>

              <div class="stat">
                <div class="stat-title">Successful</div>
                <div class="stat-value text-2xl text-success">
                  {{ processingResult.summary.successful }}
                </div>
                <div class="stat-desc">Students processed</div>
              </div>

              <div class="stat">
                <div class="stat-title">Pre-registered</div>
                <div class="stat-value text-2xl text-warning">
                  {{ processingResult.summary.new_students }}
                </div>
                <div class="stat-desc">New students reserved</div>
              </div>

              <div class="stat">
                <div class="stat-title">Failed</div>
                <div class="stat-value text-2xl text-error">
                  {{ processingResult.summary.failed }}
                </div>
                <div class="stat-desc">Invalid records</div>
              </div>
            </div>

            <!-- Export Button -->
            <div v-if="canExport" class="flex justify-end">
              <button class="btn btn-primary gap-2" @click="exportToExcel">
                <span>📥</span>
                Download Academic Planning Input
              </button>
            </div>
          </div>
        </div>

        <!-- Successful Students -->
        <div
          v-if="processingResult.processed_students.length > 0"
          class="card bg-base-100 border border-base-300 shadow-sm"
        >
          <div class="card-body">
            <h3 class="font-medium mb-4">
              Processed Students ({{
                processingResult.processed_students.length
              }})
            </h3>

            <!-- Table Filters -->
            <div class="flex flex-col sm:flex-row gap-4 mb-4">
              <div class="relative flex-1 max-w-xs">
                <input
                  v-model="processedSearchQuery"
                  type="text"
                  placeholder="Search Student ID..."
                  class="input input-sm input-bordered w-full pl-9"
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-4 h-4 absolute left-3 top-2.5 text-base-content/50"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
              </div>

              <select
                v-model="processedStatusFilter"
                class="select select-sm select-bordered w-full sm:max-w-xs"
              >
                <option value="">All Statuses</option>
                <option value="processed">Processed</option>
                <option value="new">Pre-registered</option>
              </select>
            </div>

            <div class="overflow-x-auto max-h-96">
              <table class="table table-sm table-zebra w-full">
                <thead class="sticky top-0 bg-base-100">
                  <tr>
                    <th>Student ID</th>
                    <th>Intake Year</th>
                    <th>Total Credit Transferred</th>
                    <th>Entry Semester</th>
                    <th>Program</th>
                    <th>Transferred Courses</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="student in filteredProcessedStudents"
                    :key="student.student_id"
                  >
                    <td class="font-mono">{{ student.matric_no }}</td>
                    <td>{{ student.intake_year }}</td>
                    <td>{{ student.total_credit_transferred }}</td>
                    <td>
                      <span
                        class="badge badge-ghost badge-sm whitespace-nowrap"
                      >
                        Semester {{ student.entry_semester }}
                      </span>
                    </td>
                    <td>{{ student.program_code }}</td>
                    <td class="font-mono text-xs max-w-xs truncate">
                      {{ student.transferred_courses || "-" }}
                    </td>
                    <td>
                      <span
                        v-if="student.is_new_student"
                        class="badge badge-warning badge-sm whitespace-nowrap"
                      >
                        Pre-registered
                      </span>
                      <span
                        v-else
                        class="badge badge-success badge-sm whitespace-nowrap"
                      >
                        Processed
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Failed Records -->
        <div
          v-if="processingResult.failed_records.length > 0"
          class="card bg-base-100 border border-error/30 shadow-sm"
        >
          <div class="card-body">
            <h3 class="font-medium mb-4 text-error">
              Failed Records ({{ processingResult.failed_records.length }})
            </h3>
            <div class="overflow-x-auto max-h-64">
              <table class="table table-sm w-full">
                <thead class="sticky top-0 bg-base-100">
                  <tr>
                    <th>Row</th>
                    <th>Student ID</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(record, index) in processingResult.failed_records"
                    :key="index"
                    class="text-error/80"
                  >
                    <td>{{ record.row }}</td>
                    <td class="font-mono">{{ record.matric_no || "-" }}</td>
                    <td>{{ record.reason }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="text-xs text-base-content/50 mt-2">
              Failed records are shown here for reference only and are not
              included in the output file.
            </p>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-between">
          <button class="btn btn-ghost" @click="resetProcess">
            Process Another Intake
          </button>
          <NuxtLink to="/dashboard/hop/students" class="btn btn-outline">
            View Students
          </NuxtLink>
        </div>

        <!-- Next Step Prompt -->
        <div class="mt-6 card bg-base-200 shadow-sm">
          <div class="card-body flex-row items-center justify-between py-4">
            <div>
              <p class="text-sm text-base-content/60">Next Step</p>
              <p class="font-semibold">Generate Academic Plans</p>
              <p class="text-sm text-base-content/70">
                Create and approve academic plans for your students
              </p>
            </div>
            <NuxtLink
              to="/dashboard/hop/academic-planning"
              class="btn btn-primary btn-sm"
            >
              Academic Planning &rarr;
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
