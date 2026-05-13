import { Leaf, LockKeyhole, UserRound, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { signOutAdmin } from "@/app/login/actions";
import { MobileSectionNav, SidebarNav } from "@/components/admin/sidebar-nav";
import { PageTitle } from "@/components/admin/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminSession } from "@/lib/admin/auth";

export async function AdminShell({ children }: { children: React.ReactNode }) {
  const adminSession = await getAdminSession();

  if (adminSession.status === "signed-out") {
    redirect("/login");
  }

  if (adminSession.status === "forbidden") {
    return (
      <AccessGate
        icon={LockKeyhole}
        message="This account is signed in but is not listed in admin_users."
        title="No admin role"
      >
        <form action={signOutAdmin}>
          <Button type="submit">Sign out</Button>
        </form>
      </AccessGate>
    );
  }

  if (adminSession.status === "unconfigured") {
    return (
      <AccessGate
        icon={LockKeyhole}
        message={adminSession.reason}
        title="Admin auth is not configured"
      />
    );
  }

  const roleLabel = adminSession.role;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh max-h-dvh border-r bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-3 border-b px-4">
            <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Leaf className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Plant-AI Admin</p>
              <p className="truncate text-xs text-sidebar-foreground/65">Knowledge operations</p>
            </div>
          </div>
          <SidebarNav />
          <div className="border-t p-3">
            <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-background text-foreground">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{roleLabel}</p>
                <p className="truncate text-xs text-sidebar-foreground/65">Admin console</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                <Leaf className="size-4 text-primary" />
                <span className="text-sm font-semibold">Plant-AI Admin</span>
              </div>
              <PageTitle />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{roleLabel}</Badge>
              {adminSession.status === "signed-in" ? (
                <form action={signOutAdmin}>
                  <Button type="submit" variant="outline">
                    Sign out
                  </Button>
                </form>
              ) : null}
            </div>
          </header>
          <MobileSectionNav />
          <div className="mx-auto flex w-full flex-col gap-6 p-4 md:p-6">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function AccessGate({
  children,
  icon: Icon,
  message,
  title,
}: {
  children?: React.ReactNode;
  icon: LucideIcon;
  message: string;
  title: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icon className="size-5" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          {children ?? (
            <Button asChild>
              <a href="/login">Open sign in</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
