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
  <div v-if="pending && isStudent" class="flex justify-center items-center min-h-[50vh]">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>

  <div v-else class="max-w-5xl mx-auto p-6 space-y-8">
    <!-- Header Section -->
    <div class="flex flex-col md:flex-row items-center gap-6 mb-8">
      <div class="avatar placeholder group">
        <div class="bg-gradient-to-br from-primary to-secondary text-primary-content w-24 rounded-full shadow-lg group-hover:scale-105 transition-transform duration-300 ring ring-primary/30 ring-offset-base-100 ring-offset-2">
          <span class="text-4xl font-bold">{{ displayName?.charAt(0)?.toUpperCase() || "?" }}</span>
        </div>
      </div>
      <div class="text-center md:text-left space-y-2">
        <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
          {{ displayName }}
        </h1>
        <div class="flex flex-wrap justify-center md:justify-start gap-2">
          <span class="badge badge-lg gap-2" :class="user?.role === 'HOP' ? 'badge-primary' : 'badge-secondary'">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
              <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" />
            </svg>
            {{ user?.role === "HOP" ? "Head of Program" : "Student" }}
          </span>
          <span v-if="isStudent && studentProfile" class="badge badge-ghost badge-lg gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
              <path d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 10l-7.25 4-7.25-4V7.5l7.25 4 7.25-4V10zM10 15.5l-6-3.32V14a1 1 0 00.5.87l5.5 3a1 1 0 001 0l5.5-3a1 1 0 00.5-.87v-1.82l-6 3.32z" />
            </svg>
            {{ studentProfile.matric_no }}
          </span>
        </div>
      </div>
    </div>

    <!-- Alerts -->
    <div v-if="error" class="alert alert-error shadow-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <span>{{ error }}</span>
    </div>

    <div v-if="success" class="alert alert-success shadow-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <span>Profile updated successfully!</span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Left Column: Personal Info & Password -->
      <div class="space-y-8 lg:col-span-2">
        
        <!-- Personal Information -->
        <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-shadow">
          <div class="card-body">
            <div class="flex items-center justify-between mb-4">
              <h2 class="card-title flex items-center gap-2">
                <div class="p-2 bg-primary/10 rounded-lg text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                Personal Details
              </h2>
              <button v-if="!editing" class="btn btn-sm btn-ghost gap-2" @click="startEdit">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                Edit
              </button>
            </div>

            <div class="grid gap-6">
              <fieldset class="fieldset">
                <legend class="fieldset-legend font-medium">Full Name</legend>
                <div v-if="editing" class="join w-full">
                  <input
                    v-model="fullName"
                    type="text"
                    class="input input-bordered join-item w-full bg-base-100 placeholder:text-base-content/30"
                    placeholder="Enter full name"
                    @keyup.enter="saveProfile"
                  />
                  <button class="btn btn-primary join-item" :disabled="saving" @click="saveProfile">
                    {{ saving ? 'Saving...' : 'Save' }}
                  </button>
                  <button class="btn btn-ghost join-item" :disabled="saving" @click="cancelEdit">
                    Cancel
                  </button>
                </div>
                <div v-else class="text-lg font-medium px-1">{{ displayName }}</div>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend font-medium">Email Address</legend>
                <div class="flex items-center gap-2 px-1 text-base-content/80">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  {{ displayEmail }}
                  <span class="badge badge-success badge-sm badge-outline ml-2">Verified</span>
                </div>
              </fieldset>
            </div>
          </div>
        </div>

        <!-- Academic Info (Student Only) -->
        <div v-if="isStudent && studentProfile" class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-shadow">
          <div class="card-body">
            <h2 class="card-title flex items-center gap-2 mb-4">
              <div class="p-2 bg-secondary/10 rounded-lg text-secondary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-5.266-2.475 12 12 0 015.266 2.475zM21.74 10.147c.656-.346 1.341-.652 2.05-.965-1.558 3.553-3.766 6.885-6.333 9.497m0 0a17.896 17.896 0 01-8.914 0m0 0a17.869 17.869 0 01-6.333-9.497m15.247 0c-.655-.346-1.34-.652-2.049-.965m0 0a48.11 48.11 0 013.434-4.756 48.11 48.11 0 01-3.434 4.756" />
                </svg>
               </div>
              Academic Progress
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="stats bg-base-200/50 rounded-xl border border-base-200">
                <div class="stat p-4">
                  <div class="stat-title text-xs uppercase tracking-wide opacity-60">Program</div>
                  <div class="stat-value text-base mt-1 whitespace-normal leading-tight">{{ studentProfile.program_code }}</div>
                  <div class="stat-desc mt-1">{{ studentProfile.program_name }}</div>
                </div>
              </div>
               <div class="stats bg-base-200/50 rounded-xl border border-base-200">
                <div class="stat p-4">
                   <div class="stat-title text-xs uppercase tracking-wide opacity-60">Intake Batch</div>
                   <div class="stat-value text-base mt-1">{{ formatIntake(studentProfile.intake_year) }}</div>
                   <div class="stat-desc mt-1">Starting Sem {{ studentProfile.starting_semester }}</div>
                </div>
              </div>
            </div>

            <div class="divider my-2"></div>

            <div class="flex justify-around py-4">
              <div class="flex flex-col items-center gap-3">
                 <div class="radial-progress text-primary bg-primary/10 border-4 border-transparent" :style="`--value:${(studentProfile.total_credit_transferred / studentProfile.total_credit_required) * 100}; --size:6rem; --thickness: 0.5rem;`">
                  <span class="text-xl font-bold text-base-content">{{ studentProfile.total_credit_transferred }}</span>
                 </div>
                 <div class="text-xs font-bold uppercase tracking-wide opacity-60">Credits Transferred</div>
              </div>
              
              <div class="flex flex-col items-center gap-3">
                 <div class="radial-progress text-secondary bg-secondary/10 border-4 border-transparent" :style="`--value:${(studentProfile.starting_semester / studentProfile.duration_semesters) * 100}; --size:6rem; --thickness: 0.5rem;`">
                    <span class="text-xl font-bold text-base-content">{{ studentProfile.starting_semester }}</span>
                 </div>
                 <div class="text-xs font-bold uppercase tracking-wide opacity-60">Current Semester</div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Right Column: Security & Sessions -->
      <div class="space-y-8">
        
        <!-- Change Password -->
        <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-shadow h-fit">
          <div class="card-body">
             <h2 class="card-title flex items-center gap-2 mb-4">
               <div class="p-2 bg-accent/10 rounded-lg text-accent">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
               </div>
               Security
            </h2>

            <div v-if="passwordError" class="alert alert-error alert-sm text-xs mb-2">
              <span>{{ passwordError }}</span>
            </div>
            <div v-if="passwordSuccess" class="alert alert-success alert-sm text-xs mb-2">
              <span>Password updated!</span>
            </div>

            <form class="space-y-4" @submit.prevent="changePassword">
              <div class="form-control">
                <input
                    v-model="passwordForm.currentPassword"
                    :type="showCurrentPassword ? 'text' : 'password'"
                    class="input input-bordered w-full bg-base-100"
                    placeholder="Current Password"
                    required
                  />
              </div>
              <div class="form-control">
                 <input
                    v-model="passwordForm.newPassword"
                    :type="showNewPassword ? 'text' : 'password'"
                    class="input input-bordered w-full bg-base-100"
                    placeholder="New Password (min 8)"
                    minlength="8"
                    required
                  />
              </div>
              <button class="btn btn-accent w-full" :disabled="passwordSaving">
                {{ passwordSaving ? 'Updating...' : 'Change Password' }}
              </button>
            </form>
          </div>
        </div>

        <!-- Active Sessions -->
        <div class="card bg-base-100/50 backdrop-blur-md border border-base-200/50 shadow-sm hover:shadow-md transition-shadow h-fit">
          <div class="card-body">
             <div class="flex items-center justify-between mb-4">
                <h2 class="card-title flex items-center gap-2">
                  <div class="p-2 bg-neutral/10 rounded-lg text-neutral-content">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-base-content">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                    </svg>
                  </div>
                  Sessions
                </h2>
                <button class="btn btn-xs btn-outline btn-error" @click="revokeOtherSessions" :disabled="sessions.length <= 1">
                  Sign out others
                </button>
             </div>

             <div v-if="sessionsLoading" class="flex justify-center py-4">
                <span class="loading loading-dots loading-sm"></span>
             </div>
             
             <div v-else class="space-y-3">
                <div v-for="s in sessions" :key="s.id || s.token" class="flex items-center justify-between p-3 rounded-xl bg-base-200/50 border border-base-200">
                   <div class="flex items-center gap-3 overflow-hidden">
                      <div class="w-2 h-2 rounded-full" :class="s.token === currentSessionToken ? 'bg-success shadow-lg shadow-success/50' : 'bg-base-content/20'"></div>
                      <div class="min-w-0">
                         <p class="text-sm font-medium truncate">{{ s.userAgent || "Unknown Device" }}</p>
                         <p class="text-xs text-base-content/50 truncate">{{ s.ipAddress }} • {{ new Date(s.expiresAt).toLocaleDateString() }}</p>
                      </div>
                   </div>
                      <button v-if="s.token !== currentSessionToken" class="btn btn-ghost btn-xs text-error" @click="revokeSession(s.token)">
                      ×
                   </button>
                </div>
             </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

