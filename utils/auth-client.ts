import { createAuthClient } from "better-auth/vue";
import { customSessionClient } from "better-auth/client/plugins";
import type { auth } from "@@/utils/auth";

export const authClient = createAuthClient({
  plugins: [customSessionClient<typeof auth>()],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  requestPasswordReset,
  resetPassword,
  changePassword,
} = authClient;
