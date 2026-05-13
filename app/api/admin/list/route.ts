import { NextResponse, type NextRequest } from "next/server";
import { assertAdminRole } from "@/lib/admin/auth";
import {
  DEFAULT_PAGE_SIZE,
  fetchPaginatedResource,
  isPaginatedResource,
} from "@/lib/admin/list";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertAdminRole(["superadmin", "agronomist", "curator", "translator", "viewer"]);

    const params = request.nextUrl.searchParams;
    const resource = params.get("resource") ?? "";
    if (!isPaginatedResource(resource)) {
      return NextResponse.json({ error: `Unknown resource: ${resource}` }, { status: 400 });
    }

    const page = Number(params.get("page") ?? 0);
    const pageSize = Number(params.get("pageSize") ?? DEFAULT_PAGE_SIZE);

    const result = await fetchPaginatedResource(resource, {
      page: Number.isFinite(page) ? page : 0,
      pageSize: Number.isFinite(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
      filters: {
        type: params.get("type") ?? undefined,
        status: params.get("status") ?? undefined,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list admin resource." },
      { status: 500 },
    );
  }
}
