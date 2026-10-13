import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDaemonRuntimePackage } from "./daemon-runtime-package.mjs";

const pin = { version: "0.7.0", license: "MIT" };
const manifest = {
  name: "@earendil-works/pi-coding-agent",
  version: "0.7.0",
  type: "module",
  license: "MIT",
  dependencies: { "proper-lockfile": "^4.1.2", zeromq: "^6.1.2" },
};

test("accepts compatible ESM daemon metadata with required runtime dependencies", () => {
  assert.equal(validateDaemonRuntimePackage(manifest, pin), true);
});

test("rejects version, module type, license, or dependency drift", () => {
  assert.throws(() => validateDaemonRuntimePackage({ ...manifest, version: "0.8.0" }, pin), /version/);
  assert.throws(() => validateDaemonRuntimePackage({ ...manifest, type: "commonjs" }, pin), /ESM/);
  assert.throws(() => validateDaemonRuntimePackage({ ...manifest, license: "GPL-3.0" }, pin), /license/);
  assert.throws(() => validateDaemonRuntimePackage({ ...manifest, dependencies: { zeromq: "^6" } }, pin), /proper-lockfile/);
});
