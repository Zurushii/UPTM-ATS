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

// Step 1: Configuration state
const selectedIntake = ref<string>("");
const rulesLoaded = ref(false);
const semesterRules = ref<any[]>([]);
const hasRules = ref(false);

// Step 2: File upload state
const selectedFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Step 3 & 4: Processing state
const isProcessing = ref(false);
const processingResult = ref<{
  summary: { total_records: number; successful: number; failed: number };
  processed: any[];
  failed: any[];
} | null>(null);

// Fetch available intakes
const { data: intakesData } = await useFetch(
  "/api/hop/intake-assessment/intakes",
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

// Load semester rules when intake is selected
const loadSemesterRules = async () => {
  if (!selectedIntake.value) {
    rulesLoaded.value = false;
    semesterRules.value = [];
    hasRules.value = false;
    return;
  }

  try {
    const response = await $fetch<{ rules: any[]; hasRules: boolean }>(
      "/api/hop/intake-assessment/rules",
      {
        query: { intake: selectedIntake.value },
      },
    );
    semesterRules.value = response.rules;
    hasRules.value = response.hasRules;
    rulesLoaded.value = true;
  } catch (error) {
    console.error("Failed to load semester rules:", error);
    rulesLoaded.value = false;
    semesterRules.value = [];
    hasRules.value = false;
  }
};

// Watch intake selection
watch(selectedIntake, () => {
  loadSemesterRules();
  // Reset subsequent steps when intake changes
  selectedFile.value = null;
  processingResult.value = null;
  if (currentStep.value > 1) {
    currentStep.value = 1;
  }
});

// Can proceed to step 2?
const canProceedToStep2 = computed(
  () => selectedIntake.value && hasRules.value,
);

// Proceed to step 2
const proceedToStep2 = () => {
  if (canProceedToStep2.value) {
    currentStep.value = 2;
  }
};

// Handle file selection
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (
      validTypes.includes(file.type) ||
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls") ||
      file.name.endsWith(".csv")
    ) {
      selectedFile.value = file;
    } else {
      alert("Please select a valid Excel file (.xlsx, .xls) or CSV file.");
      target.value = "";
    }
  }
};

// Clear file selection
const clearFile = () => {
  selectedFile.value = null;
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
};

// Process the uploaded file
const processFile = async () => {
  if (!selectedFile.value || !selectedIntake.value) return;

  isProcessing.value = true;
  processingResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", selectedFile.value);
    formData.append("intake", selectedIntake.value);

    const result = await $fetch<any>("/api/hop/intake-assessment/process", {
      method: "POST",
      body: formData,
    });

    processingResult.value = result;
    currentStep.value = 3;
  } catch (error: any) {
    alert(error.data?.message || "Failed to process file");
  } finally {
    isProcessing.value = false;
  }
};

