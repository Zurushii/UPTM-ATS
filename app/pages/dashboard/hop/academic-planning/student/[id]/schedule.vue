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
}

// Fetch plan data
const {
  data: planData,
  pending: loading,
  refresh: refreshPlan,
} = await useFetch<PlanData>(`/api/hop/academic-planning/plan/${planId}`);

// Fetch available courses
const { data: coursesData, pending: coursesLoading } = await useFetch<{ courses: AvailableCourse[] }>(
  `/api/hop/academic-planning/plan/${planId}/courses`
);

// Check if plan exists or not draft
if (!loading.value && (!planData.value || planData.value.plan.status !== "draft")) {
  await navigateTo(`/dashboard/hop/academic-planning/student/${planId}`);
}

// State
const selectedSemester = ref<number | null>(null);
const saveLoading = ref(false);
const courseAssignments = ref<Map<number, number>>(new Map()); // course_id -> semester

// Initialize course assignments from plan data
watchEffect(() => {
  if (planData.value) {
    courseAssignments.value = new Map();
    for (const semester of planData.value.semesters) {
      for (const course of semester.courses) {
        // Only track planned courses, not transferred
        if (course.status === "Planned") {
          courseAssignments.value.set(course.course_id, semester.semester);
        }
      }
    }
  }
});

// Get only planned courses (not transferred)
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
  
  // Filter out transferred courses
  return coursesData.value.courses.filter(c => !transferredIds.has(c.course_id));
});

// Get unique semesters from available courses
const availableSemesters = computed(() => {
  const semesters = new Set<number>();
  if (coursesData.value) {
    for (const course of coursesData.value.courses) {
      semesters.add(course.default_semester);
    }
  }
  return Array.from(semesters).sort((a, b) => a - b);
});

// Get courses for selected semester
const coursesForSemester = computed(() => {
  if (selectedSemester.value === null) return [];
  return plannedCourses.value.filter(c => {
    const assigned = courseAssignments.value.get(c.course_id);
    return assigned === selectedSemester.value || (!assigned && c.default_semester === selectedSemester.value);
  });
});

// Get unassigned courses
const unassignedCourses = computed(() => {
  return plannedCourses.value.filter(c => {
    const assigned = courseAssignments.value.get(c.course_id);
    return !assigned;
  });
});

// Calculate credits for a semester
const getSemesterCredits = (sem: number) => {
  let credits = 0;
  for (const [courseId, semester] of courseAssignments.value) {
    if (semester === sem) {
      const course = plannedCourses.value.find(c => c.course_id === courseId);
      if (course) credits += course.credit_hour;
    }
  }
  return credits;
};

// Calculate total assigned credits
const totalAssignedCredits = computed(() => {
  let total = 0;
  for (const [courseId] of courseAssignments.value) {
    const course = plannedCourses.value.find(c => c.course_id === courseId);
    if (course) total += course.credit_hour;
  }
  return total;
});

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};

// Assign course to semester
const assignCourse = (courseId: number, semester: number) => {
  courseAssignments.value.set(courseId, semester);
};

// Remove course from semester
const removeCourse = (courseId: number) => {
  courseAssignments.value.delete(courseId);
};

// Check if course is assigned to current semester
const isAssignedToSemester = (courseId: number, semester: number) => {
  return courseAssignments.value.get(courseId) === semester;
};

