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
  };
  processed_students: Array<{
    student_id: number;
    matric_no: string;
    intake: string;
    total_transferred_credit: number;
    entry_semester: number;
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
  () => selectedIntake.value && selectedRuleSet.value,
);

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
        students: processingResult.value.processed_students,
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
    link.download = `academic_planning_input_${selectedIntake.value}.xlsx`;
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
</script>

<template>
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Intake Assessment</h1>
      <p class="text-sm text-base-content/60">
        Process credit transfer data and determine entry semesters for students
        in a specific intake.
      </p>
    </div>

    <!-- Progress Steps -->
    <div class="w-full">
      <ul class="steps steps-horizontal w-full">
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 1 }"
          @click="goToStep(1)"
        >
          <span class="text-xs">Configuration</span>
        </li>
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 2 }"
          @click="canProceedToStep2 ? goToStep(2) : null"
        >
          <span class="text-xs">Upload Excel</span>
        </li>
        <li
          class="step"
          :class="{ 'step-primary': currentStep >= 3 }"
          @click="canProceedToStep3 ? goToStep(3) : null"
        >
          <span class="text-xs">Process</span>
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 4 }">
          <span class="text-xs">Results</span>
        </li>
      </ul>
    </div>

    <!-- Loading State -->
    <div v-if="configPending" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-md"></span>
    </div>

    <!-- Step 1: Configuration -->
    <div
      v-else-if="currentStep === 1"
      class="card bg-base-100 border border-base-300 shadow-sm"
    >
      <div class="card-body space-y-6">
        <div>
          <h2 class="card-title text-lg">Step 1: Intake Configuration</h2>
          <p class="text-sm text-base-content/60">
            Select the intake and semester entry rule set to apply.
          </p>
        </div>

        <div class="grid md:grid-cols-2 gap-6">
          <!-- Intake Selection -->
          <div class="form-control w-full">
            <label class="label">
              <span class="label-text font-medium">Intake</span>
            </label>
            <select
              v-model="selectedIntake"
              class="select select-bordered w-full"
            >
              <option value="">Select intake...</option>
              <option
                v-for="intake in configData?.intakes"
                :key="intake"
                :value="intake"
              >
                {{ formatIntake(intake) }} ({{ intake }})
              </option>
            </select>
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Students from this intake will be processed
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
              class="select select-bordered w-full"
            >
              <option value="">Select rule set...</option>
              <option
                v-for="ruleSet in configData?.ruleSets"
                :key="ruleSet.intake_type"
                :value="ruleSet.intake_type"
              >
                {{ ruleSet.intake_type }} ({{
                  ruleSet.rule_count
                }}
                rules, {{ ruleSet.min_credit }}-{{
                  ruleSet.max_credit
                }}
                credits)
              </option>
            </select>
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Rules to determine entry semester based on credits
              </span>
            </label>
          </div>
        </div>

        <!-- Show selected rules preview -->
        <div
          v-if="rulesData && rulesData.length > 0"
          class="bg-base-200 rounded-lg p-4"
        >
          <h3 class="font-medium mb-3">Selected Rule Set Preview</h3>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Credit Transfer</th>
                  <th>Entry Semester</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in rulesData" :key="rule.id">
                  <td>≥ {{ rule.credit_transfer }} credits</td>
                  <td>Semester {{ rule.entry_semester }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- No intakes warning -->
        <div
          v-if="configData?.intakes?.length === 0"
          class="alert alert-warning"
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
          <span
            >No students found in your program. Students must be registered
            first.</span
          >
        </div>

        <!-- No rule sets warning -->
        <div
          v-if="configData?.ruleSets?.length === 0"
          class="alert alert-warning"
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
          <span
            >No semester entry rules found. Please configure rules in Semester
            Rules first.</span
          >
        </div>

        <div class="card-actions justify-end">
          <button
            class="btn btn-primary"
            :disabled="!canProceedToStep2"
            @click="nextStep"
          >
            Continue
          </button>
        </div>
      </div>
    </div>

    <!-- Step 2: File Upload -->
    <div
      v-else-if="currentStep === 2"
      class="card bg-base-100 border border-base-300 shadow-sm"
    >
      <div class="card-body space-y-6">
        <div>
          <h2 class="card-title text-lg">Step 2: Upload Excel File</h2>
          <p class="text-sm text-base-content/60">
            Upload an Excel file containing student credit transfer data.
          </p>
        </div>

        <!-- Configuration Summary -->
        <div class="bg-base-200 rounded-lg p-4">
          <h3 class="font-medium mb-2">Configuration Summary</h3>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Intake:</span>
              <span class="ml-2 font-medium">{{
                formatIntake(selectedIntake)
              }}</span>
            </div>
            <div>
              <span class="text-base-content/60">Rule Set:</span>
              <span class="ml-2 font-medium">{{
                selectedRuleSet
              }}</span>
            </div>
          </div>
        </div>

        <!-- File Upload Area -->
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
          :class="{
            'border-primary bg-primary/5': isDragging,
            'border-base-300 hover:border-primary/50': !isDragging,
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
            <div class="text-4xl">📄</div>
            <div>
              <p class="font-medium">Drop your Excel file here</p>
              <p class="text-sm text-base-content/60">or</p>
            </div>
            <button class="btn btn-outline btn-sm" @click="triggerFileInput">
              Browse Files
            </button>
            <p class="text-xs text-base-content/50">
              Supported formats: .xlsx, .xls
            </p>
          </div>

          <div v-else class="space-y-4">
            <div class="text-4xl">✅</div>
            <div>
              <p class="font-medium">{{ selectedFile.name }}</p>
              <p class="text-sm text-base-content/60">
                {{ (selectedFile.size / 1024).toFixed(2) }} KB
              </p>
            </div>
            <button class="btn btn-ghost btn-sm text-error" @click="removeFile">
              Remove File
            </button>
          </div>
        </div>

        <!-- Expected Format Info -->
        <div class="bg-info/10 rounded-lg p-4">
          <h3 class="font-medium mb-2 flex items-center gap-2">
            <span>ℹ️</span> Expected Excel Format
          </h3>
          <p class="text-sm text-base-content/70 mb-2">
            The Excel file must contain these columns:
          </p>
          <ul
            class="text-sm text-base-content/70 list-disc list-inside space-y-1"
          >
            <li>
              <code class="bg-base-300 px-1 rounded">student_id</code> or
              <code class="bg-base-300 px-1 rounded">matric_no</code> - Student
              identifier
            </li>
            <li>
              <code class="bg-base-300 px-1 rounded">transferred_credits</code>,
              <code class="bg-base-300 px-1 rounded">credit</code>, or
              <code class="bg-base-300 px-1 rounded">total_credit</code> -
              Credit hours transferred
            </li>
          </ul>
        </div>

        <div class="card-actions justify-between">
          <button class="btn btn-ghost" @click="prevStep">Back</button>
          <button
            class="btn btn-primary"
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
      v-else-if="currentStep === 3"
      class="card bg-base-100 border border-base-300 shadow-sm"
    >
      <div class="card-body space-y-6">
        <div>
          <h2 class="card-title text-lg">Step 3: Process Data</h2>
          <p class="text-sm text-base-content/60">
            Review the configuration and process the uploaded file.
          </p>
        </div>

        <!-- Processing Summary -->
        <div class="bg-base-200 rounded-lg p-4 space-y-4">
          <h3 class="font-medium">Processing Configuration</h3>
          <div class="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Intake:</span>
              <div class="font-medium">{{ formatIntake(selectedIntake) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Rule Set:</span>
              <div class="font-medium">{{ formatIntake(selectedRuleSet) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">File:</span>
              <div class="font-medium truncate">{{ selectedFile?.name }}</div>
            </div>
          </div>
        </div>

        <!-- Warning -->
        <div class="alert alert-warning">
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
            <h3 class="font-bold">This action will update student records</h3>
            <p class="text-sm">
              Processing will update the total_credit_transferred and
              starting_semester for each valid student.
            </p>
          </div>
        </div>

        <div class="card-actions justify-between">
          <button
            class="btn btn-ghost"
            :disabled="isProcessing"
            @click="prevStep"
          >
            Back
          </button>
          <button
            class="btn btn-primary"
            :disabled="isProcessing"
            @click="processFile"
          >
            <span
              v-if="isProcessing"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ isProcessing ? "Processing..." : "Process File" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Step 4: Results -->
    <div v-else-if="currentStep === 4 && processingResult" class="space-y-6">
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
              <div class="stat-desc">Students updated</div>
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
          <div class="overflow-x-auto max-h-96">
            <table class="table table-sm table-zebra w-full">
              <thead class="sticky top-0 bg-base-100">
                <tr>
                  <th>Student ID</th>
                  <th>Matric No</th>
                  <th>Intake</th>
                  <th>Transferred Credits</th>
                  <th>Entry Semester</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in processingResult.processed_students"
                  :key="student.student_id"
                >
                  <td class="font-mono">{{ student.student_id }}</td>
                  <td class="font-mono">{{ student.matric_no }}</td>
                  <td>{{ formatIntake(student.intake) }}</td>
                  <td>{{ student.total_transferred_credit }}</td>
                  <td>
                    <span class="badge badge-info badge-sm">
                      Semester {{ student.entry_semester }}
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
                  <th>Matric No</th>
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
                  <td class="font-mono">{{ record.student_id || "-" }}</td>
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
    </div>
  </div>
</template>
