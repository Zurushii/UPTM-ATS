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

// Fetch program sessions
const {
  data: sessions,
  pending: sessionsPending,
  refresh: refreshSessions,
} = await useFetch<any[]>("/api/hop/sessions");

// Currently selected session
const selectedSessionId = ref<number | null>(null);

// Auto-select first session when loaded
watch(
  sessions,
  (newSessions) => {
    if (newSessions?.length && !selectedSessionId.value) {
      selectedSessionId.value = newSessions[0].id;
    }
  },
  { immediate: true },
);

// Fetch program structure for selected session
const structureUrl = computed(() =>
  selectedSessionId.value
    ? `/api/hop/program-structure?session_id=${selectedSessionId.value}`
    : null,
);

const {
  data: structureData,
  pending: structurePending,
  refresh: refreshStructure,
} = await useFetch<any>(structureUrl, { watch: [selectedSessionId] });

// Fetch available courses for the dropdown
const { data: allCourses, refresh: refreshCourses } =
  await useFetch<any[]>("/api/hop/courses");

// Modal state
const showAddModal = ref(false);
const showEditModal = ref(false);
const showCreateCourseModal = ref(false);
const showCreateSessionModal = ref(false);
const showCloneSessionModal = ref(false);
const reopenAddAfterCreate = ref(false);

// Form state for adding course
const newCourse = ref({
  course_id: "",
  semester: 1,
  prerequisite_course_id: "",
});

// Form state for editing course
const editingCourse = ref<any>(null);
const editForm = ref({
  semester: 1,
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

// Get courses not yet in the program structure
const availableCourses = computed(() => {
  if (!allCourses.value || !structureData.value) return [];

  const existingCourseIds = new Set(
    structureData.value.semesters.flatMap((s: any) =>
      s.courses.map((c: any) => c.course_id),
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
    .filter((s: any) => s.semester < targetSemester)
    .flatMap((s: any) => s.courses);
};

const getEditPrerequisiteOptions = (targetSemester: number) => {
  const currentCourseId = editingCourse.value?.course_id;
  return getPrerequisiteOptions(targetSemester).filter(
    (course: any) => course.course_id !== currentCourseId,
  );
};

// Generate semester options based on program duration
const semesterOptions = computed(() => {
  if (!structureData.value?.program) return [];
  const duration = structureData.value.program.duration_semesters || 8;
  return Array.from({ length: duration }, (_, i) => i + 1);
});

// Get selected session details
const selectedSession = computed(() =>
  sessions.value?.find((s: any) => s.id === selectedSessionId.value),
);

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
    alert(error?.data?.statusMessage || "Failed to create session");
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
    alert(error?.data?.statusMessage || "Failed to clone session");
  } finally {
    cloneSessionLoading.value = false;
  }
}

// Delete session handler
async function handleDeleteSession(sessionId: number) {
  const sessionToDelete = sessions.value?.find((s: any) => s.id === sessionId);
  if (
    !confirm(
      `Are you sure you want to delete "${sessionToDelete?.session_name}"? This will also delete all courses in this session's structure.`,
    )
  ) {
    return;
  }

  deleteSessionLoading.value = true;
  try {
    await $fetch(`/api/hop/sessions/${sessionId}`, { method: "DELETE" });
    await refreshSessions();
    if (selectedSessionId.value === sessionId) {
      selectedSessionId.value = sessions.value?.[0]?.id || null;
    }
  } catch (error: any) {
    alert(error?.data?.statusMessage || "Failed to delete session");
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
        prerequisite_course_id: newCourse.value.prerequisite_course_id
          ? parseInt(newCourse.value.prerequisite_course_id)
          : null,
      },
    });

    showAddModal.value = false;
    newCourse.value = {
      course_id: "",
      semester: 1,
      prerequisite_course_id: "",
    };
    await refreshStructure();
    await refreshCourses();
    await refreshSessions();
  } catch (error: any) {
    alert(error?.data?.statusMessage || "Failed to add course");
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
    alert(error?.data?.statusMessage || "Failed to create course");
  } finally {
    createCourseLoading.value = false;
  }
}

