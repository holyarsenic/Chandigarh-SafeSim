
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { query } from "@/lib/database";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) {
        return false;
      }

      await query(
        `INSERT INTO users (name, email, image)
         VALUES ($1, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET
           name = EXCLUDED.name,
           image = EXCLUDED.image`,
        [user.name ?? null, user.email, user.image ?? null]
      );

      return true;
    },
  },
});
