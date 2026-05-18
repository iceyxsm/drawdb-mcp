import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DiagramStore } from "./store.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerExportTools } from "./tools/export.js";
import { registerArchitectTools } from "./tools/architect.js";

export async function createServer({ filePath, watch = false }) {
  const store = new DiagramStore(filePath, { watch });

  const server = new McpServer({
    name: "drawdb-mcp",
    version: "0.1.0",
  });

  // Register all tool groups
  registerReadTools(server, store);
  registerWriteTools(server, store);
  registerExportTools(server, store);
  registerArchitectTools(server, store);

  return {
    async start() {
      await store.load();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
