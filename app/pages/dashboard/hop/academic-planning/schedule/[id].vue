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

const route = useRoute();
const planId = route.params.id as string;

// Types
interface Course {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  status: "Planned" | "Transferred" | "Passed" | "Failed";
}

interface Semester {
  semester: number;
  courses: Course[];
  total_credits: number;
}

interface PlanData {
  plan: {
    id: number;
    status: "draft" | "approved" | "completed";
    start_semester: number;
    created_at: string;
    intake_name: string | null;
    intake_year: string | null;
  };
  student: {
    id: number;
    matric_no: string;
    name: string;
    email: string;
    total_credit_transferred: number | null;
  };
  semesters: Semester[];
  summary: {
    total_semesters: number;
    total_credits: number;
    transferred_credits: number;
    planned_credits: number;
    total_courses: number;
  };
}

interface AvailableCourse {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  default_semester: number;
  course_type: string;
  course_group: string | null;
  prerequisite_course_id: number | null;
  prerequisite_code: string | null;
}

interface SemesterRule {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
}

interface CreditLimits {
  long_min: number;
  long_max: number;
  short_min: number;
  short_max: number;
}

// Fetch plan data
const {
  data: planData,
  pending: loading,
  refresh: refreshPlan,
} = await useFetch<PlanData>(`/api/hop/academic-planning/plan/${planId}`);

// Fetch available courses + semester rules + credit limits
const { data: coursesData, pending: coursesLoading } = await useFetch<{
  courses: AvailableCourse[];
  semester_rules: SemesterRule[];
  credit_limits: CreditLimits;
  base_credit_limits: CreditLimits;
  cgpa: number | null;
  on_probation: boolean;
  retake_courses: AvailableCourse[];
  max_program_semester: number;
}>(`/api/hop/academic-planning/plan/${planId}/courses`);

// Check if plan exists or not draft
if (
  !loading.value &&
  (!planData.value || planData.value.plan.status !== "draft")
) {
  await navigateTo(`/dashboard/hop/academic-planning/student/${planId}`);
}

// State
const selectedSemester = ref<number | null>(null);
const saveLoading = ref(false);
const courseAssignments = ref<Map<number, number>>(new Map()); // course_id -> semester
const showProgramStructure = ref(true);

// Drag-and-drop state
const draggedCourseId = ref<number | null>(null);
const isDragging = ref(false);
const dragOverSemester = ref<number | null>(null);
const dragSource = ref<'pool' | 'column'>('pool');
const searchQuery = ref('');
const toastMessage = ref('');
const toastType = ref<'error' | 'success' | 'warning'>('error');
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

// Initialize course assignments from plan data (only from start_semester onwards)
watchEffect(() => {
  if (planData.value && coursesData.value) {
    const startSem = planData.value.plan.start_semester || 1;
    const newMap = new Map<number, number>();
    const semRules = coursesData.value.semester_rules;
    const allAvailable = [
      ...(coursesData.value.courses || []),
      ...(coursesData.value.retake_courses || []),
    ];
    for (const semester of planData.value.semesters) {
      // Only track assignments from start_semester onwards
      if (semester.semester >= startSem) {
        const rule = semRules.find(
          (r) => r.semester_number === semester.semester,
        );
        for (const course of semester.courses) {
          // Track planned, passed, and failed courses (not transferred)
          if (course.status !== "Transferred") {
            // In LI semesters, planned non-IT courses are unassigned (appear in pool)
            if (rule?.is_li && course.status === "Planned") {
              const detail = allAvailable.find(
                (c) => c.course_id === course.course_id,
              );
              if (detail && detail.course_type !== "Industrial Training")
                continue;
            }
            newMap.set(course.course_id, semester.semester);
          }
        }
      }
    }
    courseAssignments.value = newMap;
  }
});

// Get transferred courses
const transferredCourses = computed(() => {
  if (!planData.value) return [];

  const transferred: Course[] = [];
  for (const semester of planData.value.semesters) {
    for (const course of semester.courses) {
      if (course.status === "Transferred") {
        transferred.push(course);
      }
    }
  }
  return transferred;
});

// Get passed courses (locked, completed successfully)
const passedCourses = computed(() => {
  if (!planData.value) return [];

  const passed: (Course & { semester: number })[] = [];
  for (const semester of planData.value.semesters) {
    for (const course of semester.courses) {
      if (course.status === "Passed") {
        passed.push({ ...course, semester: semester.semester });
      }
    }
  }
  return passed;
});

// Get failed courses (locked in original semester, but need retaking)
const failedCourses = computed(() => {
  if (!planData.value) return [];

  const failed: (Course & { semester: number })[] = [];
  for (const semester of planData.value.semesters) {
    for (const course of semester.courses) {
      if (course.status === "Failed") {
        failed.push({ ...course, semester: semester.semester });
      }
    }
  }
  return failed;
});

// IDs of courses that failed (need retaking — not a valid prereq)
const failedCourseIds = computed(() => {
  const ids = new Set<number>();
  for (const c of failedCourses.value) ids.add(c.course_id);
  for (const c of passedCourses.value) ids.delete(c.course_id);
  return ids;
});

// IDs of courses that are locked (transferred or passed/failed)
const lockedCourseIds = computed(() => {
  const ids = new Set<number>();
  for (const c of transferredCourses.value) ids.add(c.course_id);
  for (const c of passedCourses.value) ids.add(c.course_id);
  for (const c of failedCourses.value) ids.add(c.course_id);
  return ids;
});

// Get only planned courses (not transferred/passed/failed - available for assignment)
const plannedCourses = computed(() => {
  if (!coursesData.value) return [];

  // Filter out transferred and passed/failed courses
  return coursesData.value.courses.filter(
    (c) => !lockedCourseIds.value.has(c.course_id),
  );
});

// Get retake courses (failed, need rescheduling)
const retakeCourses = computed(() => {
  if (!coursesData.value?.retake_courses) return [];
  return coursesData.value.retake_courses.filter((c) => {
    const assignedSem = courseAssignments.value.get(c.course_id);
    if (assignedSem === undefined) return true;
    const originalFailed = failedCourses.value.find(
      (f) => f.course_id === c.course_id,
    );
    return originalFailed && assignedSem === originalFailed.semester;
  });
});

// Track extra semesters added by user
const extraSemesters = ref<number[]>([]);

