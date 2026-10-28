/** Only the native host can opt the authenticated backend into LAN listening. */
export function androidListener(env: Record<string, string | undefined>): { hostname: string; port?: number } {
  const value = env.LUMIVERSE_ANDROID_LISTEN_PORT;
  if (value === undefined) {
    const local = env.LUMIVERSE_ANDROID_LOCAL_PORT;
    if (local === undefined) return { hostname: "127.0.0.1" };
    if (!/^\d{4,5}$/.test(local) || Number(local) < 1024 || Number(local) > 65535)
      throw new Error("Invalid saved local server port.");
    return { hostname: "127.0.0.1", port: Number(local) };
  }
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error("Choose a hosting port between 1024 and 65535.");
  return { hostname: "0.0.0.0", port: Number(value) };
}
