export default defineNuxtRouteMiddleware(() => {
  const user = useState<any>("user");

  // auth.global.ts already handles unauthenticated users
  if (!user.value) {
    return;
  }

  if (user.value.role !== "HOP") {
    return navigateTo("/dashboard");
  }
});
