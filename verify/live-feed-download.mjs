import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

export const MAX_INSTALLER_BYTES = 256 * 1024 * 1024;

function normalizedPath(path) {
  if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) {
    throw new Error("installer output paths must be absolute");
  }
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function validateInstallerDownloadUrl(value, version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("manifest version is not a valid release version");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("installer download URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("installer download URL must use HTTPS");
  if (url.username || url.password) throw new Error("installer download URL must not contain credentials");

  let filename;
  try {
    filename = decodeURIComponent(url.pathname.split("/").at(-1) || "");
  } catch {
    throw new Error("installer download URL has an invalid encoded filename");
  }
  const expectedFilename = `Sophos_${version}_x64-setup.exe`;
  if (filename !== expectedFilename) {
    throw new Error(`installer filename must be ${expectedFilename}`);
  }

  return {
    url,
    safeUrl: `${url.origin}${url.pathname}`,
    filename,
  };
}

export function validateInstallerResponseUrl(value) {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("final installer response URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("final installer response URL must use HTTPS");
  if (url.username || url.password) throw new Error("final installer response URL must not contain credentials");
}

export async function readInstallerResponse(response, maxBytes = MAX_INSTALLER_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("maximum installer size must be a positive safe integer");
  if (!response?.ok) throw new Error(`installer download failed (status=${response?.status ?? "unknown"})`);

  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new Error(`installer exceeds the ${maxBytes}-byte size limit`);
  }

  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("installer response is empty");
    if (bytes.length > maxBytes) throw new Error(`installer exceeds the ${maxBytes}-byte size limit`);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) throw new Error(`installer exceeds the ${maxBytes}-byte size limit`);
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already be closed or errored.
    }
    throw error;
  }

  if (totalBytes === 0) throw new Error("installer response is empty");
  return Buffer.concat(chunks, totalBytes);
}

export function prepareVerifiedInstallerOutputs({ installerPath, metadataPath, reportPath }) {
  if (!installerPath && !metadataPath) return;
  if (!installerPath) throw new Error("installer metadata output requires an installer output path");

  const installerResolved = normalizedPath(installerPath);
  const metadataResolved = metadataPath ? normalizedPath(metadataPath) : null;
  const reportResolved = reportPath ? normalizedPath(reportPath) : null;
  if (metadataResolved === installerResolved || reportResolved === installerResolved || (metadataResolved && metadataResolved === reportResolved)) {
    throw new Error("installer, metadata, and report outputs must use distinct paths");
  }

  rmSync(installerPath, { force: true });
  if (metadataPath) rmSync(metadataPath, { force: true });
}

export function persistVerifiedInstaller({ installerPath, metadataPath, bytes, metadata }) {
  if (!installerPath) throw new Error("installer output path is required");
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INSTALLER_BYTES) {
    throw new Error("verified installer bytes are empty or exceed the configured size limit");
  }
  if (metadata?.signatureVerified !== true || metadata?.tamperingRejected !== true) {
    throw new Error("refusing to persist an installer without successful signature and tamper checks");
  }

  const installerResolved = normalizedPath(installerPath);
  const metadataResolved = metadataPath ? normalizedPath(metadataPath) : null;
  if (metadataResolved && metadataResolved === installerResolved) {
    throw new Error("installer and metadata outputs must use distinct paths");
  }

  const id = randomUUID();
  const installerTemp = `${installerPath}.${id}.tmp`;
  const metadataTemp = metadataPath ? `${metadataPath}.${id}.tmp` : null;
  let installerCommitted = false;
  let metadataCommitted = false;
  try {
    mkdirSync(dirname(installerPath), { recursive: true });
    if (metadataPath) mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(installerTemp, bytes, { flag: "wx" });
    if (metadataTemp) writeFileSync(metadataTemp, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    renameSync(installerTemp, installerPath);
    installerCommitted = true;
    if (metadataTemp) {
      renameSync(metadataTemp, metadataPath);
      metadataCommitted = true;
    }
  } catch (error) {
    rmSync(installerTemp, { force: true });
    if (metadataTemp) rmSync(metadataTemp, { force: true });
    if (installerCommitted) rmSync(installerPath, { force: true });
    if (metadataCommitted) rmSync(metadataPath, { force: true });
    throw error;
  }
}
