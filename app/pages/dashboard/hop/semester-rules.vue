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

interface JourneySlot {
  id?: number;
  rule_id?: number;
  slot_order: number;
  semester_type: "L" | "S";
  slot_role: "regular" | "fyp1" | "fyp2" | "li";
  semester_number?: number;
  is_li?: boolean;
}

interface Rule {
  id: number;
  intake_type: string;
  credit_transfer?: number | null;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  reference_note: string | null;
  is_system_default?: boolean;
  intake_lifecycle_pattern: Array<"L" | "S">;
  intake_lifecycle_summary: string;
  intake_lifecycle_source: "configured" | "default";
  journey_slots: JourneySlot[];
  journey_summary: string;
  exception_windows_count?: number;
}

interface IntakeLifecycleConfig {
  intake_type: string;
  lifecycle_pattern: Array<"L" | "S">;
  lifecycle_summary: string;
  source: "configured" | "default";
}

interface ExceptionWindow {
  id?: number;
  rule_id?: number;
  slot_order: number;
  transfer_min: number;
  transfer_max: number;
  allowed_overload_credits: number;
  allowed_underload_credits: number;
  default_reason: string | null;
}

interface JourneyValidationIssue {
  code: string;
  message: string;
  slot_order?: number;
  slot_role?: JourneySlot["slot_role"];
}

interface PreviewSemester {
  slot_order: number;
  semester_number: number;
  semester_type: "L" | "S";
  slot_role: JourneySlot["slot_role"];
  estimated_credits: number;
  is_credit_exception: boolean;
}

interface PreviewScenario {
  label: "Lowest" | "Middle" | "Highest";
  transferred_credits: number;
  estimated_remaining_credits: number;
  auto_appended_slots: number;
  semesters: PreviewSemester[];
}

interface JourneyResponse {
  rule: Rule;
  intake_lifecycle_pattern: Array<"L" | "S">;
  intake_lifecycle_source: "configured" | "default";
  journey_slots: JourneySlot[];
  exception_windows: ExceptionWindow[];
  exception_window_suggestions: ExceptionWindow[];
  explanation: string | null;
  preview_scenarios: PreviewScenario[];
  validation_issues: JourneyValidationIssue[];
}

interface IntakesData {
  rule_intakes: string[];
  student_intakes: string[];
}

type ToastType = "info" | "success" | "warning" | "error";

const toast = reactive({
  show: false,
  message: "",
  type: "info" as ToastType,
});

const showToast = (message: string, type: ToastType = "info") => {
  toast.message = message;
  toast.type = type;
  toast.show = true;
  setTimeout(() => {
    toast.show = false;
  }, 3500);
};

const manualSteps = [
  {
    text: "Step 1: Build one clear Starting Semester Table for each intake.",
    note: "Each transferred-credit total must match only one credit group.",
  },
  {
    text: "Step 2: Set the intake lifecycle for each intake.",
    note: "This decides how long and short semesters should repeat for that intake.",
  },
  {
    text: "Step 3: Arrange the planned semesters for each credit group.",
    note: "HOP sets the semester order and semester purpose. The system applies the intake lifecycle now and uses Program Structure later for course placement.",
  },
  {
    text: "Step 4: Import legacy workbook files or export the new Starting Semester Table template.",
  },
  {
    text: "Step 5: Student Entry Assessment will use the approved setup to assign the starting semester and generate plans.",
  },
];

const roleOptions: Array<{
  value: JourneySlot["slot_role"];
  label: string;
  helper: string;
}> = [
  {
    value: "regular",
    label: "Regular",
    helper: "Normal semester for the remaining courses.",
  },
  {
    value: "fyp1",
    label: "FYP1",
    helper: "Semester reserved for Final Year Project Part 1.",
  },
  {
    value: "fyp2",
    label: "FYP2",
    helper: "Semester reserved for Final Year Project Part 2.",
  },
  {
    value: "li",
    label: "LI",
    helper: "Semester reserved for Industrial Training.",
  },
];

const lifecycleStepOptions: Array<{
  value: "L" | "S";
  label: string;
}> = [
  { value: "L", label: "Long" },
  { value: "S", label: "Short" },
];

const selectedIntakeType = ref("");
const isAddModalOpen = ref(false);
const isEditModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const isDeleteIntakeModalOpen = ref(false);
const isJourneyModalOpen = ref(false);
const isLifecycleModalOpen = ref(false);
const isImportModalOpen = ref(false);
const isSubmitting = ref(false);
const isExportingTemplate = ref(false);
const isImporting = ref(false);
const isDragging = ref(false);
const isEditingCreditLimits = ref(false);
const isSavingCreditLimits = ref(false);
const isLoadingJourney = ref(false);
const isSavingJourney = ref(false);
const isSavingLifecycle = ref(false);
const showAdvancedSpecialCases = ref(false);
const editingRule = ref<Rule | null>(null);
const deletingRule = ref<Rule | null>(null);
const deletingIntakeType = ref<string | null>(null);
const journeyRule = ref<Rule | null>(null);
const editingIntakeLifecycle = ref<IntakeLifecycleConfig | null>(null);
const importFile = ref<File | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const collapsedIntakes = ref<Set<string>>(new Set());

const importResult = ref<{
  total_rules_parsed: number;
  rules_inserted: number;
  journey_slots_inserted: number;
  exception_windows_inserted?: number;
  overlap_standardization_count?: number;
  overlap_standardizations?: Array<{
    intake_type: string;
    transferred_credit: number;
    kept_entry_semester: number;
    discarded_entry_semesters: number[];
  }>;
} | null>(null);

const formData = ref({
  intake_type: "",
  transfer_min: 0,
  transfer_max: 0,
  entry_semester: 2,
  reference_note: "",
});

const creditLimitsForm = ref({
  long_min: 12,
  long_max: 20,
  short_min: 6,
  short_max: 10,
});

const intakeLifecycleForm = ref<{
  intake_type: string;
  lifecycle_pattern: Array<"L" | "S">;
}>({
  intake_type: "",
  lifecycle_pattern: ["L", "L", "S"],
});

const journeySlots = ref<JourneySlot[]>([]);
const journeyExceptionWindows = ref<ExceptionWindow[]>([]);
const journeyExceptionWindowSuggestions = ref<ExceptionWindow[]>([]);
const journeyValidationIssues = ref<JourneyValidationIssue[]>([]);
const journeyPreviewScenarios = ref<PreviewScenario[]>([]);
const journeyExplanation = ref<string | null>(null);

const {
  data: intakesData,
  refresh: refreshIntakes,
} = await useFetch<IntakesData>("/api/hop/semester-rules/intakes");

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

const {
  data: creditLimitsData,
  refresh: refreshCreditLimits,
} = await useFetch<{
  total_credit_required: number;
  long_min: number;
  long_max: number;
  short_min: number;
  short_max: number;
}>("/api/hop/program/credit-limits");

const sortedRules = computed(() =>
  [...(rules.value || [])].sort((left, right) => {
    if (left.intake_type !== right.intake_type) {
      return left.intake_type.localeCompare(right.intake_type);
    }

    if (left.transfer_min !== right.transfer_min) {
      return right.transfer_min - left.transfer_min;
    }

    return right.entry_semester - left.entry_semester;
  }),
);

const rulesByIntakeType = computed(() => {
  const grouped = new Map<string, Rule[]>();

  for (const rule of sortedRules.value) {
    if (!grouped.has(rule.intake_type)) {
      grouped.set(rule.intake_type, []);
    }

    grouped.get(rule.intake_type)!.push(rule);
  }

  return grouped;
});

const visibleIntakeTypes = computed(() => {
  if (selectedIntakeType.value) {
    return rulesByIntakeType.value.has(selectedIntakeType.value)
      ? [selectedIntakeType.value]
      : [];
  }

  return Array.from(rulesByIntakeType.value.keys());
});

const totalConfiguredBandCount = computed(
  () => sortedRules.value.filter((rule) => !rule.is_system_default).length,
);

const getConfiguredRuleCount = (rules: Rule[]) =>
  rules.filter((rule) => !rule.is_system_default).length;

const normalizeLifecyclePattern = (
  pattern?: Array<"L" | "S"> | null,
): Array<"L" | "S"> => {
  const fallback: Array<"L" | "S"> = ["L", "L", "S"];
  const normalized = Array.isArray(pattern)
    ? pattern.map((value) => (value === "S" ? "S" : "L"))
    : [];

  return [
    normalized[0] || fallback[0],
    normalized[1] || fallback[1],
    normalized[2] || fallback[2],
  ];
};

const formatLifecycleSummary = (pattern?: Array<"L" | "S"> | null) =>
  normalizeLifecyclePattern(pattern)
    .map((value) => (value === "L" ? "Long" : "Short"))
    .join(" -> ");

const getLifecycleConfigForIntake = (intakeType: string): IntakeLifecycleConfig => {
  const rule = rulesByIntakeType.value.get(intakeType)?.[0];
  const lifecyclePattern = normalizeLifecyclePattern(
    rule?.intake_lifecycle_pattern,
  );

  return {
    intake_type: intakeType,
    lifecycle_pattern: lifecyclePattern,
    lifecycle_summary: rule?.intake_lifecycle_summary || formatLifecycleSummary(lifecyclePattern),
    source: rule?.intake_lifecycle_source || "default",
  };
};

const getJourneyLifecyclePattern = () =>
  normalizeLifecyclePattern(journeyRule.value?.intake_lifecycle_pattern);

const getJourneyLifecycleSummary = () =>
  journeyRule.value?.intake_lifecycle_summary ||
  formatLifecycleSummary(getJourneyLifecyclePattern());

const getSemesterTypeLabel = (semesterType: "L" | "S") =>
  semesterType === "L" ? "Long" : "Short";

