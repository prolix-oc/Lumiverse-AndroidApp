/** Only the native host can opt the authenticated backend into LAN listening. */
export function androidListener(env: Record<string, string | undefined>): { hostname: string; port?: number } {
  const value = env.LUMIVERSE_ANDROID_LISTEN_PORT;
  if (value === undefined) return { hostname: "127.0.0.1" };
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error("Choose a hosting port between 1024 and 65535.");
  return { hostname: "0.0.0.0", port: Number(value) };
}
