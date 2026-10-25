import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isClerkConfigured } from "@/lib/clerk-env";

/**
 * Only Route Handler under `src/app/` (13 §13.2, TC-AUTH-11, TC-OPS-04, W1-6-r08).
 * Calls `auth()` and returns 401 JSON when no valid session exists.
 */
export async function GET(): Promise<NextResponse> {
  if (!isClerkConfigured()) {
    return NextResponse.json(
      { ok: false, error: "unauthenticated" },
      { status: 401 },
    );
  }
  try {
    const session = await auth();
    if (!session.userId) {
      return NextResponse.json(
        { ok: false, error: "unauthenticated" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: true, status: "healthy" },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthenticated" },
      { status: 401 },
    );
  }
}
