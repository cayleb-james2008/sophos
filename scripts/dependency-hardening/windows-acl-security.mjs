import { spawnSync } from "node:child_process";
import { win32 } from "node:path";

const OWNER_RIGHTS_SID = "S-1-3-4";
const CREATOR_OWNER_SID = "S-1-3-0";
const NETWORK_SERVICE_SID = "S-1-5-20";
const TRUSTED_INSTALLER_SID = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";
const PRIVATE_WRITE_MASK = 2 | 4 | 16 | 64 | 256 | 65536 | 262144 | 524288 | 0x10000000 | 0x40000000;
const ANCESTOR_REPLACEMENT_MASK = 64 | 65536 | 262144 | 524288 | 0x10000000;
const VALID_INHERITANCE_FLAGS = new Set(["None", "ContainerInherit", "ObjectInherit"]);
const VALID_PROPAGATION_FLAGS = new Set(["None", "InheritOnly", "NoPropagateInherit"]);
const LOCAL_DRIVE_PATH = /^[A-Za-z]:\\/;

function sidLooksValid(sid) {
  return typeof sid === "string" && /^S-\d-(?:\d+-)*\d+$/.test(sid);
}

function parseFlags(value, allowed, label) {
  if (typeof value !== "string" || !value) throw new Error(`Windows ACL ${label} flags are missing`);
  const flags = value.split(",").map((flag) => flag.trim());
  if (flags.some((flag) => !allowed.has(flag))) throw new Error(`Windows ACL has unsupported ${label} flags: ${value}`);
  return new Set(flags.filter((flag) => flag !== "None"));
}

function unsignedRights(value) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0xffffffff) {
    throw new Error("Windows ACL contains an invalid FileSystemRights mask");
  }
  return value >>> 0;
}

function normalizeLocalWindowsPath(path, label) {
  if (typeof path !== "string" || !LOCAL_DRIVE_PATH.test(path) || path.startsWith("\\\\")) {
    throw new Error(`${label} requires an absolute local Windows drive path: ${path}`);
  }
  return win32.resolve(path);
}

function isDriveRoot(path) {
  return /^[A-Za-z]:\\$/.test(path);
}

