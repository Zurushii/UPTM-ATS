<script setup lang="ts">
import { useSession, authClient } from "@@/utils/auth-client";

const router = useRouter();
const session = ref<any>(null);

if (!(import.meta.server && import.meta.prerender)) {
  const { data } = await useSession(useFetch);
  watchEffect(() => {
    session.value = data.value;
  });
}



const signOut = async () => {
  await authClient.signOut();
  router.push("/sign-in");
};

const user = useState<any>("user");
</script>

<template>
  <div class="navbar bg-base-100/80 backdrop-blur-md border-b sticky top-0 z-30 transition-all duration-300">
    <!-- Navbar Start -->
    <div class="navbar-start">
      <label for="dashboard-drawer" class="btn btn-ghost btn-circle lg:hidden">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" /></svg>
      </label>
      <div class="flex flex-col ml-2">
        <h1 class="font-bold text-lg md:text-xl">UPTM ATS</h1>
        <p class="text-[10px] md:text-xs opacity-70 hidden sm:block">
          {{ user?.role === "HOP" ? "Head of Program Dashboard" : "Student Dashboard" }}
        </p>
      </div>
    </div>

    <!-- Navbar End -->
    <div class="navbar-end gap-2">

      
      <!-- Profile Content -->
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar online">
          <div class="w-10 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
            <img 
              :src="session?.user?.image || 'https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp'" 
              alt="Profile"
            />
          </div>
        </div>
        <ul tabindex="0" class="mt-3 z-[1] p-2 shadow menu menu-sm dropdown-content bg-base-100 rounded-box w-52">
          <li class="menu-title px-4 py-2">{{ session?.user?.email }}</li>
          <li><NuxtLink to="/dashboard/profile">Profile</NuxtLink></li>
          <li><button class="text-error" @click="signOut">Logout</button></li>
        </ul>
      </div>
    </div>
  </div>
</template>