// Get unique semesters from available courses (starting from student's start_semester)
const availableSemesters = computed(() => {
  const semesters = new Set<number>();
  const startSem = planData.value?.plan.start_semester || 1;

  if (coursesData.value) {
    for (const course of coursesData.value.courses) {
      // Only include semesters >= student's start semester
      if (course.default_semester >= startSem) {
        semesters.add(course.default_semester);
      }
    }
    // Include semesters from extended rules (for retake scheduling)
    for (const rule of coursesData.value.semester_rules) {
      if (rule.semester_number >= startSem) {
        semesters.add(rule.semester_number);
      }
    }
  }
  // Include semesters from existing plan data (auto-extended during generation)
  if (planData.value) {
    for (const semester of planData.value.semesters) {
      if (semester.semester >= startSem) {
        semesters.add(semester.semester);
      }
    }
  }
  // Include user-added extra semesters
  for (const s of extraSemesters.value) semesters.add(s);
  return Array.from(semesters).sort((a, b) => a - b);
});

// Add an extra semester, determining type from the actual preceding semester pattern
const addSemester = () => {
  const allSems = availableSemesters.value;
  const nextSem = allSems.length > 0 ? Math.max(...allSems) + 1 : 1;
  extraSemesters.value.push(nextSem);
  if (coursesData.value) {
    const existing = coursesData.value.semester_rules.find(
      (r) => r.semester_number === nextSem,
    );
    if (!existing) {
      // Detect cycle pattern (L/L/S or S/L/L) from non-LI semesters
      const posLong = [0, 0, 0];
      const posTotal = [0, 0, 0];
      for (const r of coursesData.value.semester_rules) {
        if (!r.is_li) {
          const pos = (r.semester_number - 1) % 3;
          posTotal[pos]++;
          if (r.semester_type === "L") posLong[pos]++;
        }
      }
      const cycle = posTotal.map((total, i) =>
        total === 0 ? "L" : posLong[i] >= total / 2 ? "L" : "S",
      );
      coursesData.value.semester_rules.push({
        semester_number: nextSem,
        semester_type: cycle[(nextSem - 1) % 3] as "L" | "S",
        is_li: false,
        target_credits: 0,
      });
    }
  }
};

// Configure Plan modal
const isConfigModalOpen = ref(false);
const editableRules = ref<SemesterRule[]>([]);

const detectCycle = (rules: SemesterRule[]): ("L" | "S")[] => {
  const posLong = [0, 0, 0];
  const posTotal = [0, 0, 0];
  for (const r of rules) {
    if (!r.is_li) {
      const pos = (r.semester_number - 1) % 3;
      posTotal[pos]++;
      if (r.semester_type === "L") posLong[pos]++;
    }
  }
  return posTotal.map((total, i) =>
    total === 0 ? "L" : posLong[i] >= total / 2 ? "L" : "S",
  ) as ("L" | "S")[];
};

const openConfigModal = () => {
  editableRules.value = JSON.parse(
    JSON.stringify(coursesData.value?.semester_rules || []),
  );
  isConfigModalOpen.value = true;
};

const addConfigSemester = () => {
  const maxSem =
    editableRules.value.length > 0
      ? Math.max(...editableRules.value.map((r) => r.semester_number))
      : 0;
  const nextSem = maxSem + 1;
  const cycle = detectCycle(editableRules.value);
  editableRules.value.push({
    semester_number: nextSem,
    semester_type: cycle[(nextSem - 1) % 3],
    is_li: false,
    target_credits: 0,
  });
};

const removeConfigSemester = (index: number) => {
  editableRules.value.splice(index, 1);
};

const getConfigCreditRange = (rule: SemesterRule) => {
  const limits = coursesData.value?.credit_limits;
  if (!limits || rule.is_li) return null;
  return rule.semester_type === "L"
    ? { min: limits.long_min, max: limits.long_max }
    : { min: limits.short_min, max: limits.short_max };
};

const hasLockedCoursesInSemester = (semNum: number): boolean => {
  for (const [courseId, sem] of courseAssignments.value) {
    if (sem !== semNum) continue;
    if (
      passedCourses.value.some((c) => c.course_id === courseId) ||
      failedCourses.value.some((c) => c.course_id === courseId)
    )
      return true;
  }
  return false;
};

const applyConfig = () => {
  if (!coursesData.value) return;
  const oldRules = coursesData.value.semester_rules;
  for (const rule of editableRules.value) {
    const old = oldRules.find(
      (r) => r.semester_number === rule.semester_number,
    );
    if (old && old.semester_type !== rule.semester_type) {
      rule.target_credits = 0;
    }
  }
  coursesData.value.semester_rules = editableRules.value;
  const allRuleSems = new Set(
    editableRules.value.map((r) => r.semester_number),
  );
  for (const sem of allRuleSems) {
    if (!extraSemesters.value.includes(sem)) {
      extraSemesters.value.push(sem);
    }
  }
  isConfigModalOpen.value = false;
};

// Get program structure grouped by semester (show ALL semesters for reference)
const programStructure = computed(() => {
  if (!coursesData.value) return new Map<number, AvailableCourse[]>();

  const structure = new Map<number, AvailableCourse[]>();
  for (const course of coursesData.value.courses) {
    if (!structure.has(course.default_semester)) {
      structure.set(course.default_semester, []);
    }
    structure.get(course.default_semester)!.push(course);
  }
  return structure;
});

// Check if a course is transferred
const isTransferred = (courseId: number): boolean => {
  return transferredCourses.value.some((c) => c.course_id === courseId);
};

// Check if a course is locked (passed/failed — cannot be removed or reassigned)
const isLocked = (courseId: number): boolean => {
  return (
    passedCourses.value.some((c) => c.course_id === courseId) ||
    failedCourses.value.some((c) => c.course_id === courseId)
  );
};

// Check if a course is assigned
const isAssigned = (courseId: number): boolean => {
  return courseAssignments.value.has(courseId);
};

// Get course group for a course
const getCourseGroup = (courseId: number): string | null => {
  const course = coursesData.value?.courses.find(
    (c) => c.course_id === courseId,
  );
  return course?.course_group || null;
};

// Get default semester for a course
const getDefaultSemester = (courseId: number): number | null => {
  const course = coursesData.value?.courses.find(
    (c) => c.course_id === courseId,
  );
  return course?.default_semester ?? null;
};