function assertRecordShape(record, expectedPath, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Windows ACL query returned an invalid record for ${label}`);
  }
  const normalizedExpected = normalizeLocalWindowsPath(expectedPath, label).toLowerCase();
  const normalizedObserved = typeof record.path === "string" ? win32.resolve(record.path).toLowerCase() : "";
  if (normalizedObserved !== normalizedExpected) throw new Error(`Windows ACL query returned a path mismatch for ${label}`);
  if (!sidLooksValid(record.ownerSid) || !sidLooksValid(record.currentUserSid)) {
    throw new Error(`Windows ACL owner or current-user SID is invalid for ${label}`);
  }
  if (typeof record.driveFormat !== "string" || typeof record.daclPresent !== "boolean"
    || typeof record.canonical !== "boolean" || typeof record.isDirectory !== "boolean"
    || typeof record.isReparsePoint !== "boolean" || !Array.isArray(record.rules)) {
    throw new Error(`Windows ACL metadata is incomplete for ${label}`);
  }
  for (const rule of record.rules) {
    if (!rule || !sidLooksValid(rule.sid) || !["Allow", "Deny"].includes(rule.type)
      || !Number.isSafeInteger(rule.rights) || typeof rule.inherited !== "boolean") {
      throw new Error(`Windows ACL contains an unsupported access rule for ${label}`);
    }
    parseFlags(rule.inheritanceFlags, VALID_INHERITANCE_FLAGS, "inheritance");
    parseFlags(rule.propagationFlags, VALID_PROPAGATION_FLAGS, "propagation");
    unsignedRights(rule.rights);
  }
  return normalizedExpected;
}

/** Validate one captured Windows ACL record. This pure policy check also lets the
 * unit suite exercise adversarial ACL shapes; live Windows tests use the same
 * evaluator after querying the host's actual NTFS ACLs. */
export function assertWindowsAclRecord(record, expectedPath, label = "trusted workspace path", { scope = "private" } = {}) {
  if (!new Set(["private", "ancestor"]).has(scope)) throw new Error(`unsupported Windows ACL validation scope: ${scope}`);
  const normalizedPath = assertRecordShape(record, expectedPath, label);
  if (record.isReparsePoint) throw new Error(`${label} must not be a Windows reparse point: ${expectedPath}`);
  if (record.driveFormat.toUpperCase() !== "NTFS") {
    throw new Error(`${label} requires a local NTFS volume; found ${record.driveFormat || "unknown"}: ${expectedPath}`);
  }
  if (!record.daclPresent) throw new Error(`${label} has a null or missing Windows DACL: ${expectedPath}`);
  if (!record.canonical) throw new Error(`${label} has a non-canonical Windows DACL: ${expectedPath}`);

  const ownerTrusted = record.ownerSid === record.currentUserSid
    || record.ownerSid === SYSTEM_SID
    || record.ownerSid === ADMINISTRATORS_SID
    || (isDriveRoot(normalizedPath) && [NETWORK_SERVICE_SID, TRUSTED_INSTALLER_SID].includes(record.ownerSid));
  if (!ownerTrusted) throw new Error(`${label} owner is not the current user or a trusted Windows principal (${record.ownerSid}): ${expectedPath}`);

  const trustedWriters = new Set([record.currentUserSid, SYSTEM_SID, ADMINISTRATORS_SID, OWNER_RIGHTS_SID]);
  for (const rule of record.rules) {
    if (rule.type === "Deny") continue;
    const rights = unsignedRights(rule.rights);
    const propagation = parseFlags(rule.propagationFlags, VALID_PROPAGATION_FLAGS, "propagation");
    const inheritance = parseFlags(rule.inheritanceFlags, VALID_INHERITANCE_FLAGS, "inheritance");
    // An inherit-only ACE on a private directory still affects files/directories
    // created underneath it, so it remains relevant to future writes. Ancestor
    // checks only reason about the already-existing path component.
    if (scope === "ancestor" && propagation.has("InheritOnly")) continue;
    if (rule.sid === CREATOR_OWNER_SID && propagation.has("InheritOnly")) continue;
    if (trustedWriters.has(rule.sid)) continue;
    const dangerous = scope === "private" ? PRIVATE_WRITE_MASK : ANCESTOR_REPLACEMENT_MASK;
    if ((rights & dangerous) !== 0) {
      const mode = scope === "private" ? "private" : "existing-ancestor";
      const inheritable = inheritance.size > 0;
      throw new Error(`${label} ${mode} DACL grants untrusted SID ${rule.sid} write-capable rights 0x${rights.toString(16)}${inheritable ? " (including inherited rights)" : ""}: ${expectedPath}`);
    }
  }
  return record;
}

function powershellPath() {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function makeAclQueryScript(paths) {
  const pathsJsonBase64 = Buffer.from(JSON.stringify(paths), "utf8").toString("base64");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $pathsJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pathsJsonBase64}'))
    $paths = @(ConvertFrom-Json -InputObject $pathsJson)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($null -eq $identity.User) { throw 'current Windows identity has no user SID' }
    $rows = @(
        foreach ($path in $paths) {
            $fullPath = [System.IO.Path]::GetFullPath([string]$path)
            $twoSeparators = ([string][char]92) + [char]92
            $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
            if ($fullPath.StartsWith($twoSeparators) -or $pathRoot.Length -ne 3 -or $pathRoot[1] -ne ':' -or $pathRoot[2] -ne [char]92) {
                throw ('ACL validation supports local drive paths only: ' + $fullPath)
            }
            $item = Get-Item -LiteralPath $fullPath -Force
            $acl = Get-Acl -LiteralPath $fullPath
            $sections = [System.Security.AccessControl.AccessControlSections]::Access
            $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm($sections))
            $rules = @(
                foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
                    [pscustomobject]@{
                        sid = $rule.IdentityReference.Value
                        type = $rule.AccessControlType.ToString()
                        rights = [int64]$rule.FileSystemRights
                        inherited = [bool]$rule.IsInherited
                        inheritanceFlags = $rule.InheritanceFlags.ToString()
                        propagationFlags = $rule.PropagationFlags.ToString()
                    }
                }
            )
            $driveRoot = [System.IO.Path]::GetPathRoot($fullPath)
            $driveFormat = ([System.IO.DriveInfo]::new($driveRoot)).DriveFormat
            [pscustomobject]@{
                path = $fullPath
                ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
                currentUserSid = $identity.User.Value
                driveFormat = $driveFormat
                daclPresent = ($null -ne $raw.DiscretionaryAcl)
                canonical = [bool]$acl.AreAccessRulesCanonical
                isDirectory = [bool]$item.PSIsContainer
                isReparsePoint = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
                rules = @($rules)
            }
        }
    )
    Write-Output (ConvertTo-Json -InputObject @($rows) -Depth 8 -Compress)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`;
}

