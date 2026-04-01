<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";
import ExcelJS from "exceljs";

definePageMeta({ layout: "dashboard" });

// Toast notification
const toast = ref<{ message: string; type: 'error' | 'success' | 'warning' } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const showToast = (message: string, type: 'error' | 'success' | 'warning' = 'error') => {
  if (toastTimer) clearTimeout(toastTimer);
  toast.value = { message, type };
  toastTimer = setTimeout(() => { toast.value = null; }, 4000);
};

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

// Types
interface Course {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  status: "Planned" | "Transferred" | "Passed" | "Failed";
  grade: string | null;
}

interface ResultSlip {
  semester: number;
  result_slip_filename: string;
  submitted_at: string;
}

interface AcademicPlan {
  id: number;
  status: "draft" | "approved" | "completed";
  start_semester: number;
}

interface SemesterMeta {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
}

interface PlanResponse {
  plan: AcademicPlan | null;
  courses: Course[];
  resultSlips: ResultSlip[];
  semesterMeta: SemesterMeta[];
  intakeCurrentSemester: number | null;
}

const { data, pending, refresh } = await useFetch<PlanResponse>(
  "/api/student/academic-plan",
);
const { data: profile } = await useFetch<any>("/api/student/profile");

// Fetch current session
interface CurrentSession {
  active_intake_period: string;
  semester_type: "L" | "S";
  current_semester: number;
  updated_at: string;
}
const { data: sessionData, refresh: refreshSession } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

// Poll every 15s so currentSemester updates when HOP changes the session
onMounted(() => {
  const interval = setInterval(refreshSession, 5000);
  onUnmounted(() => clearInterval(interval));
});

// Track which semesters are expanded
const expandedSemesters = ref<Set<number>>(new Set());

// Transferred courses collapsed state
const transferredCollapsed = ref(true);

// Get all transferred courses grouped together
const allTransferredCourses = computed(() => {
  if (!data.value?.courses) return [];
  return data.value.courses.filter((c) => c.status === "Transferred");
});

// Total transferred credits
const transferredCredits = computed(() => {
  return allTransferredCourses.value.reduce((sum, c) => sum + c.credit_hour, 0);
});

// Result slip map by semester
const resultSlipMap = computed(() => {
  const map = new Map<number, ResultSlip>();
  if (data.value?.resultSlips) {
    for (const rs of data.value.resultSlips) {
      map.set(rs.semester, rs);
    }
  }
  return map;
});

// Semester type lookup map (still used for LI display/labels)
const semesterMetaMap = computed(() => {
  const map = new Map<number, { semester_type: "L" | "S"; is_li: boolean }>();
  for (const m of data.value?.semesterMeta ?? []) {
    map.set(m.semester_number, {
      semester_type: m.semester_type,
      is_li: m.is_li,
    });
  }
  return map;
});

// Whether the student has uploaded any result at all
const hasAnyResult = computed(() =>
  scheduledSemesters.value.some((s) => s.has_result),
);

// Current semester: per-intake value set by HOP, or fallback to first sem without result
const currentSemester = computed(() => {
  const sems = scheduledSemesters.value;
  if (!sems.length) return null;
  if (!data.value?.plan) return null;

  // Use the per-intake current_semester set by HOP.
  // current_semester is relative (1 = first semester of this cohort),
  // so convert to absolute by adding the student's starting semester offset.
  const intakeSem = data.value.intakeCurrentSemester;
  if (intakeSem != null) {
    const startSem = data.value.plan.start_semester || 1;
    const absoluteSem = startSem + intakeSem - 1;
    if (sems.some((s) => s.semester === absoluteSem)) {
      return absoluteSem;
    }
  }

  // Fallback: first semester without result
  const sequential = sems.find((s) => !s.has_result);
  return sequential?.semester ?? null;
});

// Grade point mapping (Malaysian university standard)
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

// Get scheduled semesters (from start_semester onwards, non-Transferred courses)
const scheduledSemesters = computed(() => {
  if (!data.value?.courses || !data.value?.plan) return [];

  const startSem = data.value.plan.start_semester || 1;
  const grouped: Record<number, Course[]> = {};

  for (const course of data.value.courses) {
    if (course.status !== "Transferred" && course.semester >= startSem) {
      if (!grouped[course.semester]) {
        grouped[course.semester] = [];
      }
      grouped[course.semester]!.push(course);
    }
  }

  return Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b)
    .map((sem) => {
      const courses = grouped[sem] || [];
      const passed = courses.filter((c) => c.status === "Passed").length;
      const failed = courses.filter((c) => c.status === "Failed").length;

      // Calculate semester GPA
      const graded = courses.filter(
        (c) => (c.status === "Passed" || c.status === "Failed") && c.grade,
      );
      let semGpa: string | null = null;
      if (graded.length > 0) {
        let pts = 0,
          cr = 0;
        for (const c of graded) {
          const gp = gradePointMap[c.grade!.toUpperCase()];
          if (gp !== undefined) {
            pts += gp * c.credit_hour;
            cr += c.credit_hour;
          }
        }
        if (cr > 0) semGpa = (pts / cr).toFixed(2);
      }

      return {
        semester: sem,
        courses,
        total_credits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
        passed,
        failed,
        has_result: passed + failed > 0,
        result_slip: resultSlipMap.value.get(sem) || null,
        gpa: semGpa,
      };
    });
});