// Open edit modal
function openEditModal(course: any) {
  editingCourse.value = course;
  editForm.value = {
    semester: course.semester,
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
        semester: editForm.value.semester,
        prerequisite_course_id: editForm.value.prerequisite_course_id
          ? parseInt(editForm.value.prerequisite_course_id)
          : null,
      },
    });

    showEditModal.value = false;
    editingCourse.value = null;
    await refreshStructure();
  } catch (error: any) {
    alert(error?.data?.statusMessage || "Failed to update course");
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
    alert(error?.data?.statusMessage || "Failed to delete course");
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
</script>

<template>
  <div class="p-6 max-w-6xl space-y-6">
    <!-- Page Header -->
    <div class="flex items-start justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Program Structure</h1>
        <p class="text-sm text-base-content/60">
          Manage program structures per session/intake. Each session can have
          different course arrangements.
        </p>
      </div>
      <div class="flex gap-2">
        <button
          class="btn btn-outline btn-sm"
          @click="showCreateSessionModal = true"
        >
          + New Session
        </button>
        <button
          v-if="selectedSessionId"
          class="btn btn-primary btn-sm"
          @click="showAddModal = true"
        >
          + Add Course
        </button>
      </div>
    </div>

    <!-- Session Tabs -->
    <div v-if="sessionsPending" class="flex justify-center py-4">
      <span class="loading loading-spinner loading-md"></span>
    </div>

    <div v-else-if="sessions?.length" class="space-y-4">
      <!-- Session selector tabs -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="tabs tabs-boxed bg-base-200">
          <button
            v-for="sess in sessions"
            :key="sess.id"
            class="tab"
            :class="{ 'tab-active': selectedSessionId === sess.id }"
            @click="selectedSessionId = sess.id"
          >
            {{ sess.session_name }}
            <span class="ml-2 badge badge-sm badge-ghost">
              {{ sess.course_count }} courses
            </span>
          </button>
        </div>

        <!-- Session actions dropdown -->
        <div v-if="selectedSession" class="dropdown dropdown-end">
          <label tabindex="0" class="btn btn-ghost btn-sm btn-square">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </label>
          <ul
            tabindex="0"
            class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
          >
            <li>
              <a @click="openCloneModal(selectedSession)"> 📋 Clone Session </a>
            </li>
            <li>
              <a
                class="text-error"
                @click="handleDeleteSession(selectedSession.id)"
              >
                🗑️ Delete Session
              </a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Program Info Card -->
      <div
        v-if="structureData?.program"
        class="card bg-base-100 border border-base-300 shadow-sm"
      >
        <div class="card-body">
          <div class="flex flex-wrap gap-6">
            <div>
              <p class="text-xs text-base-content/60 uppercase">Program</p>
              <p class="font-medium">
                {{ structureData.program.program_code }} -
                {{ structureData.program.program_name }}
              </p>
            </div>
            <div>
              <p class="text-xs text-base-content/60 uppercase">Session</p>
              <p class="font-medium">
                {{ structureData.session?.session_name }}
                <span class="text-base-content/60">
                  ({{ structureData.session?.intake_year }})
                </span>
              </p>
            </div>
            <div>
              <p class="text-xs text-base-content/60 uppercase">Duration</p>
              <p class="font-medium">
                {{ structureData.program.duration_semesters }} Semesters
              </p>
            </div>
            <div>
              <p class="text-xs text-base-content/60 uppercase">
                Courses Assigned
              </p>
              <p class="font-medium">
                {{ structureData.totalCourses }} Courses
              </p>
            </div>
            <div>
              <p class="text-xs text-base-content/60 uppercase">
                Credits Assigned
              </p>
              <p
                class="font-medium"
                :class="{
                  'text-success':
                    structureData.totalCredits ===
                    structureData.program.total_credit_required,
                  'text-warning':
                    structureData.totalCredits !==
                    structureData.program.total_credit_required,
                }"
              >
                {{ structureData.totalCredits }} /
                {{ structureData.program.total_credit_required }} Credits
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading structure -->
      <div v-if="structurePending" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- Semesters Grid -->
      <div v-else-if="structureData?.semesters?.length" class="space-y-4">
        <div
          v-for="sem in structureData.semesters"
          :key="sem.semester"
          class="card bg-base-100 border border-base-300 shadow-sm"
        >
          <div class="card-body p-4">
            <!-- Semester Header -->
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">Semester {{ sem.semester }}</h3>
              <div class="badge badge-outline">
                {{ sem.totalCredits }} Credits · {{ sem.courseCount }} Courses
              </div>
            </div>

            <!-- Courses Table -->
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr class="text-xs text-base-content/60">
                    <th>Code</th>
                    <th>Course Name</th>
                    <th class="text-center">Credits</th>
                    <th>Prerequisite</th>
                    <th class="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="course in sem.courses" :key="course.id">
                    <td class="font-mono text-sm">{{ course.course_code }}</td>
                    <td>{{ course.course_name }}</td>
                    <td class="text-center">{{ course.credit_hour }}</td>
                    <td>
                      <span
                        v-if="course.prerequisite_code"
                        class="badge badge-sm badge-ghost"
                      >
                        {{ course.prerequisite_code }}
                      </span>
                      <span v-else class="text-base-content/40">—</span>
                    </td>
                    <td class="text-right">
                      <div class="flex gap-1 justify-end">
                        <button
                          class="btn btn-ghost btn-xs"
                          @click="openEditModal(course)"
                        >
                          Edit
                        </button>
                        <button
                          class="btn btn-ghost btn-xs text-error"
                          :disabled="deleteLoading === course.id"
                          @click="handleDeleteCourse(course.id)"
                        >
                          <span
                            v-if="deleteLoading === course.id"
                            class="loading loading-spinner loading-xs"
                          ></span>
                          <span v-else>Remove</span>
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
        class="flex flex-col items-center justify-center border border-dashed border-base-300 rounded-lg p-10 text-center"
      >
        <h3 class="font-medium mb-1">No courses in this session yet</h3>
        <p class="text-sm text-base-content/60 max-w-md mb-4">
          Start building your program structure by adding courses to each
          semester.
        </p>
        <button class="btn btn-primary btn-sm" @click="showAddModal = true">
          + Add First Course
        </button>
      </div>
    </div>

    <!-- No sessions state -->
    <div
      v-else-if="!sessionsPending"
      class="flex flex-col items-center justify-center border border-dashed border-base-300 rounded-lg p-10 text-center"
    >
      <h3 class="font-medium mb-1">No sessions created yet</h3>
      <p class="text-sm text-base-content/60 max-w-md mb-4">
        Create a session to start defining your program structure. Each session
        (intake) can have a different course arrangement.
      </p>
      <button
        class="btn btn-primary btn-sm"
        @click="showCreateSessionModal = true"
      >
        + Create First Session
      </button>
    </div>

    <!-- Create Session Modal -->
    <dialog :class="['modal', { 'modal-open': showCreateSessionModal }]">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Create New Session</h3>

        <form @submit.prevent="handleCreateSession" class="space-y-4">
          <div class="form-control">
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

          <div class="form-control">
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
              <span class="label-text-alt text-base-content/60">
                Format: MMYY (e.g., 0824 = August 2024)
              </span>
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
              <span v-else>Create Session</span>
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showCreateSessionModal = false">close</button>
      </form>
    </dialog>

    <!-- Clone Session Modal -->
    <dialog :class="['modal', { 'modal-open': showCloneSessionModal }]">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Clone Session</h3>

        <p class="text-sm text-base-content/70 mb-4">
          Create a new session by copying all courses from an existing session.
          This is useful when the next intake has a similar structure.
        </p>

        <form @submit.prevent="handleCloneSession" class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Source Session</span>
            </label>
            <select
              v-model="cloneSession.source_id"
              class="select select-bordered w-full"
              required
            >
              <option :value="null" disabled>Select source session</option>
              <option v-for="sess in sessions" :key="sess.id" :value="sess.id">
                {{ sess.session_name }} ({{ sess.course_count }} courses)
              </option>
            </select>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">New Session Name</span>
            </label>
            <input
              v-model="cloneSession.session_name"
              type="text"
              placeholder="e.g., January 2025 Intake"
              class="input input-bordered w-full"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Intake Year (MMYY)</span>
            </label>
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
              <span v-else>Clone Session</span>
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showCloneSessionModal = false">close</button>
      </form>
    </dialog>

    <!-- Add Course Modal -->
    <dialog :class="['modal', { 'modal-open': showAddModal }]">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Add Course to Session</h3>

        <form @submit.prevent="handleAddCourse" class="space-y-4">
          <!-- Course Selection -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Course</span>
            </label>
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
            <div class="flex items-center justify-between mt-2">
              <span
                v-if="availableCourses.length === 0"
                class="text-xs text-warning"
              >
                No available courses. Create one first.
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                @click="
                  reopenAddAfterCreate = true;
                  showAddModal = false;
                  showCreateCourseModal = true;
                "
              >
                + Create Course
              </button>
            </div>
          </div>

          <!-- Semester Selection -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Semester</span>
            </label>
            <select
              v-model="newCourse.semester"
              class="select select-bordered w-full"
              required
            >
              <option v-for="sem in semesterOptions" :key="sem" :value="sem">
                Semester {{ sem }}
              </option>
            </select>
          </div>

          <!-- Prerequisite Selection -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Prerequisite (Optional)</span>
            </label>
            <select
              v-model="newCourse.prerequisite_course_id"
              class="select select-bordered w-full"
            >
              <option value="">No prerequisite</option>
              <option
                v-for="course in getPrerequisiteOptions(newCourse.semester)"
                :key="course.course_id"
                :value="course.course_id"
              >
                {{ course.course_code }} - {{ course.course_name }}
              </option>
            </select>
            <label class="label">
              <span class="label-text-alt text-base-content/60">
                Prerequisite must be from an earlier semester
              </span>
            </label>
          </div>

          <!-- Actions -->
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
              :disabled="addLoading || !newCourse.course_id"
            >
              <span
                v-if="addLoading"
                class="loading loading-spinner loading-sm"
              ></span>
              <span v-else>Add Course</span>
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showAddModal = false">close</button>
      </form>
    </dialog>

    <!-- Create Course Modal -->
    <dialog :class="['modal', { 'modal-open': showCreateCourseModal }]">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Create Course</h3>

        <form @submit.prevent="handleCreateCourse" class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Course Code</span>
            </label>
            <input
              v-model="createCourse.course_code"
              type="text"
              placeholder="e.g., CT204"
              class="input input-bordered w-full"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Course Name</span>
            </label>
            <input
              v-model="createCourse.course_name"
              type="text"
              placeholder="e.g., Data Structures"
              class="input input-bordered w-full"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Credit Hour</span>
            </label>
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
              <span v-else>Create</span>
            </button>
          </div>
        </form>
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
    <dialog :class="['modal', { 'modal-open': showEditModal }]">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Edit Course</h3>

        <div v-if="editingCourse" class="mb-4 p-3 bg-base-200 rounded-lg">
          <p class="font-mono text-sm">{{ editingCourse.course_code }}</p>
          <p class="text-sm text-base-content/70">
            {{ editingCourse.course_name }}
          </p>
        </div>

        <form @submit.prevent="handleUpdateCourse" class="space-y-4">
          <!-- Semester Selection -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Semester</span>
            </label>
            <select
              v-model="editForm.semester"
              class="select select-bordered w-full"
              required
            >
              <option v-for="sem in semesterOptions" :key="sem" :value="sem">
                Semester {{ sem }}
              </option>
            </select>
          </div>

          <!-- Prerequisite Selection -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">Prerequisite (Optional)</span>
            </label>
            <select
              v-model="editForm.prerequisite_course_id"
              class="select select-bordered w-full"
            >
              <option value="">No prerequisite</option>
              <option
                v-for="course in getEditPrerequisiteOptions(editForm.semester)"
                :key="course.course_id"
                :value="course.course_id"
              >
                {{ course.course_code }} - {{ course.course_name }}
              </option>
            </select>
          </div>

          <!-- Actions -->
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
              <span v-else>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showEditModal = false">close</button>
      </form>
    </dialog>
  </div>
</template>
