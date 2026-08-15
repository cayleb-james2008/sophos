// commands.test.tsx — the ⌘K palette command catalog. Verifies grouping and
// that each command's `run()` dispatches to the expected IPC method or callback.

import { describe, expect, it, vi } from "vitest";
import { buildPaletteCommands, type PaletteGroup } from "../commands";
import type { IpcClient } from "../../../ipc/client";

function makeIpc() {
  return {
    getSessionTree: vi.fn().mockResolvedValue({ tree: [], leafId: null }),
    cloneSession: vi.fn().mockResolvedValue({}),
    runCommand: vi.fn().mockResolvedValue(undefined),
    refine: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    exportToHtml: vi.fn().mockResolvedValue({}),
  };
}

function build() {
  const ipc = makeIpc();
  const onNavigate = vi.fn();
  const onNewSession = vi.fn();
  const onNameRequest = vi.fn();
  const onFindSessionRequest = vi.fn();
  const onSearchTranscriptRequest = vi.fn();
  const groups = buildPaletteCommands(
    ipc as unknown as IpcClient,
    onNavigate,
    onNewSession,
    onNameRequest,
    onFindSessionRequest,
    onSearchTranscriptRequest,
  );
  const all = groups.flatMap((g) => g.commands);
  return { ipc, onNavigate, onNewSession, onNameRequest, onFindSessionRequest, onSearchTranscriptRequest, groups, all };
}

function byId(all: ReturnType<typeof build>["all"], id: string) {
  const c = all.find((c) => c.id === id);
  expect(c).toBeDefined();
  return c!;
}

describe("buildPaletteCommands", () => {
  it("produces grouped commands with the expected structure", () => {
    const { groups } = build();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.id).toBeTypeOf("string");
      expect(g.label).toBeTypeOf("string");
      expect(g.commands.length).toBeGreaterThan(0);
      for (const c of g.commands) {
        expect(c.id).toBeTruthy();
        expect(c.label).toBeTruthy();
        expect(typeof c.run).toBe("function");
      }
    }
  });

  it("dispatches navigation commands to onNavigate", () => {
    const { all, onNavigate } = build();
    byId(all, "go-sessions").run();
    byId(all, "nav-chat").run();
    byId(all, "nav-agents").run();
    byId(all, "nav-settings").run();
    expect(onNavigate).toHaveBeenCalledWith("sessions");
    expect(onNavigate).toHaveBeenCalledWith("chat");
    expect(onNavigate).toHaveBeenCalledWith("agents");
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("dispatches new-session to onNewSession", () => {
    const { all, onNewSession } = build();
    byId(all, "new-session").run();
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("marks the sub-mode commands keepOpen and routes to their requests", () => {
    const { all, onFindSessionRequest, onSearchTranscriptRequest, onNameRequest } = build();
    const find = byId(all, "find-session");
    const search = byId(all, "search-transcript");
    const name = byId(all, "name");
    expect(find.keepOpen).toBe(true);
    expect(search.keepOpen).toBe(true);
    expect(name.keepOpen).toBe(true);
    find.run();
    search.run();
    name.run();
    expect(onFindSessionRequest).toHaveBeenCalledTimes(1);
    expect(onSearchTranscriptRequest).toHaveBeenCalledTimes(1);
    expect(onNameRequest).toHaveBeenCalledTimes(1);
  });

  it("calls ipc.prompt for slash commands that run through the prompt pipeline", () => {
    const { all, ipc } = build();
    byId(all, "goal").run();
    byId(all, "autonomous").run();
    byId(all, "heartbeat").run();
    byId(all, "schedule").run();
    byId(all, "skills").run();
    byId(all, "skill-create").run();
    expect(ipc.prompt).toHaveBeenCalledWith("/goal");
    expect(ipc.prompt).toHaveBeenCalledWith("/autonomous");
    expect(ipc.prompt).toHaveBeenCalledWith("/heartbeat");
    expect(ipc.prompt).toHaveBeenCalledWith("/schedule");
    expect(ipc.prompt).toHaveBeenCalledWith("/skills");
    expect(ipc.prompt).toHaveBeenCalledWith("/skill:create");
  });

  it("calls ipc.runCommand for commands that run as raw bridge commands", () => {
    const { all, ipc } = build();
    byId(all, "fork").run();
    byId(all, "copy").run();
    byId(all, "btw").run();
    byId(all, "side").run();
    byId(all, "usage").run();
    byId(all, "context").run();
    byId(all, "hotkeys").run();
    byId(all, "changelog").run();
    expect(ipc.runCommand).toHaveBeenCalledWith("fork");
    expect(ipc.runCommand).toHaveBeenCalledWith("copy");
    expect(ipc.runCommand).toHaveBeenCalledWith("btw");
    expect(ipc.runCommand).toHaveBeenCalledWith("side");
    expect(ipc.runCommand).toHaveBeenCalledWith("usage");
    expect(ipc.runCommand).toHaveBeenCalledWith("context");
    expect(ipc.runCommand).toHaveBeenCalledWith("hotkeys");
    expect(ipc.runCommand).toHaveBeenCalledWith("changelog");
  });

  it("calls ipc.refine / compact / retry for their commands", () => {
    const { all, ipc } = build();
    byId(all, "refine").run();
    byId(all, "compact").run();
    byId(all, "retry").run();
    expect(ipc.refine).toHaveBeenCalledTimes(1);
    expect(ipc.compact).toHaveBeenCalledTimes(1);
    expect(ipc.retry).toHaveBeenCalledTimes(1);
  });

  it("calls ipc.getSessionTree / cloneSession / exportToHtml for their commands", () => {
    const { all, ipc } = build();
    byId(all, "tree").run();
    byId(all, "clone").run();
    byId(all, "export").run();
    expect(ipc.getSessionTree).toHaveBeenCalledTimes(1);
    expect(ipc.cloneSession).toHaveBeenCalledTimes(1);
    expect(ipc.exportToHtml).toHaveBeenCalledTimes(1);
  });

  it("includes a Providers & models command routing to settings", () => {
    const { all, onNavigate } = build();
    byId(all, "go-settings").run();
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("assigns every command a unique id", () => {
    const { all } = build();
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups are non-empty and label-distinct", () => {
    const { groups } = build();
    const labels = groups.map((g: PaletteGroup) => g.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