const totalStudySemesters = computed(() => scheduledSemesters.value.length);

// Initialize all semesters as expanded on initial load only
watch(
  () => scheduledSemesters.value,
  (newSemesters) => {
    if (newSemesters.length > 0 && expandedSemesters.value.size === 0) {
      newSemesters.forEach((s) => expandedSemesters.value.add(s.semester));
    }
  },
  { immediate: true, once: true }
);

const toggleSemester = (semester: number) => {
  if (expandedSemesters.value.has(semester)) {
    expandedSemesters.value.delete(semester);
  } else {
    expandedSemesters.value.add(semester);
  }
};

// Navigate to schedule semester page
const goToSchedule = async () => {
  if (data.value?.plan) {
    await navigateTo(`/dashboard/student/schedule/${data.value.plan.id}`);
  }
};

// Export to Excel function
const exportToExcelLoading = ref<number | null>(null);

const exportSemesterToExcel = async (sem: (typeof scheduledSemesters.value)[number]) => {
  if (exportToExcelLoading.value !== null) return;
  exportToExcelLoading.value = sem.semester;
  
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "UTPM ATS";
    workbook.created = new Date();
    
    const safeFormatString = sem.semester ? `Semester_${sem.semester}` : 'Semester_Export';
    const sheet = workbook.addWorksheet(safeFormatString);
    
    sheet.addRow([`Academic Plan - ${formatSemester(sem.semester)}`]);
    sheet.getRow(1).font = { bold: true, size: 14 };
    
    sheet.addRow([`Student: ${profile.value?.full_name || 'N/A'}`]);
    sheet.addRow([`Matric No: ${profile.value?.matric_no || 'N/A'}`]);
    sheet.addRow([`Program: ${profile.value?.program_code || 'N/A'}`]);
    sheet.addRow([]);
    
    const headers = ["Course Code", "Course Name", "Credits", "Status", "Grade"];
    sheet.addRow(headers);
    const headerRow = sheet.lastRow!;
    headerRow.font = { bold: true };
    headerRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    for (const course of sem.courses) {
      sheet.addRow([
        course.course_code,
        course.course_name,
        course.credit_hour,
        course.status,
        course.grade || "-"
      ]);
    }
    
    sheet.addRow([]);
    sheet.addRow(["", "Total Credits:", sem.total_credits]);
    sheet.lastRow!.font = { bold: true };
    
    if (sem.gpa) {
      sheet.addRow(["", "GPA:", sem.gpa]);
      sheet.lastRow!.font = { bold: true };
    }
    
    sheet.getColumn(1).width = 15;
    sheet.getColumn(2).width = 45;
    sheet.getColumn(3).width = 10;
    sheet.getColumn(4).width = 15;
    sheet.getColumn(5).width = 10;
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Academic_Plan_${safeFormatString}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export Excel", error);
    showToast("Failed to export Excel document.", 'error');
  } finally {
    exportToExcelLoading.value = null;
  }
};

// Re-schedule: revert to draft and navigate to schedule page
const reScheduleLoading = ref(false);
const showReScheduleModal = ref(false);
const openReScheduleModal = () => { showReScheduleModal.value = true; };
const closeReScheduleModal = () => { showReScheduleModal.value = false; };

const reSchedule = async () => {
  if (!data.value?.plan) return;

  reScheduleLoading.value = true;
  try {
    await $fetch("/api/student/plan-status", {
      method: "PATCH",
      body: {
        plan_id: data.value.plan.id,
        status: "draft",
      },
    });
    navigateTo(`/dashboard/student/schedule/${data.value.plan.id}`);
  } catch (error: any) {
    showToast(error.data?.message || "Failed to revert plan status", 'error');
    closeReScheduleModal();
  } finally {
    reScheduleLoading.value = false;
  }
};

// Total credits in plan (non-transferred)
const plannedCredits = computed(() => {
  return (
    data.value?.courses
      ?.filter(
        (c) =>
          c.status !== "Transferred" &&
          !(c.status === "Planned" && retakeCourseIds.value.has(c.course_id))
      )
      .reduce((sum: number, c: Course) => sum + c.credit_hour, 0) || 0
  );
});

// Total credits (transferred + planned)
const totalCredits = computed(() => {
  return transferredCredits.value + plannedCredits.value;
});

