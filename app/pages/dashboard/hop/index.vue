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

// Toast notification state
const toast = reactive({ show: false, message: "", type: "info" });
const showToast = (
  message: string,
  type: "info" | "success" | "warning" | "error" = "info",
) => {
  toast.message = message;
  toast.type = type;
  toast.show = true;
  setTimeout(() => {
    toast.show = false;
  }, 3000);
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
    await refreshIntakes();
    // Notify CurrentSessionBadge to refresh
    const sessionUpdated = useState<number>("currentSessionUpdated", () => 0);
    sessionUpdated.value++;
    sessionSaved.value = true;
    setTimeout(() => {
      sessionSaved.value = false;
    }, 3000);
  } catch (error: any) {
    showToast(
      error?.data?.statusMessage || "Failed to update session",
      "error",
    );
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

interface StudentData {
  student_id: number;
  matric_no: string;
  student_name: string;
  email: string;
  intake: string;
  entry_semester: number | null;
  academic_plan_status: string;
  account_status: string;
}

const { data: allStudents } =
  await useFetch<StudentData[]>("/api/hop/students");

const totalStudents = computed(() => allStudents.value?.length || 0);
const draftPlans = computed(() => {
  if (!allStudents.value) return 0;
  return allStudents.value.filter((s) => s.academic_plan_status === "draft")
    .length;
});
const approvedPlans = computed(() => {
  if (!allStudents.value) return 0;
  return allStudents.value.filter((s) => s.academic_plan_status === "approved")
    .length;
});

// Workflow manual steps
const workflowManuals = {
  semesterRules: [
    { text: "Navigate to the Semester Rules page." },
    { text: "Define credit transfer ranges and their corresponding entry semesters.", note: "e.g. 0\u201320 credits \u2192 Semester 1, 21\u201340 credits \u2192 Semester 2" },
    { text: "Add or edit rules by specifying the minimum and maximum credit hours." },
    { text: "Save your changes. These rules are used during Intake Assessment to auto-calculate each student's starting semester." },
  ],
  programStructure: [
    { text: "Navigate to the Program Structure page." },
    { text: "Create a new session (e.g. 'Session 2024') or clone an existing one." },
    { text: "Select a session tab to view its semester structure." },
    { text: 'Add courses to each semester by clicking "Add Course".', note: "You can also create new courses or import from Excel." },
    { text: "Assign course types, prerequisites, and groups for each course." },
    { text: "Verify total credits match the program's required credits." },
  ],
  activeSession: [
    { text: "Scroll to the Global Academic Session card above." },
    { text: "Enter the active intake period in MMYY format.", note: "e.g. 0525 for May 2025" },
    { text: "Select the semester type (Long or Short)." },
    { text: 'Click "Update" to save. This sets the current session globally across the system.' },
    { text: "View the Cohort Semester Progress to see how each intake is tracking.", note: "Semesters are automatically calculated from the active session." },
  ],
  intakeAssessment: [
    { text: "Navigate to the Intake Assessment page." },
    { text: "Select a session and upload the student Excel sheet.", note: "The sheet should contain student matric numbers and credit transfer data." },
    { text: "The system will automatically match students and process credit transfers." },
    { text: "Review the assessment results \u2014 students will be assigned entry semesters based on semester rules." },
    { text: "Finalize the assessment to lock in the results." },
  ],
  academicPlanning: [
    { text: "Navigate to the Academic Planning page." },
    { text: "Select an intake to view its students and their plan statuses." },
    { text: 'Click "Generate Plans" to auto-generate academic plans for all students in the intake.', note: "Plans are generated based on the program structure, credit transfers, and semester rules." },
    { text: 'Review each student\'s plan by clicking "View Plan" or edit via "View Schedule".' },
    { text: "Approve plans when they look correct. Students can then see their approved plans." },
    { text: 'Use "Re-schedule" to revert an approved plan back to draft if changes are needed.' },
  ],
};
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 w-full max-w-[1400px] mx-auto flex flex-col space-y-8 h-full">
    <!-- Toast Notification -->
    <div v-if="toast.show" class="toast toast-top toast-end z-50">
      <div
        class="alert shadow-xl border"
        :class="{
          'alert-info border-info/20 text-info-content bg-info/10 backdrop-blur-md': toast.type === 'info',
          'alert-success border-success/20 text-success-content bg-success/10 backdrop-blur-md': toast.type === 'success',
          'alert-warning border-warning/20 text-warning-content bg-warning/10 backdrop-blur-md': toast.type === 'warning',
          'alert-error border-error/20 text-error-content bg-error/10 backdrop-blur-md': toast.type === 'error',
        }"
      >
        <span class="font-bold">{{ toast.message }}</span>
      </div>
    </div>

    <!-- Header Section -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 flex-none relative mb-2">
      <div class="space-y-2 z-10">
        <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
          HoP <span class="text-primary">Dashboard</span>
        </h1>
        <p class="text-base-content/60 font-medium max-w-xl">
          Overview of student intakes, academic tracking status, and quick workflow access.
        </p>
      </div>
      <!-- Ambient glow -->
      <div class="absolute -top-10 -left-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none transform-gpu -z-10"></div>
    </div>

    <!-- Current Session Setting (Moved to Top) -->
    <div id="session-config" class="card bg-base-100 border border-base-200 shadow-sm overflow-visible relative z-20">
      <div class="absolute inset-0 bg-gradient-to-r from-secondary/5 via-transparent to-transparent pointer-events-none rounded-2xl"></div>
      <div class="card-body p-6 md:p-8 relative">
        <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <!-- Left: Title & Descriptions -->
          <div class="flex items-start gap-4 flex-1">
            <div class="p-3 bg-secondary/10 text-secondary rounded-2xl shadow-sm flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>
            </div>
            <div class="space-y-3 w-full">
              <div>
                <h2 class="text-xl font-bold flex items-center gap-3">
                  Global Academic Session
                  <div v-if="sessionSaved" class="badge badge-success badge-sm font-bold gap-1 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3 h-3"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg> Saved</div>
                </h2>
                <p class="text-sm text-base-content/60 mt-1 max-w-sm">
                  Control the currently active semester across the entire application.
                </p>
              </div>

              <!-- Cohort Progress Dropdown -->
              <div v-if="intakesData?.length" class="mt-4 max-w-2xl w-full">
                <details class="collapse collapse-arrow bg-base-100 border border-base-200 shadow-sm">
                  <summary class="collapse-title text-sm font-bold text-base-content/80 group">
                    <span class="flex items-center gap-2">
                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-primary"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" /></svg>
                       View Cohort Semester Progress
                    </span>
                  </summary>
                  <div class="collapse-content px-0 pb-0">
                    <div class="bg-base-50/50 border-t border-base-200 text-xs p-3 text-base-content/60 flex items-center gap-2">
                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                       Semesters are automatically calculated from the active session.
                    </div>
                    <div class="overflow-y-auto max-h-[300px] custom-scrollbar">
                      <table class="table table-xs w-full relative">
                        <thead class="bg-base-200/90 backdrop-blur-sm text-base-content sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th class="font-bold pl-4 py-3">Intake</th>
                            <th class="font-bold py-3">Name</th>
                            <th class="font-bold text-center py-3">Status</th>
                            <th class="font-bold text-right pr-4 py-3">Current Semester</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="intake in intakesData" :key="intake.id" class="hover:bg-primary/5 transition-colors border-t border-base-200/50" :class="{ 'opacity-60': intake.current_semester === 0 }">
                            <td class="pl-4 py-3">
                              <span class="inline-flex px-1.5 py-0.5 rounded bg-base-200 font-bold text-xs font-mono">{{ formatIntake(intake.intake_year) }}</span>
                            </td>
                            <td class="font-bold text-xs py-3 truncate max-w-[120px]">{{ intake.intake_name }}</td>
                            <td class="text-center py-3">
                              <span class="badge badge-xs font-bold capitalize tracking-wider text-[9px]" :class="intake.status === 'completed' ? 'badge-success badge-outline border-success/30' : 'badge-ghost'">{{ intake.status }}</span>
                            </td>
                            <td class="text-right pr-4 py-3">
                              <span v-if="intake.current_semester > 0" class="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary font-bold text-xs">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" /></svg>
                                Sem {{ intake.current_semester }}
                              </span>
                              <span v-else class="inline-flex items-center gap-1 px-2 py-1 rounded bg-base-200 text-base-content/40 font-bold text-[10px] uppercase tracking-wider">
                                Not Started
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              </div>

            </div>
          </div>

          <!-- Right: Forms -->
          <div class="flex-shrink-0 flex flex-col items-center lg:items-end gap-2 w-full lg:w-auto mt-4 lg:mt-0">
             <div class="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 w-full">
                 <div class="form-control w-1/2 sm:w-28">
                     <label class="label pb-1"><span class="label-text text-xs font-bold uppercase tracking-wider text-base-content/60">Period (MMYY)</span></label>
                     <input v-model="sessionForm.active_intake_period" type="text" placeholder="0525" maxlength="4" class="input input-sm bg-base-100 border-base-300 focus:border-secondary shadow-sm font-mono font-bold text-center w-full" />
                 </div>
                 <div class="form-control w-1/2 sm:w-44">
                     <label class="label pb-1"><span class="label-text text-xs font-bold uppercase tracking-wider text-base-content/60">Type</span></label>
                     <select v-model="sessionForm.semester_type" class="select select-sm bg-base-100 border-base-300 focus:border-secondary shadow-sm font-bold w-full">
                       <option value="L">Long Semester</option>
                       <option value="S">Short Semester</option>
                     </select>
                 </div>
                 <div class="form-control w-full sm:w-auto flex justify-end">
                     <button class="btn btn-secondary btn-sm rounded-lg px-6 mt-1 sm:mt-[28px] shadow-sm shadow-secondary/20 w-full sm:w-auto" :class="{ loading: sessionSaving }" :disabled="sessionSaving || !sessionForm.active_intake_period" @click="saveCurrentSession">
                       {{ sessionSaving ? "Saving" : "Update" }}
                     </button>
                 </div>
              </div>
            <div v-if="currentSessionData?.current_session" class="flex items-center justify-center lg:justify-end gap-2 text-xs text-base-content/50 w-full mt-2">
              <div class="w-2 h-2 rounded-full bg-success animate-pulse"></div>
              <span>Currently Active:</span>
              <span class="font-bold text-base-content">{{ formatIntake(currentSessionData.current_session.active_intake_period) }}</span>
              <span class="px-1.5 py-0.5 rounded bg-base-100 border border-base-300">{{ currentSessionData.current_session.semester_type === "L" ? "Long" : "Short" }}</span>
              <span>· {{ timeAgo(currentSessionData.current_session.updated_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Top Grid: Notifications & Stats -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
      
      <!-- Left: KPIs/Stats in 2x2 or row based on space -->
      <div class="lg:col-span-8 flex flex-col space-y-6">
        <h2 class="text-xl font-bold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13h2.625l1.5-3h3.75l1.5 3H15M18 13h2.25M6 13v6a2 2 0 002 2h8a2 2 0 002-2v-6m-9-6V6a2 2 0 012-2h2a2 2 0 012 2v1" /></svg>
          Quick Insights
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
          <!-- Total Students -->
          <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow group overflow-hidden relative">
            <div class="absolute -right-6 -top-6 w-24 h-24 bg-primary/5 rounded-full group-hover:bg-primary/10 transition-colors duration-300"></div>
            <div class="card-body p-5">
              <div class="flex justify-between items-start">
                <div>
                  <div class="text-sm font-bold text-base-content/50 uppercase tracking-widest mb-1">Total Students</div>
                  <div class="text-3xl font-black text-primary">{{ totalStudents }}</div>
                </div>
                <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-content transition-all duration-300 shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
                </div>
              </div>
            </div>
          </div>

          <!-- Draft Plans -->
          <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow group overflow-hidden relative">
            <div class="absolute -right-6 -top-6 w-24 h-24 bg-warning/5 rounded-full group-hover:bg-warning/10 transition-colors duration-300"></div>
            <div class="card-body p-5">
              <div class="flex justify-between items-start">
                <div>
                  <div class="text-sm font-bold text-base-content/50 uppercase tracking-widest mb-1">Draft Plans</div>
                  <div class="text-3xl font-black text-warning">{{ draftPlans }}</div>
                </div>
                <div class="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center text-warning group-hover:scale-110 group-hover:bg-warning group-hover:text-warning-content transition-all duration-300 shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
              </div>
            </div>
          </div>

          <!-- Approved Plans -->
          <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow group overflow-hidden relative">
            <div class="absolute -right-6 -top-6 w-24 h-24 bg-success/5 rounded-full group-hover:bg-success/10 transition-colors duration-300"></div>
            <div class="card-body p-5">
              <div class="flex justify-between items-start">
                <div>
                  <div class="text-sm font-bold text-base-content/50 uppercase tracking-widest mb-1">Approved</div>
                  <div class="text-3xl font-black text-success">{{ approvedPlans }}</div>
                </div>
                <div class="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center text-success group-hover:scale-110 group-hover:bg-success group-hover:text-success-content transition-all duration-300 shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- System Workflow -->
        <div class="mt-4 flex-1">
          <h2 class="text-xl font-bold flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>
            System Workflow
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            
            <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-primary/40 hover:-translate-y-1 transition-transform transition-colors transition-shadow duration-300">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">1</div>
                  <div class="flex items-center gap-1">
                    <UserManualButton
                      title="Semester Rules"
                      :steps="workflowManuals.semesterRules"
                    />
                    <span class="badge badge-ghost badge-sm text-[10px] uppercase font-bold tracking-wider">Setup</span>
                  </div>
                </div>
                <h3 class="font-bold text-base-content mb-1">Semester Rules</h3>
                <p class="text-xs text-base-content/60 leading-relaxed max-w-[200px] mb-4 flex-grow">Define credit transfer rules for entry semester calculations.</p>
                <NuxtLink to="/dashboard/hop/semester-rules" class="text-sm font-bold text-primary flex items-center gap-1 group">
                  Configure <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
                </NuxtLink>
              </div>
            </div>

            <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-primary/40 hover:-translate-y-1 transition-transform transition-colors transition-shadow duration-300">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">2</div>
                  <div class="flex items-center gap-1">
                    <UserManualButton
                      title="Program Structure"
                      :steps="workflowManuals.programStructure"
                    />
                    <span class="badge badge-ghost badge-sm text-[10px] uppercase font-bold tracking-wider">Setup</span>
                  </div>
                </div>
                <h3 class="font-bold text-base-content mb-1">Program Structure</h3>
                <p class="text-xs text-base-content/60 leading-relaxed max-w-[200px] mb-4 flex-grow">Create overarching sessions and assign core courses.</p>
                <NuxtLink to="/dashboard/hop/program-structure" class="text-sm font-bold text-primary flex items-center gap-1 group">
                  Configure <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
                </NuxtLink>
              </div>
            </div>

            <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-secondary/40 hover:-translate-y-1 transition-transform transition-colors transition-shadow duration-300">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary font-bold text-lg">3</div>
                  <div class="flex items-center gap-1">
                    <UserManualButton
                      title="Active Session"
                      :steps="workflowManuals.activeSession"
                    />
                    <span class="badge badge-ghost badge-sm text-[10px] uppercase font-bold tracking-wider">Cohort</span>
                  </div>
                </div>
                <h3 class="font-bold text-base-content mb-1">Active Session</h3>
                <p class="text-xs text-base-content/60 leading-relaxed mb-4 flex-grow">Assign the current active period globally.</p>
                <a href="#session-config" class="text-sm font-bold text-secondary flex items-center gap-1 group transition-colors">
                  Set Below <span class="group-hover:translate-y-1 transition-transform">&darr;</span>
                </a>
              </div>
            </div>

            <!-- row 2 items can span wider on medium -->
            <div class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-accent/40 hover:-translate-y-1 transition-transform transition-colors transition-shadow duration-300">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent font-bold text-lg">4</div>
                  <div class="flex items-center gap-1">
                    <UserManualButton
                      title="Intake Assessment"
                      :steps="workflowManuals.intakeAssessment"
                    />
                    <span class="badge badge-ghost badge-sm text-[10px] uppercase font-bold tracking-wider">Cohort</span>
                  </div>
                </div>
                <h3 class="font-bold text-base-content mb-1">Intake Assessment</h3>
                <p class="text-xs text-base-content/60 leading-relaxed mb-4 flex-grow">Inject student sheets & process credit transfers automatically.</p>
                <NuxtLink to="/dashboard/hop/intake-assessment" class="text-sm font-bold text-accent flex items-center gap-1 group">
                  Assess <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
                </NuxtLink>
              </div>
            </div>

            <div class="card bg-accent text-accent-content shadow-xl shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden sm:col-span-2 lg:col-span-2">
              <div class="absolute -right-10 top-0 opacity-10 blur-xl">
                 <svg xmlns="http://www.w3.org/2000/svg" class="w-48 h-48" viewBox="0 0 24 24" fill="currentColor"><path d="M11.7 2.8L1.7 8.5C1.3 8.7 1.3 9.3 1.7 9.5L11.7 15.2C11.9 15.3 12.1 15.3 12.3 15.2L22.3 9.5C22.7 9.3 22.7 8.7 22.3 8.5L12.3 2.8C12.1 2.7 11.9 2.7 11.7 2.8ZM3.5 11L1.7 12C1.3 12.2 1.3 12.8 1.7 13L11.7 18.7C11.9 18.8 12.1 18.8 12.3 18.7L22.3 13C22.7 12.8 22.7 12.2 22.3 12L20.5 11L12.3 15.7C12.1 15.8 11.9 15.8 11.7 15.7L3.5 11ZM3.5 14.5L1.7 15.5C1.3 15.7 1.3 16.3 1.7 16.5L11.7 22.2C11.9 22.3 12.1 22.3 12.3 22.2L22.3 16.5C22.7 16.3 22.7 15.7 22.3 15.5L20.5 14.5L12.3 19.2C12.1 19.3 11.9 19.3 11.7 19.2L3.5 14.5Z" /></svg>
              </div>
              <div class="card-body p-6 relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="inline-flex w-7 h-7 rounded bg-white text-accent items-center justify-center font-bold text-sm shadow-sm">5</span>
                    <UserManualButton
                      title="Academic Planning"
                      :steps="workflowManuals.academicPlanning"
                    />
                    <span class="badge border-white/30 bg-white/10 text-white badge-sm text-[10px] uppercase font-bold tracking-wider backdrop-blur-md">Final Phase</span>
                  </div>
                  <h3 class="font-extrabold text-2xl mb-1">Academic Planning</h3>
                  <p class="text-accent-content/80 text-sm max-w-sm">Generate, review, and finalize academic plans for enrolled students.</p>
                </div>
                <div class="mt-4 sm:mt-0 flex-shrink-0">
                  <NuxtLink to="/dashboard/hop/academic-planning" class="btn bg-white hover:bg-base-200 text-accent border-none shadow-lg px-6 rounded-xl group transition-all">
                    Open Planning
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 group-hover:translate-x-1 transition-transform"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>
                  </NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Notifications -->
      <div class="lg:col-span-4 flex flex-col h-full">
        <h2 class="text-xl font-bold flex items-center gap-2 mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
          Attention Required
        </h2>

        <div v-if="notificationData && notificationData.unread_count > 0" class="card bg-base-100 border border-warning/30 shadow-md shadow-warning/5 flex-grow">
          <div class="card-body p-0 flex flex-col h-full">
            <div class="p-4 border-b border-base-200 bg-warning/5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="badge badge-warning font-bold shadow-sm">{{ notificationData.unread_count }}</span>
                <span class="text-sm font-bold text-warning-content">Re-Approval Requests</span>
              </div>
              <button class="btn btn-xs btn-ghost text-base-content/50 hover:text-base-content" @click="markAllRead">Clear All</button>
            </div>
            
            <div class="flex-grow overflow-y-auto p-3 space-y-2">
              <div
                v-for="notification in notificationData.notifications.slice(0, 5)"
                :key="notification.id"
                class="group flex flex-col p-3 rounded-xl bg-base-100 border border-base-200 hover:border-warning/40 hover:bg-warning/5 cursor-pointer transition-all duration-200"
                @click="goToStudentPlan(notification.plan_id, notification.id)"
              >
                <div class="flex items-start justify-between gap-2 mb-2">
                  <div class="font-bold text-sm group-hover:text-primary transition-colors text-base-content line-clamp-1">
                    {{ notification.student_name }}
                  </div>
                  <span class="text-[10px] font-semibold text-base-content/40 whitespace-nowrap">{{ timeAgo(notification.created_at) }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 bg-base-200 px-2 py-0.5 rounded text-[10px] font-mono font-bold text-base-content/70">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-warning"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {{ notification.matric_no }}
                  </div>
                  <span class="text-[10px] text-warning font-bold uppercase tracking-wider">Review &rarr;</span>
                </div>
              </div>
            </div>

            <div v-if="notificationData.unread_count > 5" class="p-3 bg-base-50 border-t border-base-200 text-center mt-auto">
              <NuxtLink to="/dashboard/hop/academic-planning" class="text-xs font-bold text-base-content/60 hover:text-primary transition-colors">
                View all {{ notificationData.unread_count }} pending in Planning
              </NuxtLink>
            </div>
          </div>
        </div>

        <div v-else class="card bg-base-100/50 border border-base-200 border-dashed flex-grow flex items-center justify-center p-8 text-center text-base-content/50 h-[300px]">
          <div>
            <div class="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 opacity-40"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <p class="font-bold mb-1">All caught up!</p>
            <p class="text-sm max-w-[200px]">No pending plan re-approvals at this time.</p>
          </div>
        </div>

      </div>
    </div>

  </div>
</template>