// Check if another course from the same group AND same default semester is already assigned
const isGroupAlreadyAssigned = (courseId: number): boolean => {
  const courseGroup = getCourseGroup(courseId);
  const defaultSem = getDefaultSemester(courseId);
  if (!courseGroup || defaultSem === null) return false;

  // Check if any other course with the same group AND same default semester is assigned
  for (const [assignedId] of courseAssignments.value) {
    if (
      assignedId !== courseId &&
      getCourseGroup(assignedId) === courseGroup &&
      getDefaultSemester(assignedId) === defaultSem
    ) {
      return true;
    }
  }
  // Also check transferred courses
  for (const tc of transferredCourses.value) {
    if (tc.course_id !== courseId) {
      const tcGroup = getCourseGroup(tc.course_id);
      const tcSem = getDefaultSemester(tc.course_id);
      if (tcGroup === courseGroup && tcSem === defaultSem) {
        return true;
      }
    }
  }
  return false;
};

// Get the assigned course from a group (same default semester)
const getAssignedFromGroup = (courseId: number): string | null => {
  const courseGroup = getCourseGroup(courseId);
  const defaultSem = getDefaultSemester(courseId);
  if (!courseGroup || defaultSem === null) return null;

  for (const [assignedId] of courseAssignments.value) {
    if (
      assignedId !== courseId &&
      getCourseGroup(assignedId) === courseGroup &&
      getDefaultSemester(assignedId) === defaultSem
    ) {
      const course = coursesData.value?.courses.find(
        (c) => c.course_id === assignedId,
      );
      return course?.course_code || null;
    }
  }
  for (const tc of transferredCourses.value) {
    if (tc.course_id !== courseId) {
      const tcGroup = getCourseGroup(tc.course_id);
      const tcSem = getDefaultSemester(tc.course_id);
      if (tcGroup === courseGroup && tcSem === defaultSem) {
        return tc.course_code;
      }
    }
  }
  return null;
};

// Check if course should be disabled (group conflict, LI, Long-only, or prereq restriction)
const isCourseDisabled = (courseId: number): boolean => {
  if (isGroupAlreadyAssigned(courseId)) return true;

  if (selectedSemester.value !== null) {
    const rule = getSemesterRule(selectedSemester.value);
    const course = coursesData.value?.courses.find(
      (c) => c.course_id === courseId,
    );
    if (rule && course) {
      // LI semester: only Industrial Training allowed
      if (rule.is_li && course.course_type !== "Industrial Training")
        return true;
      // Non-LI semester: Industrial Training not allowed
      if (!rule.is_li && course.course_type === "Industrial Training")
        return true;
      // Short semester: block FYP2 and Industrial Training (Long semester only)
      if (rule.semester_type === "S" && isLongSemesterOnly(course)) return true;
    }
    // Prerequisite check
    if (course && course.prerequisite_course_id) {
      if (
        !isPrereqSatisfied(
          course.prerequisite_course_id,
          selectedSemester.value,
        )
      )
        return true;
    }
  }
  return false;
};

// Check if a course is Industrial Training type
const isIndustrialTraining = (courseId: number): boolean => {
  const course = coursesData.value?.courses.find(
    (c) => c.course_id === courseId,
  );
  return course?.course_type === "Industrial Training";
};

// Check if a course can only be taken in Long semesters (FYP2. Industrial Training)
const isLongSemesterOnly = (course: AvailableCourse): boolean => {
  if (course.course_type === "Industrial Training") return true;
  if (
    course.course_type === "Final Year Project" &&
    /2|II/i.test(course.course_name)
  )
    return true;
  return false;
};

// Check if a prerequisite is satisfied (must be Passed or Transferred, not Failed)
const isPrereqSatisfied = (
  prereqCourseId: number,
  targetSemester: number,
): boolean => {
  if (transferredCourses.value.some((tc) => tc.course_id === prereqCourseId))
    return true;
  if (failedCourseIds.value.has(prereqCourseId)) return false;
  const assignedSem = courseAssignments.value.get(prereqCourseId);
  if (assignedSem !== undefined && assignedSem < targetSemester) return true;
  return false;
};

// Get reason why a course is disabled (for UI display)
const getCourseDisabledReason = (courseId: number): string | null => {
  if (isGroupAlreadyAssigned(courseId)) {
    return `${getAssignedFromGroup(courseId)} selected`;
  }
  if (selectedSemester.value !== null) {
    const rule = getSemesterRule(selectedSemester.value);
    const course = coursesData.value?.courses.find(
      (c) => c.course_id === courseId,
    );
    if (rule && course) {
      if (rule.is_li && course.course_type !== "Industrial Training")
        return "LI semester only";
      if (!rule.is_li && course.course_type === "Industrial Training")
        return "LI semester only";
      if (rule.semester_type === "S" && isLongSemesterOnly(course))
        return "Long sem. only";
    }
    // Prereq not met
    if (
      course &&
      course.prerequisite_course_id &&
      !isPrereqSatisfied(course.prerequisite_course_id, selectedSemester.value)
    ) {
      return `Prereq: ${course.prerequisite_code}`;
    }
  }
  return null;
};

// Get assignment semester for a course
const getAssignedSemester = (courseId: number): number | null => {
  return courseAssignments.value.get(courseId) ?? null;
};

// Calculate credits for a semester
const getSemesterCredits = (sem: number) => {
  let credits = 0;
  for (const [courseId, semester] of courseAssignments.value) {
    if (semester === sem) {
      const course =
        plannedCourses.value.find((c) => c.course_id === courseId) ||
        passedCourses.value.find((c) => c.course_id === courseId) ||
        coursesData.value?.retake_courses?.find(
          (c) => c.course_id === courseId,
        );
      if (course) credits += course.credit_hour;
    }
  }
  return credits;
};

// Calculate total assigned credits
const totalAssignedCredits = computed(() => {
  let total = 0;
  for (const [courseId] of courseAssignments.value) {
    const course =
      plannedCourses.value.find((c) => c.course_id === courseId) ||
      passedCourses.value.find((c) => c.course_id === courseId) ||
      coursesData.value?.retake_courses?.find((c) => c.course_id === courseId);
    if (course) total += course.credit_hour;
  }
  return total;
});

// Calculate total planned credits from program structure (not from plan details)
const totalPlannedCredits = computed(() => {
  return plannedCourses.value.reduce((sum, c) => sum + c.credit_hour, 0);
});

// Get semester rule for a given semester number
const getSemesterRule = (sem: number): SemesterRule | null => {
  if (!coursesData.value?.semester_rules) return null;
  return (
    coursesData.value.semester_rules.find((r) => r.semester_number === sem) ||
    null
  );
};

