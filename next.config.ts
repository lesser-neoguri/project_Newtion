import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Used by the MCP endpoint to edit documents on the server; load them from node_modules at runtime.
  // yjs must be a single instance shared with BlockNote, so none of these may be bundled.
  serverExternalPackages: ["happy-dom", "@blocknote/server-util", "@blocknote/core", "yjs", "y-prosemirror", "y-protocols"],
};

export default nextConfig;
