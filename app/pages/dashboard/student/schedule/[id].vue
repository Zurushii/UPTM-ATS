<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({
  layout: "dashboard",
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
  status: "Planned" | "Transferred";
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
} = await useFetch<PlanData>(`/api/student/schedule/${planId}`);

// Fetch available courses + semester rules + credit limits
const { data: coursesData, pending: coursesLoading } = await useFetch<{
  courses: AvailableCourse[];
  semester_rules: SemesterRule[];
  credit_limits: CreditLimits;
}>(`/api/student/schedule/${planId}/courses`);

// Check if plan exists or not draft
if (
  !loading.value &&
  (!planData.value || planData.value.plan.status !== "draft")
) {
  await navigateTo(`/dashboard/student/academic-plan`);
}

// State
const selectedSemester = ref<number | null>(null);
const saveLoading = ref(false);
const courseAssignments = ref<Map<number, number>>(new Map()); // course_id -> semester
const showProgramStructure = ref(true);

// Initialize course assignments from plan data (only from start_semester onwards)
watchEffect(() => {
  if (planData.value) {
    const startSem = planData.value.plan.start_semester || 1;
    courseAssignments.value = new Map();
    for (const semester of planData.value.semesters) {
      // Only track assignments from start_semester onwards
      if (semester.semester >= startSem) {
        for (const course of semester.courses) {
          // Only track planned courses, not transferred
          if (course.status === "Planned") {
            courseAssignments.value.set(course.course_id, semester.semester);
          }
        }
      }
    }
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

// Get only planned courses (not transferred - ALL semesters available for assignment)
const plannedCourses = computed(() => {
  if (!coursesData.value) return [];

  // Get transferred course IDs
  const transferredIds = new Set<number>();
  if (planData.value) {
    for (const semester of planData.value.semesters) {
      for (const course of semester.courses) {
        if (course.status === "Transferred") {
          transferredIds.add(course.course_id);
        }
      }
    }
  }

  // Filter out only transferred courses (keep all others available)
  return coursesData.value.courses.filter(
    (c) => !transferredIds.has(c.course_id),
  );
});

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
  }
  return Array.from(semesters).sort((a, b) => a - b);
});

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

// Check if a prerequisite is satisfied (assigned to an earlier semester or transferred)
const isPrereqSatisfied = (
  prereqCourseId: number,
  targetSemester: number,
): boolean => {
  // Check if prereq is transferred (counts as satisfied regardless of semester)
  if (transferredCourses.value.some((tc) => tc.course_id === prereqCourseId))
    return true;
  // Check if prereq is assigned to an earlier semester
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
      const course = plannedCourses.value.find((c) => c.course_id === courseId);
      if (course) credits += course.credit_hour;
    }
  }
  return credits;
};

// Calculate total assigned credits
const totalAssignedCredits = computed(() => {
  let total = 0;
  for (const [courseId] of courseAssignments.value) {
    const course = plannedCourses.value.find((c) => c.course_id === courseId);
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
const getSemesterLimits = (
  sem: number,
): { min: number; max: number } | null => {
  const rule = getSemesterRule(sem);
  if (!rule || rule.is_li) return null; // LI semesters bypass validation
  const limits = coursesData.value?.credit_limits;
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
  // Check if this course belongs to a group and if another from the group is already assigned
  if (isGroupAlreadyAssigned(courseId)) {
    const existingCourse = getAssignedFromGroup(courseId);
    alert(
      `Cannot add this course. Another course from the same group (${existingCourse}) is already assigned or transferred.`,
    );
    return;
  }

  const rule = getSemesterRule(semester);
  const course = coursesData.value?.courses.find(
    (c) => c.course_id === courseId,
  );
  if (rule && course) {
    // LI semester: only Industrial Training allowed
    if (rule.is_li && course.course_type !== "Industrial Training") {
      alert(
        "This is an Industrial Training (LI) semester. Only Industrial Training courses can be assigned here.",
      );
      return;
    }
    // Non-LI semester: Industrial Training not allowed
    if (!rule.is_li && course.course_type === "Industrial Training") {
      alert(
        "Industrial Training courses can only be assigned to LI semesters.",
      );
      return;
    }
    // Short semester: block FYP2 and Industrial Training
    if (rule.semester_type === "S" && isLongSemesterOnly(course)) {
      alert(`${course.course_name} can only be taken in a Long semester.`);
      return;
    }
  }

  // Prerequisite check
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

// Clear all course assignments
const clearAllCourses = () => {
  if (
    confirm(
      "Are you sure you want to unassign all courses? This will clear all assignments.",
    )
  ) {
    courseAssignments.value.clear();
  }
};

// Save all changes
const saveChanges = async () => {
  if (!planData.value) return;

  saveLoading.value = true;
  const startSem = planData.value.plan.start_semester || 1;

  try {
    // Group courses by semester
    const semesterCourses: Map<
      number,
      { course_id: number; status: string }[]
    > = new Map();

    for (const [courseId, semester] of courseAssignments.value) {
      if (!semesterCourses.has(semester)) {
        semesterCourses.set(semester, []);
      }
      semesterCourses.get(semester)!.push({
        course_id: courseId,
        status: "Planned",
      });
    }

    // First, clear all available semesters (from start_semester onwards)
    for (const sem of availableSemesters.value) {
      await $fetch("/api/student/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester: sem,
          courses: semesterCourses.get(sem) || [],
        },
      });
    }

    // Also clear semesters before start_semester (to remove old courses)
    for (let sem = 1; sem < startSem; sem++) {
      await $fetch("/api/student/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester: sem,
          courses: [],
        },
      });
    }

    await refreshPlan();
    navigateTo(`/dashboard/student/academic-plan`);
  } catch (error: any) {
    alert(error.data?.message || "Failed to save schedule");
  } finally {
    saveLoading.value = false;
  }
};

