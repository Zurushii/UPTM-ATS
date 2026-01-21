<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({ layout: "dashboard" });

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const { data, pending } = await useFetch("/api/student/academic-plan");
const { data: profile } = await useFetch("/api/student/profile");

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
    grouped[course.semester].push(course);
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

  <div v-else>
    <!-- Header -->
    <div
      class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6"
    >
      <div>
        <div class="flex items-center gap-3">
          <span class="text-3xl">📚</span>
          <div>
            <h1 class="text-2xl font-bold">My Academic Plan</h1>
            <p class="text-base-content/60 flex items-center gap-2">
              <span class="badge badge-primary badge-sm">{{
                profile?.program_code
              }}</span>
              {{ profile?.program_name }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- No Plan Yet -->
    <div v-if="!data?.plan" class="hero bg-base-200 rounded-box min-h-[400px]">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <div class="text-8xl mb-6">📋</div>
          <h2 class="text-2xl font-bold">No Academic Plan Yet</h2>
          <p class="py-6 text-base-content/70">
            Your academic plan is being prepared by your Head of Program. Please
            check back later or contact your HOP for updates.
          </p>
          <div class="flex justify-center gap-2">
            <NuxtLink to="/dashboard/student" class="btn btn-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-5 h-5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                />
              </svg>
              Back to Dashboard
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Has Plan -->
    <template v-else>
      <!-- Stats Overview -->
      <div
        class="stats stats-vertical lg:stats-horizontal shadow w-full bg-base-100 mb-6"
      >
        <div class="stat">
          <div class="stat-figure">
            <div :class="['badge badge-lg gap-1', statusInfo.color]">
              {{ statusInfo.icon }} {{ statusInfo.text }}
            </div>
          </div>
          <div class="stat-title">Plan Status</div>
          <div class="stat-value text-lg">{{ data.plan.status }}</div>
          <div class="stat-desc">Academic plan review</div>
        </div>

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
            {{ data.plan.start_semester }}
          </div>
          <div class="stat-desc">Entry point</div>
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
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              ></path>
            </svg>
          </div>
          <div class="stat-title">Total Semesters</div>
          <div class="stat-value text-secondary">{{ semesters.length }}</div>
          <div class="stat-desc">In your plan</div>
        </div>

        <div class="stat">
          <div class="stat-figure text-accent">
            <div
              class="radial-progress text-accent"
              :style="`--value:${creditProgress}; --size:3.5rem; --thickness:4px;`"
              role="progressbar"
            >
              {{ creditProgress }}%
            </div>
          </div>
          <div class="stat-title">Total Credits</div>
          <div class="stat-value text-accent">{{ totalCredits }}</div>
          <div class="stat-desc">
            of {{ profile?.total_credit_required }} required
          </div>
        </div>
      </div>

      <!-- Progress Bar -->
      <div class="card bg-base-100 shadow mb-6">
        <div class="card-body py-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">Credit Progress</span>
            <span class="text-sm text-base-content/60"
              >{{ totalCredits }} /
              {{ profile?.total_credit_required }} credits</span
            >
          </div>
          <progress
            class="progress progress-accent w-full h-3"
            :value="totalCredits"
            :max="profile?.total_credit_required"
          ></progress>
        </div>
      </div>

      <!-- Semester Controls -->
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold">Course Schedule</h2>
        <div class="join">
          <button class="btn btn-sm btn-ghost join-item" @click="expandAll">
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
                d="m4.5 5.25 7.5 7.5 7.5-7.5m-15 6 7.5 7.5 7.5-7.5"
              />
            </svg>
            Expand All
          </button>
          <button class="btn btn-sm btn-ghost join-item" @click="collapseAll">
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
                d="m4.5 18.75 7.5-7.5 7.5 7.5m-15-6 7.5-7.5 7.5 7.5"
              />
            </svg>
            Collapse All
          </button>
        </div>
      </div>

      <!-- Timeline Semesters -->
      <ul
        class="timeline timeline-snap-icon max-md:timeline-compact timeline-vertical"
      >
        <li v-for="(semester, index) in semesters" :key="semester">
          <div class="timeline-middle">
            <div
              :class="[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                semester <= data.plan.start_semester
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-300',
              ]"
            >
              {{ semester }}
            </div>
          </div>

          <div
            :class="[
              'timeline-box shadow-lg mb-6 w-full',
              index % 2 === 0 ? 'timeline-start md:text-end' : 'timeline-end',
            ]"
          >
            <!-- Semester Header -->
            <button
              class="w-full text-left md:text-inherit"
              @click="toggleSemester(semester)"
            >
              <div class="flex items-center justify-between gap-4 flex-wrap">
                <div class="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                    stroke="currentColor"
                    :class="[
                      'w-4 h-4 transition-transform',
                      expandedSemesters.has(semester) ? 'rotate-90' : '',
                    ]"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    />
                  </svg>
                  <span class="font-bold text-lg">Semester {{ semester }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="badge badge-ghost"
                    >{{ coursesBySemester[semester]?.length }} courses</span
                  >
                  <span class="badge badge-primary"
                    >{{ semesterCredits(semester) }} cr</span
                  >
                </div>
              </div>
            </button>

            <!-- Courses Table (Collapsible) -->
            <div v-show="expandedSemesters.has(semester)" class="mt-4">
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr class="bg-base-200">
                      <th class="rounded-tl-lg">Code</th>
                      <th>Course Name</th>
                      <th class="text-center rounded-tr-lg">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(course, cIndex) in coursesBySemester[semester]"
                      :key="course.course_id"
                      class="hover"
                    >
                      <td>
                        <span class="font-mono text-sm badge badge-outline">{{
                          course.course_code
                        }}</span>
                      </td>
                      <td>{{ course.course_name }}</td>
                      <td class="text-center">
                        <span class="badge badge-sm">{{
                          course.credit_hour
                        }}</span>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr class="bg-base-200">
                      <td colspan="2" class="font-semibold rounded-bl-lg">
                        Semester Total
                      </td>
                      <td class="text-center font-bold rounded-br-lg">
                        {{ semesterCredits(semester) }}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <hr v-if="index < semesters.length - 1" />
        </li>
      </ul>

      <!-- Summary Card -->
      <div
        class="card bg-gradient-to-r from-primary/10 to-secondary/10 shadow-xl mt-6"
      >
        <div class="card-body">
          <h3 class="card-title">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            Plan Summary
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
            <div class="text-center p-3 bg-base-100 rounded-box">
              <div class="text-2xl font-bold text-primary">
                {{ semesters.length }}
              </div>
              <div class="text-xs text-base-content/60">Semesters</div>
            </div>
            <div class="text-center p-3 bg-base-100 rounded-box">
              <div class="text-2xl font-bold text-secondary">
                {{ data.courses?.length || 0 }}
              </div>
              <div class="text-xs text-base-content/60">Courses</div>
            </div>
            <div class="text-center p-3 bg-base-100 rounded-box">
              <div class="text-2xl font-bold text-accent">
                {{ totalCredits }}
              </div>
              <div class="text-xs text-base-content/60">Total Credits</div>
            </div>
            <div class="text-center p-3 bg-base-100 rounded-box">
              <div class="text-2xl font-bold">
                {{ profile?.total_credit_required - totalCredits }}
              </div>
              <div class="text-xs text-base-content/60">Remaining</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
