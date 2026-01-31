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
}

interface AcademicPlan {
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

// Group courses by semester
const coursesBySemester = computed(() => {
  if (!data.value?.courses) return {};

  const grouped: Record<number, any[]> = {};
  for (const course of data.value.courses) {
    if (!grouped[course.semester]) {
      grouped[course.semester] = [];
    }
    grouped[course.semester]!.push(course);
  }
  return grouped;
});

// Get semester numbers sorted
const semesters = computed(() => {
  return Object.keys(coursesBySemester.value)
    .map(Number)
    .sort((a, b) => a - b);
});

// Initialize all semesters as expanded
watchEffect(() => {
  if (semesters.value.length > 0 && expandedSemesters.value.size === 0) {
    semesters.value.forEach((s) => expandedSemesters.value.add(s));
  }
});

const toggleSemester = (semester: number) => {
  if (expandedSemesters.value.has(semester)) {
    expandedSemesters.value.delete(semester);
  } else {
    expandedSemesters.value.add(semester);
  }
};

const expandAll = () => {
  semesters.value.forEach((s) => expandedSemesters.value.add(s));
};

const collapseAll = () => {
  expandedSemesters.value.clear();
};

// Calculate total credits per semester
const semesterCredits = (semester: number) => {
  return (
    coursesBySemester.value[semester]?.reduce(
      (sum, c) => sum + c.credit_hour,
      0,
    ) || 0
  );
};

// Total credits in plan
const totalCredits = computed(() => {
  return (
    data.value?.courses?.reduce(
      (sum: number, c: any) => sum + c.credit_hour,
      0,
    ) || 0
  );
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
                    <span>{{ totalCredits }} credits planned/earned</span>
                    <span>Target: {{ profile?.total_credit_required }}</span>
                </div>
            </div>
        </div>
      </div>

      <!-- Semester Controls -->
      <div class="flex justify-between items-center mt-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 opacity-60">
               <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0h18M5 21h14a2 2 0 0 0 2-2v-3.28m-16 5.28M5 21a2 2 0 0 1-2-2v-3.28m0 0h.008v.008H3V12" />
            </svg>
            Course Schedule
        </h2>
        <div class="join shadow-sm border border-base-200 rounded-lg">
          <button class="btn btn-sm btn-ghost join-item" @click="expandAll">
             Expand All
          </button>
          <button class="btn btn-sm btn-ghost join-item" @click="collapseAll">
             Collapse All
          </button>
        </div>
      </div>

      <!-- Accordion Semesters -->
      <div class="space-y-4">
        <div v-for="semester in semesters" :key="semester" class="card bg-base-100 border border-base-200 shadow-sm transition-all duration-200" :class="expandedSemesters.has(semester) ? 'ring-2 ring-base-200 shadow-md' : 'hover:border-base-300'">
           <!-- Header Trigger -->
           <div class="p-4 flex items-center justify-between cursor-pointer select-none" @click="toggleSemester(semester)">
               <div class="flex items-center gap-3">
                   <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
                        :class="semester <= data.plan.start_semester ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/60'">
                       {{ semester }}
                   </div>
                   <div>
                       <div class="font-bold">Semester {{ semester }}</div>
                       <div class="text-xs text-base-content/60">{{ coursesBySemester[semester]?.length }} courses</div>
                   </div>
               </div>

               <div class="flex items-center gap-4">
                   <div class="badge badge-lg variant-soft font-mono">{{ semesterCredits(semester) }} Credits</div>
                   <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="w-5 h-5 transition-transform duration-200 text-base-content/40"
                      :class="expandedSemesters.has(semester) ? 'rotate-180' : ''"
                   >
                      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                   </svg>
               </div>
           </div>

           <!-- Collapsible Content -->
           <div v-if="expandedSemesters.has(semester)" class="border-t border-base-100">
               <div class="overflow-x-auto">
                 <table class="table table-sm">
                   <thead class="bg-base-100/50">
                     <tr>
                       <th class="w-32 pl-6">Code</th>
                       <th>Course Name</th>
                       <th class="text-center w-24">Credits</th>
                       <th class="text-right pr-6 w-32">Type</th>
                     </tr>
                   </thead>
                   <tbody>
                     <tr v-for="course in coursesBySemester[semester]" :key="course.course_id" class="hover:bg-base-100/50 transition-colors">
                       <td class="pl-6">
                         <span class="font-mono text-sm font-semibold">{{ course.course_code }}</span>
                       </td>
                       <td>{{ course.course_name }}</td>
                       <td class="text-center font-mono">{{ course.credit_hour }}</td>
                       <td class="text-right pr-6">
                           <span class="badge badge-sm badge-ghost text-xs">Core</span>
                       </td>
                     </tr>
                   </tbody>
                 </table>
               </div>
           </div>
        </div>
      </div>

    </template>
  </div>
</template>
