import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Request gate for the no-account, single-workspace design.
 *
 * There are no user accounts. The "shared-web" principal is NOT authenticated
 * identity — the Origin / Sec-Fetch-Site checks below are CSRF/request shaping
 * only. Any visitor who can reach the deployed app can call the shared browser
 * APIs; a direct HTTP client can too by sending matching headers. The only
 * verified principal is "machine" (Kylon), which must present the BILADS_API_KEY
 * bearer token.
 */
export type ApiPrincipal =
  | { kind: "shared-web"; subject: "shared-web" }
  | { kind: "machine"; subject: "kylon" };

export type AuthorizationResult =
  | { principal: ApiPrincipal; response?: never }
  | { principal?: never; response: NextResponse };

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function denied(message: string, status = 401): AuthorizationResult {
  return { response: NextResponse.json({ error: message }, { status }) };
}

/** Exact Origin the browser UI is served from. Localhost only in development. */
function expectedOrigin(): string | null {
  const configured = process.env.BILADS_APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return process.env.NODE_ENV === "development" ? "http://localhost:3000" : null;
}

function browserRequestAllowed(req: NextRequest): AuthorizationResult | null {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return denied("Cross-site requests are not allowed", 403);
  }

  const origin = req.headers.get("origin");
  const method = req.method.toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";

  if (mutating) {
    const expected = expectedOrigin();
    if (!expected) {
      return denied("BILADS_APP_ORIGIN is not configured on the server", 403);
    }
    if (origin !== expected) return denied("Request Origin is not allowed", 403);
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return denied("Content-Type must be application/json", 415);
    }
  } else if (origin) {
    const expected = expectedOrigin();
    if (!expected || origin !== expected) return denied("Request Origin is not allowed", 403);
  }

  return null;
}

export async function authorizeApiRequest(
  req: NextRequest,
  options: { allowBrowser?: boolean; allowMachine?: boolean } = {}
): Promise<AuthorizationResult> {
  const allowBrowser = options.allowBrowser ?? true;
  const allowMachine = options.allowMachine ?? false;
  const authorization = req.headers.get("authorization");

  // A supplied bearer credential is always evaluated as a machine credential.
  // It never falls back to the shared-web rules.
  if (authorization !== null) {
    if (!authorization.startsWith("Bearer ")) return denied("Invalid bearer credential");
    const configured = process.env.BILADS_API_KEY?.trim();
    const presented = authorization.slice("Bearer ".length);
    if (!allowMachine || !configured || !constantTimeEqual(presented, configured)) {
      return denied("Invalid bearer credential");
    }
    return { principal: { kind: "machine", subject: "kylon" } };
  }

  if (!allowBrowser) return denied("Machine bearer credential required");
  const rejected = browserRequestAllowed(req);
  if (rejected) return rejected;
  return { principal: { kind: "shared-web", subject: "shared-web" } };
}

export async function authorizeMachineRequest(req: NextRequest): Promise<AuthorizationResult> {
  return authorizeApiRequest(req, { allowBrowser: false, allowMachine: true });
}