// Get credit limits for a semester based on its type
// Past semesters (all courses passed/failed) use base limits, not probation-restricted limits
const isSemesterCompleted = (sem: number): boolean => {
  let hasCourses = false;
  for (const [courseId, semester] of courseAssignments.value) {
    if (semester === sem) {
      hasCourses = true;
      // A course is only locked AT this semester if it was passed/failed here
      const isLockedHere =
        passedCourses.value.some(
          (c) => c.course_id === courseId && c.semester === sem,
        ) ||
        failedCourses.value.some(
          (c) => c.course_id === courseId && c.semester === sem,
        );
      if (!isLockedHere) return false;
    }
  }
  return hasCourses;
};

const getSemesterLimits = (
  sem: number,
): { min: number; max: number } | null => {
  const rule = getSemesterRule(sem);
  if (!rule || rule.is_li) return null; // LI semesters bypass validation
  const useBase = coursesData.value?.on_probation && isSemesterCompleted(sem);
  const limits = useBase
    ? coursesData.value?.base_credit_limits
    : coursesData.value?.credit_limits;
  if (!limits) return null;
  if (rule.semester_type === "L")
    return { min: limits.long_min, max: limits.long_max };
  return { min: limits.short_min, max: limits.short_max };
};

// Get credit status for a semester: 'ok' | 'over' | 'under' | 'li' | 'empty'
const getSemesterCreditStatus = (sem: number): string => {
  const rule = getSemesterRule(sem);
  if (!rule) return "ok"; // No rule found, can't validate
  if (rule.is_li) return "li";

  const credits = getSemesterCredits(sem);
  if (credits === 0) return "empty";

  const limits = getSemesterLimits(sem);
  if (!limits) return "ok";

  if (credits > limits.max) return "over";
  if (credits < limits.min) return "under";
  return "ok";
};

// Get semester type label
const getSemesterTypeLabel = (sem: number): string => {
  const rule = getSemesterRule(sem);
  if (!rule) return "";
  if (rule.is_li) return "LI";
  return rule.semester_type === "L" ? "Long" : "Short";
};

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};

// Assign course to semester (with group, LI, Long-only, and prereq validation)
const assignCourse = (courseId: number, semester: number) => {
  if (isGroupAlreadyAssigned(courseId)) {
    showToast(`Cannot add — ${getAssignedFromGroup(courseId)} from same group already assigned`, 'error');
    return;
  }

  const rule = getSemesterRule(semester);
  const course =
    coursesData.value?.courses.find((c) => c.course_id === courseId) ||
    coursesData.value?.retake_courses?.find((c) => c.course_id === courseId);
  if (rule && course) {
    if (rule.is_li && course.course_type !== "Industrial Training") {
      showToast('LI semester — only Industrial Training courses allowed', 'error');
      return;
    }
    if (!rule.is_li && course.course_type === "Industrial Training") {
      showToast('Industrial Training can only go in LI semesters', 'error');
      return;
    }
    if (rule.semester_type === "S" && isLongSemesterOnly(course)) {
      showToast(`${course.course_name} — Long semester only`, 'error');
      return;
    }
  }

  if (course && course.prerequisite_course_id) {
    if (!isPrereqSatisfied(course.prerequisite_course_id, semester)) {
      showToast(`Prereq ${course.prerequisite_code} must be completed first`, 'error');
      return;
    }
  }

  // Credit limit check (CGPA probation)
  if (course) {
    const limits = getSemesterLimits(semester);
    if (limits) {
      const currentCredits = getSemesterCredits(semester);
      if (currentCredits + course.credit_hour > limits.max) {
        const reason = coursesData.value?.on_probation
          ? `CGPA below 2.5 — max ${limits.max} cr per semester`
          : `Exceeds max ${limits.max} cr for this semester`;
        showToast(reason, 'error');
        return;
      }
    }
  }

  courseAssignments.value.set(courseId, semester);
};

// Remove course from semester
const removeCourse = (courseId: number) => {
  // Allow removing retake courses (failed courses reassigned to new semesters)
  if (failedCourseIds.value.has(courseId)) {
    courseAssignments.value.delete(courseId);
    return;
  }
  if (isLocked(courseId)) return; // Cannot remove passed/failed courses
  courseAssignments.value.delete(courseId);
};

// Quick assign from program structure - assign to selected semester
const quickAssign = (course: AvailableCourse) => {
  if (
    selectedSemester.value !== null &&
    !isTransferred(course.course_id) &&
    !isAssigned(course.course_id)
  ) {
    assignCourse(course.course_id, selectedSemester.value);
  }
};

// Clear all course assignments (keep locked courses)
const clearAllCourses = () => {
  if (
    confirm(
      "Are you sure you want to unassign all courses? This will clear all assignments except passed/failed courses.",
    )
  ) {
    const locked = new Map<number, number>();
    for (const [courseId, sem] of courseAssignments.value) {
      if (isLocked(courseId)) locked.set(courseId, sem);
    }
    courseAssignments.value = locked;
  }
};

// Save all changes
const saveChanges = async () => {
  if (!planData.value) return;

  saveLoading.value = true;
  const startSem = planData.value.plan.start_semester || 1;

  try {
    // Group courses by semester (only non-locked courses, but include retakes)
    const semesterCourses: Map<
      number,
      { course_id: number; status: string }[]
    > = new Map();

    // Get original failed semester assignments from plan data
    const originalFailedSemesters = new Map<number, number>();
    for (const sem of planData.value.semesters) {
      for (const c of sem.courses) {
        if (c.status === "Failed") {
          originalFailedSemesters.set(c.course_id, sem.semester);
        }
      }
    }

    for (const [courseId, semester] of courseAssignments.value) {
      // Skip passed courses — server preserves them
      if (passedCourses.value.some((c) => c.course_id === courseId)) continue;
      // Skip failed courses that are still in their original semester (not rescheduled)
      if (
        failedCourseIds.value.has(courseId) &&
        originalFailedSemesters.get(courseId) === semester
      )
        continue;
      if (!semesterCourses.has(semester)) {
        semesterCourses.set(semester, []);
      }
      semesterCourses.get(semester)!.push({
        course_id: courseId,
        status: "Planned",
      });
    }

    // First, clear all available semesters (from start_semester onwards)
    // This ensures semesters with no courses are also cleared
    for (const sem of availableSemesters.value) {
      await $fetch("/api/hop/academic-planning/plan/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester: sem,
          courses: semesterCourses.get(sem) || [], // Empty array clears the semester
        },
      });
    }

    // Also clear semesters before start_semester (to remove old courses)
    for (let sem = 1; sem < startSem; sem++) {
      await $fetch("/api/hop/academic-planning/plan/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester: sem,
          courses: [], // Clear all planned courses from earlier semesters
        },
      });
    }

    await refreshPlan();
    navigateTo(`/dashboard/hop/academic-planning/student/${planId}`);
  } catch (error: any) {
    alert(error.data?.message || "Failed to save schedule");
  } finally {
    saveLoading.value = false;
  }
};

