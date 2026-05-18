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

  // Register MCP prompts -- these are surfaced to the AI automatically on connect
  server.prompt(
    "database-architect",
    "Use this prompt when designing or reviewing any database schema. It primes you with production-grade database architecture principles.",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are connected to a DrawDB MCP server managing a database diagram file.

IMPORTANT WORKFLOW RULES:
1. Before designing ANY new schema, call "design_schema" with the product requirements.
2. Before modifying an existing schema, call "explain_schema" first to understand it.
3. After making changes, call "validate_schema_quality" to check for issues.
4. If the user has a basic schema and wants it improved, call "upgrade_to_production".
5. For a full production review, call "review_schema".

NEVER create naive CRUD schemas directly with add_table. Always go through the architect tools first -- they enforce production-grade patterns (proper indexing, audit trails, partitioning, event sourcing, UUID keys, timestamps on every table).

Available tool groups:
- READ: get_schema_summary, list_tables, describe_table, list_relationships, describe_relationship, list_enums, list_types, search_tables
- WRITE: add_table, add_field, update_field, remove_field, remove_table, add_relationship, remove_relationship, add_index, add_enum, add_note
- EXPORT: export_ddl, export_dbml, export_json
- ARCHITECT: get_design_prompt, design_schema, validate_schema_quality, explain_schema, review_schema, upgrade_to_production`,
          },
        },
      ],
    }),
  );

  return {
    async start() {
      await store.load();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
