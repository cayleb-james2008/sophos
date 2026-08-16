// demo.test.ts — demo-mode follow-the-draft (v0.7.1 Profile Studio). Verifies
// that simulated responses follow the ACTIVE profile: the browser-preview
// path (simulateResponse receives the effective profile object) and the Tauri
// demo-shell path (MockIpcClient resolves the custom profile from settings or
// from the live profileFlavor option). An unusable draft degrades instead of
// crashing, and the Gauntlet/Code anchors stay byte-identical.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulateResponse } from "../../chat/demo";
import { subscribeCodeRunEvents } from "../../code/codeRunBus";
import { customDemoFlavor } from "../store";
import type { TranscriptMessage } from "../../../ipc/contract";
import type { CustomProfile } from "../store";

function customProfile(overrides: Partial<CustomProfile> = {}): CustomProfile {
  return {
    id: "custom-abc",
    name: "Builder Bot",
    tagline: "Compose fast, verify always",
    description: "",
    workingStyle: ["Goal first", "Verify with real runs"],
    systemPrompt: "",
    mode: "creator",
    tools: ["shell", "web_search"],
    skills: [],
    safety: { autoApprove: true, confirm: [] },
    ...overrides,
  };
}

describe("simulateResponse — browser-preview path follows the draft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function runSim(userText: string, profile: string | import("../../profiles/profiles").AgentProfile | undefined) {
    let msgs: TranscriptMessage[] = [];
    let done = 0;
    const cleanup = simulateResponse(
      userText,
      {
        onUpdate: (u) => {
          msgs = u(msgs);
        },
        onDone: () => {
          done += 1;
        },
      },
      profile,
    );
    return {
      cleanup,
      get: () => ({ msgs: [...msgs], done }),
    };
  }

  it("appends the custom profile's draft flavor (name, tagline, chips)", () => {
    const { cleanup, get } = runSim("hello", customProfile());
    vi.advanceTimersByTime(20000);
    const { msgs, done } = get();
    expect(done).toBe(1);
    expect(msgs[0].content).toContain("Builder Bot");
    expect(msgs[0].content).toContain("Compose fast, verify always");
    expect(msgs[0].content).toContain("Goal first");
    expect(msgs[0].content).toContain("custom profile");
    cleanup();
  });

  it("editing the draft changes the next simulated response", () => {
    const first = customProfile({ name: "Old Name", tagline: "Old tagline", workingStyle: ["Old chip"] });
    const second = customProfile({ name: "New Name", tagline: "New tagline", workingStyle: ["New chip"] });
    const a = runSim("x", first);
    vi.advanceTimersByTime(20000);
    const b = runSim("x", second);
    vi.advanceTimersByTime(20000);
    expect(a.get().msgs[0].content).toContain("Old Name");
    expect(a.get().msgs[0].content).not.toContain("New Name");
    expect(b.get().msgs[0].content).toContain("New Name");
    expect(b.get().msgs[0].content).not.toContain("Old Name");
    a.cleanup();
    b.cleanup();
  });

  it("an unusable draft (no name) degrades — no custom block, no crash", () => {
    const { cleanup, get } = runSim("hi", customProfile({ name: "" }));
    vi.advanceTimersByTime(20000);
    expect(get().done).toBe(1);
    expect(get().msgs[0].content).not.toContain("custom profile");
    cleanup();
  });

  it("the Gauntlet profile object keeps its exact status block", () => {
    const { cleanup, get } = runSim("hi", { id: "gauntlet", name: "Gauntlet", tagline: "Goal + bar first", description: "", workingStyle: [], systemPrompt: "", mode: "standard" });
    vi.advanceTimersByTime(20000);
    expect(get().msgs[0].content).toContain("Status — demo run");
    expect(get().msgs[0].content).toContain("Verified —");
    cleanup();
  });

  it("a custom code-mode profile routes to the code turn (run_code program)", () => {
    const busEvents: Array<{ type: string }> = [];
    const off = subscribeCodeRunEvents((e: { type: string }) => busEvents.push(e));
    const { cleanup, get } = runSim("ship it", customProfile({ mode: "code" }));
    vi.advanceTimersByTime(30000);
    expect(busEvents[0]?.type).toBe("run_code");
    expect(get().msgs[0].content).toMatch(/Code mode/i);
    cleanup();
    off();
  });

  it("a string profile id still works (backward compatibility)", () => {
    const { cleanup, get } = runSim("hi", "gauntlet");
    vi.advanceTimersByTime(20000);
    expect(get().msgs[0].content).toContain("Status — demo run");
    cleanup();
  });
});

describe("MockIpcClient — Tauri demo-shell path follows the draft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function freshClient() {
    vi.resetModules();
    const mod = await import("../../../ipc/client");
    const client = mod.getIpcClient();
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((e: unknown) => events.push(e as Record<string, unknown>));
    return { client, events };
  }

  function textOf(events: Array<Record<string, unknown>>): string {
    return events
      .filter((e) => e.type === "session_event" && (e.event as Record<string, unknown>).kind === "text")
      .map((e) => String((e.event as Record<string, unknown>).text))
      .join("");
  }

  it("resolves a persisted custom profile from settings and flavors the answer", async () => {
    const { client, events } = await freshClient();
    await client.setSettings({ customProfiles: [customProfile()] } as unknown as import("../../../ipc/contract").Settings);
    await client.prompt("hello", { profile: "custom-abc" });
    await vi.advanceTimersByTimeAsync(30000);
    const text = textOf(events);
    expect(text).toContain("Builder Bot");
    expect(text).toContain("Compose fast, verify always");
    expect(text).toContain("custom profile");
  });

  it("follows the UNSAVED draft via profileFlavor (before Save persists it)", async () => {
    const { client, events } = await freshClient();
    await client.prompt("hello", {
      profile: "custom-draft",
      profileFlavor: { name: "Draft Bot", tagline: "Draft tagline", workingStyle: ["Draft chip"], mode: "creator" },
    });
    await vi.advanceTimersByTimeAsync(30000);
    const text = textOf(events);
    expect(text).toContain("Draft Bot");
    expect(text).toContain("Draft tagline");
    expect(text).toContain("Draft chip");
    // Not persisted anywhere — the flavor came from the live draft option.
    expect(text).not.toContain("Builder Bot");
  });

  it("leaves built-in (non-gauntlet) profiles unflavored", async () => {
    const { client, events } = await freshClient();
    await client.prompt("hello", { profile: "minimal", profileFlavor: { name: "Minimal", tagline: "", workingStyle: [], mode: "minimal" } });
    await vi.advanceTimersByTimeAsync(30000);
    const text = textOf(events);
    expect(text).not.toContain("custom profile");
    expect(text).not.toContain("Status — demo run");
  });
});

describe("customDemoFlavor (pure)", () => {
  it("is the exact block the demo paths append", () => {
    const flavor = customDemoFlavor(customProfile());
    expect(flavor).toContain("Builder Bot");
    expect(flavor).toContain("Compose fast, verify always");
    expect(flavor).toContain("Goal first");
  });
});
