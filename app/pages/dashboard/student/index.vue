<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({ layout: "dashboard" });

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

// Types
interface AcademicPlan {
  status: "draft" | "approved" | "completed";
  start_semester: number;
}

interface PlanResponse {
  plan: AcademicPlan | null;
  courses: any[];
}

const { data: profile, pending } = await useFetch<any>("/api/student/profile");
const { data: academicPlan } = await useFetch<PlanResponse>("/api/student/academic-plan");

// Format intake (MMYY to readable)
const formatIntake = (mmyy: string) => {
  if (!mmyy || mmyy.length !== 4) return mmyy;
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
  const month = parseInt(mmyy.substring(0, 2), 10);
  const year = "20" + mmyy.substring(2, 4);
  return `${months[month - 1]} ${year}`;
};

// Calculate progress percentage
const creditProgress = computed(() => {
  if (!profile.value) return 0;
  return Math.round(
    (profile.value.total_credit_transferred /
      profile.value.total_credit_required) *
      100,
  );
});
</script>

<template>
  <!-- Loading Skeleton -->
  <div v-if="pending" class="space-y-8 animate-pulse">
    <div class="h-48 rounded-3xl bg-base-200/50"></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="h-32 rounded-2xl bg-base-200/50"></div>
      <div class="h-32 rounded-2xl bg-base-200/50"></div>
      <div class="h-32 rounded-2xl bg-base-200/50"></div>
    </div>
    <div class="h-64 rounded-2xl bg-base-200/50"></div>
  </div>

  <div v-else-if="profile" class="space-y-8">
    <!-- Hero Welcome -->
    <div class="relative overflow-hidden rounded-3xl bg-primary text-primary-content shadow-xl group">
      <!-- Background Patterns -->
      <div class="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.1)_50%,transparent_75%,transparent_100%)] bg-[length:250%_250%,100%_100%] bg-[position:0_0,0_0] transition-all duration-[3000ms] group-hover:bg-[position:100%_100%]"></div>
      
      <div class="relative z-10 flex flex-col lg:flex-row items-center gap-8 p-8 lg:p-12">
        <div class="avatar placeholder">
          <div class="w-24 h-24 rounded-full bg-white/20 text-white backdrop-blur-sm ring-4 ring-white/10 shadow-2xl">
            <span class="text-4xl font-bold">{{ profile.full_name?.charAt(0)?.toUpperCase() }}</span>
          </div>
        </div>
        
        <div class="text-center lg:text-left flex-1 min-w-0">
          <h1 class="text-3xl lg:text-4xl font-bold mb-2">Welcome back, {{ profile.full_name?.split(" ")[0] }}!</h1>
          <p class="text-primary-content/80 text-lg mb-4">
            {{ profile.program_code }} • {{ formatIntake(profile.intake_year) }} Intake
          </p>
          
          <div class="flex flex-wrap gap-3 justify-center lg:justify-start">
            <div class="badge badge-lg bg-white/20 border-0 text-white gap-2 backdrop-blur-md">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
              {{ profile.matric_no }}
            </div>
            <div class="badge badge-lg bg-white/10 border-white/20 text-white gap-2 backdrop-blur-md">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              {{ profile.email }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Starting Semester -->
      <div class="card bg-base-100/50 backdrop-blur shadow-xl border border-white/20 relative overflow-hidden group hover:border-primary/30 transition-all duration-300">
        <div class="absolute -right-6 -top-6 w-24 h-24 bg-primary/5 rounded-full group-hover:bg-primary/10 transition-colors"></div>
        <div class="card-body">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                     </svg>
                </div>
                <div>
                    <div class="text-3xl font-bold font-mono">{{ profile.starting_semester }}</div>
                    <div class="text-xs uppercase tracking-wider font-semibold opacity-60">Entry Semester</div>
                </div>
            </div>
        </div>
      </div>

       <!-- Credits Transferred -->
       <div class="card bg-base-100/50 backdrop-blur shadow-xl border border-white/20 relative overflow-hidden group hover:border-secondary/30 transition-all duration-300">
        <div class="absolute -right-6 -top-6 w-24 h-24 bg-secondary/5 rounded-full group-hover:bg-secondary/10 transition-colors"></div>
        <div class="card-body">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary group-hover:scale-110 transition-transform">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                     </svg>
                </div>
                <div>
                    <div class="text-3xl font-bold font-mono">{{ profile.total_credit_transferred }}</div>
                    <div class="text-xs uppercase tracking-wider font-semibold opacity-60">Transferred</div>
                </div>
            </div>
        </div>
      </div>

      <!-- Total Semesters -->
      <div class="card bg-base-100/50 backdrop-blur shadow-xl border border-white/20 relative overflow-hidden group hover:border-accent/30 transition-all duration-300">
        <div class="absolute -right-6 -top-6 w-24 h-24 bg-accent/5 rounded-full group-hover:bg-accent/10 transition-colors"></div>
        <div class="card-body">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                     </svg>
                </div>
                <div>
                    <div class="text-3xl font-bold font-mono">{{ profile.duration_semesters }}</div>
                    <div class="text-xs uppercase tracking-wider font-semibold opacity-60">Duration</div>
                </div>
            </div>
        </div>
      </div>
    </div>

    <!-- Main Content Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Profile Card -->
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body">
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
               <div class="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                   </svg>
               </div>
               <h2 class="card-title text-lg">Profile Summary</h2>
            </div>
             <NuxtLink to="/dashboard/profile" class="btn btn-ghost btn-sm btn-circle tooltip" data-tip="Edit Profile">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                   <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                 </svg>
             </NuxtLink>
          </div>

          <div class="grid gap-4">
             <div class="bg-base-200/50 p-4 rounded-xl flex items-center justify-between hover:bg-base-200 transition-colors">
                <span class="text-sm text-base-content/60">Full Name</span>
                <span class="font-medium text-right">{{ profile.full_name }}</span>
             </div>
              <div class="bg-base-200/50 p-4 rounded-xl flex items-center justify-between hover:bg-base-200 transition-colors">
                <span class="text-sm text-base-content/60">Program</span>
                <span class="font-medium text-right truncate max-w-[200px]" :title="profile.program_name">{{ profile.program_name }}</span>
             </div>
              <div class="bg-base-200/50 p-4 rounded-xl flex items-center justify-between hover:bg-base-200 transition-colors">
                <span class="text-sm text-base-content/60">Intake</span>
                <span class="font-medium text-right">{{ formatIntake(profile.intake_year) }}</span>
             </div>
          </div>
        </div>
      </div>

      <!-- Academic Plan Status -->
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body">
            <div class="flex items-center justify-between mb-6">
                <div class="flex items-center gap-3">
                   <div class="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center">
                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                       </svg>
                   </div>
                   <h2 class="card-title text-lg">Academic Plan</h2>
                </div>
                 <NuxtLink to="/dashboard/student/academic-plan" class="btn btn-primary btn-sm btn-outline gap-2">
                     <span>View Plan</span>
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                     </svg>
                 </NuxtLink>
            </div>

             <template v-if="academicPlan?.plan">
                <div class="grid grid-cols-2 gap-4">
                     <div class="bg-base-200/50 p-4 rounded-xl text-center hover:bg-base-200 transition-colors">
                        <div class="text-xs uppercase tracking-wide text-base-content/60 mb-1">Status</div>
                         <div :class="['badge badge-md capitalize font-bold',
                            academicPlan.plan.status === 'approved' ? 'badge-success' :
                            academicPlan.plan.status === 'completed' ? 'badge-info' : 'badge-warning']">
                            {{ academicPlan.plan.status }}
                        </div>
                     </div>
                     <div class="bg-base-200/50 p-4 rounded-xl text-center hover:bg-base-200 transition-colors">
                        <div class="text-xs uppercase tracking-wide text-base-content/60 mb-1">Start Sem</div>
                        <div class="text-xl font-bold font-mono">{{ academicPlan.plan.start_semester }}</div>
                     </div>
                </div>

                <div class="mt-6">
                    <div class="flex justify-between text-sm mb-2">
                        <span class="font-medium mb-1">Total Progress</span>
                        <span class="font-mono text-primary">{{ creditProgress }}%</span>
                    </div>
                    <progress class="progress progress-primary w-full h-3 bg-base-200" :value="profile.total_credit_transferred" :max="profile.total_credit_required"></progress>
                     <p class="text-xs text-center mt-2 text-base-content/50">
                        {{ profile.total_credit_transferred }} of {{ profile.total_credit_required }} credits obtained
                     </p>
                </div>
             </template>

            <template v-else>
               <div class="flex flex-col items-center justify-center h-full py-6 text-center">
                  <div class="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mb-4">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-base-content/40">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                     </svg>
                  </div>
                   <h3 class="font-bold">Pending Plan</h3>
                   <p class="text-sm text-base-content/60 mt-1 max-w-xs">Your academic plan is currently being assigned by the Head of Program.</p>
               </div>
            </template>
        </div>
      </div>
    </div>
  </div>
</template>
