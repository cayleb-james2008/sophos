// migration — bring-your-own-setup import from Claude Desktop / Codex Desktop.
//
// The orchestrator wires the entry point (a button in Settings / onboarding).
// This barrel exposes the pure parsers and the wizard component so the entry
// point can `import { MigrationWizard } from "@/features/migration"`.

export {
  parseClaudeMd,
  parseClaudeConfig,
  parseCodexConfig,
  mergeImportResults,
  type McpServerConfig,
  type ImportProfileMode,
  type ImportedProfile,
  type ImportResult,
} from "./import";

export { MigrationWizard } from "./MigrationWizard";
