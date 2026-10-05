export const WINDOWS_RUNTIME_TARGET = Object.freeze({ platform: "win32", arch: "x64" });

export function createNativeBuildProvenance(mode) {
  if (mode !== "windows-release" && mode !== "source-diagnostic") {
    throw new Error(`unsupported native resource build mode: ${mode}`);
  }

  const buildHost = { platform: process.platform, arch: process.arch };
  const target = { ...WINDOWS_RUNTIME_TARGET };
  const releaseEligible = mode === "windows-release"
    && buildHost.platform === target.platform
    && buildHost.arch === target.arch;

  return {
    mode,
    buildHost,
    target,
    releaseEligible,
  };
}

export function assertWindowsReleaseProvenance(manifest) {
  const provenance = manifest?.platformProvenance;
  if (!provenance) {
    throw new Error("Windows release refused: native platform provenance is missing");
  }
  if (provenance.mode !== "windows-release") {
    throw new Error(`Windows release refused: resource mode is ${provenance.mode}, not windows-release`);
  }
  if (provenance.target?.platform !== WINDOWS_RUNTIME_TARGET.platform
    || provenance.target?.arch !== WINDOWS_RUNTIME_TARGET.arch) {
    throw new Error("Windows release refused: resource target must be win32/x64");
  }
  if (process.platform !== WINDOWS_RUNTIME_TARGET.platform || process.arch !== WINDOWS_RUNTIME_TARGET.arch) {
    throw new Error(`Windows release must run on a real Windows x64 host; got ${process.platform}/${process.arch}`);
  }
  if (provenance.buildHost?.platform !== process.platform || provenance.buildHost?.arch !== process.arch) {
    throw new Error("Windows release refused: native dependencies were built on a different platform/architecture");
  }
  if (provenance.releaseEligible !== true) {
    throw new Error("Windows release refused: resource manifest is not marked release-eligible");
  }
  return provenance;
}