const latestCourses = computed(() => {
  const latestByCourse = new Map<number, Course>();

  for (const course of data.value?.courses ?? []) {
    latestByCourse.set(course.course_id, course);
  }

  return [...latestByCourse.values()];
});

const obtainedCredits = computed(() => {
  return latestCourses.value.reduce((sum, course) => {
    if (course.status === "Transferred" || course.status === "Passed") {
      return sum + course.credit_hour;
    }

    return sum;
  }, 0);
});

const creditHoursLeft = computed(() => {
  return latestCourses.value.reduce((sum, course) => {
    if (course.status === "Transferred" || course.status === "Passed") {
      return sum;
    }

    return sum + course.credit_hour;
  }, 0);
});

// Credit progress percentage
const creditProgress = computed(() => {
  if (!profile.value?.total_credit_required) return 0;
  return Math.round(
    (totalCredits.value / profile.value.total_credit_required) * 100,
  );
});

// Status info
const statusInfo = computed(() => {
  switch (data.value?.plan?.status) {
    case "approved":
      return { color: "badge-success", icon: "✓", text: "Approved" };
    case "completed":
      return { color: "badge-info", icon: "★", text: "Completed" };
    default:
      return { color: "badge-warning", icon: "⏳", text: "Draft" };
  }
});

// Calculate CGPA from all graded courses (grade replacement: latest entry per course)
const cgpa = computed(() => {
  if (!data.value?.courses) return null;
  const graded = data.value.courses.filter(
    (c) => (c.status === "Passed" || c.status === "Failed") && c.grade,
  );
  if (graded.length === 0) return null;

  // Grade replacement: keep only the latest entry per course_id
  const latestByCourse = new Map<number, (typeof graded)[0]>();
  for (const c of graded) {
    latestByCourse.set(c.course_id, c); // later entries overwrite earlier
  }

  let totalPoints = 0;
  let totalCredits = 0;
  for (const c of latestByCourse.values()) {
    const gp = gradePointMap[c.grade!.toUpperCase()];
    if (gp !== undefined) {
      totalPoints += gp * c.credit_hour;
      totalCredits += c.credit_hour;
    }
  }
  if (totalCredits === 0) return null;
  return (totalPoints / totalCredits).toFixed(2);
});

// Retake course IDs: courses with status "Planned" that previously had "Failed"
const retakeCourseIds = computed(() => {
  if (!data.value?.courses) return new Set<number>();
  const failedIds = new Set<number>();
  const retakeIds = new Set<number>();
  // Group by semester ascending to walk in order
  const sorted = [...data.value.courses].sort((a, b) => a.semester - b.semester);
  for (const course of sorted) {
    if (course.status === "Failed") {
      failedIds.add(course.course_id);
    } else if (course.status === "Passed") {
      failedIds.delete(course.course_id);
      retakeIds.delete(course.course_id);
    } else if (course.status === "Planned" && failedIds.has(course.course_id)) {
      retakeIds.add(course.course_id);
    }
  }
  return retakeIds;
});

// Format intake year
const formatIntake = (intake: string | null | undefined) => {
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

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};

// Fixed semester month cycle: May (Short), Aug (Long), Dec (Long)
const SEMESTER_MONTH_CYCLE = [5, 8, 12];

// Get the session MMYY string for a given semester number
const getSemesterSession = (semesterNum: number): string | null => {
  const intakeYear = profile.value?.intake_year as string | undefined;
  const startSem = data.value?.plan?.start_semester || 1;
  if (!intakeYear || intakeYear.length !== 4) return null;

  const intakeMonth = parseInt(intakeYear.substring(0, 2));
  const intakeYY = parseInt(intakeYear.substring(2, 4));

  const cycleIndex = SEMESTER_MONTH_CYCLE.indexOf(intakeMonth);
  if (cycleIndex === -1) return null;

  const offset = semesterNum - startSem;
  const targetIndex = cycleIndex + offset;
  if (targetIndex < 0) return null;
  const targetMonth = SEMESTER_MONTH_CYCLE[targetIndex % 3];

  const fullCycles = Math.floor(targetIndex / 3);
  const targetYY = intakeYY + fullCycles;

  const mm = String(targetMonth).padStart(2, "0");
  const yy = String(targetYY % 100).padStart(2, "0");
  return `${mm}${yy}`;
};

// Format session MMYY to display label
const formatSession = (mmyy: string): string => mmyy;

// Check if a semester is the current session
const isCurrentSession = (semesterNum: number): boolean => {
  const session = getSemesterSession(semesterNum);
  const activeSession = sessionData.value?.current_session?.active_intake_period;
  if (!session || !activeSession) return false;
  return session === activeSession;
};

// Check if a session string is strictly before the system's global active session
const isSessionInPast = (sessionStr: string | null): boolean => {
  const activeSessionStr = sessionData.value?.current_session?.active_intake_period;
  if (!sessionStr || !activeSessionStr) return false;

  const parseSession = (s: string) => {
    if (s.length !== 4) return 0;
    const m = parseInt(s.substring(0, 2), 10);
    const y = parseInt(s.substring(2, 4), 10);
    return y * 100 + m;
  };

  return parseSession(sessionStr) < parseSession(activeSessionStr);
};

