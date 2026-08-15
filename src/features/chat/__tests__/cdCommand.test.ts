// /cd command tests — the client-side slash command is merged into the
// daemon-discovered command list so the composer can intercept it and open a
// directory picker instead of sending a prompt. These cover the merging logic
// (CLIENT_SIDE_COMMANDS ∪ daemon commands) and that /cd surfaces through the
// same filter the autocomplete dropdown and Enter-insertion use.

import { describe, expect, it } from "vitest";
import {
  CLIENT_SIDE_COMMANDS,
  mergeClientSideCommands,
  filterSlashCommands,
} from "../SlashAutocomplete";
import type { SlashCommand } from "../../../ipc/contract";

const DAEMON_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Compact the session context", source: "builtin" },
  { name: "refine", description: "Refine the session's goal", source: "builtin" },
  { name: "export", description: "Export session", source: "builtin" },
];

describe("CLIENT_SIDE_COMMANDS", () => {
  it("defines a builtin /cd command", () => {
    const cd = CLIENT_SIDE_COMMANDS.find((c) => c.name === "cd");
    expect(cd).toBeDefined();
    expect(cd!.description).toBe("Change working directory");
    expect(cd!.source).toBe("builtin");
  });
});

describe("mergeClientSideCommands", () => {
  it("adds /cd to an empty daemon command list", () => {
    const merged = mergeClientSideCommands([]);
    expect(merged.map((c) => c.name)).toContain("cd");
  });

  it("appends client-side commands to the daemon list without dropping daemon commands", () => {
    const merged = mergeClientSideCommands(DAEMON_COMMANDS);
    const names = merged.map((c) => c.name);
    expect(names).toContain("cd");
    for (const d of DAEMON_COMMANDS) expect(names).toContain(d.name);
    expect(merged.length).toBe(DAEMON_COMMANDS.length + 1);
  });

  it("does not duplicate /cd when the daemon already reports a cd command", () => {
    const withCd: SlashCommand[] = [
      ...DAEMON_COMMANDS,
      { name: "cd", description: "Daemon-owned cd", source: "builtin" },
    ];
    const merged = mergeClientSideCommands(withCd);
    expect(merged.filter((c) => c.name === "cd")).toHaveLength(1);
    // The daemon's entry wins on collision; client-only entries are appended.
    expect(merged.find((c) => c.name === "cd")!.description).toBe("Daemon-owned cd");
  });

  it("is stable across calls (does not mutate or grow the input)", () => {
    const before = DAEMON_COMMANDS.map((c) => c.name);
    mergeClientSideCommands(DAEMON_COMMANDS);
    expect(DAEMON_COMMANDS.map((c) => c.name)).toEqual(before);
  });
});

describe("filterSlashCommands with the merged list", () => {
  it("surfaces /cd when querying the empty prefix", () => {
    const merged = mergeClientSideCommands(DAEMON_COMMANDS);
    const matches = filterSlashCommands(merged, "");
    expect(matches.map((c) => c.name)).toContain("cd");
  });

  it("surfaces /cd for the 'c' and 'cd' queries", () => {
    const merged = mergeClientSideCommands(DAEMON_COMMANDS);
    expect(filterSlashCommands(merged, "c").map((c) => c.name)).toContain("cd");
    expect(filterSlashCommands(merged, "cd").map((c) => c.name)).toContain("cd");
  });

  it("ranks the exact /cd match first for the 'cd' query", () => {
    const merged = mergeClientSideCommands(DAEMON_COMMANDS);
    const matches = filterSlashCommands(merged, "cd");
    expect(matches[0].name).toBe("cd");
  });
});
