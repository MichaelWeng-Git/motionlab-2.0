// Shared NextAuth config — used by the auth route AND by server routes that
// need to know who is signed in (getServerSession(authOptions)).

import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * An environment variable set to the EMPTY STRING is not the same as an unset
 * one, and NextAuth cannot tell the difference usefully: "" passes every
 * `?? fallback`, so a Google provider gets built with a blank client id and
 * the whole /api/auth handler answers 500 "There is a problem with the server
 * configuration" — for sign-in, for csrf, for everything.
 *
 * Vercel creates exactly that state: importing a project reads the names out of
 * .env.example and adds them with no values. next.config.mjs strips empties at
 * BUILD time, but a serverless function is handed the environment fresh at
 * RUNTIME, so it has to be done here too.
 */
const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v : undefined;
};

const googleId = env("GOOGLE_CLIENT_ID");
const googleSecret = env("GOOGLE_CLIENT_SECRET");
const nextAuthSecret = env("NEXTAUTH_SECRET");

/** Is Google sign-in actually usable? The login page asks, so it can say so
 *  instead of offering a button that answers 500. */
export const googleReady = Boolean(googleId && googleSecret && nextAuthSecret);

export const authOptions: AuthOptions = {
  // Only register the provider when it can actually work. A provider with a
  // blank client id takes the entire auth handler down with it.
  providers: googleId && googleSecret
    ? [GoogleProvider({ clientId: googleId, clientSecret: googleSecret })]
    : [],
  secret: nextAuthSecret,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
};
