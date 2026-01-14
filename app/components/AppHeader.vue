<script setup lang="ts">
import { useSession, authClient } from "@@/utils/auth-client";

const router = useRouter();
const { data: session } = await useSession(useFetch);

defineProps<{
  drawerOpen: boolean;
}>();

defineEmits(["update:drawerOpen"]);

const signOut = async () => {
  await authClient.signOut();
  router.push("/sign-in");
};

const user = useState<any>("user");
</script>

<template>
  <header
    class="h-16 bg-base-100 border-b flex items-center justify-between px-4 sm:px-6"
  >
    <!-- Left -->
    <div class="flex items-center gap-3">
      <!-- Mobile drawer toggle -->
      <label class="btn btn-ghost btn-sm btn-circle lg:hidden">
        <input
          type="checkbox"
          :checked="drawerOpen"
          class="hidden"
          @change="$emit('update:drawerOpen', !drawerOpen)"
        />
        ☰
      </label>

      <div class="leading-tight">
        <h1 class="font-semibold text-base">UPTM Academic Tracking System</h1>
        <p class="text-xs text-gray-500">
          {{ user?.role === "HOP" ? "Head of Program Dashboard" : "Student Dashboard" }}
        </p>
      </div>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-3">
      <ThemeSwitcher />

      <!-- Profile -->
      <div class="dropdown dropdown-end">
        <label tabindex="0" class="btn btn-ghost btn-circle avatar">
          <div class="w-9 rounded-full overflow-hidden">
            <img
              :src="session?.user?.image || '/avatar-placeholder.png'"
              alt="Profile"
              class="w-full h-full object-cover"
            />
          </div>
        </label>

        <ul
          tabindex="0"
          class="menu menu-sm dropdown-content mt-3 bg-base-100 rounded-box w-52 shadow"
        >
          <li class="px-3 py-2 text-xs text-gray-500">
            {{ session?.user?.email }}
          </li>
          <li><NuxtLink to="/dashboard/settings">Settings</NuxtLink></li>
          <li>
            <button class="text-error" @click="signOut">
              Logout
            </button>
          </li>
        </ul>
      </div>
    </div>
  </header>
</template>
