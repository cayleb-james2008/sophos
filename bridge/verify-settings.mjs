import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "sophos-settings-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { SettingsStore, resolvePreferredModel, writeModelOverrideToModelsJson } = await import("./dist/bridge/src/connection.js");
const settingsPath = join(home, ".prime", "agent", "settings.json");
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

mkdirSync(join(home, ".prime", "agent"), { recursive: true });
writeFileSync(settingsPath, "{not-json", "utf8");

const initial = new SettingsStore().get();
check("malformed settings fall back safely", initial.theme === "dark" && initial.daemonTcp === false);

const first = new SettingsStore();
first.update({
  theme: "light",
  shellPath: " C:/Windows/System32/cmd.exe ",
  sessionDir: "C:/sessions",
  defaultProvider: "ollama-cloud",
  defaultModel: "deepseek-v4-flash:0731-cloud",
  defaultThinking: "high",
  daemonTcp: "yes",
  modelConfig: {
    "ollama-cloud:deepseek-v4-flash:0731-cloud": { contextWindow: 100000, maxOutputTokens: 8192 },
  },
  auth: { "ollama-cloud": "secret" },
  localProviders: [{ id: "local", name: "Local", baseUrl: "http://127.0.0.1:11434", kind: "ollama" }],
  skills: ["C:/skills/example"],
  mcpServers: [{ name: "local-tools" }],
});

const roundTrip = new SettingsStore().get();
check("user-facing settings survive a new store", roundTrip.theme === "light"
  && roundTrip.shellPath === "C:/Windows/System32/cmd.exe"
  && roundTrip.defaultProvider === "ollama-cloud"
  && roundTrip.defaultModel === "deepseek-v4-flash:0731-cloud"
  && roundTrip.defaultThinking === "high"
  && roundTrip.daemonTcp === true
  && roundTrip.modelConfig?.["ollama-cloud:deepseek-v4-flash:0731-cloud"]?.contextWindow === 100000);
check("untyped settings fields survive the same store", Array.isArray((roundTrip).skills)
  && Array.isArray((roundTrip).mcpServers));
check("settings are written as JSON", existsSync(settingsPath)
  && JSON.parse(readFileSync(settingsPath, "utf8")).defaultModel === "deepseek-v4-flash:0731-cloud");

writeModelOverrideToModelsJson("ollama-cloud", "deepseek-v4-flash:0731-cloud", {
  contextWindow: 100000,
  maxTokens: 8192,
});
const modelsPath = join(home, ".prime", "agent", "models.json");
check("model runtime overrides reach the engine catalog", JSON.parse(readFileSync(modelsPath, "utf8"))
  .providers["ollama-cloud"].modelOverrides["deepseek-v4-flash:0731-cloud"].contextWindow === 100000);

writeFileSync(settingsPath, JSON.stringify({
  theme: "neon",
  daemonTcp: "maybe",
  defaultThinking: "turbo",
  modelConfig: {
    good: { contextWindow: 4096, maxOutputTokens: 2048 },
    bad: { contextWindow: -1, maxOutputTokens: "many" },
    malformed: "nope",
  },
  auth: "not-an-object",
  localProviders: [{ id: "missing-fields" }, { id: "ok", name: "OK", baseUrl: "http://localhost", kind: "ollama" }],
}), "utf8");
const invalid = new SettingsStore().get();
check("invalid known values are ignored without losing valid data", invalid.theme === "dark"
  && invalid.daemonTcp === false
  && invalid.defaultThinking === undefined
  && invalid.modelConfig?.good?.contextWindow === 4096
  && !invalid.modelConfig?.bad
  && !invalid.auth
  && invalid.localProviders?.length === 1);

check("explicit saved model beats the daemon's current model", resolvePreferredModel(
  { defaultProvider: "saved-provider", defaultModel: "saved-model" },
  { provider: "daemon-provider", id: "daemon-model" },
).provider === "saved-provider");
check("current model beats the hard-coded fallback", resolvePreferredModel({},
  { provider: "current-provider", id: "current-model" },
).model === "current-model");
check("hard-coded fallback is used only when no selection exists", resolvePreferredModel({}, {}).model === "deepseek-v4-flash:0731-cloud");

const failed = results.filter((result) => !result.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} settings checks passed ===`);
rmSync(home, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
