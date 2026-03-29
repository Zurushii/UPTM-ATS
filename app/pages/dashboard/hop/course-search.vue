<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

interface CourseResult {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  course_type: string;
  student_count: number;
}

interface CourseDetail {
  course: {
    id: number;
    course_code: string;
    course_name: string;
    credit_hour: number;
  };
  students: {
    student_id: number;
    matric_no: string;
    intake_year: string;
    starting_semester: number;
    student_name: string;
    planned_semester: number;
  }[];
  sessions: {
    session_id: number;
    session_name: string;
    semester: number;
    course_type: string;
  }[];
  total_students: number;
  session_missing?: boolean;
}

interface CurrentSession {
  active_intake_period: string;
  semester_type: "L" | "S";
  updated_at: string;
}

const { data: sessionData } = await useFetch<{
  current_session: CurrentSession | null;
}>("/api/current-session");

// Format intake year MMYY -> "MMM YYYY"
const formatIntake = (mmyy: string) => {
  if (!mmyy || mmyy.length !== 4) return mmyy;
  const month = parseInt(mmyy.substring(0, 2), 10);
  const year = parseInt(mmyy.substring(2, 4), 10) + 2000;
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
  return `${months[month - 1] || "?"} ${year}`;
};

const sessionLabel = computed(() => {
  if (!sessionData.value?.current_session) return "";
  const session = sessionData.value.current_session;
  const type = session.semester_type === "L" ? "Long Semester" : "Short Semester";
  return `${formatIntake(session.active_intake_period)} · ${type}`;
});

const searchQuery = ref("");
const selectedCourseId = ref<number | null>(null);
const showDetailModal = ref(false);

// Fetch courses
const { data, status, refresh } = await useFetch<{
  courses: CourseResult[];
  has_session: boolean;
}>("/api/hop/course-search", {
  query: computed(() => ({
    search: searchQuery.value || undefined,
  })),
  watch: false,
});

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout>;
const onSearchInput = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    refresh();
  }, 300);
};

// Course detail
const courseDetail = ref<CourseDetail | null>(null);
const loadingDetail = ref(false);

const viewCourseDetail = async (courseId: number) => {
  selectedCourseId.value = courseId;
  loadingDetail.value = true;
  showDetailModal.value = true;
  try {
    courseDetail.value = await $fetch<CourseDetail>(
      `/api/hop/course-search/${courseId}`,
    );
  } catch (error) {
    console.error("Failed to load course detail:", error);
    courseDetail.value = null;
  } finally {
    loadingDetail.value = false;
  }
};

const closeModal = () => {
  showDetailModal.value = false;
  courseDetail.value = null;
  selectedCourseId.value = null;
};

