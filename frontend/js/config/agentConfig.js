// Single source of truth for the agent identity is at
// /config/agent.json (project root). Vite imports JSON natively;
// we re-export so the rest of the frontend has a stable module
// path that doesn't reach across the project layout.
//
// Change her name there. Everything downstream picks it up on
// the next dev reload or build.

import agentJson from '../../../config/agent.json';

export const AGENT_NAME =
  agentJson.name ?? 'Violet';

export const USER_NAME =
  agentJson.userName ?? 'Hamza';

export const AGENT_PERSONALITY =
  agentJson.personality ?? {};

export default agentJson;
