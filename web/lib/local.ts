export function localRequest(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  return req.headers.get("x-disk-usage") === "studio";
}

export function refused() {
  return Response.json({ error: "This action is only available from the studio on this computer." }, { status: 403 });
}
