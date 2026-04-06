import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";

// ─── Type Augmentation ──────────────────────────────────

declare module "next-auth" {
  interface User {
    role: Role;
    schoolId: string | null;
    active: boolean;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      schoolId: string | null;
      active: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    schoolId: string | null;
    active: boolean;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            role: true,
            schoolId: true,
            active: true,
          },
        });

        if (!user) {
          throw new Error("Invalid email or password");
        }

        if (!user.active) {
          throw new Error("Account is deactivated. Contact your administrator.");
        }

        const isPasswordValid = await compare(password, user.password);

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          schoolId: user.schoolId,
          active: user.active,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as Role;
        token.schoolId = user.schoolId as string | null;
        token.active = user.active as boolean;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.schoolId = token.schoolId as string | null;
      session.user.active = token.active as boolean;
      return session;
    },
    async authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      // Public routes that don't require authentication
      const publicRoutes = ["/login", "/api/health"];
      if (publicRoutes.some((route) => pathname.startsWith(route))) {
        return true;
      }

      // All other routes require authentication
      if (!isLoggedIn) {
        return false;
      }

      return true;
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
