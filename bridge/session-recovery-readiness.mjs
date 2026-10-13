export function getSessionRecoveryAssertions({
  connectedEventObservedAt,
  state,
  stateObservedAt,
  sessions,
  sessionsObservedAt,
  recoveryDeadline,
  expectedActiveSessionId,
  expectedSessionListingId,
}) {
  const observedBeforeDeadline = (observedAt) =>
    Number.isFinite(observedAt) && Number.isFinite(recoveryDeadline) && observedAt < recoveryDeadline;
  const connectedEventSeen = observedBeforeDeadline(connectedEventObservedAt);
  const activeSessionReady = Boolean(
    connectedEventSeen &&
      observedBeforeDeadline(stateObservedAt) &&
      typeof expectedActiveSessionId === "string" &&
      state?.status?.kind === "connected" &&
      state?.activeSessionId === expectedActiveSessionId,
  );
  const listedSessionReady = Boolean(
    observedBeforeDeadline(sessionsObservedAt) &&
      typeof expectedSessionListingId === "string" &&
      Array.isArray(sessions) &&
      sessions.some((session) => session?.id === expectedSessionListingId),
  );
  return {
    connectedEventSeen,
    activeSessionReady,
    listedSessionReady,
    ready: activeSessionReady && listedSessionReady,
  };
}
