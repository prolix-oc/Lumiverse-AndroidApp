import { expect, test } from "bun:test";
import { importActivityFromMessage, importCancellation } from "../android/import-protocol";

test("accepts only authenticated backend activity and forwards bounded public progress fields", () => {
  const message = { type: "android-import", token: "private", activity: { jobId: "job-1", status: "running", phase: "extracting", bytesProcessed: 10, bytesTotal: 20, secret: "never-forward" } };
  expect(importActivityFromMessage(message, "different")).toBeNull();
  expect(importActivityFromMessage({ ...message, type: "log" }, "private")).toBeNull();
  expect(importActivityFromMessage(message, "private")).toEqual({ jobId: "job-1", status: "running", phase: "extracting", bytesProcessed: 10, bytesTotal: 20 });
  expect(importActivityFromMessage({ ...message, activity: { ...message.activity, jobId: "../other", bytesTotal: Infinity } }, "private")).toBeNull();
});

test("native stdin only accepts cancellation for a bounded job identity", () => {
  expect(importCancellation('{"action":"cancel-import","jobId":"job-1"}')).toBe("job-1");
  for (const line of ["{}", "not json", '{"action":"shutdown","jobId":"job-1"}', '{"action":"cancel-import","jobId":"../other"}', " ".repeat(1025)]) expect(importCancellation(line)).toBeNull();
});
