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
const intakeId = route.params.id as string;

// Types
interface StudentData {
  student_id: number;
  matric_no: string;
  student_name: string;
  entry_semester: number | null;
  total_credit_transferred: number | null;
  academic_plan_id: number | null;
  plan_status: string | null;
}

interface IntakeDetail {
  id: number;
  intake_year: string;
  intake_name: string;
  session_id: number;
  session_name: string;
  intake_type: string;
  status: "draft" | "generated" | "finalized";
  total_students: number;
  successful_plans: number;
  failed_plans: number;
  created_at: string;
  updated_at: string;
  students: StudentData[];
}

// State
const searchQuery = ref("");
const filterStatus = ref<string>("all");

// Fetch intake details
const {
  data: intakeData,
  pending: loading,
  refresh,
} = await useFetch<IntakeDetail>(`/api/hop/academic-planning/${intakeId}`);

// Check if intake exists
if (!loading.value && !intakeData.value) {
  await navigateTo("/dashboard/hop/academic-planning");
}

// Filtered students
const filteredStudents = computed(() => {
  if (!intakeData.value?.students) return [];

  let students = intakeData.value.students;

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    students = students.filter(
      (s) =>
        s.matric_no.toLowerCase().includes(query) ||
        s.student_name.toLowerCase().includes(query)
    );
  }

  // Filter by status
  if (filterStatus.value !== "all") {
    if (filterStatus.value === "no_plan") {
      students = students.filter((s) => !s.academic_plan_id);
    } else {
      students = students.filter((s) => s.plan_status === filterStatus.value);
    }
  }

  return students;
});

// Stats
const stats = computed(() => {
  if (!intakeData.value?.students) {
    return { total: 0, withPlan: 0, noPlan: 0, approved: 0 };
  }

  const students = intakeData.value.students;
  return {
    total: students.length,
    withPlan: students.filter((s) => s.academic_plan_id).length,
    noPlan: students.filter((s) => !s.academic_plan_id).length,
    approved: students.filter((s) => s.plan_status === "approved").length,
  };
});

// Format intake year
const formatIntake = (intake: string) => {
  if (!intake || intake.length !== 4) return intake;
  const month = parseInt(intake.substring(0, 2));
  const year = parseInt(intake.substring(2, 4));
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  return `${monthNames[month - 1]} ${fullYear}`;
};

// Format date
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Get status badge class
const getStatusBadgeClass = (status: string | null) => {
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

// View student plan
const viewStudentPlan = (student: StudentData) => {
  if (student.academic_plan_id) {
    navigateTo(
      `/dashboard/hop/academic-planning/student/${student.academic_plan_id}`
    );
  }
};

// Go back
const goBack = () => {
  navigateTo("/dashboard/hop/academic-planning");
};
</script>

<template>
  <div class="p-6 max-w-6xl space-y-6">
    <!-- Back Button & Header -->
    <div class="flex items-start gap-4">
      <button class="btn btn-ghost btn-sm mt-1" @click="goBack">
        ← Back
      </button>
      <div class="flex-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold">
              {{ intakeData?.intake_name || "Loading..." }}
            </h1>
            <p class="text-sm text-base-content/60">
              {{ formatIntake(intakeData?.intake_year || "") }} •
              {{ intakeData?.session_name }}
            </p>
          </div>
          <span
            v-if="intakeData"
            class="badge"
            :class="{
              'badge-warning': intakeData.status === 'draft',
              'badge-success': intakeData.status === 'generated',
              'badge-info': intakeData.status === 'finalized',
            }"
          >
            {{ intakeData.status }}
          </span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <template v-else-if="intakeData">
      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">Total Students</div>
          <div class="stat-value text-2xl">{{ stats.total }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">With Plans</div>
          <div class="stat-value text-2xl text-success">{{ stats.withPlan }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">No Plan</div>
          <div class="stat-value text-2xl text-warning">{{ stats.noPlan }}</div>
        </div>
        <div class="stat bg-base-100 border border-base-300 rounded-lg">
          <div class="stat-title">Approved</div>
          <div class="stat-value text-2xl text-info">{{ stats.approved }}</div>
        </div>
      </div>

      <!-- Intake Info Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base">Intake Details</h2>
          <div class="grid md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-base-content/60">Semester Rules:</span>
              <div class="font-medium">{{ intakeData.intake_type }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Created:</span>
              <div class="font-medium">{{ formatDate(intakeData.created_at) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Last Updated:</span>
              <div class="font-medium">{{ formatDate(intakeData.updated_at) }}</div>
            </div>
            <div>
              <span class="text-base-content/60">Generation Stats:</span>
              <div class="font-medium">
                {{ intakeData.successful_plans }} successful,
                {{ intakeData.failed_plans }} failed
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Students Table Card -->
      <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 class="card-title text-base">Students</h2>

            <div class="flex gap-2">
              <!-- Search -->
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search students..."
                class="input input-bordered input-sm w-48"
              />

              <!-- Filter -->
              <select
                v-model="filterStatus"
                class="select select-bordered select-sm"
              >
                <option value="all">All Status</option>
                <option value="no_plan">No Plan</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-if="filteredStudents.length === 0"
            class="text-center py-8 text-base-content/60"
          >
            <p>No students found matching your criteria.</p>
          </div>

          <!-- Students Table -->
          <div v-else class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Matric No</th>
                  <th>Student Name</th>
                  <th>Entry Semester</th>
                  <th>Credits Transferred</th>
                  <th>Plan Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in filteredStudents"
                  :key="student.student_id"
                  class="hover"
                >
                  <td class="font-mono">{{ student.matric_no }}</td>
                  <td>{{ student.student_name }}</td>
                  <td>
                    <span v-if="student.entry_semester" class="badge badge-sm badge-info">
                      Semester {{ student.entry_semester }}
                    </span>
                    <span v-else class="text-base-content/40">-</span>
                  </td>
                  <td>{{ student.total_credit_transferred ?? "-" }}</td>
                  <td>
                    <span
                      v-if="student.academic_plan_id"
                      class="badge badge-sm"
                      :class="getStatusBadgeClass(student.plan_status)"
                    >
                      {{ student.plan_status }}
                    </span>
                    <span v-else class="text-base-content/40">No plan</span>
                  </td>
                  <td>
                    <button
                      v-if="student.academic_plan_id"
                      class="btn btn-ghost btn-xs"
                      @click="viewStudentPlan(student)"
                    >
                      View Plan
                    </button>
                    <span v-else class="text-xs text-base-content/40">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Results count -->
          <div class="text-sm text-base-content/60 mt-4">
            Showing {{ filteredStudents.length }} of {{ intakeData.students.length }} students
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