// ── Upload Result Modal ──
const showUploadModal = ref(false);
const selectedSemester = ref<(typeof scheduledSemesters.value)[number] | null>(
  null,
);
const uploading = ref(false);
const uploadError = ref("");
const uploadSuccess = ref(false);
const resultSlipFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const courseResults = ref<Record<number, "Passed" | "Failed">>({});
const courseGrades = ref<Record<number, string>>({});
const parsing = ref(false);
const parseMessage = ref("");
const parseMessageType = ref<"info" | "warning" | "success">("info");
const unmatchedCourses = ref<string[]>([]);

const openUploadModal = (sem: (typeof scheduledSemesters.value)[number]) => {
  selectedSemester.value = sem;
  resultSlipFile.value = null;
  uploadError.value = "";
  uploadSuccess.value = false;
  courseResults.value = {};
  courseGrades.value = {};
  parsing.value = false;
  parseMessage.value = "";
  unmatchedCourses.value = [];
  showUploadModal.value = true;
};

const closeUploadModal = () => {
  showUploadModal.value = false;
  selectedSemester.value = null;
};

const onFileChange = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    resultSlipFile.value = target.files[0] ?? null;
  } else {
    return;
  }
  if (!resultSlipFile.value || !selectedSemester.value) return;

  courseResults.value = {};
  courseGrades.value = {};
  parseMessage.value = "";
  unmatchedCourses.value = [];
  parsing.value = true;
  parseMessage.value = "Parsing result slip...";
  parseMessageType.value = "info";

  try {
    const formData = new FormData();
    formData.append("result_slip", resultSlipFile.value);
    formData.append("semester", String(selectedSemester.value.semester));

    const res = await $fetch<any>("/api/student/results/parse", {
      method: "POST",
      body: formData,
    });

    if (!res.parsed) {
      parseMessage.value = res.reason || "Could not parse the file.";
      parseMessageType.value = "warning";
      return;
    }

    for (const r of res.results) {
      courseResults.value[r.course_id] = r.status;
      courseGrades.value[r.course_id] = r.grade;
    }
    unmatchedCourses.value = res.unmatched || [];

    if (res.matched_count === res.total_courses) {
      parseMessage.value = `All ${res.matched_count} courses detected from the result slip.`;
      parseMessageType.value = "success";
    } else if (res.matched_count > 0) {
      parseMessage.value = `Detected ${res.matched_count} of ${res.total_courses} courses. Unmatched courses will not be updated.`;
      parseMessageType.value = "warning";
    } else {
      parseMessage.value = "Could not detect any courses from the file.";
      parseMessageType.value = "warning";
    }
  } catch {
    parseMessage.value = "Failed to parse the file.";
    parseMessageType.value = "warning";
  } finally {
    parsing.value = false;
  }
};

const hasAnyParsedResult = computed(
  () => Object.keys(courseResults.value).length > 0,
);
const canSubmit = computed(
  () =>
    resultSlipFile.value &&
    hasAnyParsedResult.value &&
    !uploading.value &&
    !parsing.value,
);

const submitResults = async () => {
  if (
    !selectedSemester.value ||
    !resultSlipFile.value ||
    !hasAnyParsedResult.value
  )
    return;
  uploading.value = true;
  uploadError.value = "";
  uploadSuccess.value = false;

  try {
    const formData = new FormData();
    formData.append("semester", String(selectedSemester.value.semester));
    formData.append("result_slip", resultSlipFile.value);
    formData.append(
      "results",
      JSON.stringify(
        Object.entries(courseResults.value).map(([courseId, status]) => ({
          course_id: Number(courseId),
          status,
          grade: courseGrades.value[Number(courseId)] || undefined,
        })),
      ),
    );
    await $fetch("/api/student/results", { method: "POST", body: formData });
    uploadSuccess.value = true;
    await refresh();
    setTimeout(() => closeUploadModal(), 1500);
  } catch (error: any) {
    uploadError.value =
      error?.data?.statusMessage || "Failed to submit results";
  } finally {
    uploading.value = false;
  }
};

// Get status badge class for course status
const getCourseStatusClass = (status: string, courseId?: number, semesterNum?: number) => {
  if (status === "Planned") {
    if (courseId !== undefined && retakeCourseIds.value.has(courseId)) return "badge-warning";
    if (semesterNum !== undefined) {
      if (isCurrentSession(semesterNum)) return "badge-info text-info-content";
      if (isSessionInPast(getSemesterSession(semesterNum))) return "badge-error badge-outline border-error/50 text-error";
    }
    return "badge-primary";
  }
  switch (status) {
    case "Transferred":
      return "badge-success";
    case "Passed":
      return "badge-success";
    case "Failed":
      return "badge-error";
    default:
      return "badge-ghost";
  }
};