// Export to Excel
const exportToExcel = async () => {
  if (!processingResult.value || processingResult.value.processed.length === 0)
    return;

  try {
    const response = await fetch("/api/hop/intake-assessment/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        students: processingResult.value.processed,
      }),
    });

    if (!response.ok) {
      throw new Error("Export failed");
    }

    // Create download link
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `academic_planning_input_${selectedIntake.value}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    alert("Failed to export Excel file");
  }
};

// Reset the entire process
const resetProcess = () => {
  currentStep.value = 1;
  selectedIntake.value = "";
  selectedFile.value = null;
  processingResult.value = null;
  rulesLoaded.value = false;
  semesterRules.value = [];
  hasRules.value = false;
};
</script>

<template>
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Intake Assessment</h1>
      <p class="text-sm text-base-content/60">
        Process credit transfer data for an intake and determine entry semesters
        for academic planning.
      </p>
    </div>

    <!-- Progress Steps -->
    <ul class="steps steps-horizontal w-full">
      <li class="step" :class="{ 'step-primary': currentStep >= 1 }">
        Configuration
      </li>
      <li class="step" :class="{ 'step-primary': currentStep >= 2 }">
        Excel Import
      </li>
      <li class="step" :class="{ 'step-primary': currentStep >= 3 }">
        Results & Export
      </li>
    </ul>

    <!-- Step 1: Intake Configuration -->
    <div
      v-if="currentStep === 1"
      class="card bg-base-100 border border-base-300 shadow-sm"
    >
      <div class="card-body space-y-4">
        <h2 class="card-title text-lg">Step 1: Intake Configuration</h2>
        <p class="text-sm text-base-content/60">
          Select the intake to process. Semester entry rules must be defined for
          the selected intake.
        </p>

        <!-- Intake Selection -->
        <div class="form-control w-full max-w-sm">
          <label class="label">
            <span class="label-text font-medium">Select Intake</span>
          </label>
          <select v-model="selectedIntake" class="select select-bordered">
            <option value="">-- Select an intake --</option>
            <option
              v-for="intake in intakesData?.intakes"
              :key="intake"
              :value="intake"
            >
              {{ formatIntake(intake) }} ({{ intake }})
            </option>
          </select>
        </div>

        <!-- Semester Rules Preview -->
        <div v-if="rulesLoaded" class="space-y-3">
          <div v-if="hasRules">
            <h3 class="font-medium text-sm mb-2">
              Semester Entry Rules for {{ formatIntake(selectedIntake) }}
            </h3>
            <div class="overflow-x-auto">
              <table class="table table-sm table-zebra w-full max-w-lg">
                <thead>
                  <tr>
                    <th>Min Credit</th>
                    <th>Max Credit</th>
                    <th>Entry Semester</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rule in semesterRules" :key="rule.id">
                    <td>{{ rule.min_credit }}</td>
                    <td>{{ rule.max_credit }}</td>
                    <td>Semester {{ rule.entry_semester }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="alert alert-warning">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
            <span>
              No semester entry rules found for this intake. Please configure
              rules in the
              <NuxtLink
                to="/dashboard/hop/semester-rules"
                class="link link-primary"
                >Semester Rules</NuxtLink
              >
              page first.
            </span>
          </div>
        </div>

        <!-- Action Button -->
        <div class="card-actions justify-end pt-2">
          <button
            class="btn btn-primary"
            :disabled="!canProceedToStep2"
            @click="proceedToStep2"
          >
            Continue to Excel Import
          </button>
        </div>
      </div>
    </div>

    <!-- Step 2: Excel Import -->
    <div
      v-if="currentStep === 2"
      class="card bg-base-100 border border-base-300 shadow-sm"
    >
      <div class="card-body space-y-4">
        <h2 class="card-title text-lg">Step 2: Excel Import</h2>
        <p class="text-sm text-base-content/60">
          Upload an Excel file containing student credit transfer data for
          <strong>{{ formatIntake(selectedIntake) }}</strong
          >.
        </p>

        <!-- File Format Info -->
        <div class="alert alert-info">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <h4 class="font-medium">Required Columns</h4>
            <ul class="text-sm list-disc list-inside mt-1">
              <li>
                <code>matric_no</code> or <code>student_id</code> - Student
                identifier
              </li>
              <li>
                <code>total_credit</code> or <code>credit_hour</code> -
                Transferred credits
              </li>
            </ul>
          </div>
        </div>

        <!-- File Upload -->
        <div class="form-control w-full max-w-md">
          <label class="label">
            <span class="label-text font-medium">Select Excel File</span>
          </label>
          <input
            ref="fileInputRef"
            type="file"
            accept=".xlsx,.xls,.csv"
            class="file-input file-input-bordered w-full"
            @change="handleFileSelect"
          />
          <label v-if="selectedFile" class="label">
            <span class="label-text-alt text-success">
              ✓ {{ selectedFile.name }} ({{
                (selectedFile.size / 1024).toFixed(1)
              }}
              KB)
            </span>
            <span
              class="label-text-alt text-error cursor-pointer"
              @click="clearFile"
              >Remove</span
            >
          </label>
        </div>

        <!-- Action Buttons -->
        <div class="card-actions justify-between pt-2">
          <button class="btn btn-ghost" @click="currentStep = 1">
            ← Back to Configuration
          </button>
          <button
            class="btn btn-primary"
            :disabled="!selectedFile || isProcessing"
            @click="processFile"
          >
            <span v-if="isProcessing" class="loading loading-spinner"></span>
            {{ isProcessing ? "Processing..." : "Process File" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Step 3: Results & Export -->
    <div v-if="currentStep === 3 && processingResult" class="space-y-4">
      <!-- Summary Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body space-y-4">
          <h2 class="card-title text-lg">Processing Summary</h2>

          <div class="stats stats-vertical lg:stats-horizontal shadow w-full">
            <div class="stat">
              <div class="stat-title">Total Records</div>
              <div class="stat-value text-2xl">
                {{ processingResult.summary.total_records }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Successful</div>
              <div class="stat-value text-2xl text-success">
                {{ processingResult.summary.successful }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Failed</div>
              <div class="stat-value text-2xl text-error">
                {{ processingResult.summary.failed }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Processed Students -->
      <div
        v-if="processingResult.processed.length > 0"
        class="card bg-base-100 border border-base-300 shadow-sm"
      >
        <div class="card-body space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="card-title text-lg">
              Processed Students ({{ processingResult.processed.length }})
            </h2>
            <button class="btn btn-success btn-sm" @click="exportToExcel">
              📥 Export for Academic Planning
            </button>
          </div>

          <div class="overflow-x-auto max-h-80">
            <table class="table table-sm table-zebra w-full">
              <thead class="sticky top-0 bg-base-200">
                <tr>
                  <th>Student ID</th>
                  <th>Matric No</th>
                  <th>Intake</th>
                  <th>Credits Transferred</th>
                  <th>Entry Semester</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in processingResult.processed"
                  :key="student.student_id"
                >
                  <td>{{ student.student_id }}</td>
                  <td class="font-mono">{{ student.matric_no }}</td>
                  <td>{{ formatIntake(student.intake) }}</td>
                  <td>{{ student.total_transferred_credit }}</td>
                  <td>Semester {{ student.entry_semester }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Failed Records -->
      <div
        v-if="processingResult.failed.length > 0"
        class="card bg-base-100 border border-error/30 shadow-sm"
      >
        <div class="card-body space-y-4">
          <h2 class="card-title text-lg text-error">
            Failed Records ({{ processingResult.failed.length }})
          </h2>
          <p class="text-sm text-base-content/60">
            These records were not processed and will not be included in the
            export.
          </p>

          <div class="overflow-x-auto max-h-60">
            <table class="table table-sm w-full">
              <thead class="sticky top-0 bg-base-200">
                <tr>
                  <th>Row</th>
                  <th>Matric No</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="record in processingResult.failed"
                  :key="record.row"
                  class="text-error"
                >
                  <td>{{ record.row }}</td>
                  <td class="font-mono">{{ record.matric_no || "-" }}</td>
                  <td>{{ record.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between">
        <button class="btn btn-ghost" @click="resetProcess">
          ← Start New Assessment
        </button>
        <button
          v-if="processingResult.processed.length > 0"
          class="btn btn-primary"
          @click="exportToExcel"
        >
          📥 Download Academic Planning Input
        </button>
      </div>
    </div>
  </div>
</template>
