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
  }, 3500);
};

const currentStep = ref(1);
const selectedIntake = ref("");
const selectedRuleSet = ref("");
const intakeInputTouched = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isDragging = ref(false);
const isExportingTemplate = ref(false);
const isProcessing = ref(false);
const isGeneratingPlans = ref(false);
const processedSearchQuery = ref("");
const processedStatusFilter = ref("");

interface ProcessedStudent {
  student_id: number;
  matric_no: string;
  intake_year: string;
  total_credit_transferred: number;
  starting_semester: number;
  program_code: string;
  transferred_courses: string;
  entry_semester: number;
  system_assigned_entry_semester: number;
  final_entry_semester: number;
  entry_semester_assignment_note: string | null;
  entry_semester_override_reason?: string | null;
  is_new_student: boolean;
  has_error: boolean;
  error_reason: string;
  has_academic_plan?: boolean;
  academic_plan_lock_reason?: string | null;
}

interface IntakeProcessingResult {
  summary: {
    total_records: number;
    successful: number;
    failed: number;
    registered_with_errors: number;
    locked_existing_plans?: number;
    new_students: number;
    updated_students: number;
  };
  processed_students: ProcessedStudent[];
  failed_records: Array<{
    row: number;
    matric_no: string | null;
    student_id: number | null;
    reason: string;
  }>;
  error_registered_records: Array<{
    row: number;
    matric_no: string | null;
    student_id: number | null;
    reason: string;
  }>;
}

interface AcademicPlanGenerationResult {
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
  intake: {
    id: number;
    intake_year: string;
    intake_name: string;
    intake_type: string;
    reused_existing_intake: boolean;
  };
}

const processingResult = ref<IntakeProcessingResult | null>(null);

const generationResult = ref<AcademicPlanGenerationResult | null>(null);

const reviewRows = ref<ProcessedStudent[]>([]);

interface ConfigData {
  programId: number;
  intakes: string[];
  ruleSets: Array<{
    intake_type: string;
    rule_count: number;
    min_credit: number;
    max_credit: number;
    is_valid: boolean;
    validation_message: string | null;
  }>;
  current_session: CurrentSession | null;
  auto_assignment: {
    intake_year: string;
    semester_rule: {
      status: "resolved" | "ambiguous" | "missing";
      value: {
        intake_type: string;
      } | null;
      reason: string;
      candidates: Array<{
        intake_type: string;
      }>;
    };
    program_session: {
      status: "resolved" | "ambiguous" | "missing";
      value: {
        id: number;
        session_name: string;
        intake_year: string;
        is_active: boolean;
        resolution_source: "exact_intake" | "active_session";
      } | null;
      reason: string;
      candidates: Array<{
        id: number;
        session_name: string;
        intake_year: string;
        is_active: boolean;
        resolution_source: "exact_intake" | "active_session";
      }>;
    };
  } | null;
}

interface RuleData {
  id: number;
  credit_transfer?: number | null;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  reference_note: string | null;
  journey_summary: string;
  journey_slots: Array<{
    slot_order: number;
    semester_type: "L" | "S";
    slot_role: "regular" | "fyp1" | "fyp2" | "li";
  }>;
}

const getRepresentativeCredit = (
  rule: Pick<RuleData, "transfer_min" | "transfer_max"> & {
    credit_transfer?: number | null;
  },
) => {
  const representativeCredit = Number(rule.credit_transfer);

  if (Number.isFinite(representativeCredit) && representativeCredit >= 0) {
    return representativeCredit;
  }

  return Math.max(Number(rule.transfer_min) || 0, 0);
};

const getRepresentativeCreditLabel = (
  rule: Pick<RuleData, "transfer_min" | "transfer_max"> & {
    credit_transfer?: number | null;
  },
) => `${getRepresentativeCredit(rule)} Cr`;

