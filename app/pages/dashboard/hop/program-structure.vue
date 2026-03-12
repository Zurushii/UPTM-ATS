<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

type ProgramSessionRow = {
  id: number;
  session_name: string;
  intake_year: string;
  is_active?: number | boolean;
  created_at?: string;
  course_count: number;
  total_credits: number;
};

type CourseRow = {
  id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
};

type ProgramStructureCourse = {
  id: number;
  semester: number;
  course_type: string;
  course_group: string | null;
  prerequisite_course_id: number | null;
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  prerequisite_code: string | null;
  prerequisite_name: string | null;
};

type ProgramStructureSemester = {
  semester: number;
  courses: ProgramStructureCourse[];
  totalCredits: number;
  courseCount: number;
};

type ProgramStructureResponse = {
  program: {
    id: number;
    program_code: string;
    program_name: string;
    total_credit_required: number;
    duration_semesters: number;
  };
  session: {
    id: number;
    session_name: string;
    intake_year: string;
  };
  semesters: ProgramStructureSemester[];
  totalCourses: number;
  totalCredits: number;
};

definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

// Toast state
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
  }, 3000);
};

// Fetch program sessions
const {
  data: sessions,
  pending: sessionsPending,
  refresh: refreshSessions,
} = await useFetch<ProgramSessionRow[]>("/api/hop/sessions");

// Currently selected session
const selectedSessionId = ref<number | null>(sessions.value?.[0]?.id ?? null);

// Keep a valid selection when sessions list changes
watch(
  sessions,
  (newSessions) => {
    if (!newSessions?.length) {
      selectedSessionId.value = null;
      return;
    }

    const stillExists = newSessions.some(
      (s) => s.id === selectedSessionId.value,
    );
    if (!selectedSessionId.value || !stillExists) {
      selectedSessionId.value = newSessions.at(0)!.id;
    }
  },
  { immediate: true },
);

const {
  data: structureData,
  pending: structurePending,
  refresh: refreshStructure,
} = await useFetch<ProgramStructureResponse | null>(
  () =>
    `/api/hop/program-structure?session_id=${selectedSessionId.value as number}`,
  {
    immediate: selectedSessionId.value !== null,
    default: () => null,
  },
);

watch(
  selectedSessionId,
  async (newId) => {
    if (newId === null) {
      structureData.value = null;
      return;
    }
    await refreshStructure();
  },
  { immediate: false },
);

// Fetch available courses for the dropdown
const { data: allCourses, refresh: refreshCourses } =
  await useFetch<CourseRow[]>("/api/hop/courses");

// Modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const showCreateCourseModal = ref(false);
const showCreateSessionModal = ref(false);
const showCloneSessionModal = ref(false);
const showImportModal = ref(false);
const showDeleteSessionModal = ref(false);
const deletingSession = ref<ProgramSessionRow | null>(null);
const reopenAddAfterCreate = ref(false);

// Form state for adding course
const newCourse = ref({
  course_id: "",
  semester: 1,
  course_type: "Core Computing",
  course_group: "",
  prerequisite_course_id: "",
});

// Form state for editing course
const editingCourse = ref<any>(null);
const editForm = ref({
  course_code: "",
  semester: 1,
  course_type: "Core Computing",
  course_group: "",
  prerequisite_course_id: "",
});

// Form state for creating a course
const createCourse = ref({
  course_code: "",
  course_name: "",
  credit_hour: 3,
});

// Form state for creating session
const newSession = ref({
  session_name: "",
  intake_year: "",
});

// Form state for cloning session
const cloneSession = ref({
  source_id: null as number | null,
  session_name: "",
  intake_year: "",
});

// Loading states
const addLoading = ref(false);
const editLoading = ref(false);
const deleteLoading = ref<number | null>(null);
const createCourseLoading = ref(false);
const createSessionLoading = ref(false);
const cloneSessionLoading = ref(false);
const deleteSessionLoading = ref(false);
const importLoading = ref(false);

// Import state
const importFile = ref<File | null>(null);
const importResult = ref<any>(null);

// Collapsible state
const collapsedSemesters = ref<Set<number>>(new Set());
const toggleSemester = (sem: number) => {
  if (collapsedSemesters.value.has(sem)) {
    collapsedSemesters.value.delete(sem);
  } else {
    collapsedSemesters.value.add(sem);
  }
};

// Expand/Collapse all semesters
const expandedAll = ref(false);

const toggleAllSemesters = () => {
  if (!structureData.value?.semesters) return;

  if (expandedAll.value) {
    // Collapse all
    structureData.value.semesters.forEach((s) =>
      collapsedSemesters.value.add(s.semester),
    );
  } else {
    // Expand all
    collapsedSemesters.value.clear();
  }
  expandedAll.value = !expandedAll.value;
};

// Get courses not yet in the program structure
const availableCourses = computed(() => {
  if (!allCourses.value || !structureData.value) return [];

  const existingCourseIds = new Set(
    structureData.value.semesters.flatMap((s) =>
      s.courses.map((c) => c.course_id),
    ),
  );

  return (allCourses.value as any[]).filter(
    (c) => !existingCourseIds.has(c.id),
  );
});

// Get courses that can be prerequisites (earlier semesters)
const getPrerequisiteOptions = (targetSemester: number) => {
  if (!structureData.value) return [];

  return structureData.value.semesters
    .filter((s) => s.semester < targetSemester)
    .flatMap((s) => s.courses);
};

