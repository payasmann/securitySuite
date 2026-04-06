import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import AlertsList from "@/components/alerts/AlertsList";

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canResolve = hasPermission(session.user.role as Role, "canResolveAlerts");

  return <AlertsList canResolve={canResolve} />;
}
