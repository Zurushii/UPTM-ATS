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
interface Rule {
  id: number;
  intake_type: string;
  credit_transfer: number;
  entry_semester: number;
}

interface CreditPlan {
  id?: number;
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
}

interface IntakesData {
  rule_intakes: string[];
  student_intakes: string[];
}

// State
const selectedIntakeType = ref<string>("");
const isAddModalOpen = ref(false);
const isEditModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const isCreditPlanModalOpen = ref(false);
const isImportModalOpen = ref(false);
const editingRule = ref<Rule | null>(null);
const deletingRule = ref<Rule | null>(null);
const creditPlanRule = ref<Rule | null>(null);
const isSubmitting = ref(false);
const isLoadingCreditPlans = ref(false);
const isImporting = ref(false);
const importFile = ref<File | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const importResult = ref<{ total_rules_parsed: number; rules_inserted: number; credit_plans_inserted: number } | null>(null);
const isDeleteIntakeModalOpen = ref(false);
const deletingIntakeType = ref<string | null>(null);
const collapsedIntakes = ref<Set<string>>(new Set());
const isDragging = ref(false);

const handleDrop = (event: DragEvent) => {
  isDragging.value = false;
  if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
    const file = event.dataTransfer.files[0];
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      importFile.value = file;
    } else {
      alert("Please upload a valid Excel file (.xlsx or .xls)");
    }
  }
};

const toggleIntake = (intake: string) => {
  if (collapsedIntakes.value.has(intake)) {
    collapsedIntakes.value.delete(intake);
  } else {
    collapsedIntakes.value.add(intake);
  }
};

// Form state for add/edit rule
const formData = ref({
  intake_type: "",
  credit_transfer: 0,
  entry_semester: 2,
});

// Credit plan form state
const creditPlans = ref<CreditPlan[]>([]);

// Fetch intakes data
const { data: intakesData, refresh: refreshIntakes } =
  await useFetch<IntakesData>("/api/hop/semester-rules/intakes");

// Fetch rules based on selected intake type
const rulesQuery = computed(() => ({
  intake_type: selectedIntakeType.value || undefined,
}));

const {
  data: rules,
  pending: rulesPending,
  refresh: refreshRules,
} = await useFetch<Rule[]>("/api/hop/semester-rules", {
  query: rulesQuery,
});

// Computed: all available intake types (from rules)
const allIntakeTypes = computed(() => {
  return intakesData.value?.rule_intakes || [];
});

// Computed: group rules by intake type
const rulesByIntakeType = computed(() => {
  if (!rules.value) return {};
  const grouped: Record<string, Rule[]> = {};
  for (const rule of rules.value) {
    if (!grouped[rule.intake_type]) {
      grouped[rule.intake_type] = [];
    }
    grouped[rule.intake_type]!.push(rule);
  }
  // Sort rules within each intake type by credit_transfer (descending)
  for (const intakeType in grouped) {
    grouped[intakeType]!.sort((a, b) => b.credit_transfer - a.credit_transfer);
  }
  return grouped;
});

// Fetch program credit limits from DB
const { data: creditLimitsData, refresh: refreshCreditLimits } = await useFetch<{
  long_min: number;
  long_max: number;
  short_min: number;
  short_max: number;
}>('/api/hop/program/credit-limits');

// Editable credit limits state
const isEditingCreditLimits = ref(false);
const isSavingCreditLimits = ref(false);
const creditLimitsForm = ref({
  long_min: 12,
  long_max: 20,
  short_min: 6,
  short_max: 10,
});

// Dynamic credit rules (replaces hardcoded CREDIT_RULES)
const CREDIT_RULES = computed(() => ({
  L: {
    min: creditLimitsData.value?.long_min ?? 12,
    max: creditLimitsData.value?.long_max ?? 20,
    label: 'Long Semester',
  },
  S: {
    min: creditLimitsData.value?.short_min ?? 6,
    max: creditLimitsData.value?.short_max ?? 10,
    label: 'Short Semester',
  },
}));

const startEditCreditLimits = () => {
  creditLimitsForm.value = {
    long_min: creditLimitsData.value?.long_min ?? 12,
    long_max: creditLimitsData.value?.long_max ?? 20,
    short_min: creditLimitsData.value?.short_min ?? 6,
    short_max: creditLimitsData.value?.short_max ?? 10,
  };
  isEditingCreditLimits.value = true;
};

const cancelEditCreditLimits = () => {
  isEditingCreditLimits.value = false;
};

