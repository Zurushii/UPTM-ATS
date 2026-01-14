import { authClient } from "@@/utils/auth-client";

export default defineNuxtRouteMiddleware(async (to, from) => {
  const userState = useState<any>("user", () => null);
  const { data: session } = await authClient.useSession(useFetch);
  if (!session.value) {
    userState.value = null;

    if (to.path === "/dashboard") {
      return navigateTo("/sign-in");
    }
    return;
  }
  userState.value = session.value.user;
});
