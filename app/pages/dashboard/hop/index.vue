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
</script>

<template>
  <div class="p-6 w-full space-y-8">
    <!-- Hero Section -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div class="space-y-1">
        <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
          HoP Dashboard
        </h1>
        <p class="text-base-content/60 font-medium">
          Overview of student intakes and academic tracking status.
        </p>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      <!-- Total Students -->
      <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group">
        <div class="card-body relative overflow-hidden">
          <div class="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
          
          <div class="flex items-center gap-4 z-10">
            <div class="p-3 bg-primary/10 text-primary rounded-xl group-hover:bg-primary group-hover:text-primary-content transition-colors duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">Total Students</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Pending Transfers -->
      <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group">
        <div class="card-body relative overflow-hidden">
          <div class="absolute -right-4 -top-4 w-24 h-24 bg-secondary/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
          
          <div class="flex items-center gap-4 z-10">
            <div class="p-3 bg-secondary/10 text-secondary rounded-xl group-hover:bg-secondary group-hover:text-secondary-content transition-colors duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">Pending Transfers</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Plans Generated -->
      <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group">
        <div class="card-body relative overflow-hidden">
          <div class="absolute -right-4 -top-4 w-24 h-24 bg-accent/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
          
          <div class="flex items-center gap-4 z-10">
            <div class="p-3 bg-accent/10 text-accent rounded-xl group-hover:bg-accent group-hover:text-accent-content transition-colors duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">Plans Generated</div>
            </div>
          </div>
        </div>
      </div>
      
    </div>

    <!-- Quick Actions -->
    <div>
      <h2 class="text-lg font-semibold mb-4">Quick Actions</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <NuxtLink to="/dashboard/hop/intake-assessment" class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer group">
          <div class="card-body p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-gradient-to-br from-blue-500/10 to-blue-600/10 text-blue-600 rounded-lg group-hover:from-blue-500 group-hover:to-blue-600 group-hover:text-white transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <h3 class="font-medium group-hover:text-primary transition-colors">Start Assessment</h3>
                <p class="text-xs text-base-content/60">Process new intake files</p>
              </div>
            </div>
          </div>
        </NuxtLink>

        <NuxtLink to="/dashboard/hop/academic-planning" class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer group">
          <div class="card-body p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-gradient-to-br from-purple-500/10 to-purple-600/10 text-purple-600 rounded-lg group-hover:from-purple-500 group-hover:to-purple-600 group-hover:text-white transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.57 50.57 0 0 0-5.266-2.475 12 12 0 0 1 5.266 2.475ZM21.74 10.147c.656-.346 1.341-.652 2.05-.965-1.558 3.553-3.766 6.885-6.333 9.497m0 0a17.896 17.896 0 0 1-8.914 0m0 0a17.869 17.869 0 0 1-6.333-9.497m15.247 0c-.655-.346-1.34-.652-2.049-.965m0 0a48.11 48.11 0 0 1 3.434-4.756 48.11 48.11 0 0 1-3.434 4.756" />
                </svg>
              </div>
              <div>
                <h3 class="font-medium group-hover:text-primary transition-colors">Academic Plans</h3>
                <p class="text-xs text-base-content/60">Review generated plans</p>
              </div>
            </div>
          </div>
        </NuxtLink>

        <NuxtLink to="/dashboard/hop/semester-rules" class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer group">
          <div class="card-body p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-gradient-to-br from-amber-500/10 to-amber-600/10 text-amber-600 rounded-lg group-hover:from-amber-500 group-hover:to-amber-600 group-hover:text-white transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                </svg>
              </div>
              <div>
                <h3 class="font-medium group-hover:text-primary transition-colors">Semester Rules</h3>
                <p class="text-xs text-base-content/60">Configure entry rules</p>
              </div>
            </div>
          </div>
        </NuxtLink>

        <NuxtLink to="/dashboard/hop/program-structure" class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer group">
          <div class="card-body p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 text-emerald-600 rounded-lg group-hover:from-emerald-500 group-hover:to-emerald-600 group-hover:text-white transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </div>
              <div>
                <h3 class="font-medium group-hover:text-primary transition-colors">Program Structure</h3>
                <p class="text-xs text-base-content/60">Manage curriculum</p>
              </div>
            </div>
          </div>
        </NuxtLink>

      </div>
    </div>
  </div>
</template>
