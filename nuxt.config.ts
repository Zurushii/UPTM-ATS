
import tailwindcss from "@tailwindcss/vite";
export default defineNuxtConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      baseURL: process.env.NUXT_PUBLIC_BASE_URL || "http://localhost:3000",
    },
  },
  css: ["./app/tailwind.css"],
});