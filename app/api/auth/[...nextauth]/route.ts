// Google sign-in via NextAuth. Config lives in lib/auth.ts so server routes
// can share it via getServerSession(authOptions).

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
