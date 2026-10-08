# Retired live-spend experiment

`live-bounded-spend-test.mjs.txt` preserves the original experiment byte-for-byte
(SHA-256 `36631954882400654c1ead2ed8203ecd276b1be8ba632b8ec573e7101c694b9d`).
It is reference text, not an executable verifier or evidence of a live budget
check. The original command now exits nonzero with a retirement message and
cannot spawn a daemon, contact a provider, or modify user settings.

A syntax-only check of the original reported `Unexpected end of input`: the
`_writeBoundedConfig` catch/function was never closed. Adding closing braces
would not make this a safe supported check:

- Paths target a historical Windows checkout and AppData installation, not the
  current pinned/staged runtime.
- It inherits the host environment and modifies global `.prime/agent/settings.json`.
  A newly created settings file is not removed, and exceptions do not guarantee
  restoration or process cleanup.
- `MAX_COST` is a polling observation, not a daemon-enforced spend cap. The source
  itself says that the cost guard is client-side; this harness runs without the
  frontend guard. Turn/token bounds do not prove a dollar cap.
- `code = code || 1` makes even the success path exit with a failure code.

No paid inference was run to assess or retire this script. A future live-spend
verifier needs a separate design with explicit provider/bankroll authority,
server-enforced limits, an isolated configuration, and identity-aware cleanup.
The supported offline recovery check is:

```sh
# After the platform-appropriate scripts/bundle.mjs invocation:
npm --prefix bridge run verify:lifecycle
```

This uses a deterministic loopback provider and does not prove live-provider
billing behavior or a live spend cap.
