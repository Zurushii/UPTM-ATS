<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";

definePageMeta({ layout: "dashboard" });

// Session check - redirect if not authenticated
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const user = useState<any>("user");
const isStudent = computed(() => user.value?.role === "STUDENT");

// Student profile data (only fetch if student)
const {
  data: studentProfile,
  refresh: refreshStudentProfile,
  pending,
} = await useFetch("/api/student/profile", {
  immediate: isStudent.value,
});

// State
const editing = ref(false);
const saving = ref(false);
const error = ref("");
const success = ref(false);
const fullName = ref("");

// Sessions
const sessions = ref<any[]>([]);
const sessionsLoading = ref(false);
const sessionsError = ref("");
const currentSessionToken = ref<string | null>(null);

// Password change
const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});
const passwordSaving = ref(false);
const passwordError = ref("");
const passwordSuccess = ref(false);
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

// Computed display name
const displayName = computed(() => {
  if (isStudent.value && studentProfile.value) {
    return studentProfile.value.full_name;
  }
  return user.value?.name || "User";
});

const displayEmail = computed(() => {
  if (isStudent.value && studentProfile.value) {
    return studentProfile.value.email;
  }
  return user.value?.email || "";
});

const startEdit = () => {
  fullName.value = displayName.value || "";
  editing.value = true;
  error.value = "";
  success.value = false;
};

const cancelEdit = () => {
  editing.value = false;
  error.value = "";
};

const saveProfile = async () => {
  if (fullName.value.trim().length < 2) {
    error.value = "Name must be at least 2 characters";
    return;
  }

  saving.value = true;
  error.value = "";

  try {
    if (isStudent.value) {
      // Student: update via student profile API
      await $fetch("/api/student/profile", {
        method: "PUT",
        body: { full_name: fullName.value.trim() },
      });
      await refreshStudentProfile();
    } else {
      // HOP: update via Better Auth
      await authClient.updateUser({ name: fullName.value.trim() });
      user.value = { ...user.value, name: fullName.value.trim() };
    }
    editing.value = false;
    success.value = true;
    setTimeout(() => (success.value = false), 3000);
  } catch (e: any) {
    error.value =
      e.data?.statusMessage || e.message || "Failed to update profile";
  } finally {
    saving.value = false;
  }
};

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

// Sessions management
const loadSessions = async () => {
  sessionsLoading.value = true;
  sessionsError.value = "";
  try {
    const result = await authClient.listSessions();
    sessions.value = Array.isArray(result)
      ? result
      : ((result as any)?.data ?? []);

    // Get current session token
    const currentSession = await authClient.getSession();
    currentSessionToken.value =
      (currentSession as any)?.data?.session?.token || null;
  } catch (e: any) {
    sessionsError.value = "Unable to load sessions";
  } finally {
    sessionsLoading.value = false;
  }
};

const revokeSession = async (token: string) => {
  try {
    // Check if revoking current session
    const isCurrentSession = token === currentSessionToken.value;

    await authClient.revokeSession({ token });

    if (isCurrentSession) {
      // If we revoked our own session, redirect to sign-in
      await navigateTo("/sign-in");
      return;
    }

    await loadSessions();
  } catch (e: any) {
    sessionsError.value = "Failed to revoke session";
  }
};

const revokeOtherSessions = async () => {
  try {
    await authClient.revokeOtherSessions();
    await loadSessions();
  } catch (e: any) {
    sessionsError.value = "Failed to revoke other sessions";
  }
};

// Sign out
const signOut = async () => {
  await authClient.signOut();
  navigateTo("/sign-in");
};

// Change password
const changePassword = async () => {
  passwordError.value = "";
  passwordSuccess.value = false;

  // Validation
  if (passwordForm.newPassword.length < 8) {
    passwordError.value = "New password must be at least 8 characters";
    return;
  }

  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordError.value = "Passwords do not match";
    return;
  }

  passwordSaving.value = true;

  try {
    await authClient.changePassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
      revokeOtherSessions: true,
    });

    // Reset form
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
    passwordSuccess.value = true;
    setTimeout(() => (passwordSuccess.value = false), 3000);

    // Refresh sessions list
    await loadSessions();
  } catch (e: any) {
    passwordError.value =
      e.message || e.data?.message || "Failed to change password";
  } finally {
    passwordSaving.value = false;
  }
};

onMounted(() => {
  loadSessions();
});
</script>

