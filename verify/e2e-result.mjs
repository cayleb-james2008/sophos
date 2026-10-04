export function parseBridgeVerifyResult(exitCode, output) {
  const match = String(output).match(/===\s*(\d+)\/(\d+)\s+checks passed\s*===/);
  const passed = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  return { passed, total, ok: exitCode === 0 && total > 0 && passed === total };
}