const getSemesterTypeForSlot = (
  slotOrder: number,
  slotRole: JourneySlot["slot_role"],
) => {
  if (slotRole === "li" || slotRole === "fyp2") {
    return "L" as const;
  }

  const pattern = getJourneyLifecyclePattern();
  return pattern[(Math.max(slotOrder, 1) - 1) % pattern.length] || "L";
};

const isSystemDefaultRule = (rule?: Rule | null) => !!rule?.is_system_default;

const journeySlotOptions = computed(() =>
  journeySlots.value.map((slot) => ({
    value: slot.slot_order,
    label: getReadableSlotSummaryLabel(slot.slot_order),
  })),
);

const longSemesterGuidelineText = computed(() => {
  const limits = creditLimitsData.value;
  if (!limits) {
    return "Loading...";
  }

  return `${limits.long_min}-${limits.long_max} credits`;
});

const shortSemesterGuidelineText = computed(() => {
  const limits = creditLimitsData.value;
  if (!limits) {
    return "Loading...";
  }

  return `${limits.short_min}-${limits.short_max} credits`;
});

const creditLimitsHelper = computed(
  () =>
    "These are recommended semester credit-hour guidelines. Planned semesters only define the semester order and purpose; actual semester credits are generated later from assigned courses.",
);

const getCoverageLabel = (rule: Pick<Rule, "transfer_min" | "transfer_max">) =>
  Number(rule.transfer_min) === Number(rule.transfer_max)
    ? `${rule.transfer_min} Cr`
    : `${rule.transfer_min}-${rule.transfer_max} Cr`;

const getTransferredCreditsLabel = (rule: Pick<Rule, "transfer_min" | "transfer_max">) =>
  Number(rule.transfer_min) === Number(rule.transfer_max)
    ? `${rule.transfer_min} Credits`
    : `${rule.transfer_min}-${rule.transfer_max} Credits`;

const getRoleLabel = (role: JourneySlot["slot_role"]) => {
  switch (role) {
    case "fyp1":
      return "FYP1";
    case "fyp2":
      return "FYP2";
    case "li":
      return "LI";
    default:
      return "Regular";
  }
};

const getRoleBadgeClass = (role: JourneySlot["slot_role"]) => {
  switch (role) {
    case "fyp1":
      return "badge badge-info badge-sm";
    case "fyp2":
      return "badge badge-success badge-sm";
    case "li":
      return "badge badge-warning badge-sm";
    default:
      return "badge badge-ghost badge-sm";
  }
};

const getSlotSummaryLabel = (slotOrder: number) => {
  if (!journeyRule.value) {
    return `Slot ${slotOrder}`;
  }

  const slot = journeySlots.value.find((item) => item.slot_order === slotOrder);
  const derivedSemester = getDerivedSemesterNumber(
    journeyRule.value.entry_semester,
    slotOrder,
  );
  const roleLabel = slot ? getRoleLabel(slot.slot_role) : "Regular";

  return `Slot ${slotOrder} - Sem ${derivedSemester} - ${roleLabel}`;
};

const getDerivedSemesterNumber = (
  entrySemester: number,
  slotOrder: number,
) => Number(entrySemester) + Number(slotOrder) - 1;

const getReadableSlotSummaryLabel = (slotOrder: number) => {
  if (!journeyRule.value) {
    return `Semester ${slotOrder}`;
  }

  const semesterNumber = getDerivedSemesterNumber(
    journeyRule.value.entry_semester,
    slotOrder,
  );
  const semester = journeySlots.value.find((slot) => slot.slot_order === slotOrder);
  const purpose = semester ? getRoleLabel(semester.slot_role) : "Regular";

  return `Sem ${semesterNumber} - ${purpose}`;
};

const getSlotForWindow = (slotOrder: number) =>
  journeySlots.value.find((slot) => slot.slot_order === slotOrder) || null;

const getWindowTransferLabel = (window: ExceptionWindow) =>
  window.transfer_min === window.transfer_max
    ? `${window.transfer_min} transferred credits`
    : `${window.transfer_min}-${window.transfer_max} transferred credits`;

const getWindowCoverageCount = (window: ExceptionWindow) =>
  Math.max(
    Number(window.transfer_max) - Number(window.transfer_min) + 1,
    1,
  );

const getWindowCoverageBadgeLabel = (window: ExceptionWindow) =>
  getWindowCoverageCount(window) === 1 ? "Exact case" : "Range";

const getWindowCoverageSummary = (window: ExceptionWindow) => {
  const coverageCount = getWindowCoverageCount(window);

  return coverageCount === 1
    ? "Covers 1 transferred-credit case."
    : `Covers ${coverageCount} transferred-credit cases.`;
};

const getSuggestionSourceLabel = (window: ExceptionWindow) => {
  const reason = String(window.default_reason || "").toLowerCase();

  if (reason.includes("planner-backed")) {
    return "Planner simulation";
  }

  if (reason.includes("configured band journey")) {
    return "Band journey";
  }

  return "Suggested";
};

const getSuggestionSourceBadgeClass = (window: ExceptionWindow) => {
  const sourceLabel = getSuggestionSourceLabel(window);

  if (sourceLabel === "Planner simulation") {
    return "border-primary/20 bg-primary/10 text-primary";
  }

  if (sourceLabel === "Band journey") {
    return "border-warning/30 bg-warning/10 text-warning-content";
  }

  return "border-base-300 bg-base-200 text-base-content/70";
};

const getWindowGuidelineBounds = (window: ExceptionWindow) => {
  const slot = getSlotForWindow(window.slot_order);
  const limits = creditLimitsData.value;

  if (!slot || !limits) {
    return null;
  }

  if (slot.slot_role === "li") {
    return {
      min: 8,
      max: 8,
      fixed: true,
    };
  }

  if (slot.semester_type === "S") {
    return {
      min: limits.short_min,
      max: limits.short_max,
      fixed: false,
    };
  }

  return {
    min: limits.long_min,
    max: limits.long_max,
    fixed: false,
  };
};

const getWindowAllowedCreditText = (window: ExceptionWindow) => {
  const bounds = getWindowGuidelineBounds(window);

  if (!bounds) {
    return "Allowed total: calculated after save";
  }

  if (bounds.fixed) {
    return `Allowed total: ${bounds.max} Cr fixed`;
  }

  const minAllowed = Math.max(
    bounds.min - Number(window.allowed_underload_credits || 0),
    0,
  );
  const maxAllowed = bounds.max + Number(window.allowed_overload_credits || 0);

  if (
    Number(window.allowed_overload_credits || 0) > 0 &&
    Number(window.allowed_underload_credits || 0) > 0
  ) {
    return `Allowed total: ${minAllowed}-${maxAllowed} Cr`;
  }

  if (Number(window.allowed_overload_credits || 0) > 0) {
    return `Allowed total: up to ${maxAllowed} Cr`;
  }

  if (Number(window.allowed_underload_credits || 0) > 0) {
    return `Allowed total: down to ${minAllowed} Cr`;
  }

  return `Allowed total: ${bounds.min}-${bounds.max} Cr`;
};

const getWindowAllowedCreditValueText = (window: ExceptionWindow) =>
  getWindowAllowedCreditText(window).replace("Allowed total: ", "");

const getWindowGuidelineText = (window: ExceptionWindow) => {
  const bounds = getWindowGuidelineBounds(window);

  if (!bounds) {
    return null;
  }

  if (bounds.fixed) {
    return `Fixed guideline ${bounds.max} Cr`;
  }

  return `Normal guideline ${bounds.min}-${bounds.max} Cr`;
};

const getWindowGuidelineValueText = (window: ExceptionWindow) => {
  const text = getWindowGuidelineText(window);

  if (!text) {
    return null;
  }

  return text
    .replace("Normal guideline ", "")
    .replace("Fixed guideline ", "");
};

const getWindowAdjustmentText = (window: ExceptionWindow) => {
  const overload = Number(window.allowed_overload_credits || 0);
  const underload = Number(window.allowed_underload_credits || 0);

  if (overload > 0 && underload > 0) {
    return `+${overload} / -${underload} flex`;
  }

  if (overload > 0) {
    return `+${overload} above guideline`;
  }

  if (underload > 0) {
    return `-${underload} below guideline`;
  }

  return "Within guideline";
};

const normalizeJourneySlot = (
  slot: Partial<JourneySlot>,
  slotOrder: number,
): JourneySlot => {
  const slotRole = roleOptions.some((option) => option.value === slot.slot_role)
    ? (slot.slot_role as JourneySlot["slot_role"])
    : "regular";
  const semesterType = getSemesterTypeForSlot(slotOrder, slotRole);

  return {
    id: slot.id,
    rule_id: slot.rule_id,
    slot_order: slotOrder,
    semester_type: semesterType,
    slot_role: slotRole,
    semester_number:
      slot.semester_number && journeyRule.value
        ? slot.semester_number
        : journeyRule.value
          ? getDerivedSemesterNumber(journeyRule.value.entry_semester, slotOrder)
          : undefined,
    is_li: slotRole === "li",
  };
};

const normalizeJourneySlots = (slots: Partial<JourneySlot>[]) =>
  slots
    .map((slot, index) => normalizeJourneySlot(slot, index + 1))
    .sort((left, right) => left.slot_order - right.slot_order)
    .map((slot, index) => normalizeJourneySlot(slot, index + 1));

const syncJourneySlots = (slots: Partial<JourneySlot>[]) => {
  journeySlots.value = normalizeJourneySlots(slots);
};

const normalizeExceptionWindow = (
  window: Partial<ExceptionWindow>,
): ExceptionWindow => {
  const bandMin = Math.max(Number(journeyRule.value?.transfer_min) || 0, 0);
  const bandMax = Math.max(
    Number(journeyRule.value?.transfer_max) || bandMin,
    bandMin,
  );
  const slotOrder = Math.min(
    Math.max(Number(window.slot_order) || 1, 1),
    Math.max(journeySlots.value.length, 1),
  );
  const transferMin = Math.min(
    Math.max(Number(window.transfer_min) || bandMin, bandMin),
    bandMax,
  );
  const transferMax = Math.max(
    Math.min(Number(window.transfer_max) || transferMin, bandMax),
    transferMin,
  );

  return {
    id: window.id,
    rule_id: window.rule_id,
    slot_order: slotOrder,
    transfer_min: transferMin,
    transfer_max: transferMax,
    allowed_overload_credits: Math.max(
      Number(window.allowed_overload_credits) || 0,
      0,
    ),
    allowed_underload_credits: Math.max(
      Number(window.allowed_underload_credits) || 0,
      0,
    ),
    default_reason: window.default_reason?.trim() || null,
  };
};

