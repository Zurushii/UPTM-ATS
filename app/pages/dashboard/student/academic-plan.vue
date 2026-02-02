<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({ layout: "dashboard" });

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
  status: "Planned" | "Transferred";
}

interface AcademicPlan {
  id: number;
  status: "draft" | "approved" | "completed";
  start_semester: number;
}

interface PlanResponse {
  plan: AcademicPlan | null;
  courses: Course[];
}

const { data, pending } = await useFetch<PlanResponse>("/api/student/academic-plan");
const { data: profile } = await useFetch<any>("/api/student/profile");

// Track which semesters are expanded
const expandedSemesters = ref<Set<number>>(new Set());

// Transferred courses collapsed state
const transferredCollapsed = ref(true);

// Get all transferred courses grouped together
const allTransferredCourses = computed(() => {
  if (!data.value?.courses) return [];
  return data.value.courses.filter(c => c.status === "Transferred");
});

// Total transferred credits
const transferredCredits = computed(() => {
  return allTransferredCourses.value.reduce((sum, c) => sum + c.credit_hour, 0);
});

// Get scheduled semesters (from start_semester onwards, only Planned courses)
const scheduledSemesters = computed(() => {
  if (!data.value?.courses || !data.value?.plan) return [];
  
  const startSem = data.value.plan.start_semester || 1;
  const grouped: Record<number, Course[]> = {};
  
  for (const course of data.value.courses) {
    if (course.status === "Planned" && course.semester >= startSem) {
      if (!grouped[course.semester]) {
        grouped[course.semester] = [];
      }
      grouped[course.semester]!.push(course);
    }
  }
  
  return Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b)
    .map(sem => ({
      semester: sem,
      courses: grouped[sem] || [],
      total_credits: (grouped[sem] || []).reduce((sum, c) => sum + c.credit_hour, 0)
    }));
});

// Initialize all semesters as expanded
watchEffect(() => {
  if (scheduledSemesters.value.length > 0 && expandedSemesters.value.size === 0) {
    scheduledSemesters.value.forEach((s) => expandedSemesters.value.add(s.semester));
  }
});

const toggleSemester = (semester: number) => {
  if (expandedSemesters.value.has(semester)) {
    expandedSemesters.value.delete(semester);
  } else {
    expandedSemesters.value.add(semester);
  }
};

// Navigate to schedule semester page
const goToSchedule = () => {
  if (data.value?.plan) {
    navigateTo(`/dashboard/student/schedule/${data.value.plan.id}`);
  }
};

// Re-schedule: revert to draft and navigate to schedule page
const reScheduleLoading = ref(false);
const reSchedule = async () => {
  if (!data.value?.plan) return;
  
  if (!confirm("Are you sure you want to re-schedule this plan? This will revert the status to draft.")) {
    return;
  }

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
    alert(error.data?.message || "Failed to revert plan status");
  } finally {
    reScheduleLoading.value = false;
  }
};

// Total credits in plan (planned only)
const plannedCredits = computed(() => {
  return data.value?.courses?.filter(c => c.status === "Planned")
    .reduce((sum: number, c: Course) => sum + c.credit_hour, 0) || 0;
});