const getEditPrerequisiteOptions = (targetSemester: number) => {
  const currentCourseId = editingCourse.value?.course_id;
  return getPrerequisiteOptions(targetSemester).filter(
    (course) => course.course_id !== currentCourseId,
  );
};

// Generate semester options based on program duration
const semesterOptions = computed(() => {
  if (!structureData.value?.program) return [];
  const duration = structureData.value.program.duration_semesters || 8;
  return Array.from({ length: duration }, (_, i) => i + 1);
});

// Format semester number as "Semester X / Year Y"
const formatSemester = (
  semester: number,
  semestersPerYear: number = 3,
): string => {
  const year = Math.ceil(semester / semestersPerYear);
  const semInYear = ((semester - 1) % semestersPerYear) + 1;
  return `Semester ${semInYear} / Year ${year}`;
};

// Get selected session details
const selectedSession = computed(() =>
  sessions.value?.find((s: any) => s.id === selectedSessionId.value),
);

// Credit validation
const creditsExceeded = computed(() => {
  if (!structureData.value?.program) return false;
  return (
    structureData.value.totalCredits >
    structureData.value.program.total_credit_required
  );
});

const creditsDifference = computed(() => {
  if (!structureData.value?.program) return 0;
  return (
    structureData.value.totalCredits -
    structureData.value.program.total_credit_required
  );
});

const creditStatus = computed<"matched" | "exceeded" | "under">(() => {
  if (!structureData.value?.program) return "under";
  if (
    structureData.value.totalCredits ===
    structureData.value.program.total_credit_required
  )
    return "matched";
  if (
    structureData.value.totalCredits >
    structureData.value.program.total_credit_required
  )
    return "exceeded";
  return "under";
});

// Projected credits when adding a new course
const selectedCourseCredits = computed(() => {
  if (!newCourse.value.course_id || !allCourses.value) return 0;
  const course = (allCourses.value as any[]).find(
    (c) => c.id === Number(newCourse.value.course_id),
  );
  return course?.credit_hour ?? 0;
});

const projectedCredits = computed(() => {
  return (structureData.value?.totalCredits ?? 0) + selectedCourseCredits.value;
});

const willExceedCredits = computed(() => {
  if (!structureData.value?.program) return false;
  return (
    projectedCredits.value > structureData.value.program.total_credit_required
  );
});

// Course type options
const courseTypeOptions = [
  "Core Computing",
  "Free Elective",
  "Compulsory",
  "Specialization",
  "Discipline Core",
  "Final Year Project",
  "Industrial Training",
];

// Create session handler
async function handleCreateSession() {
  if (!newSession.value.session_name || !newSession.value.intake_year) return;

  createSessionLoading.value = true;
  try {
    const result = await $fetch<any>("/api/hop/sessions", {
      method: "POST",
      body: newSession.value,
    });

    await refreshSessions();
    selectedSessionId.value = result.id;
    showCreateSessionModal.value = false;
    newSession.value = { session_name: "", intake_year: "" };
  } catch (error: any) {
    showToast(
      error?.data?.statusMessage || "Failed to create session",
      "error",
    );
  } finally {
    createSessionLoading.value = false;
  }
}

// Clone session handler
async function handleCloneSession() {
  if (
    !cloneSession.value.source_id ||
    !cloneSession.value.session_name ||
    !cloneSession.value.intake_year
  )
    return;

  cloneSessionLoading.value = true;
  try {
    const result = await $fetch<any>(
      `/api/hop/sessions/${cloneSession.value.source_id}/clone`,
      {
        method: "POST",
        body: {
          session_name: cloneSession.value.session_name,
          intake_year: cloneSession.value.intake_year,
        },
      },
    );

    await refreshSessions();
    selectedSessionId.value = result.id;
    showCloneSessionModal.value = false;
    cloneSession.value = { source_id: null, session_name: "", intake_year: "" };
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to clone session", "error");
  } finally {
    cloneSessionLoading.value = false;
  }
}

// Delete session modal handlers
function openDeleteSessionModal(sessionId: number) {
  const sessionToDelete = sessions.value?.find((s: any) => s.id === sessionId);
  if (sessionToDelete) {
    deletingSession.value = sessionToDelete;
    showDeleteSessionModal.value = true;
  }
}

function closeDeleteSessionModal() {
  showDeleteSessionModal.value = false;
  deletingSession.value = null;
}

async function confirmDeleteSession() {
  if (!deletingSession.value) return;

  deleteSessionLoading.value = true;
  try {
    await $fetch(`/api/hop/sessions/${deletingSession.value.id}`, {
      method: "DELETE",
    });
    await refreshSessions();
    if (selectedSessionId.value === deletingSession.value.id) {
      selectedSessionId.value = sessions.value?.[0]?.id || null;
    }
    closeDeleteSessionModal();
  } catch (error: any) {
    showToast(
      error?.data?.statusMessage || "Failed to delete session",
      "error",
    );
  } finally {
    deleteSessionLoading.value = false;
  }
}

