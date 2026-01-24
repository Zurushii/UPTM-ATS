<script setup lang="ts">
import { useRoute } from "#app";

const emit = defineEmits(["navigate"]);
const route = useRoute();
const user = useState<any>("user");

const isActive = (basePath: string) => {
  if (basePath === "/dashboard") return route.path === "/dashboard";
  return route.path.startsWith(basePath);
};

const handleClick = () => emit("navigate");
</script>

<template>
  <aside class="w-64 bg-base-100 min-h-full border-r flex flex-col">
    <!-- Brand -->
    <div class="h-16 flex items-center px-6 border-b">
      <div>
        <h2 class="font-semibold text-sm">UPTM ATS</h2>
        <p class="text-xs text-gray-500">
          {{ user?.role === "HOP" ? "Head of Program" : "Student" }}
        </p>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-4 space-y-1 text-sm">
      <!-- Common -->
      <NuxtLink
        to="/dashboard"
        @click="handleClick"
        class="flex items-center gap-3 px-3 py-2 rounded-md transition"
        :class="
          isActive('/dashboard')
            ? 'bg-primary text-primary-content font-medium'
            : 'hover:bg-base-200'
        "
      >
        📊 Dashboard
      </NuxtLink>

      <!-- HoP -->
      <template v-if="user?.role === 'HOP'">
        <div class="mt-4 px-3 text-xs text-gray-500 uppercase">Management</div>

        <NuxtLink
          to="/dashboard/hop/students"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/hop/students')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          🎓 Students
        </NuxtLink>

        <NuxtLink
          to="/dashboard/hop/intake-assessment"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/hop/intake-assessment')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          📋 Intake Assessment
        </NuxtLink>

        <NuxtLink
          to="/dashboard/hop/semester-rules"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/hop/semester-rules')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          📐 Semester Rules
        </NuxtLink>

        <NuxtLink
          to="/dashboard/hop/program-structure"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/hop/program-structure')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          📚 Program Structure
        </NuxtLink>

        <NuxtLink
          to="/dashboard/hop/academic-planning"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/hop/academic-planning')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          🗂 Academic Planning
        </NuxtLink>

        <NuxtLink
          to="/dashboard/profile"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/profile')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          👤 My Profile
        </NuxtLink>
      </template>

      <!-- Student -->
      <template v-if="user?.role === 'STUDENT'">
        <div class="mt-4 px-3 text-xs text-gray-500 uppercase">Academic</div>

        <NuxtLink
          to="/dashboard/student/academic-plan"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/student/academic-plan')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          📘 My Academic Plan
        </NuxtLink>

        <NuxtLink
          to="/dashboard/profile"
          @click="handleClick"
          class="flex items-center gap-3 px-3 py-2 rounded-md transition"
          :class="
            isActive('/dashboard/profile')
              ? 'bg-primary text-primary-content font-medium'
              : 'hover:bg-base-200'
          "
        >
          👤 My Profile
        </NuxtLink>
      </template>
    </nav>
  </aside>
</template>