// Save all changes
const saveChanges = async () => {
  if (!planData.value) return;
  
  saveLoading.value = true;
  
  try {
    // Group courses by semester
    const semesterCourses: Map<number, { course_id: number; status: string }[]> = new Map();
    
    for (const [courseId, semester] of courseAssignments.value) {
      if (!semesterCourses.has(semester)) {
        semesterCourses.set(semester, []);
      }
      semesterCourses.get(semester)!.push({
        course_id: courseId,
        status: "Planned",
      });
    }
    
    // Save each semester
    for (const [semester, courses] of semesterCourses) {
      await $fetch("/api/hop/academic-planning/plan/schedule", {
        method: "POST",
        body: {
          plan_id: planData.value.plan.id,
          semester,
          courses,
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
</script>

<template>
  <div class="p-6 w-full space-y-6">
    <!-- Header -->
    <div class="flex items-start gap-4">
      <button class="btn btn-ghost btn-sm mt-1" @click="goBack">
        ← Back
      </button>
      <div class="flex-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold">Schedule Semester</h1>
            <p v-if="planData" class="text-sm text-base-content/60">
              {{ planData.student.name }} ({{ planData.student.matric_no }})
            </p>
          </div>
          <button
            class="btn btn-primary"
            :disabled="saveLoading"
            @click="saveChanges"
          >
            <span v-if="saveLoading" class="loading loading-spinner loading-xs"></span>
            💾 Save Changes
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading || coursesLoading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="planData && coursesData">
      <!-- Summary -->
      <div class="alert alert-info">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          <p><strong>{{ plannedCourses.length }}</strong> courses to schedule (excluding transferred courses)</p>
          <p class="text-sm">Assigned: <strong>{{ totalAssignedCredits }}</strong> / {{ planData.summary.planned_credits }} credits</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-6">
        <!-- Semester Selection -->
        <div class="lg:col-span-1">
          <div class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body">
              <h2 class="card-title text-base">Semesters</h2>
              <p class="text-sm text-base-content/60 mb-4">Select a semester to view and manage courses</p>
              
              <div class="space-y-2">
                <button
                  v-for="sem in availableSemesters"
                  :key="sem"
                  class="btn btn-block justify-between"
                  :class="selectedSemester === sem ? 'btn-primary' : 'btn-ghost'"
                  @click="selectedSemester = sem"
                >
                  <span>{{ formatSemester(sem) }}</span>
                  <span class="badge" :class="selectedSemester === sem ? 'badge-primary-content' : 'badge-outline'">
                    {{ getSemesterCredits(sem) }} cr
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Course Assignment -->
        <div class="lg:col-span-2">
          <div v-if="selectedSemester === null" class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body text-center py-12">
              <p class="text-base-content/60">Select a semester from the left to manage courses</p>
            </div>
          </div>

          <div v-else class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body">
              <div class="flex items-center justify-between mb-4">
                <h2 class="card-title text-base">{{ formatSemester(selectedSemester) }}</h2>
                <span class="badge badge-primary">{{ getSemesterCredits(selectedSemester) }} credits</span>
              </div>

              <!-- Courses in this semester -->
              <div class="space-y-2">
                <div
                  v-for="course in plannedCourses.filter(c => courseAssignments.get(c.course_id) === selectedSemester)"
                  :key="course.course_id"
                  class="flex items-center justify-between p-3 bg-base-200/50 rounded-lg"
                >
                  <div>
                    <span class="font-mono text-sm">{{ course.course_code }}</span>
                    <span class="mx-2">-</span>
                    <span>{{ course.course_name }}</span>
                    <span class="badge badge-sm badge-ghost ml-2">{{ course.credit_hour }} cr</span>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    @click="removeCourse(course.course_id)"
                  >
                    ✕ Remove
                  </button>
                </div>

                <div
                  v-if="plannedCourses.filter(c => courseAssignments.get(c.course_id) === selectedSemester).length === 0"
                  class="text-center py-4 text-base-content/60"
                >
                  No courses assigned to this semester
                </div>
              </div>

              <!-- Add courses -->
              <div class="divider">Add Courses</div>

              <div class="space-y-2 max-h-64 overflow-y-auto">
                <div
                  v-for="course in plannedCourses.filter(c => !courseAssignments.has(c.course_id))"
                  :key="course.course_id"
                  class="flex items-center justify-between p-3 border border-base-300 rounded-lg hover:bg-base-200/30 cursor-pointer"
                  @click="assignCourse(course.course_id, selectedSemester)"
                >
                  <div>
                    <span class="font-mono text-sm">{{ course.course_code }}</span>
                    <span class="mx-2">-</span>
                    <span>{{ course.course_name }}</span>
                    <span class="badge badge-sm badge-ghost ml-2">{{ course.credit_hour }} cr</span>
                    <span class="badge badge-sm badge-outline ml-1">Default: Sem {{ course.default_semester }}</span>
                  </div>
                  <button class="btn btn-ghost btn-xs text-success">
                    + Add
                  </button>
                </div>

                <div
                  v-if="plannedCourses.filter(c => !courseAssignments.has(c.course_id)).length === 0"
                  class="text-center py-4 text-base-content/60"
                >
                  All courses have been assigned
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
