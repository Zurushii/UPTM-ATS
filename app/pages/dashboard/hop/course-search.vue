<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

interface CourseResult {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  course_type: string;
  student_count: number;
}

interface CourseDetail {
  course: {
    id: number;
    course_code: string;
    course_name: string;
    credit_hour: number;
  };
  students: {
    student_id: number;
    matric_no: string;
    intake_year: string;
    starting_semester: number;
    student_name: string;
    planned_semester: number;
  }[];
  sessions: {
    session_id: number;
    session_name: string;
    semester: number;
    course_type: string;
  }[];
  total_students: number;
  session_missing?: boolean;
}

interface CurrentSession {
  active_intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data: sessionData } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

const sessionLabel = computed(() => {
  if (!sessionData.value?.current_session) return "";
  return sessionData.value.current_session.semester_type === "L"
    ? "Long Semester"
    : "Short Semester";
});

const searchQuery = ref("");
const selectedCourseId = ref<number | null>(null);
const showDetailModal = ref(false);

// Fetch courses
const { data, status, refresh } = await useFetch<{
  courses: CourseResult[];
  has_session: boolean;
}>("/api/hop/course-search", {
  query: computed(() => ({
    search: searchQuery.value || undefined,
  })),
  watch: false,
});

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout>;
const onSearchInput = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    refresh();
  }, 300);
};

// Course detail
const courseDetail = ref<CourseDetail | null>(null);
const loadingDetail = ref(false);

const viewCourseDetail = async (courseId: number) => {
  selectedCourseId.value = courseId;
  loadingDetail.value = true;
  showDetailModal.value = true;
  try {
    courseDetail.value = await $fetch<CourseDetail>(
      `/api/hop/course-search/${courseId}`,
    );
  } catch (error) {
    console.error("Failed to load course detail:", error);
    courseDetail.value = null;
  } finally {
    loadingDetail.value = false;
  }
};

const closeModal = () => {
  showDetailModal.value = false;
  courseDetail.value = null;
  selectedCourseId.value = null;
};

