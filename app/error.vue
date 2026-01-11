<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{
  error: NuxtError;
}>();

const statusCode = computed(() => props.error.statusCode || 500);

const titleMap: Record<number, string> = {
  404: "Page not found",
  401: "Unauthorized",
  403: "Access denied",
  500: "Something went wrong",
};

const descriptionMap: Record<number, string> = {
  404: "The page you are looking for doesn’t exist or has been moved.",
  401: "You don’t have permission to view this page.",
  403: "You are not allowed to access this resource.",
  500: "An unexpected error occurred. Please try again later.",
};

const title = computed(
  () => titleMap[statusCode.value] || "Unexpected error"
);

const description = computed(
  () =>
    descriptionMap[statusCode.value] ||
    "An unexpected error occurred. Please try again."
);
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-base-200 p-6">
    <div class="card bg-base-100 shadow-xl max-w-md w-full">
      <div class="card-body text-center space-y-4">
        <!-- Status code -->
        <h1 class="text-6xl font-bold text-primary">
          {{ statusCode }}
        </h1>

        <!-- Title -->
        <h2 class="text-2xl font-semibold">
          {{ title }}
        </h2>

        <!-- Description -->
        <p class="opacity-70">
          {{ description }}
        </p>

        <!-- Actions -->
        <div class="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <NuxtLink to="/dashboard" class="btn btn-primary">
            Go to Dashboard
          </NuxtLink>

          <button
            class="btn btn-ghost"
            @click="$router.back()"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
