<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({ layout: "dashboard" });

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const { data: profile, pending } = await useFetch("/api/student/profile");
const { data: academicPlan } = await useFetch("/api/student/academic-plan");

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
  <div v-if="pending" class="space-y-6">
    <div class="skeleton h-12 w-64"></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="skeleton h-32"></div>
      <div class="skeleton h-32"></div>
      <div class="skeleton h-32"></div>
    </div>
    <div class="skeleton h-48"></div>
  </div>

  <div v-else-if="profile" class="space-y-6">
    <!-- Hero Welcome -->
    <div
      class="hero bg-gradient-to-r from-primary/10 to-secondary/10 rounded-box p-6"
    >
      <div class="hero-content flex-col lg:flex-row gap-6 p-0 w-full">
        <div class="avatar placeholder">
          <div class="bg-primary text-primary-content w-20 rounded-full">
            <span class="text-3xl">{{
              profile.full_name?.charAt(0)?.toUpperCase()
            }}</span>
          </div>
        </div>
        <div class="text-center lg:text-left flex-1">
          <h1 class="text-3xl font-bold">
            Welcome back, {{ profile.full_name?.split(" ")[0] }}!
          </h1>
          <p class="text-base-content/70 mt-1">
            {{ profile.program_code }} •
            {{ formatIntake(profile.intake_year) }} Intake
          </p>
          <div
            class="flex flex-wrap gap-2 mt-3 justify-center lg:justify-start"
          >
            <div class="badge badge-primary badge-lg gap-1">
              🎓 {{ profile.matric_no }}
            </div>
            <div class="badge badge-ghost badge-lg gap-1">
              📧 {{ profile.email }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div
      class="stats stats-vertical lg:stats-horizontal shadow w-full bg-base-100"
    >
      <div class="stat">
        <div class="stat-figure text-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-8 w-8 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            ></path>
          </svg>
        </div>
        <div class="stat-title">Starting Semester</div>
        <div class="stat-value text-primary">
          {{ profile.starting_semester }}
        </div>
        <div class="stat-desc">Your entry point</div>
      </div>

      <div class="stat">
        <div class="stat-figure text-secondary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-8 w-8 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            ></path>
          </svg>
        </div>
        <div class="stat-title">Credits Transferred</div>
        <div class="stat-value text-secondary">
          {{ profile.total_credit_transferred }}
        </div>
        <div class="stat-desc">
          of {{ profile.total_credit_required }} required
        </div>
      </div>

      <div class="stat">
        <div class="stat-figure text-accent">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-8 w-8 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            ></path>
          </svg>
        </div>
        <div class="stat-title">Program Duration</div>
        <div class="stat-value text-accent">
          {{ profile.duration_semesters }}
        </div>
        <div class="stat-desc">semesters total</div>
      </div>
    </div>

    <!-- Cards Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Profile Card -->
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <div class="flex items-center gap-2">
            <span class="text-2xl">👤</span>
            <h2 class="card-title">Profile Summary</h2>
          </div>

          <div class="divider my-2"></div>

          <ul class="menu bg-base-200 rounded-box">
            <li>
              <div class="flex justify-between">
                <span class="text-base-content/60">Full Name</span>
                <span class="font-medium">{{ profile.full_name }}</span>
              </div>
            </li>
            <li>
              <div class="flex justify-between">
                <span class="text-base-content/60">Program</span>
                <span class="font-medium text-right">{{
                  profile.program_name
                }}</span>
              </div>
            </li>
            <li>
              <div class="flex justify-between">
                <span class="text-base-content/60">Intake</span>
                <span class="font-medium">{{
                  formatIntake(profile.intake_year)
                }}</span>
              </div>
            </li>
          </ul>

          <div class="card-actions justify-end mt-4">
            <NuxtLink
              to="/dashboard/profile"
              class="btn btn-outline btn-sm gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                />
              </svg>
              Edit Profile
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Academic Plan Card -->
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <div class="flex items-center gap-2">
            <span class="text-2xl">📚</span>
            <h2 class="card-title">Academic Plan</h2>
          </div>

          <div class="divider my-2"></div>

          <template v-if="academicPlan?.plan">
            <div class="flex flex-col gap-4">
              <div class="flex items-center justify-between">
                <span class="text-base-content/60">Status</span>
                <div
                  :class="[
                    'badge badge-lg',
                    academicPlan.plan.status === 'approved'
                      ? 'badge-success'
                      : academicPlan.plan.status === 'completed'
                        ? 'badge-info'
                        : 'badge-warning',
                  ]"
                >
                  {{ academicPlan.plan.status }}
                </div>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-base-content/60">Starting From</span>
                <span class="font-semibold"
                  >Semester {{ academicPlan.plan.start_semester }}</span
                >
              </div>

              <div class="flex items-center justify-between">
                <span class="text-base-content/60">Total Courses</span>
                <span class="font-semibold"
                  >{{ academicPlan.courses?.length || 0 }} courses</span
                >
              </div>
            </div>

            <div class="card-actions justify-end mt-4">
              <NuxtLink
                to="/dashboard/student/academic-plan"
                class="btn btn-primary btn-sm gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
                View Full Plan
              </NuxtLink>
            </div>
          </template>

          <template v-else>
            <div class="flex flex-col items-center justify-center py-6">
              <div class="text-6xl mb-4">📋</div>
              <div class="alert alert-info">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  class="h-6 w-6 shrink-0 stroke-current"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  ></path>
                </svg>
                <span>Your academic plan is being prepared by your HOP</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Credit Progress -->
    <div
      class="card bg-base-100 shadow-xl"
      v-if="profile.total_credit_transferred > 0"
    >
      <div class="card-body">
        <h2 class="card-title gap-2">
          <span class="text-2xl">📊</span>
          Credit Transfer Progress
        </h2>
        <div class="w-full">
          <div class="flex justify-between mb-2">
            <span class="text-sm text-base-content/60"
              >{{ profile.total_credit_transferred }} of
              {{ profile.total_credit_required }} credits</span
            >
            <span class="text-sm font-medium">{{ creditProgress }}%</span>
          </div>
          <progress
            class="progress progress-primary w-full h-4"
            :value="profile.total_credit_transferred"
            :max="profile.total_credit_required"
          ></progress>
        </div>
      </div>
    </div>
  </div>
</template>
