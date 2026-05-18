import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DiagramStore } from "./store.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerExportTools } from "./tools/export.js";
import { registerArchitectTools } from "./tools/architect.js";
import { registerThinkingTools } from "./tools/thinking.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerMigrationTools } from "./tools/migrations.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerDeployTools } from "./tools/deploy.js";

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
  registerThinkingTools(server, store);
  registerTemplateTools(server, store);
  registerMigrationTools(server, store);
  registerBrowserTools(server, store);
  registerDeployTools(server, store);

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

1. DATABASE DIALECT FIRST. Before designing anything, call get_schema_summary to check the current database dialect. If it is empty:
   - If the user already mentioned a dialect (Postgres, MySQL, SQLite, MariaDB, MSSQL, Oracle), use it.
   - If the user mentioned a stack that implies one (Supabase -> postgresql, Planetscale -> mysql, etc.), use it.
   - Otherwise, suggest a dialect based on their requirements (e.g. financial systems -> postgresql for ACID + types; mobile/embedded -> sqlite; analytics with TimescaleDB -> postgresql) and confirm with the user before proceeding.
   - Set the dialect by calling new_diagram with the chosen database value, or by passing it in design_schema.
   - DO NOT silently default to any dialect. Ask or suggest with reasoning.

2. Before designing ANY new schema, use think_about_schema to reason step by step. Call it repeatedly (10-15 times) working through each phase.

3. Before modifying an existing schema, use think_about_edit to reason through the impact.

4. Before reviewing a schema, use think_about_review to analyze it systematically.

5. After thinking is complete, execute the plan with write tools (add_table, add_field, etc.)

6. After making changes, call validate_schema_quality and validate_constraints to check for issues.

7. Use get_thinking_context to review your reasoning so far. Use reset_thinking to start a new design session.

8. When the user wants to start something completely new, call new_diagram to clear the existing schema instead of editing on top of it.

NEVER create tables directly without thinking first. The thinking tools ensure production-grade output by forcing you to reason through domain analysis, workload patterns, indexing, partitioning, audit trails, and scalability before writing anything.

Available tool groups:
- THINKING: think_about_schema, think_about_review, think_about_edit, get_thinking_context, reset_thinking
- ARCHITECT: get_design_prompt, design_schema, validate_schema_quality, validate_constraints, explain_schema, review_schema, upgrade_to_production
- READ: get_schema_summary, list_tables, describe_table, list_relationships, describe_relationship, list_enums, list_types, search_tables
- WRITE: add_table, add_field, update_field, remove_field, remove_table, add_relationship, remove_relationship, add_index, add_enum, add_note, new_diagram
- EXPORT: export_ddl, export_dbml, export_json
- DEPLOY: export_to_file, export_deployment_bundle
- TEMPLATES: list_templates, apply_template
- MIGRATIONS: snapshot_schema, generate_migration
- BROWSER: launch_browser, find_drawdb_tab, open_in_drawdb, reload_drawdb_tab`,
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
