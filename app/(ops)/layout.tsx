import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import OpsSidebar from "@/components/layout/OpsSidebar";
import OpsTopbar from "@/components/layout/OpsTopbar";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Only SUPER_ADMIN and OPS_VIEWER can access ops portal
  const { role } = session.user;
  if (role !== "SUPER_ADMIN" && role !== "OPS_VIEWER") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-bg-app">
      <OpsSidebar />
      <div className="ml-sidebar">
        <OpsTopbar />
        <main className="p-5">{children}</main>
      </div>
    </div>
  );
}
