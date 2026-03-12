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
  if (selectedAccountStatus.value)
    params.account_status = selectedAccountStatus.value;
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
  const currentStudents = students.value || [];
  if (!searchQuery.value?.trim()) return currentStudents;

  const query = searchQuery.value.toLowerCase().trim();

  return (currentStudents as any[]).filter((s) => {
    const matric = String(s.matric_no || "").toLowerCase();
    const name = String(s.student_name || "").toLowerCase();
    const email = String(s.email || "").toLowerCase();

    return (
      matric.includes(query) || name.includes(query) || email.includes(query)
    );
  });
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
  currentPage.value = 1;
};

// Pagination
const currentPage = ref(1);
const itemsPerPage = ref(10);

const paginatedStudents = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return filteredStudents.value.slice(start, end);
});

const totalPages = computed(() => {
  return Math.ceil(filteredStudents.value.length / itemsPerPage.value) || 1;
});

const changePage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
};

watch(
  [
    searchQuery,
    selectedIntake,
    selectedEntrySemester,
    selectedStatus,
    selectedAccountStatus,
  ],
  () => {
    currentPage.value = 1;
  },
);
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 w-full max-w-7xl mx-auto flex flex-col space-y-8 h-full">
    <!-- Page Header -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 flex-none">
      <div class="space-y-2">
        <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
          Student <span class="text-primary">Directory</span>
        </h1>
        <p class="text-base-content/60 font-medium max-w-xl">
          List of students under your program. This module is read-only for monitoring purposes.
        </p>
      </div>
    </div>

    <!-- Students Table Card -->
    <div class="card bg-base-100 border border-base-200 shadow-sm flex-1 overflow-hidden relative">
      <!-- Decoration -->
      <div class="absolute -top-40 -right-40 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none transform-gpu"></div>

      <div class="card-body p-0 flex flex-col h-full relative z-10">
        <!-- Table Header with Filters -->
        <div class="p-5 lg:p-6 flex-none space-y-5 border-b border-base-200 bg-base-100 top-0 z-20">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold flex items-center gap-3">
              <span class="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
              </span>
              Overview
            </h2>
            <span v-if="students" class="badge badge-primary badge-outline border-primary/30 font-bold shadow-sm">
              {{ filteredStudents.length }} Student{{ filteredStudents.length !== 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Filter Controls -->
          <div class="p-3 bg-base-200/40 rounded-2xl border border-base-200 border-dashed">
            <div class="flex flex-col lg:flex-row gap-3">
              <!-- Search -->
              <div class="relative w-full lg:max-w-xs flex-1">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search students..."
                  class="input w-full pl-10 bg-base-100 hover:bg-base-200/50 focus:bg-base-100 transition-colors duration-200 border-transparent focus:border-primary shadow-sm rounded-xl"
                />
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 absolute left-3 top-3.5 text-base-content/40 z-10 pointer-events-none">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </div>

              <!-- Select Filters Grid -->
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                <select v-model="selectedIntake" class="select bg-base-100 shadow-sm border-transparent hover:bg-base-200/50 transition-colors w-full rounded-xl">
                  <option value="" class="font-bold">All Intakes</option>
                  <option v-for="intake in filterOptions?.intakes" :key="intake" :value="intake">{{ formatIntake(intake) }}</option>
                </select>

                <select v-model="selectedEntrySemester" class="select bg-base-100 shadow-sm border-transparent hover:bg-base-200/50 transition-colors w-full rounded-xl">
                  <option value="" class="font-bold">All Semesters</option>
                  <option value="null">Not Assessed</option>
                  <option v-for="sem in filterOptions?.entrySemesters" :key="sem" :value="sem">Semester {{ sem }}</option>
                </select>

                <select v-model="selectedStatus" class="select bg-base-100 shadow-sm border-transparent hover:bg-base-200/50 transition-colors w-full rounded-xl">
                  <option value="" class="font-bold">All Plan Status</option>
                  <option value="none">No Plan</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="completed">Completed</option>
                </select>

                <select v-model="selectedAccountStatus" class="select bg-base-100 shadow-sm border-transparent hover:bg-base-200/50 transition-colors w-full rounded-xl">
                  <option value="" class="font-bold">All Accounts</option>
                  <option value="active">Active</option>
                  <option value="reserved">Pre-registered</option>
                </select>
              </div>

              <!-- Clear Filters -->
              <button
                v-if="selectedIntake || selectedEntrySemester || selectedStatus || selectedAccountStatus || searchQuery"
                class="btn btn-outline hover:bg-error hover:border-error hover:text-white transition-colors duration-200 flex-none rounded-xl"
                @click="clearFilters"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="pending" class="flex-1 flex justify-center items-center py-24">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>

        <!-- Table -->
        <div v-else-if="filteredStudents.length > 0" class="flex-1 overflow-auto px-4 lg:px-6 pb-6 pt-4">
          <div class="bg-base-100 border border-base-200 rounded-2xl overflow-hidden shadow-sm">
            <table class="table w-full border-collapse">
              <thead class="bg-base-200/60 text-base-content border-b border-base-200">
                <tr>
                  <th class="font-bold text-center w-32">Matric No</th>
                  <th class="font-bold">Student Name</th>
                  <th class="font-bold text-center">Intake</th>
                  <th class="font-bold text-center">Entry Sem</th>
                  <th class="font-bold text-center">Plan Status</th>
                  <th class="font-bold text-center">Account</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="student in paginatedStudents" :key="student.student_id" class="hover:bg-primary/5 transition-colors duration-200 border-b border-base-200/60 group cursor-pointer will-change-transform" @click="navigateTo(`/dashboard/hop/academic-planning/student/${student.student_id}`)">
                  <td class="text-center">
                    <span class="inline-flex px-2 py-1 rounded bg-base-200/80 font-mono text-xs font-bold text-base-content border border-base-300 group-hover:bg-primary/10 group-hover:text-primary transition-colors duration-200">
                      {{ student.matric_no }}
                    </span>
                  </td>
                  <td>
                    <div class="font-extrabold text-sm text-base-content group-hover:text-primary transition-colors duration-200">
                      {{ student.student_name || "—" }}
                    </div>
                    <div class="text-xs text-base-content/50 font-medium mt-0.5">
                      {{ student.email }}
                    </div>
                  </td>
                  <td class="text-center">
                    <div class="text-sm font-bold text-base-content/70">
                      {{ formatIntake(student.intake) }}
                    </div>
                  </td>
                  <td class="text-center">
                    <span v-if="student.entry_semester !== null" class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-base-200 font-bold text-sm border border-base-300 group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-all duration-200">
                      {{ student.entry_semester }}
                    </span>
                    <span v-else class="text-base-content/40 italic text-xs font-medium">Pending</span>
                  </td>
                  <td class="text-center">
                    <span class="badge badge-sm font-bold uppercase tracking-wider text-[10px]" :class="getStatusBadge(student.academic_plan_status)">
                      {{ student.academic_plan_status === "none" ? "No Plan" : student.academic_plan_status }}
                    </span>
                  </td>
                  <td class="text-center">
                    <span class="badge badge-sm font-bold uppercase tracking-wider text-[10px]" :class="getAccountStatusBadge(student.account_status)">
                      {{ student.account_status === "reserved" ? "Pre-registered" : "Active" }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="flex-1 flex flex-col items-center justify-center py-24 px-4 text-center">
          <div class="w-20 h-20 bg-base-200/80 rounded-full flex items-center justify-center mb-6 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10 text-base-content/30"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          </div>
          <h3 class="text-xl font-bold text-base-content mb-3">No students found</h3>
          <p class="text-base-content/60 max-w-sm mb-6 leading-relaxed">
            We couldn't find any students matching your filters. Try removing some filters or change your search term.
          </p>
          <button v-if="selectedIntake || selectedEntrySemester || selectedStatus || selectedAccountStatus || searchQuery" class="btn btn-outline btn-primary rounded-xl" @click="clearFilters">
            Clear all filters
          </button>
        </div>

        <!-- Footer Pagination -->
        <div class="p-4 lg:p-5 border-t border-base-200 bg-base-200/30 flex flex-col sm:flex-row justify-between items-center gap-4 z-20">
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium text-base-content/60">
              Showing <span class="font-bold text-base-content">{{ paginatedStudents.length }}</span> of
              <span class="font-bold text-base-content">{{ filteredStudents.length }}</span> records
            </span>
            <select v-model="itemsPerPage" class="select select-bordered select-sm bg-base-100 rounded-lg cursor-pointer">
              <option :value="10">10 per page</option>
              <option :value="25">25 per page</option>
              <option :value="50">50 per page</option>
              <option :value="100">100 per page</option>
            </select>
          </div>

          <!-- Pagination Controls -->
          <div v-if="totalPages > 1" class="join shadow-sm border border-base-200">
            <button class="join-item btn btn-sm bg-base-100 hover:bg-base-200" :disabled="currentPage === 1" @click="changePage(currentPage - 1)">«</button>
            <button class="join-item btn btn-sm bg-base-100 pointer-events-none font-bold">Page {{ currentPage }} of {{ totalPages }}</button>
            <button class="join-item btn btn-sm bg-base-100 hover:bg-base-200" :disabled="currentPage === totalPages" @click="changePage(currentPage + 1)">»</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
