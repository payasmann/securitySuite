import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { assignableRoles } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import UserManagement from "@/components/users/UserManagement";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Only SCHOOL_ADMIN and SUPER_ADMIN can access this page
  if (session.user.role !== "SCHOOL_ADMIN" && session.user.role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const roles = assignableRoles(session.user.role as Role);

  return (
    <UserManagement
      currentUserId={session.user.id}
      assignableRoles={roles}
    />
  );
}