const getCoverageRangeLabel = (rule: Pick<RuleData, "transfer_min" | "transfer_max">) =>
  Number(rule.transfer_min) === Number(rule.transfer_max)
    ? `${rule.transfer_min} Cr`
    : `${rule.transfer_min}-${rule.transfer_max} Cr`;

const getJourneySummaryLabel = (rule: RuleData) =>
  rule.journey_summary ||
  `${rule.journey_slots?.length || 0} configured slot${(rule.journey_slots?.length || 0) === 1 ? "" : "s"}`;

interface CurrentSession {
  active_intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data: sessionData } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

watchEffect(() => {
  if (sessionData.value?.current_session && !selectedIntake.value) {
    selectedIntake.value =
      sessionData.value.current_session.active_intake_period;
  }
});

const { data: configData, pending: configPending } = await useFetch<ConfigData>(
  "/api/hop/intake-assessment/config",
);

const autoAssignedRuleSet = computed(
  () => configData.value?.auto_assignment?.semester_rule.value ?? null,
);

const autoAssignedProgramSession = computed(
  () => configData.value?.auto_assignment?.program_session.value ?? null,
);

watchEffect(() => {
  const currentIntake = sessionData.value?.current_session?.active_intake_period;
  if (
    currentIntake &&
    selectedIntake.value === currentIntake &&
    !selectedRuleSet.value &&
    autoAssignedRuleSet.value?.intake_type
  ) {
    selectedRuleSet.value = autoAssignedRuleSet.value.intake_type;
  }
});

const effectiveRuleSetSelection = computed(
  () => selectedRuleSet.value || autoAssignedRuleSet.value?.intake_type || "",
);

const rulesQuery = computed(() => ({
  intake_type: effectiveRuleSetSelection.value || undefined,
}));

const { data: rulesData } = await useFetch<RuleData[]>(
  "/api/hop/intake-assessment/rules",
  {
    query: rulesQuery,
    watch: [effectiveRuleSetSelection],
    immediate: false,
  },
);

const selectedRuleSetConfig = computed(
  () =>
    configData.value?.ruleSets.find(
      (ruleSet) => ruleSet.intake_type === effectiveRuleSetSelection.value,
    ) ?? null,
);

const isValidIntakeFormat = (value: string): boolean => {
  if (!value || value.length !== 4) return false;
  const month = parseInt(value.substring(0, 2), 10);
  const year = parseInt(value.substring(2, 4), 10);
  return !Number.isNaN(month) && !Number.isNaN(year) && month >= 1 && month <= 12;
};

const intakeValidation = computed(() => {
  if (!intakeInputTouched.value || !selectedIntake.value) {
    return { valid: false, message: "" };
  }
  if (!isValidIntakeFormat(selectedIntake.value)) {
    return {
      valid: false,
      message: "Invalid format. Use MMYY, for example 0526 for May 2026.",
    };
  }
  return { valid: true, message: "" };
});

const canProceedToStep2 = computed(
  () =>
    !!sessionData.value?.current_session &&
    !!selectedIntake.value &&
    isValidIntakeFormat(selectedIntake.value) &&
    !!effectiveRuleSetSelection.value &&
    selectedRuleSetConfig.value?.is_valid !== false,
);

const canProceedToStep3 = computed(() => !!selectedFile.value);

const sessionLabel = computed(() => {
  if (!sessionData.value?.current_session) return "";
  return sessionData.value.current_session.semester_type === "L"
    ? "Long Semester"
    : "Short Semester";
});

const canExport = computed(
  () =>
    processingResult.value &&
    processingResult.value.processed_students.length > 0,
);

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
    showToast("Please select a valid Excel file (.xlsx or .xls)", "error");
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

const initializeReviewRows = (students: ProcessedStudent[]) => {
  reviewRows.value = students;
};

