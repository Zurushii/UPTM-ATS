<script setup lang="ts">
import { authClient } from "@@/utils/auth-client";
import CreditTransferUpload from "@/components/hop/CreditTransferUpload.vue";

definePageMeta({
  layout: "dashboard",
  middleware: ["hop"],
});

// Session check
const { data: session } = await authClient.useSession(useFetch);
if (!session.value) {
  await navigateTo("/sign-in");
}

const submitting = ref(false);
const apiResult = ref<any>(null);
const apiError = ref<string | null>(null);

type CreditRow = {
  matric_no: string;
  intake_year: string;
  total_credit_transferred: number;
};

const parsedData = ref<CreditRow[]>([]);

const handleParsed = (data: CreditRow[]) => {
  parsedData.value = data;
  console.log("Parsed credit transfer data:", data);
};

const submitToServer = async () => {
  submitting.value = true;
  apiError.value = null;
  apiResult.value = null;

  try {
    const result = await $fetch("/api/hop/credit-transfer/bulk", {
      method: "POST",
      body: {
        records: parsedData.value,
      },
    });

    apiResult.value = result;
    console.log("API result:", result);
  } catch (err: any) {
    apiError.value =
      err?.data?.statusMessage || err?.message || "Upload failed";
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div class="p-6 max-w-4xl space-y-6">
    <!-- Page Header -->
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Credit Transfer Upload</h1>
      <p class="text-sm text-base-content/60">
        Upload a spreadsheet containing students’ transferred credit hours.
      </p>
    </div>

    <!-- Upload Card -->
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body space-y-4">
        <h2 class="font-medium">Upload credit transfer file</h2>

        <!-- Upload Component -->
        <CreditTransferUpload @parsed="handleParsed" />
        <!-- Submit Button -->
        <div v-if="parsedData.length" class="flex gap-3">
          <button
            class="btn btn-primary"
            :disabled="submitting"
            @click="submitToServer"
          >
            {{ submitting ? "Uploading..." : "Submit to Server" }}
          </button>
        </div>

        <!-- API Error -->
        <div v-if="apiError" class="text-error text-sm">
          {{ apiError }}
        </div>

        <!-- API Result Preview -->
        <div
          v-if="apiResult"
          class="bg-base-200 rounded-lg p-4 text-sm space-y-2"
        >
          <p class="font-medium">API Result (Debug)</p>

          <pre class="text-xs overflow-x-auto"
            >{{ JSON.stringify(apiResult, null, 2) }}
  </pre
          >
        </div>

        <!-- TEMP Preview -->
        <div
          v-if="parsedData.length"
          class="bg-base-200 rounded-lg p-4 text-sm"
        >
          <p class="font-medium mb-2">Temporary Parsed Preview (Debug)</p>

          <pre class="text-xs overflow-x-auto"
            >{{ JSON.stringify(parsedData, null, 2) }}
          </pre>
        </div>

        <!-- Info -->
        <div class="text-sm text-base-content/60">
          A standardized template will be provided by the system to ensure
          correct data mapping and processing.
        </div>
      </div>
    </div>
  </div>
</template>
