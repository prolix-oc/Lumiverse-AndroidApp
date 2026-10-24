import { expect, test } from "bun:test";
import { assertBackendRevision, parseBackendSource, readBackendSource } from "./backend-source";

const pin = { repository: "prolix-oc/Lumiverse", ref: "a".repeat(40) };

test("CI dependency pins require a repository and immutable full commit", () => {
  expect(parseBackendSource(pin)).toEqual(pin);
  for (const value of [null, {}, { ...pin, ref: "main" }, { ...pin, ref: "abc1234" },
    { ...pin, repository: "https://github.com/owner/repo" }, { ...pin, repository: "owner/repo\nref=main" }])
    expect(() => parseBackendSource(value)).toThrow("full 40-character commit SHA");
  expect(parseBackendSource(readBackendSource()).ref).toHaveLength(40);
});

test("a missing or different integration revision fails instead of skipping", () => {
  expect(() => assertBackendRevision(pin.ref, pin.ref)).not.toThrow();
  expect(() => assertBackendRevision(pin.ref, "b".repeat(40))).toThrow("Backend revision mismatch");
  expect(() => assertBackendRevision(pin.ref, "")).toThrow("Backend revision mismatch");
});
