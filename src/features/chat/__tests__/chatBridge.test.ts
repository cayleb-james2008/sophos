// chatBridge — shared transcript store + message-focus request channel backed
// by useSyncExternalStore. Tests verify publishing/subscribing to the live
// transcript and that focus requests surface once with a monotonic seq.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMessageFocus,
  requestMessageFocus,
  setTranscriptMessages,
  useMessageFocusRequest,
  useTranscriptMessages,
} from "../chatBridge";
import type { TranscriptMessage } from "../../../ipc/contract";

const msg = (id: string, role: TranscriptMessage["role"], content: string): TranscriptMessage => ({
  id,
  role,
  content,
  status: "complete",
});

beforeEach(() => {
  setTranscriptMessages([]);
  clearMessageFocus();
});

describe("chatBridge transcript channel", () => {
  it("exposes an empty transcript by default", () => {
    const { result } = renderHook(() => useTranscriptMessages());
    expect(result.current).toEqual([]);
  });

  it("publishes messages and re-renders subscribers", () => {
    const { result } = renderHook(() => useTranscriptMessages());
    act(() => setTranscriptMessages([msg("1", "user", "hi")]));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].content).toBe("hi");

    act(() => setTranscriptMessages([msg("1", "user", "hi"), msg("2", "assistant", "yo")]));
    expect(result.current).toHaveLength(2);
  });

  it("stops notifying after the subscriber unmounts", () => {
    const { result, unmount } = renderHook(() => useTranscriptMessages());
    unmount();
    // Publishing after unmount must not throw (listeners are removed).
    expect(() => setTranscriptMessages([msg("x", "user", "ok")])).not.toThrow();
    // The unmounted hook no longer receives updates.
    expect(result.current).toEqual([]);
  });
});

describe("chatBridge message-focus channel", () => {
  it("requests a focus by id with an incrementing seq", () => {
    const { result } = renderHook(() => useMessageFocusRequest());
    const base = result.current.seq;
    expect(result.current.id).toBeNull();

    act(() => requestMessageFocus("m-42"));
    expect(result.current.id).toBe("m-42");
    expect(result.current.seq).toBe(base + 1);

    act(() => requestMessageFocus("m-43"));
    expect(result.current.id).toBe("m-43");
    expect(result.current.seq).toBe(base + 2);
  });

  it("clears a pending focus request", () => {
    const { result } = renderHook(() => useMessageFocusRequest());
    const base = result.current.seq;
    act(() => requestMessageFocus("m-42"));
    expect(result.current.id).toBe("m-42");
    act(() => clearMessageFocus());
    expect(result.current.id).toBeNull();
    expect(result.current.seq).toBe(base + 2);
  });
});
