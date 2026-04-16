/**
 * Next.js Edge Middleware — Operator Access Gate
 *
 * Protects internal operator pages and APIs behind a cookie-based
 * operator session. Public routes pass through unaffected.
 *
 * Protected pages: /jobs, /upload/[id]
 * Protected APIs: /api/intake/[id], /api/intake/[id]/*, /api/stsds-search,
 *                 /api/operator/storage-smoke, /api/operator/migrate-to-supabase,
 *                 /api/operator/verify-supabase-migration
 * Public: /, /upload (bare), /generate, /receipt, /api/intake (POST, no ID),
 *         /api/receipt, /api/generate-pdf, /api/operator/login, /api/operator/logout
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./lib/operator-session";

function isProtectedRoute(pathname: string): "page" | "api" | false {
  // /jobs and /jobs/*
  if (pathname === "/jobs" || pathname.startsWith("/jobs/")) return "page";

  // /upload/[id] — must have an ID segment after /upload/
  // Bare /upload is public (upload form)
  if (pathname.startsWith("/upload/") && pathname.length > "/upload/".length) {
    return "page";
  }

  // /api/intake/[id] and /api/intake/[id]/*
  // Public: POST /api/intake (no ID segment) — path is exactly /api/intake
  // Gated: /api/intake/<id> and /api/intake/<id>/<action>
  if (pathname.startsWith("/api/intake/")) {
    // After "/api/intake/" there must be at least one segment (the ID)
    const rest = pathname.slice("/api/intake/".length);
    if (rest.length > 0) return "api";
  }

  // /api/stsds-search
  if (pathname === "/api/stsds-search") return "api";

  // /api/operator/storage-smoke — operator-only smoke check
  if (pathname === "/api/operator/storage-smoke") return "api";

  // /api/operator/migrate-to-supabase — operator-only migration utility
  if (pathname === "/api/operator/migrate-to-supabase") return "api";

  // /api/operator/verify-supabase-migration — operator-only post-migration verification
  if (pathname === "/api/operator/verify-supabase-migration") return "api";

  return false;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const routeType = isProtectedRoute(pathname);

  if (!routeType) return NextResponse.next();

  const passphrase = process.env.OPERATOR_PASSPHRASE;
  if (!passphrase) {
    // Not configured — block all operator access
    if (routeType === "api") {
      return NextResponse.json(
        { error: "Operator access not configured." },
        { status: 503 }
      );
    }
    const loginUrl = new URL("/operator/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const cookie = request.cookies.get("operator_session")?.value;
  if (!cookie) {
    if (routeType === "api") {
      return NextResponse.json(
        { error: "Operator authentication required." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/operator/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const valid = await verifySessionCookie(cookie, passphrase);
  if (!valid) {
    if (routeType === "api") {
      return NextResponse.json(
        { error: "Operator authentication required." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/operator/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/jobs/:path*",
    "/upload/:path*",
    "/api/intake/:path*",
    "/api/stsds-search",
    "/api/operator/storage-smoke",
    "/api/operator/migrate-to-supabase",
    "/api/operator/verify-supabase-migration",
  ],
};