// Go back
const goBack = () => {
  navigateTo(`/dashboard/hop/academic-planning/student/${planId}`);
};

// Select first semester by default
watchEffect(() => {
  if (availableSemesters.value.length > 0 && selectedSemester.value === null) {
    selectedSemester.value = availableSemesters.value[0] ?? null;
  }
});

// ============ Toast System ============
const showToast = (message: string, type: 'error' | 'success' | 'warning' = 'error') => {
  toastMessage.value = message;
  toastType.value = type;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toastMessage.value = ''; }, 3000);
};

// ============ Drag-and-Drop Helpers ============
const isCourseDisabledForSemester = (courseId: number, semester: number): boolean => {
  if (isGroupAlreadyAssigned(courseId)) return true;
  const rule = getSemesterRule(semester);
  const course = coursesData.value?.courses.find((c) => c.course_id === courseId)
    || coursesData.value?.retake_courses?.find((c) => c.course_id === courseId);
  if (rule && course) {
    if (rule.is_li && course.course_type !== 'Industrial Training') return true;
    if (!rule.is_li && course.course_type === 'Industrial Training') return true;
    if (rule.semester_type === 'S' && isLongSemesterOnly(course)) return true;
  }
  if (course && course.prerequisite_course_id) {
    if (!isPrereqSatisfied(course.prerequisite_course_id, semester)) return true;
  }
  if (course) {
    const limits = getSemesterLimits(semester);
    if (limits && getSemesterCredits(semester) + course.credit_hour > limits.max) return true;
  }
  return false;
};

const getDropReason = (courseId: number, semester: number): string | null => {
  if (isGroupAlreadyAssigned(courseId)) return `${getAssignedFromGroup(courseId)} selected`;
  const rule = getSemesterRule(semester);
  const course = coursesData.value?.courses.find((c) => c.course_id === courseId)
    || coursesData.value?.retake_courses?.find((c) => c.course_id === courseId);
  if (rule && course) {
    if (rule.is_li && course.course_type !== 'Industrial Training') return 'LI semester only';
    if (!rule.is_li && course.course_type === 'Industrial Training') return 'Needs LI semester';
    if (rule.semester_type === 'S' && isLongSemesterOnly(course)) return 'Long sem. only';
  }
  if (course && course.prerequisite_course_id && !isPrereqSatisfied(course.prerequisite_course_id, semester)) {
    return `Prereq: ${course.prerequisite_code}`;
  }
  if (course) {
    const limits = getSemesterLimits(semester);
    if (limits && getSemesterCredits(semester) + course.credit_hour > limits.max) {
      return coursesData.value?.on_probation ? `Probation: max ${limits.max} cr` : `Exceeds ${limits.max} cr`;
    }
  }
  return null;
};

const isPoolCourseDisabled = (courseId: number): boolean => isGroupAlreadyAssigned(courseId);

// ============ Drag Event Handlers ============
const onDragStart = (event: DragEvent, courseId: number, source: 'pool' | 'column') => {
  draggedCourseId.value = courseId;
  isDragging.value = true;
  dragSource.value = source;
  event.dataTransfer?.setData('text/plain', courseId.toString());
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
};

const onDragEnd = () => {
  draggedCourseId.value = null;
  isDragging.value = false;
  dragOverSemester.value = null;
};

const onDragOver = (event: DragEvent, semester: number) => {
  dragOverSemester.value = semester;
  event.dataTransfer!.dropEffect = (draggedCourseId.value && !isCourseDisabledForSemester(draggedCourseId.value, semester)) ? 'move' : 'none';
};

const onDragLeave = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement;
  const related = event.relatedTarget as HTMLElement;
  if (!target.contains(related)) dragOverSemester.value = null;
};

const onDrop = (event: DragEvent, semester: number) => {
  dragOverSemester.value = null;
  const courseId = draggedCourseId.value;
  if (!courseId) return;
  if (courseAssignments.value.get(courseId) === semester) return;
  if (isLocked(courseId) && !failedCourseIds.value.has(courseId)) return;
  const reason = getDropReason(courseId, semester);
  if (reason) { showToast(reason, 'error'); return; }
  assignCourse(courseId, semester);
};

const onPoolDragOver = (event: DragEvent) => { dragOverSemester.value = null; if (dragSource.value === 'column') event.dataTransfer!.dropEffect = 'move'; };
const onPoolDragLeave = () => {};
const onPoolDrop = () => { const courseId = draggedCourseId.value; if (courseId && dragSource.value === 'column') removeCourse(courseId); };

// ============ Pool Computed ============
const unassignedCount = computed(() =>
  plannedCourses.value.filter((c) => !courseAssignments.value.has(c.course_id)).length + retakeCourses.value.length
);

const filteredPoolCourses = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  let courses = plannedCourses.value.filter((c) => !courseAssignments.value.has(c.course_id));
  if (query) courses = courses.filter((c) => c.course_code.toLowerCase().includes(query) || c.course_name.toLowerCase().includes(query));
  const grouped = new Map<number, AvailableCourse[]>();
  for (const course of courses) {
    if (!grouped.has(course.default_semester)) grouped.set(course.default_semester, []);
    grouped.get(course.default_semester)!.push(course);
  }
  return grouped;
});

const filteredRetakeCourses = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  if (!query) return retakeCourses.value;
  return retakeCourses.value.filter((c) => c.course_code.toLowerCase().includes(query) || c.course_name.toLowerCase().includes(query));
});

// ============ Semester Column Helpers ============
const getAssignedCoursesForSemester = (sem: number) =>
  plannedCourses.value.filter((c) => courseAssignments.value.get(c.course_id) === sem);

const getAssignedRetakesForSemester = (sem: number) =>
  (coursesData.value?.retake_courses || []).filter((c) =>
    courseAssignments.value.get(c.course_id) === sem &&
    !failedCourses.value.some((f) => f.course_id === c.course_id && f.semester === sem),
  );

const creditBarWidth = (sem: number): string => {
  const limits = getSemesterLimits(sem);
  if (!limits || limits.max === 0) return '0%';
  return `${Math.min(100, (getSemesterCredits(sem) / limits.max) * 100)}%`;
};

