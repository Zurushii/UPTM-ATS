import { authClient } from "@@/utils/auth-client";

export default defineNuxtRouteMiddleware(async (to, from) => {
  // During `nuxt generate` prerender there are no user cookies; skip auth fetch/redirect.
  if (import.meta.server && import.meta.prerender) return;

  const userState = useState<any>("user", () => null);
  const { data: session } = await authClient.useSession(useFetch);

  if (!session.value) {
    userState.value = null;

    if (to.path.startsWith("/dashboard")) {
      return navigateTo("/sign-in");
    }
    return;
  }

  userState.value = session.value.user;

  // Redirect non-onboarded users to onboarding when accessing dashboard
  if (!session.value.user.is_onboarded && to.path.startsWith("/dashboard")) {
    return navigateTo("/onboarding");
  }
});