// Go back
const goBack = () => {
  navigateTo(`/dashboard/student/academic-plan`);
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
            <p class="text-sm text-base-content/60">
              Arrange your courses for each semester
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
            {{
              plannedCourses.filter((c) => !isAssigned(c.course_id)).length
            }}
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
            <span v-if="getSemesterTypeLabel(sem)" class="text-xs opacity-60"
              >({{ getSemesterTypeLabel(sem) }})</span
            >
            <span
              class="badge badge-sm"
              :class="{
                'badge-success': getSemesterCreditStatus(sem) === 'ok',
                'badge-error': getSemesterCreditStatus(sem) === 'over',
                'badge-warning': getSemesterCreditStatus(sem) === 'under',
                'badge-ghost':
                  getSemesterCreditStatus(sem) === 'empty' ||
                  getSemesterCreditStatus(sem) === 'li',
                'badge-primary':
                  !getSemesterRule(sem) && selectedSemester === sem,
              }"
            >
              {{ getSemesterCredits(sem)
              }}<template v-if="getSemesterLimits(sem)"
                >/{{ getSemesterLimits(sem)!.min }}–{{
                  getSemesterLimits(sem)!.max
                }}</template
              >
            </span>
          </button>
        </div>
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
              <div class="flex items-center gap-2">
                <h2 class="font-semibold">
                  {{
                    selectedSemester
                      ? formatSemester(selectedSemester)
                      : "Select a Semester"
                  }}
                </h2>
                <span
                  v-if="
                    selectedSemester && getSemesterTypeLabel(selectedSemester)
                  "
                  class="badge badge-outline badge-sm"
                  >{{ getSemesterTypeLabel(selectedSemester) }}</span
                >
              </div>
              <div v-if="selectedSemester" class="flex items-center gap-2">
                <span
                  class="badge"
                  :class="{
                    'badge-success':
                      getSemesterCreditStatus(selectedSemester) === 'ok',
                    'badge-error':
                      getSemesterCreditStatus(selectedSemester) === 'over',
                    'badge-warning':
                      getSemesterCreditStatus(selectedSemester) === 'under',
                    'badge-primary': !getSemesterRule(selectedSemester),
                    'badge-ghost':
                      getSemesterCreditStatus(selectedSemester) === 'empty' ||
                      getSemesterCreditStatus(selectedSemester) === 'li',
                  }"
                >
                  {{ getSemesterCredits(selectedSemester)
                  }}<template v-if="getSemesterLimits(selectedSemester)">
                    / {{ getSemesterLimits(selectedSemester)!.min }}–{{
                      getSemesterLimits(selectedSemester)!.max
                    }}</template
                  >
                  credits
                </span>
              </div>
            </div>
            <!-- Credit warning -->
            <div
              v-if="
                selectedSemester &&
                getSemesterCreditStatus(selectedSemester) === 'over'
              "
              class="alert alert-error py-2 px-3 mt-2 text-sm"
            >
              ⚠️ Credits exceed the maximum ({{
                getSemesterLimits(selectedSemester)!.max
              }}) for a {{ getSemesterTypeLabel(selectedSemester) }} semester.
            </div>
            <div
              v-else-if="
                selectedSemester &&
                getSemesterCreditStatus(selectedSemester) === 'under'
              "
              class="alert alert-warning py-2 px-3 mt-2 text-sm"
            >
              ⚠️ Credits are below the minimum ({{
                getSemesterLimits(selectedSemester)!.min
              }}) for a {{ getSemesterTypeLabel(selectedSemester) }} semester.
            </div>
          </div>

          <!-- Scrollable Content -->
          <div class="flex-1 overflow-y-auto p-3 space-y-3">
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
                    'bg-primary/10 border border-primary/20':
                      isAssigned(course.course_id) &&
                      !isTransferred(course.course_id),
                    'bg-base-200/30 opacity-50 cursor-not-allowed':
                      !isAssigned(course.course_id) &&
                      !isTransferred(course.course_id) &&
                      isCourseDisabled(course.course_id),
                    'bg-base-200/50 hover:bg-base-200 cursor-pointer':
                      !isAssigned(course.course_id) &&
                      !isTransferred(course.course_id) &&
                      !isCourseDisabled(course.course_id),
                  }"
                  @click="
                    !isCourseDisabled(course.course_id) && quickAssign(course)
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
  </div>
</template>
