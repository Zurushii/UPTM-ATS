<script setup lang="ts">
import * as XLSX from "xlsx";

type CreditRow = {
  matric_no: string;
  intake_year: string;
  total_credit_transferred: number;
};

const emit = defineEmits<{
  (e: "parsed", data: CreditRow[]): void;
}>();

const rows = ref<CreditRow[]>([]);
const error = ref<string | null>(null);

const REQUIRED_COLUMNS = [
  "matric_no",
  "intake_year",
  "total_credit_transferred",
];

// MMYY where MM = 05 | 08 | 12
const INTAKE_REGEX = /^(05|08|12)\d{2}$/;

const handleFileChange = async (e: Event) => {
  error.value = null;
  rows.value = [];

  const target = e.target as HTMLInputElement;
  if (!target.files || !target.files.length) return;

  const selectedFile = target.files[0];
  const extension = selectedFile.name.split(".").pop()?.toLowerCase();

  if (!["xlsx", "csv"].includes(extension || "")) {
    error.value = "Only .xlsx or .csv files are allowed.";
    return;
  }

  const data = await selectedFile.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

  if (!json.length) {
    error.value = "File is empty.";
    return;
  }

  // Validate required columns
  const firstRow = json[0];
  for (const col of REQUIRED_COLUMNS) {
    if (!(col in firstRow)) {
      error.value = `Missing required column: ${col}`;
      return;
    }
  }

  const parsed: CreditRow[] = [];

  for (const row of json) {
    const matric_no = String(row.matric_no).trim();
    const intake_year = String(row.intake_year).trim();
    const credit = Number(row.total_credit_transferred);

    if (
      !matric_no ||
      !INTAKE_REGEX.test(intake_year) ||
      isNaN(credit) ||
      credit < 0
    ) {
      continue;
    }

    parsed.push({
      matric_no,
      intake_year,
      total_credit_transferred: credit,
    });
  }

  if (!parsed.length) {
    error.value =
      "All rows are invalid. Intake must follow MMYY format and use valid intake months (05, 08, 12).";
    return;
  }

  rows.value = parsed;
  emit("parsed", parsed);
};
</script>

<template>
  <div class="space-y-4">
    <!-- Upload box -->
    <div class="border-2 border-dashed rounded-lg p-6 text-center bg-base-100">
      <input
        type="file"
        accept=".xlsx,.csv"
        class="hidden"
        id="credit-upload"
        @change="handleFileChange"
      />

      <label for="credit-upload" class="cursor-pointer">
        <p class="font-medium">Upload Credit Transfer File</p>
        <p class="text-sm text-gray-500 mt-1">Accepted formats: .xlsx, .csv</p>
      </label>
    </div>

    <!-- Error -->
    <div v-if="error" class="text-error text-sm">
      {{ error }}
    </div>

    <!-- Preview -->
    <div v-if="rows.length" class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Matric No</th>
            <th>Intake</th>
            <th>Total Credit Transferred</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(row, index) in rows" :key="index">
            <td>{{ row.matric_no }}</td>
            <td>{{ row.intake_year }}</td>
            <td>{{ row.total_credit_transferred }}</td>
          </tr>
        </tbody>
      </table>

      <p class="text-xs text-gray-500 mt-2">
        {{ rows.length }} valid records detected
      </p>
    </div>
  </div>
</template>
