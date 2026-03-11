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

// Notification types
interface Notification {
  id: number;
  plan_id: number;
  action: string;
  notes: string;
  is_read: boolean;
  created_at: string;
  matric_no: string;
  student_name: string;
  plan_status: string;
}

interface NotificationResponse {
  notifications: Notification[];
  unread_count: number;
}

// Fetch notifications
const { data: notificationData, refresh: refreshNotifications } =
  await useFetch<NotificationResponse>("/api/hop/notifications");

// Mark all as read
const markAllRead = async () => {
  try {
    await $fetch("/api/hop/notifications", {
      method: "PATCH",
      body: { mark_all: true },
    });
    await refreshNotifications();
  } catch (error) {
    console.error("Failed to mark as read", error);
  }
};

// Navigate to student plan
const goToStudentPlan = async (planId: number, notificationId: number) => {
  // Mark this notification as read
  try {
    await $fetch("/api/hop/notifications", {
      method: "PATCH",
      body: { notification_ids: [notificationId] },
    });
  } catch (error) {
    console.error("Failed to mark as read", error);
  }
  navigateTo(`/dashboard/hop/academic-planning/student/${planId}`);
};

// Format time ago
const timeAgo = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// Current Session
interface CurrentSessionData {
  active_intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data: currentSessionData, refresh: refreshCurrentSession } =
  await useFetch<{ current_session: CurrentSessionData | null }>(
    "/api/hop/current-session",
  );

const sessionForm = reactive({
  active_intake_period: "",
  semester_type: "L" as "L" | "S",
});

// Pre-fill form whenever the fetched session changes
watchEffect(() => {
  const cs = currentSessionData.value?.current_session;
  if (cs) {
    sessionForm.active_intake_period = cs.active_intake_period;
    sessionForm.semester_type = cs.semester_type;
  }
});

const sessionSaving = ref(false);
const sessionSaved = ref(false);

const saveCurrentSession = async () => {
  sessionSaving.value = true;
  sessionSaved.value = false;
  try {
    await $fetch("/api/hop/current-session", {
      method: "PUT",
      body: {
        active_intake_period: sessionForm.active_intake_period,
        semester_type: sessionForm.semester_type,
      },
    });
    await refreshCurrentSession();
    // Notify CurrentSessionBadge to refresh
    const sessionUpdated = useState<number>("currentSessionUpdated", () => 0);
    sessionUpdated.value++;
    sessionSaved.value = true;
    setTimeout(() => {
      sessionSaved.value = false;
    }, 3000);
  } catch (error: any) {
    alert(error?.data?.statusMessage || "Failed to update session");
  } finally {
    sessionSaving.value = false;
  }
};

// Per-intake current semester management
interface IntakeData {
  id: number;
  intake_year: string;
  intake_name: string;
  current_semester: number;
  status: string;
}

const { data: intakesData, refresh: refreshIntakes } = await useFetch<
  IntakeData[]
>("/api/hop/academic-planning");

// Editable state per intake row
const intakeEdits = reactive<Record<number, number>>({});
const intakeSaving = reactive<Record<number, boolean>>({});

// Format MMYY → "Mon 'YY"
const formatIntake = (mmyy: string) => {
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
  const mm = parseInt(mmyy.substring(0, 2), 10);
  const yy = mmyy.substring(2);
  return `${months[mm - 1] ?? "?"} '${yy}`;
};

const saveIntakeSemester = async (intake: IntakeData) => {
  const sem = intakeEdits[intake.id] ?? intake.current_semester;
  intakeSaving[intake.id] = true;
  try {
    await $fetch(`/api/hop/academic-planning/${intake.id}`, {
      method: "PATCH",
      body: { current_semester: sem },
    });
    await refreshIntakes();
  } catch (error: any) {
    alert(error?.data?.statusMessage || "Failed to update intake semester");
  } finally {
    intakeSaving[intake.id] = false;
  }
};
</script>

