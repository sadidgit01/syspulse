import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { SessionProvider } from "@/components/providers/session-provider";
import { getAuthSession } from "@/lib/auth";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAuthSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-transparent lg:grid lg:grid-cols-[272px_1fr]">
        <Sidebar />
        <div className="flex min-h-screen flex-col">
          <Topbar />
          <main className="flex-1 px-4 pb-8 pt-4 sm:px-6 lg:px-10">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