const getSemesterColumnClasses = (sem: number) => {
  const cid = draggedCourseId.value;
  const hovering = dragOverSemester.value === sem;
  if (!isDragging.value || !cid) return 'border-base-300';
  const canDrop = !isCourseDisabledForSemester(cid, sem);
  if (hovering && canDrop) return 'border-success bg-success/5 ring-2 ring-success/30';
  if (hovering && !canDrop) return 'border-error bg-error/5 ring-2 ring-error/20';
  if (canDrop) return 'border-success/40';
  return 'border-base-300 opacity-50';
};
</script>

<template>
  <div class="p-4 w-full h-[calc(100vh-64px)] flex flex-col overflow-hidden relative">
    <!-- Header -->
    <div class="flex items-start gap-4 mb-3 flex-shrink-0">
      <button class="btn btn-ghost btn-sm mt-1" @click="goBack">← Back</button>
      <div class="flex-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold">Schedule Semester</h1>
            <p v-if="planData" class="text-sm text-base-content/60">
              {{ planData.student.name }} ({{ planData.student.matric_no }})
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-outline btn-sm" @click="openConfigModal">⚙️ Configure</button>
            <button v-if="courseAssignments.size > 0" class="btn btn-ghost btn-sm text-error" @click="clearAllCourses">🗑️ Clear</button>
            <button class="btn btn-primary" :disabled="saveLoading" @click="saveChanges">
              <span v-if="saveLoading" class="loading loading-spinner loading-xs"></span>
              💾 Save
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading || coursesLoading" class="flex justify-center py-12 flex-1">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="planData && coursesData">
      <!-- CGPA Probation Warning -->
      <div v-if="coursesData.on_probation" class="alert alert-warning mb-3 flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <h3 class="font-bold">Academic Probation — CGPA {{ coursesData.cgpa }}</h3>
          <div class="text-sm">Credit hours restricted to minimum only ({{ coursesData.credit_limits.long_max }} cr long / {{ coursesData.credit_limits.short_max }} cr short).</div>
        </div>
      </div>

      <!-- Summary Bar -->
      <div class="flex flex-wrap items-center gap-4 mb-3 p-3 bg-base-200 rounded-lg flex-shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">Scheduled:</span>
          <span class="font-semibold text-primary">{{ totalAssignedCredits }} / {{ totalPlannedCredits }} cr</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">Transferred:</span>
          <span class="font-semibold text-success">{{ transferredCourses.length }} courses ({{ planData.summary.transferred_credits }} cr)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">Unassigned:</span>
          <span class="font-semibold" :class="unassignedCount > 0 ? 'text-warning' : 'text-success'">{{ unassignedCount }} courses</span>
        </div>
        <div class="flex-1"></div>
        <span class="text-xs text-base-content/40">Drag courses → Drop on semester</span>
      </div>

      <!-- Main Layout: Course Pool + Semester Columns -->
      <div class="flex gap-4 flex-1 min-h-0">
        <!-- Left: Course Pool -->
        <div
          class="flex-1 flex flex-col min-h-0 bg-base-100 rounded-lg border overflow-hidden transition-colors"
          :class="isDragging && dragSource === 'column' ? 'border-success/50 ring-2 ring-success/20' : 'border-base-300'"
          @dragover.prevent="onPoolDragOver"
          @dragleave="onPoolDragLeave"
          @drop.prevent="onPoolDrop"
        >
          <div class="p-3 border-b border-base-300 flex-shrink-0 bg-base-100 space-y-2">
            <h2 class="font-semibold flex items-center gap-2">
              📋 Course Pool
              <span class="badge badge-sm badge-ghost">{{ unassignedCount }}</span>
            </h2>
            <input v-model="searchQuery" type="text" placeholder="Search courses..." class="input input-sm input-bordered w-full" />
          </div>
          <div class="flex-1 overflow-y-auto p-3 space-y-4">
            <!-- Grouped by default semester -->
            <div v-for="[sem, courses] in Array.from(filteredPoolCourses).sort((a, b) => a[0] - b[0])" :key="'pool-' + sem">
              <h4 class="text-xs font-medium text-base-content/50 mb-1.5 uppercase tracking-wide flex items-center justify-between">
                <span>Semester {{ sem }}</span>
                <span class="badge badge-xs badge-ghost">{{ courses.length }}</span>
              </h4>
              <div class="space-y-1">
                <div
                  v-for="course in courses" :key="course.course_id"
                  class="pool-card flex items-center gap-2 p-2 rounded border text-sm transition-colors"
                  :class="isPoolCourseDisabled(course.course_id) ? 'border-base-300 bg-base-200/30 opacity-40 cursor-not-allowed' : 'border-base-300 bg-base-200/50 hover:bg-primary/10 hover:border-primary/30 cursor-grab active:cursor-grabbing'"
                  :draggable="!isPoolCourseDisabled(course.course_id)"
                  @dragstart="onDragStart($event, course.course_id, 'pool')"
                  @dragend="onDragEnd"
                >
                  <span class="font-mono text-xs shrink-0 text-primary/80">{{ course.course_code }}</span>
                  <span class="truncate flex-1">{{ course.course_name }}</span>
                  <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                  <span v-if="isPoolCourseDisabled(course.course_id)" class="badge badge-xs badge-warning shrink-0">{{ getAssignedFromGroup(course.course_id) }}</span>
                </div>
              </div>
            </div>
            <!-- Empty state -->
            <div v-if="filteredPoolCourses.size === 0 && filteredRetakeCourses.length === 0" class="text-center py-8 text-base-content/40 text-sm">
              <template v-if="searchQuery">No matching courses</template>
              <template v-else>✓ All courses assigned!</template>
            </div>
            <!-- Retake Courses -->
            <div v-if="filteredRetakeCourses.length > 0">
              <h4 class="text-xs font-medium text-error/80 mb-1.5 uppercase tracking-wide flex items-center justify-between">
                <span>🔄 Retake Courses</span>
                <span class="badge badge-xs badge-error">{{ filteredRetakeCourses.length }}</span>
              </h4>
              <div class="space-y-1">
                <div
                  v-for="course in filteredRetakeCourses" :key="'retake-pool-' + course.course_id"
                  class="pool-card flex items-center gap-2 p-2 rounded border text-sm border-error/30 bg-error/5 hover:bg-error/10 cursor-grab active:cursor-grabbing transition-colors"
                  draggable="true"
                  @dragstart="onDragStart($event, course.course_id, 'pool')"
                  @dragend="onDragEnd"
                >
                  <span class="font-mono text-xs shrink-0">{{ course.course_code }}</span>
                  <span class="truncate flex-1">{{ course.course_name }}</span>
                  <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                  <span class="badge badge-xs badge-error shrink-0">Retake</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Semester Tab Panel -->
        <div class="flex-1 flex flex-col min-h-0 bg-base-100 rounded-lg border border-base-300 overflow-hidden">
          <!-- Panel Toolbar: Burger Semester Picker -->
          <div class="flex items-center gap-2 px-3 py-2 border-b border-base-300 flex-shrink-0 bg-base-100">
            <!-- Burger dropdown for semester selection -->
            <div class="dropdown">
              <label tabindex="0" class="btn btn-ghost btn-sm gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span class="text-sm font-medium">
                  {{ selectedSemester ? `Semester ${selectedSemester}` : 'Select Semester' }}
                </span>
                <span v-if="selectedSemester && getSemesterTypeLabel(selectedSemester)" class="badge badge-xs"
                  :class="{ 'badge-primary': getSemesterTypeLabel(selectedSemester) === 'Long', 'badge-secondary': getSemesterTypeLabel(selectedSemester) === 'Short', 'badge-accent': getSemesterTypeLabel(selectedSemester) === 'LI' }"
                >{{ getSemesterTypeLabel(selectedSemester) }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </label>
              <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box shadow-sm border border-base-300 w-64 p-1.5 z-50 mt-1">
                <li v-for="sem in availableSemesters" :key="'drop-' + sem">
                  <button
                    class="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                    :class="selectedSemester === sem ? 'bg-primary/10 text-primary font-medium' : ''"
                    @click="selectedSemester = sem"
                  >
                    <div class="flex items-center gap-2">
                      <span class="font-medium">Sem {{ sem }}</span>
                      <span v-if="getSemesterTypeLabel(sem)" class="badge badge-xs"
                        :class="{ 'badge-primary': getSemesterTypeLabel(sem) === 'Long', 'badge-secondary': getSemesterTypeLabel(sem) === 'Short', 'badge-accent': getSemesterTypeLabel(sem) === 'LI' }"
                      >{{ getSemesterTypeLabel(sem) }}</span>
                    </div>
                    <span class="badge badge-xs badge-neutral"
                    >{{ getSemesterCredits(sem) }} credit</span>
                  </button>
                </li>
                <li class="border-t border-base-300 mt-1 pt-1">
                  <button class="flex items-center gap-2 px-3 py-2 text-sm text-base-content/50 hover:text-base-content hover:bg-base-200 rounded-lg w-full" @click="addSemester">
                    <span>+</span> Add Semester
                  </button>
                </li>
              </ul>
            </div>
            <div class="flex-1"></div>
          </div>

          <!-- Panel Header (for selected semester) -->
          <div v-if="selectedSemester" class="px-4 py-2.5 border-b border-base-300 flex-shrink-0 bg-base-100 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">Semester {{ selectedSemester }}</h2>
              <span v-if="getSemesterTypeLabel(selectedSemester)" class="badge badge-outline badge-sm">{{ getSemesterTypeLabel(selectedSemester) }}</span>
              <span class="badge badge-sm"
                :class="{ 'badge-success': getSemesterCreditStatus(selectedSemester) === 'ok', 'badge-error': getSemesterCreditStatus(selectedSemester) === 'over', 'badge-warning': getSemesterCreditStatus(selectedSemester) === 'under', 'badge-ghost': getSemesterCreditStatus(selectedSemester) === 'empty' || getSemesterCreditStatus(selectedSemester) === 'li' }"
              >
                {{ getSemesterCredits(selectedSemester) }}<template v-if="getSemesterLimits(selectedSemester)"> / {{ getSemesterLimits(selectedSemester)!.min }}–{{ getSemesterLimits(selectedSemester)!.max }}</template> credit
              </span>
            </div>
            <!-- Credit progress bar -->
            <div v-if="getSemesterLimits(selectedSemester)" class="flex-1 max-w-48">
              <div class="h-2 bg-base-200 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-colors"
                  :class="{ 'bg-success': getSemesterCreditStatus(selectedSemester) === 'ok', 'bg-error': getSemesterCreditStatus(selectedSemester) === 'over', 'bg-warning': getSemesterCreditStatus(selectedSemester) === 'under', 'bg-base-300': getSemesterCreditStatus(selectedSemester) === 'empty' }"
                  :style="{ width: creditBarWidth(selectedSemester) }"
                ></div>
              </div>
            </div>
          </div>

          <!-- Drop Zone Content Area -->
          <div
            class="flex-1 overflow-y-auto p-4 transition-colors"
            :class="isDragging && selectedSemester ? (draggedCourseId && !isCourseDisabledForSemester(draggedCourseId, selectedSemester) ? 'bg-success/5 ring-inset ring-2 ring-success/30' : 'bg-error/5 ring-inset ring-2 ring-error/20') : ''"
            @dragover.prevent="selectedSemester && onDragOver($event, selectedSemester)"
            @dragleave="onDragLeave($event)"
            @drop.prevent="selectedSemester && onDrop($event, selectedSemester)"
          >
            <!-- No semester selected -->
            <div v-if="!selectedSemester" class="flex items-center justify-center h-full text-base-content/30 text-sm">
              Select a semester tab above
            </div>

            <template v-else>
              <!-- Drop hint when dragging invalid -->
              <div v-if="isDragging && draggedCourseId && isCourseDisabledForSemester(draggedCourseId, selectedSemester)" class="mb-3 alert alert-error alert-sm py-2 text-sm">
                ⛔ {{ getDropReason(draggedCourseId, selectedSemester) }}
              </div>
              <!-- Drop hint when dragging valid -->
              <div v-else-if="isDragging && draggedCourseId && !isCourseDisabledForSemester(draggedCourseId, selectedSemester)" class="mb-3 alert alert-success alert-sm py-2 text-sm">
                ✓ Drop to assign to Semester {{ selectedSemester }}
              </div>

              <div class="space-y-3">
                <!-- Locked: Passed Courses -->
                <div v-if="passedCourses.filter(c => c.semester === selectedSemester).length > 0">
                  <h3 class="text-xs font-medium text-success/80 mb-2 uppercase tracking-wide">Completed (Locked)</h3>
                  <div class="space-y-1">
                    <div v-for="course in passedCourses.filter(c => c.semester === selectedSemester)" :key="'passed-' + course.course_id"
                      class="flex items-center justify-between p-2.5 rounded-lg border bg-success/10 border-success/30 text-sm">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-mono text-xs shrink-0">{{ course.course_code }}</span>
                        <span class="truncate">{{ course.course_name }}</span>
                        <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                      </div>
                      <span class="badge badge-xs badge-success shrink-0">Passed</span>
                    </div>
                  </div>
                </div>

                <!-- Locked: Failed Courses -->
                <div v-if="failedCourses.filter(c => c.semester === selectedSemester).length > 0">
                  <h3 class="text-xs font-medium text-error/80 mb-2 uppercase tracking-wide">Failed (Locked)</h3>
                  <div class="space-y-1">
                    <div v-for="course in failedCourses.filter(c => c.semester === selectedSemester)" :key="'failed-' + course.course_id"
                      class="flex items-center justify-between p-2.5 rounded-lg border bg-error/10 border-error/30 text-sm">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-mono text-xs shrink-0">{{ course.course_code }}</span>
                        <span class="truncate">{{ course.course_name }}</span>
                        <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <span class="badge badge-xs badge-error">Failed</span>
                        <span v-if="failedCourseIds.has(course.course_id)" class="badge badge-xs badge-warning">Needs Retake</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Assigned Planned Courses -->
                <div v-if="getAssignedCoursesForSemester(selectedSemester).length > 0 || getAssignedRetakesForSemester(selectedSemester).length > 0">
                  <h3 class="text-xs font-medium text-base-content/60 mb-2 uppercase tracking-wide">Assigned Courses</h3>
                  <div class="space-y-1">
                    <div
                      v-for="course in getAssignedCoursesForSemester(selectedSemester)" :key="'assigned-' + course.course_id"
                      class="group flex items-center justify-between p-2.5 rounded-lg border bg-primary/10 border-primary/20 text-sm cursor-grab active:cursor-grabbing hover:bg-primary/15 transition-colors"
                      draggable="true"
                      @dragstart="onDragStart($event, course.course_id, 'column')"
                      @dragend="onDragEnd"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-mono text-xs shrink-0 text-primary/80">{{ course.course_code }}</span>
                        <span class="truncate">{{ course.course_name }}</span>
                        <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                      </div>
                      <button class="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click.stop="removeCourse(course.course_id)">✕</button>
                    </div>
                    <!-- Retakes -->
                    <div
                      v-for="course in getAssignedRetakesForSemester(selectedSemester)" :key="'retake-col-' + course.course_id"
                      class="group flex items-center justify-between p-2.5 rounded-lg border bg-error/10 border-error/20 text-sm cursor-grab active:cursor-grabbing hover:bg-error/15 transition-colors"
                      draggable="true"
                      @dragstart="onDragStart($event, course.course_id, 'column')"
                      @dragend="onDragEnd"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-mono text-xs shrink-0">{{ course.course_code }}</span>
                        <span class="truncate">{{ course.course_name }}</span>
                        <span class="badge badge-xs badge-outline shrink-0">{{ course.credit_hour }} credit</span>
                        <span class="badge badge-xs badge-error shrink-0">Retake</span>
                      </div>
                      <button class="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click.stop="removeCourse(course.course_id)">✕</button>
                    </div>
                  </div>
                </div>

                <!-- Empty State (when no assigned and no locked) -->
                <div v-if="passedCourses.filter(c => c.semester === selectedSemester).length === 0 && failedCourses.filter(c => c.semester === selectedSemester).length === 0 && getAssignedCoursesForSemester(selectedSemester).length === 0 && getAssignedRetakesForSemester(selectedSemester).length === 0"
                  class="flex flex-col items-center justify-center h-48 gap-3 text-base-content/30 border-2 border-dashed border-base-300 rounded-xl">
                  <span class="text-3xl">📥</span>
                  <span class="text-sm">Drag courses here to assign to Semester {{ selectedSemester }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Transferred Courses Collapse -->

      <div v-if="transferredCourses.length > 0" class="collapse collapse-arrow bg-success/5 border border-success/20 rounded-lg mt-3 flex-shrink-0">
        <input type="checkbox" />
        <div class="collapse-title py-2 min-h-0 text-sm font-medium">
          View {{ transferredCourses.length }} Transferred Courses ({{ planData.summary.transferred_credits }} credits)
        </div>
        <div class="collapse-content">
          <div class="flex flex-wrap gap-2 pt-2">
            <span v-for="course in transferredCourses" :key="course.course_id" class="badge badge-success gap-1">
              {{ course.course_code }} ({{ course.credit_hour }} credit)
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="toastMessage" class="fixed bottom-6 right-6 z-50 alert shadow-sm max-w-sm"
        :class="{ 'alert-error': toastType === 'error', 'alert-warning': toastType === 'warning', 'alert-success': toastType === 'success' }">
        <span class="text-sm">{{ toastMessage }}</span>
        <button class="btn btn-ghost btn-xs" @click="toastMessage = ''">✕</button>
      </div>
    </Transition>

    <!-- Configure Plan Modal -->
    <dialog class="modal" :class="{ 'modal-open': isConfigModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg mb-1">Configure Semester Plan</h3>
        <p class="text-sm text-base-content/60 mb-4">Add/remove semesters and set LI (Latihan Industri) for scheduling.</p>
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Semester</th>
                <th>Type</th>
                <th>LI</th>
                <th>Credit Range</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(rule, index) in editableRules" :key="rule.semester_number">
                <td><span class="badge badge-neutral badge-sm">{{ rule.semester_number }}</span></td>
                <td><span class="badge badge-sm" :class="rule.semester_type === 'L' ? 'badge-primary' : 'badge-secondary'">{{ rule.semester_type === "L" ? "Long" : "Short" }}</span></td>
                <td><input type="checkbox" class="checkbox checkbox-sm checkbox-accent" v-model="rule.is_li" /></td>
                <td>
                  <span v-if="getConfigCreditRange(rule)" class="text-xs text-base-content/60">{{ getConfigCreditRange(rule)!.min }}–{{ getConfigCreditRange(rule)!.max }} cr</span>
                  <span v-else class="text-xs text-base-content/40">—</span>
                </td>
                <td>
                  <button v-if="!hasLockedCoursesInSemester(rule.semester_number)" class="btn btn-ghost btn-xs text-error" @click="removeConfigSemester(index)" title="Remove semester">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button class="btn btn-outline btn-sm mt-3 w-full" @click="addConfigSemester">+ Add Semester</button>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="isConfigModalOpen = false">Discard</button>
          <button class="btn btn-primary" @click="applyConfig">Apply</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="isConfigModalOpen = false">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.pool-card[draggable="true"]:active {
  opacity: 0.5;
  transform: scale(0.98);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
