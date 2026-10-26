/** Click a native dialog control on the explicitly selected disposable emulator. */
export async function tapAndroidControl(command: (...args: string[]) => Promise<string>, pattern: RegExp) {
  const path = `/data/local/tmp/lumiverse-native-smoke-${Date.now()}.xml`;
  const deadline = Date.now() + 15_000;
  try {
    while (Date.now() < deadline) {
      await command("shell", "uiautomator", "dump", path).catch(() => {});
      const xml = await command("shell", "cat", path);
      const node = xml.match(/<node\b[^>]*>/g)?.find(node => pattern.test(node));
      const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (bounds) {
        await command("shell", "input", "tap", String((Number(bounds[1]) + Number(bounds[3])) / 2), String((Number(bounds[2]) + Number(bounds[4])) / 2));
        return;
      }
      await Bun.sleep(100);
    }
    throw new Error(`Native dialog control did not appear: ${pattern}`);
  } finally { await command("shell", "rm", "-f", path); }
}