const syncExceptionWindows = (windows: Partial<ExceptionWindow>[]) => {
  journeyExceptionWindows.value = [...windows]
    .map((window) => normalizeExceptionWindow(window))
    .sort((left, right) => {
      if (left.slot_order !== right.slot_order) {
        return left.slot_order - right.slot_order;
      }

      if (left.transfer_min !== right.transfer_min) {
        return left.transfer_min - right.transfer_min;
      }

      return left.transfer_max - right.transfer_max;
    });
};

const toggleIntake = (intakeType: string) => {
  const next = new Set(collapsedIntakes.value);
  if (next.has(intakeType)) {
    next.delete(intakeType);
  } else {
    next.add(intakeType);
  }
  collapsedIntakes.value = next;
};

const resetRuleForm = () => {
  formData.value = {
    intake_type: selectedIntakeType.value || "",
    transfer_min: 0,
    transfer_max: 0,
    entry_semester: 2,
    reference_note: "",
  };
};

const closeRuleModals = () => {
  isAddModalOpen.value = false;
  isEditModalOpen.value = false;
  isDeleteModalOpen.value = false;
  isDeleteIntakeModalOpen.value = false;
  editingRule.value = null;
  deletingRule.value = null;
  deletingIntakeType.value = null;
};

const closeJourneyModal = () => {
  isJourneyModalOpen.value = false;
  journeyRule.value = null;
  journeySlots.value = [];
  journeyExceptionWindows.value = [];
  journeyExceptionWindowSuggestions.value = [];
  journeyValidationIssues.value = [];
  journeyPreviewScenarios.value = [];
  journeyExplanation.value = null;
  showAdvancedSpecialCases.value = false;
};

const closeLifecycleModal = () => {
  isLifecycleModalOpen.value = false;
  editingIntakeLifecycle.value = null;
  intakeLifecycleForm.value = {
    intake_type: "",
    lifecycle_pattern: ["L", "L", "S"],
  };
};

const openAddModal = (intakeType?: string) => {
  resetRuleForm();
  formData.value.intake_type = intakeType || selectedIntakeType.value || "";
  isAddModalOpen.value = true;
};

const openEditModal = (rule: Rule) => {
  editingRule.value = rule;
  formData.value = {
    intake_type: rule.intake_type,
    transfer_min: rule.transfer_min,
    transfer_max: rule.transfer_max,
    entry_semester: rule.entry_semester,
    reference_note: rule.reference_note || "",
  };
  isEditModalOpen.value = true;
};

const openDeleteModal = (rule: Rule) => {
  deletingRule.value = rule;
  isDeleteModalOpen.value = true;
};

const openDeleteIntakeModal = (intakeType: string) => {
  deletingIntakeType.value = intakeType;
  isDeleteIntakeModalOpen.value = true;
};

const openLifecycleModal = (intakeType: string) => {
  const lifecycle = getLifecycleConfigForIntake(intakeType);
  editingIntakeLifecycle.value = lifecycle;
  intakeLifecycleForm.value = {
    intake_type: lifecycle.intake_type,
    lifecycle_pattern: [...lifecycle.lifecycle_pattern],
  };
  isLifecycleModalOpen.value = true;
};

const handleJourneyRoleChange = (index: number) => {
  const slot = journeySlots.value[index];
  if (!slot) {
    return;
  }

  syncJourneySlots(journeySlots.value);
  syncExceptionWindows(journeyExceptionWindows.value);
};

const removeJourneySlot = (index: number) => {
  if (journeySlots.value.length <= 1) {
    showToast("Add at least one planned semester before saving.", "warning");
    return;
  }

  syncJourneySlots(journeySlots.value.filter((_, currentIndex) => currentIndex !== index));
  syncExceptionWindows(journeyExceptionWindows.value);
};

const moveJourneySlot = (index: number, direction: -1 | 1) => {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= journeySlots.value.length) {
    return;
  }

  const next = [...journeySlots.value];
  const current = next[index];
  const target = next[targetIndex];
  if (!current || !target) {
    return;
  }

  next[index] = target;
  next[targetIndex] = current;
  syncJourneySlots(next);
  syncExceptionWindows(journeyExceptionWindows.value);
};

const addExceptionWindow = (initial?: Partial<ExceptionWindow>) => {
  if (!journeyRule.value) {
    return;
  }

  syncExceptionWindows([
    ...journeyExceptionWindows.value,
    {
      slot_order: Math.min(
        Math.max(Number(initial?.slot_order) || 1, 1),
        Math.max(journeySlots.value.length, 1),
      ),
      transfer_min:
        initial?.transfer_min ?? Number(journeyRule.value.transfer_min),
      transfer_max:
        initial?.transfer_max ?? Number(journeyRule.value.transfer_max),
      allowed_overload_credits: initial?.allowed_overload_credits ?? 0,
      allowed_underload_credits: initial?.allowed_underload_credits ?? 0,
      default_reason: initial?.default_reason ?? null,
    },
  ]);
};

const removeExceptionWindow = (index: number) => {
  syncExceptionWindows(
    journeyExceptionWindows.value.filter((_, currentIndex) => currentIndex !== index),
  );
};

const applySuggestedExceptionWindow = (window: ExceptionWindow) => {
  const alreadyExists = journeyExceptionWindows.value.some(
    (existing) =>
      existing.slot_order === window.slot_order &&
      existing.transfer_min === window.transfer_min &&
      existing.transfer_max === window.transfer_max &&
      existing.allowed_overload_credits === window.allowed_overload_credits &&
      existing.allowed_underload_credits === window.allowed_underload_credits &&
      (existing.default_reason || null) === (window.default_reason || null),
  );

  if (alreadyExists) {
    showToast("This suggested window is already added.", "info");
    return;
  }

  addExceptionWindow(window);
};

const applyAllSuggestedExceptionWindows = () => {
  if (journeyExceptionWindowSuggestions.value.length === 0) {
    return;
  }

  const merged = [...journeyExceptionWindows.value];
  for (const window of journeyExceptionWindowSuggestions.value) {
    const exists = merged.some(
      (existing) =>
        existing.slot_order === window.slot_order &&
        existing.transfer_min === window.transfer_min &&
        existing.transfer_max === window.transfer_max &&
        existing.allowed_overload_credits === window.allowed_overload_credits &&
        existing.allowed_underload_credits === window.allowed_underload_credits &&
        (existing.default_reason || null) === (window.default_reason || null),
    );

    if (!exists) {
      merged.push(window);
    }
  }

  syncExceptionWindows(merged);
};

const applyJourneyResponse = (
  response: JourneyResponse,
  baseRule?: Rule | null,
) => {
  const currentRule = baseRule || journeyRule.value;
  const lifecyclePattern = normalizeLifecyclePattern(
    response.intake_lifecycle_pattern,
  );

  if (currentRule) {
    journeyRule.value = {
      ...currentRule,
      intake_lifecycle_pattern: lifecyclePattern,
      intake_lifecycle_source: response.intake_lifecycle_source,
      intake_lifecycle_summary: formatLifecycleSummary(lifecyclePattern),
    };
  }

  journeyExplanation.value = response.explanation;
  journeyValidationIssues.value = response.validation_issues || [];
  journeyPreviewScenarios.value = response.preview_scenarios || [];
  syncJourneySlots(response.journey_slots || []);
  syncExceptionWindows(response.exception_windows || []);
  journeyExceptionWindowSuggestions.value =
    response.exception_window_suggestions || [];
};

const syncSavedJourneyIntoRules = (response: JourneyResponse) => {
  if (!journeyRule.value || !rules.value) {
    return;
  }

  const lifecyclePattern = normalizeLifecyclePattern(
    response.intake_lifecycle_pattern,
  );

  rules.value = rules.value.map((rule) =>
    rule.id === journeyRule.value?.id
      ? {
          ...rule,
          intake_lifecycle_pattern: lifecyclePattern,
          intake_lifecycle_summary: formatLifecycleSummary(lifecyclePattern),
          intake_lifecycle_source: response.intake_lifecycle_source,
          journey_slots: response.journey_slots || [],
          exception_windows_count: response.exception_windows?.length || 0,
        }
      : rule,
  );
};

const openJourneyModal = async (rule: Rule) => {
  journeyRule.value = rule;
  journeyExplanation.value = null;
  journeyValidationIssues.value = [];
  journeyPreviewScenarios.value = [];
  journeySlots.value = [];
  journeyExceptionWindows.value = [];
  journeyExceptionWindowSuggestions.value = [];
  showAdvancedSpecialCases.value = false;
  isJourneyModalOpen.value = true;
  isLoadingJourney.value = true;

  try {
    const response = await $fetch<JourneyResponse>(
      `/api/hop/semester-rules/${rule.id}/journey`,
    );

    applyJourneyResponse(response, rule);
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to load the planned semesters.",
      "error",
    );
    closeJourneyModal();
  } finally {
    isLoadingJourney.value = false;
  }
};

