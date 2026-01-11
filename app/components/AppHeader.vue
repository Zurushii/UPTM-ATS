<script setup lang="ts">
import { useSession, authClient } from "@@/utils/auth-client";
const router = useRouter();

const { data: session } = await useSession(useFetch);
defineProps<{
  drawerOpen: boolean;
}>();

const signOut = async () => {
  await authClient.signOut();
  router.push("/sign-up");
};

defineEmits(["update:drawerOpen"]);
</script>

<template>
  <header
    class="h-16 bg-base-100 border-b px-4 flex items-center justify-between"
  >
    <!-- Left -->
    <div class="flex items-center gap-2">
      <!-- Burger (mobile only) -->
      <label class="btn btn-ghost btn-circle swap swap-rotate lg:hidden">
        <input
          type="checkbox"
          :checked="drawerOpen"
          @change="$emit('update:drawerOpen', !drawerOpen)"
        />

        <!-- hamburger -->
        <svg
          class="swap-off fill-current"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 512 512"
        >
          <path
            d="M64,384H448V341.33H64Zm0-106.67H448V234.67H64ZM64,128v42.67H448V128Z"
          />
        </svg>

        <!-- close -->
        <svg
          class="swap-on fill-current"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 512 512"
        >
          <polygon
            points="400 145.49 366.51 112 256 222.51 145.49 112
                    112 145.49 222.51 256 112 366.51
                    145.49 400 256 289.49 366.51 400
                    400 366.51 289.49 256"
          />
        </svg>
      </label>

      <span class="font-semibold text-lg hidden sm:block"> ATS Dashboard </span>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-4">
      <ThemeSwitcher />

      <!-- profile dropdown (unchanged) -->
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
          class="menu menu-sm dropdown-content bg-base-100 rounded-box w-52 shadow"
        >
          <li><NuxtLink to="/dashboard/settings">Settings</NuxtLink></li>
          <li><button class="text-error" @click="signOut">Logout</button></li>
        </ul>
      </div>
    </div>
  </header>
</template>