const saveCreditLimits = async () => {
  if (isSavingCreditLimits.value) return;

  const { long_min, long_max, short_min, short_max } = creditLimitsForm.value;
  if (long_min > long_max) {
    alert('Long semester minimum cannot exceed maximum.');
    return;
  }
  if (short_min > short_max) {
    alert('Short semester minimum cannot exceed maximum.');
    return;
  }

  isSavingCreditLimits.value = true;
  try {
    await $fetch('/api/hop/program/credit-limits', {
      method: 'PUT',
      body: creditLimitsForm.value,
    });
    await refreshCreditLimits();
    isEditingCreditLimits.value = false;
  } catch (error: any) {
    alert(error.data?.message || error.message || 'Failed to save credit limits');
  } finally {
    isSavingCreditLimits.value = false;
  }
};

// Computed: total credits in credit plan
const totalPlanCredits = computed(() => {
  return creditPlans.value.reduce((sum, plan) => sum + plan.target_credits, 0);
});

// Computed: validation errors for each credit plan entry
const creditPlanErrors = computed(() => {
  return creditPlans.value.map((plan) => {
    if (plan.target_credits === 0) return null; // Skip validation for empty/zero entries
    if (plan.is_li) return null; // Industrial Training (LI) bypasses credit hour rules
    const rule = CREDIT_RULES.value[plan.semester_type];
    if (plan.target_credits < rule.min) {
      return `${rule.label} requires at least ${rule.min} credit hours (currently ${plan.target_credits})`;
    }
    if (plan.target_credits > rule.max) {
      return `${rule.label} cannot exceed ${rule.max} credit hours (currently ${plan.target_credits})`;
    }
    return null;
  });
});

// Computed: whether there are any credit plan validation errors
const hasCreditPlanErrors = computed(() => {
  return creditPlanErrors.value.some((err) => err !== null);
});

// Open add modal
const openAddModal = (intakeType?: string) => {
  formData.value = {
    intake_type: intakeType || "",
    credit_transfer: 0,
    entry_semester: 2,
  };
  isAddModalOpen.value = true;
};

// Open edit modal
const openEditModal = (rule: Rule) => {
  editingRule.value = rule;
  formData.value = {
    intake_type: rule.intake_type,
    credit_transfer: rule.credit_transfer,
    entry_semester: rule.entry_semester,
  };
  isEditModalOpen.value = true;
};

// Open delete confirmation
const openDeleteModal = (rule: Rule) => {
  deletingRule.value = rule;
  isDeleteModalOpen.value = true;
};

// Open credit plan modal
const openCreditPlanModal = async (rule: Rule) => {
  creditPlanRule.value = rule;
  isLoadingCreditPlans.value = true;
  isCreditPlanModalOpen.value = true;

  try {
    const plans = await $fetch<CreditPlan[]>(
      `/api/hop/semester-rules/${rule.id}/credit-plans`,
    );
    
    if (plans.length > 0) {
      creditPlans.value = plans.map((p: any) => ({ ...p, is_li: !!p.is_li }));
    } else {
      // Initialize with default semesters starting from entry semester
      creditPlans.value = [];
      for (let sem = rule.entry_semester; sem <= 9; sem++) {
        creditPlans.value.push({
          semester_number: sem,
          semester_type: sem === 6 || sem === 8 || sem === 9 ? "S" : "L",
            is_li: false,
          target_credits: 0,
        });
      }
    }
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to load credit plans");
    isCreditPlanModalOpen.value = false;
  } finally {
    isLoadingCreditPlans.value = false;
  }
};

// Close all modals
const closeModals = () => {
  isAddModalOpen.value = false;
  isEditModalOpen.value = false;
  isDeleteModalOpen.value = false;
  isCreditPlanModalOpen.value = false;
  isDeleteIntakeModalOpen.value = false;
  editingRule.value = null;
  deletingRule.value = null;
  deletingIntakeType.value = null;
  creditPlanRule.value = null;
  creditPlans.value = [];
};

// Add semester to credit plan
const addSemesterToPlan = () => {
  const maxSem = creditPlans.value.reduce((max, p) => Math.max(max, p.semester_number), 0);
  creditPlans.value.push({
    semester_number: maxSem + 1,
    semester_type: "L",
    is_li: false,
    target_credits: 0,
  });
};

// Remove semester from credit plan
const removeSemesterFromPlan = (index: number) => {
  creditPlans.value.splice(index, 1);
};

// Add new rule
const addRule = async () => {
  if (isSubmitting.value) return;

  // Validation
  if (!formData.value.intake_type || formData.value.intake_type.trim().length === 0) {
    alert("Please enter an intake type name");
    return;
  }

  if (formData.value.credit_transfer < 0) {
    alert("Credit transfer must be a non-negative number");
    return;
  }

  isSubmitting.value = true;

  try {
    await $fetch("/api/hop/semester-rules", {
      method: "POST",
      body: {
        intake_type: formData.value.intake_type.trim(),
        credit_transfer: formData.value.credit_transfer,
        entry_semester: formData.value.entry_semester,
      },
    });

    closeModals();
    await refreshRules();
    await refreshIntakes();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to add rule");
  } finally {
    isSubmitting.value = false;
  }
};