<template>
  <!-- Loading Skeleton -->
  <div v-if="pending && isStudent" class="max-w-3xl space-y-6">
    <div class="skeleton h-10 w-48"></div>
    <div class="skeleton h-64"></div>
    <div class="skeleton h-64"></div>
  </div>

  <div v-else class="max-w-3xl space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <div class="avatar placeholder">
        <div class="bg-neutral text-neutral-content w-16 rounded-full">
          <span class="text-2xl">{{
            displayName?.charAt(0)?.toUpperCase() || "?"
          }}</span>
        </div>
      </div>
      <div>
        <h1 class="text-2xl font-bold">My Profile</h1>
        <p class="text-base-content/60">
          Manage your personal information and security
        </p>
      </div>
    </div>

    <!-- Alerts -->
    <div v-if="error" class="alert alert-error">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{{ error }}</span>
    </div>

    <div v-if="success" class="alert alert-success">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>Profile updated successfully!</span>
    </div>

    <!-- Personal Info Card -->
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="flex items-center justify-between">
          <h2 class="card-title gap-2">
            <span>👤</span>
            Personal Information
          </h2>
          <button
            v-if="!editing"
            class="btn btn-sm btn-ghost gap-1"
            @click="startEdit"
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
            Edit
          </button>
        </div>

        <div class="divider my-2"></div>

        <!-- Full Name -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Full Name</legend>
          <template v-if="editing">
            <div class="join w-full">
              <input
                v-model="fullName"
                type="text"
                class="input input-bordered join-item flex-1"
                placeholder="Enter your full name"
                @keyup.enter="saveProfile"
              />
              <button
                class="btn btn-primary join-item"
                :disabled="saving"
                @click="saveProfile"
              >
                <span
                  v-if="saving"
                  class="loading loading-spinner loading-sm"
                ></span>
                <span v-else>Save</span>
              </button>
              <button
                class="btn btn-ghost join-item"
                :disabled="saving"
                @click="cancelEdit"
              >
                Cancel
              </button>
            </div>
            <p class="label text-xs text-base-content/50">
              Press Enter to save
            </p>
          </template>
          <template v-else>
            <div class="input input-bordered flex items-center bg-base-200/50">
              {{ displayName }}
            </div>
          </template>
        </fieldset>

        <!-- Email -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend flex items-center gap-1">
            Email
            <div class="tooltip" data-tip="Managed by your account">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4 text-base-content/40"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              </svg>
            </div>
          </legend>
          <div
            class="input input-bordered flex items-center bg-base-200/50 gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-4 h-4 text-base-content/50"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
            {{ displayEmail }}
          </div>
        </fieldset>

        <!-- Role Badge -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Account Role</legend>
          <div class="flex items-center gap-2">
            <span
              :class="[
                'badge badge-lg',
                user?.role === 'HOP' ? 'badge-primary' : 'badge-secondary',
              ]"
            >
              {{ user?.role === "HOP" ? "👨‍🏫 Head of Program" : "🎓 Student" }}
            </span>
          </div>
        </fieldset>
      </div>
    </div>

    <!-- Academic Info Card (Student Only) -->
    <div v-if="isStudent && studentProfile" class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title gap-2">
          <span>🎓</span>
          Academic Information
        </h2>

        <div class="divider my-2"></div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Matric Number</legend>
            <div
              class="input input-bordered flex items-center bg-base-200/50 font-mono"
            >
              {{ studentProfile.matric_no }}
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Intake</legend>
            <div class="input input-bordered flex items-center bg-base-200/50">
              <span class="badge badge-ghost badge-sm mr-2">{{
                studentProfile.intake_year
              }}</span>
              {{ formatIntake(studentProfile.intake_year) }}
            </div>
          </fieldset>

          <fieldset class="fieldset md:col-span-2">
            <legend class="fieldset-legend">Program</legend>
            <div
              class="input input-bordered flex items-center bg-base-200/50 gap-2"
            >
              <span class="badge badge-primary">{{
                studentProfile.program_code
              }}</span>
              {{ studentProfile.program_name }}
            </div>
          </fieldset>
        </div>
      </div>
    </div>

    <!-- Academic Progress Card (Student Only) -->
    <div v-if="isStudent && studentProfile" class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title gap-2">
          <span>📊</span>
          Academic Progress
        </h2>

        <div class="divider my-2"></div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div
            class="flex flex-col items-center p-4 bg-base-200/50 rounded-box"
          >
            <div
              class="radial-progress text-primary"
              :style="`--value:${(studentProfile.starting_semester / studentProfile.duration_semesters) * 100}; --size:5rem;`"
              role="progressbar"
            >
              {{ studentProfile.starting_semester }}
            </div>
            <span class="text-sm text-base-content/60 mt-2"
              >Starting Semester</span
            >
          </div>

          <div
            class="flex flex-col items-center p-4 bg-base-200/50 rounded-box"
          >
            <div
              class="radial-progress text-secondary"
              :style="`--value:${(studentProfile.total_credit_transferred / studentProfile.total_credit_required) * 100}; --size:5rem;`"
              role="progressbar"
            >
              {{ studentProfile.total_credit_transferred }}
            </div>
            <span class="text-sm text-base-content/60 mt-2"
              >Credits Transferred</span
            >
          </div>

          <div
            class="flex flex-col items-center p-4 bg-base-200/50 rounded-box"
          >
            <div
              class="radial-progress text-accent"
              style="--value: 100; --size: 5rem"
              role="progressbar"
            >
              {{ studentProfile.duration_semesters }}
            </div>
            <span class="text-sm text-base-content/60 mt-2"
              >Total Semesters</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Sessions Card -->
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="flex items-center justify-between">
          <h2 class="card-title gap-2">
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
                d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
              />
            </svg>
            Active Sessions
          </h2>
          <div class="flex gap-2">
            <button
              class="btn btn-sm btn-ghost"
              @click="loadSessions"
              :disabled="sessionsLoading"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                :class="['w-4 h-4', sessionsLoading && 'animate-spin']"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </button>
            <button
              class="btn btn-sm btn-outline btn-error"
              @click="revokeOtherSessions"
              :disabled="sessions.length <= 1"
            >
              Sign out other devices
            </button>
          </div>
        </div>

        <div class="divider my-2"></div>

        <div v-if="sessionsError" class="alert alert-warning alert-sm">
          <span>{{ sessionsError }}</span>
        </div>

        <div v-if="sessionsLoading" class="flex justify-center py-4">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <div
          v-else-if="!sessions.length"
          class="text-center py-4 text-base-content/60"
        >
          No active sessions found
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="s in sessions"
            :key="s.id || s.token"
            class="flex items-center justify-between p-3 bg-base-200/50 rounded-box"
          >
            <div class="flex items-center gap-3">
              <div class="avatar placeholder">
                <div class="bg-base-300 text-base-content/60 w-10 rounded-lg">
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
                      d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
                    />
                  </svg>
                </div>
              </div>
              <div>
                <p class="text-sm font-medium truncate max-w-[250px]">
                  {{ s.userAgent || "Unknown Device" }}
                </p>
                <p class="text-xs text-base-content/50">
                  IP: {{ s.ipAddress || "Unknown" }} • Expires:
                  {{
                    s.expiresAt
                      ? new Date(s.expiresAt).toLocaleDateString()
                      : "—"
                  }}
                </p>
              </div>
            </div>
            <button
              class="btn btn-sm btn-ghost text-error"
              @click="revokeSession(s.token)"
              :disabled="!s.token"
            >
              Revoke
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Change Password Card -->
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title gap-2">
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
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          Change Password
        </h2>

        <div class="divider my-2"></div>

        <div v-if="passwordError" class="alert alert-error alert-sm mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{{ passwordError }}</span>
        </div>

        <div v-if="passwordSuccess" class="alert alert-success alert-sm mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>Password changed successfully!</span>
        </div>

        <form class="space-y-4" @submit.prevent="changePassword">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Current Password</legend>
            <div class="relative">
              <input
                v-model="passwordForm.currentPassword"
                :type="showCurrentPassword ? 'text' : 'password'"
                class="input input-bordered w-full pr-10"
                placeholder="Enter current password"
                required
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                @click="showCurrentPassword = !showCurrentPassword"
              >
                <svg
                  v-if="showCurrentPassword"
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
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
                <svg
                  v-else
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
                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">New Password</legend>
            <div class="relative">
              <input
                v-model="passwordForm.newPassword"
                :type="showNewPassword ? 'text' : 'password'"
                class="input input-bordered w-full pr-10"
                placeholder="Min. 8 characters"
                minlength="8"
                required
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                @click="showNewPassword = !showNewPassword"
              >
                <svg
                  v-if="showNewPassword"
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
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
                <svg
                  v-else
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
                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Confirm New Password</legend>
            <div class="relative">
              <input
                v-model="passwordForm.confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                class="input input-bordered w-full pr-10"
                placeholder="Re-enter new password"
                minlength="8"
                required
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <svg
                  v-if="showConfirmPassword"
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
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
                <svg
                  v-else
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
                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </fieldset>

          <div class="flex justify-end">
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="passwordSaving"
            >
              <span
                v-if="passwordSaving"
                class="loading loading-spinner loading-sm"
              ></span>
              <span v-else>Update Password</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Info Alert (Student Only) -->
    <div v-if="isStudent" class="alert">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        class="h-6 w-6 shrink-0 stroke-info"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        ></path>
      </svg>
      <span
        >Need to update matric number, program, or intake? Contact your
        <strong>Head of Program</strong>.</span
      >
    </div>

    <!-- Danger Zone -->
    <div class="card bg-base-100 shadow-xl border border-error/20">
      <div class="card-body">
        <h2 class="card-title gap-2 text-error">
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
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          Danger Zone
        </h2>

        <div class="divider my-2"></div>

        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">Sign out of your account</p>
            <p class="text-sm text-base-content/60">
              You will be redirected to the sign-in page
            </p>
          </div>
          <button class="btn btn-error btn-outline" @click="signOut">
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
                d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
              />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