// Add course handler
async function handleAddCourse() {
  if (
    !newCourse.value.course_id ||
    !newCourse.value.semester ||
    !selectedSessionId.value
  )
    return;

  addLoading.value = true;
  try {
    await $fetch("/api/hop/program-structure", {
      method: "POST",
      body: {
        session_id: selectedSessionId.value,
        course_id: parseInt(newCourse.value.course_id),
        semester: newCourse.value.semester,
        course_type: newCourse.value.course_type,
        course_group: newCourse.value.course_group || null,
        prerequisite_course_id: newCourse.value.prerequisite_course_id
          ? parseInt(newCourse.value.prerequisite_course_id)
          : null,
      },
    });

    showAddModal.value = false;
    newCourse.value = {
      course_id: "",
      semester: 1,
      course_type: "Core Computing",
      course_group: "",
      prerequisite_course_id: "",
    };
    await refreshStructure();
    await refreshCourses();
    await refreshSessions();
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to add course", "error");
  } finally {
    addLoading.value = false;
  }
}

async function handleCreateCourse() {
  if (!createCourse.value.course_code || !createCourse.value.course_name)
    return;

  createCourseLoading.value = true;
  try {
    const result = await $fetch<any>("/api/hop/courses", {
      method: "POST",
      body: {
        course_code: createCourse.value.course_code,
        course_name: createCourse.value.course_name,
        credit_hour: Number(createCourse.value.credit_hour),
      },
    });

    await refreshCourses();

    // Preselect newly created course in add flow
    if (result?.id) {
      newCourse.value.course_id = String(result.id);
    }

    showCreateCourseModal.value = false;
    createCourse.value = { course_code: "", course_name: "", credit_hour: 3 };

    if (reopenAddAfterCreate.value) {
      reopenAddAfterCreate.value = false;
      showAddModal.value = true;
    }
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to create course", "error");
  } finally {
    createCourseLoading.value = false;
  }
}

// Open edit modal
function openEditModal(course: any) {
  editingCourse.value = course;
  editForm.value = {
    course_code: course.course_code || "",
    semester: course.semester,
    course_type: course.course_type || "Core Computing",
    course_group: course.course_group || "",
    prerequisite_course_id: course.prerequisite_course_id?.toString() || "",
  };
  showEditModal.value = true;
}

// Update course handler
async function handleUpdateCourse() {
  if (!editingCourse.value) return;

  editLoading.value = true;
  try {
    await $fetch(`/api/hop/program-structure/${editingCourse.value.id}`, {
      method: "PUT",
      body: {
        course_code: editForm.value.course_code,
        semester: editForm.value.semester,
        course_type: editForm.value.course_type,
        course_group: editForm.value.course_group || null,
        prerequisite_course_id: editForm.value.prerequisite_course_id
          ? parseInt(editForm.value.prerequisite_course_id)
          : null,
      },
    });

    showEditModal.value = false;
    editingCourse.value = null;
    await refreshStructure();
    await refreshCourses();
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to update course", "error");
  } finally {
    editLoading.value = false;
  }
}

// Delete course handler
async function handleDeleteCourse(courseId: number) {
  if (
    !confirm(
      "Are you sure you want to remove this course from the session structure?",
    )
  ) {
    return;
  }

  deleteLoading.value = courseId;
  try {
    await $fetch(`/api/hop/program-structure/${courseId}`, {
      method: "DELETE",
    });
    await refreshStructure();
    await refreshSessions();
  } catch (error: any) {
    showToast(error?.data?.statusMessage || "Failed to delete course", "error");
  } finally {
    deleteLoading.value = null;
  }
}

// Open clone modal with pre-filled source
function openCloneModal(sourceSession: any) {
  cloneSession.value = {
    source_id: sourceSession.id,
    session_name: "",
    intake_year: "",
  };
  showCloneSessionModal.value = true;
}

// Open import modal
function openImportModal() {
  importFile.value = null;
  importResult.value = null;
  showImportModal.value = true;
}

// Handle file selection for import
function handleImportFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  importFile.value = target.files?.[0] ?? null;
}

// Handle import
async function handleImport() {
  if (!importFile.value || !selectedSessionId.value) return;

  importLoading.value = true;
  importResult.value = null;

  try {
    const formData = new FormData();
    formData.append("file", importFile.value);
    formData.append("session_id", selectedSessionId.value.toString());

    const result = await $fetch<any>("/api/hop/program-structure/import", {
      method: "POST",
      body: formData,
    });

    importResult.value = result;

    // Refresh data
    await refreshStructure();
    await refreshCourses();
    await refreshSessions();
  } catch (error: any) {
    importResult.value = {
      success: false,
      error: error?.data?.statusMessage || "Failed to import structure",
    };
  } finally {
    importLoading.value = false;
  }
}
</script>

