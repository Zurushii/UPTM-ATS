import { betterAuth } from "better-auth";
import { createPool } from "mysql2/promise";

export const auth = betterAuth({
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
    },
  },
});
