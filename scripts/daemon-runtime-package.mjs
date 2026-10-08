export function validateDaemonRuntimePackage(manifest, pin) {
  if (!manifest || typeof manifest !== "object") throw new Error("daemon runtime package metadata is invalid");
  if (manifest.version !== pin.version) throw new Error(`daemon runtime package version ${manifest.version} does not match pinned ${pin.version}`);
  if (manifest.type !== "module") throw new Error("daemon runtime package must declare ESM type");
  if (manifest.license !== pin.license) throw new Error(`daemon runtime license ${manifest.license} does not match pinned ${pin.license}`);
  for (const dependency of ["proper-lockfile", "zeromq"]) {
    if (typeof manifest.dependencies?.[dependency] !== "string") {
      throw new Error(`daemon runtime package is missing required dependency ${dependency}`);
    }
  }
  return true;
}
