// The former paid-inference experiment is preserved as non-executable text.
// It used machine-local paths and global settings, and did not enforce a spend
// cap. Do not repair its syntax and silently restore live execution here.
console.error(
  "Retired: live-bounded-spend-test was an unsafe historical experiment, not a live budget check. "
  + "See verify/archive/README.md. For offline lifecycle recovery, stage the runtime "
  + "and run npm --prefix bridge run verify:lifecycle.",
);
process.exitCode = 1;