// Total credits (transferred + planned)
const totalCredits = computed(() => {
  return transferredCredits.value + plannedCredits.value;
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

// Format semester label
const formatSemester = (semesterNum: number) => {
  const year = Math.ceil(semesterNum / 3);
  return `Semester ${semesterNum} / Year ${year}`;
};
</script>

<template>
  <!-- Loading Skeleton -->
  <div v-if="pending" class="space-y-6">
    <div class="skeleton h-12 w-80"></div>
    <div class="skeleton h-32"></div>
    <div class="skeleton h-64"></div>
    <div class="skeleton h-64"></div>
  </div>

  <div v-else class="space-y-8">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
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
         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
         </svg>
         Back to Dashboard
      </NuxtLink>
    </div>

    <!-- No Plan Yet -->
    <div v-if="!data?.plan" class="card bg-base-100 border border-base-200 shadow-sm text-center py-12">
      <div class="card-body items-center max-w-md mx-auto">
          <div class="w-20 h-20 bg-base-200 rounded-full flex items-center justify-center mb-6">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10 text-base-content/40">
               <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
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
      <!-- Stats Overview -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Status -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body p-4 flex flex-row items-center gap-4">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold"
                     :class="statusInfo.color.replace('badge-', 'bg-').replace('success', 'success/10 text-success').replace('warning', 'warning/10 text-warning').replace('info', 'info/10 text-info')">
                    {{ statusInfo.icon }}
                </div>
                <div>
                   <div class="text-xs uppercase tracking-wide text-base-content/60">Plan Status</div>
                   <div class="font-bold text-lg capitalize">{{ data.plan.status }}</div>
                </div>
            </div>
        </div>

        <!-- Start Sem -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body p-4 flex flex-row items-center gap-4">
                 <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                    </svg>
                 </div>
                 <div>
                   <div class="text-xs uppercase tracking-wide text-base-content/60">Starting</div>
                   <div class="font-bold text-lg">Semester {{ data.plan.start_semester }}</div>
                </div>
            </div>
        </div>

        <!-- Progress -->
        <div class="card bg-base-100 shadow-sm border border-base-200 md:col-span-2">
            <div class="card-body p-4">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs uppercase tracking-wide text-base-content/60">Total Progress</span>
                    <span class="font-bold text-primary">{{ creditProgress }}%</span>
                </div>
                <progress class="progress progress-primary w-full h-3 bg-base-200" :value="totalCredits" :max="profile?.total_credit_required"></progress>
                <div class="flex justify-between mt-1 text-xs text-base-content/50">
                    <span>{{ transferredCredits }} transferred + {{ plannedCredits }} planned</span>
                    <span>Target: {{ profile?.total_credit_required }}</span>
                </div>
            </div>
        </div>
      </div>

      <!-- Transferred Courses Section (Collapsible) -->
      <div v-if="allTransferredCourses.length > 0" class="card bg-success/5 border border-success/30 shadow-sm">
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
              <h3 class="font-medium text-success">
                Transferred Courses
              </h3>
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
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 opacity-60">
               <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0h18M5 21h14a2 2 0 0 0 2-2v-3.28m-16 5.28M5 21a2 2 0 0 1-2-2v-3.28m0 0h.008v.008H3V12" />
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
          @click="reSchedule"
        >
          <span v-if="reScheduleLoading" class="loading loading-spinner loading-xs"></span>
          🔄 Re-schedule Semester
        </button>
      </div>

      <!-- Accordion Semesters -->
      <div class="space-y-4">
        <div 
          v-for="sem in scheduledSemesters" 
          :key="sem.semester" 
          class="card bg-base-100 border border-base-200 shadow-sm transition-all duration-200" 
          :class="expandedSemesters.has(sem.semester) ? 'ring-2 ring-base-200 shadow-md' : 'hover:border-base-300'"
        >
           <!-- Header Trigger -->
           <div class="p-4 flex items-center justify-between cursor-pointer select-none" @click="toggleSemester(sem.semester)">
               <div class="flex items-center gap-3">
                   <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-primary/10 text-primary">
                       {{ sem.semester }}
                   </div>
                   <div>
                       <div class="font-bold">{{ formatSemester(sem.semester) }}</div>
                       <div class="text-xs text-base-content/60">{{ sem.courses.length }} courses</div>
                   </div>
               </div>

               <div class="flex items-center gap-4">
                   <div class="badge badge-lg variant-soft font-mono">{{ sem.total_credits }} Credits</div>
                   <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="w-5 h-5 transition-transform duration-200 text-base-content/40"
                      :class="expandedSemesters.has(sem.semester) ? 'rotate-180' : ''"
                   >
                      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                   </svg>
               </div>
           </div>

           <!-- Collapsible Content -->
           <div v-if="expandedSemesters.has(sem.semester)" class="border-t border-base-100">
               <div class="overflow-x-auto">
                 <table class="table table-sm">
                   <thead class="bg-base-100/50">
                     <tr>
                       <th class="w-32 pl-6">Code</th>
                       <th>Course Name</th>
                       <th class="text-right pr-6 w-24">Credits</th>
                     </tr>
                   </thead>
                   <tbody>
                     <tr v-for="course in sem.courses" :key="course.course_id" class="hover:bg-base-100/50 transition-colors">
                       <td class="pl-6">
                         <span class="font-mono text-sm font-semibold">{{ course.course_code }}</span>
                       </td>
                       <td>{{ course.course_name }}</td>
                       <td class="text-right pr-6 font-mono">{{ course.credit_hour }}</td>
                     </tr>
                   </tbody>
                   <tfoot>
                     <tr class="font-medium">
                       <td colspan="2" class="text-right">Total:</td>
                       <td class="text-right pr-6">{{ sem.total_credits }}</td>
                     </tr>
                   </tfoot>
                 </table>
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

    </template>
  </div>
</template>
