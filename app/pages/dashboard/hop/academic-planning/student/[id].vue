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
  grade: string | null;
}

interface ResultSlip {
  semester: number;
  result_slip_filename: string;
  submitted_at: string;
}

interface Semester {
  semester: number;
  courses: Course[];
  total_credits: number;
}

interface PlanData {
  plan: {
    id: number;
    intake_id: number;
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
  resultSlips: ResultSlip[];
  summary: {
    total_semesters: number;
    total_credits: number;
    transferred_credits: number;
    planned_credits: number;
    total_courses: number;
  };
}

// Fetch plan data
const { data: planData, pending: loading } = await useFetch<PlanData>(
  `/api/hop/academic-planning/plan/${planId}`,
);

// Fetch current session
const { data: currentSessionData } = await useFetch<{
  current_session: { active_intake_period: string; semester_type: string } | null;
}>("/api/hop/current-session");

// Check if a semester is the current session
const isCurrentSession = (semesterNum: number): boolean => {
  const session = getSemesterSession(semesterNum);
  const activeSession = currentSessionData.value?.current_session?.active_intake_period;
  if (!session || !activeSession) return false;
  return session === activeSession;
};

// Compute the current absolute semester index to determine past vs upcoming
const currentSemesterNum = computed(() => {
  const sems = scheduledSemesters.value;
  for (const sem of sems) {
    if (isCurrentSession(sem.semester)) return sem.semester;
  }
  // Fallback: first semester without result
  const sequential = sems.find((s) => !s.has_result);
  return sequential?.semester ?? null;
});

// Check if plan exists
if (!loading.value && !planData.value) {
  await navigateTo("/dashboard/hop/academic-planning");
}

// Format intake year
const formatIntake = (intake: string | null) => {
  if (!intake || intake.length !== 4) return intake || "-";
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

// Fixed semester month cycle: May (Short), Aug (Long), Dec (Long)
const SEMESTER_MONTH_CYCLE = [5, 8, 12];

// Get the session MMYY string for a given semester number
const getSemesterSession = (semesterNum: number): string | null => {
  const intakeYear = planData.value?.plan.intake_year;
  const startSem = planData.value?.plan.start_semester || 1;
  if (!intakeYear || intakeYear.length !== 4) return null;

  const intakeMonth = parseInt(intakeYear.substring(0, 2));
  const intakeYY = parseInt(intakeYear.substring(2, 4));

  // Find the intake's position in the cycle
  const cycleIndex = SEMESTER_MONTH_CYCLE.indexOf(intakeMonth);
  if (cycleIndex === -1) return null;

  // intake_year corresponds to start_semester, so offset accordingly
  const offset = semesterNum - startSem;
  const targetIndex = cycleIndex + offset;
  if (targetIndex < 0) return null; // semester before intake
  const targetMonth = SEMESTER_MONTH_CYCLE[targetIndex % 3];

  // Calculate year offset: each full cycle of 3 = +1 year
  const fullCycles = Math.floor(targetIndex / 3);
  const targetYY = intakeYY + fullCycles;

  const mm = String(targetMonth).padStart(2, "0");
  const yy = String(targetYY % 100).padStart(2, "0");
  return `${mm}${yy}`;
};

// Format session MMYY to display label (e.g. "0524")
const formatSession = (mmyy: string): string => {
  return mmyy;
};

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};

// Get status badge class for plan status
const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "draft":
      return "badge-warning";
    case "approved":
      return "badge-success";
    case "completed":
      return "badge-info";
    default:
      return "badge-ghost";
  }
};

// Get status badge class for course status
const getCourseStatusClass = (status: string) => {
  switch (status) {
    case "Transferred":
      return "badge-success";
    case "Planned":
      return "badge-primary";
    case "Passed":
      return "badge-success";
    case "Failed":
      return "badge-error";
    default:
      return "badge-ghost";
  }
};