const exportToPDF = () => {
  if (!courseDetail.value) return;
  
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Please allow popups to export to PDF.");
    return;
  }

  const course = courseDetail.value.course;
  const students = courseDetail.value.students;
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Student List - ${course.course_code}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #333; }
          h1, h2, h3 { margin: 0 0 10px 0; color: #111; }
          .header { border-bottom: 2px solid #eaeaea; padding-bottom: 20px; margin-bottom: 30px; }
          .meta-info { display: flex; gap: 20px; font-size: 14px; color: #555; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
          th, td { border: 1px solid #eaeaea; padding: 12px; text-align: left; }
          th { background-color: #f9f9f9; font-weight: 600; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${course.course_code} - ${course.course_name}</h2>
          <div class="meta-info">
            <span><strong>Credit Hours:</strong> ${course.credit_hour}</span>
            <span><strong>Total Enrolled:</strong> ${courseDetail.value.total_students}</span>
          </div>
        </div>
        
        <h3>Enrolled Students (${students.length})</h3>
        
        ${students.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th class="text-center w-12">#</th>
                <th>Student Name</th>
                <th class="text-center">Matric No</th>
                <th class="text-center">Semester</th>
                <th class="text-right">Intake</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((student, idx) => `
                <tr>
                  <td class="text-center">${idx + 1}</td>
                  <td>${student.student_name || "—"}</td>
                  <td class="text-center">${student.matric_no}</td>
                  <td class="text-center">${student.planned_semester}</td>
                  <td class="text-right">${formatIntake(student.intake_year)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p>No students enrolled.</p>'}
        
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 250);
          }
        <\/script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
};

// Group courses by semester for display
const groupedCourses = computed(() => {
  if (!data.value?.courses) return {};
  const groups: Record<number, CourseResult[]> = {};
  for (const c of data.value.courses) {
    if (!groups[c.semester]) groups[c.semester] = [];
    groups[c.semester]!.push(c);
  }
  return groups;
});

const totalCourses = computed(() => data.value?.courses?.length || 0);
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 w-full max-w-7xl mx-auto space-y-8">
    <!-- Header Section -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div class="space-y-2">
        <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-base-content">
          Course <span class="text-primary">Search</span>
        </h1>
        <p class="text-base-content/60 font-medium max-w-xl">
          Search course offerings, view credit details, and track student enrollments across semesters.
        </p>
      </div>

      <!-- Session Indicator -->
      <div v-if="sessionData?.current_session" class="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full border border-primary/20 shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
        <span class="text-sm font-bold tracking-wide uppercase">{{ sessionLabel }}</span>
      </div>
    </div>

    <!-- Missing Session Alert -->
    <div v-if="!sessionData?.current_session" class="alert alert-warning shadow-md rounded-xl border-l-4 border-l-warning">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      <div>
        <h3 class="font-bold text-warning-content">Current session not set</h3>
        <div class="text-sm text-warning-content/80 mt-1">Student counts currently show 0. Please configure the session in <NuxtLink to="/dashboard/hop" class="link hover:text-warning-content font-bold border-b border-warning/50 no-underline">Settings</NuxtLink>.</div>
      </div>
    </div>

    <!-- Search & Filters -->
    <div class="card bg-base-100 shadow-sm border border-base-200">
      <div class="card-body p-2 md:p-3">
        <div class="relative w-full">
          <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by course code or name..."
            class="input input-lg w-full pl-12 bg-base-200/30 hover:bg-base-200/60 focus:bg-base-100 transition-colors duration-200 border-transparent focus:border-primary rounded-xl"
            @input="onSearchInput"
          />
          <div class="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
            <span v-if="status === 'pending'" class="loading loading-spinner text-primary"></span>
            <span v-else class="text-sm font-medium text-base-content/50 bg-base-200/80 px-3 py-1 rounded-full shadow-inner">{{ totalCourses }} found</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Course List -->
    <div v-if="data?.courses && data.courses.length > 0" class="space-y-12">
      <div v-for="(courses, semester) in groupedCourses" :key="semester" class="space-y-5">
        
        <!-- Semester Divider -->
        <div class="flex items-center gap-4">
          <h2 class="text-xl font-bold text-base-content flex items-center gap-3">
            <span class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">{{ semester }}</span>
            Semester {{ semester }}
          </h2>
          <div class="h-px bg-base-200 flex-grow"></div>
          <span class="text-sm font-medium text-base-content/50">{{ courses.length }} Course{{ courses.length !== 1 ? 's' : '' }}</span>
        </div>

        <!-- Responsive Grid for Courses -->
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <div 
            v-for="course in courses" 
            :key="course.course_id"
            class="group flex flex-col bg-base-100 rounded-2xl border border-base-200 shadow-sm hover:shadow-md hover:border-primary/30 transition-colors transition-shadow duration-200 cursor-pointer overflow-hidden relative"
            @click="viewCourseDetail(course.course_id)"
          >
            <!-- Background Decoration (Removed for performance) -->

            <div class="p-6 flex-grow flex flex-col z-10 w-full">
              <div class="flex justify-between items-start mb-4">
                <div class="inline-flex items-center px-2.5 py-1 rounded-md bg-base-200 text-base-content font-mono text-sm font-bold tracking-wide border border-base-300 group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors duration-200">
                  {{ course.course_code }}
                </div>
                <span class="badge badge-sm font-bold uppercase tracking-wider text-[10px]" :class="course.course_type === 'Core' ? 'badge-primary badge-outline border-primary/30 bg-primary/5' : 'badge-ghost bg-base-200/50 text-base-content/60'">
                  {{ course.course_type }}
                </span>
              </div>
              
              <h3 class="font-bold text-lg leading-snug text-base-content mb-4 line-clamp-2 group-hover:text-primary transition-colors duration-200" :title="course.course_name">
                {{ course.course_name }}
              </h3>
              
              <div class="mt-auto flex items-center gap-3">
                <div class="inline-flex items-center gap-1.5 text-base-content/60 text-sm font-semibold bg-base-200/50 px-2.5 py-1 rounded-md border border-base-200">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  {{ course.credit_hour }} Credits
                </div>
              </div>
            </div>

            <div class="px-6 py-3.5 bg-base-200/40 border-t border-base-200/80 flex items-center justify-between z-10 group-hover:bg-primary/5 transition-colors duration-200">
              <span class="text-xs font-bold text-base-content/50 uppercase tracking-widest">Enrollment</span>
              <div class="flex items-center gap-1.5 text-sm font-bold" :class="course.student_count > 0 ? 'text-primary' : 'text-base-content/40 disabled'">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                {{ course.student_count }} Enrolled Student{{ course.student_count === 1 ? '' : 's' }}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="status !== 'pending'" class="flex flex-col items-center justify-center py-24 px-4 text-center bg-base-100/50 rounded-3xl border border-base-200/60 border-dashed">
      <div class="w-20 h-20 bg-base-200/80 rounded-full flex items-center justify-center mb-6 shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-base-content/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 15.75l-2.456-2.456m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.774 4.774zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 class="text-xl font-bold text-base-content mb-3">No courses found</h3>
      <p class="text-base-content/60 max-w-sm mb-6 leading-relaxed">
        We couldn't find any courses matching your search criteria. Try adjusting your filters or search term.
      </p>
      <button v-if="searchQuery" @click="searchQuery = ''; onSearchInput()" class="btn btn-outline btn-primary rounded-xl">
        Clear Search
      </button>
    </div>

    <!-- Course Detail Modal -->
    <dialog class="modal modal-bottom sm:modal-middle" :class="{ 'modal-open': showDetailModal }">
      <div class="modal-box sm:max-w-4xl p-0 overflow-hidden flex flex-col max-h-[90vh] sm:rounded-2xl rounded-t-3xl shadow-2xl transform-gpu">
        <!-- Close Button -->
        <button class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4 z-10 bg-base-200/50 hover:bg-base-300 transition-colors" @click="closeModal">✕</button>
        
        <div v-if="loadingDetail" class="flex items-center justify-center py-40">
          <span class="loading loading-spinner text-primary loading-lg"></span>
        </div>

        <template v-else-if="courseDetail">
          <!-- Modal Header with accent background -->
          <div class="bg-base-200/50 border-b border-base-200 p-6 pt-10 sm:p-8 sm:pt-12 relative overflow-hidden">
            <!-- Background Decoration (Removed for performance) -->
            
            <div class="relative z-10">
              <div class="flex items-center gap-4 mb-4">
                <span class="px-3 py-1 bg-base-100 text-primary font-mono font-bold rounded-lg text-sm border border-primary/20 shadow-sm">
                  {{ courseDetail.course.course_code }}
                </span>
                <span class="flex items-center gap-1.5 text-sm font-semibold text-base-content/60">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  {{ courseDetail.course.credit_hour }} Credits
                </span>
              </div>
              <h2 class="text-2xl sm:text-3xl font-black text-base-content leading-tight">
                {{ courseDetail.course.course_name }}
              </h2>

              <div class="mt-6 border-t border-base-200/60 pt-6">
                <button @click="exportToPDF" class="btn btn-primary btn-sm gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Export to PDF
                </button>
              </div>
            </div>
          </div>

          <!-- Modal Body (Scrollable table) -->
          <div class="p-6 sm:p-8 overflow-y-auto bg-base-100 flex-grow">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 class="text-lg font-bold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Enrolled Students
              </h3>
              <div class="badge badge-primary badge-lg font-bold shadow-sm">
                {{ courseDetail.total_students }} Total Students
              </div>
            </div>

            <div v-if="courseDetail.students.length > 0" class="bg-base-100 border border-base-200 rounded-2xl overflow-hidden shadow-sm">
              <div class="overflow-x-auto">
                <table class="table w-full border-collapse">
                  <thead class="bg-base-200/50 text-base-content">
                    <tr>
                      <th class="w-12 text-center text-base-content/50 font-semibold">#</th>
                      <th class="font-semibold">Student Name</th>
                      <th class="text-center font-semibold">Matric No</th>
                      <th class="text-center font-semibold">Semester</th>
                      <th class="text-right font-semibold">Intake</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(student, idx) in courseDetail.students" :key="student.student_id" class="hover:bg-base-200/40 transition-colors duration-150 border-t border-base-200 group">
                      <td class="text-center text-base-content/40 font-medium group-hover:text-base-content/60">{{ idx + 1 }}</td>
                      <td>
                        <div class="font-bold text-base-content">{{ student.student_name || "—" }}</div>
                      </td>
                      <td class="text-center">
                        <span class="font-mono text-xs bg-base-200/50 px-2 py-1 rounded-md text-base-content/70 font-semibold">{{ student.matric_no }}</span>
                      </td>
                      <td class="text-center">
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-base-200 font-bold text-sm">{{ student.planned_semester }}</span>
                      </td>
                      <td class="text-right">
                        <span class="text-sm font-medium text-base-content/60">{{ formatIntake(student.intake_year) }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-else-if="courseDetail.session_missing" class="flex flex-col items-center justify-center p-10 bg-warning/5 border border-warning/20 rounded-2xl text-center">
              <div class="w-16 h-16 bg-warning/20 rounded-full flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              </div>
              <h4 class="text-lg font-bold text-warning-content mb-2">Session Configuration Required</h4>
              <p class="text-warning-content/70 text-sm max-w-md leading-relaxed">We cannot determine student enrollments because the current session is not fully set. Please update the session settings.</p>
            </div>

            <div v-else class="flex flex-col items-center justify-center p-16 bg-base-200/30 border border-base-200 border-dashed rounded-2xl text-center">
              <div class="w-20 h-20 bg-base-100 rounded-full flex items-center justify-center shadow-sm mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </div>
              <h4 class="text-lg font-bold text-base-content mb-1">No Enrollments</h4>
              <p class="text-base-content/50 font-medium max-w-sm">There are no students currently enrolled in this course for the selected session.</p>
            </div>
          </div>
        </template>
      </div>
      <!-- Backdrop -->
      <form method="dialog" class="modal-backdrop bg-base-content/40" @click="closeModal">
        <button class="cursor-default text-transparent">close</button>
      </form>
    </dialog>
  </div>
</template>
