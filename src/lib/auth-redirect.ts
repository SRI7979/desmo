/** Keep untrusted form/query values from becoming open redirects. */
export function safeAuthRedirect(value: unknown): string {
  if (typeof value !== "string") return "/solve";
  if (value === "/solve" || value === "/history" || value === "/tricks" || value === "/settings") return value;
  if (/^\/history\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  return "/solve";
}
