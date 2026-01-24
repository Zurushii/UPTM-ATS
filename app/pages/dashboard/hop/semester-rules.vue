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

interface IntakesData {
  rule_intakes: string[];
  student_intakes: string[];
}

// State
const selectedIntakeType = ref<string>("");
const isAddModalOpen = ref(false);
const isEditModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const editingRule = ref<Rule | null>(null);
const deletingRule = ref<Rule | null>(null);
const isSubmitting = ref(false);

// Form state for add/edit
const formData = ref({
  intake_type: "",
  credit_transfer: 0,
  entry_semester: 2,
});

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

// Close all modals
const closeModals = () => {
  isAddModalOpen.value = false;
  isEditModalOpen.value = false;
  isDeleteModalOpen.value = false;
  editingRule.value = null;
  deletingRule.value = null;
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
</script>

<template>
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Semester Entry Rules</h1>
      <p class="text-sm text-base-content/60">
        Define rules to determine a student's starting semester based on
        transferred credit hours. These rules are applied during Intake Assessment.
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
              <button
                class="btn btn-xs btn-ghost"
                @click="openAddModal(intakeType as string)"
              >
                + Add
              </button>
            </div>

            <!-- Rules for this intake type -->
            <div class="overflow-x-auto">
              <table class="table table-sm w-full">
                <thead>
                  <tr>
                    <th class="w-1/3">Credit Transfer</th>
                    <th class="w-1/3">Entry Semester</th>
                    <th class="w-1/3 text-right">Actions</th>
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
            credit transfer value will be assigned to that entry semester. Rules are 
            evaluated from highest to lowest credit transfer value.
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
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Enter the intake period name
              </span>
            </label>
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
            <label class="label">
              <span class="label-text-alt text-base-content/50">
                Which semester the student will start in
              </span>
            </label>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="isSubmitting"
            @click="addRule"
          >
            <span
              v-if="isSubmitting"
              class="loading loading-spinner loading-sm"
            ></span>
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
          <!-- Intake Type (read-only) -->
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
            @click="updateRule"
          >
            <span
              v-if="isSubmitting"
              class="loading loading-spinner loading-sm"
            ></span>
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
          <p>
            <strong>Intake Type:</strong>
            {{ deletingRule.intake_type }}
          </p>
          <p>
            <strong>Credit Transfer:</strong> {{ deletingRule.credit_transfer }} credits
          </p>
          <p>
            <strong>Entry Semester:</strong> Semester
            {{ deletingRule.entry_semester }}
          </p>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeModals">Cancel</button>
          <button
            class="btn btn-error"
            :disabled="isSubmitting"
            @click="deleteRule"
          >
            <span
              v-if="isSubmitting"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ isSubmitting ? "Deleting..." : "Delete" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModals">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
