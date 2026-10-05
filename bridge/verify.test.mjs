import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verifySource = await readFile(new URL("./verify.mjs", import.meta.url), "utf8");

test("supervisor recovery stops only the old supervisor so Windows session workers survive for adoption", () => {
  const recoveryMarker = 'if (process.env.BRIDGE_VERIFY_RECOVERY === "1") {';
  const recoveryStart = verifySource.lastIndexOf(recoveryMarker);
  const recoveryEnd = verifySource.indexOf("const malformedSession", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "session recovery block is present");
  const recoveryBlock = verifySource.slice(recoveryStart, recoveryEnd);

  assert.match(
    recoveryBlock,
    /terminateSupervisorOnly\(oldDaemon\)/,
    "the recovery scenario must stop only the daemon process; taskkill /T also kills non-detached Windows workers under test",
  );
  assert.doesNotMatch(recoveryBlock, /terminateProcessTree\(oldDaemon\)/);

  const supervisorStopStart = verifySource.indexOf("function terminateSupervisorOnly(proc) {");
  const supervisorStopEnd = verifySource.indexOf("\n}", supervisorStopStart);
  assert.ok(supervisorStopStart >= 0 && supervisorStopEnd > supervisorStopStart, "process-only supervisor stop helper is defined");
  const supervisorStop = verifySource.slice(supervisorStopStart, supervisorStopEnd);
  assert.match(supervisorStop, /execFileSync\("taskkill", \["\/PID", String\(proc\.pid\), "\/F"\]/);
  assert.doesNotMatch(supervisorStop, /"\/T"/, "process-only termination must not target worker descendants");
});
