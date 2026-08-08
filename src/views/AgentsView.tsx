// Agents view — real implementation lives in the agents feature module.
// This re-export keeps the existing App.tsx import path (`./views/AgentsView`)
// valid while the full module ships under src/features/agents/.

export { AgentsView } from "../features/agents/AgentsView";
