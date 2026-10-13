import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWindowsReleaseProvenance,
  createNativeBuildProvenance,
} from "./native-runtime-platform.mjs";

test("native dependency provenance records this process's real platform and architecture", () => {
  const provenance = createNativeBuildProvenance("source-diagnostic");
  assert.deepEqual(provenance.buildHost, { platform: process.platform, arch: process.arch });
  assert.deepEqual(provenance.target, { platform: "win32", arch: "x64" });
  assert.equal(provenance.releaseEligible, false);
});

test("diagnostic resources never pass the Windows release guard", () => {
  const manifest = {
    platformProvenance: createNativeBuildProvenance("source-diagnostic"),
  };
  assert.throws(() => assertWindowsReleaseProvenance(manifest), /windows-release/);
});

test("the release guard accepts only a real Windows x64 build host", () => {
  const manifest = {
    platformProvenance: createNativeBuildProvenance("windows-release"),
  };
  if (process.platform === "win32" && process.arch === "x64") {
    assert.doesNotThrow(() => assertWindowsReleaseProvenance(manifest));
  } else {
    assert.throws(() => assertWindowsReleaseProvenance(manifest), /Windows x64/);
  }
});

test("Linux-built native dependencies cannot be represented as Windows release resources", () => {
  const provenance = createNativeBuildProvenance("windows-release");
  provenance.buildHost = { platform: "linux", arch: "x64" };
  provenance.releaseEligible = true;
  assert.throws(
    () => assertWindowsReleaseProvenance({ platformProvenance: provenance }),
    /build host|platform|Windows x64/i,
  );
});