<template>
  <div class="p-6 w-full space-y-8">
    <!-- Toast Notification -->
    <div v-if="toast.show" class="toast toast-top toast-end z-50">
      <div
        class="alert shadow-lg"
        :class="{
          'alert-info': toast.type === 'info',
          'alert-success': toast.type === 'success',
          'alert-warning': toast.type === 'warning',
          'alert-error': toast.type === 'error',
        }"
      >
        <span>{{ toast.message }}</span>
      </div>
    </div>

    <!-- Page Header -->
    <div
      class="flex flex-col md:flex-row md:items-center justify-between gap-4"
    >
      <div class="space-y-1">
        <h1 class="text-3xl font-bold">Program Structure</h1>
        <p class="text-base text-base-content/70">
          Manage course arrangements per session.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-outline btn-sm gap-2"
          @click="showCreateSessionModal = true"
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
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          New Session
        </button>
        <button
          v-if="selectedSessionId"
          class="btn btn-primary btn-sm shadow-lg shadow-primary/20 gap-2"
          @click="showAddModal = true"
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
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Add Course
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div v-if="sessionsPending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <div v-else-if="sessions?.length" class="space-y-6">
      <!-- Session Tabs -->
      <div
        class="flex flex-wrap items-center gap-4 border-b border-base-200 pb-2"
      >
        <div class="tabs tabs-boxed bg-base-100/50 p-1 gap-1">
          <a
            v-for="sess in sessions"
            :key="sess.id"
            class="tab transition-all duration-300"
            :class="
              selectedSessionId === sess.id
                ? 'tab-active shadow-sm'
                : 'hover:bg-base-200/50'
            "
            @click="selectedSessionId = sess.id"
          >
            {{ sess.session_name }}
          </a>
        </div>

        <!-- Session Config Dropdown -->
        <div v-if="selectedSession" class="dropdown dropdown-end ml-auto">
          <label tabindex="0" class="btn btn-ghost btn-sm btn-square">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-5 h-5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.43.816 1.035.79 1.735a2.332 2.332 0 0 1-.199 1.376c-.14.288-.236.6-.282.923"
              />
            </svg>
          </label>
          <ul
            tabindex="0"
            class="dropdown-content z-[20] menu p-2 shadow-lg bg-base-100 rounded-box w-52 border border-base-200"
          >
            <li>
              <a @click="openCloneModal(selectedSession)">📋 Clone Session</a>
            </li>
            <li>
              <a
                class="text-error"
                @click="openDeleteSessionModal(selectedSession.id)"
                >🗑️ Delete Session</a
              >
            </li>
          </ul>
        </div>
      </div>

      <!-- Program Summary Card -->
      <div
        v-if="structureData?.program"
        class="card bg-base-100/60 backdrop-blur shadow-xl border border-white/20 relative overflow-hidden"
      >
        <div
          class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none"
        ></div>
        <div class="card-body p-6 relative z-10">
          <div class="flex flex-col md:flex-row justify-between gap-6">
            <!-- Program Info -->
            <div>
              <div
                class="text-xs uppercase font-bold text-base-content/50 mb-1"
              >
                Program
              </div>
              <div class="font-bold text-lg leading-tight">
                {{ structureData.program.program_code }}
              </div>
              <div class="text-sm opacity-70">
                {{ structureData.program.program_name }}
              </div>
            </div>
            <!-- Intake Info -->
            <div>
              <div
                class="text-xs uppercase font-bold text-base-content/50 mb-1"
              >
                Intake
              </div>
              <div class="font-bold text-lg">
                {{ structureData.session?.intake_year }}
              </div>
              <div class="text-sm opacity-70">
                {{ structureData.session?.session_name }}
              </div>
            </div>
            <!-- Stats -->
            <div>
              <div
                class="text-xs uppercase font-bold text-base-content/50 mb-1"
              >
                Structure
              </div>
              <div class="flex items-baseline gap-1">
                <span class="font-bold text-2xl font-mono">{{
                  structureData.totalCourses
                }}</span>
                <span class="text-xs">Courses</span>
              </div>
              <div class="text-sm opacity-70">
                {{ structureData.program.duration_semesters }} Semesters
              </div>
            </div>
            <!-- Credit Validation -->
            <div>
              <div
                class="text-xs uppercase font-bold text-base-content/50 mb-1"
              >
                Total Credits
              </div>
              <div class="flex items-baseline gap-1">
                <span
                  class="font-bold text-2xl font-mono"
                  :class="{
                    'text-success': creditStatus === 'matched',
                    'text-error': creditStatus === 'exceeded',
                    'text-warning': creditStatus === 'under',
                  }"
                >
                  {{ structureData.totalCredits }}
                </span>
                <span class="text-sm text-base-content/50"
                  >/ {{ structureData.program.total_credit_required }}</span
                >
              </div>
              <div
                class="text-xs"
                :class="{
                  'text-success': creditStatus === 'matched',
                  'text-error': creditStatus === 'exceeded',
                  'text-warning': creditStatus === 'under',
                }"
              >
                {{
                  creditStatus === "matched"
                    ? "Requirement Met"
                    : creditStatus === "exceeded"
                      ? `Exceeded by ${creditsDifference} credits`
                      : "Check Requirements"
                }}
              </div>
            </div>
            <!-- Actions -->
            <div class="flex items-center justify-end gap-2">
              <button
                v-if="selectedSessionId"
                class="btn btn-ghost btn-sm gap-2 text-base-content/70 hover:text-primary"
                @click="openImportModal"
                title="Import Structure"
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
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                  />
                </svg>
                <span class="hidden xl:inline">Import</span>
              </button>
              <button
                class="btn btn-ghost btn-sm gap-2"
                @click="toggleAllSemesters"
              >
                <svg
                  v-if="!expandedAll"
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
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                  />
                </svg>
                <svg
                  v-else
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
                    d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-9.051 5.25 5.25"
                  />
                </svg>
                {{ expandedAll ? "Collapse All" : "Expand All" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Credits Exceeded Alert -->
      <div v-if="creditsExceeded" class="alert alert-error mt-4 shadow-sm">
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
        <div class="text-sm">
          <span class="font-bold">Credits exceeded!</span>
          The total credits ({{ structureData?.totalCredits }}) exceed the
          program requirement ({{
            structureData?.program.total_credit_required
          }}) by <strong>{{ creditsDifference }}</strong> credit(s). Please
          remove some courses to meet the requirement.
        </div>
      </div>

      <!-- Structure List -->
      <div v-if="structurePending" class="flex justify-center py-20">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <div v-else-if="structureData?.semesters?.length" class="space-y-4">
        <div
          v-for="sem in structureData.semesters"
          :key="sem.semester"
          class="collapse collapse-arrow bg-base-100 border border-base-200 shadow-sm"
          :class="collapsedSemesters.has(sem.semester) ? '' : 'collapse-open'"
        >
          <input
            type="checkbox"
            :checked="!collapsedSemesters.has(sem.semester)"
            @change="toggleSemester(sem.semester)"
          />
          <div
            class="collapse-title text-lg font-medium flex items-center gap-4 pr-12 py-3 min-h-0"
          >
            <span class="font-bold">{{ formatSemester(sem.semester) }}</span>
            <div
              class="flex items-center gap-2 text-sm font-normal text-base-content/60"
            >
              <span class="badge badge-sm badge-ghost"
                >{{ sem.totalCredits }} Credits</span
              >
              <span>{{ sem.courseCount }} Courses</span>
            </div>
          </div>
          <div class="collapse-content !pt-0">
            <div class="overflow-x-auto rounded-lg border border-base-200">
              <table class="table table-sm w-full table-zebra table-fixed">
                <thead class="bg-base-200/50 text-base-content">
                  <tr class="text-xs uppercase">
                    <th class="w-[5%]">No.</th>
                    <th class="w-[15%]">Course Code</th>
                    <th class="w-[30%]">Course Name</th>
                    <th class="text-center w-[10%]">Credit</th>
                    <th class="w-[20%]">Status</th>
                    <th class="w-[10%]">Pre-Req</th>
                    <th class="text-right w-[10%]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(course, index) in sem.courses"
                    :key="course.id"
                    class="hover:bg-base-100/50 transition-colors"
                    :class="{
                      'opacity-60':
                        course.course_group &&
                        sem.courses.findIndex(
                          (c) => c.course_group === course.course_group,
                        ) !== index,
                    }"
                  >
                    <td class="font-medium opacity-50">{{ index + 1 }}</td>
                    <td>
                      <div class="flex flex-col items-start gap-1">
                        <span class="font-mono text-sm font-bold">{{
                          course.course_code
                        }}</span>
                        <span
                          v-if="course.course_group"
                          class="badge badge-xs badge-ghost border-base-content/20 whitespace-nowrap"
                          :title="'Group: ' + course.course_group"
                        >
                          {{ course.course_group }}
                        </span>
                      </div>
                    </td>
                    <td>{{ course.course_name }}</td>
                    <td class="text-center">
                      <template
                        v-if="
                          course.course_group &&
                          sem.courses.findIndex(
                            (c) => c.course_group === course.course_group,
                          ) !== index
                        "
                      >
                        <span
                          class="text-base-content/40"
                          title="Credits counted once per group"
                          >—</span
                        >
                      </template>
                      <template v-else>
                        {{ course.credit_hour }}
                      </template>
                    </td>
                    <td>
                      <span
                        class="badge badge-sm border-none whitespace-nowrap px-3 h-auto py-1"
                        :class="{
                          'text-primary bg-primary/10':
                            course.course_type === 'Core Computing',
                          'text-secondary bg-secondary/10':
                            course.course_type === 'Specialization',
                          'text-accent bg-accent/10':
                            course.course_type === 'Discipline Core',
                          'text-info bg-info/10':
                            course.course_type === 'Compulsory',
                          'text-success bg-success/10':
                            course.course_type === 'Free Elective',
                          'text-warning bg-warning/10':
                            course.course_type === 'Final Year Project',
                          'text-error bg-error/10':
                            course.course_type === 'Industrial Training',
                        }"
                      >
                        {{ course.course_type }}
                      </span>
                    </td>
                    <td>
                      <span
                        v-if="course.prerequisite_code"
                        class="badge badge-sm badge-ghost font-mono"
                      >
                        {{ course.prerequisite_code }}
                      </span>
                      <span v-else class="text-base-content/20 text-xs">-</span>
                    </td>
                    <td class="text-right">
                      <div class="flex gap-1 justify-end">
                        <button
                          class="btn btn-ghost btn-xs"
                          @click="openEditModal(course)"
                          title="Edit Course"
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
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                        </button>
                        <button
                          class="btn btn-ghost btn-xs text-error"
                          @click="handleDeleteCourse(course.id)"
                          title="Remove Course"
                        >
                          <span
                            v-if="deleteLoading === course.id"
                            class="loading loading-spinner loading-xs"
                          ></span>
                          <svg
                            v-else
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
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state for selected session -->
      <div
        v-else-if="selectedSessionId && !structurePending"
        class="card bg-base-100/60 backdrop-blur border-dashed border-2 border-base-300 p-12 text-center"
      >
        <div class="max-w-md mx-auto space-y-4">
          <div
            class="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-8 h-8"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <h3 class="font-bold text-lg">No courses in this session yet</h3>
          <p class="text-base-content/60">
            Start building your program structure by adding courses to each
            semester.
          </p>
          <div class="flex flex-wrap gap-2 justify-center pt-2">
            <button class="btn btn-primary btn-sm" @click="showAddModal = true">
              + Add First Course
            </button>
            <button class="btn btn-outline btn-sm" @click="openImportModal">
              Import from Excel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- No sessions state -->
    <div
      v-else-if="!sessionsPending"
      class="card bg-base-100/60 backdrop-blur border-dashed border-2 border-base-300 p-12 text-center"
    >
      <div class="max-w-md mx-auto space-y-4">
        <div
          class="w-16 h-16 bg-base-200 text-base-content/60 rounded-2xl flex items-center justify-center mx-auto mb-4"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-8 h-8"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"
            />
          </svg>
        </div>
        <h3 class="font-bold text-lg">No sessions created yet</h3>
        <p class="text-base-content/60">
          Create a session (intake) to start defining your program structure.
        </p>
        <button
          class="btn btn-primary btn-sm"
          @click="showCreateSessionModal = true"
        >
          + Create First Session
        </button>
      </div>
    </div>

    <!-- Create Session Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showCreateSessionModal }"
    >
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-primary text-primary-content">
          <h3 class="font-bold text-lg">Create New Session</h3>
          <p class="text-primary-content/70 text-sm">
            Define a new intake session.
          </p>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleCreateSession" class="space-y-4">
            <div class="form-control hover:bg-transparent">
              <label class="label">
                <span class="label-text">Session Name</span>
              </label>
              <input
                v-model="newSession.session_name"
                type="text"
                placeholder="e.g., August 2024 Intake"
                class="input input-bordered w-full"
                required
              />
            </div>

            <div class="form-control hover:bg-transparent">
              <label class="label">
                <span class="label-text">Intake Year (MMYY)</span>
              </label>
              <input
                v-model="newSession.intake_year"
                type="text"
                placeholder="e.g., 0824"
                maxlength="4"
                class="input input-bordered w-full"
                required
              />
              <label class="label">
                <span class="label-text-alt text-base-content/60"
                  >Format: MMYY (e.g., 0824 = August 2024)</span
                >
              </label>
            </div>

            <div class="modal-action">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showCreateSessionModal = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="createSessionLoading"
              >
                <span
                  v-if="createSessionLoading"
                  class="loading loading-spinner loading-sm"
                ></span>
                Create Session
              </button>
            </div>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showCreateSessionModal = false">close</button>
      </form>
    </dialog>

    <!-- Clone Session Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showCloneSessionModal }"
    >
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-base-200 border-b border-base-300">
          <h3 class="font-bold text-lg">Clone Session</h3>
          <p class="text-base-content/60 text-sm">
            Copy structure from an existing session.
          </p>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleCloneSession" class="space-y-4">
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Source Session</span></label
              >
              <select
                v-model="cloneSession.source_id"
                class="select select-bordered w-full"
                required
              >
                <option :value="null" disabled>Select source session</option>
                <option
                  v-for="sess in sessions"
                  :key="sess.id"
                  :value="sess.id"
                >
                  {{ sess.session_name }} ({{ sess.course_count }} courses)
                </option>
              </select>
            </div>

            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">New Session Name</span></label
              >
              <input
                v-model="cloneSession.session_name"
                type="text"
                placeholder="e.g., January 2025 Intake"
                class="input input-bordered w-full"
                required
              />
            </div>

            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Intake Year (MMYY)</span></label
              >
              <input
                v-model="cloneSession.intake_year"
                type="text"
                placeholder="e.g., 0125"
                maxlength="4"
                class="input input-bordered w-full"
                required
              />
            </div>

            <div class="modal-action">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showCloneSessionModal = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="cloneSessionLoading"
              >
                <span
                  v-if="cloneSessionLoading"
                  class="loading loading-spinner loading-sm"
                ></span>
                Clone Session
              </button>
            </div>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showCloneSessionModal = false">close</button>
      </form>
    </dialog>

    <!-- Add Course Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showAddModal }"
    >
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-primary text-primary-content">
          <h3 class="font-bold text-lg">Add Course</h3>
          <p class="text-primary-content/70 text-sm">
            Add a subject to the program structure.
          </p>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleAddCourse" class="space-y-4">
            <!-- Course -->
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Select Course</span></label
              >
              <select
                v-model="newCourse.course_id"
                class="select select-bordered w-full"
                required
              >
                <option value="" disabled>Select a course</option>
                <option
                  v-for="course in availableCourses"
                  :key="course.id"
                  :value="course.id"
                >
                  {{ course.course_code }} - {{ course.course_name }} ({{
                    course.credit_hour
                  }}
                  cr)
                </option>
              </select>
              <div class="label pt-1" v-if="availableCourses.length === 0">
                <span class="label-text-alt text-warning"
                  >No available courses found.</span
                >
                <button
                  type="button"
                  class="link link-primary link-hover text-xs"
                  @click="
                    reopenAddAfterCreate = true;
                    showAddModal = false;
                    showCreateCourseModal = true;
                  "
                >
                  + Create New Course
                </button>
              </div>
            </div>

            <!-- Semester & Type -->
            <div class="grid grid-cols-2 gap-4">
              <div class="form-control hover:bg-transparent">
                <label class="label"
                  ><span class="label-text">Semester</span></label
                >
                <select
                  v-model="newCourse.semester"
                  class="select select-bordered w-full"
                  required
                >
                  <option
                    v-for="sem in semesterOptions"
                    :key="sem"
                    :value="sem"
                  >
                    {{ formatSemester(sem) }}
                  </option>
                </select>
              </div>
              <div class="form-control hover:bg-transparent">
                <label class="label"
                  ><span class="label-text">Type</span></label
                >
                <select
                  v-model="newCourse.course_type"
                  class="select select-bordered w-full"
                  required
                >
                  <option
                    v-for="type in courseTypeOptions"
                    :key="type"
                    :value="type"
                  >
                    {{ type }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Course Group -->
            <div class="form-control hover:bg-transparent">
              <label class="label">
                <span class="label-text">Course Group (Optional)</span>
                <div
                  class="tooltip tooltip-left"
                  data-tip="Courses in the same group share credits (student picks ONE)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-4 h-4 text-base-content/50"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                    />
                  </svg>
                </div>
              </label>
              <input
                v-model="newCourse.course_group"
                type="text"
                placeholder="e.g., Language Elective"
                class="input input-bordered w-full"
              />
            </div>

            <!-- Prerequisite -->
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Prerequisite (Optional)</span></label
              >
              <select
                v-model="newCourse.prerequisite_course_id"
                class="select select-bordered w-full"
              >
                <option value="">None</option>
                <option
                  v-for="course in getPrerequisiteOptions(newCourse.semester)"
                  :key="course.course_id"
                  :value="course.course_id"
                >
                  {{ course.course_code }} - {{ course.course_name }}
                </option>
              </select>
            </div>

            <!-- Credit projection warning -->
            <div
              v-if="newCourse.course_id && willExceedCredits"
              class="alert alert-error text-sm py-3"
            >
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
              <div>
                <span class="font-bold"
                  >Cannot add — credits would exceed the program limit.</span
                ><br />
                Projected total: <strong>{{ projectedCredits }}</strong> /
                {{ structureData?.program.total_credit_required }} credits.
              </div>
            </div>

            <div class="modal-action">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showAddModal = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="
                  addLoading || !newCourse.course_id || willExceedCredits
                "
              >
                <span
                  v-if="addLoading"
                  class="loading loading-spinner loading-sm"
                ></span>
                Add Course
              </button>
            </div>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showAddModal = false">close</button>
      </form>
    </dialog>

    <!-- Create Course Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showCreateCourseModal }"
    >
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-base-200 border-b border-base-300">
          <h3 class="font-bold text-lg">Create New Course</h3>
          <p class="text-base-content/60 text-sm">
            Add a new course to the master course list.
          </p>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleCreateCourse" class="space-y-4">
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Course Code</span></label
              >
              <input
                v-model="createCourse.course_code"
                type="text"
                placeholder="e.g., CT204"
                class="input input-bordered w-full font-mono"
                required
              />
            </div>
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Course Name</span></label
              >
              <input
                v-model="createCourse.course_name"
                type="text"
                placeholder="e.g., Data Structures"
                class="input input-bordered w-full"
                required
              />
            </div>
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Credit Hour</span></label
              >
              <input
                v-model.number="createCourse.credit_hour"
                type="number"
                min="1"
                max="30"
                class="input input-bordered w-full"
                required
              />
            </div>
            <div class="modal-action">
              <button
                type="button"
                class="btn btn-ghost"
                @click="
                  showCreateCourseModal = false;
                  if (reopenAddAfterCreate) {
                    reopenAddAfterCreate = false;
                    showAddModal = true;
                  }
                "
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="createCourseLoading"
              >
                <span
                  v-if="createCourseLoading"
                  class="loading loading-spinner loading-sm"
                ></span>
                Create
              </button>
            </div>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button
          @click="
            showCreateCourseModal = false;
            if (reopenAddAfterCreate) {
              reopenAddAfterCreate = false;
              showAddModal = true;
            }
          "
        >
          close
        </button>
      </form>
    </dialog>

    <!-- Edit Course Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showEditModal }"
    >
      <div class="modal-box p-0 overflow-hidden">
        <div class="p-6 bg-base-200 border-b border-base-300">
          <h3 class="font-bold text-lg">Edit Course in Session</h3>
          <div v-if="editingCourse" class="flex items-center gap-2 mt-1">
            <span class="badge badge-neutral font-mono">{{
              editingCourse.course_code
            }}</span>
            <span class="text-sm font-medium">{{
              editingCourse.course_name
            }}</span>
          </div>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleUpdateCourse" class="space-y-4">
            <!-- Course Code -->
            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Course Code</span></label
              >
              <input
                v-model="editForm.course_code"
                type="text"
                class="input input-bordered w-full font-mono"
                placeholder="e.g., CT204"
                required
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="form-control hover:bg-transparent">
                <label class="label"
                  ><span class="label-text">Semester</span></label
                >
                <select
                  v-model="editForm.semester"
                  class="select select-bordered w-full"
                  required
                >
                  <option
                    v-for="sem in semesterOptions"
                    :key="sem"
                    :value="sem"
                  >
                    {{ formatSemester(sem) }}
                  </option>
                </select>
              </div>
              <div class="form-control hover:bg-transparent">
                <label class="label"
                  ><span class="label-text">Type</span></label
                >
                <select
                  v-model="editForm.course_type"
                  class="select select-bordered w-full"
                  required
                >
                  <option
                    v-for="type in courseTypeOptions"
                    :key="type"
                    :value="type"
                  >
                    {{ type }}
                  </option>
                </select>
              </div>
            </div>

            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Course Group</span></label
              >
              <input
                v-model="editForm.course_group"
                type="text"
                class="input input-bordered w-full"
              />
            </div>

            <div class="form-control hover:bg-transparent">
              <label class="label"
                ><span class="label-text">Prerequisite</span></label
              >
              <select
                v-model="editForm.prerequisite_course_id"
                class="select select-bordered w-full"
              >
                <option value="">None</option>
                <option
                  v-for="course in getEditPrerequisiteOptions(
                    editForm.semester,
                  )"
                  :key="course.course_id"
                  :value="course.course_id"
                >
                  {{ course.course_code }} - {{ course.course_name }}
                </option>
              </select>
            </div>

            <div class="modal-action">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showEditModal = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="editLoading"
              >
                <span
                  v-if="editLoading"
                  class="loading loading-spinner loading-sm"
                ></span>
                Save Changes
              </button>
            </div>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showEditModal = false">close</button>
      </form>
    </dialog>

    <!-- Import Structure Modal -->
    <dialog class="modal" :class="{ 'modal-open': showImportModal }">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-2">Import Program Structure</h3>
        <p class="text-sm text-base-content/60 mb-6">
          Upload an Excel file to bulk import courses for this session.
        </p>

        <div class="form-control w-full space-y-4">
          <div
            class="border-2 border-dashed border-base-300 rounded-xl p-8 text-center transition-colors hover:border-primary hover:bg-primary/5 cursor-pointer relative"
          >
            <input
              type="file"
              accept=".xlsx,.xls"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              @change="handleImportFileChange"
            />
            <div class="flex flex-col items-center gap-2">
              <svg
                v-if="!importFile"
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
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-10 h-10 text-success"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <div v-if="!importFile">
                <p class="font-bold">Click to upload or drag and drop</p>
                <p class="text-xs text-base-content/50">
                  Excel files only (.xlsx, .xls)
                </p>
              </div>
              <div v-else>
                <p class="font-bold text-success">{{ importFile.name }}</p>
                <p class="text-xs text-base-content/50">Ready to import</p>
              </div>
            </div>
          </div>

          <!-- Result Alert -->
          <div
            v-if="importResult"
            class="alert shadow-sm"
            :class="importResult.success ? 'alert-success' : 'alert-error'"
          >
            <svg
              v-if="importResult.success"
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div class="text-sm">
              <div class="font-bold">
                {{ importResult.success ? "Import Complete" : "Import Failed" }}
              </div>
              <div v-if="importResult.success">
                {{ importResult.summary?.courses_added }} courses added,
                {{ importResult.summary?.already_exists }} skipped.
              </div>
              <div v-else>{{ importResult.error }}</div>
            </div>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="showImportModal = false">
            {{ importResult?.success ? "Close" : "Cancel" }}
          </button>
          <button
            v-if="!importResult?.success"
            class="btn btn-primary"
            :disabled="!importFile || importLoading"
            @click="handleImport"
          >
            <span
              v-if="importLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            Import
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showImportModal = false">close</button>
      </form>
    </dialog>

    <!-- Delete Session Confirmation Modal -->
    <dialog
      class="modal modal-bottom sm:modal-middle"
      :class="{ 'modal-open': showDeleteSessionModal }"
    >
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error flex items-center gap-2">
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
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          Delete Session
        </h3>

        <div class="py-4 space-y-3">
          <p>
            Are you sure you want to delete
            <strong class="text-primary"
              >"{{ deletingSession?.session_name }}"</strong
            >?
          </p>

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
            <div>
              <p class="font-bold">This will permanently delete:</p>
              <ul class="list-disc list-inside mt-1 text-xs">
                <li>All courses in this session's structure</li>
                <li>All academic planning intakes using this session</li>
                <li>All student academic plans generated from those intakes</li>
              </ul>
            </div>
          </div>

          <p class="text-sm text-error font-medium">
            This action cannot be undone.
          </p>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeDeleteSessionModal">
            Cancel
          </button>
          <button
            class="btn btn-error"
            :disabled="deleteSessionLoading"
            @click="confirmDeleteSession"
          >
            <span
              v-if="deleteSessionLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ deleteSessionLoading ? "Deleting..." : "Yes, Delete Session" }}
          </button>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @click="closeDeleteSessionModal"
      >
        <button>close</button>
      </form>
    </dialog>

    <!-- Next Step Prompt -->
    <div class="mt-8 card bg-base-200 shadow-sm">
      <div class="card-body flex-row items-center justify-between py-4">
        <div>
          <p class="text-sm text-base-content/60">Next Step</p>
          <p class="font-semibold">Process Intake Assessment</p>
          <p class="text-sm text-base-content/70">
            Upload student data and assign starting semesters
          </p>
        </div>
        <NuxtLink
          to="/dashboard/hop/intake-assessment"
          class="btn btn-primary btn-sm"
        >
          Intake Assessment &rarr;
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
