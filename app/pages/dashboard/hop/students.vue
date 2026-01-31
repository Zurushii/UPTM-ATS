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
const selectedAccountStatus = ref<string>("");
const searchQuery = ref<string>("");

// Build query params for filtering
const queryParams = computed(() => {
  const params: Record<string, string> = {};
  if (selectedIntake.value) params.intake = selectedIntake.value;
  if (selectedEntrySemester.value)
    params.entry_semester = selectedEntrySemester.value;
  if (selectedStatus.value) params.status = selectedStatus.value;
  if (selectedAccountStatus.value) params.account_status = selectedAccountStatus.value;
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

// Status badge styling for plan status
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

// Status badge styling for account status
const getAccountStatusBadge = (status: string) => {
  switch (status) {
    case "active":
      return "badge-success";
    case "reserved":
      return "badge-warning";
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
  selectedAccountStatus.value = "";
  searchQuery.value = "";
};
</script>

<template>
  <div class="h-full flex flex-col space-y-4">
    <!-- Page Header -->
    <div class="flex-none space-y-1">
      <h1 class="text-2xl font-bold">Students</h1>
      <p class="text-base text-base-content/70">
        List of students under your program. This module is read-only for
        monitoring purposes.
      </p>
    </div>

    <!-- Students Table Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm flex-1 overflow-hidden">
      <div class="card-body p-0 flex flex-col h-full">
        <!-- Table Header with Filters -->
        <div class="p-4 flex-none space-y-4 border-b border-base-200 bg-base-100/80 backdrop-blur top-0 z-20">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-bold flex items-center gap-2">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary">
                 <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
               </svg>
               Student Directory
            </h2>
            <span v-if="students" class="badge badge-neutral">
              {{ filteredStudents.length }} student(s)
            </span>
          </div>

          <!-- Filter Controls -->
          <div class="p-4 bg-base-200/50 backdrop-blur rounded-xl border border-base-200 flex flex-wrap items-center gap-3">
            <!-- Search -->
            <div class="relative w-full max-w-xs">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search students..."
                  class="input input-sm input-bordered w-full pl-9"
                />
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 absolute left-3 top-2.5 text-base-content/50">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
            </div>

            <div class="divider divider-horizontal mx-0 h-8 self-center"></div>

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
              <option value="">All Semesters</option>
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
              <option value="">All Plan Status</option>
              <option value="none">No Plan</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
            </select>

            <!-- Account Status Filter -->
            <select
              v-model="selectedAccountStatus"
              class="select select-sm select-bordered"
            >
              <option value="">All Accounts</option>
              <option value="active">Active</option>
              <option value="reserved">Pre-registered</option>
            </select>

            <!-- Clear Filters -->
            <button
              v-if="
                selectedIntake ||
                selectedEntrySemester ||
                selectedStatus ||
                selectedAccountStatus ||
                searchQuery
              "
              class="btn btn-sm btn-ghost text-error"
              @click="clearFilters"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                 <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="pending" class="flex-1 flex justify-center items-center">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>

        <!-- Table -->
        <div v-else-if="filteredStudents.length > 0" class="flex-1 overflow-auto">
          <table class="table table-zebra table-pin-rows">
            <thead>
              <tr class="bg-base-200/50 backdrop-blur">
                <th class="font-bold">Student ID</th>
                <th class="font-bold">Matric No</th>
                <th class="font-bold">Name</th>
                <th class="font-bold">Intake</th>
                <th class="font-bold">Entry Semester</th>
                <th class="font-bold">Plan Status</th>
                <th class="font-bold">Account Status</th>
                <th class="font-bold text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="student in filteredStudents" :key="student.student_id" class="hover group">
                <td class="font-mono opacity-50">{{ student.student_id }}</td>
                <td>
                    <span class="badge badge-ghost font-mono text-xs">{{ student.matric_no }}</span>
                </td>
                <td>
                  <div class="flex items-center gap-3">
                    <div class="avatar placeholder">
                       <div class="bg-primary/10 text-primary w-8 rounded-full">
                           <span class="text-xs font-bold">{{ student.student_name.charAt(0) }}</span>
                       </div>
                    </div>
                    <div>
                        <div class="font-bold text-sm">{{ student.student_name }}</div>
                        <div class="text-xs opacity-70">{{ student.email }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="text-sm font-medium">{{ formatIntake(student.intake) }}</div>
                </td>
                <td>
                  <span v-if="student.entry_semester !== null" class="badge badge-sm badge-outline">
                    Sem {{ student.entry_semester }}
                  </span>
                  <span v-else class="text-base-content/40 italic text-xs">
                    Pending
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
                <td>
                  <span
                    class="badge badge-sm"
                    :class="getAccountStatusBadge(student.account_status)"
                  >
                    {{ student.account_status === "reserved" ? "Pre-registered" : "Active" }}
                  </span>
                </td>
                <td class="text-right">
                    <NuxtLink :to="`/dashboard/hop/academic-planning/student/${student.student_id}`" class="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity">
                        View Plan
                    </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div v-else class="flex-1 flex flex-col items-center justify-center text-base-content/60">
          <div class="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mb-4">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 opacity-50">
               <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
             </svg>
          </div>
          <p class="text-lg font-medium">No students found.</p>
          <p class="text-sm opacity-70">Try adjusting your filters or search query.</p>
          <button class="btn btn-sm btn-link mt-2" @click="clearFilters">Clear all filters</button>
        </div>

        <!-- Footer -->
        <div class="p-3 border-t border-base-200 text-xs text-base-content/50 bg-base-100 flex justify-between">
          <span>{{ filteredStudents.length }} records shown</span>
          <span>Last synced: Just now</span>
        </div>
      </div>
    </div>
  </div>
</template>
