import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { join } from "node:path";
import * as windowsAcl from "./windows-acl-security.mjs";

const READ_ONLY_RUNNER_USERS_RIGHTS = 1_179_817;
const CURRENT_USER = "S-1-5-21-1000-1000-1000-1000";
const ADMINISTRATORS = "S-1-5-32-544";
const SYSTEM = "S-1-5-18";
const USERS = "S-1-5-32-545";

function aclRecord(path, rules = [{ sid: USERS, type: "Allow", rights: READ_ONLY_RUNNER_USERS_RIGHTS,
  inherited: true, inheritanceFlags: "ContainerInherit, ObjectInherit", propagationFlags: "None" }]) {
  return {
    path, ownerSid: ADMINISTRATORS, currentUserSid: CURRENT_USER, driveFormat: "NTFS",
    daclPresent: true, canonical: true, isDirectory: true, isReparsePoint: false, rules,
  };
}

test("exposes record, path, and ancestor-aware Windows ACL validators", () => {
  assert.equal(typeof windowsAcl.assertWindowsAclRecord, "function");
  assert.equal(typeof windowsAcl.inspectWindowsPathAcl, "function");
  assert.equal(typeof windowsAcl.assertWindowsPathAcl, "function");
  assert.equal(typeof windowsAcl.assertSecureWindowsPath, "function");
});

test("accepts runner read-only Users access but rejects their actual directory-create ACEs", () => {
  const path = "D:\\\\a\\\\sophos";
  assert.doesNotThrow(() => windowsAcl.assertWindowsAclRecord(aclRecord(path), path, "runner checkout", { scope: "private" }));
  const actualRunnerCreateAce = aclRecord(path, [
    { sid: USERS, type: "Allow", rights: READ_ONLY_RUNNER_USERS_RIGHTS, inherited: true,
      inheritanceFlags: "ContainerInherit, ObjectInherit", propagationFlags: "None" },
    { sid: USERS, type: "Allow", rights: 4, inherited: true,
      inheritanceFlags: "ContainerInherit", propagationFlags: "None" },
    { sid: USERS, type: "Allow", rights: 2, inherited: true,
      inheritanceFlags: "ContainerInherit", propagationFlags: "None" },
  ]);
  assert.throws(
    () => windowsAcl.assertWindowsAclRecord(actualRunnerCreateAce, path, "runner checkout", { scope: "private" }),
    /untrusted SID S-1-5-32-545.*write-capable rights/i,
  );
});

test("rejects every untrusted write/delete/ACL-control bit on private paths", () => {
  const path = "D:\\\\private\\\\workspace";
  for (const rights of [2, 4, 16, 64, 256, 65536, 262144, 524288, 0x10000000, 0x40000000]) {
    const record = aclRecord(path, [{ sid: USERS, type: "Allow", rights, inherited: false,
      inheritanceFlags: "None", propagationFlags: "None" }]);
    assert.throws(() => windowsAcl.assertWindowsAclRecord(record, path, "private workspace", { scope: "private" }), /write-capable rights/i, `rights ${rights}`);
  }
});

test("permits create-only rights on an existing ancestor but rejects replacement rights", () => {
  const path = "D:\\\\a";
  const createOnly = aclRecord(path, [
    { sid: USERS, type: "Allow", rights: 2, inherited: true, inheritanceFlags: "ContainerInherit", propagationFlags: "None" },
    { sid: USERS, type: "Allow", rights: 4, inherited: true, inheritanceFlags: "ContainerInherit", propagationFlags: "None" },
  ]);
  assert.doesNotThrow(() => windowsAcl.assertWindowsAclRecord(createOnly, path, "existing parent", { scope: "ancestor" }));
  for (const rights of [64, 65536, 262144, 524288, 0x10000000]) {
    const record = aclRecord(path, [{ sid: USERS, type: "Allow", rights, inherited: false,
      inheritanceFlags: "None", propagationFlags: "None" }]);
    assert.throws(() => windowsAcl.assertWindowsAclRecord(record, path, "existing parent", { scope: "ancestor" }), /write-capable rights/i, `rights ${rights}`);
  }
});

