// Allow Vite to serve files from outside the frontend/ root.
// We need this so frontend/js/config/agentConfig.js can import
// the single-source-of-truth config/agent.json at the project root.
//
// fs.allow accepts a list of directories; '..' grants access to
// the project root. Without this, Vite blocks the import for
// security and the frontend can't see the agent name.

export default {
  server: {
    fs: {
      allow: [".."],
    },
  },
};
