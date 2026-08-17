// studioPanel.test.tsx — Profile Studio portability UI (v0.7.1): export
// through the native save dialog, import through the native open dialog, a
// visible collision resolution (never a silent overwrite), and a clear error
// for a malformed import file. Renders the REAL ProfileProvider + StudioPanel
// with a mocked IPC client and mocked Tauri dialog/invoke, so the whole chain
// (file text → parse → store merge → persist → select → visible notice) is
// exercised end to end.

import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileProvider, useProfile, type ProfileApi } from "../../profiles/profiles";
import { StudioPanel } from "../StudioPanel";
import { sanitizeCustomProfile, type CustomProfile } from "../store";

const mockIpc = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  getRuntimeInfo: vi.fn(),
  getExtensions: vi.fn(),
  testMcpServer: vi.fn(),
}));

const mockDialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
const mockCore = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockIpc,
  useIpcEvent: () => {},
  useConnectionState: () => ({}),
  isTauri: true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => mockDialog);
vi.mock("@tauri-apps/api/core", () => mockCore);

function validProfile(overrides: Partial<CustomProfile> = {}): CustomProfile {
  return sanitizeCustomProfile({
    id: "custom-abc",
    name: "Builder Bot",
    tagline: "Compose fast, verify always",
    description: "",
    workingStyle: ["Goal first"],
    mode: "creator",
    tools: ["shell", "web_search"],
    skills: [],
    safety: { autoApprove: true, confirm: [] },
    ...overrides,
  });
}

function serializedFile(profile: CustomProfile): string {
  return JSON.stringify({ format: "sophos-custom-profile", version: 1, exportedAt: new Date().toISOString(), profile });
}

function Harness({ apiRef }: { apiRef: { current: ProfileApi | null } }) {
  const api = useProfile();
  apiRef.current = api;
  return <StudioPanel />;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIpc.getSettings.mockResolvedValue({});
  mockIpc.setSettings.mockResolvedValue(undefined);
  mockIpc.getRuntimeInfo.mockResolvedValue(null);
  mockIpc.getExtensions.mockResolvedValue([]);
  mockIpc.testMcpServer.mockResolvedValue({ serverName: "x", connected: false });
  mockDialog.open.mockReset();
  mockDialog.save.mockReset();
  mockCore.invoke.mockReset();
});

afterEach(() => {
  act(() => {
    /* flush any pending state updates */
  });
});

async function openStudio(apiRef: { current: ProfileApi | null }): Promise<void> {
  act(() => {
    apiRef.current?.openStudioCreate();
  });
  await waitFor(() => expect(screen.getByTestId("profile-studio")).toBeTruthy());
}

describe("Profile Studio export", () => {
  it("exports the draft through the native save dialog and reports the path", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);

    // A fresh draft has no name → Export is disabled (degrades, doesn't crash).
    const exportBtn = screen.getByTestId("studio-export") as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);

    // Give the draft a name so it becomes usable, then export.
    act(() => {
      apiRef.current?.studioDispatch({ type: "name", value: "Exporter Bot" });
    });
    await waitFor(() => expect((screen.getByTestId("studio-export") as HTMLButtonElement).disabled).toBe(false));

    mockDialog.save.mockResolvedValue("C:\\exports\\exporter-bot.sophos-profile.json");
    mockCore.invoke.mockResolvedValue(undefined);

    fireEvent.click(screen.getByTestId("studio-export"));

    await waitFor(() => {
      expect(mockDialog.save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: "exporter-bot.sophos-profile.json" }),
      );
    });
    expect(mockCore.invoke).toHaveBeenCalledWith("write_text_file", expect.objectContaining({ path: "C:\\exports\\exporter-bot.sophos-profile.json" }));
    const writeArgs = mockCore.invoke.mock.calls[0][1] as { contents: string };
    const written = JSON.parse(writeArgs.contents) as { format: string; profile: { name: string } };
    expect(written.format).toBe("sophos-custom-profile");
    expect(written.profile.name).toBe("Exporter Bot");

    await waitFor(() => {
      expect(screen.getByTestId("studio-port-notice").textContent).toContain("Saved to");
    });
  });

  it("treats a cancelled save dialog as a silent no-op (no error notice)", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);
    act(() => {
      apiRef.current?.studioDispatch({ type: "name", value: "Exporter Bot" });
    });
    mockDialog.save.mockResolvedValue(null); // user cancelled
    fireEvent.click(screen.getByTestId("studio-export"));
    await waitFor(() => {
      expect(mockDialog.save).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("studio-port-notice")).toBeNull();
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });
});

