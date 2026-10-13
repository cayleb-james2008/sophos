import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const RETRYABLE_REMOVAL_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

/**
 * Remove the E2E-only temporary HOME, retrying transient Windows directory
 * locks. Persistent locks and unrelated filesystem failures remain fatal.
 */
export async function removeTemporaryHomeWithRetry(homePath, {
  maxAttempts = 50,
  retryDelayMs = 100,
  remove = rmSync,
  delay = sleep,
  onRetry,
} = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("retryDelayMs must be a non-negative finite number");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      remove(homePath, { recursive: true, force: true });
      return { attempts: attempt };
    } catch (error) {
      const code = error?.code;
      if (!RETRYABLE_REMOVAL_CODES.has(code) || attempt === maxAttempts) {
        const failure = new Error(
          `temporary HOME cleanup failed after ${attempt}/${maxAttempts} attempts: ${error?.message ?? String(error)}`,
          { cause: error },
        );
        if (code) failure.code = code;
        throw failure;
      }
      onRetry?.({ attempt, error, retryDelayMs });
      await delay(retryDelayMs);
    }
  }

  throw new Error("temporary HOME cleanup retry loop exited unexpectedly");
}