function queryWindowsAcls(paths) {
  if (process.platform !== "win32") throw new Error("Windows ACL inspection requires a native Windows process");
  const normalized = paths.map((path) => normalizeLocalWindowsPath(path, "Windows ACL inspection"));
  const result = spawnSync(powershellPath(), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    encodePowerShell(makeAclQueryScript(normalized)),
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Windows ACL query could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`Windows ACL query failed${detail ? `: ${detail}` : ""}`);
  }
  let rows;
  try {
    rows = JSON.parse((result.stdout ?? "").replace(/^\uFEFF/, "").trim());
  } catch (error) {
    throw new Error(`Windows ACL query returned invalid JSON: ${error.message}`);
  }
  const records = Array.isArray(rows) ? rows : [rows];
  if (records.length !== normalized.length) throw new Error("Windows ACL query returned an unexpected record count");
  return records;
}

export async function inspectWindowsPathAcl(path) {
  const absolute = normalizeLocalWindowsPath(path, "Windows ACL inspection");
  const [record] = queryWindowsAcls([absolute]);
  assertRecordShape(record, absolute, absolute);
  return record;
}

export async function assertWindowsPathAcl(path, label = "trusted workspace path", { scope = "private" } = {}) {
  const absolute = normalizeLocalWindowsPath(path, label);
  const record = await inspectWindowsPathAcl(absolute);
  return assertWindowsAclRecord(record, absolute, label, { scope });
}

function windowsPathComponents(path) {
  const absolute = normalizeLocalWindowsPath(path, "trusted Windows path");
  const root = win32.parse(absolute).root;
  const components = [root];
  let current = root;
  const relativePath = win32.relative(root, absolute);
  for (const component of relativePath.split(win32.sep).filter(Boolean)) {
    current = win32.join(current, component);
    components.push(current);
  }
  return components;
}

export async function assertSecureWindowsPath(path, label = "trusted Windows path", { scope = "private", targetType = "directory" } = {}) {
  if (process.platform !== "win32") throw new Error("Windows ACL validation requires a native Windows process");
  if (!new Set(["private", "ancestor"]).has(scope)) throw new Error(`unsupported Windows ACL validation scope: ${scope}`);
  if (!new Set(["directory", "file", "any"]).has(targetType)) throw new Error(`unsupported Windows path target type: ${targetType}`);
  const components = windowsPathComponents(path);
  const records = queryWindowsAcls(components);
  for (const [index, [component, record]] of components.entries()) {
    const final = index === components.length - 1;
    const componentScope = final ? scope : "ancestor";
    assertWindowsAclRecord(record, component, label, { scope: componentScope });
    if (!record.isDirectory && (!final || targetType === "directory")) {
      throw new Error(`${label} path component is not a directory: ${component}`);
    }
    if (final && targetType === "file" && record.isDirectory) {
      throw new Error(`${label} must be a regular file: ${component}`);
    }
  }
  return records.at(-1);
}
