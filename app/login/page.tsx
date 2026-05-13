import { redirect } from "next/navigation";
import { signInAdmin } from "@/app/login/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdminSession } from "@/lib/admin/auth";
import { hasSupabaseAuthConfig } from "@/lib/admin/supabase";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

const loginErrors: Record<string, string> = {
  config: "Admin auth is not fully configured. Set Supabase Auth and the service role key.",
  forbidden: "That account is signed in, but it is not listed in admin_users.",
  invalid: "Email or password is incorrect.",
  missing: "Email and password are required.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const adminSession = await getAdminSession();

  if (adminSession.status === "signed-in") {
    redirect("/");
  }

  const params = await searchParams;
  const errorMessage = params?.error ? loginErrors[params.error] : null;

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardDescription>Plant-AI Admin</CardDescription>
          <CardTitle className="text-2xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
        {adminSession.status === "forbidden" ? (
          <Alert variant="destructive">
            <AlertDescription>
              The current session for {adminSession.email ?? "this user"} is not authorized for the
              admin console. Sign in with an account listed in admin_users.
            </AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {hasSupabaseAuthConfig && adminSession.status !== "unconfigured" ? (
          <form action={signInAdmin} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                required
                type="email"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                required
                type="password"
              />
            </div>
            <Button className="w-full" type="submit">
              Sign in
            </Button>
          </form>
        ) : (
          <Alert>
            <AlertDescription>
              {adminSession.status === "unconfigured"
                ? adminSession.reason
                : "Supabase Auth is not configured. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`."}
            </AlertDescription>
          </Alert>
        )}
        </CardContent>
      </Card>
    </main>
  );
}
