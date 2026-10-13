import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "sophos-settings-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { SettingsStore, resolvePreferredModel, writeModelOverrideToModelsJson, writeLocalProvidersToModelsJson } = await import("./dist/bridge/src/connection.js");
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
  localProviders: [{ id: "sophos-local-manual", name: "Local", baseUrl: "http://127.0.0.1:11434/v1", kind: "ollama", models: [{ id: "qwen:7b", name: "Qwen 7B" }] }],
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

const localConfig = roundTrip.localProviders?.[0];
writeFileSync(modelsPath, JSON.stringify({ providers: { preserved: { baseUrl: "https://example.invalid" } } }), "utf8");
writeLocalProvidersToModelsJson([], [localConfig]);
const withLocal = JSON.parse(readFileSync(modelsPath, "utf8"));
check("local models register with the actual daemon API and preserve other providers",
  withLocal.providers["sophos-local-manual"].api === "openai-completions"
  && withLocal.providers["sophos-local-manual"].baseUrl === "http://127.0.0.1:11434/v1"
  && withLocal.providers["sophos-local-manual"].models[0].id === "qwen:7b"
  && Boolean(withLocal.providers.preserved));
const collisionConfig = { ...localConfig, id: "sophos-local-collision", models: [] };
writeFileSync(modelsPath, JSON.stringify({ providers: { "sophos-local-collision": { name: "user provider" } } }), "utf8");
let refusedUnownedDelete = false;
try {
  writeLocalProvidersToModelsJson([], [collisionConfig]);
} catch (error) {
  refusedUnownedDelete = error instanceof Error && error.message.includes("already exists");
}
check("empty local discovery cannot delete an unowned daemon provider",
  refusedUnownedDelete
  && JSON.parse(readFileSync(modelsPath, "utf8")).providers["sophos-local-collision"].name === "user provider");
writeFileSync(modelsPath, JSON.stringify(withLocal), "utf8");
writeLocalProvidersToModelsJson([localConfig], []);
const withoutLocal = JSON.parse(readFileSync(modelsPath, "utf8"));
check("disconnect removes only Sophos-owned local model entries",
  !withoutLocal.providers["sophos-local-manual"] && Boolean(withoutLocal.providers.preserved));

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
  localProviders: [{ id: "missing-fields" }, { id: "ok", name: "OK", baseUrl: "http://localhost", kind: "ollama" }, { id: "sophos-local-remote", name: "Remote", baseUrl: "http://192.168.1.20:11434/v1", kind: "ollama" }],
}), "utf8");
const invalid = new SettingsStore().get();
check("invalid known values are ignored without losing valid data", invalid.theme === "dark"
  && invalid.daemonTcp === false
  && invalid.defaultThinking === undefined
  && invalid.modelConfig?.good?.contextWindow === 4096
  && !invalid.modelConfig?.bad
  && !invalid.auth
  && invalid.localProviders?.length === 0);

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
