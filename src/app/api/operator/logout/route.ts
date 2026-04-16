/**
 * POST /api/operator/logout
 *
 * Clears the operator session cookie.
 */

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    "operator_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  );
  return response;
}
