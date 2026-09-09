import { hasAdminAccess, login, logout } from "../../../lib/auth";
export const runtime = "nodejs";
export function GET(req: Request) {
  return Response.json({ authenticated: hasAdminAccess(req) });
}
export const POST = login;
export const DELETE = logout;