test("rejects reparse points, untrusted owners, null DACLs, noncanonical ACLs, and non-NTFS volumes", () => {
  const path = "D:\\\\private\\\\workspace";
  const cases = [
    [aclRecord(path, []), { isReparsePoint: true }, /reparse point/i],
    [aclRecord(path, []), { ownerSid: "S-1-5-21-999-999-999-999" }, /owner is not/i],
    [aclRecord(path, []), { daclPresent: false }, /null or missing.*DACL/i],
    [aclRecord(path, []), { canonical: false }, /non-canonical/i],
    [aclRecord(path, []), { driveFormat: "FAT32" }, /requires a local NTFS volume/i],
  ];
  for (const [record, update, expected] of cases) {
    assert.throws(() => windowsAcl.assertWindowsAclRecord({ ...record, ...update }, path, "workspace", { scope: "private" }), expected);
  }
});

test("treats inherited untrusted writes as effective and rejects unknown ACE metadata", () => {
  const path = "D:\\\\private\\\\workspace";
  const inheritedWriter = aclRecord(path, [{ sid: USERS, type: "Allow", rights: 2, inherited: true,
    inheritanceFlags: "ContainerInherit", propagationFlags: "None" }]);
  assert.throws(() => windowsAcl.assertWindowsAclRecord(inheritedWriter, path, "workspace", { scope: "private" }), /untrusted SID/i);
  const unknownFlags = aclRecord(path, [{ sid: USERS, type: "Allow", rights: 2, inherited: false,
    inheritanceFlags: "UnknownFlag", propagationFlags: "None" }]);
  assert.throws(() => windowsAcl.assertWindowsAclRecord(unknownFlags, path, "workspace", { scope: "private" }), /unsupported inheritance flags/i);
  const invalidMask = aclRecord(path, [{ sid: USERS, type: "Allow", rights: Number.NaN, inherited: false,
    inheritanceFlags: "None", propagationFlags: "None" }]);
  assert.throws(() => windowsAcl.assertWindowsAclRecord(invalidMask, path, "workspace", { scope: "private" }), /unsupported access rule/i);
});

test("permits the trusted Windows servicing owner only on the drive root", () => {
  const root = "C:" + String.fromCharCode(92);
  const trustedRoot = aclRecord(root, []);
  trustedRoot.ownerSid = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  assert.doesNotThrow(() => windowsAcl.assertWindowsAclRecord(trustedRoot, root, "volume root", { scope: "ancestor" }));
  const nested = aclRecord(String.raw`C:\\Users`, []);
  nested.ownerSid = trustedRoot.ownerSid;
  assert.throws(() => windowsAcl.assertWindowsAclRecord(nested, nested.path, "nested directory", { scope: "ancestor" }), /owner is not/i);
});

test("refuses to present Linux ACL data as native Windows evidence", async () => {
  if (process.platform === "win32") return;
  await assert.rejects(windowsAcl.inspectWindowsPathAcl("D:\\\\a"), /requires a native Windows process/i);
  await assert.rejects(windowsAcl.assertSecureWindowsPath("D:\\\\a"), /requires a native Windows process/i);
});

test("classifies the runner checkout ACL and enforces private system TEMP", { skip: process.platform !== "win32" }, async (t) => {
  const workspace = process.env.GITHUB_WORKSPACE;
  assert.ok(workspace, "GITHUB_WORKSPACE must be set by the native Windows Actions runner");
  const actual = await windowsAcl.inspectWindowsPathAcl(workspace);
  assert.equal(actual.driveFormat, "NTFS");
  assert.equal(actual.isDirectory, true);
  assert.equal(actual.isReparsePoint, false);
  assert.equal(actual.daclPresent, true);
  assert.equal(actual.canonical, true);
  let workspacePolicy = "accepted as an existing ancestor";
  try {
    await windowsAcl.assertSecureWindowsPath(workspace, "actual GitHub Windows checkout", { scope: "ancestor" });
  } catch (error) {
    workspacePolicy = `rejected by ACL policy: ${error.message}`;
  }
  t.diagnostic(`GITHUB_WORKSPACE ACL classification: ${workspacePolicy}`);

  const privateBase = await realpath(tmpdir());
  await windowsAcl.assertSecureWindowsPath(privateBase, "canonical Node system TEMP", { scope: "private" });
  const privateDestination = mkdtempSync(join(privateBase, "sophos-dependency-acl-"));
  try {
    await windowsAcl.assertSecureWindowsPath(privateDestination, "new per-user destination", { scope: "private" });
  } finally {
    rmSync(privateDestination, { recursive: true, force: true });
  }
});
