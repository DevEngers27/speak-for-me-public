import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isClerkConfigured } from "@/lib/clerk-env";

// Optimistic page-level gate only. Authorization (membership, roles, private
// fields) is enforced in Convex functions, never here.
const isProtectedRoute = createRouteMatcher(["/rooms(.*)"]);

const withClerk = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isClerkConfigured()) {
    // Fail closed: protected pages are unreachable without auth configured.
    if (isProtectedRoute(request)) {
      const url = new URL("/setup", request.url);
      url.searchParams.set("missing", "clerk");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  return withClerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