const saveJourney = async () => {
  if (!journeyRule.value || isSavingJourney.value) {
    return;
  }

  isSavingJourney.value = true;
  try {
    const payload = journeySlots.value.map((slot) => ({
      slot_order: slot.slot_order,
      semester_type: slot.semester_type,
      slot_role: slot.slot_role,
    }));

    const response = await $fetch<JourneyResponse>(
      `/api/hop/semester-rules/${journeyRule.value.id}/journey`,
      {
        method: "POST",
        body: {
          journey_slots: payload,
          exception_windows: journeyExceptionWindows.value
            .filter(
              (window) =>
                window.allowed_overload_credits > 0 ||
                window.allowed_underload_credits > 0,
            )
            .map((window) => ({
              slot_order: window.slot_order,
              transfer_min: window.transfer_min,
              transfer_max: window.transfer_max,
              allowed_overload_credits: window.allowed_overload_credits,
              allowed_underload_credits: window.allowed_underload_credits,
              default_reason: window.default_reason,
            })),
        },
      },
    );

    applyJourneyResponse(response);
    syncSavedJourneyIntoRules(response);
    await refreshRules().catch(() => undefined);
    closeJourneyModal();
    showToast("Planned semesters updated successfully.", "success");
  } catch (error: any) {
    const issues = error.data?.data?.issues;
    if (Array.isArray(issues)) {
      journeyValidationIssues.value = issues;
    }
    showToast(
      error.data?.message || error.message || "Failed to save the planned semesters.",
      "error",
    );
  } finally {
    isSavingJourney.value = false;
  }
};

const saveIntakeLifecycle = async () => {
  if (
    isSavingLifecycle.value ||
    !intakeLifecycleForm.value.intake_type.trim()
  ) {
    return;
  }

  isSavingLifecycle.value = true;
  try {
    const response = await $fetch<{
      intake_type: string;
      lifecycle_pattern: Array<"L" | "S">;
      lifecycle_summary: string;
      source: "configured" | "default";
    }>("/api/hop/semester-rules/intake-lifecycle", {
      method: "PUT",
      body: {
        intake_type: intakeLifecycleForm.value.intake_type.trim(),
        lifecycle_pattern: intakeLifecycleForm.value.lifecycle_pattern,
      },
    });

    if (
      journeyRule.value &&
      journeyRule.value.intake_type === response.intake_type
    ) {
      journeyRule.value = {
        ...journeyRule.value,
        intake_lifecycle_pattern: normalizeLifecyclePattern(
          response.lifecycle_pattern,
        ),
        intake_lifecycle_summary: response.lifecycle_summary,
        intake_lifecycle_source: response.source,
      };
      syncJourneySlots(journeySlots.value);
      syncExceptionWindows(journeyExceptionWindows.value);
    }

    closeLifecycleModal();
    await refreshRules();

    if (journeyRule.value && journeyRule.value.intake_type === response.intake_type) {
      const refreshedJourney = await $fetch<JourneyResponse>(
        `/api/hop/semester-rules/${journeyRule.value.id}/journey`,
      );
      applyJourneyResponse(refreshedJourney, journeyRule.value);
    }

    showToast("Intake lifecycle updated successfully.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to save the intake lifecycle.",
      "error",
    );
  } finally {
    isSavingLifecycle.value = false;
  }
};

const refreshAll = async () => {
  await Promise.all([refreshRules(), refreshIntakes(), refreshCreditLimits()]);
};

const addRule = async () => {
  if (isSubmitting.value) {
    return;
  }

  if (!formData.value.intake_type.trim()) {
    showToast("Please enter an intake type.", "warning");
    return;
  }

  if (formData.value.transfer_min < 0 || formData.value.transfer_max < 0) {
    showToast("Transferred-credit values must be non-negative.", "warning");
    return;
  }

  if (formData.value.transfer_max < formData.value.transfer_min) {
    showToast("Transfer max must be greater than or equal to transfer min.", "warning");
    return;
  }

  isSubmitting.value = true;
  try {
    await $fetch("/api/hop/semester-rules", {
      method: "POST",
      body: {
        intake_type: formData.value.intake_type.trim(),
        transfer_min: formData.value.transfer_min,
        transfer_max: formData.value.transfer_max,
        entry_semester: formData.value.entry_semester,
        reference_note: formData.value.reference_note.trim() || null,
      },
    });

    closeRuleModals();
    await refreshAll();
    showToast("Credit transfer group added.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to add the credit transfer group.",
      "error",
    );
  } finally {
    isSubmitting.value = false;
  }
};

const updateRule = async () => {
  if (!editingRule.value || isSubmitting.value) {
    return;
  }

  if (formData.value.transfer_max < formData.value.transfer_min) {
    showToast("Transfer max must be greater than or equal to transfer min.", "warning");
    return;
  }

  isSubmitting.value = true;
  try {
    await $fetch(`/api/hop/semester-rules/${editingRule.value.id}`, {
      method: "PUT",
      body: {
        transfer_min: formData.value.transfer_min,
        transfer_max: formData.value.transfer_max,
        entry_semester: formData.value.entry_semester,
        reference_note: formData.value.reference_note.trim() || null,
      },
    });

    closeRuleModals();
    await refreshRules();
    showToast("Credit transfer group updated.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to update the credit transfer group.",
      "error",
    );
  } finally {
    isSubmitting.value = false;
  }
};

const deleteRule = async () => {
  if (!deletingRule.value || isSubmitting.value) {
    return;
  }

  isSubmitting.value = true;
  try {
    await $fetch(`/api/hop/semester-rules/${deletingRule.value.id}`, {
      method: "DELETE",
    });
    closeRuleModals();
    await refreshAll();
    showToast("Credit transfer group deleted.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to delete the credit transfer group.",
      "error",
    );
  } finally {
    isSubmitting.value = false;
  }
};

const deleteIntakeRules = async () => {
  if (!deletingIntakeType.value || isSubmitting.value) {
    return;
  }

  isSubmitting.value = true;
  try {
    await $fetch("/api/hop/semester-rules/delete-intake", {
      method: "DELETE",
      query: { intake_type: deletingIntakeType.value },
    });

    closeRuleModals();
    await refreshAll();
    showToast(`All rules for ${deletingIntakeType.value} were deleted.`, "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to delete the intake table.",
      "error",
    );
  } finally {
    isSubmitting.value = false;
  }
};

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
  if (isSavingCreditLimits.value) {
    return;
  }

  if (creditLimitsForm.value.long_min > creditLimitsForm.value.long_max) {
    showToast("Long-semester minimum cannot exceed maximum.", "warning");
    return;
  }

  if (creditLimitsForm.value.short_min > creditLimitsForm.value.short_max) {
    showToast("Short-semester minimum cannot exceed maximum.", "warning");
    return;
  }

  isSavingCreditLimits.value = true;
  try {
    await $fetch("/api/hop/program/credit-limits", {
      method: "PUT",
      body: creditLimitsForm.value,
    });

    await refreshCreditLimits();
    isEditingCreditLimits.value = false;
    showToast("Credit hour guidelines updated.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to update credit hour guidelines.",
      "error",
    );
  } finally {
    isSavingCreditLimits.value = false;
  }
};

const handleImportFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  importFile.value = target.files?.[0] || null;
};

const handleDrop = (event: DragEvent) => {
  isDragging.value = false;
  if (event.dataTransfer?.files?.[0]) {
    importFile.value = event.dataTransfer.files[0] || null;
  }
};

const openImportModal = () => {
  importFile.value = null;
  importResult.value = null;
  isImportModalOpen.value = true;
};

const closeImportModal = () => {
  isImportModalOpen.value = false;
  importFile.value = null;
  importResult.value = null;
};

const importRules = async () => {
  if (isImporting.value || !importFile.value) {
    return;
  }

  isImporting.value = true;
  importResult.value = null;

  try {
    const formDataToUpload = new FormData();
    formDataToUpload.append("file", importFile.value);

    const response = await $fetch<{ summary: typeof importResult.value }>(
      "/api/hop/semester-rules/import",
      {
        method: "POST",
        body: formDataToUpload,
      },
    );

    importResult.value = response.summary;
    await refreshAll();
    showToast("Semester rules imported successfully.", "success");
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to import semester rules.",
      "error",
    );
  } finally {
    isImporting.value = false;
  }
};