// Get display status string
const getCourseDisplayStatus = (status: string, courseId?: number, semesterNum?: number) => {
  if (status === "Planned") {
    if (courseId !== undefined && retakeCourseIds.value.has(courseId)) return "Retake";
    if (semesterNum !== undefined) {
      if (isCurrentSession(semesterNum)) return "In Progress";
      if (isSessionInPast(getSemesterSession(semesterNum))) return "Pending Result";
    }
    return "Planned";
  }
  return status;
};

// ── Revoke Result ──
const revoking = ref(false);
const showRevokeConfirm = ref(false);
const revokeSemester = ref<(typeof scheduledSemesters.value)[number] | null>(
  null,
);

const openRevokeConfirm = (sem: (typeof scheduledSemesters.value)[number]) => {
  revokeSemester.value = sem;
  showRevokeConfirm.value = true;
};
const closeRevokeConfirm = () => {
  showRevokeConfirm.value = false;
  revokeSemester.value = null;
};
const revokeResult = async () => {
  if (!revokeSemester.value) return;
  revoking.value = true;
  try {
    await $fetch("/api/student/results", {
      method: "DELETE",
      body: { semester: revokeSemester.value.semester },
    });
    await refresh();
    closeRevokeConfirm();
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to revoke results", 'error');
  } finally {
    revoking.value = false;
  }
};
</script>

