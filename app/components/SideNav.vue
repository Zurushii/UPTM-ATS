<script setup lang="ts">
import { useRoute } from "#app";

const props = defineProps<{
  expanded: boolean;
}>();

const emit = defineEmits(["navigate", "toggle"]);
const route = useRoute();
const user = useState<any>("user");

const isActive = (basePath: string) => {
  if (basePath === "/dashboard") return route.path === "/dashboard";
  return route.path.startsWith(basePath);
};

const handleClick = () => emit("navigate");
const toggleSidebar = () => emit("toggle");
</script>

<template>
  <aside 
    class="bg-base-200 min-h-full flex flex-col gap-4 transition-all duration-300 ease-in-out"
    :class="expanded ? 'w-80 p-4' : 'w-20 p-2'"
  > 
    
    <!-- Menu -->
    <ul class="menu bg-base-100 w-full rounded-box shadow-sm gap-2 transition-all duration-300">
       <!-- Toggle Button (only visible on desktop mostly, but good to have) -->
       <li class="hidden lg:block">
          <button @click="toggleSidebar" class="flex justify-center items-center h-10">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 transition-transform duration-300" :class="{ 'rotate-180': !expanded }">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
       </li>

       <!-- Common -->
      <li>
        <NuxtLink 
          to="/dashboard" 
          @click="handleClick"
          :class="[{ 'active': isActive('/dashboard') }, expanded ? '' : 'justify-center']"
          class="flex items-center"
        >
          <span class="text-xl">📊</span>
          <span v-if="expanded" class="ml-3 truncate">Dashboard</span>
        </NuxtLink>
      </li>

       <!-- HoP Section -->
       <li v-if="user?.role === 'HOP' && expanded" class="menu-title transition-opacity duration-300">Management</li>
       <li v-else-if="user?.role === 'HOP' && !expanded" class="menu-title text-center px-0">M</li>
       
       <template v-if="user?.role === 'HOP'">
        <li>
          <NuxtLink 
            to="/dashboard/hop/students" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/hop/students') }, expanded ? '' : 'justify-center']"
            class="flex items-center"
            :title="!expanded ? 'Students' : ''"
          >
            <span class="text-xl">🎓</span> 
            <span v-if="expanded" class="ml-3 truncate">Students</span>
          </NuxtLink>
        </li>
        <li>
          <NuxtLink 
            to="/dashboard/hop/intake-assessment" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/hop/intake-assessment') }, expanded ? '' : 'justify-center']"
            class="flex items-center"
            :title="!expanded ? 'Intake Assessment' : ''"
          >
            <span class="text-xl">📋</span> 
            <span v-if="expanded" class="ml-3 truncate">Intake Assessment</span>
          </NuxtLink>
        </li>
        <li>
          <NuxtLink 
            to="/dashboard/hop/semester-rules" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/hop/semester-rules') }, expanded ? '' : 'justify-center']"
             class="flex items-center"
             :title="!expanded ? 'Semester Rules' : ''"
          >
            <span class="text-xl">📐</span> 
            <span v-if="expanded" class="ml-3 truncate">Semester Rules</span>
          </NuxtLink>
        </li>
        <li>
           <NuxtLink 
            to="/dashboard/hop/program-structure" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/hop/program-structure') }, expanded ? '' : 'justify-center']"
             class="flex items-center"
             :title="!expanded ? 'Program Structure' : ''"
          >
            <span class="text-xl">📚</span> 
            <span v-if="expanded" class="ml-3 truncate">Program Structure</span>
          </NuxtLink>
        </li>
        <li>
          <NuxtLink 
            to="/dashboard/hop/academic-planning" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/hop/academic-planning') }, expanded ? '' : 'justify-center']"
             class="flex items-center"
             :title="!expanded ? 'Academic Planning' : ''"
          >
            <span class="text-xl">🗂</span> 
            <span v-if="expanded" class="ml-3 truncate">Academic Planning</span>
          </NuxtLink>
        </li>
       </template>

       <!-- Student Section -->
       <li v-if="user?.role === 'STUDENT' && expanded" class="menu-title transition-opacity duration-300">Academic</li>
       <li v-else-if="user?.role === 'STUDENT' && !expanded" class="menu-title text-center px-0">A</li>

       <template v-if="user?.role === 'STUDENT'">
         <li>
          <NuxtLink 
            to="/dashboard/student/academic-plan" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/student/academic-plan') }, expanded ? '' : 'justify-center']"
             class="flex items-center"
             :title="!expanded ? 'My Academic Plan' : ''"
          >
            <span class="text-xl">📘</span> 
            <span v-if="expanded" class="ml-3 truncate">My Academic Plan</span>
          </NuxtLink>
         </li>
       </template>

       <!-- Common Profile -->
       <li class="mt-auto"></li> <!-- Spacer -->
       <li>
          <NuxtLink 
            to="/dashboard/profile" 
            @click="handleClick" 
            :class="[{ 'active': isActive('/dashboard/profile') }, expanded ? '' : 'justify-center']"
             class="flex items-center"
             :title="!expanded ? 'My Profile' : ''"
          >
            <span class="text-xl">👤</span> 
            <span v-if="expanded" class="ml-3 truncate">My Profile</span>
          </NuxtLink>
       </li>
    </ul>
  </aside>
</template>