// Check if semester contains transferred courses
const hasTransferredCourses = (semester: Semester) => {
  return semester.courses.some((c) => c.status === "Transferred");
};

// Collapsible state
const collapsedSemesters = ref<Set<number>>(new Set());
const toggleSemester = (sem: number) => {
  if (collapsedSemesters.value.has(sem)) {
    collapsedSemesters.value.delete(sem);
  } else {
    collapsedSemesters.value.add(sem);
  }
};

// Collapsible state for transferred courses section
const transferredCollapsed = ref(true);

// Get all transferred courses grouped together
const allTransferredCourses = computed(() => {
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

// Result slip map by semester
const resultSlipMap = computed(() => {
  const map = new Map<number, ResultSlip>();
  if (planData.value?.resultSlips) {
    for (const slip of planData.value.resultSlips) {
      map.set(slip.semester, slip);
    }
  }
  return map;
});

// Grade point mapping (Malaysian standard)
const gradePointMap: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.67,
  "B+": 3.33,
  B: 3.0,
  "B-": 2.67,
  "C+": 2.33,
  C: 2.0,
  "C-": 1.67,
  "D+": 1.33,
  D: 1.0,
  F: 0.0,
};

// Get only scheduled semesters (from start_semester onwards, with non-Transferred courses)
const scheduledSemesters = computed(() => {
  if (!planData.value) return [];

  const startSem = planData.value.plan.start_semester || 1;

  return planData.value.semesters
    .filter((sem) => sem.semester >= startSem)
    .map((sem) => {
      const courses = sem.courses.filter((c) => c.status !== "Transferred");
      const passed = courses.filter((c) => c.status === "Passed").length;
      const failed = courses.filter((c) => c.status === "Failed").length;

      // Calculate GPA for this semester
      let gpa: string | null = null;
      const gradedCourses = courses.filter(
        (c) =>
          (c.status === "Passed" || c.status === "Failed") &&
          c.grade &&
          gradePointMap[c.grade] !== undefined,
      );
      if (gradedCourses.length > 0) {
        const totalWeighted = gradedCourses.reduce(
          (sum, c) => sum + gradePointMap[c.grade!] * c.credit_hour,
          0,
        );
        const totalCredits = gradedCourses.reduce(
          (sum, c) => sum + c.credit_hour,
          0,
        );
        gpa = (totalWeighted / totalCredits).toFixed(2);
      }

      return {
        ...sem,
        courses,
        total_credits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
        passed,
        failed,
        has_result: passed > 0 || failed > 0,
        result_slip: resultSlipMap.value.get(sem.semester) || null,
        gpa,
      };
    })
    .filter((sem) => sem.courses.length > 0)
    .sort((a, b) => a.semester - b.semester);
});

// Check if student has uploaded any results yet
const hasAnyResult = computed(() => {
  return scheduledSemesters.value.some((s) => s.has_result);
});

// Overall CGPA (grade replacement: latest entry per course)
const cgpa = computed(() => {
  if (!planData.value) return null;
  const latestByCourse = new Map<number, Course>();
  for (const sem of planData.value.semesters) {
    for (const c of sem.courses) {
      if (
        (c.status === "Passed" || c.status === "Failed") &&
        c.grade &&
        gradePointMap[c.grade] !== undefined
      ) {
        latestByCourse.set(c.course_id, c); // later entries overwrite earlier
      }
    }
  }
  if (latestByCourse.size === 0) return null;
  let totalWeighted = 0;
  let totalCredits = 0;
  for (const c of latestByCourse.values()) {
    if (!c.grade || gradePointMap[c.grade] === undefined) continue;
    totalWeighted += gradePointMap[c.grade] * c.credit_hour;
    totalCredits += c.credit_hour;
  }
  return (totalWeighted / totalCredits).toFixed(2);
});

// Status update modals
const showApproveModal = ref(false);
const showCompleteModal = ref(false);
const showReScheduleModal = ref(false);

const statusLoading = ref(false);

const openApproveModal = () => {
  showApproveModal.value = true;
};

const openCompleteModal = () => {
  showCompleteModal.value = true;
};

const openReScheduleModal = () => {
  showReScheduleModal.value = true;
};

const closeAllModals = () => {
  showApproveModal.value = false;
  showCompleteModal.value = false;
  showReScheduleModal.value = false;
};

const confirmApprove = async () => {
  if (!planData.value) return;

  statusLoading.value = true;
  try {
    await $fetch("/api/hop/academic-planning/plan/status", {
      method: "PATCH",
      body: {
        plan_id: planData.value.plan.id,
        status: "approved",
      },
    });
    window.location.reload();
  } catch (error: any) {
    alert(error.data?.message || "Failed to approve plan");
  } finally {
    statusLoading.value = false;
  }
};

const confirmComplete = async () => {
  if (!planData.value) return;

  statusLoading.value = true;
  try {
    await $fetch("/api/hop/academic-planning/plan/status", {
      method: "PATCH",
      body: {
        plan_id: planData.value.plan.id,
        status: "completed",
      },
    });
    window.location.reload();
  } catch (error: any) {
    alert(error.data?.message || "Failed to mark as completed");
  } finally {
    statusLoading.value = false;
  }
};

// Re-schedule: revert to draft and navigate to schedule page
const reScheduleLoading = ref(false);
const confirmReSchedule = async () => {
  if (!planData.value) return;

  reScheduleLoading.value = true;
  try {
    await $fetch("/api/hop/academic-planning/plan/status", {
      method: "PATCH",
      body: {
        plan_id: planData.value.plan.id,
        status: "draft",
      },
    });
    navigateTo(`/dashboard/hop/academic-planning/schedule/${planId}`);
  } catch (error: any) {
    alert(error.data?.message || "Failed to revert plan status");
  } finally {
    reScheduleLoading.value = false;
  }
};

// Navigate to schedule semester page
const goToSchedule = () => {
  navigateTo(`/dashboard/hop/academic-planning/schedule/${planId}`);
};

// Go back to intake page
const goBack = () => {
  if (planData.value?.plan.intake_id) {
    navigateTo(
      `/dashboard/hop/academic-planning/${planData.value.plan.intake_id}`,
    );
  } else {
    navigateTo("/dashboard/hop/academic-planning");
  }
};
</script>

<template>
  <div class="p-6 w-full space-y-6">
    <!-- Back Button & Header -->
    <div class="flex items-start gap-4">
      <button class="btn btn-ghost btn-sm mt-1" @click="goBack">← Back</button>
      <div class="flex-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold">Student Academic Plan</h1>
            <p class="text-sm text-base-content/60">
              View the generated academic plan for this student.
            </p>
          </div>
          <!-- Action Buttons at top right -->
          <div v-if="planData" class="flex items-center gap-2">
            <button
              v-if="planData.plan.status === 'draft'"
              class="btn btn-success btn-sm"
              @click="openApproveModal"
            >
              ✓ Approve Plan
            </button>
            <button
              v-if="planData.plan.status === 'approved'"
              class="btn btn-info btn-sm"
              @click="openCompleteModal"
            >
              ✓ Mark Complete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="planData">
      <!-- Student Info Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold">{{ planData.student.name }}</h2>
              <p class="text-sm text-base-content/60">
                {{ planData.student.matric_no }} • {{ planData.student.email }}
              </p>
            </div>
            <span
              class="badge"
              :class="getStatusBadgeClass(planData.plan.status)"
            >
              {{ planData.plan.status }}
            </span>
          </div>

          <div class="divider my-2"></div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Intake:</span>
              <div class="font-medium">
                {{
                  planData.plan.intake_name ||
                  formatIntake(planData.plan.intake_year)
                }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Starting Semester:</span>
              <div class="font-medium">
                Semester {{ planData.plan.start_semester }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Transferred Credits:</span>
              <div class="font-medium text-success">
                {{ planData.summary.transferred_credits ?? 0 }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Planned Credits:</span>
              <div class="font-medium text-primary">
                {{ planData.summary.planned_credits ?? 0 }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="stats shadow w-full">
        <div class="stat">
          <div class="stat-title">Total Semesters</div>
          <div class="stat-value text-2xl">
            {{ planData.summary.total_semesters }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Credits</div>
          <div class="stat-value text-2xl">
            {{ planData.summary.total_credits }}
          </div>
          <div class="stat-desc">
            {{ planData.summary.transferred_credits }} transferred +
            {{ planData.summary.planned_credits }} planned
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Courses</div>
          <div class="stat-value text-2xl">
            {{ planData.summary.total_courses }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">CGPA</div>
          <div class="stat-value text-2xl">
            {{ cgpa ?? "—" }}
          </div>
          <div v-if="cgpa" class="stat-desc">Cumulative GPA</div>
        </div>
      </div>

      <!-- CGPA Probation Warning -->
      <div v-if="cgpa && parseFloat(cgpa) < 2.5" class="alert alert-warning">
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
          <h3 class="font-bold">Academic Probation</h3>
          <div class="text-sm">
            This student's CGPA ({{ cgpa }}) is below 2.5. They are restricted
            to minimum credit hours only when scheduling.
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div class="flex items-center gap-4 text-sm flex-wrap">
        <div class="flex items-center gap-2">
          <span class="badge badge-success badge-sm">Transferred</span>
          <span class="text-base-content/60">Credited from previous study</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge badge-primary badge-sm">Planned</span>
          <span class="text-base-content/60">To be taken</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge badge-success badge-sm">Passed</span>
          <span class="text-base-content/60">Completed successfully</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge badge-error badge-sm">Failed</span>
          <span class="text-base-content/60">Needs to retake</span>
        </div>
      </div>

      <!-- Transferred Courses Section (Collapsible) -->
      <div
        v-if="allTransferredCourses.length > 0"
        class="card bg-success/5 border border-success/30 shadow-sm"
      >
        <div class="card-body">
          <div
            class="flex items-center justify-between cursor-pointer hover:bg-success/10 p-2 -mx-2 rounded-lg transition-colors select-none"
            @click="transferredCollapsed = !transferredCollapsed"
          >
            <div class="flex items-center gap-2">
              <!-- Chevron Icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                class="w-5 h-5 transition-transform duration-200 text-success"
                :class="transferredCollapsed ? '-rotate-90' : 'rotate-0'"
              >
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clip-rule="evenodd"
                />
              </svg>
              <h3 class="font-medium text-success">Transferred Courses</h3>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-success">
                {{ allTransferredCourses.length }} courses
              </span>
              <span class="badge badge-outline">
                {{ planData.summary.transferred_credits }} credits
              </span>
            </div>
          </div>

          <div
            v-show="!transferredCollapsed"
            class="overflow-x-auto transition-colors origin-top mt-2"
          >
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Course Code</th>
                  <th>Course Name</th>
                  <th class="text-right">Credits</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="course in allTransferredCourses"
                  :key="course.course_id"
                  class="bg-success/5"
                >
                  <td class="font-mono text-sm">{{ course.course_code }}</td>
                  <td>{{ course.course_name }}</td>
                  <td class="text-right">{{ course.credit_hour }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="font-medium">
                  <td colspan="2" class="text-right">Total:</td>
                  <td class="text-right">
                    {{ planData.summary.transferred_credits }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- Scheduled Semesters -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Scheduled Semesters</h2>
          <div class="flex gap-2">
            <!-- Schedule Semester Button (for draft status) -->
            <button
              v-if="planData.plan.status === 'draft'"
              class="btn btn-primary btn-sm"
              @click="goToSchedule"
            >
              📅 Schedule Semester
            </button>
            <!-- Re-schedule Button (for approved status) -->
            <button
              v-if="planData.plan.status === 'approved'"
              class="btn btn-warning btn-sm"
              @click="openReScheduleModal"
            >
              🔄 Re-schedule
            </button>
          </div>
        </div>

        <div
          v-for="semester in scheduledSemesters"
          :key="semester.semester"
          class="card bg-base-100 border shadow-sm transition-all"
          :class="[
            isCurrentSession(semester.semester)
              ? 'border-success ring-2 ring-success/30 shadow-lg shadow-success/10'
              : semester.has_result
                ? semester.failed > 0
                  ? 'border-warning/40' // Warning if has failures
                  : 'border-base-200'   // Neutral if complete
                : currentSemesterNum !== null && semester.semester < currentSemesterNum
                  ? 'ring-1 ring-error border-error/40' // Error if missing result and is in the past
                  : 'border-base-200'   // Neutral if upcoming
          ]"
        >
          <div class="card-body">
            <div
              class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-base-200/50 transition-colors select-none -mx-2 rounded-lg"
              @click="toggleSemester(semester.semester)"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-full flex shrink-0 items-center justify-center text-sm font-bold"
                  :class="
                    semester.has_result
                      ? semester.failed > 0
                        ? 'bg-warning/10 text-warning'
                        : 'bg-success/10 text-success'
                      : 'bg-primary/10 text-primary'
                  "
                >
                  {{ semester.semester }}
                </div>
                <div>
                  <div class="font-bold flex flex-wrap items-center gap-2">
                    {{ formatSemester(semester.semester) }}
                    <span v-if="isCurrentSession(semester.semester)" class="badge badge-success badge-sm font-mono gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-success-content animate-pulse"></span>
                      Current Session: {{ formatSession(getSemesterSession(semester.semester)!) }}
                    </span>
                    <span v-else-if="getSemesterSession(semester.semester)" 
                      class="badge badge-sm font-mono"
                      :class="currentSemesterNum !== null && semester.semester < currentSemesterNum ? 'badge-ghost text-base-content/60' : 'badge-info badge-outline border-info/30 text-info'"
                      >
                      {{ formatSession(getSemesterSession(semester.semester)!) }}
                    </span>
                  </div>
                  <div class="text-xs text-base-content/60 mt-0.5">
                    {{ semester.courses ? semester.courses.length : 0 }} courses
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
                <!-- Result badges -->
                <template v-if="semester.has_result">
                  <span class="badge badge-success badge-sm gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    {{ semester.passed }} Passed
                  </span>
                  <span
                    v-if="semester.failed > 0"
                    class="badge badge-error badge-sm gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    {{ semester.failed }} Failed
                  </span>
                </template>
                <span
                  v-if="
                    hasAnyResult &&
                    currentSemesterNum !== null &&
                    semester.semester < currentSemesterNum &&
                    !semester.has_result
                  "
                  class="badge badge-error badge-sm gap-1"
                >
                  ⚠ Missing Result
                </span>
                <span
                  v-if="semester.gpa"
                  class="badge badge-accent badge-sm font-mono"
                >
                  GPA {{ semester.gpa }}
                </span>
                <span class="badge badge-lg variant-soft font-mono">
                  {{ semester.total_credits }} Credits
                </span>
                
                <!-- Chevron Icon -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-5 h-5 transition-transform duration-200 text-base-content/40 hidden sm:block"
                  :class="collapsedSemesters.has(semester.semester) ? 'rotate-0' : 'rotate-180'"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>

            <div
              v-show="!collapsedSemesters.has(semester.semester)"
              class="overflow-x-auto transition-colors origin-top"
            >
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Course Code</th>
                    <th>Course Name</th>
                    <th class="text-right">Credits</th>
                    <th class="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="course in semester.courses"
                    :key="course.course_id"
                  >
                    <td class="font-mono text-sm">{{ course.course_code }}</td>
                    <td>{{ course.course_name }}</td>
                    <td class="text-right">{{ course.credit_hour }}</td>
                    <td class="text-center">
                      <span
                        class="badge badge-xs"
                        :class="getCourseStatusClass(course.status)"
                      >
                        {{ course.status }}
                      </span>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="font-medium">
                    <td colspan="3" class="text-right">Total:</td>
                    <td class="text-right">{{ semester.total_credits }}</td>
                  </tr>
                </tfoot>
              </table>

              <!-- Result slip indicator -->
              <div
                v-if="semester.result_slip"
                class="mt-2 flex items-center gap-2 text-sm text-base-content/60"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                Result slip: {{ semester.result_slip.result_slip_filename }}
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state if no scheduled semesters -->
        <div
          v-if="scheduledSemesters.length === 0"
          class="text-center py-8 text-base-content/60 border border-dashed border-base-300 rounded-lg"
        >
          <p>
            No scheduled semesters yet. Click "Schedule Semester" to start
            planning.
          </p>
        </div>
      </div>
    </template>
  </div>

  <!-- Approve Plan Modal -->
  <dialog
    class="modal modal-bottom sm:modal-middle"
    :class="{ 'modal-open': showApproveModal }"
  >
    <div class="modal-box">
      <h3 class="font-bold text-lg text-success flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
        Approve Academic Plan
      </h3>
      <p class="py-4">
        Are you sure you want to approve this plan? The student will be notified
        that their academic plan has been officially approved.
      </p>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="closeAllModals">Cancel</button>
        <button
          class="btn btn-success"
          :disabled="statusLoading"
          @click="confirmApprove"
        >
          <span
            v-if="statusLoading"
            class="loading loading-spinner loading-sm"
          ></span>
          {{ statusLoading ? "Approving..." : "Yes, Approve Plan" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="closeAllModals">
      <button>close</button>
    </form>
  </dialog>

  <!-- Mark Complete Modal -->
  <dialog
    class="modal modal-bottom sm:modal-middle"
    :class="{ 'modal-open': showCompleteModal }"
  >
    <div class="modal-box">
      <h3 class="font-bold text-lg text-info flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75"
          />
        </svg>
        Mark Plan as Completed
      </h3>
      <div class="py-4 space-y-3">
        <p>Are you sure you want to mark this plan as completed?</p>
        <div class="alert alert-warning text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-5 w-5"
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
            >This action cannot be undone. A completed plan is considered
            finalized.</span
          >
        </div>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="closeAllModals">Cancel</button>
        <button
          class="btn btn-info"
          :disabled="statusLoading"
          @click="confirmComplete"
        >
          <span
            v-if="statusLoading"
            class="loading loading-spinner loading-sm"
          ></span>
          {{ statusLoading ? "Processing..." : "Yes, Mark Complete" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="closeAllModals">
      <button>close</button>
    </form>
  </dialog>

  <!-- Re-schedule Modal -->
  <dialog
    class="modal modal-bottom sm:modal-middle"
    :class="{ 'modal-open': showReScheduleModal }"
  >
    <div class="modal-box">
      <h3 class="font-bold text-lg text-warning flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
        Re-schedule Plan
      </h3>
      <div class="py-4 space-y-3">
        <p>Are you sure you want to re-schedule this plan?</p>
        <div class="alert alert-info text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-5 h-5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <div>
            <p class="font-medium">This will:</p>
            <ul class="list-disc list-inside text-xs mt-1">
              <li>Revert the plan status to <strong>Draft</strong></li>
              <li>Allow you to modify the semester schedule</li>
              <li>Require re-approval after changes</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="closeAllModals">Cancel</button>
        <button
          class="btn btn-warning"
          :disabled="reScheduleLoading"
          @click="confirmReSchedule"
        >
          <span
            v-if="reScheduleLoading"
            class="loading loading-spinner loading-sm"
          ></span>
          {{ reScheduleLoading ? "Processing..." : "Yes, Re-schedule" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="closeAllModals">
      <button>close</button>
    </form>
  </dialog>
</template>