const processFile = async () => {
  if (
    !selectedFile.value ||
    !selectedIntake.value ||
    !effectiveRuleSetSelection.value
  ) {
    return;
  }

  isProcessing.value = true;
  processingResult.value = null;
  generationResult.value = null;
  reviewRows.value = [];

  try {
    const formData = new FormData();
    formData.append("file", selectedFile.value);
    formData.append("intake", selectedIntake.value);
    formData.append("intake_type", effectiveRuleSetSelection.value);

    const response = await $fetch("/api/hop/intake-assessment/process", {
      method: "POST",
      body: formData,
    });

    const nextProcessingResult = response as IntakeProcessingResult;
    processingResult.value = nextProcessingResult;
    initializeReviewRows(nextProcessingResult.processed_students);
    currentStep.value = 4;
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Processing failed",
      "error",
    );
  } finally {
    isProcessing.value = false;
  }
};

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

    const blob = new Blob([response as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `intake_results_${selectedIntake.value}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    showToast(error.data?.message || error.message || "Export failed", "error");
  }
};

const exportTemplate = async () => {
  if (!selectedIntake.value || isExportingTemplate.value) return;

  isExportingTemplate.value = true;

  try {
    const response = await $fetch("/api/hop/intake-assessment/export-template", {
      method: "POST",
      body: {
        intake_year: selectedIntake.value,
      },
      responseType: "blob",
    });

    const blob = new Blob([response as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `intake_assessment_template_${selectedIntake.value}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    showToast(
      error.data?.message ||
        error.message ||
        "Failed to export Student Entry Assessment template",
      "error",
    );
  } finally {
    isExportingTemplate.value = false;
  }
};

const goToStep = (step: number) => {
  if (step < currentStep.value && step >= 1) {
    currentStep.value = step;
  }
};

const nextStep = () => {
  if (currentStep.value === 1 && canProceedToStep2.value) {
    currentStep.value = 2;
  } else if (currentStep.value === 2 && canProceedToStep3.value) {
    currentStep.value = 3;
  }
};

const prevStep = () => {
  if (currentStep.value > 1 && currentStep.value <= 3) {
    currentStep.value -= 1;
  }
};

const resetProcess = () => {
  currentStep.value = 1;
  selectedIntake.value =
    sessionData.value?.current_session?.active_intake_period || "";
  selectedRuleSet.value = "";
  selectedFile.value = null;
  processingResult.value = null;
  generationResult.value = null;
  reviewRows.value = [];
  processedSearchQuery.value = "";
  processedStatusFilter.value = "";
  if (fileInput.value) {
    fileInput.value.value = "";
  }
};

const getReviewStatus = (row: ProcessedStudent) => {
  if (row.has_academic_plan) {
    return {
      key: "locked",
      label: "Locked",
      badgeClass: "badge-info",
    };
  }

  if (row.has_error) {
    return {
      key: "errors",
      label: "Needs Fix",
      badgeClass: "badge-error",
    };
  }

  if (row.is_new_student) {
    return {
      key: "new",
      label: "Pre-registered",
      badgeClass: "badge-warning",
    };
  }

  return {
    key: "ready",
    label: "Ready",
    badgeClass: "badge-success",
  };
};

const filteredReviewRows = computed(() => {
  let rows = [...reviewRows.value];

  if (processedStatusFilter.value) {
    rows = rows.filter(
      (row) => getReviewStatus(row).key === processedStatusFilter.value,
    );
  }

  if (processedSearchQuery.value) {
    const query = processedSearchQuery.value.toLowerCase();
    rows = rows.filter(
      (row) =>
        row.matric_no.toLowerCase().includes(query) ||
        row.program_code.toLowerCase().includes(query),
    );
  }

  return rows;
});

const generatePlans = async () => {
  isGeneratingPlans.value = true;
  generationResult.value = null;

  try {
    const response = await $fetch("/api/hop/intake-assessment/generate", {
      method: "POST",
      body: {
        intake_year: selectedIntake.value,
        intake_type: effectiveRuleSetSelection.value || undefined,
      },
    });

    generationResult.value = response as AcademicPlanGenerationResult;
    currentStep.value = 5;
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to generate academic plans",
      "error",
    );
  } finally {
    isGeneratingPlans.value = false;
  }
};

