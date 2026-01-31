<script setup lang="ts">
import { ref } from "vue";

const drawerOpen = ref(false);
const isSidebarExpanded = ref(true);
</script>

<template>
  <div class="drawer lg:drawer-open">
    <!-- Drawer toggle -->
    <input
      id="dashboard-drawer"
      type="checkbox"
      class="drawer-toggle"
      v-model="drawerOpen"
    />

    <!-- Page content -->
    <div class="drawer-content flex flex-col min-h-screen bg-base-200 transition-all duration-300">
      <AppHeader />

      <main class="p-6 flex-1 flex flex-col">
        <NuxtPage />
      </main>

      <ThemeSwitcher />
    </div>

    <!-- Sidebar -->
    <div class="drawer-side z-40">
      <label
        for="dashboard-drawer"
        class="drawer-overlay"
        @click="drawerOpen = false"
      ></label>

      <SideNav 
        :expanded="isSidebarExpanded" 
        @toggle="isSidebarExpanded = !isSidebarExpanded" 
        @navigate="drawerOpen = false" 
      />
    </div>
  </div>
</template>
