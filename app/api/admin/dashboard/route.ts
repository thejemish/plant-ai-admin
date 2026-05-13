import { NextResponse } from "next/server";
import { assertAdminRole } from "@/lib/admin/auth";
import { getAdminDashboardData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await assertAdminRole(["superadmin", "agronomist", "curator", "translator", "viewer"]);
    const data = await getAdminDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load admin dashboard data." },
      { status: 500 },
    );
  }
}