<template>
  <div class="p-6 w-full space-y-8">
    <!-- Hero Section -->
    <div
      class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
    >
      <div class="space-y-1">
        <h1
          class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary"
        >
          HoP Dashboard
        </h1>
        <p class="text-base-content/60 font-medium">
          Overview of student intakes and academic tracking status.
        </p>
      </div>
    </div>

    <!-- Notifications Section -->
    <div
      v-if="notificationData && notificationData.unread_count > 0"
      class="card bg-warning/10 border border-warning/30 shadow-sm"
    >
      <div class="card-body p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="indicator">
              <span class="indicator-item badge badge-warning badge-sm">{{
                notificationData.unread_count
              }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-6 h-6 text-warning"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
            </div>
            <h3 class="font-semibold text-warning">
              Plans Needing Re-Approval
            </h3>
          </div>
          <button class="btn btn-ghost btn-xs" @click="markAllRead">
            Mark all read
          </button>
        </div>

        <div class="space-y-2">
          <div
            v-for="notification in notificationData.notifications.slice(0, 5)"
            :key="notification.id"
            class="flex items-center justify-between p-3 bg-base-100 rounded-lg border border-base-200 hover:border-warning/50 cursor-pointer transition-colors"
            @click="goToStudentPlan(notification.plan_id, notification.id)"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-8 h-8 bg-warning/20 rounded-full flex items-center justify-center"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-4 h-4 text-warning"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </div>
              <div>
                <div class="font-medium text-sm">
                  {{ notification.student_name }}
                </div>
                <div class="text-xs text-base-content/60">
                  {{ notification.matric_no }} requested to re-schedule
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-warning badge-sm">Needs Review</span>
              <span class="text-xs text-base-content/50">{{
                timeAgo(notification.created_at)
              }}</span>
            </div>
          </div>
        </div>

        <div v-if="notificationData.unread_count > 5" class="text-center mt-2">
          <NuxtLink
            to="/dashboard/hop/academic-planning"
            class="text-sm text-warning hover:underline"
          >
            View all {{ notificationData.unread_count }} pending requests →
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Current Session Setting -->
    <div
      id="session-config"
      class="card bg-base-100 border border-base-200 shadow-sm scroll-mt-24"
    >
      <div class="card-body p-5">
        <div class="flex items-center gap-3 mb-4">
          <div class="p-2 bg-primary/10 text-primary rounded-lg">
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
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
              />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold">Current Academic Session</h2>
            <p class="text-xs text-base-content/60">
              Set the active session displayed across the system
            </p>
          </div>
          <div v-if="sessionSaved" class="ml-auto badge badge-success gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2"
              stroke="currentColor"
              class="w-3 h-3"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
            Saved
          </div>
        </div>
        <div class="flex flex-col sm:flex-row items-end gap-3">
          <div class="form-control w-full sm:w-auto">
            <label class="label">
              <span class="label-text text-xs font-medium"
                >Current Session (MMYY)</span
              >
            </label>
            <input
              v-model="sessionForm.active_intake_period"
              type="text"
              placeholder="e.g. 0525"
              maxlength="4"
              class="input input-bordered input-sm w-full sm:w-36"
            />
          </div>
          <div class="form-control w-full sm:w-auto">
            <label class="label">
              <span class="label-text text-xs font-medium">Semester Type</span>
            </label>
            <select
              v-model="sessionForm.semester_type"
              class="select select-bordered select-sm w-full sm:w-44"
            >
              <option value="L">Long Semester</option>
              <option value="S">Short Semester</option>
            </select>
          </div>
          <button
            class="btn btn-primary btn-sm"
            :class="{ loading: sessionSaving }"
            :disabled="sessionSaving || !sessionForm.active_intake_period"
            @click="saveCurrentSession"
          >
            {{ sessionSaving ? "Saving..." : "Set Global" }}
          </button>
        </div>
        <!-- Current value display -->
        <div
          v-if="currentSessionData?.current_session"
          class="mt-3 flex items-center gap-2 text-xs text-base-content/60"
        >
          <span>Currently:</span>
          <span class="badge badge-sm badge-primary badge-outline font-mono">
            {{
              formatIntake(
                currentSessionData.current_session.active_intake_period,
              )
            }}
          </span>
          <span class="badge badge-sm badge-outline">
            {{
              currentSessionData.current_session.semester_type === "L"
                ? "Long"
                : "Short"
            }}
            Semester
          </span>
          <span class="text-base-content/40">
            — updated
            {{ timeAgo(currentSessionData.current_session.updated_at) }}
          </span>
        </div>

        <!-- Per-Intake Current Semester -->
        <div
          v-if="intakesData?.length"
          class="mt-5 border-t border-base-200 pt-4"
        >
          <p class="text-xs font-medium text-base-content/60 mb-2">
            Per-Intake Semester
          </p>
          <div class="overflow-x-auto">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Intake</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Current Sem</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="intake in intakesData" :key="intake.id">
                  <td class="font-mono font-medium">
                    {{ formatIntake(intake.intake_year) }}
                  </td>
                  <td>{{ intake.intake_name }}</td>
                  <td>
                    <span class="badge badge-sm badge-outline">
                      {{ intake.status }}
                    </span>
                  </td>
                  <td>
                    <input
                      :value="intakeEdits[intake.id] ?? intake.current_semester"
                      type="number"
                      min="1"
                      class="input input-bordered input-xs w-16"
                      @input="
                        intakeEdits[intake.id] = Number(
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                  </td>
                  <td>
                    <button
                      class="btn btn-xs btn-ghost btn-primary"
                      :disabled="intakeSaving[intake.id]"
                      @click="saveIntakeSemester(intake)"
                    >
                      {{ intakeSaving[intake.id] ? "..." : "Set" }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Total Students -->
      <div
        class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group"
      >
        <div class="card-body relative overflow-hidden">
          <div
            class="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full group-hover:scale-150 transition-transform duration-500"
          ></div>

          <div class="flex items-center gap-4 z-10">
            <div
              class="p-3 bg-primary/10 text-primary rounded-xl group-hover:bg-primary group-hover:text-primary-content transition-colors duration-300"
            >
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
                  d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                />
              </svg>
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">
                Total Students
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pending Transfers -->
      <div
        class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group"
      >
        <div class="card-body relative overflow-hidden">
          <div
            class="absolute -right-4 -top-4 w-24 h-24 bg-secondary/10 rounded-full group-hover:scale-150 transition-transform duration-500"
          ></div>

          <div class="flex items-center gap-4 z-10">
            <div
              class="p-3 bg-secondary/10 text-secondary rounded-xl group-hover:bg-secondary group-hover:text-secondary-content transition-colors duration-300"
            >
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
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">
                Pending Transfers
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Plans Generated -->
      <div
        class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-all duration-300 group"
      >
        <div class="card-body relative overflow-hidden">
          <div
            class="absolute -right-4 -top-4 w-24 h-24 bg-accent/10 rounded-full group-hover:scale-150 transition-transform duration-500"
          ></div>

          <div class="flex items-center gap-4 z-10">
            <div
              class="p-3 bg-accent/10 text-accent rounded-xl group-hover:bg-accent group-hover:text-accent-content transition-colors duration-300"
            >
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
            </div>
            <div>
              <div class="text-3xl font-bold tabular-nums">—</div>
              <div class="text-sm font-medium text-base-content/60">
                Plans Generated
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- System Workflow -->
    <div>
      <h2 class="text-lg font-semibold mb-1">System Workflow</h2>
      <p class="text-sm text-base-content/60 mb-4">
        Follow these steps in order to set up and manage your academic tracking
        system.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <!-- Step 1: Semester Rules -->
        <div
          class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-all duration-300 relative"
        >
          <div class="card-body p-4 gap-3">
            <div class="flex items-center gap-2">
              <span class="badge badge-primary badge-sm font-bold">1</span>
              <span class="badge badge-ghost badge-xs">One-time Setup</span>
            </div>
            <div>
              <h3 class="font-semibold text-sm">Semester Rules</h3>
              <p class="text-xs text-base-content/60 mt-1">
                Define credit transfer rules for entry semester placement
              </p>
            </div>
            <NuxtLink
              to="/dashboard/hop/semester-rules"
              class="btn btn-primary btn-sm btn-block mt-auto"
            >
              Go <span class="ml-1">&rarr;</span>
            </NuxtLink>
          </div>
        </div>

        <!-- Step 2: Program Structure -->
        <div
          class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-all duration-300 relative"
        >
          <div class="card-body p-4 gap-3">
            <div class="flex items-center gap-2">
              <span class="badge badge-primary badge-sm font-bold">2</span>
              <span class="badge badge-ghost badge-xs">One-time Setup</span>
            </div>
            <div>
              <h3 class="font-semibold text-sm">Program Structure</h3>
              <p class="text-xs text-base-content/60 mt-1">
                Create sessions and assign courses per semester
              </p>
            </div>
            <NuxtLink
              to="/dashboard/hop/program-structure"
              class="btn btn-primary btn-sm btn-block mt-auto"
            >
              Go <span class="ml-1">&rarr;</span>
            </NuxtLink>
          </div>
        </div>

        <!-- Step 3: Set Current Session -->
        <div
          class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-all duration-300 relative"
        >
          <div class="card-body p-4 gap-3">
            <div class="flex items-center gap-2">
              <span class="badge badge-primary badge-sm font-bold">3</span>
              <span class="badge badge-ghost badge-xs">Per Cohort</span>
            </div>
            <div>
              <h3 class="font-semibold text-sm">Set Current Session</h3>
              <p class="text-xs text-base-content/60 mt-1">
                Activate the current intake period and semester type
              </p>
            </div>
            <a
              href="#session-config"
              class="btn btn-secondary btn-sm btn-block mt-auto"
            >
              Configure below <span class="ml-1">&darr;</span>
            </a>
          </div>
        </div>

        <!-- Step 4: Intake Assessment -->
        <div
          class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-all duration-300 relative"
        >
          <div class="card-body p-4 gap-3">
            <div class="flex items-center gap-2">
              <span class="badge badge-primary badge-sm font-bold">4</span>
              <span class="badge badge-ghost badge-xs">Per Cohort</span>
            </div>
            <div>
              <h3 class="font-semibold text-sm">Intake Assessment</h3>
              <p class="text-xs text-base-content/60 mt-1">
                Upload student data and process credit transfers
              </p>
            </div>
            <NuxtLink
              to="/dashboard/hop/intake-assessment"
              class="btn btn-primary btn-sm btn-block mt-auto"
            >
              Go <span class="ml-1">&rarr;</span>
            </NuxtLink>
          </div>
        </div>

        <!-- Step 5: Academic Planning -->
        <div
          class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-all duration-300 relative"
        >
          <div class="card-body p-4 gap-3">
            <div class="flex items-center gap-2">
              <span class="badge badge-primary badge-sm font-bold">5</span>
              <span class="badge badge-ghost badge-xs">Per Cohort</span>
            </div>
            <div>
              <h3 class="font-semibold text-sm">Academic Planning</h3>
              <p class="text-xs text-base-content/60 mt-1">
                Generate and approve student academic plans
              </p>
            </div>
            <NuxtLink
              to="/dashboard/hop/academic-planning"
              class="btn btn-primary btn-sm btn-block mt-auto"
            >
              Go <span class="ml-1">&rarr;</span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
