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

// Computed: total credits in credit plan
const totalPlanCredits = computed(() => {
  return creditPlans.value.reduce((sum, plan) => sum + plan.target_credits, 0);
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
      creditPlans.value = plans;
    } else {
      // Initialize with default semesters starting from entry semester
      creditPlans.value = [];
      for (let sem = rule.entry_semester; sem <= 9; sem++) {
        creditPlans.value.push({
          semester_number: sem,
          semester_type: sem === 6 || sem === 8 || sem === 9 ? "S" : "L",
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
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Semester Entry Rules</h1>
      <p class="text-sm text-base-content/60">
        Define rules to determine a student's starting semester and credit plan
        based on transferred credit hours.
      </p>
    </div>

    <!-- Rules Table Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-4">
        <!-- Table Header -->
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="font-medium">Credit Transfer → Entry Semester Mapping</h2>

          <div class="flex items-center gap-3">
            <!-- Intake Type Filter -->
            <select
              v-model="selectedIntakeType"
              class="select select-sm select-bordered"
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

            <!-- Import Button -->
            <button class="btn btn-sm btn-outline" @click="openImportModal()">
              📥 Import Rules
            </button>

            <!-- Add Rule Button -->
            <button class="btn btn-sm btn-primary" @click="openAddModal()">
              + Add Rule
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="rulesPending" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <!-- Rules Table -->
        <template v-else-if="rules && rules.length > 0">
          <div
            v-for="(intakeRules, intakeType) in rulesByIntakeType"
            :key="intakeType"
            class="space-y-2"
          >
            <!-- Intake Type Header -->
            <div
              class="flex items-center justify-between bg-base-200 px-4 py-2 rounded-lg"
            >
              <h3 class="font-medium text-sm">
                {{ intakeType }}
                <span class="text-base-content/50 font-normal ml-2">
                  ({{ intakeRules.length }} rule{{
                    intakeRules.length > 1 ? "s" : ""
                  }})
                </span>
              </h3>
              <div class="flex items-center gap-2">
                <button
                  class="btn btn-xs btn-ghost"
                  @click="openAddModal(intakeType as string)"
                >
                  + Add
                </button>
                <button
                  class="btn btn-xs btn-ghost text-error"
                  @click="openDeleteIntakeModal(intakeType as string)"
                  title="Delete semester entry rules"
                >
                  🗑️ Delete
                </button>
              </div>
            </div>

            <!-- Rules for this intake type -->
            <div class="overflow-x-auto">
              <table class="table table-sm w-full">
                <thead>
                  <tr>
                    <th class="w-1/4">Credit Transfer</th>
                    <th class="w-1/4">Entry Semester</th>
                    <th class="w-1/4">Credit Plan</th>
                    <th class="w-1/4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rule in intakeRules" :key="rule.id">
                    <td>
                      <span class="font-medium">{{ rule.credit_transfer }}</span>
                      <span class="text-base-content/50 text-xs ml-1">credits</span>
                    </td>
                    <td>
                      <span class="badge badge-info badge-sm">
                        Semester {{ rule.entry_semester }}
                      </span>
                    </td>
                    <td>
                      <button
                        class="btn btn-xs btn-outline"
                        @click="openCreditPlanModal(rule)"
                      >
                        📅 Configure
                      </button>
                    </td>
                    <td class="text-right">
                      <button
                        class="btn btn-xs btn-ghost"
                        @click="openEditModal(rule)"
                      >
                        Edit
                      </button>
                      <button
                        class="btn btn-xs btn-ghost text-error"
                        @click="openDeleteModal(rule)"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- Empty State -->
        <div v-else class="text-center py-12 text-base-content/60">
          <div class="text-4xl mb-4">📐</div>
          <h3 class="font-medium mb-2">No semester entry rules defined</h3>
          <p class="text-sm mb-4">
            Add rules to define how transferred credits map to starting
            semesters for each intake type.
          </p>
          <button class="btn btn-primary btn-sm" @click="openAddModal()">
            + Add First Rule
          </button>
        </div>

        <!-- Info -->
        <div class="bg-info/10 rounded-lg p-4 text-sm">
          <h4 class="font-medium mb-2">How it works:</h4>
          <p class="text-base-content/70">
            During Intake Assessment, students with credits <strong>≥</strong> the defined
            credit transfer value will be assigned to that entry semester. Configure the
            credit plan to define target credits per semester.
          </p>
        </div>
      </div>
    </div>

    <!-- Add Rule Modal -->
    <dialog class="modal" :class="{ 'modal-open': isAddModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Add Semester Entry Rule</h3>

        <div class="space-y-4">
          <!-- Intake Type -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Intake Type</span>
            </label>
            <input
              v-model="formData.intake_type"
              type="text"
              placeholder="e.g., May Intake, Aug Intake, Dec Intake"
              maxlength="20"
              class="input input-bordered w-full"
              list="intake-suggestions"
            />
            <datalist id="intake-suggestions">
              <option value="May Intake" />
              <option value="Aug Intake" />
              <option value="Dec Intake" />
            </datalist>
          </div>

          <!-- Credit Transfer -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Credit Transfer</span>
            </label>
            <input
              v-model.number="formData.credit_transfer"
              type="number"
              min="0"
              class="input input-bordered w-full"
            />
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Students with ≥ this credit will be assigned to the entry semester
              </span>
            </label>
          </div>

          <!-- Entry Semester -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Entry Semester</span>
            </label>
            <input
              v-model.number="formData.entry_semester"
              type="number"
              min="1"
              max="9"
              class="input input-bordered w-full"
            />
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="isSubmitting"
            @click="addRule"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Adding..." : "Add Rule" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>

    <!-- Edit Rule Modal -->
    <dialog class="modal" :class="{ 'modal-open': isEditModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Edit Semester Entry Rule</h3>

        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Intake Type</span>
            </label>
            <input
              :value="formData.intake_type"
              type="text"
              disabled
              class="input input-bordered w-full bg-base-200"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Credit Transfer</span>
            </label>
            <input
              v-model.number="formData.credit_transfer"
              type="number"
              min="0"
              class="input input-bordered w-full"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Entry Semester</span>
            </label>
            <input
              v-model.number="formData.entry_semester"
              type="number"
              min="1"
              max="9"
              class="input input-bordered w-full"
            />
          </div>
        </div>

        <div class="modal-action">
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
    <dialog class="modal" :class="{ 'modal-open': isDeleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Delete Rule</h3>
        <p class="py-4">Are you sure you want to delete this rule?</p>

        <div v-if="deletingRule" class="bg-base-200 rounded-lg p-4 text-sm">
          <p><strong>Intake Type:</strong> {{ deletingRule.intake_type }}</p>
          <p><strong>Credit Transfer:</strong> {{ deletingRule.credit_transfer }} credits</p>
          <p><strong>Entry Semester:</strong> Semester {{ deletingRule.entry_semester }}</p>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-error"
            :disabled="isSubmitting"
            @click="deleteRule"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Deleting..." : "Delete" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>

    <!-- Delete Intake Confirmation Modal -->
    <dialog class="modal" :class="{ 'modal-open': isDeleteIntakeModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4 text-error">Delete Semester Entry</h3>
        <p class="py-4">
          Are you sure you want to delete <strong>all rules</strong> for this intake type?
          This action cannot be undone.
        </p>

        <div v-if="deletingIntakeType" class="bg-base-200 rounded-lg p-4 text-sm">
          <p><strong>Intake Type:</strong> {{ deletingIntakeType }}</p>
          <p><strong>Rules to delete:</strong> {{ rulesByIntakeType[deletingIntakeType]?.length || 0 }}</p>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-error"
            :disabled="isSubmitting"
            @click="deleteIntakeRules"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Deleting..." : "Delete Semester Entry" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>

    <!-- Credit Plan Modal -->
    <dialog class="modal" :class="{ 'modal-open': isCreditPlanModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg mb-4">
          Semester Credit Plan
          <span v-if="creditPlanRule" class="font-normal text-base-content/60 text-sm ml-2">
            {{ creditPlanRule.intake_type }} - {{ creditPlanRule.credit_transfer }} credits
          </span>
        </h3>

        <!-- Loading -->
        <div v-if="isLoadingCreditPlans" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <template v-else>
          <p class="text-sm text-base-content/60 mb-4">
            Define target credits for each semester. Students will see this plan after intake assessment.
          </p>

          <!-- Credit Plans Table -->
          <div class="overflow-x-auto mb-4">
            <table class="table table-sm w-full">
              <thead>
                <tr>
                  <th>Semester</th>
                  <th>Type</th>
                  <th>Target Credits</th>
                  <th class="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(plan, index) in creditPlans" :key="index">
                  <td>
                    <input
                      v-model.number="plan.semester_number"
                      type="number"
                      min="1"
                      max="12"
                      class="input input-bordered input-sm w-20"
                    />
                  </td>
                  <td>
                    <select
                      v-model="plan.semester_type"
                      class="select select-bordered select-sm"
                    >
                      <option value="L">Long (L)</option>
                      <option value="S">Short (S)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      v-model.number="plan.target_credits"
                      type="number"
                      min="0"
                      max="24"
                      class="input input-bordered input-sm w-20"
                    />
                  </td>
                  <td class="text-right">
                    <button
                      class="btn btn-xs btn-ghost text-error"
                      @click="removeSemesterFromPlan(index)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2" class="font-medium">Total Credits</td>
                  <td class="font-bold">{{ totalPlanCredits }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button class="btn btn-sm btn-outline" @click="addSemesterToPlan">
            + Add Semester
          </button>
        </template>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="isSubmitting || isLoadingCreditPlans"
            @click="saveCreditPlans"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm"></span>
            {{ isSubmitting ? "Saving..." : "Save Credit Plan" }}
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

        <!-- File Input -->
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Excel File (.xlsx, .xls)</span>
          </label>
          <input
            ref="importFileInput"
            type="file"
            accept=".xlsx,.xls"
            class="file-input file-input-bordered w-full"
            @change="handleImportFileSelect"
          />
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


