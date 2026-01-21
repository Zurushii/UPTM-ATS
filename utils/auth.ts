import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { createPool } from "mysql2/promise";
import { customSession } from "better-auth/plugins";

const baseOptions = {
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh expiry every 1 day of use
    freshAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
      strategy: "compact",
    },
  },
  database: createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: "Z",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BASE_URL,
  emailAndPassword: {
    enabled: true,
    async sendResetPassword(url, user) {
      console.log("Reset password url:", url);
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      mapProfileToUser: () => {
        return {
          role: "STUDENT",
        };
      },
    },
  },
  user: {
    additionalFields: {
      role: {
        type: ["STUDENT", "HOP"],
        required: true,
        defaultValue: "STUDENT",
        input: false, // don't allow user to set role
      },
      is_onboarded: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...baseOptions,
  plugins: [
    customSession(async ({ user, session }) => {
      const roles = await findUserRoles(session.userId);
      return {
        roles,
        user,
        session,
      };
    }, baseOptions),
  ],
});

const findUserRoles = async (userId: string) => {
  // Your logic to find roles
  return ["STUDENT", "HOP"];
};
