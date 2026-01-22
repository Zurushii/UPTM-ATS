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

// Filter state
const selectedIntake = ref<string>("");
const selectedEntrySemester = ref<string>("");
const selectedStatus = ref<string>("");
const searchQuery = ref<string>("");

// Build query params for filtering
const queryParams = computed(() => {
  const params: Record<string, string> = {};
  if (selectedIntake.value) params.intake = selectedIntake.value;
  if (selectedEntrySemester.value)
    params.entry_semester = selectedEntrySemester.value;
  if (selectedStatus.value) params.status = selectedStatus.value;
  return params;
});

// Fetch filter options
const { data: filterOptions } = await useFetch("/api/hop/students-filters");

// Fetch students with filters
const {
  data: students,
  pending,
  refresh,
} = await useFetch("/api/hop/students", {
  query: queryParams,
});

// Client-side search filtering
const filteredStudents = computed(() => {
  if (!students.value) return [];
  if (!searchQuery.value.trim()) return students.value;

  const query = searchQuery.value.toLowerCase();
  return (students.value as any[]).filter(
    (s) =>
      s.matric_no.toLowerCase().includes(query) ||
      s.student_name.toLowerCase().includes(query) ||
      s.email.toLowerCase().includes(query),
  );
});

// Status badge styling
const getStatusBadge = (status: string) => {
  switch (status) {
    case "approved":
      return "badge-success";
    case "draft":
      return "badge-warning";
    case "completed":
      return "badge-info";
    default:
      return "badge-ghost";
  }
};

// Format intake year (MMYY -> Month Year)
const formatIntake = (intake: string) => {
  if (!intake || intake.length !== 4) return intake;
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

// Clear all filters
const clearFilters = () => {
  selectedIntake.value = "";
  selectedEntrySemester.value = "";
  selectedStatus.value = "";
  searchQuery.value = "";
};
</script>

<template>
  <div class="p-6 max-w-6xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Students</h1>
      <p class="text-sm text-base-content/60">
        List of students under your program. This module is read-only for
        monitoring purposes.
      </p>
    </div>

    <!-- Students Table Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-4">
        <!-- Table Header with Filters -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <h2 class="font-medium">Student Directory</h2>
            <span v-if="students" class="text-sm text-base-content/60">
              {{ filteredStudents.length }} student(s)
            </span>
          </div>

          <!-- Filter Controls -->
          <div class="flex flex-wrap items-center gap-3">
            <!-- Search -->
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search by name, matric, or email…"
              class="input input-sm input-bordered w-64"
            />

            <!-- Intake Filter -->
            <select
              v-model="selectedIntake"
              class="select select-sm select-bordered"
            >
              <option value="">All Intakes</option>
              <option
                v-for="intake in filterOptions?.intakes"
                :key="intake"
                :value="intake"
              >
                {{ formatIntake(intake) }}
              </option>
            </select>

            <!-- Entry Semester Filter -->
            <select
              v-model="selectedEntrySemester"
              class="select select-sm select-bordered"
            >
              <option value="">All Entry Semesters</option>
              <option value="null">Not Assessed</option>
              <option
                v-for="sem in filterOptions?.entrySemesters"
                :key="sem"
                :value="sem"
              >
                Semester {{ sem }}
              </option>
            </select>

            <!-- Academic Plan Status Filter -->
            <select
              v-model="selectedStatus"
              class="select select-sm select-bordered"
            >
              <option value="">All Statuses</option>
              <option value="none">No Plan</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
            </select>

            <!-- Clear Filters -->
            <button
              v-if="
                selectedIntake ||
                selectedEntrySemester ||
                selectedStatus ||
                searchQuery
              "
              class="btn btn-sm btn-ghost"
              @click="clearFilters"
            >
              Clear Filters
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="pending" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <!-- Table -->
        <div v-else-if="filteredStudents.length > 0" class="overflow-x-auto">
          <table class="table table-zebra w-full">
            <thead>
              <tr>
                <th class="text-left">Student ID</th>
                <th class="text-left">Matric No</th>
                <th class="text-left">Name</th>
                <th class="text-left">Intake</th>
                <th class="text-left">Entry Semester</th>
                <th class="text-left">Plan Status</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="student in filteredStudents" :key="student.student_id">
                <td class="font-mono text-sm">{{ student.student_id }}</td>
                <td class="font-mono">{{ student.matric_no }}</td>
                <td>
                  <div>
                    <div class="font-medium">{{ student.student_name }}</div>
                    <div class="text-xs text-base-content/60">
                      {{ student.email }}
                    </div>
                  </div>
                </td>
                <td>{{ formatIntake(student.intake) }}</td>
                <td>
                  <span v-if="student.entry_semester !== null">
                    Semester {{ student.entry_semester }}
                  </span>
                  <span v-else class="text-base-content/40 italic">
                    Not assessed
                  </span>
                </td>
                <td>
                  <span
                    class="badge badge-sm"
                    :class="getStatusBadge(student.academic_plan_status)"
                  >
                    {{
                      student.academic_plan_status === "none"
                        ? "No Plan"
                        : student.academic_plan_status
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div v-else class="text-center py-8 text-base-content/60">
          <p>No students found matching your criteria.</p>
        </div>

        <!-- Info -->
        <p class="text-sm text-base-content/60">
          Student records are synchronized automatically and used for credit
          transfer processing and academic plan generation.
        </p>
      </div>
    </div>
  </div>
</template>