const summaryBadges = computed(() => {
  if (!processingResult.value) return [];
  return [
    {
      label: "Processed",
      value: processingResult.value.summary.successful,
      tone: "text-success",
    },
    {
      label: "Pre-registered With Errors",
      value: processingResult.value.summary.registered_with_errors,
      tone: "text-warning",
    },
    {
      label: "Locked",
      value: processingResult.value.summary.locked_existing_plans || 0,
      tone: "text-info",
    },
    {
      label: "Failed",
      value: processingResult.value.summary.failed,
      tone: "text-error",
    },
  ];
});

const manualSteps = [
  {
    text: "Step 1: Set the intake and choose the starting-semester table.",
    note: "The selected table maps transferred credits to the student's starting semester and journey.",
  },
  {
    text: "Step 2: Upload the intake file for processing.",
  },
  {
    text: "Step 3: Review the assigned semester entries for the intake.",
  },
  {
    text: "Step 4: Generate academic plans directly from the reviewed intake data. No second upload is needed.",
  },
  {
    text: "Step 5: Open the academic planning batch to continue with student scheduling.",
  },
];
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 w-full max-w-[1400px] mx-auto flex flex-col space-y-8 h-full relative">
    <div class="absolute -top-10 -left-10 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>
    <div class="absolute top-40 -right-10 w-64 h-64 bg-secondary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>

    <div v-if="toast.show" class="toast toast-top toast-end z-50">
      <div
        class="alert shadow-xl border"
        :class="{
          'alert-info border-info/20 text-info-content bg-info/10': toast.type === 'info',
          'alert-success border-success/20 text-success-content bg-success/10': toast.type === 'success',
          'alert-warning border-warning/20 text-warning-content bg-warning/10': toast.type === 'warning',
          'alert-error border-error/20 text-error-content bg-error/10': toast.type === 'error',
        }"
      >
        <span class="font-bold">{{ toast.message }}</span>
      </div>
    </div>

    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 relative z-10">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
            Student Entry <span class="text-primary">Assessment</span>
          </h1>
          <UserManualButton title="Student Entry Assessment" :steps="manualSteps" />
        </div>
        <p class="text-base-content/60 font-medium max-w-3xl">
          Set the intake, review semester entries, and generate academic plans in one guided flow.
        </p>
      </div>
    </div>

    <div class="max-w-5xl mx-auto w-full card bg-base-100 border border-base-200 shadow-sm">
      <div class="card-body gap-5">
        <div>
          <h2 class="font-bold text-base">How It Works</h2>
          <p class="text-sm text-base-content/60">
            Set the intake, upload the file once, review the semester entries, then generate plans.
          </p>
        </div>
        <div class="grid gap-4 md:grid-cols-4 text-sm">
          <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-primary">Step 1</div>
            <div class="font-semibold mt-2">Set intake</div>
            <p class="text-base-content/65 mt-1">Choose the intake and starting-semester table.</p>
          </div>
          <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-primary">Step 2</div>
            <div class="font-semibold mt-2">Upload file</div>
            <p class="text-base-content/65 mt-1">Upload the intake file once for the full flow.</p>
          </div>
          <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-primary">Step 3</div>
            <div class="font-semibold mt-2">Review entries</div>
            <p class="text-base-content/65 mt-1">Check the semester entries before generation.</p>
          </div>
          <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-primary">Step 4</div>
            <div class="font-semibold mt-2">Generate plans</div>
            <p class="text-base-content/65 mt-1">Create or reuse the academic planning batch directly.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="w-full max-w-5xl mx-auto">
      <ul class="steps steps-vertical md:steps-horizontal w-full">
        <li class="step" :class="{ 'step-primary': currentStep >= 1 }" @click="goToStep(1)">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase">Setup</span>
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 2 }" @click="canProceedToStep2 ? goToStep(2) : null">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase">Upload</span>
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 3 }" @click="canProceedToStep3 ? goToStep(3) : null">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase">Process</span>
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 4 }">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase">Review</span>
        </li>
        <li class="step" :class="{ 'step-primary': currentStep >= 5 }">
          <span class="text-xs font-bold tracking-wide mt-2 uppercase">Generate</span>
        </li>
      </ul>
    </div>

    <div v-if="configPending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <div v-else :class="[currentStep >= 4 ? 'w-full' : 'max-w-5xl mx-auto']" class="transition-all duration-300">
      <div v-if="currentStep === 1" class="card bg-base-100 border border-base-200 shadow-xl">
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5 8.25 7.5m0 0 3 3m-3-3h7.5m-7.5 9 3-3m-3 3 3 3m-3-3h7.5" />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Review Intake Setup</h2>
              <p class="text-sm text-base-content/60">
                The system will auto-match the intake rule set and program structure from the current session whenever it can.
              </p>
            </div>
          </div>

          <div v-if="sessionData?.current_session" class="alert alert-info shadow-sm">
            <div>
              <span class="font-semibold">Current Session:</span>
              {{ formatIntake(sessionData.current_session.active_intake_period) }} ·
              {{ sessionLabel }}
            </div>
          </div>
          <div v-else class="alert alert-warning shadow-sm">
            <span>
              Current session is not set. Please configure it in
              <NuxtLink to="/dashboard/hop" class="link link-primary font-medium">Settings</NuxtLink>
              before continuing.
            </span>
          </div>

          <div class="grid gap-6 md:grid-cols-2">
            <div class="form-control min-w-0">
              <label class="label pl-0">
                <span class="label-text font-semibold">Student Intake</span>
              </label>
              <input
                v-model="selectedIntake"
                type="text"
                maxlength="4"
                placeholder="MMYY"
                class="input input-bordered w-full"
                @blur="intakeInputTouched = true"
              />
              <label class="label pl-0 items-start justify-start flex-wrap">
                <span
                  class="label-text-alt block w-full whitespace-normal break-words leading-5"
                  :class="intakeValidation.message ? 'text-error' : 'text-base-content/50'"
                >
                  {{ intakeValidation.message || "Use MMYY, for example 0526 for May 2026." }}
                </span>
              </label>
            </div>

            <div class="form-control min-w-0">
              <label class="label pl-0">
                <span class="label-text font-semibold">Starting Semester Table</span>
              </label>
              <select v-model="selectedRuleSet" class="select select-bordered w-full">
                <option value="">
                  {{
                    autoAssignedRuleSet?.intake_type
                      ? "Auto-matched from current session"
                      : "Choose one table..."
                  }}
                </option>
                <option
                  v-for="ruleSet in configData?.ruleSets || []"
                  :key="ruleSet.intake_type"
                  :value="ruleSet.intake_type"
                >
                  {{ ruleSet.intake_type }}
                </option>
              </select>
              <label class="label pl-0 items-start justify-start flex-wrap">
                <span
                  class="label-text-alt block w-full whitespace-normal break-words leading-5"
                  :class="selectedRuleSetConfig?.is_valid === false ? 'text-error' : 'text-base-content/50'"
                >
                  {{ selectedRuleSetConfig?.validation_message || "This table maps transferred credits to a starting semester and journey." }}
                </span>
              </label>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">
                Auto-Matched Rule Set
              </div>
              <div class="font-semibold mt-2">
                {{ autoAssignedRuleSet?.intake_type || "Manual selection required" }}
              </div>
              <div class="text-sm text-base-content/60 mt-1">
                {{ configData?.auto_assignment?.semester_rule.reason || "No automatic rule match available yet." }}
              </div>
            </div>

            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">
                Auto-Matched Program Structure
              </div>
              <div class="font-semibold mt-2">
                {{ autoAssignedProgramSession?.session_name || "Manual follow-up required" }}
              </div>
              <div class="text-sm text-base-content/60 mt-1">
                {{ configData?.auto_assignment?.program_session.reason || "No automatic program-structure match available yet." }}
              </div>
            </div>
          </div>

          <div v-if="rulesData?.length" class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
            <div class="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 class="font-semibold">Starting Semester Guide</h3>
                <p class="text-sm text-base-content/60">
                  Each row shows how transferred credits map to a starting semester and journey.
                </p>
              </div>
              <button class="btn btn-sm btn-outline" :disabled="isExportingTemplate || !selectedIntake" @click="exportTemplate">
                {{ isExportingTemplate ? "Exporting..." : "Export Intake Template" }}
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Band Coverage</th>
                    <th>Student Starts In</th>
                    <th>Configured Journey</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rule in rulesData" :key="rule.id">
                    <td class="font-mono">
                      <div class="font-semibold">{{ getCoverageRangeLabel(rule) }}</div>
                      <div class="text-xs text-base-content/50 font-normal">
                        Representative row: {{ getRepresentativeCreditLabel(rule) }}
                      </div>
                    </td>
                    <td>Semester {{ rule.entry_semester }}</td>
                    <td>{{ getJourneySummaryLabel(rule) }}</td>
                    <td>{{ rule.reference_note || "-" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex justify-end">
            <button class="btn btn-primary" :disabled="!canProceedToStep2" @click="nextStep">
              Next Step
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="currentStep === 2" class="card bg-base-100 border border-base-200 shadow-xl">
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div class="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Upload Student Intake File</h2>
              <p class="text-sm text-base-content/60">
                This file will be used once for both the semester-entry decision and later plan generation.
              </p>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-4 text-sm">
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Intake</div>
              <div class="font-semibold mt-2">{{ formatIntake(selectedIntake) }}</div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Rule Set</div>
              <div class="font-semibold mt-2">{{ effectiveRuleSetSelection }}</div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Program Structure</div>
              <div class="font-semibold mt-2">{{ autoAssignedProgramSession?.session_name || "Resolved during generation" }}</div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Expected Result</div>
              <div class="font-semibold mt-2">Assigned starting semester</div>
            </div>
          </div>

          <div
            class="border-2 border-dashed rounded-xl p-8 transition-colors text-center cursor-pointer relative"
            :class="{
              'border-primary bg-primary/5 shadow-sm': isDragging,
              'border-base-300 hover:border-primary/50 hover:bg-base-200/50': !isDragging,
            }"
            @drop="handleDrop"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @click="triggerFileInput"
          >
            <input ref="fileInput" type="file" accept=".xlsx,.xls" class="hidden" @change="handleFileSelect" />

            <div v-if="!selectedFile" class="space-y-3">
              <div class="text-lg font-bold">Click to upload or drag and drop</div>
              <div class="text-sm text-base-content/60">Excel files (.xlsx or .xls)</div>
            </div>

            <div v-else class="space-y-3">
              <div class="text-lg font-bold truncate" :title="selectedFile.name">
                {{ selectedFile.name }}
              </div>
              <div class="text-sm text-base-content/60">
                {{ (selectedFile.size / 1024).toFixed(2) }} KB
              </div>
              <button class="btn btn-xs btn-ghost text-error" @click.stop="removeFile">
                Remove File
              </button>
            </div>
          </div>

          <div class="alert alert-info shadow-sm">
            <span>
              The intake file should contain the transfer columns used in the intake template. Valid transferred courses will be saved for plan generation.
            </span>
          </div>

          <div class="flex justify-between">
            <button class="btn btn-ghost" @click="prevStep">Back</button>
            <button class="btn btn-primary" :disabled="!canProceedToStep3" @click="nextStep">
              Next Step
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="currentStep === 3" class="card bg-base-100 border border-base-200 shadow-xl">
        <div class="card-body space-y-6">
          <div class="flex items-center gap-4 border-b border-base-200 pb-4">
            <div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m6 2.25a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <h2 class="card-title text-xl">Assign Starting Semesters</h2>
              <p class="text-sm text-base-content/60">
                The system will match transferred credits to the selected table, save the intake result, and prepare the review screen.
              </p>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-4 text-sm">
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Intake</div>
              <div class="font-semibold mt-2">{{ formatIntake(selectedIntake) }}</div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Rule Set</div>
              <div class="font-semibold mt-2">{{ effectiveRuleSetSelection }}</div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">File</div>
              <div class="font-semibold mt-2 truncate" :title="selectedFile?.name">
                {{ selectedFile?.name }}
              </div>
            </div>
            <div class="rounded-xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs font-bold uppercase tracking-wider text-primary">Next Screen</div>
              <div class="font-semibold mt-2">Review and generate</div>
            </div>
          </div>

          <div class="alert alert-warning shadow-sm">
            <span>
              Students who already have academic plans will stay locked in the review step. New or unplanned students can still be reviewed and generated from the same intake flow.
            </span>
          </div>

          <div class="flex justify-between">
            <button class="btn btn-ghost" @click="prevStep">Back</button>
            <button class="btn btn-primary px-8" :disabled="isProcessing" @click="processFile">
              <span v-if="isProcessing" class="loading loading-spinner loading-sm"></span>
              {{ isProcessing ? "Processing..." : "Start Assignment" }}
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="currentStep === 4 && processingResult" class="space-y-6">
        <div class="card bg-base-100 border border-base-300 shadow-sm">
          <div class="card-body space-y-6">
            <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <h2 class="card-title text-lg">Review Semester Entry Results</h2>
                <p class="text-sm text-base-content/60">
                  Review the generated semester entries, then create the academic planning batch.
                </p>
              </div>
              <button class="btn btn-outline gap-2" @click="exportToExcel">
                Export Intake Results
              </button>
            </div>

            <div class="stats shadow w-full">
              <div class="stat">
                <div class="stat-title">Total Records</div>
                <div class="stat-value text-2xl">{{ processingResult.summary.total_records }}</div>
              </div>
              <div v-for="badge in summaryBadges" :key="badge.label" class="stat">
                <div class="stat-title">{{ badge.label }}</div>
                <div class="stat-value text-2xl" :class="badge.tone">{{ badge.value }}</div>
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-[1fr_auto]">
              <div class="flex flex-col sm:flex-row gap-4">
                <input
                  v-model="processedSearchQuery"
                  type="text"
                  placeholder="Search by matric number or program..."
                  class="input input-sm input-bordered w-full sm:max-w-xs"
                />
                <select v-model="processedStatusFilter" class="select select-sm select-bordered w-full sm:max-w-xs">
                  <option value="">All Rows</option>
                  <option value="ready">Ready</option>
                  <option value="locked">Locked</option>
                  <option value="new">Pre-registered</option>
                  <option value="errors">Needs Fix</option>
                </select>
              </div>
              <button
                class="btn btn-primary"
                :class="{ loading: isGeneratingPlans }"
                :disabled="isGeneratingPlans"
                @click="generatePlans"
              >
                Generate Academic Plans
              </button>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 border border-base-300 shadow-sm">
          <div class="card-body">
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full">
                <thead class="bg-base-100 sticky top-0">
                  <tr>
                    <th>Student ID</th>
                    <th class="text-center">Transferred Credits</th>
                    <th class="text-center">Semester Entry</th>
                    <th class="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="student in filteredReviewRows" :key="student.student_id">
                    <td class="font-mono">
                      <div>{{ student.matric_no }}</div>
                      <div class="text-xs text-base-content/50 font-normal mt-1">
                        {{ student.program_code }}
                      </div>
                    </td>
                    <td class="text-center font-medium">{{ student.total_credit_transferred }}</td>
                    <td class="text-center">
                      <span class="badge badge-ghost badge-sm">
                        Semester {{ student.final_entry_semester || student.system_assigned_entry_semester }}
                      </span>
                    </td>
                    <td class="text-center align-top">
                      <span class="badge badge-sm" :class="getReviewStatus(student).badgeClass">
                        {{ getReviewStatus(student).label }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-if="processingResult.failed_records.length > 0" class="card bg-base-100 border border-error/30 shadow-sm">
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
          </div>
        </div>

        <div v-if="processingResult.error_registered_records && processingResult.error_registered_records.length > 0" class="card bg-base-100 border border-warning/40 shadow-sm">
          <div class="card-body">
            <h3 class="font-medium mb-1 text-warning">
              Pre-registered With Errors ({{ processingResult.error_registered_records.length }})
            </h3>
            <p class="text-xs text-base-content/60 mb-4">
              These students were still reserved in the system, but their transferred-course data was not fully usable.
            </p>
            <div class="overflow-x-auto max-h-64">
              <table class="table table-sm w-full">
                <thead class="sticky top-0 bg-base-100">
                  <tr>
                    <th>Row</th>
                    <th>Student ID</th>
                    <th>Reason / Action Taken</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(record, index) in processingResult.error_registered_records"
                    :key="index"
                    class="text-warning/90"
                  >
                    <td>{{ record.row }}</td>
                    <td class="font-mono">{{ record.matric_no || "-" }}</td>
                    <td class="text-xs">{{ record.reason }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="flex justify-between">
          <button class="btn btn-ghost" @click="resetProcess">Process Another Intake</button>
          <NuxtLink to="/dashboard/hop/students" class="btn btn-outline">View Students</NuxtLink>
        </div>
      </div>

      <div v-else-if="currentStep === 5 && generationResult" class="space-y-6">
        <div class="card bg-base-100 border border-base-300 shadow-sm">
          <div class="card-body space-y-6">
            <div>
              <h2 class="card-title text-lg">Academic Planning Generated</h2>
              <p class="text-sm text-base-content/60">
                The reviewed intake data has been handed off into Academic Planning.
              </p>
            </div>

            <div class="stats shadow w-full">
              <div class="stat">
                <div class="stat-title">Processed For Generation</div>
                <div class="stat-value text-2xl">{{ generationResult.summary.total_processed }}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Successful Plans</div>
                <div class="stat-value text-2xl text-success">{{ generationResult.summary.successful }}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Skipped Existing</div>
                <div class="stat-value text-2xl text-info">{{ generationResult.summary.skipped_existing }}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Failed</div>
                <div class="stat-value text-2xl text-error">{{ generationResult.summary.failed }}</div>
              </div>
            </div>

            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4 text-sm">
              <div class="font-semibold">{{ generationResult.intake.intake_name }}</div>
              <div class="text-base-content/60 mt-1">
                {{ formatIntake(generationResult.intake.intake_year) }} ·
                {{ generationResult.intake.intake_type }}
              </div>
              <div v-if="generationResult.intake.reused_existing_intake" class="text-info mt-2">
                Existing academic planning batch reused for this intake year.
              </div>
              <div v-else class="text-success mt-2">
                New academic planning batch created from the reviewed intake data.
              </div>
            </div>

            <div v-if="generationResult.failed_students.length > 0" class="rounded-2xl border border-error/30 bg-error/5 p-4">
              <h3 class="font-semibold text-error mb-3">
                Failed Students ({{ generationResult.failed_students.length }})
              </h3>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="student in generationResult.failed_students" :key="student.student_id">
                      <td class="font-mono">{{ student.matric_no }}</td>
                      <td>{{ student.reason }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="flex flex-col sm:flex-row gap-3 sm:justify-between">
              <button class="btn btn-ghost" @click="resetProcess">
                Start Another Intake Flow
              </button>
              <div class="flex flex-col sm:flex-row gap-3">
                <NuxtLink to="/dashboard/hop/academic-planning" class="btn btn-outline">
                  Open Academic Planning
                </NuxtLink>
                <NuxtLink :to="`/dashboard/hop/academic-planning/${generationResult.intake.id}`" class="btn btn-primary">
                  Open This Batch
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
