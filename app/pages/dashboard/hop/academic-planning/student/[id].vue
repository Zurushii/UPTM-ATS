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
  };
}

// Fetch plan data
const {
  data: planData,
  pending: loading,
} = await useFetch<PlanData>(`/api/hop/academic-planning/plan/${planId}`);

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
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  return `${monthNames[month - 1]} ${fullYear}`;
};

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  const semInYear = ((semesterNum - 1) % 3) + 1;
  return `Semester ${semesterNum} / Year ${year}`;
};

// Get status badge class
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

// Go back
const goBack = () => {
  window.history.back();
};
</script>

<template>
  <div class="p-6 max-w-5xl space-y-6">
    <!-- Back Button & Header -->
    <div class="flex items-start gap-4">
      <button class="btn btn-ghost btn-sm mt-1" @click="goBack">
        ← Back
      </button>
      <div class="flex-1">
        <h1 class="text-2xl font-semibold">Student Academic Plan</h1>
        <p class="text-sm text-base-content/60">
          View the generated academic plan for this student.
        </p>
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
                {{ planData.plan.intake_name || formatIntake(planData.plan.intake_year) }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Starting Semester:</span>
              <div class="font-medium">Semester {{ planData.plan.start_semester }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Credits Transferred:</span>
              <div class="font-medium">
                {{ planData.student.total_credit_transferred ?? 0 }}
              </div>
            </div>
            <div>
              <span class="text-base-content/60">Total Plan Credits:</span>
              <div class="font-medium">{{ planData.summary.total_credits }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="stats shadow w-full">
        <div class="stat">
          <div class="stat-title">Total Semesters</div>
          <div class="stat-value text-2xl">{{ planData.summary.total_semesters }}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Credits</div>
          <div class="stat-value text-2xl">{{ planData.summary.total_credits }}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Total Courses</div>
          <div class="stat-value text-2xl">
            {{ planData.semesters.reduce((sum, s) => sum + s.courses.length, 0) }}
          </div>
        </div>
      </div>

      <!-- Semester Cards -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Semester Breakdown</h2>

        <div
          v-for="semester in planData.semesters"
          :key="semester.semester"
          class="card bg-base-100 border border-base-300 shadow-sm"
        >
          <div class="card-body">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-medium">
                {{ formatSemester(semester.semester) }}
              </h3>
              <span class="badge badge-outline">
                {{ semester.total_credits }} credits
              </span>
            </div>

            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Course Code</th>
                    <th>Course Name</th>
                    <th class="text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="course in semester.courses" :key="course.course_id">
                    <td class="font-mono text-sm">{{ course.course_code }}</td>
                    <td>{{ course.course_name }}</td>
                    <td class="text-right">{{ course.credit_hour }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="font-medium">
                    <td colspan="2" class="text-right">Total:</td>
                    <td class="text-right">{{ semester.total_credits }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <!-- Empty state if no semesters -->
        <div
          v-if="planData.semesters.length === 0"
          class="text-center py-8 text-base-content/60 border border-dashed border-base-300 rounded-lg"
        >
          <p>No course assignments found for this plan.</p>
        </div>
      </div>
    </template>
  </div>
</template>
