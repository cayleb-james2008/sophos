# Upstream report — #660 Windows kernel bootstrap uses POSIX `bin/python`

Prepared 2026-08-09 from a live reproduction on Windows 11 (24H2), Prime Agent
v0.7.0. Ready to post as a comment on
[PrimeIntellect-ai/prime-agent#660](https://github.com/PrimeIntellect-ai/prime-agent/issues/660).

---

## Summary

On Windows the kernel bootstrap builds its interpreter path as
`<venv>/bin/python`, which is the POSIX venv layout. `uv venv` on Windows
creates `<venv>/Scripts/python.exe`. The path never resolves, so `uv pip
install --python <venv>/bin/python …` fails, the IPython kernel never starts,
and — because IPython is the agent's only execution tool — the agent comes up
able to answer but unable to run any code.

## Exact location

`packages/coding-agent/src/core/kernel/bootstrap.ts`, two call sites:

```ts
// line ~728, in bootstrapVenv()
const python = path.join(venv, "bin", "python");

// line ~889, in ensureKernelPythonUncached()
const python = path.join(venv, "bin", "python");
```

Neither branches on platform. Notably the **same file already gets this right**
for `uv` itself at line ~518:

```ts
const localUv = path.join(os.homedir(), ".local", "bin",
  process.platform === "win32" ? "uv.exe" : "uv");
```

so the fix is consistent with existing style in the file.

## Reproduction

Windows 11 24H2, Node 24.18.0, uv 0.9.x, Prime Agent v0.7.0.

1. Start the daemon on Windows with no pre-existing kernel venv.
2. Send any prompt that needs the Python tool.

**Observed** — the venv is created with the Windows layout:

```
C:\Users\<user>\.prime\agent\kernel-venv\
└── Scripts\
    └── python.exe          # exists

C:\Users\<user>\.prime\agent\kernel-venv\bin\   # does NOT exist
```

…and bootstrap fails with:

```
uv.exe pip install --python C:\Users\<user>\.prime\agent\kernel-venv\bin\python
  ipykernel ... failed with exit code 2
```

Each retry re-creates and wipes the venv, so it never converges.

A nice confirmation: with the daemon otherwise healthy, the **model itself
diagnosed this** when asked a question that needed the tool —

> "The path `…\kernel-venv\bin\python` uses a **Unix-style path** (`bin/python`),
> but on **Windows** the venv interpreter lives at `Scripts\python.exe`."

## Suggested fix

Mirror the existing `uv.exe` pattern at both sites:

```ts
const python = path.join(
  venv,
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
```

A shared helper (e.g. `venvPython(venv)`) would keep the two call sites from
drifting apart.

## Verified workaround (no patch required)

`PRIME_AGENT_KERNEL_PYTHON` already exists as a first-class override and fully
resolves the issue, provided the target interpreter satisfies the daemon's
checks (`ipykernel`, a current `prime-agent-runtime` exposing callable
`rlm.run` / `rlm.host_request`, and the default packages):

```powershell
uv venv "$env:USERPROFILE\.prime\agent\kernel-venv" --python 3.11 --seed --clear
uv pip install --python "$env:USERPROFILE\.prime\agent\kernel-venv\Scripts\python.exe" `
  ipykernel <path-to>\prime-agent-runtime `
  requests httpx pyyaml tomli python-dotenv pandas numpy scipy beautifulsoup4 lxml pydantic tyro

$env:PRIME_AGENT_KERNEL_PYTHON = "$env:USERPROFILE\.prime\agent\kernel-venv\Scripts\python.exe"
```

**Confirmed working after this** — the agent executed real Python and returned
live interpreter state, not a hallucinated answer:

```
C:\Users\Cayleb\.prime\agent\kernel-venv\Scripts\python.exe
3.11.15
42
```

(`sys.executable`, `platform.python_version()`, `6*7` — the first two can only
come from an actually-running kernel.)

## Related Windows issues hit in the same session

While reproducing this we also hit, on the same machine and in the same run:

- **#667 / #841** — 46 stale `session-leases/*.lock` directories orphaned by a
  host crash blocked every worker with `EPERM: operation not permitted, rename`.
  `prime-agent doctor --fix` reported them as *kept*, not cleared, so the daemon
  could not self-heal; manual deletion was required.
- **#666** — `EPERM: operation not permitted, fsync` recurring in the daemon log.
- **#1045** — a dead worker descriptor (`tcp://127.0.0.1:48341`) kept reappearing
  in `prime-agent status` as `unreachable` until its
  `daemon-workers/<id>/` directory was removed by hand.

These four together make a crashed Windows host effectively unrecoverable
without manual filesystem surgery, which seems worth noting alongside #660.

## Environment

| | |
|---|---|
| OS | Windows 11 24H2 |
| Prime Agent | v0.7.0 |
| Node | 24.18.0 |
| Python (venv) | 3.11.15 (uv-managed) |
| Context | Reproduced via [Sophos](https://github.com/cayleb-james2008/sophos), a Windows-native desktop port of Prime Agent |
