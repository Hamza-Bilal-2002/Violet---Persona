// Allow Vite to serve files from outside the frontend/ root.
// We need this so frontend/js/config/agentConfig.js can import
// the single-source-of-truth config/agent.json at the project root.
//
// fs.allow accepts a list of directories; '..' grants access to
// the project root. Without this, Vite blocks the import for
// security and the frontend can't see the agent name.

export default {
  // Emit RELATIVE asset URLs ("./assets/…") in the built index.html.
  // Electron loads the production build over file://, where the default
  // absolute "/assets/…" would resolve to the drive root and 404. With
  // base "./" the bundle, CSS, and the public/ assets (models, animations)
  // all resolve relative to dist/index.html in both dev and packaged runs.
  base: "./",
  server: {
    fs: {
      allow: [".."],
    },
  },
};
