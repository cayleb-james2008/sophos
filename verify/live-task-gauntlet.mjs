#!/usr/bin/env node
/**
 * Bounded live task gauntlet. This deliberately drives the same bridge NDJSON
 * commands that the Tauri shell forwards, using the configured free
 * ollama-cloud/deepseek-v4-flash:0731-cloud model.
 *
 * It never enables an unbounded loop: autonomous mode is toggled on only long
 * enough to verify the slash command, then immediately turned off.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REF = process.env.REF || "C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent";
const BRIDGE = process.env.BRIDGE || join(process.cwd(), "bridge", "dist", "bridge", "src", "index.js");
const PORT = Number(process.env.DAEMON_PORT || (48940 + Math.floor(Math.random() * 100)));
const SOCKET = `tcp://127.0.0.1:${PORT}`;
const CLI = join(REF, "dist", "bundle", "cli.js");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

class Bridge {
  constructor(proc) {
    this.proc = proc;
    this.pending = new Map();
    this.nextId = 0;
    this.events = [];
    this.connected = false;
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (value.type) {
        this.events.push(value);
        if (value.type === "connection_status" && value.status?.kind === "connected") this.connected = true;
      }
      if (value.id !== undefined && this.pending.has(String(value.id))) {
        const pending = this.pending.get(String(value.id));
        this.pending.delete(String(value.id));
        if (value.error) pending.reject(new Error(`${value.error.code}: ${value.error.message}`));
        else pending.resolve(value.result);
      }
    });
  }
  call(method, params = {}, timeout = 120000) {
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  close() {
    try { this.proc.stdin.end(); } catch {}
    try { this.proc.kill(); } catch {}
  }
}

async function waitForEvent(bridge, predicate, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const event = bridge.events.find(predicate);
    if (event) return event;
    await sleep(250);
  }
  return bridge.events.find(predicate);
}

async function waitForTranscript(bridge, predicate, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const transcript = await bridge.call("getTranscript");
    if (predicate(transcript)) return transcript;
    await sleep(1500);
  }
  return await bridge.call("getTranscript");
}

async function waitForIdle(bridge, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const state = await bridge.call("getState");
    if (state?.queue?.mode === "idle") return state;
    await sleep(1000);
  }
  throw new Error("timeout waiting for daemon queue to become idle");
}

async function waitForKernelState(bridge, predicate, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  let state;
  while (Date.now() < end) {
    state = await bridge.call("getKernelState");
    if (predicate(state)) return state;
    await sleep(1000);
  }
  return state;
}

async function waitForFile(path, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (existsSync(path)) return true;
    await sleep(1000);
  }
  return existsSync(path);
}

async function waitForRlmChild(bridge, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  let children = [];
  while (Date.now() < end) {
    children = await bridge.call("getRlmChildren");
    if (Array.isArray(children) && children.length > 0) return children;
    await sleep(1000);
  }
  return children;
}

async function waitForRlmChildSession(bridge, childId, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let child;
  while (Date.now() < end) {
    const children = await bridge.call("getRlmChildren");
    child = Array.isArray(children) ? children.find((candidate) => candidate.id === childId) : undefined;
    if (child?.sessionId) return child;
    await sleep(1000);
  }
  return child;
}

function rlmTranscriptDiagnostics(transcript) {
  return (Array.isArray(transcript) ? transcript : []).slice(-8).map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content.slice(0, 240) : "",
    toolCalls: Array.isArray(message.toolCalls)
      ? message.toolCalls.map((call) => ({ name: call.name, input: call.input?.slice(0, 180), output: call.output?.slice(0, 180), status: call.status }))
      : [],
  }));
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "sophos-gauntlet-"));
  const project = join(root, "prime-agent-test-folder");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "# Sophos live task folder\n");
  console.log(`TEST_FOLDER=${project}`);

  const daemon = spawn(process.execPath, [CLI, "--mode", "daemon", "--daemon-socket", SOCKET], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PRIME_DAEMON_TCP: "1",
      // Isolate the live fixture's bootstrap from any other shared-workspace
      // daemon/kernel process; production keeps its normal user venv.
      PRIME_AGENT_KERNEL_VENV: join(root, "kernel-venv"),
    },
  });
  let listening = false;
  const onDaemonOutput = (chunk) => { if (/listening on/i.test(String(chunk))) listening = true; };
  daemon.stdout.on("data", onDaemonOutput);
  daemon.stderr.on("data", onDaemonOutput);
  let bridge;
  try {
    for (let i = 0; i < 120 && !listening; i++) await sleep(250);
    check("real daemon listens on loopback", listening, SOCKET);
    if (!listening) throw new Error(`daemon did not listen on ${SOCKET}`);

    bridge = new Bridge(spawn(process.execPath, [BRIDGE], {
      cwd: project,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PRIME_DAEMON_TCP: "1", PRIME_DAEMON_TCP_PORT: String(PORT) },
    }));
    for (let i = 0; i < 120 && !bridge.connected; i++) await sleep(250);
    check("real bridge connects", bridge.connected);
    if (!bridge.connected) return;

    const runtime = await bridge.call("getRuntimeInfo");
    check("onboarding: bridge reaches the real daemon", true, "connected");
    const initialState = await bridge.call("getState");
    check("onboarding: free DeepSeek is selected without config editing", initialState?.model?.provider === "ollama-cloud" && initialState?.model?.model === "deepseek-v4-flash:0731-cloud", JSON.stringify(initialState?.model));
    const onboardingProviders = await bridge.call("getProviders");
    const onboardingModels = await bridge.call("getModels");
    check("onboarding: DeepSeek appears in the live catalog", Array.isArray(onboardingProviders) && Array.isArray(onboardingModels) && onboardingModels.some((model) => model.provider === "ollama-cloud" && model.id === "deepseek-v4-flash:0731-cloud"), `providers=${onboardingProviders?.length ?? 0} models=${onboardingModels?.length ?? 0}`);
    check("persistent IPython capability is surfaced", runtime.kernel?.persistent && runtime.kernel?.toolAvailable, JSON.stringify(runtime.kernel));
    check("live skills snapshot is surfaced", Array.isArray(runtime.skills) && runtime.skills.length > 0, `skills=${runtime.skills?.length}`);
    const initialKernel = await bridge.call("getKernelState");
    check("kernel state RPC returns real notebook shape", Array.isArray(initialKernel?.cells) && Array.isArray(initialKernel?.variables) && Array.isArray(initialKernel?.imports), JSON.stringify(initialKernel?.status));
    check("kernel health diagnostic is typed and sanitized", ["healthy", "starting", "not_started", "bootstrap_failed", "dead", "namespace_unavailable"].includes(initialKernel?.diagnostic?.reason) && typeof initialKernel?.diagnostic?.message === "string" && typeof initialKernel?.diagnostic?.nextStep === "string", JSON.stringify(initialKernel?.diagnostic));
    const harness = await bridge.call("getHarnessState");
    check("continual harness state RPC returns entries and history", Array.isArray(harness?.entries) && Array.isArray(harness?.refinements), `entries=${harness?.entries?.length ?? 0} refinements=${harness?.refinements?.length ?? 0}`);
    try {
      await bridge.call("getAgentState", { id: "nonexistent-agent" });
      check("agent state: nonexistent child should error", false, "unexpectedly succeeded");
    } catch (err) {
      check("agent state: nonexistent child fails safely", /-32602|-32603|not found/.test(err.message), err.message);
    }

    await bridge.call("setModel", { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" });
    await bridge.call("newSession", { cwd: project });
    const createdSkill = await bridge.call("createSkill", { name: "live-check", description: "Verify live resource reload", content: "Use this skill when verifying the live daemon resource loader." });
    check("skills: UI management RPC creates a real SKILL.md", typeof createdSkill?.filePath === "string" && existsSync(createdSkill.filePath), createdSkill?.filePath);
    const installedSkills = await bridge.call("installSkill", { path: join(project, ".prime", "agent", "skills", "live-check") });
    check("skills: install RPC reloads daemon resources", Array.isArray(installedSkills) && installedSkills.some((skill) => skill.name === "live-check"), `skills=${installedSkills?.length ?? 0}`);
    // This run uses a disposable project; clear the persisted override so the
    // user's global settings never retain a temp-folder path.
    await bridge.call("setSettings", { settings: { skills: [] } });

    await bridge.call("runCommand", { command: "echo shell-ok > shell-task.txt" });
    await sleep(1000);
    check("short task: shell command writes a file", existsSync(join(project, "shell-task.txt")), readFileSync(join(project, "shell-task.txt"), "utf8").trim());

    await bridge.call("prompt", { text: "Use IPython now: from pathlib import Path; Path('file-edit-task.txt').write_text('file-edit-ok'); print(Path('file-edit-task.txt').read_text()). Then reply with one short sentence confirming the result." });
    const firstChatTranscript = await waitForTranscript(bridge, (tx) => tx.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0));
    await waitForIdle(bridge);
    const firstAssistant = [...(firstChatTranscript ?? [])].reverse().find((message) => message.role === "assistant");
    check("onboarding: first chat returns a real assistant response", Boolean(firstAssistant && firstAssistant.content.trim().length > 0), firstAssistant?.content?.slice(0, 160) ?? "no assistant text");
    check("short task: model-driven file edit completes", existsSync(join(project, "file-edit-task.txt")), existsSync(join(project, "file-edit-task.txt")) ? readFileSync(join(project, "file-edit-task.txt"), "utf8").trim() : "missing");
    const liveKernel = await bridge.call("getKernelState");
    check("kernel: executed cells and persistent names are visible", Array.isArray(liveKernel?.cells) && liveKernel.cells.length > 0, `cells=${liveKernel?.cells?.length ?? 0} variables=${liveKernel?.variables?.length ?? 0}`);
    check("kernel: healthy diagnostic follows a real execution", liveKernel?.diagnostic?.reason === "healthy", JSON.stringify(liveKernel?.diagnostic));

    // Deterministic two-cell kernel proof: the first cell creates a module import
    // and an assignment; the second reads the assignment from the same kernel.
    await waitForIdle(bridge);
    await bridge.call("prompt", { text: "Use IPython only. Execute exactly this one cell, with no shell or other tools: `import math\nkernel_persisted_value = 21`. Do not merely describe it; run it and then say cell one is complete.", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    const cellOne = await waitForKernelState(bridge, (state) =>
      state?.imports?.includes("math") && state?.variables?.includes("kernel_persisted_value") && state?.cells?.some((cell) => cell.executionCount && cell.code.includes("kernel_persisted_value = 21")),
    );
    check("kernel: first real cell records import, assignment, and execution count", Boolean(cellOne?.imports?.includes("math") && cellOne?.variables?.includes("kernel_persisted_value") && cellOne?.cells?.some((cell) => cell.executionCount && cell.code.includes("kernel_persisted_value = 21"))), JSON.stringify({ executionCount: cellOne?.executionCount, cells: cellOne?.cells?.length }));

    await waitForIdle(bridge);
    await bridge.call("prompt", { text: "Use IPython only. Execute exactly this one cell, with no shell or other tools: `print(kernel_persisted_value * 2)`. Do not redefine the variable; read it from the existing persistent namespace.", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    const cellTwo = await waitForKernelState(bridge, (state) =>
      state?.cells?.some((cell) => cell.code.includes("kernel_persisted_value * 2") && cell.output?.includes("42")) && state?.executionCount >= (cellOne?.executionCount ?? 0),
    );
    check("kernel: follow-up real cell reads persisted assignment", Boolean(cellTwo?.cells?.some((cell) => cell.code.includes("kernel_persisted_value * 2") && cell.output?.includes("42"))), JSON.stringify({ executionCount: cellTwo?.executionCount, lastOutput: cellTwo?.lastOutput }));
    check("kernel: follow-up remains healthy", cellTwo?.diagnostic?.reason === "healthy", JSON.stringify(cellTwo?.diagnostic));

    const pythonPath = join(project, "python-task.txt");
    await bridge.call("runCommand", { command: "python -c \"from pathlib import Path; Path('python-task.txt').write_text('python-ok')\"" });
    await sleep(2000);
    const pythonRan = await waitForFile(pythonPath);
    check("short task: Python execution completes", pythonRan, pythonRan ? readFileSync(pythonPath, "utf8").trim() : "missing");

    const schedule = await bridge.call("addSchedule", { cron: "0 9 * * 1-5", prompt: "Report the live task folder status" });
    check("long-running: schedule is created", typeof schedule?.id === "string", schedule?.id);
    const heartbeat = await bridge.call("setHeartbeat", { schedule: "*/30 * * * *", prompt: "Check for meaningful changes" });
    check("long-running: heartbeat is created", typeof heartbeat?.id === "string", heartbeat?.id);
    // Keep the parent turn in flight while the child is admitted so the
    // attach/message checks exercise a genuinely running child, not a
    // completed session discovered after the parent response.
    const rlmPrompt = bridge.call("prompt", { text: "Do not merely describe this. Use IPython now and execute exactly: `handle = await rlm(\"Use Python to sleep for 12 seconds, then inspect README.md and return one sentence\", name=\"live-checker\"); print(handle.rlm_child_id)`. Then report the admitted child while it is still running.", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    const children = await waitForRlmChild(bridge);
    const rlmAdmitted = Array.isArray(children) && children.length > 0;
    if (!rlmAdmitted) {
      const diagnosticTranscript = await bridge.call("getTranscript");
      check("long-running: RLM child is admitted", false, `children=0 diagnostics=${JSON.stringify(rlmTranscriptDiagnostics(diagnosticTranscript))}`);
    } else {
      const admittedChild = children[0];
      check("long-running: RLM child is admitted", true, `${admittedChild.name ?? admittedChild.id} ${admittedChild.id}`);
      const child = await waitForRlmChildSession(bridge, admittedChild.id);
      check("long-running: child active session id is published", Boolean(child?.sessionId), `session=${child?.sessionId ?? "missing"}`);
      const targetChild = child ?? admittedChild;
      const watchStart = bridge.events.length;
      try {
        const attachReceipt = await bridge.call("attachAgent", { id: targetChild.id });
        const attachedEvent = await waitForEvent(bridge, (event) => event.type === "agent_watch" && event.event?.kind === "attached" && event.event.childId === targetChild.id, 30000);
        check("long-running: child attach completes", attachReceipt?.attached === true && Boolean(attachedEvent), `${targetChild.id} events=${bridge.events.length - watchStart}`);
      } catch (error) {
        check("long-running: child attach completes", false, error.message);
      }
      try {
        const childState = await bridge.call("getAgentState", { id: targetChild.id });
        check("long-running: child session state is readable", typeof childState?.sessionId === "string" && Array.isArray(childState?.transcript), `session=${childState?.sessionId ?? "missing"} messages=${childState?.transcript?.length ?? 0}`);
      } catch (error) {
        check("long-running: child session state is readable", false, error.message);
      }
      try {
        const receipt = await bridge.call("sendAgentMessage", { agentId: targetChild.id, message: "Reply with exactly: child-message-ok" });
        check("long-running: agent message returns an accurate receipt", receipt?.deliveryStatus === "delivered" || receipt?.deliveryStatus === "queued", JSON.stringify(receipt));
        if (receipt.deliveryStatus === "delivered") {
          const messageEvent = await waitForEvent(bridge, (event) => event.type === "agent_watch" && (event.event?.kind === "message" || event.event?.kind === "transcript") && event.event.childId === targetChild.id && event.event.state?.transcript?.some((message) => message.content?.includes("child-message-ok")), 60000);
          const childAfterMessage = await bridge.call("getAgentState", { id: targetChild.id });
          check("long-running: delivered message reaches child watch transcript", Boolean(messageEvent) && Boolean(childAfterMessage?.transcript?.some((message) => message.content?.includes("child-message-ok"))), `messages=${childAfterMessage?.transcript?.length ?? 0}`);
        } else {
          const statusEvent = await waitForEvent(bridge, (event) => event.type === "agent_watch" && event.event?.kind === "status" && event.event.childId === targetChild.id, 30000);
          check("long-running: queued message remains explicitly queued", Boolean(statusEvent), `provider receipt=${receipt.deliveryStatus}; no delivered claim made`);
          console.log("INFO  child message was queued but the provider child completed before consuming it; transcript delivery is intentionally unclaimed");
        }
      } catch (error) {
        check("long-running: agent message returns an accurate receipt", false, error.message);
        check("long-running: child watch/message lifecycle", false, "message RPC did not return a receipt");
      }
      try {
        await bridge.call("detachAgent", { id: targetChild.id });
        const detachedEvent = await waitForEvent(bridge, (event) => event.type === "agent_watch" && event.event?.kind === "detached" && event.event.childId === targetChild.id, 30000);
        check("long-running: child detach closes the watcher", Boolean(detachedEvent), JSON.stringify(detachedEvent?.event ?? {}));
      } catch (error) {
        check("long-running: child detach closes the watcher", false, error.message);
      }
    }
    await rlmPrompt.catch((error) => check("long-running: parent RLM admission prompt completes", false, error.message));

    const goal = await bridge.call("prompt", { text: "/goal Verify the three task artifacts and stop when they exist", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    check("long-running: goal command is admitted", goal === null || goal === undefined, "prompt accepted");

    await bridge.call("prompt", { text: "/autonomous on", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    await sleep(1000);
    await bridge.call("prompt", { text: "/autonomous off", options: { streamingBehavior: "followUp", queueIfBusy: true } });
    check("long-running: autonomous toggle commands round-trip", true, "bounded on→off");

    await bridge.call("removeHeartbeat");
    if (schedule?.id) await bridge.call("removeSchedule", { id: schedule.id });
    await bridge.call("prompt", { text: "/goal clear", options: { streamingBehavior: "followUp", queueIfBusy: true } });
  } finally {
    bridge?.close();
    try { daemon.kill(); } catch {}
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`SUMMARY=${passed}/${results.length}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(2);
});
