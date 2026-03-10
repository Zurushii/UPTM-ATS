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

// Initialize course assignments from plan data
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

// Get unique semesters from available courses
const availableSemesters = computed(() => {
  const semesters = new Set<number>();
  if (coursesData.value) {
    for (const course of coursesData.value.courses) {
      semesters.add(course.default_semester);
    }
    // Include semesters from extended rules (for retake scheduling)
    for (const rule of coursesData.value.semester_rules) {
      semesters.add(rule.semester_number);
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

// Get program structure grouped by semester
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

  for (const [assignedId] of courseAssignments.value) {
    if (
      assignedId !== courseId &&
      getCourseGroup(assignedId) === courseGroup &&
      getDefaultSemester(assignedId) === defaultSem
    ) {
      return true;
    }
  }
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

// Check if a course can only be taken in Long semesters (FYP2, Industrial Training)
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

// Check if course should be disabled (group conflict, LI, Long-only, or prereq restriction)
const isCourseDisabled = (courseId: number): boolean => {
  if (isGroupAlreadyAssigned(courseId)) return true;

  if (selectedSemester.value !== null) {
    const rule = getSemesterRule(selectedSemester.value);
    const course = coursesData.value?.courses.find(
      (c) => c.course_id === courseId,
    );
    if (rule && course) {
      if (rule.is_li && course.course_type !== "Industrial Training")
        return true;
      if (!rule.is_li && course.course_type === "Industrial Training")
        return true;
      if (rule.semester_type === "S" && isLongSemesterOnly(course)) return true;
    }
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

// Get semester rule for a given semester number
const getSemesterRule = (sem: number): SemesterRule | undefined => {
  return coursesData.value?.semester_rules?.find(
    (r) => r.semester_number === sem,
  );
};

// Get semester type label
const getSemesterTypeLabel = (sem: number): string => {
  const rule = getSemesterRule(sem);
  if (!rule) return "";
  if (rule.is_li) return "LI";
  return rule.semester_type === "L" ? "Long" : "Short";
};

// Get credit limits for a semester based on its type
const getSemesterCreditLimits = (
  sem: number,
): { min: number; max: number } | null => {
  const rule = getSemesterRule(sem);
  const limits = coursesData.value?.credit_limits;
  if (!rule || !limits || rule.is_li) return null; // LI semesters bypass credit validation
  if (rule.semester_type === "L")
    return { min: limits.long_min, max: limits.long_max };
  return { min: limits.short_min, max: limits.short_max };
};

// Get credit status for badge color
const getCreditStatus = (
  sem: number,
): "ok" | "under" | "over" | "li" | "empty" => {
  const rule = getSemesterRule(sem);
  if (rule?.is_li) return "li";
  const credits = getSemesterCredits(sem);
  const limits = getSemesterCreditLimits(sem);
  if (!limits || credits === 0) return "empty";
  if (credits > limits.max) return "over";
  if (credits < limits.min) return "under";
  return "ok";
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

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};

// Assign course to semester (with group, LI, Long-only, and prereq validation)
const assignCourse = (courseId: number, semester: number) => {
  if (isGroupAlreadyAssigned(courseId)) {
    const existingCourse = getAssignedFromGroup(courseId);
    alert(
      `Cannot add this course. Another course from the same group (${existingCourse}) is already assigned or transferred.`,
    );
    return;
  }

  const rule = getSemesterRule(semester);
  const course =
    coursesData.value?.courses.find((c) => c.course_id === courseId) ||
    coursesData.value?.retake_courses?.find((c) => c.course_id === courseId);
  if (rule && course) {
    if (rule.is_li && course.course_type !== "Industrial Training") {
      alert(
        "This is an Industrial Training (LI) semester. Only Industrial Training courses can be assigned here.",
      );
      return;
    }
    if (!rule.is_li && course.course_type === "Industrial Training") {
      alert(
        "Industrial Training courses can only be assigned to LI semesters.",
      );
      return;
    }
    if (rule.semester_type === "S" && isLongSemesterOnly(course)) {
      alert(`${course.course_name} can only be taken in a Long semester.`);
      return;
    }
  }

  if (course && course.prerequisite_course_id) {
    if (!isPrereqSatisfied(course.prerequisite_course_id, semester)) {
      alert(
        `Cannot assign ${course.course_code}. Pre-requisite ${course.prerequisite_code} must be assigned to an earlier semester first.`,
      );
      return;
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

// Quick assign from program structure
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

    // Save each semester (including empty ones to clear old assignments)
    for (const sem of availableSemesters.value) {
      await $fetch("/api/hop/academic-planning/plan/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester: sem,
          courses: semesterCourses.get(sem) || [],
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
</script>

<template>
  <div class="p-4 w-full h-[calc(100vh-64px)] flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-start gap-4 mb-4 flex-shrink-0">
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
            <label class="label cursor-pointer gap-2">
              <span class="label-text text-sm">Program Structure</span>
              <input
                type="checkbox"
                v-model="showProgramStructure"
                class="toggle toggle-sm toggle-primary"
              />
            </label>
            <button
              class="btn btn-primary"
              :disabled="saveLoading"
              @click="saveChanges"
            >
              <span
                v-if="saveLoading"
                class="loading loading-spinner loading-xs"
              ></span>
              💾 Save
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="loading || coursesLoading"
      class="flex justify-center py-12 flex-1"
    >
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="planData && coursesData">
      <!-- Summary Bar -->
      <div
        class="flex flex-wrap items-center gap-4 mb-4 p-3 bg-base-200 rounded-lg flex-shrink-0"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">To Schedule:</span>
          <span class="font-semibold text-primary"
            >{{ totalAssignedCredits }} / {{ totalPlannedCredits }} cr</span
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">Transferred:</span>
          <span class="font-semibold text-success"
            >{{ transferredCourses.length }} courses ({{
              planData.summary.transferred_credits
            }}
            cr)</span
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-base-content/60">Unassigned:</span>
          <span
            class="font-semibold"
            :class="
              plannedCourses.filter((c) => !isAssigned(c.course_id)).length > 0
                ? 'text-warning'
                : 'text-success'
            "
          >
            {{ plannedCourses.filter((c) => !isAssigned(c.course_id)).length }}
            courses
          </span>
        </div>
      </div>

      <!-- Semester Tabs (Horizontal) -->
      <div class="flex items-center gap-2 mb-4 flex-shrink-0">
        <div class="tabs tabs-boxed bg-base-200 gap-1 overflow-x-auto flex-1">
          <button
            v-for="sem in availableSemesters"
            :key="sem"
            class="tab gap-2"
            :class="selectedSemester === sem ? 'tab-active' : ''"
            @click="selectedSemester = sem"
          >
            <span>Sem {{ sem }}</span>
            <span v-if="getSemesterTypeLabel(sem)" class="text-xs opacity-70"
              >({{ getSemesterTypeLabel(sem) }})</span
            >
            <span
              class="badge badge-sm"
              :class="{
                'badge-success': getCreditStatus(sem) === 'ok',
                'badge-error': getCreditStatus(sem) === 'over',
                'badge-warning': getCreditStatus(sem) === 'under',
                'badge-ghost':
                  getCreditStatus(sem) === 'empty' ||
                  getCreditStatus(sem) === 'li',
                'badge-primary':
                  selectedSemester === sem &&
                  (getCreditStatus(sem) === 'empty' ||
                    getCreditStatus(sem) === 'li'),
              }"
            >
              {{ getSemesterCredits(sem)
              }}<template v-if="getSemesterCreditLimits(sem)"
                >/{{ getSemesterCreditLimits(sem)!.min }}–{{
                  getSemesterCreditLimits(sem)!.max
                }}</template
              >
            </span>
          </button>
        </div>
        <button
          class="btn btn-outline btn-sm shrink-0"
          @click="openConfigModal"
        >
          ⚙️ Configure
        </button>
        <button
          v-if="courseAssignments.size > 0"
          class="btn btn-ghost btn-sm text-error shrink-0"
          @click="clearAllCourses"
        >
          🗑️ Clear All
        </button>
      </div>

      <!-- Main Content - Split View with Independent Scroll -->
      <div
        class="grid gap-4 flex-1 min-h-0"
        :class="showProgramStructure ? 'lg:grid-cols-2' : ''"
      >
        <!-- Left: Current Semester Schedule -->
        <div
          class="flex flex-col min-h-0 bg-base-100 rounded-lg border border-base-300 overflow-hidden"
        >
          <!-- Fixed Header -->
          <div class="p-3 border-b border-base-300 flex-shrink-0 bg-base-100">
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">
                {{
                  selectedSemester
                    ? formatSemester(selectedSemester)
                    : "Select a Semester"
                }}
              </h2>
              <span v-if="selectedSemester" class="badge badge-primary"
                >{{ getSemesterCredits(selectedSemester) }} credits</span
              >
            </div>
          </div>

          <!-- Scrollable Content -->
          <div class="flex-1 overflow-y-auto p-3 space-y-3">
            <!-- Passed/Failed Courses (Locked) -->
            <div
              v-if="
                passedCourses.filter((c) => c.semester === selectedSemester)
                  .length > 0
              "
            >
              <h3
                class="text-xs font-medium text-success/80 mb-2 uppercase tracking-wide"
              >
                Completed (Locked)
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in passedCourses.filter(
                    (c) => c.semester === selectedSemester,
                  )"
                  :key="course.course_id"
                  class="flex items-center justify-between p-2 rounded border bg-success/10 border-success/30"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                  </div>
                  <span class="badge badge-xs badge-success shrink-0">
                    Passed
                  </span>
                </div>
              </div>
            </div>

            <!-- Failed Courses (Locked in original semester) -->
            <div
              v-if="
                failedCourses.filter((c) => c.semester === selectedSemester)
                  .length > 0
              "
            >
              <h3
                class="text-xs font-medium text-error/80 mb-2 uppercase tracking-wide"
              >
                Failed (Locked)
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in failedCourses.filter(
                    (c) => c.semester === selectedSemester,
                  )"
                  :key="'failed-' + course.course_id"
                  class="flex items-center justify-between p-2 rounded border bg-error/10 border-error/30"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <span class="badge badge-xs badge-error">Failed</span>
                    <span
                      v-if="failedCourseIds.has(course.course_id)"
                      class="badge badge-xs badge-warning"
                      >Needs Retake</span
                    >
                  </div>
                </div>
              </div>
            </div>

            <!-- Assigned Courses -->
            <div>
              <h3
                class="text-xs font-medium text-base-content/60 mb-2 uppercase tracking-wide"
              >
                Assigned to this Semester
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in plannedCourses.filter(
                    (c) =>
                      courseAssignments.get(c.course_id) === selectedSemester,
                  )"
                  :key="course.course_id"
                  class="flex items-center justify-between p-2 bg-primary/10 rounded border border-primary/20"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error shrink-0"
                    @click="removeCourse(course.course_id)"
                  >
                    ✕
                  </button>
                </div>
                <div
                  v-if="
                    plannedCourses.filter(
                      (c) =>
                        courseAssignments.get(c.course_id) === selectedSemester,
                    ).length === 0
                  "
                  class="text-center py-4 text-base-content/40 text-sm"
                >
                  No courses assigned to this semester
                </div>
              </div>
            </div>

            <!-- Assigned Retake Courses -->
            <div
              v-if="
                coursesData?.retake_courses?.filter(
                  (c) =>
                    courseAssignments.get(c.course_id) === selectedSemester &&
                    !failedCourses.some(
                      (f) =>
                        f.course_id === c.course_id &&
                        f.semester === selectedSemester,
                    ),
                ).length
              "
            >
              <h3
                class="text-xs font-medium text-error/80 mb-2 uppercase tracking-wide"
              >
                🔄 Retake Courses (Assigned)
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in coursesData?.retake_courses?.filter(
                    (c) =>
                      courseAssignments.get(c.course_id) === selectedSemester &&
                      !failedCourses.some(
                        (f) =>
                          f.course_id === c.course_id &&
                          f.semester === selectedSemester,
                      ),
                  )"
                  :key="'retake-assigned-' + course.course_id"
                  class="flex items-center justify-between p-2 bg-error/10 rounded border border-error/20"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                    <span class="badge badge-xs badge-error shrink-0"
                      >Retake</span
                    >
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error shrink-0"
                    @click="removeCourse(course.course_id)"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <!-- Unassigned Courses -->
            <div>
              <h3
                class="text-xs font-medium text-base-content/60 mb-2 uppercase tracking-wide"
              >
                Unassigned Courses (Click to Add)
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in plannedCourses.filter(
                    (c) => !courseAssignments.has(c.course_id),
                  )"
                  :key="course.course_id"
                  class="flex items-center justify-between p-2 border rounded transition-colors"
                  :class="
                    isCourseDisabled(course.course_id)
                      ? 'border-base-300 bg-base-200/30 opacity-50 cursor-not-allowed'
                      : 'border-base-300 hover:bg-base-200 cursor-pointer'
                  "
                  @click="
                    !isCourseDisabled(course.course_id) &&
                    assignCourse(course.course_id, selectedSemester!)
                  "
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs badge-ghost shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                    <span class="badge badge-xs badge-outline shrink-0"
                      >S{{ course.default_semester }}</span
                    >
                    <span
                      v-if="isCourseDisabled(course.course_id)"
                      class="badge badge-xs badge-warning shrink-0"
                    >
                      {{ getCourseDisabledReason(course.course_id) }}
                    </span>
                  </div>
                  <span
                    v-if="!isCourseDisabled(course.course_id)"
                    class="text-success text-sm shrink-0"
                    >+</span
                  >
                  <span v-else class="text-base-content/30 text-sm shrink-0"
                    >—</span
                  >
                </div>
                <div
                  v-if="
                    plannedCourses.filter(
                      (c) => !courseAssignments.has(c.course_id),
                    ).length === 0
                  "
                  class="text-center py-4 text-success text-sm"
                >
                  ✓ All courses have been assigned
                </div>
              </div>
            </div>

            <!-- Retake Courses (Failed, need rescheduling) -->
            <div v-if="retakeCourses.length > 0">
              <h3
                class="text-xs font-medium text-error/80 mb-2 uppercase tracking-wide"
              >
                🔄 Retake Courses (Click to Reschedule)
              </h3>
              <div class="space-y-1">
                <div
                  v-for="course in retakeCourses"
                  :key="'retake-' + course.course_id"
                  class="flex items-center justify-between p-2 border border-error/30 rounded transition-colors"
                  :class="
                    isCourseDisabled(course.course_id)
                      ? 'bg-error/5 opacity-50 cursor-not-allowed'
                      : 'bg-error/5 hover:bg-error/10 cursor-pointer'
                  "
                  @click="
                    !isCourseDisabled(course.course_id) &&
                    assignCourse(course.course_id, selectedSemester!)
                  "
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="text-sm truncate">{{
                      course.course_name
                    }}</span>
                    <span class="badge badge-xs badge-ghost shrink-0"
                      >{{ course.credit_hour }}cr</span
                    >
                    <span class="badge badge-xs badge-error shrink-0"
                      >Retake</span
                    >
                    <span
                      v-if="isCourseDisabled(course.course_id)"
                      class="badge badge-xs badge-warning shrink-0"
                    >
                      {{ getCourseDisabledReason(course.course_id) }}
                    </span>
                  </div>
                  <span
                    v-if="!isCourseDisabled(course.course_id)"
                    class="text-error text-sm shrink-0"
                    >+</span
                  >
                  <span v-else class="text-base-content/30 text-sm shrink-0"
                    >—</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Program Structure Reference -->
        <div
          v-if="showProgramStructure"
          class="flex flex-col min-h-0 bg-base-100 rounded-lg border border-base-300 overflow-hidden"
        >
          <!-- Fixed Header -->
          <div class="p-3 border-b border-base-300 flex-shrink-0 bg-base-100">
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">📚 Program Structure</h2>
              <div class="flex items-center gap-2 text-xs">
                <span class="flex items-center gap-1"
                  ><span class="w-2 h-2 rounded bg-success"></span>
                  Transferred</span
                >
                <span class="flex items-center gap-1"
                  ><span class="w-2 h-2 rounded bg-primary"></span>
                  Assigned</span
                >
              </div>
            </div>
            <p
              v-if="selectedSemester"
              class="text-xs text-base-content/60 mt-1"
            >
              💡 Click on unassigned courses to add to
              {{ formatSemester(selectedSemester) }}
            </p>
          </div>

          <!-- Scrollable Content -->
          <div class="flex-1 overflow-y-auto p-3">
            <div
              v-for="[sem, courses] in Array.from(programStructure).sort(
                (a, b) => a[0] - b[0],
              )"
              :key="sem"
              class="mb-4 last:mb-0"
            >
              <div
                class="flex items-center justify-between mb-2 sticky top-0 bg-base-100 py-1 -mt-1"
              >
                <h4 class="font-medium text-sm flex items-center gap-2">
                  <span
                    :class="sem === selectedSemester ? 'text-primary' : ''"
                    >{{ formatSemester(sem) }}</span
                  >
                  <span
                    v-if="sem === selectedSemester"
                    class="badge badge-primary badge-xs"
                    >Current</span
                  >
                </h4>
                <span class="badge badge-outline badge-sm">
                  {{ courses.reduce((sum, c) => sum + c.credit_hour, 0) }} cr
                </span>
              </div>
              <div class="space-y-1">
                <div
                  v-for="course in courses"
                  :key="course.course_id"
                  class="flex items-center justify-between p-2 rounded text-sm transition-colors"
                  :class="{
                    'bg-success/20 border border-success/30': isTransferred(
                      course.course_id,
                    ),
                    'bg-success/15 border border-success/25':
                      isLocked(course.course_id) &&
                      !isTransferred(course.course_id),
                    'bg-primary/10 border border-primary/20':
                      isAssigned(course.course_id) &&
                      !isTransferred(course.course_id) &&
                      !isLocked(course.course_id),
                    'bg-base-200/30 opacity-50 cursor-not-allowed':
                      !isAssigned(course.course_id) &&
                      !isTransferred(course.course_id) &&
                      !isLocked(course.course_id) &&
                      isCourseDisabled(course.course_id),
                    'bg-base-200/50 hover:bg-base-200 cursor-pointer':
                      !isAssigned(course.course_id) &&
                      !isTransferred(course.course_id) &&
                      !isLocked(course.course_id) &&
                      !isCourseDisabled(course.course_id),
                  }"
                  @click="
                    !isTransferred(course.course_id) &&
                    !isLocked(course.course_id) &&
                    !isCourseDisabled(course.course_id) &&
                    quickAssign(course)
                  "
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs shrink-0">{{
                      course.course_code
                    }}</span>
                    <span class="truncate">{{ course.course_name }}</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <span class="badge badge-xs"
                      >{{ course.credit_hour }}cr</span
                    >
                    <span
                      v-if="isTransferred(course.course_id)"
                      class="badge badge-xs badge-success"
                      >T</span
                    >
                    <span
                      v-else-if="isLocked(course.course_id)"
                      class="badge badge-xs badge-success"
                    >
                      {{
                        passedCourses.find(
                          (c) => c.course_id === course.course_id,
                        )?.status === "Passed"
                          ? "✓"
                          : "✗"
                      }}
                    </span>
                    <span
                      v-else-if="isAssigned(course.course_id)"
                      class="badge badge-xs badge-primary"
                    >
                      S{{ getAssignedSemester(course.course_id) }}
                    </span>
                    <span
                      v-else-if="isCourseDisabled(course.course_id)"
                      class="badge badge-xs badge-warning"
                      >{{ getCourseDisabledReason(course.course_id) }}</span
                    >
                    <span v-else class="text-success">+</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Transferred Courses Collapse -->
      <div
        v-if="transferredCourses.length > 0"
        class="collapse collapse-arrow bg-success/5 border border-success/20 rounded-lg mt-4 flex-shrink-0"
      >
        <input type="checkbox" />
        <div class="collapse-title py-2 min-h-0 text-sm font-medium">
          View {{ transferredCourses.length }} Transferred Courses ({{
            planData.summary.transferred_credits
          }}
          credits)
        </div>
        <div class="collapse-content">
          <div class="flex flex-wrap gap-2 pt-2">
            <span
              v-for="course in transferredCourses"
              :key="course.course_id"
              class="badge badge-success gap-1"
            >
              {{ course.course_code }} ({{ course.credit_hour }}cr)
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Configure Plan Modal -->
    <dialog class="modal" :class="{ 'modal-open': isConfigModalOpen }">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg mb-1">Configure Semester Plan</h3>
        <p class="text-sm text-base-content/60 mb-4">
          Add/remove semesters and set LI (Latihan Industri) for scheduling.
        </p>

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
              <tr
                v-for="(rule, index) in editableRules"
                :key="rule.semester_number"
              >
                <td>
                  <span class="badge badge-neutral badge-sm">{{
                    rule.semester_number
                  }}</span>
                </td>
                <td>
                  <span
                    class="badge badge-sm"
                    :class="
                      rule.semester_type === 'L'
                        ? 'badge-primary'
                        : 'badge-secondary'
                    "
                  >
                    {{ rule.semester_type === "L" ? "Long" : "Short" }}
                  </span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm checkbox-accent"
                    v-model="rule.is_li"
                  />
                </td>
                <td>
                  <span
                    v-if="getConfigCreditRange(rule)"
                    class="text-xs text-base-content/60"
                  >
                    {{ getConfigCreditRange(rule)!.min }}–{{
                      getConfigCreditRange(rule)!.max
                    }}
                    cr
                  </span>
                  <span v-else class="text-xs text-base-content/40">—</span>
                </td>
                <td>
                  <button
                    v-if="!hasLockedCoursesInSemester(rule.semester_number)"
                    class="btn btn-ghost btn-xs text-error"
                    @click="removeConfigSemester(index)"
                    title="Remove semester"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <button
          class="btn btn-outline btn-sm mt-3 w-full"
          @click="addConfigSemester"
        >
          + Add Semester
        </button>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="isConfigModalOpen = false">
            Discard
          </button>
          <button class="btn btn-primary" @click="applyConfig">Apply</button>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @click="isConfigModalOpen = false"
      >
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