// Format intake year MMYY -> "MMM YYYY"
const formatIntake = (mmyy: string) => {
  if (!mmyy || mmyy.length !== 4) return mmyy;
  const month = parseInt(mmyy.substring(0, 2), 10);
  const year = parseInt(mmyy.substring(2, 4), 10) + 2000;
  const months = [
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
  return `${months[month - 1] || "?"} ${year}`;
};

// Group courses by semester for display
const groupedCourses = computed(() => {
  if (!data.value?.courses) return {};
  const groups: Record<number, CourseResult[]> = {};
  for (const c of data.value.courses) {
    if (!groups[c.semester]) groups[c.semester] = [];
    groups[c.semester]!.push(c);
  }
  return groups;
});

const totalCourses = computed(() => data.value?.courses?.length || 0);
</script>

<template>
  <div class="p-6 w-full space-y-6">
    <!-- Header -->
    <div class="space-y-1">
      <h1
        class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary"
      >
        Course Search
      </h1>
      <p class="text-base-content/60 font-medium">
        Search courses and view student enrollment details.
      </p>
    </div>

    <!-- Session Banner -->
    <div v-if="sessionData?.current_session" class="alert shadow-sm">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        class="w-5 h-5 shrink-0"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
        />
      </svg>
      <span
        >Showing courses from
        <strong>{{
          formatIntake(sessionData.current_session.active_intake_period)
        }}</strong>
        · {{ sessionLabel }} · Students from all intakes</span
      >
    </div>
    <div v-else class="alert alert-warning shadow-sm">
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
        >Current session not set — student counts show 0. Configure the session
        in
        <NuxtLink to="/dashboard/hop" class="link link-primary font-medium"
          >Settings</NuxtLink
        >.</span
      >
    </div>

    <!-- Filters -->
    <div class="card bg-base-100 border border-base-200 shadow-sm">
      <div class="card-body p-4">
        <div class="form-control">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by course code or name..."
            class="input input-bordered w-full"
            @input="onSearchInput"
          />
        </div>
      </div>
    </div>

    <!-- Results Summary -->
    <div class="flex items-center gap-2 text-sm text-base-content/60">
      <span
        v-if="status === 'pending'"
        class="loading loading-spinner loading-xs"
      ></span>
      <span v-else
        >{{ totalCourses }} course{{
          totalCourses !== 1 ? "s" : ""
        }}
        found</span
      >
    </div>

    <!-- Course Table grouped by semester -->
    <div v-if="data?.courses && data.courses.length > 0" class="space-y-6">
      <div v-for="(courses, semester) in groupedCourses" :key="semester">
        <div class="flex items-center gap-2 mb-3">
          <div class="badge badge-primary badge-lg font-semibold">
            Semester {{ semester }}
          </div>
          <span class="text-xs text-base-content/50"
            >{{ courses.length }} course{{
              courses.length !== 1 ? "s" : ""
            }}</span
          >
        </div>

        <div class="overflow-x-auto">
          <table
            class="table table-sm bg-base-100 border border-base-200 rounded-lg"
          >
            <thead>
              <tr class="bg-base-200/50">
                <th class="w-32">Code</th>
                <th>Course Name</th>
                <th class="w-20 text-center">Credit</th>
                <th class="w-40">Type</th>
                <th class="w-28 text-center">Students</th>
                <th class="w-20"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="course in courses"
                :key="course.course_id"
                class="hover:bg-base-200/30 transition-colors"
              >
                <td class="font-mono font-medium text-primary">
                  {{ course.course_code }}
                </td>
                <td>{{ course.course_name }}</td>
                <td class="text-center">{{ course.credit_hour }}</td>
                <td>
                  <span class="badge badge-ghost badge-sm">{{
                    course.course_type
                  }}</span>
                </td>
                <td class="text-center">
                  <span
                    class="badge badge-sm"
                    :class="
                      course.student_count > 0 ? 'badge-info' : 'badge-ghost'
                    "
                  >
                    {{ course.student_count }}
                  </span>
                </td>
                <td>
                  <button
                    class="btn btn-ghost btn-xs"
                    @click="viewCourseDetail(course.course_id)"
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
                        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="status !== 'pending'"
      class="card bg-base-100 border border-base-200"
    >
      <div class="card-body items-center text-center py-12">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-12 h-12 text-base-content/20 mb-2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <p class="text-base-content/50">
          No courses found. Try adjusting your search or session filter.
        </p>
      </div>
    </div>

    <!-- Course Detail Modal -->
    <dialog class="modal" :class="{ 'modal-open': showDetailModal }">
      <div class="modal-box max-w-3xl">
        <button
          class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          @click="closeModal"
        >
          ✕
        </button>

        <!-- Loading -->
        <div v-if="loadingDetail" class="flex justify-center py-12">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>

        <!-- Detail Content -->
        <template v-else-if="courseDetail">
          <h3 class="font-bold text-lg flex items-center gap-2">
            <span class="font-mono text-primary">{{
              courseDetail.course.course_code
            }}</span>
            {{ courseDetail.course.course_name }}
          </h3>
          <p class="text-sm text-base-content/60 mt-1">
            {{ courseDetail.course.credit_hour }} Credit Hours
          </p>

          <!-- Sessions this course appears in -->
          <div class="mt-4">
            <h4 class="text-sm font-semibold mb-2">Appears in Sessions</h4>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="s in courseDetail.sessions"
                :key="s.session_id"
                class="badge badge-outline gap-1"
              >
                {{ s.session_name }} · Sem {{ s.semester }} ·
                {{ s.course_type }}
              </div>
            </div>
          </div>

          <!-- Student List -->
          <div class="mt-6">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-semibold">Enrolled Students</h4>
              <span class="badge badge-info"
                >{{ courseDetail.total_students }} student{{
                  courseDetail.total_students !== 1 ? "s" : ""
                }}</span
              >
            </div>

            <div
              v-if="courseDetail.students.length > 0"
              class="overflow-x-auto max-h-80 overflow-y-auto"
            >
              <table class="table table-sm table-pin-rows">
                <thead>
                  <tr class="bg-base-200/50">
                    <th>#</th>
                    <th>Matric No</th>
                    <th>Student Name</th>
                    <th class="text-center">Semester</th>
                    <th>Intake</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(student, idx) in courseDetail.students"
                    :key="student.student_id"
                    class="hover:bg-base-200/30"
                  >
                    <td class="text-base-content/50">{{ idx + 1 }}</td>
                    <td class="font-mono text-sm">{{ student.matric_no }}</td>
                    <td>{{ student.student_name || "—" }}</td>
                    <td class="text-center">{{ student.planned_semester }}</td>
                    <td>
                      <span class="badge badge-ghost badge-sm">{{
                        formatIntake(student.intake_year)
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              v-else-if="courseDetail.session_missing"
              class="text-center py-8"
            >
              <div class="badge badge-warning badge-lg gap-2 mb-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="stroke-current shrink-0 h-4 w-4"
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
                No Session Set
              </div>
              <p class="text-base-content/50 text-sm">
                Set the current session to view enrolled students.
              </p>
            </div>

            <div v-else class="text-center py-8 text-base-content/40">
              <p>No students enrolled in this course yet.</p>
            </div>
          </div>
        </template>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeModal">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