// Update rule
const updateRule = async () => {
  if (isSubmitting.value || !editingRule.value) return;

  if (formData.value.credit_transfer < 0) {
    alert("Credit transfer must be a non-negative number");
    return;
  }

  isSubmitting.value = true;

  try {
    await $fetch(`/api/hop/semester-rules/${editingRule.value.id}`, {
      method: "PUT",
      body: {
        credit_transfer: formData.value.credit_transfer,
        entry_semester: formData.value.entry_semester,
      },
    });

    closeModals();
    await refreshRules();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to update rule");
  } finally {
    isSubmitting.value = false;
  }
};

// Delete rule
const deleteRule = async () => {
  if (isSubmitting.value || !deletingRule.value) return;

  isSubmitting.value = true;

  try {
    await $fetch(`/api/hop/semester-rules/${deletingRule.value.id}`, {
      method: "DELETE",
    });

    closeModals();
    await refreshRules();
    await refreshIntakes();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to delete rule");
  } finally {
    isSubmitting.value = false;
  }
};

// Open delete intake modal
const openDeleteIntakeModal = (intakeType: string) => {
  deletingIntakeType.value = intakeType;
  isDeleteIntakeModalOpen.value = true;
};

// Delete all rules for intake type
const deleteIntakeRules = async () => {
  if (isSubmitting.value || !deletingIntakeType.value) return;

  isSubmitting.value = true;

  try {
    await $fetch(`/api/hop/semester-rules/delete-intake`, {
      method: "DELETE",
      query: { intake_type: deletingIntakeType.value },
    });

    closeModals();
    await refreshRules();
    await refreshIntakes();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to delete intake rules");
  } finally {
    isSubmitting.value = false;
  }
};

// Save credit plans
const saveCreditPlans = async () => {
  if (isSubmitting.value || !creditPlanRule.value) return;

  // Validate credit hour rules before saving
  if (hasCreditPlanErrors.value) {
    const lr = CREDIT_RULES.value.L;
    const sr = CREDIT_RULES.value.S;
    alert(`Please fix the credit hour violations before saving.\n\nRules:\n- Long Semester: min ${lr.min}, max ${lr.max} credit hours\n- Short Semester: min ${sr.min}, max ${sr.max} credit hours`);
    return;
  }

  isSubmitting.value = true;

  try {
    await $fetch(`/api/hop/semester-rules/${creditPlanRule.value.id}/credit-plans`, {
      method: "POST",
      body: {
        plans: creditPlans.value.filter((p) => p.target_credits > 0),
      },
    });

    closeModals();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to save credit plans");
  } finally {
    isSubmitting.value = false;
  }
};

// Get semester label
const getSemesterLabel = (sem: number) => {
  const labels: Record<number, string> = {
    6: "FYP1",
    7: "FYP2",
    8: "LI",
  };
  return labels[sem] ? `Sem ${sem} (${labels[sem]})` : `Sem ${sem}`;
};

// Open import modal
const openImportModal = () => {
  importFile.value = null;
  importResult.value = null;
  isImportModalOpen.value = true;
};

// Handle import file select
const handleImportFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    importFile.value = target.files[0];
  }
};

// Import rules from Excel
const importRules = async () => {
  if (isImporting.value || !importFile.value) return;

  isImporting.value = true;
  importResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", importFile.value);

    const response = await $fetch("/api/hop/semester-rules/import", {
      method: "POST",
      body: formData,
    });

    importResult.value = (response as any).summary;
    await refreshRules();
    await refreshIntakes();
  } catch (error: any) {
    alert(error.data?.message || error.message || "Failed to import rules");
  } finally {
    isImporting.value = false;
  }
};

// Close import modal
const closeImportModal = () => {
  isImportModalOpen.value = false;
  importFile.value = null;
  importResult.value = null;
  if (importFileInput.value) {
    importFileInput.value.value = "";
  }
};
</script>