describe("Profile Studio import", () => {
  it("imports a valid file through the native open dialog, persists, and selects it", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);

    mockDialog.open.mockResolvedValue("C:\\imports\\builder.sophos-profile.json");
    mockCore.invoke.mockResolvedValue(serializedFile(validProfile({ id: "custom-incoming" })));

    fireEvent.click(screen.getByTestId("studio-import"));

    await waitFor(() => {
      expect(mockDialog.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
    });
    expect(mockCore.invoke).toHaveBeenCalledWith("read_text_file", { path: "C:\\imports\\builder.sophos-profile.json" });

    await waitFor(() => {
      expect(screen.getByTestId("studio-port-notice").textContent).toContain("Imported “Builder Bot”.");
    });
    // Persisted + selected — the store and the effective profile both follow.
    expect(apiRef.current?.customProfiles.map((p) => p.id)).toContain("custom-incoming");
    expect(apiRef.current?.selection.id).toBe("custom-incoming");
    expect(mockIpc.setSettings).toHaveBeenCalledWith(expect.objectContaining({ customProfiles: expect.any(Array) }));
  });

  it("resolves a name collision visibly — imports as a copy, never overwrites", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    mockIpc.getSettings.mockResolvedValue({ customProfiles: [validProfile({ id: "custom-existing" })] });
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);

    mockDialog.open.mockResolvedValue("C:\\imports\\builder.sophos-profile.json");
    // Same NAME as the existing profile, different id → rename, not overwrite.
    mockCore.invoke.mockResolvedValue(serializedFile(validProfile({ id: "custom-incoming" })));

    fireEvent.click(screen.getByTestId("studio-import"));

    await waitFor(() => {
      const notice = screen.getByTestId("studio-port-notice").textContent ?? "";
      expect(notice).toContain("Builder Bot (copy)");
      expect(notice).toContain("already exists");
      expect(notice).toContain("nothing was overwritten");
    });
    const names = apiRef.current?.customProfiles.map((p) => p.name) ?? [];
    expect(names).toContain("Builder Bot");
    expect(names).toContain("Builder Bot (copy)");
    // The pre-existing profile is untouched.
    const original = apiRef.current?.customProfiles.find((p) => p.id === "custom-existing");
    expect(original?.name).toBe("Builder Bot");
  });

  it("shows a clear error for a malformed import file and never crashes", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);

    mockDialog.open.mockResolvedValue("C:\\imports\\broken.json");
    mockCore.invoke.mockResolvedValue("{ definitely not json");

    fireEvent.click(screen.getByTestId("studio-import"));

    await waitFor(() => {
      expect(screen.getByTestId("studio-port-notice").textContent).toContain("not valid JSON");
    });
    // Nothing was imported; the store is unchanged and the app is alive.
    expect(apiRef.current?.customProfiles).toHaveLength(0);
    expect(screen.getByTestId("profile-studio")).toBeTruthy();
  });

  it("shows a clear error for an unusable import file (no tools)", async () => {
    const apiRef: { current: ProfileApi | null } = { current: null };
    render(
      <ProfileProvider>
        <Harness apiRef={apiRef} />
      </ProfileProvider>,
    );
    await openStudio(apiRef);

    mockDialog.open.mockResolvedValue("C:\\imports\\empty.json");
    mockCore.invoke.mockResolvedValue(serializedFile(validProfile({ tools: [] })));

    fireEvent.click(screen.getByTestId("studio-import"));

    await waitFor(() => {
      expect(screen.getByTestId("studio-port-notice").textContent).toContain("usable");
    });
    expect(apiRef.current?.customProfiles).toHaveLength(0);
  });
});