<template>
  <!-- Toast Notification -->
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="translate-y-4 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="toast"
      class="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl border text-sm font-medium max-w-sm"
      :class="{
        'bg-error/10 border-error/30 text-error': toast.type === 'error',
        'bg-success/10 border-success/30 text-success': toast.type === 'success',
        'bg-warning/10 border-warning/30 text-warning': toast.type === 'warning',
      }"
    >
      <!-- Icon -->
      <svg v-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 shrink-0">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      <svg v-else-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 shrink-0">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 shrink-0">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <span>{{ toast.message }}</span>
      <button class="ml-auto opacity-60 hover:opacity-100 transition-opacity" @click="toast = null">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </Transition>

  <!-- Loading Skeleton -->
  <div v-if="pending" class="space-y-6">
    <div class="skeleton h-12 w-80"></div>
    <div class="skeleton h-32"></div>
    <div class="skeleton h-64"></div>
    <div class="skeleton h-64"></div>
  </div>

  <div v-else class="space-y-8">
    <!-- Header -->
    <div
      class="flex flex-col md:flex-row md:items-center justify-between gap-4"
    >
      <div>
        <div class="flex items-center gap-3">
          <div
            class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary"
          >
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
                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <div>
            <h1 class="text-2xl font-bold">My Academic Plan</h1>
            <p class="text-base-content/60 text-sm">
              {{ profile?.program_code }} • {{ profile?.program_name }}
            </p>
          </div>
        </div>
      </div>

      <NuxtLink to="/dashboard/student" class="btn btn-ghost btn-sm gap-2">
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
            d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
          />
        </svg>
        Back to Dashboard
      </NuxtLink>
    </div>

    <!-- No Plan Yet -->
    <div
      v-if="!data?.plan"
      class="card bg-base-100 border border-base-200 shadow-sm text-center py-12"
    >
      <div class="card-body items-center max-w-md mx-auto">
        <div
          class="w-20 h-20 bg-base-200 rounded-full flex items-center justify-center mb-6"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-10 h-10 text-base-content/40"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
            />
          </svg>
        </div>
        <h2 class="text-xl font-bold">Plan Pending</h2>
        <p class="text-base-content/60 mt-2">
          Your academic plan is currently being prepared by the Head of Program.
        </p>
      </div>
    </div>

    <!-- Has Plan -->
    <template v-else>
      <div class="flex flex-col xl:flex-row gap-6 items-start">
        
        <!-- Left Sidebar: Legend -->
        <details class="collapse collapse-arrow bg-base-100 border border-base-300 shadow-sm w-full xl:w-64 shrink-0 xl:sticky xl:top-24 z-10" open>
          <summary class="collapse-title p-4 sm:p-5 font-bold text-sm text-base-content/70 uppercase tracking-wider min-h-0 select-none">
            Status Guide
          </summary>
          <div class="collapse-content px-4 sm:px-5 pb-4 sm:pb-5">
            <div class="flex flex-col gap-3 text-sm pt-1">
              <div class="flex flex-col gap-1">
                <span class="badge badge-success badge-sm w-fit">Transferred</span>
                <span class="text-base-content/60 text-xs">Credited from previous study</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-info badge-sm text-info-content w-fit">In Progress</span>
                <span class="text-base-content/60 text-xs">Currently active</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-error badge-outline border-error/50 text-error badge-sm w-fit">Pending Result</span>
                <span class="text-base-content/60 text-xs">Awaiting grades</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-primary badge-sm w-fit">Planned</span>
                <span class="text-base-content/60 text-xs">Future semesters</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-warning badge-sm w-fit">Retake</span>
                <span class="text-base-content/60 text-xs">Re-enrolling after fail</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-success badge-sm w-fit">Passed</span>
                <span class="text-base-content/60 text-xs">Completed successfully</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="badge badge-error badge-sm w-fit">Failed</span>
                <span class="text-base-content/60 text-xs">Needs to retake</span>
              </div>
            </div>
          </div>
        </details>

        <!-- Main Content (Right) -->
        <div class="flex-1 space-y-6 min-w-0 w-full">
          <!-- Student Info Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold">{{ profile?.full_name || 'Loading...' }}</h2>
              <p class="text-sm text-base-content/60">
                {{ profile?.matric_no || '—' }} • {{ profile?.email || '—' }}
              </p>
            </div>
            <span
              class="badge capitalize"
              :class="statusInfo.color"
            >
              {{ data.plan.status }}
            </span>
          </div>

          <div class="divider my-2"></div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Intake:</span>
              <div class="font-medium">
                {{
                  profile?.intake_name ||
                  formatIntake(profile?.intake_year)
                }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Starting Semester:</span>
              <div class="font-medium">
                Semester {{ data.plan.start_semester }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Transferred Credits:</span>
              <div class="font-medium text-success">
                {{ transferredCredits }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Planned Credits:</span>
              <div class="font-medium text-primary">
                {{ plannedCredits }}
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
            {{ totalStudySemesters }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Credit Hour Left</div>
          <div class="stat-value text-2xl">
            {{ creditHoursLeft }}
          </div>
          <div class="stat-desc">
            Remaining to complete
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Credit Obtained</div>
          <div class="stat-value text-2xl">
            {{ obtainedCredits }}
          </div>
          <div class="stat-desc">Transferred and passed</div>
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
            Your CGPA ({{ cgpa }}) is below 2.5. You are restricted
            to minimum credit hours only when scheduling.
          </div>
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
                {{ transferredCredits }} credits
              </span>
            </div>
          </div>

          <div
            v-show="!transferredCollapsed"
            class="overflow-x-auto transition-all duration-300 origin-top mt-2"
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
                  <td class="text-right">{{ transferredCredits }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- Semester Controls -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-5 h-5 opacity-60"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0h18M5 21h14a2 2 0 0 0 2-2v-3.28m-16 5.28M5 21a2 2 0 0 1-2-2v-3.28m0 0h.008v.008H3V12"
            />
          </svg>
          Scheduled Semesters
        </h2>
        <!-- Schedule Semester Button (for draft) -->
        <button
          v-if="data.plan.status === 'draft'"
          class="btn btn-primary btn-sm"
          @click="goToSchedule"
        >
          📅 Schedule Semester
        </button>
        <!-- Re-schedule Button (for approved) -->
        <button
          v-if="data.plan.status === 'approved'"
          class="btn btn-warning btn-sm"
          :disabled="reScheduleLoading"
          @click="openReScheduleModal"
        >
          <span
            v-if="reScheduleLoading"
            class="loading loading-spinner loading-xs"
          ></span>
          🔄 Re-schedule Semester
        </button>
      </div>

      <!-- Accordion Semesters -->
      <div class="space-y-4">
        <div
          v-for="sem in scheduledSemesters"
          :key="sem.semester"
          class="card bg-base-100 border shadow-sm transition-all duration-200"
          :class="[
            expandedSemesters.has(sem.semester)
              ? 'ring-2 ring-base-200 shadow-md'
              : 'hover:border-base-300',
            isCurrentSession(sem.semester)
              ? 'ring-2 ring-success/30 border-success shadow-lg shadow-success/10'
              : sem.has_result
                ? sem.failed > 0
                  ? 'border-warning/40' // Warning if has failures
                  : 'border-base-200'   // Neutral if complete
                : isSessionInPast(getSemesterSession(sem.semester)) && !sem.has_result
                  ? 'ring-1 ring-error border-error/40' // Error if missing result and is in the past
                  : 'border-base-200'   // Neutral if upcoming
          ]"
        >
          <div class="card-body">
            <!-- Header Trigger -->
            <div
              class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-base-200/50 transition-colors select-none -mx-2 rounded-lg"
              @click="toggleSemester(sem.semester)"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-full flex shrink-0 items-center justify-center text-sm font-bold"
                  :class="
                    sem.has_result
                      ? sem.failed > 0
                        ? 'bg-warning/10 text-warning'
                        : 'bg-success/10 text-success'
                      : 'bg-primary/10 text-primary'
                  "
                >
                  {{ sem.semester }}
                </div>
                <div>
                  <div class="font-bold flex flex-wrap items-center gap-2">
                    {{ formatSemester(sem.semester) }}
                    <span
                      v-if="isCurrentSession(sem.semester)"
                      class="badge badge-success badge-sm font-mono gap-1"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-success-content animate-pulse"></span>
                      Current Session: {{ formatSession(getSemesterSession(sem.semester)!) }}
                    </span>
                    <span
                      v-else-if="getSemesterSession(sem.semester)"
                      class="badge badge-sm font-mono"
                      :class="isSessionInPast(getSemesterSession(sem.semester)) ? 'badge-ghost text-base-content/60' : 'badge-info badge-outline border-info/30 text-info'"
                    >
                      Session: {{ formatSession(getSemesterSession(sem.semester)!) }}
                    </span>
                    <span
                      v-if="sem.semester === currentSemester && !isCurrentSession(sem.semester)"
                      class="badge badge-primary badge-sm"
                    >
                      Current
                    </span>
                  </div>
                  <div class="text-xs text-base-content/60 mt-0.5">
                    {{ sem.courses ? sem.courses.length : 0 }} courses
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
                <!-- Result badges -->
                <template v-if="sem.has_result">
                  <span class="badge badge-success badge-sm gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      class="w-3 h-3"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                    {{ sem.passed }} Passed
                  </span>
                  <span
                    v-if="sem.failed > 0"
                    class="badge badge-error badge-sm gap-1"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      class="w-3 h-3"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                    {{ sem.failed }} Failed
                  </span>
                </template>
                <span
                  v-if="!sem.has_result && isSessionInPast(getSemesterSession(sem.semester))"
                  class="badge badge-error badge-sm gap-1"
                >
                  ⚠ Missing Result
                </span>
                <span
                  v-if="sem.gpa"
                  class="badge badge-accent badge-sm font-mono"
                >
                  GPA {{ sem.gpa }}
                </span>
                <span class="badge badge-lg variant-soft font-mono">
                  {{ sem.total_credits }} Credits
                </span>
                <!-- Chevron Icon -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-5 h-5 transition-transform duration-200 text-base-content/40 hidden sm:block"
                  :class="expandedSemesters.has(sem.semester) ? 'rotate-180' : 'rotate-0'"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>

            <!-- Collapsible Content -->
            <div
              v-show="expandedSemesters.has(sem.semester)"
              class="overflow-x-auto transition-all origin-top rounded-b-lg border-t border-base-200 mt-2"
            >
              <table class="table w-full">
                <thead class="bg-base-200/50 text-base-content/70 uppercase text-xs tracking-wider">
                  <tr>
                    <th class="w-24 pl-6">Code</th>
                    <th>Course Name</th>
                    <th class="text-right w-20">Credits</th>
                    <th class="text-center w-36 pr-6">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-base-200">
                  <tr
                    v-for="course in sem.courses"
                    :key="course.course_id"
                    class="hover:bg-base-200/30 transition-colors"
                  >
                    <td class="font-mono text-sm text-base-content/70 pl-6">{{ course.course_code }}</td>
                    <td class="font-medium text-base-content">{{ course.course_name }}</td>
                    <td class="text-right font-mono text-base-content/80">{{ course.credit_hour }}</td>
                    <td class="text-center pr-6">
                      <span
                        class="badge badge-sm font-medium shadow-sm border border-base-200/50 whitespace-nowrap"
                        :class="getCourseStatusClass(course.status, course.course_id, sem.semester)"
                      >
                        {{ getCourseDisplayStatus(course.status, course.course_id, sem.semester) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-base-200/30 border-t border-base-200">
                  <tr class="font-bold text-base-content">
                    <td colspan="3" class="text-right uppercase tracking-wide text-xs">Total Credits:</td>
                    <td class="text-center font-mono text-lg pr-6">{{ sem.total_credits }}</td>
                  </tr>
                </tfoot>
              </table>

              <!-- Upload / Revoke actions -->
              <div
                class="px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-t border-base-200"
                @click.stop
              >
                <div class="text-sm text-base-content/70 flex items-center gap-2">
                  <template v-if="sem.result_slip">
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
                    Slip uploaded: <span class="font-mono text-xs">{{ sem.result_slip.result_slip_filename }}</span>
                  </template>
                  <template v-else>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 opacity-50"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    No result slip uploaded
                  </template>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-ghost btn-sm text-primary"
                    @click.stop="exportSemesterToExcel(sem)"
                    :disabled="exportToExcelLoading === sem.semester"
                  >
                    <span v-if="exportToExcelLoading === sem.semester" class="loading loading-spinner w-3 h-3"></span>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Export to Excel
                  </button>
                  <button
                    v-if="sem.has_result"
                    class="btn btn-error btn-outline btn-sm"
                    @click="openRevokeConfirm(sem)"
                  >
                    Revoke Result
                  </button>
                  <button
                    v-if="!sem.has_result"
                    class="btn btn-primary btn-sm"
                    @click="openUploadModal(sem)"
                  >
                    Upload Result
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state if no scheduled semesters -->
        <div
          v-if="scheduledSemesters.length === 0"
          class="text-center py-8 text-base-content/60 border border-dashed border-base-300 rounded-lg"
        >
          <p>No scheduled semesters yet. Your schedule is being prepared.</p>
        </div>
        </div>
        </div>
      </div>
    </template>
  </div>

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
              <li>Require re-approval from the Head of Program</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="closeReScheduleModal">Cancel</button>
        <button
          class="btn btn-warning"
          :disabled="reScheduleLoading"
          @click="reSchedule"
        >
          <span
            v-if="reScheduleLoading"
            class="loading loading-spinner loading-sm"
          ></span>
          {{ reScheduleLoading ? "Processing..." : "Yes, Re-schedule" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="closeReScheduleModal">
      <button>close</button>
    </form>
  </dialog>

  <!-- Upload Result Modal -->
  <dialog class="modal" :class="{ 'modal-open': showUploadModal }">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">
        Upload Result Slip —
        {{ selectedSemester ? formatSemester(selectedSemester.semester) : "" }}
      </h3>

      <!-- Error alert -->
      <div v-if="uploadError" class="alert alert-error mb-4">
        <span>{{ uploadError }}</span>
      </div>

      <!-- Success alert -->
      <div v-if="uploadSuccess" class="alert alert-success mb-4">
        <span>Results submitted successfully!</span>
      </div>

      <div class="form-control mb-4">
        <label class="label"
          ><span class="label-text font-medium">Result Slip (PDF)</span></label
        >
        <input
          ref="fileInputRef"
          type="file"
          accept=".pdf"
          class="file-input file-input-bordered w-full"
          @change="onFileChange"
        />
      </div>

      <!-- Parsing indicator -->
      <div v-if="parsing" class="flex items-center gap-2 mb-4 text-info">
        <span class="loading loading-spinner loading-sm"></span>
        Parsing result slip…
      </div>

      <!-- Parse message -->
      <div
        v-if="parseMessage && !parsing"
        class="alert mb-4"
        :class="{
          'alert-success': parseMessageType === 'success',
          'alert-warning': parseMessageType === 'warning',
          'alert-info': parseMessageType === 'info',
        }"
      >
        <span>{{ parseMessage }}</span>
      </div>

      <!-- Unmatched courses -->
      <div
        v-if="unmatchedCourses.length"
        class="text-xs text-base-content/50 mb-3"
      >
        Unmatched from slip: {{ unmatchedCourses.join(", ") }}
      </div>

      <!-- Detected results table -->
      <div
        v-if="hasAnyParsedResult && selectedSemester"
        class="overflow-x-auto mb-4"
      >
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Code</th>
              <th>Course Name</th>
              <th class="text-center">Credits</th>
              <th class="text-center">Grade</th>
              <th class="text-center">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="course in selectedSemester.courses"
              :key="course.course_id"
            >
              <td class="font-mono">{{ course.course_code }}</td>
              <td>{{ course.course_name }}</td>
              <td class="text-center">{{ course.credit_hour }}</td>
              <td class="text-center font-mono font-bold">
                {{ courseGrades[course.course_id] || "-" }}
              </td>
              <td class="text-center">
                <span
                  v-if="courseResults[course.course_id]"
                  class="badge badge-sm"
                  :class="
                    courseResults[course.course_id] === 'Passed'
                      ? 'badge-success'
                      : 'badge-error'
                  "
                >
                  {{ courseResults[course.course_id] }}
                </span>
                <span v-else class="text-base-content/30">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="modal-action">
        <button class="btn" @click="closeUploadModal">Cancel</button>
        <button
          class="btn btn-primary"
          :disabled="!canSubmit"
          @click="submitResults"
        >
          <span
            v-if="uploading"
            class="loading loading-spinner loading-sm"
          ></span>
          Submit Results
        </button>
      </div>
    </div>
    <div class="modal-backdrop" @click="closeUploadModal"></div>
  </dialog>

  <!-- Revoke Confirmation Modal -->
  <dialog class="modal" :class="{ 'modal-open': showRevokeConfirm }">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-2">Revoke Result</h3>
      <p class="mb-4">
        Are you sure you want to revoke the result for
        <strong>{{
          revokeSemester ? formatSemester(revokeSemester.semester) : ""
        }}</strong
        >? All course statuses will be reset to
        <span class="badge badge-ghost badge-sm">Planned</span>.
      </p>
      <div class="modal-action">
        <button class="btn" @click="closeRevokeConfirm">Cancel</button>
        <button
          class="btn btn-error"
          :disabled="revoking"
          @click="revokeResult"
        >
          <span
            v-if="revoking"
            class="loading loading-spinner loading-sm"
          ></span>
          Revoke
        </button>
      </div>
    </div>
    <div class="modal-backdrop" @click="closeRevokeConfirm"></div>
  </dialog>
</template>