<template>
  <div class="p-6 w-full space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-3xl font-bold">Semester Entry Rules</h1>
        <p class="text-base text-base-content/70">
          Define how transferred credits determine a student's starting semester.
        </p>
      </div>
      
      <div class="flex items-center gap-3">
        <button class="btn btn-primary shadow-lg shadow-primary/20 gap-2" @click="openAddModal()">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add New Rule
        </button>
      </div>
    </div>

    <!-- Credit Hour Settings Card -->
    <div class="card bg-base-100 shadow-xl border border-base-200 overflow-hidden">
      <div class="p-4 flex items-center justify-between border-b border-base-200">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-info/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-info">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          </div>
          <div>
            <h2 class="font-bold text-sm">Credit Hour Limits</h2>
            <p class="text-xs text-base-content/50">Min/max credit hours per semester type</p>
          </div>
        </div>
        <button
          v-if="!isEditingCreditLimits"
          class="btn btn-sm btn-ghost gap-1"
          @click="startEditCreditLimits"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
          Edit
        </button>
      </div>

      <!-- View Mode -->
      <div v-if="!isEditingCreditLimits" class="p-4">
        <div class="grid grid-cols-2 gap-4">
          <div class="flex items-center gap-3 p-3 bg-base-200/50 rounded-lg">
            <div class="badge badge-primary badge-outline">Long</div>
            <div class="text-sm">
              <span class="font-mono font-bold">{{ creditLimitsData?.long_min ?? 12 }}</span>
              <span class="text-base-content/50"> – </span>
              <span class="font-mono font-bold">{{ creditLimitsData?.long_max ?? 20 }}</span>
              <span class="text-xs text-base-content/50 ml-1">credits</span>
            </div>
          </div>
          <div class="flex items-center gap-3 p-3 bg-base-200/50 rounded-lg">
            <div class="badge badge-secondary badge-outline">Short</div>
            <div class="text-sm">
              <span class="font-mono font-bold">{{ creditLimitsData?.short_min ?? 6 }}</span>
              <span class="text-base-content/50"> – </span>
              <span class="font-mono font-bold">{{ creditLimitsData?.short_max ?? 10 }}</span>
              <span class="text-xs text-base-content/50 ml-1">credits</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-else class="p-4 space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <!-- Long Semester -->
          <div class="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
            <div class="badge badge-primary badge-sm">Long Semester</div>
            <div class="grid grid-cols-2 gap-3">
              <div class="form-control">
                <label class="label py-0 pl-0"><span class="label-text text-xs">Min</span></label>
                <input
                  v-model.number="creditLimitsForm.long_min"
                  type="number"
                  min="0"
                  class="input input-bordered input-sm w-full font-mono"
                />
              </div>
              <div class="form-control">
                <label class="label py-0 pl-0"><span class="label-text text-xs">Max</span></label>
                <input
                  v-model.number="creditLimitsForm.long_max"
                  type="number"
                  min="0"
                  class="input input-bordered input-sm w-full font-mono"
                />
              </div>
            </div>
          </div>
          <!-- Short Semester -->
          <div class="p-3 bg-secondary/5 rounded-lg border border-secondary/20 space-y-3">
            <div class="badge badge-secondary badge-sm">Short Semester</div>
                <div class="grid grid-cols-2 gap-3">
              <div class="form-control">
                <label class="label py-0 pl-0"><span class="label-text text-xs">Min</span></label>
                <input
                  v-model.number="creditLimitsForm.short_min"
                  type="number"
                  min="0"
                  class="input input-bordered input-sm w-full font-mono"
                />
              </div>
              <div class="form-control">
                <label class="label py-0 pl-0"><span class="label-text text-xs">Max</span></label>
                <input
                  v-model.number="creditLimitsForm.short_max"
                  type="number"
                  min="0"
                  class="input input-bordered input-sm w-full font-mono"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" @click="cancelEditCreditLimits">Cancel</button>
          <button
            class="btn btn-primary btn-sm min-w-[80px]"
            :disabled="isSavingCreditLimits"
            @click="saveCreditLimits"
          >
            <span v-if="isSavingCreditLimits" class="loading loading-spinner loading-xs"></span>
            {{ isSavingCreditLimits ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Card -->
    <div class="card bg-base-100 shadow-xl border border-base-200 overflow-hidden">
      <!-- Filter Bar -->
      <div class="p-4 border-b border-base-200 bg-base-100/80 backdrop-blur sticky top-0 z-20">
        <div class="flex flex-wrap items-center justify-between gap-4">
           <div class="flex items-center gap-2 text-sm font-medium text-base-content/70">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
              </svg>
              Filters:
           </div>
           
           <div class="flex items-center gap-3 flex-1">
             <select
               v-model="selectedIntakeType"
               class="select select-sm select-bordered w-full max-w-xs"
             >
               <option value="">All Intake Types</option>
               <option
                 v-for="intakeType in allIntakeTypes"
                 :key="intakeType"
                 :value="intakeType"
               >
                 {{ intakeType }}
               </option>
             </select>
           </div>
           
           <button class="btn btn-sm btn-ghost gap-2" @click="openImportModal()">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Import Rules
           </button>
        </div>
      </div>

      <div class="card-body p-0">
        <!-- Loading State -->
        <div v-if="rulesPending" class="flex flex-col items-center justify-center py-20">
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p class="text-base-content/60 mt-4 animate-pulse">Loading rules configuration...</p>
        </div>

        <!-- Rules List -->
        <template v-else-if="rules && rules.length > 0">
          <div class="flex flex-col">
            <div
              v-for="(intakeRules, intakeType) in rulesByIntakeType"
              :key="intakeType"
              class="border-b border-base-200 last:border-0 group"
              :class="collapsedIntakes.has(intakeType as string) ? 'bg-base-200/30' : 'bg-base-100'"
            >
              <!-- Intake Header -->
              <div
                class="p-4 flex items-center justify-between cursor-pointer hover:bg-base-200/50 transition-colors select-none"
                @click="toggleIntake(intakeType as string)"
              >
                <div class="flex items-center gap-4">
                  <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-content transition-colors">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform duration-300" :class="collapsedIntakes.has(intakeType as string) ? '-rotate-90 text-base-content/40' : 'rotate-0'">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                     </svg>
                  </div>
                  <div>
                    <h3 class="font-bold text-lg">{{ intakeType }}</h3>
                    <div class="text-xs text-base-content/60">{{ intakeRules.length }} rules configured</div>
                  </div>
                </div>

                <div class="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                   <button
                    class="btn btn-sm btn-ghost gap-2"
                    @click.stop="openAddModal(intakeType as string)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Rule
                  </button>
                  <button
                      class="btn btn-sm btn-ghost btn-square text-error"
                      @click.stop="openDeleteIntakeModal(intakeType as string)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                </div>
              </div>

              <!-- Rules Table -->
              <!-- Rules List Modern Design -->
              <div v-show="!collapsedIntakes.has(intakeType as string)" class="divide-y divide-base-200">
                  <!-- Header Row -->
                  <div class="grid grid-cols-12 gap-4 px-6 py-3 bg-base-200/50 text-xs uppercase font-bold text-base-content/50">
                      <div class="col-span-3">Transfer Condition</div>
                      <div class="col-span-1 hidden md:flex justify-center items-center">
                          <!-- Spacer/Connector -->
                      </div>
                      <div class="col-span-3">Target Entry</div>
                      <div class="col-span-5 text-right">Actions</div>
                  </div>

                  <!-- Item Rows -->
                  <div 
                    v-for="rule in intakeRules" 
                    :key="rule.id" 
                    class="group grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-base-100 transition-all duration-200 relative"
                  >
                        <!-- Hover Indicator -->
                        <div class="absolute left-0 top-0 bottom-0 w-1 bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>

                         <!-- Credit Condition -->
                        <div class="col-span-12 md:col-span-3">
                           <div class="flex items-center gap-3">
                              <div class="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center text-base-content/70 font-bold text-lg">
                                  ≥
                              </div>
                              <div>
                                  <div class="font-mono text-xl font-bold leading-none">{{ rule.credit_transfer }}</div>
                                  <div class="text-xs font-semibold uppercase tracking-wider text-base-content/50 mt-1">Credits</div>
                              </div>
                           </div>
                        </div>

                        <!-- Connector Arrow (Desktop) -->
                        <div class="col-span-1 hidden md:flex justify-center text-base-content/20 group-hover:text-primary/50 transition-colors">
                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
                           </svg>
                        </div>

                         <!-- Target Semester -->
                        <div class="col-span-12 md:col-span-3">
                           <div class="flex items-center gap-2">
                              <div class="badge badge-lg gap-2 h-auto py-2 px-3" :class="rule.entry_semester === 1 ? 'badge-primary' : 'badge-ghost border-base-content/20'">
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                                 </svg>
                                 Entry Sem {{ rule.entry_semester }}
                              </div>
                           </div>
                        </div>
                        
                         <!-- Actions -->
                        <div class="col-span-12 md:col-span-5 flex items-center justify-between md:justify-end gap-3 mt-2 md:mt-0">
                             
                             <!-- Plan Button -->
                              <button 
                                 class="btn btn-sm btn-outline gap-2 font-normal w-full md:w-auto hover:btn-primary"
                                 @click="openCreditPlanModal(rule)"
                               >
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                   <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                 </svg>
                                 Configure Plan
                               </button>
                               
                               <!-- Divider -->
                               <div class="h-6 w-px bg-base-content/10 hidden md:block"></div>

                               <!-- Admin Actions -->
                               <div class="join">
                                   <button class="btn btn-square btn-sm join-item btn-ghost text-base-content/70 hover:text-primary" @click="openEditModal(rule)">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                       <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                     </svg>
                                   </button>
                                   <button class="btn btn-square btn-sm join-item btn-ghost text-error" @click="openDeleteModal(rule)">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                       <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                     </svg>
                                   </button>
                               </div>
                        </div>
                  </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Empty State -->
        <div v-else class="flex flex-col items-center justify-center py-20 text-center">
          <div class="w-24 h-24 bg-base-200 rounded-full flex items-center justify-center mb-6">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" class="w-12 h-12 text-base-content/40">
               <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
             </svg>
          </div>
          <h3 class="text-xl font-bold">No Rules Defined</h3>
          <p class="text-base-content/60 mt-2 max-w-sm">
             Start by adding a rule to map credit transfers to entry semesters.
          </p>
          <button class="btn btn-primary mt-6" @click="openAddModal()">
            Create First Rule
          </button>
        </div>
      </div>
       <!-- Info Footer -->
      <div class="bg-base-200/50 p-4 border-t border-base-200 text-sm flex gap-4">
        <div class="flex-none pt-0.5">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 text-info">
             <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
           </svg>
        </div>
        <div class="text-base-content/70">
           <strong>Logic:</strong> During Intake Assessment, if a student's total transferred credits are greater than or equal to a rule's <strong>Credit Transfer</strong> value, they will be assigned the corresponding <strong>Entry Semester</strong>. The system checks rules from highest credit value to lowest.
        </div>
      </div>
    </div>

    <!-- Modals -->
    <!-- Add Rule Modal -->
    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isAddModalOpen }">
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-primary text-primary-content">
           <h3 class="font-bold text-lg">Add New Rule</h3>
           <p class="text-primary-content/70 text-sm">Create a new entry mapping for an intake type.</p>
        </div>
        
        <div class="p-6 space-y-6">
          <div class="form-control hover:bg-transparent">
            <label class="label pl-0">
              <span class="label-text font-semibold">Intake Type</span>
            </label>
            <input
              v-model="formData.intake_type"
              type="text"
              placeholder="e.g. May Intake"
              list="intake-suggestions"
              class="input input-bordered w-full focus:input-primary"
            />
             <datalist id="intake-suggestions">
              <option value="May Intake" />
              <option value="Aug Intake" />
              <option value="Dec Intake" />
            </datalist>
          </div>

          <div class="grid grid-cols-2 gap-6">
              <div class="form-control hover:bg-transparent">
                <label class="label pl-0">
                  <span class="label-text font-semibold">Min. Credits</span>
                </label>
                <div class="relative">
                    <input
                      v-model.number="formData.credit_transfer"
                      type="number"
                      min="0"
                      class="input input-bordered w-full pl-12 font-mono"
                    />
                    <div class="absolute left-4 top-3 text-base-content/40 font-bold">≥</div>
                </div>
              </div>

               <div class="form-control hover:bg-transparent">
                <label class="label pl-0">
                  <span class="label-text font-semibold">Entry Level</span>
                </label>
                <div class="relative">
                     <input
                      v-model.number="formData.entry_semester"
                      type="number"
                      min="1"
                      max="9"
                      class="input input-bordered w-full pl-12 font-mono"
                    />
                    <div class="absolute left-4 top-3 text-base-content/40 text-xs font-bold uppercase tracking-wider mt-0.5">Sem</div>
                </div>
              </div>
          </div>
        </div>

        <div class="p-6 bg-base-200/50 flex justify-end gap-3">
           <button class="btn btn-ghost" @click="closeModals">Cancel</button>
           <button
            class="btn btn-primary min-w-[100px]"
            :disabled="isSubmitting"
            @click="addRule"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Saving..." : "Create Rule" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>
    
     <!-- Edit Rule Modal -->
    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isEditModalOpen }">
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-base-200 border-b border-base-300">
           <h3 class="font-bold text-lg">Edit Rule</h3>
        </div>
        
        <div class="p-6 space-y-6">
          <div class="form-control hover:bg-transparent">
            <label class="label pl-0">
              <span class="label-text font-semibold">Intake Type</span>
            </label>
            <input
              :value="formData.intake_type"
              type="text"
              disabled
              class="input input-bordered w-full bg-base-200/50 text-base-content/60"
            />
          </div>

          <div class="grid grid-cols-2 gap-6">
              <div class="form-control hover:bg-transparent">
                <label class="label pl-0">
                  <span class="label-text font-semibold">Min. Credits</span>
                </label>
                <input
                  v-model.number="formData.credit_transfer"
                  type="number"
                  min="0"
                  class="input input-bordered w-full font-mono"
                />
              </div>

               <div class="form-control hover:bg-transparent">
                <label class="label pl-0">
                  <span class="label-text font-semibold">Entry Level</span>
                </label>
                <input
                  v-model.number="formData.entry_semester"
                  type="number"
                  min="1"
                  max="9"
                  class="input input-bordered w-full font-mono"
                />
              </div>
          </div>
        </div>

        <div class="p-6 bg-base-200/50 flex justify-end gap-3">
           <button class="btn btn-ghost" @click="closeModals">Cancel</button>
           <button
            class="btn btn-primary"
            :disabled="isSubmitting"
            @click="updateRule"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Saving..." : "Save Changes" }}
          </button>
        </div>
      </div>
       <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>

    <!-- Delete Confirmation Modal -->
     <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isDeleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">Delete Rule?</h3>
        <p class="py-4 text-base-content/70">
           Are you sure you want to remove this rule? This will affect new student assessments.
        </p>
        
        <div v-if="deletingRule" class="alert alert-warning shadow-sm">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
           <span class="text-sm">
             <strong>{{ deletingRule.intake_type }}</strong>: ≥ {{ deletingRule.credit_transfer }} credits → Sem {{ deletingRule.entry_semester }}
           </span>
        </div>

        <div class="modal-action">
           <button class="btn btn-ghost" @click="closeModals">Cancel</button>
           <button class="btn btn-error" :disabled="isSubmitting" @click="deleteRule">
              {{ isSubmitting ? "Deleting..." : "Yes, Delete Rule" }}
           </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>
    
     <!-- Delete Intake Confirmation Modal -->
     <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isDeleteIntakeModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">Delete Entire Intake?</h3>
        <p class="py-4">
           You are about to delete <strong>{{ rulesByIntakeType[deletingIntakeType!]?.length }} rules</strong> for <span class="font-bold badge badge-neutral">{{ deletingIntakeType }}</span>.
           <br><br>
           This action cannot be undone.
        </p>

        <div class="modal-action">
           <button class="btn btn-ghost" @click="closeModals">Cancel</button>
           <button class="btn btn-error" :disabled="isSubmitting" @click="deleteIntakeRules">
              {{ isSubmitting ? "Deleting..." : "Delete All Rules" }}
           </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>
    
    <!-- Credit Plan Modal -->
    <!-- Credit Plan Modal -->
    <dialog class="modal" :class="{ 'modal-open': isCreditPlanModalOpen }">
      <div class="modal-box w-11/12 max-w-4xl p-0 h-[80vh] flex flex-col">
          <!-- Header -->
         <div class="p-6 bg-base-100 border-b border-base-200 flex justify-between items-start">
             <div>
                <h3 class="font-bold text-xl">Credit Plan Configuration</h3>
                <div v-if="creditPlanRule" class="text-sm mt-1 flex items-center gap-2 text-base-content/60">
                   <span class="badge badge-sm badge-ghost">{{ creditPlanRule.intake_type }}</span>
                   <span>Entry at <strong>Sem {{ creditPlanRule.entry_semester }}</strong> (≥ {{ creditPlanRule.credit_transfer }} credits)</span>
                </div>
             </div>
             <div class="flex flex-col items-end">
                <div class="text-3xl font-mono font-bold">{{ totalPlanCredits }}</div>
                <div class="text-xs uppercase tracking-wide font-bold text-base-content/40">Total Plan Credits</div>
             </div>
         </div>
         
         <!-- Content -->
         <div class="flex-1 overflow-y-auto p-6 bg-base-200/30">
             <div v-if="isLoadingCreditPlans" class="flex justify-center py-20">
                <span class="loading loading-spinner loading-lg"></span>
             </div>
             
             <div v-else class="space-y-4">
                 <div v-for="(plan, index) in creditPlans" :key="index" class="card bg-base-100 shadow-sm border border-base-200">
                    <div class="card-body p-4 flex flex-row items-center gap-4">
                       <div class="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center font-bold text-base-content/60">
                          {{ plan.semester_number }}
                       </div>
                       
                       <div class="flex-1 grid grid-cols-[1fr_auto_1fr] gap-4">
                           <div class="form-control hover:bg-transparent">
                             <label class="label pl-0 pt-0 pb-1">
                                <span class="label-text text-xs uppercase font-bold text-base-content/40">Semester Type</span>
                             </label>
                             <select v-model="plan.semester_type" class="select select-sm select-bordered w-full">
                               <option value="L">Long Semester</option>
                               <option value="S">Short Semester</option>
                             </select>
                           </div>
                            
                            <div class="flex items-end pb-2">
                              <label class="label cursor-pointer gap-2">
                                <input type="checkbox" v-model="plan.is_li" class="checkbox checkbox-sm checkbox-primary" @change="if (plan.is_li) { plan.target_credits = 8; plan.semester_type = 'L'; }" />
                                <span class="label-text text-xs font-semibold">LI</span>
                              </label>
                            </div>
                           <div class="form-control hover:bg-transparent">
                             <label class="label pl-0 pt-0 pb-1">
                                <span class="label-text text-xs uppercase font-bold text-base-content/40">Target Credits</span>
                                 <span class="label-text-alt text-xs text-base-content/40">
                                   {{ plan.is_li ? 'LI' : plan.semester_type === 'L' ? `${CREDIT_RULES.L.min}–${CREDIT_RULES.L.max}` : `${CREDIT_RULES.S.min}–${CREDIT_RULES.S.max}` }}
                                 </span>
                              </label>
                              <input 
                                type="number" 
                                v-model.number="plan.target_credits" 
                                :min="plan.semester_type === 'L' ? CREDIT_RULES.L.min : CREDIT_RULES.S.min" 
                                :max="plan.semester_type === 'L' ? CREDIT_RULES.L.max : CREDIT_RULES.S.max" 
                                class="input input-sm input-bordered font-mono" 
                                :class="{ 'input-error': creditPlanErrors[index] }"
                                 :disabled="plan.is_li" 
                              />
                             <label v-if="creditPlanErrors[index]" class="label pt-1 pb-0">
                               <span class="label-text-alt text-error text-xs">{{ creditPlanErrors[index] }}</span>
                             </label>
                           </div>
                       </div>
                       
                       <button class="btn btn-square btn-sm btn-ghost text-error" @click="removeSemesterFromPlan(index)">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                       </button>
                    </div>
                 </div>
                 
                 <button class="btn btn-outline btn-block border-dashed" @click="addSemesterToPlan">
                    + Add Next Semester
                 </button>
             </div>
         </div>
         
         <!-- Validation Summary -->
         <div v-if="hasCreditPlanErrors" class="px-6 pb-2">
           <div class="alert alert-warning shadow-sm py-2 text-sm">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
             <span>Some semesters have invalid credit hours. <strong>Long: 12–20</strong> · <strong>Short: 6–10</strong></span>
           </div>
         </div>

         <!-- Footer -->
         <div class="p-4 bg-base-100 border-t border-base-200 flex justify-end gap-3 z-20">
             <button class="btn btn-ghost" @click="closeModals">Discard Changes</button>
             <button class="btn btn-primary" :disabled="isSubmitting || hasCreditPlanErrors" @click="saveCreditPlans">
               {{ isSubmitting ? "Saving..." : "Save Configuration" }}
             </button>
         </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>

    <!-- Import Modal -->
    <dialog class="modal" :class="{ 'modal-open': isImportModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Import Semester Rules</h3>

        <p class="text-sm text-base-content/60 mb-4">
          Upload an Excel file with semester rules. The file should have sections like
          "August Intake(SEM 2)" with columns for Credit Transfer and semester credits.
        </p>

        <!-- Drag & Drop Zone -->
        <div 
          class="border-2 border-dashed rounded-xl p-8 transition-colors text-center cursor-pointer relative"
          :class="isDragging ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-primary/50 hover:bg-base-200/50'"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
          @click="importFileInput?.click()"
        >
           <input
            ref="importFileInput"
            type="file"
            accept=".xlsx,.xls"
            class="hidden"
            @change="handleImportFileSelect"
          />
          
          <div v-if="importFile" class="flex flex-col items-center gap-2">
             <div class="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center text-success mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
             </div>
             <div class="font-bold text-lg">{{ importFile.name }}</div>
             <div class="text-xs text-base-content/50">{{ (importFile.size / 1024).toFixed(2) }} KB</div>
             <button class="btn btn-xs btn-ghost text-error" @click.stop="importFile = null">Remove</button>
          </div>
          
          <div v-else class="flex flex-col items-center gap-2 py-4">
             <div class="w-12 h-12 rounded-full bg-base-200 flex items-center justify-center text-base-content/40 mb-2">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
             </div>
             <div class="font-bold">Click to upload or drag and drop</div>
             <div class="text-xs text-base-content/50">Excel files (.xlsx, .xls) only</div>
          </div>
        </div>

        <!-- Import Success Result -->
        <div v-if="importResult" class="alert alert-success mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p class="font-medium">Import Complete!</p>
            <p class="text-sm">
              {{ importResult.total_rules_parsed }} rules parsed,
              {{ importResult.rules_inserted }} new rules,
              {{ importResult.credit_plans_inserted }} credit plans added.
            </p>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeImportModal">
            {{ importResult ? 'Close' : 'Cancel' }}
          </button>
          <button
            v-if="!importResult"
            class="btn btn-primary"
            :disabled="isImporting || !importFile"
            @click="importRules"
          >
            <span v-if="isImporting" class="loading loading-spinner loading-sm"></span>
            {{ isImporting ? "Importing..." : "Import" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeImportModal">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>


