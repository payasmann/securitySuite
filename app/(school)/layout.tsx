import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default async function SchoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Get school name for the topbar
  let schoolName = "InfoSec";
  if (session.user.schoolId) {
    try {
      const school = await prisma.school.findUnique({
        where: { id: session.user.schoolId },
        select: { name: true },
      });
      if (school) {
        schoolName = school.name;
      }
    } catch {
      // Fallback to default name if DB is unavailable
    }
  }

  return (
    <div className="min-h-screen bg-bg-app">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area (offset by sidebar width) */}
      <div className="ml-sidebar">
        {/* Topbar */}
        <Topbar schoolName={schoolName} />

        {/* Page content */}
        <main className="p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