const exportTemplate = async () => {
  if (isExportingTemplate.value) {
    return;
  }

  isExportingTemplate.value = true;
  try {
    const response = await $fetch("/api/hop/semester-rules/export-template", {
      responseType: "blob",
    });

    const blob = new Blob([response as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "semester_rules_template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    showToast(
      error.data?.message || error.message || "Failed to export template.",
      "error",
    );
  } finally {
    isExportingTemplate.value = false;
  }
};
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 w-full max-w-[1400px] mx-auto flex flex-col gap-8 relative">
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
        <span class="font-semibold">{{ toast.message }}</span>
      </div>
    </div>

    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 relative z-10">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
            Semester <span class="text-primary">Rules</span>
          </h1>
          <UserManualButton title="Semester Rules" :steps="manualSteps" />
        </div>
        <p class="text-base-content/60 font-medium max-w-3xl leading-relaxed">
          Build the Starting Semester Table for each intake. The system prepares the semester flow automatically, and you can review each credit group in the page.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 md:justify-end">
        <button class="btn btn-outline" @click="openImportModal">
          Import Excel
        </button>
        <button class="btn btn-outline" :disabled="isExportingTemplate" @click="exportTemplate">
          {{ isExportingTemplate ? "Exporting..." : "Export Template" }}
        </button>
        <button class="btn btn-primary" @click="openAddModal()">
          Add Credit Group
        </button>
      </div>
    </div>

    <div class="w-full">
      <!-- <div class="card bg-base-100 border border-base-200 shadow-sm">
                The final plan credits come from the student’s actual transferred credits and remaining courses.
              </p>
            </div>
          </div>
        </div>
      </div>
      -->
      <div class="card bg-base-100 border border-base-200 shadow-sm">
        <div class="card-body gap-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-bold text-base">Credit Hour Guidelines</h2>
              <p class="text-sm text-base-content/60">{{ creditLimitsHelper }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="isEditingCreditLimits"
                class="badge badge-outline badge-sm"
              >
                Editing
              </span>
              <button
                v-if="!isEditingCreditLimits"
                class="btn btn-sm btn-outline"
                @click="startEditCreditLimits"
              >
                Edit
              </button>
            </div>
          </div>

          <div
            v-if="!isEditingCreditLimits"
            class="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]"
          >
            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Long Semester
              </div>
              <div class="mt-2 text-lg font-semibold">{{ longSemesterGuidelineText }}</div>
              <div class="text-sm text-base-content/60 mt-1">
                Recommended credit-hour range
              </div>
            </div>

            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Short Semester
              </div>
              <div class="mt-2 text-lg font-semibold">{{ shortSemesterGuidelineText }}</div>
              <div class="text-sm text-base-content/60 mt-1">
                Recommended credit-hour range
              </div>
            </div>

            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-4">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Program Total
              </div>
              <div v-if="creditLimitsData" class="mt-2 text-lg font-semibold">
                {{ creditLimitsData.total_credit_required }} credit hours
              </div>
              <div v-else class="mt-2 text-lg font-semibold">
                Loading...
              </div>
              <div class="text-sm text-base-content/60 mt-1">
                Total credits required to graduate
              </div>
            </div>
          </div>

          <div v-else class="grid gap-4">
            <div class="rounded-2xl border border-base-200 bg-base-200/20 p-4 text-sm text-base-content/70">
              Update the recommended minimum and maximum credit hours for long and short semesters. These values guide plan generation and scheduling exceptions.
            </div>

            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
              <div class="rounded-2xl border border-base-200 bg-base-100 p-5 space-y-4">
                <div>
                  <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                    Long Semester
                  </div>
                  <div class="mt-1 text-lg font-semibold">
                    {{ creditLimitsForm.long_min }}-{{ creditLimitsForm.long_max }} credits
                  </div>
                  <div class="text-sm text-base-content/60 mt-1">
                    Recommended range used for normal long semesters.
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                  <label class="form-control">
                    <span class="label-text font-medium mb-1">Minimum Credits</span>
                    <input
                      v-model.number="creditLimitsForm.long_min"
                      type="number"
                      min="0"
                      class="input input-bordered w-full"
                    />
                  </label>
                  <label class="form-control">
                    <span class="label-text font-medium mb-1">Maximum Credits</span>
                    <input
                      v-model.number="creditLimitsForm.long_max"
                      type="number"
                      min="0"
                      class="input input-bordered w-full"
                    />
                  </label>
                </div>
              </div>

              <div class="rounded-2xl border border-base-200 bg-base-100 p-5 space-y-4">
                <div>
                  <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                    Short Semester
                  </div>
                  <div class="mt-1 text-lg font-semibold">
                    {{ creditLimitsForm.short_min }}-{{ creditLimitsForm.short_max }} credits
                  </div>
                  <div class="text-sm text-base-content/60 mt-1">
                    Recommended range used for short semesters.
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                  <label class="form-control">
                    <span class="label-text font-medium mb-1">Minimum Credits</span>
                    <input
                      v-model.number="creditLimitsForm.short_min"
                      type="number"
                      min="0"
                      class="input input-bordered w-full"
                    />
                  </label>
                  <label class="form-control">
                    <span class="label-text font-medium mb-1">Maximum Credits</span>
                    <input
                      v-model.number="creditLimitsForm.short_max"
                      type="number"
                      min="0"
                      class="input input-bordered w-full"
                    />
                  </label>
                </div>
              </div>

              <div class="rounded-2xl border border-base-200 bg-base-200/30 p-5">
                <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                  Program Total
                </div>
                <div v-if="creditLimitsData" class="mt-2 text-lg font-semibold">
                  {{ creditLimitsData.total_credit_required }} credit hours
                </div>
                <div v-else class="mt-2 text-lg font-semibold">
                  Loading...
                </div>
                <div class="text-sm text-base-content/60 mt-1">
                  Fixed total credits required to graduate. This value is shown here for reference only.
                </div>
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <button class="btn btn-ghost" @click="cancelEditCreditLimits">Cancel</button>
              <button class="btn btn-primary" :disabled="isSavingCreditLimits" @click="saveCreditLimits">
                {{ isSavingCreditLimits ? "Saving..." : "Save Guidelines" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card bg-base-100 border border-base-200 shadow-sm">
      <div class="card-body gap-4">
          <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
              <h2 class="font-bold text-base">Starting Semester Table</h2>
              <p class="text-sm text-base-content/60">
                {{ totalConfiguredBandCount }} configured credit group{{ totalConfiguredBandCount === 1 ? "" : "s" }} across {{ intakesData?.rule_intakes.length || 0 }} intake{{ (intakesData?.rule_intakes.length || 0) === 1 ? "" : "s" }}.
              </p>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-end gap-3">
              <label class="form-control">
                <span class="label-text text-xs uppercase tracking-wide font-semibold text-base-content/50 mb-1">
                  Filter Intake
                </span>
                <select v-model="selectedIntakeType" class="select select-bordered min-w-[220px]">
                  <option value="">All Intake Tables</option>
                  <option v-for="intakeType in intakesData?.rule_intakes || []" :key="intakeType" :value="intakeType">
                    {{ intakeType }}
                  </option>
                </select>
              </label>
              <button class="btn btn-outline" :disabled="rulesPending" @click="refreshRules()">
                Refresh
              </button>
          </div>
        </div>

        <div v-if="rulesPending" class="flex justify-center py-16">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>

        <div v-else-if="visibleIntakeTypes.length === 0" class="rounded-2xl border border-dashed border-base-300 bg-base-200/20 p-10 text-center">
          <h3 class="text-lg font-semibold">No starting semester table yet</h3>
          <p class="text-sm text-base-content/60 mt-2">
            Add a credit group manually or import the existing workbook so HOP can start arranging the planned semesters.
          </p>
          <div class="flex flex-wrap justify-center gap-3 mt-6">
            <button class="btn btn-primary" @click="openAddModal()">Add Credit Group</button>
            <button class="btn btn-outline" @click="openImportModal()">Import Excel</button>
          </div>
        </div>

        <div v-else class="space-y-5">
          <section
            v-for="intakeType in visibleIntakeTypes"
            :key="intakeType"
            class="rounded-2xl border border-base-200 bg-base-100 overflow-hidden shadow-sm"
          >
            <div class="px-5 py-4 border-b border-base-200 bg-base-200/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <button
                type="button"
                class="flex-1 text-left min-w-0"
                @click="toggleIntake(intakeType)"
              >
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-base-200 bg-base-100 text-base-content/60">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="1.8"
                      stroke="currentColor"
                      class="h-4 w-4 transition-transform duration-200"
                      :class="{ '-rotate-90': collapsedIntakes.has(intakeType) }"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>

                  <div>
                    <div class="flex items-center gap-3 flex-wrap">
                      <h3 class="text-lg font-bold">{{ intakeType }}</h3>
                      <span class="badge badge-ghost badge-sm">
                        {{ getConfiguredRuleCount(rulesByIntakeType.get(intakeType) || []) }} configured group{{ getConfiguredRuleCount(rulesByIntakeType.get(intakeType) || []) === 1 ? "" : "s" }}
                      </span>
                    </div>
                    <p class="text-sm text-base-content/60 mt-1">
                      Review the credit groups for this intake and open any group when you need to arrange the remaining semesters.
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span class="badge badge-outline badge-sm">
                        Lifecycle: {{ getLifecycleConfigForIntake(intakeType).lifecycle_summary }}
                      </span>
                      <span
                        v-if="getLifecycleConfigForIntake(intakeType).source === 'default'"
                        class="badge badge-ghost badge-sm"
                      >
                        Default
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <button class="btn btn-sm btn-outline" @click="openLifecycleModal(intakeType)">
                  Edit Lifecycle
                </button>
                <button class="btn btn-sm btn-outline" @click="openAddModal(intakeType)">
                  Add Group
                </button>
                <button class="btn btn-sm btn-error btn-outline" @click="openDeleteIntakeModal(intakeType)">
                  Delete Intake
                </button>
              </div>
            </div>

            <div
              v-if="!collapsedIntakes.has(intakeType)"
              class="p-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              <article
                v-for="rule in rulesByIntakeType.get(intakeType) || []"
                :key="rule.id"
                class="rounded-2xl border border-base-200 bg-base-100 shadow-sm p-5 md:p-6 transition-all duration-200 hover:border-primary/30 hover:shadow-md"
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                      Transferred Credits
                    </div>
                    <div class="mt-2 text-xl font-semibold text-base-content">
                      {{ getTransferredCreditsLabel(rule) }}
                    </div>
                    <div
                      v-if="isSystemDefaultRule(rule)"
                      class="mt-2 text-xs font-semibold uppercase tracking-wide text-primary"
                    >
                      System default
                    </div>
                  </div>

                  <span class="badge badge-primary badge-lg whitespace-nowrap">
                    Sem {{ rule.entry_semester }}
                  </span>
                </div>

                <div class="mt-5 rounded-2xl border border-base-200 bg-base-200/30 p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                        Student Starts In
                      </div>
                      <div class="mt-1 font-semibold">
                        Semester {{ rule.entry_semester }}
                      </div>
                      <div
                        v-if="isSystemDefaultRule(rule)"
                        class="text-sm text-base-content/60 mt-1"
                      >
                        Automatically created from the first Semester 2 credit group.
                      </div>
                    </div>
                    <span class="badge badge-ghost badge-sm">
                      {{ rule.journey_slots?.length || 0 }} planned semester{{ (rule.journey_slots?.length || 0) === 1 ? "" : "s" }}
                    </span>
                  </div>

                  <div class="mt-4 flex flex-wrap gap-2">
                    <span
                      v-if="(rule.exception_windows_count || 0) > 0"
                      class="badge badge-outline badge-sm"
                    >
                      {{ rule.exception_windows_count }} credit adjustment rule{{ rule.exception_windows_count === 1 ? "" : "s" }}
                    </span>
                    <span
                      v-else
                      class="badge badge-ghost badge-sm"
                    >
                      No credit adjustment rules
                    </span>
                  </div>
                </div>

                <div class="mt-5 pt-4 border-t border-base-200/70 flex items-center justify-between gap-3">
                  <template v-if="isSystemDefaultRule(rule)">
                    <div class="text-sm text-base-content/60">
                      This Semester 1 group is managed automatically by the system.
                    </div>
                  </template>
                  <template v-else>
                    <button class="btn btn-primary btn-sm flex-1 sm:flex-none" @click="openJourneyModal(rule)">
                      Set Planned Semesters
                    </button>

                    <div class="flex justify-end gap-2">
                      <button class="btn btn-square btn-sm btn-ghost" @click="openEditModal(rule)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM19.5 7.125 16.875 4.5" />
                        </svg>
                      </button>
                      <button class="btn btn-square btn-sm btn-ghost text-error" @click="openDeleteModal(rule)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.166L18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0V4.875c0-1.035-.84-1.875-1.875-1.875h-3.75C9.09 3 8.25 3.84 8.25 4.875v.915m7.5 0a48.667 48.11 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </template>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div class="card bg-gradient-to-r from-base-200 to-base-100 border border-base-200 shadow-sm overflow-hidden">
      <div class="card-body flex-col lg:flex-row items-center justify-between gap-4">
        <div>
          <span class="badge badge-primary badge-sm font-bold uppercase tracking-wider mb-2">
            Next Step
          </span>
          <h3 class="text-xl font-bold">Use These Rules In Student Entry Assessment</h3>
          <p class="text-sm text-base-content/60 mt-1">
            Once each intake table is ready, Student Entry Assessment will reuse the same configuration to assign starting semesters and generate academic plans.
          </p>
        </div>
        <NuxtLink to="/dashboard/hop/intake-assessment" class="btn btn-primary">
          Open Student Entry Assessment
        </NuxtLink>
      </div>
    </div>

    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isAddModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-xl">Add Credit Transfer Group</h3>
        <p class="text-sm text-base-content/60 mt-1">
          Create one non-overlapping transferred-credit group that maps to a starting semester.
        </p>

        <div class="grid gap-5 mt-6">
          <label class="form-control">
            <span class="label-text font-semibold mb-1">Intake Type</span>
            <input v-model="formData.intake_type" type="text" class="input input-bordered" placeholder="Example: August Intake" />
          </label>

          <div class="grid grid-cols-2 gap-4">
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Credit Transfer Min</span>
              <input v-model.number="formData.transfer_min" type="number" min="0" class="input input-bordered" />
            </label>
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Credit Transfer Max</span>
              <input v-model.number="formData.transfer_max" type="number" min="0" class="input input-bordered" />
            </label>
          </div>

          <div class="grid gap-4">
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Student Starts In</span>
              <input v-model.number="formData.entry_semester" type="number" min="1" class="input input-bordered" />
            </label>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeRuleModals">Cancel</button>
          <button class="btn btn-primary" :disabled="isSubmitting" @click="addRule">
            {{ isSubmitting ? "Saving..." : "Add Group" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeRuleModals">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isEditModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-xl">Edit Credit Transfer Group</h3>
        <p class="text-sm text-base-content/60 mt-1">
          Update the transferred-credit coverage or the starting semester for this credit group.
        </p>

        <div class="grid gap-5 mt-6">
          <label class="form-control">
            <span class="label-text font-semibold mb-1">Intake Type</span>
            <input :value="formData.intake_type" type="text" class="input input-bordered bg-base-200/50 text-base-content/60" disabled />
          </label>

          <div class="grid grid-cols-2 gap-4">
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Credit Transfer Min</span>
              <input v-model.number="formData.transfer_min" type="number" min="0" class="input input-bordered" />
            </label>
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Credit Transfer Max</span>
              <input v-model.number="formData.transfer_max" type="number" min="0" class="input input-bordered" />
            </label>
          </div>

          <div class="grid gap-4">
            <label class="form-control">
              <span class="label-text font-semibold mb-1">Student Starts In</span>
              <input v-model.number="formData.entry_semester" type="number" min="1" class="input input-bordered" />
            </label>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeRuleModals">Cancel</button>
          <button class="btn btn-primary" :disabled="isSubmitting" @click="updateRule">
            {{ isSubmitting ? "Saving..." : "Save Changes" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeRuleModals">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isDeleteModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">Delete This Credit Group?</h3>
        <p class="py-4 text-base-content/70">
          This removes the credit transfer group and its semester setup from the intake.
        </p>
        <div v-if="deletingRule" class="rounded-xl border border-error/20 bg-error/5 p-4 text-sm">
          <div class="font-semibold">{{ deletingRule.intake_type }}</div>
          <div class="mt-1">
            {{ getCoverageLabel(deletingRule) }} -> Sem {{ deletingRule.entry_semester }}
          </div>
        </div>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeRuleModals">Cancel</button>
          <button class="btn btn-error" :disabled="isSubmitting" @click="deleteRule">
            {{ isSubmitting ? "Deleting..." : "Delete Group" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeRuleModals">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isDeleteIntakeModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">Delete Entire Intake Table?</h3>
        <p class="py-4 text-base-content/70">
          This removes every credit transfer group for the selected intake.
        </p>
        <div v-if="deletingIntakeType" class="rounded-xl border border-error/20 bg-error/5 p-4 text-sm">
          <div class="font-semibold">{{ deletingIntakeType }}</div>
          <div class="mt-1">
            {{ getConfiguredRuleCount(rulesByIntakeType.get(deletingIntakeType) || []) }} group{{ getConfiguredRuleCount(rulesByIntakeType.get(deletingIntakeType) || []) === 1 ? "" : "s" }} will be deleted.
          </div>
        </div>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeRuleModals">Cancel</button>
          <button class="btn btn-error" :disabled="isSubmitting" @click="deleteIntakeRules">
            {{ isSubmitting ? "Deleting..." : "Delete Intake" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeRuleModals">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal" :class="{ 'modal-open': isImportModalOpen }">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Import Semester Rules</h3>
        <p class="text-sm text-base-content/60 mt-2">
          Upload the `Entry Bands` template, or upload the legacy workbook-style Excel file. The system will convert legacy sections into non-overlapping credit groups and generate the planned semesters automatically.
        </p>

        <div
          class="mt-5 border-2 border-dashed rounded-2xl p-8 transition-colors text-center cursor-pointer relative"
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
            <div class="font-semibold text-lg">{{ importFile.name }}</div>
            <div class="text-xs text-base-content/50">
              {{ (importFile.size / 1024).toFixed(1) }} KB
            </div>
            <button class="btn btn-xs btn-ghost text-error" @click.stop="importFile = null">
              Remove
            </button>
          </div>

          <div v-else class="space-y-2">
            <div class="font-semibold">Click to upload or drag and drop</div>
            <div class="text-xs text-base-content/50">
              Excel files (.xlsx or .xls)
            </div>
          </div>
        </div>

        <div v-if="importResult" class="mt-5 rounded-2xl border border-success/20 bg-success/5 p-4 text-sm">
          <div class="font-semibold text-success">Import complete</div>
          <div class="mt-2">
            {{ importResult.total_rules_parsed }} credit group{{ importResult.total_rules_parsed === 1 ? "" : "s" }} parsed,
            {{ importResult.rules_inserted }} saved,
            {{ importResult.journey_slots_inserted }} system-generated planned semester row{{ importResult.journey_slots_inserted === 1 ? "" : "s" }} created
            <span v-if="importResult.exception_windows_inserted">
              , {{ importResult.exception_windows_inserted }} system-generated credit adjustment rule{{ importResult.exception_windows_inserted === 1 ? "" : "s" }} saved
            </span>.
          </div>
          <div v-if="importResult.overlap_standardization_count" class="mt-2 text-base-content/70">
            {{ importResult.overlap_standardization_count }} legacy overlap{{ importResult.overlap_standardization_count === 1 ? "" : "s" }} defaulted to the lowest semester.
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeImportModal">
            {{ importResult ? "Close" : "Cancel" }}
          </button>
          <button
            v-if="!importResult"
            class="btn btn-primary"
            :disabled="isImporting || !importFile"
            @click="importRules"
          >
            {{ isImporting ? "Importing..." : "Import" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeImportModal">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': isLifecycleModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-xl">Edit Intake Lifecycle</h3>
        <p class="text-sm text-base-content/60 mt-1">
          Set how long and short semesters repeat for this intake. The system will apply this pattern automatically in planned semesters.
        </p>

        <div v-if="editingIntakeLifecycle" class="mt-5 rounded-2xl border border-base-200 bg-base-200/20 p-4">
          <div class="text-sm text-base-content/60">Intake</div>
          <div class="mt-1 font-semibold">{{ editingIntakeLifecycle.intake_type }}</div>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span class="badge badge-outline badge-sm">
              Current: {{ editingIntakeLifecycle.lifecycle_summary }}
            </span>
            <span
              v-if="editingIntakeLifecycle.source === 'default'"
              class="badge badge-ghost badge-sm"
            >
              Default
            </span>
          </div>
        </div>

        <div class="grid gap-4 mt-6 md:grid-cols-3">
          <label
            v-for="(step, index) in intakeLifecycleForm.lifecycle_pattern"
            :key="`lifecycle-step-${index}`"
            class="form-control"
          >
            <span class="label-text font-semibold mb-1">
              Cycle Step {{ index + 1 }}
            </span>
            <select
              v-model="intakeLifecycleForm.lifecycle_pattern[index]"
              class="select select-bordered"
            >
              <option
                v-for="option in lifecycleStepOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="mt-5 rounded-2xl border border-base-200 bg-base-100 p-4">
          <div class="text-sm text-base-content/60">Applied Pattern</div>
          <div class="mt-1 font-semibold">
            {{ formatLifecycleSummary(intakeLifecycleForm.lifecycle_pattern) }}
          </div>
          <p class="text-sm text-base-content/60 mt-2">
            LI and FYP2 will still stay in long semesters even when the repeating pattern says otherwise.
          </p>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeLifecycleModal">Cancel</button>
          <button class="btn btn-primary" :disabled="isSavingLifecycle" @click="saveIntakeLifecycle">
            {{ isSavingLifecycle ? "Saving..." : "Save Lifecycle" }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeLifecycleModal">
        <button>close</button>
      </form>
    </dialog>

    <dialog class="modal" :class="{ 'modal-open': isJourneyModalOpen }">
      <div class="modal-box flex max-h-[92vh] w-11/12 max-w-6xl flex-col overflow-hidden p-0">
        <div class="p-6 border-b border-base-200 bg-base-100 space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
              <div class="badge badge-ghost badge-sm mb-2">Semester Setup</div>
              <h3 class="font-bold text-xl">Set Planned Semesters</h3>
              <div v-if="journeyRule" class="text-sm text-base-content/60 mt-3 flex flex-wrap gap-2">
                <span class="badge badge-ghost badge-sm">{{ journeyRule.intake_type }}</span>
                <span class="badge badge-outline badge-sm">{{ getCoverageLabel(journeyRule) }}</span>
                <span class="badge badge-primary badge-sm">Starts In Sem {{ journeyRule.entry_semester }}</span>
              </div>
            </div>
            <div class="rounded-2xl border border-base-200 bg-base-200/30 px-4 py-3 text-sm text-base-content/60 max-w-lg">
              HOP arranges the semester order and purpose here. The intake lifecycle fills the long and short semester pattern automatically, and the system later calculates credits from remaining courses.
            </div>
          </div>

          <div v-if="journeyRule" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-2xl border border-base-200 bg-base-200/20 px-4 py-3">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Credit Group
              </div>
              <div class="mt-1 font-semibold">{{ getTransferredCreditsLabel(journeyRule) }}</div>
            </div>
            <div class="rounded-2xl border border-base-200 bg-base-200/20 px-4 py-3">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Planned Semesters
              </div>
              <div class="mt-1 font-semibold">
                {{ journeySlots.length }} semester{{ journeySlots.length === 1 ? "" : "s" }}
              </div>
            </div>
            <div class="rounded-2xl border border-base-200 bg-base-200/20 px-4 py-3">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Intake Lifecycle
              </div>
              <div class="mt-1 font-semibold">{{ getJourneyLifecycleSummary() }}</div>
            </div>
            <div class="rounded-2xl border border-base-200 bg-base-200/20 px-4 py-3">
              <div class="text-xs uppercase tracking-wide font-semibold text-base-content/50">
                Credit Adjustment Rules
              </div>
              <div class="mt-1 font-semibold">
                {{ journeyExceptionWindows.length }} saved
              </div>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto bg-base-200/20 p-6 space-y-6">
          <div v-if="isLoadingJourney" class="flex justify-center py-16">
            <span class="loading loading-spinner loading-lg text-primary"></span>
          </div>

          <template v-else>
            <div v-if="journeyValidationIssues.length > 0" class="alert alert-warning shadow-sm">
              <div class="space-y-2">
                <div class="font-semibold">Validation issues</div>
                <ul class="list-disc list-inside text-sm">
                  <li v-for="(issue, index) in journeyValidationIssues" :key="`${issue.code}-${index}`">
                    {{ issue.message }}
                  </li>
                </ul>
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-4">
              <div
                v-for="option in roleOptions"
                :key="option.value"
                class="rounded-2xl border border-base-200 bg-base-100 p-4"
              >
                <div :class="getRoleBadgeClass(option.value)">{{ option.label }}</div>
                <p class="text-sm text-base-content/60 mt-2">{{ option.helper }}</p>
              </div>
            </div>

            <div class="card bg-base-100 border border-base-200 shadow-sm">
              <div class="card-body gap-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 class="font-semibold">Planned Semesters</h4>
                    <p class="text-sm text-base-content/60">
                      Arrange the semesters in the order the student should take them. Semester numbers are filled automatically from the starting semester, and semester types follow the intake lifecycle automatically. Program Structure is used later to place actual courses into this saved semester flow.
                    </p>
                  </div>
                </div>

                <div class="space-y-3">
                  <div
                    v-for="(slot, index) in journeySlots"
                    :key="`${slot.slot_order}-${index}`"
                    class="rounded-2xl border border-base-200 bg-base-200/20 p-4 md:p-5"
                  >
                    <div class="grid gap-4 lg:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                      <div class="min-w-[96px] rounded-xl border border-base-200 bg-base-100 px-3 py-3">
                        <div class="text-xs uppercase tracking-wide font-bold text-base-content/40">
                          Derived Semester
                        </div>
                        <div class="text-lg font-bold mt-1">
                          Sem {{ journeyRule ? getDerivedSemesterNumber(journeyRule.entry_semester, slot.slot_order) : slot.slot_order }}
                        </div>
                      </div>

                      <div class="min-w-[96px] rounded-xl border border-base-200 bg-base-100 px-3 py-3">
                        <div class="text-xs uppercase tracking-wide font-bold text-base-content/40">
                          Sequence
                        </div>
                        <div class="mt-1 font-semibold">{{ slot.slot_order }}</div>
                      </div>

                      <div class="rounded-xl border border-base-200 bg-base-100 px-3 py-3">
                        <div class="text-xs uppercase tracking-wide font-bold text-base-content/40">
                          Semester Type
                        </div>
                        <div class="mt-1 font-semibold">
                          {{ getSemesterTypeLabel(slot.semester_type) }}
                        </div>
                        <div class="text-xs text-base-content/50 mt-1">
                          From intake lifecycle
                        </div>
                      </div>

                      <label class="form-control">
                        <span class="label-text font-medium mb-1">Semester Purpose</span>
                        <select
                          v-model="slot.slot_role"
                          class="select select-bordered"
                          @change="handleJourneyRoleChange(index)"
                        >
                          <option v-for="option in roleOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                      </label>

                      <div class="flex items-center justify-end gap-2">
                        <button class="btn btn-square btn-sm btn-ghost" :disabled="index === 0" @click="moveJourneySlot(index, -1)">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                          </svg>
                        </button>
                        <button class="btn btn-square btn-sm btn-ghost" :disabled="index === journeySlots.length - 1" @click="moveJourneySlot(index, 1)">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                        <button class="btn btn-square btn-sm btn-ghost text-error" @click="removeJourneySlot(index)">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card bg-base-100 border border-base-200 shadow-sm">
              <div class="card-body gap-4">
                <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div>
                    <h4 class="font-semibold">Credit Adjustment Rules</h4>
                    <p class="text-sm text-base-content/60">
                      Review only the transferred-credit cases where a semester needs a different allowed total from the normal guideline.
                    </p>
                  </div>
                  <div class="flex w-full flex-wrap justify-end gap-2 lg:ml-auto lg:w-auto">
                    <button
                      v-if="journeyExceptionWindowSuggestions.length > 0"
                      class="btn btn-sm btn-info text-info-content shadow-sm"
                      @click="applyAllSuggestedExceptionWindows"
                    >
                      Accept All Suggestions
                    </button>
                    <button
                      class="btn btn-sm btn-outline btn-primary"
                      @click="showAdvancedSpecialCases = !showAdvancedSpecialCases"
                    >
                      {{ showAdvancedSpecialCases ? "Hide Advanced Edit" : "Advanced Edit" }}
                    </button>
                  </div>
                </div>

                <div
                  v-if="journeyExceptionWindowSuggestions.length > 0"
                  class="overflow-hidden rounded-2xl border border-info/25 bg-gradient-to-br from-info/8 via-base-100 to-base-100 shadow-sm"
                >
                  <div class="border-b border-info/15 bg-info/6 px-5 py-4">
                    <div class="flex items-start justify-between gap-3">
                      <div class="space-y-1">
                        <div class="font-semibold text-base-content">
                          Suggested credit adjustments
                        </div>
                        <p class="max-w-3xl text-sm leading-relaxed text-base-content/65">
                          These are the transferred-credit cases or ranges that would otherwise create an illogical extra semester or break the normal credit guideline.
                        </p>
                      </div>
                      <span class="badge badge-info badge-md whitespace-nowrap">
                        {{ journeyExceptionWindowSuggestions.length }} ready
                      </span>
                    </div>
                  </div>

                  <div class="grid gap-4 p-5 xl:grid-cols-2">
                    <div
                      v-for="(window, index) in journeyExceptionWindowSuggestions"
                      :key="`suggestion-${index}-${window.slot_order}-${window.transfer_min}`"
                      class="overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-sm"
                    >
                      <div class="border-b border-base-200/80 px-4 py-4">
                        <div class="flex items-start justify-between gap-4">
                          <div class="space-y-2">
                            <div class="flex flex-wrap items-center gap-2">
                              <div class="text-lg font-semibold leading-tight text-base-content">
                                {{ getWindowTransferLabel(window) }}
                              </div>
                              <span class="badge badge-outline badge-sm">
                                {{ getWindowCoverageBadgeLabel(window) }}
                              </span>
                              <span
                                class="badge badge-sm"
                                :class="getSuggestionSourceBadgeClass(window)"
                              >
                                {{ getSuggestionSourceLabel(window) }}
                              </span>
                            </div>
                            <div class="text-sm font-medium text-base-content/70">
                              {{ getReadableSlotSummaryLabel(window.slot_order) }}
                            </div>
                            <div class="text-xs text-base-content/50">
                              {{ getWindowCoverageSummary(window) }}
                            </div>
                          </div>
                          <button
                            class="btn btn-sm btn-primary min-w-20"
                            @click="applySuggestedExceptionWindow(window)"
                          >
                            Apply
                          </button>
                        </div>
                      </div>

                      <div class="grid gap-3 px-4 py-4 sm:grid-cols-3">
                        <div class="rounded-xl bg-warning/10 px-3 py-3">
                          <div class="text-[11px] font-semibold uppercase tracking-wide text-warning-content/70">
                            Allowed total
                          </div>
                          <div class="mt-1 text-sm font-semibold text-base-content">
                            {{ getWindowAllowedCreditValueText(window) }}
                          </div>
                        </div>

                        <div
                          v-if="getWindowGuidelineText(window)"
                          class="rounded-xl bg-base-200/60 px-3 py-3"
                        >
                          <div class="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                            Normal guide
                          </div>
                          <div class="mt-1 text-sm font-semibold text-base-content">
                            {{ getWindowGuidelineValueText(window) }}
                          </div>
                        </div>

                        <div class="rounded-xl border border-base-200 px-3 py-3">
                          <div class="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                            Adjustment
                          </div>
                          <div class="mt-1 text-sm font-semibold text-base-content">
                            {{ getWindowAdjustmentText(window) }}
                          </div>
                        </div>
                      </div>

                      <div
                        v-if="window.default_reason"
                        class="border-t border-base-200/80 bg-base-200/25 px-4 py-3 text-sm text-base-content/60"
                      >
                        {{ window.default_reason }}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="journeyExceptionWindows.length > 0"
                  class="rounded-2xl border border-base-200 bg-base-200/20 p-4"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="font-medium">Approved credit adjustments</div>
                      <p class="text-sm text-base-content/60 mt-1">
                        These saved rules tell the system exactly which transferred-credit cases may use a different semester total.
                      </p>
                    </div>
                    <span class="badge badge-ghost badge-sm">
                      {{ journeyExceptionWindows.length }} saved
                    </span>
                  </div>

                  <div class="mt-4 grid gap-3 xl:grid-cols-2">
                    <div
                      v-for="(window, index) in journeyExceptionWindows"
                      :key="`window-summary-${index}-${window.slot_order}-${window.transfer_min}-${window.transfer_max}`"
                      class="rounded-2xl border border-base-200 bg-base-100 p-4"
                    >
                      <div class="font-medium">
                        {{ getWindowTransferLabel(window) }}
                      </div>
                      <div class="text-sm text-base-content/60 mt-1">
                        {{ getReadableSlotSummaryLabel(window.slot_order) }}
                      </div>
                      <div class="mt-3 flex flex-wrap gap-2 text-xs">
                        <span class="badge badge-warning badge-sm">
                          {{ getWindowAllowedCreditText(window) }}
                        </span>
                        <span
                          v-if="getWindowGuidelineText(window)"
                          class="badge badge-ghost badge-sm"
                        >
                          {{ getWindowGuidelineText(window) }}
                        </span>
                        <span class="badge badge-outline badge-sm">
                          {{ getWindowAdjustmentText(window) }}
                        </span>
                      </div>
                      <div
                        v-if="window.default_reason"
                        class="mt-3 text-sm text-base-content/60"
                      >
                        {{ window.default_reason }}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-else-if="journeyExceptionWindowSuggestions.length === 0"
                  class="rounded-2xl border border-dashed border-base-300 bg-base-200/20 p-6 text-sm text-base-content/60"
                >
                  No credit adjustment rules are needed right now. If the preview already balances well inside the planned semesters, you can leave this section as it is.
                </div>

                <div v-if="showAdvancedSpecialCases" class="rounded-2xl border border-base-200 bg-base-100 p-4 space-y-3">
                  <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div>
                      <div class="font-medium">Advanced edit</div>
                      <p class="text-sm text-base-content/60 mt-1">
                        Use this only if you need to fine-tune a saved credit adjustment manually.
                      </p>
                    </div>
                    <button class="btn btn-sm btn-outline" @click="addExceptionWindow()">
                      Add Credit Adjustment
                    </button>
                  </div>

                  <div
                    v-if="journeyExceptionWindows.length === 0"
                    class="rounded-2xl border border-dashed border-base-300 bg-base-200/20 p-6 text-sm text-base-content/60"
                  >
                    No saved credit adjustment rules yet. Use the suggestions above or add one manually.
                  </div>

                  <template v-else>
                    <div
                      v-for="(window, index) in journeyExceptionWindows"
                      :key="`window-${index}-${window.slot_order}-${window.transfer_min}-${window.transfer_max}`"
                      class="rounded-2xl border border-base-200 bg-base-200/20 p-4"
                    >
                      <div class="mb-3 flex flex-wrap items-center gap-2">
                        <div class="font-medium">
                          {{ getWindowTransferLabel(window) }}
                        </div>
                        <span class="badge badge-outline badge-sm">
                          {{ getWindowCoverageBadgeLabel(window) }}
                        </span>
                        <span class="text-xs text-base-content/50">
                          {{ getWindowCoverageSummary(window) }}
                        </span>
                      </div>

                      <div class="mb-3 flex flex-wrap gap-2 text-xs">
                        <span class="badge badge-warning badge-sm">
                          {{ getWindowAllowedCreditText(window) }}
                        </span>
                        <span
                          v-if="getWindowGuidelineText(window)"
                          class="badge badge-ghost badge-sm"
                        >
                          {{ getWindowGuidelineText(window) }}
                        </span>
                        <span class="badge badge-outline badge-sm">
                          {{ getWindowAdjustmentText(window) }}
                        </span>
                      </div>

                      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.5fr)_auto] xl:items-end">
                        <div class="grid grid-cols-2 gap-3">
                          <label class="form-control">
                            <span class="label-text font-medium mb-1">Transfer Min</span>
                            <input
                              v-model.number="window.transfer_min"
                              type="number"
                              min="0"
                              class="input input-bordered"
                            />
                          </label>
                          <label class="form-control">
                            <span class="label-text font-medium mb-1">Transfer Max</span>
                            <input
                              v-model.number="window.transfer_max"
                              type="number"
                              min="0"
                              class="input input-bordered"
                            />
                          </label>
                        </div>

                        <label class="form-control">
                            <span class="label-text font-medium mb-1">Semester</span>
                          <select
                            v-model.number="window.slot_order"
                            class="select select-bordered"
                          >
                            <option
                              v-for="option in journeySlotOptions"
                              :key="`slot-option-${option.value}`"
                              :value="option.value"
                            >
                              {{ option.label }}
                            </option>
                          </select>
                        </label>

                        <label class="form-control">
                          <span class="label-text font-medium mb-1">Overload</span>
                          <input
                            v-model.number="window.allowed_overload_credits"
                            type="number"
                            min="0"
                            class="input input-bordered"
                          />
                        </label>

                        <label class="form-control">
                          <span class="label-text font-medium mb-1">Underload</span>
                          <input
                            v-model.number="window.allowed_underload_credits"
                            type="number"
                            min="0"
                            class="input input-bordered"
                          />
                        </label>

                        <label class="form-control">
                          <span class="label-text font-medium mb-1">Reason</span>
                          <input
                            v-model="window.default_reason"
                            type="text"
                            class="input input-bordered"
                            placeholder="Optional default explanation"
                          />
                        </label>

                        <div class="flex justify-end">
                          <button
                            class="btn btn-square btn-sm btn-ghost text-error"
                            @click="removeExceptionWindow(index)"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <div class="card bg-base-100 border border-base-200 shadow-sm">
              <div class="card-body gap-4">
                <div>
                  <h4 class="font-semibold">Example Plan Result</h4>
                  <p class="text-sm text-base-content/60">
                    Representative scenarios show how the current saved semester setup and credit adjustment rules would distribute the planned credit journey across the group.
                  </p>
                </div>

                <div v-if="journeyPreviewScenarios.length === 0" class="rounded-2xl border border-dashed border-base-300 bg-base-200/20 p-6 text-sm text-base-content/60">
                  Save the planned semesters to refresh the example plan results.
                </div>

                <div v-else class="grid gap-4 xl:grid-cols-3">
                  <div
                    v-for="scenario in journeyPreviewScenarios"
                    :key="scenario.label"
                    class="rounded-2xl border border-base-200 bg-base-200/20 p-4"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="text-xs uppercase tracking-wide font-bold text-primary">
                          {{ scenario.label }}
                        </div>
                        <div class="font-semibold mt-1">
                          {{ scenario.transferred_credits }} transferred credits
                        </div>
                      </div>
                      <span class="badge badge-ghost badge-sm">
                      {{ scenario.estimated_remaining_credits }} remaining
                    </span>
                  </div>

                    <div v-if="scenario.auto_appended_slots > 0" class="text-xs text-warning mt-3">
                      {{ scenario.auto_appended_slots }} extra regular semester{{ scenario.auto_appended_slots === 1 ? "" : "s" }} would be added.
                    </div>

                    <div class="mt-4 space-y-2">
                      <div
                        v-for="semester in scenario.semesters"
                        :key="`${scenario.label}-${semester.semester_number}-${semester.slot_role}`"
                        class="flex items-center justify-between rounded-xl border border-base-200 bg-base-100 px-3 py-2 text-sm"
                      >
                        <div class="flex items-center gap-2">
                          <span class="font-semibold">
                            Sem {{ semester.semester_number }}
                          </span>
                          <span class="badge badge-ghost badge-sm">{{ semester.semester_type }}</span>
                          <span :class="getRoleBadgeClass(semester.slot_role)">
                            {{ getRoleLabel(semester.slot_role) }}
                          </span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="font-medium">{{ semester.estimated_credits }} Cr</span>
                          <span v-if="semester.is_credit_exception" class="badge badge-warning badge-sm">
                            Exception
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="p-4 border-t border-base-200 bg-base-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="text-sm text-base-content/60">
            Review the example plan result before saving if you want to confirm the semester flow.
          </div>
          <div class="flex justify-end gap-3">
            <button class="btn btn-ghost" @click="closeJourneyModal">Close</button>
            <button class="btn btn-primary" :disabled="isSavingJourney || isLoadingJourney" @click="saveJourney">
              {{ isSavingJourney ? "Saving..." : "Save Planned Semesters" }}
            </button>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeJourneyModal">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
