import test from "node:test";
import assert from "node:assert/strict";

import * as readiness from "./session-recovery-readiness.mjs";

const evaluate = (snapshot) => readiness.getSessionRecoveryAssertions(snapshot).ready;

const base = {
  connectedEventObservedAt: 10,
  state: { status: { kind: "connected" }, activeSessionId: "session-created" },
  stateObservedAt: 20,
  sessions: [{ id: "listing-created" }],
  sessionsObservedAt: 30,
  recoveryDeadline: 100,
  expectedActiveSessionId: "session-created",
  expectedSessionListingId: "listing-created",
};

test("does not mark connected-but-stale recovery state as ready", () => {
  assert.equal(evaluate({
    ...base,
    state: { status: { kind: "connected" }, activeSessionId: "session-previous" },
    sessions: [{ id: "listing-previous" }],
  }), false);
});

test("marks recovery ready only when the expected active session is listed", () => {
  assert.equal(evaluate(base), true);
});

test("requires a connected event and connected state for recovered-session readiness", () => {
  assert.equal(evaluate({ ...base, connectedEventObservedAt: 100 }), false);
  assert.equal(evaluate({ ...base, state: { ...base.state, status: { kind: "connecting" } } }), false);
});

test("does not accept a missing expected session from the replacement listing", () => {
  assert.equal(evaluate({ ...base, sessions: [{ id: "listing-previous" }] }), false);
});

test("rejects session snapshots observed at or after the existing recovery deadline", () => {
  assert.equal(evaluate({
    ...base,
    stateObservedAt: 100,
  }), false);
  assert.equal(evaluate({
    ...base,
    sessionsObservedAt: 100,
  }), false);
  assert.equal(evaluate({
    ...base,
    connectedEventObservedAt: 100,
  }), false);
});

test("post-deadline fallback snapshots are diagnostic-only for active and listed-session assertions", () => {
  const assertions = readiness.getSessionRecoveryAssertions({
    ...base,
    connectedEventObservedAt: 99,
    stateObservedAt: 100,
    sessionsObservedAt: 101,
  });

  assert.deepEqual(assertions, {
    connectedEventSeen: true,
    activeSessionReady: false,
    listedSessionReady: false,
    ready: false,
  });
});

test("keeps state and listing deadline checks independent", () => {
  const lateListing = readiness.getSessionRecoveryAssertions({
    ...base,
    connectedEventObservedAt: 99,
    stateObservedAt: 99,
    sessionsObservedAt: 100,
  });
  const lateState = readiness.getSessionRecoveryAssertions({
    ...base,
    connectedEventObservedAt: 99,
    stateObservedAt: 100,
    sessionsObservedAt: 99,
  });

  assert.deepEqual(lateListing, {
    connectedEventSeen: true,
    activeSessionReady: true,
    listedSessionReady: false,
    ready: false,
  });
  assert.deepEqual(lateState, {
    connectedEventSeen: true,
    activeSessionReady: false,
    listedSessionReady: true,
    ready: false,
  });
});
