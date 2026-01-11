<script setup lang="ts">
import { useSession, authClient } from "@@/utils/auth-client";

const { data: session } = await useSession(useFetch);
const router = useRouter();

const signOut = async () => {
  await authClient.signOut();
  router.push("/sign-up");
};
</script>

<template>
  <div
    class="min-h-[80vh] flex items-center justify-center px-6 md:px-0 bg-gray-50"
  >
    <div class="w-[350px] rounded-xl border bg-white shadow-sm">
      <!-- Header -->
      <div class="border-b px-6 py-4">
        <h2 class="text-lg font-semibold text-gray-800">User</h2>
      </div>

      <!-- Content -->
      <div class="px-6 py-4">
        <div class="flex items-center gap-3">
          <!-- Avatar -->
          <div
            class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden"
          >
            <img
              v-if="session?.user?.image"
              :src="session.user.image"
              alt="User profile"
              class="h-full w-full object-cover"
            />
            <span
              v-else
              class="text-sm font-medium text-gray-600"
            >
              {{ session?.user?.name?.[0] }}
            </span>
          </div>

          <!-- User Info -->
          <div>
            <p class="text-sm font-medium text-gray-900">
              {{ session?.user?.name }}
            </p>
            <p class="text-xs text-gray-500">
              {{ session?.user?.email }}
            </p>
          </div>
        </div>

        <!-- Session Debug -->
        <pre
          class="mt-4 rounded bg-gray-100 p-2 text-xs text-gray-700 overflow-auto"
        >
{{ JSON.stringify(session?.session, null, 2) }}
        </pre>
      </div>

      <!-- Footer -->
      <div class="border-t px-6 py-4">
        <button
          @click="signOut"
          class="w-full rounded-md bg-gray-100 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200 transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  </div>
</template>
