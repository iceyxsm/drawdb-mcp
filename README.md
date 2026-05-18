# drawdb-mcp

[![npm version](https://img.shields.io/npm/v/drawdb-mcp)](https://www.npmjs.com/package/drawdb-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)
[![DrawDB](https://img.shields.io/badge/DrawDB-schema%20tool-orange)](https://drawdb.app)

The most complete MCP (Model Context Protocol) server for [DrawDB](https://github.com/drawdb-io/drawdb). Lets AI agents design, review, edit, and deploy production-grade database schemas end-to-end -- from natural language requirements to deployable SQL files, with live DrawDB browser integration.

41 tools across 8 groups: read, write, export, architect, sequential thinking, templates, migrations, browser integration, and deployment.

## Why this exists

Most database MCP servers connect to a live database and let AI run queries. This one is different -- it works at **design time**, before the database exists. The AI thinks through the architecture step by step, designs the schema using production patterns (event sourcing, partitioning, audit trails), validates it for anti-patterns, and produces a deployment-ready SQL file. Then it pushes the visual diagram into a running DrawDB tab so you can see it instantly.

Pair it with [postgres-mcp](https://github.com/crystaldba/postgres-mcp) for the full lifecycle: drawdb-mcp designs, postgres-mcp tunes.

## Features

- **Sequential thinking for DB design** -- AI reasons through 13 phases (domain analysis, workload, partitioning, audit, etc.) before writing any SQL
- **Production-grade architect prompts** -- baked-in expertise from Stripe/Coinbase/Jane Street style engineering
- **5 production schema templates** -- SaaS multi-tenant, e-commerce, fintech ledger, social platform, analytics pipeline
- **Live DrawDB browser integration** -- pushes diagrams into a running browser tab via Chrome DevTools Protocol, no DrawDB modification needed
- **Auto-launch browser** -- detects Chrome/Edge/Brave/Chromium and starts it with debug port
- **Deployable SQL output** -- single-file or full bundle (schema + indices + rollback + README) for all 6 dialects
- **Migration generation** -- diff two schema versions, produce ALTER TABLE statements
- **Deep constraint validation** -- type compatibility on FKs, circular refs, redundant indices, reserved words, and more
- **Multi-dialect type awareness** -- proper PostgreSQL/MySQL/SQLite/MariaDB/MSSQL/Oracle output with all the quirks
- **File watching** -- automatically reloads when the diagram file changes
- **Auto-create** -- if the diagram file doesn't exist, creates an empty one and starts fresh
- **Zero setup** -- runs on Node.js with no API keys or external services

## Quick Start

### With npx (no install)

```bash
npx drawdb-mcp
```

That's it. The server creates `./drawdb-schema.json` if it doesn't exist and listens on stdio.

### Install globally

```bash
npm install -g drawdb-mcp
drawdb-mcp --file ./my-schema.json --watch
```

### CLI options

```
Options:
  -f, --file <path>   Path to a .ddb or .json diagram file (optional, defaults to ./drawdb-schema.json)
  -w, --watch         Watch the file for external changes and reload automatically
  -h, --help          Show help
```

If the file doesn't exist, it's created automatically with an empty diagram.

## MCP Client Configuration

### Claude Code

```bash
claude mcp add drawdb-mcp -- npx drawdb-mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "drawdb": {
      "command": "npx",
      "args": ["drawdb-mcp"]
    }
  }
}
```

### Kiro

Add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "drawdb": {
      "command": "npx",
      "args": ["drawdb-mcp"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "drawdb": {
      "command": "npx",
      "args": ["drawdb-mcp"]
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.drawdb]
command = "npx"
args = ["drawdb-mcp"]
```

### Windsurf, OpenCode, and other MCP clients

Use the same `npx drawdb-mcp` command pattern. Pass `--file <path>` if you want to use a specific diagram file.

## End-to-End Workflow

The intended flow when an AI agent uses this MCP:

```
1. launch_browser              -> auto-starts Chrome and opens DrawDB
2. think_about_schema (x10-15) -> reasons through the design phase by phase
3. apply_template (optional)   -> seeds with a production template
4. add_table / add_field / ... -> materializes the design
5. validate_schema_quality     -> catches anti-patterns
6. validate_constraints        -> deep checks (FK types, circular refs, etc.)
7. open_in_drawdb              -> pushes the diagram to the live browser tab
8. export_to_file              -> writes a deployable schema.sql
   OR
   export_deployment_bundle    -> writes a full deployment directory
```

The user just says "design me a payments database for 100M users" and gets a production-ready schema visible in DrawDB plus a deployable SQL file.

## Available Tools

### Sequential Thinking (5 tools)

The AI works through database design step by step, like the official [Sequential Thinking MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) but specialized for databases.

| Tool | Description |
|------|-------------|
| `think_about_schema` | Step-by-step reasoning for new schema design across 13 phases (domain, workload, entities, indexing, partitioning, audit, etc.) |
| `think_about_review` | Step-by-step reasoning for reviewing existing schemas (8 phases with severity tagging) |
| `think_about_edit` | Step-by-step reasoning for safe schema edits (impact analysis, rollback plan, execution order) |
| `get_thinking_context` | Retrieve the full thought history for the current session |
| `reset_thinking` | Clear thought history to start fresh |

### Architect (6 tools)

| Tool | Description |
|------|-------------|
| `get_design_prompt` | Returns the production-grade architect system prompt. Call this first to prime the AI. |
| `design_schema` | Design a full schema from product requirements (users, TPS, retention, regions). Returns architecture doc + action plan. |
| `validate_schema_quality` | Quick automated check -- missing PKs, unindexed FKs, missing timestamps, orphan tables. Returns scored report. |
| `validate_constraints` | Deep validation -- FK type compatibility, circular references, redundant indices, reserved words, naming conventions, default value types, enum consistency, size validation, relationship integrity. |
| `explain_schema` | Plain-English breakdown -- domain, data flow, business-level relationships, design patterns detected, implicit assumptions, missing context. |
| `review_schema` | Senior staff engineer production review -- critical issues, performance risks, scalability, data integrity, compliance, concrete fix recommendations. |
| `upgrade_to_production` | Take any naive schema and generate a 6-phase upgrade plan (foundation, integrity, performance, audit, scale, ops) with exact tool calls. |

### Templates (2 tools)

Pre-built production-grade schemas you can drop into a diagram. All include UUID PKs, timestamps, proper indices, and comments.

| Tool | Description |
|------|-------------|
| `list_templates` | List all available templates with descriptions |
| `apply_template` | Apply a template to the current diagram |

Available templates:

- **saas_multi_tenant** -- organizations, users, memberships, api_keys, audit_log with `org_id` tenant isolation
- **ecommerce** -- products, categories, orders, order_items, customers, addresses, payments, inventory, reviews
- **fintech_ledger** -- double-entry accounting with append-only ledger, materialized balances, reconciliation
- **social_platform** -- users, posts, comments, likes, follows, notifications, media
- **analytics_pipeline** -- events, sessions, page_views, conversions, daily aggregates

### Browser Integration (3 tools)

Connects to a running Chrome instance via Chrome DevTools Protocol and pushes diagrams directly into DrawDB's IndexedDB. No DrawDB modification or extension required.

| Tool | Description |
|------|-------------|
| `launch_browser` | Auto-detect and launch Chrome/Edge/Brave/Chromium with `--remote-debugging-port=9222` and open DrawDB. Idempotent -- detects existing instance. |
| `find_drawdb_tab` | Verify the connection and show open DrawDB tabs |
| `open_in_drawdb` | Push the current diagram into the running DrawDB tab. Tab navigates to the new diagram instantly. |
| `reload_drawdb_tab` | Reload the DrawDB tab |

### Deployment (2 tools)

| Tool | Description |
|------|-------------|
| `export_to_file` | Write a complete, runnable `.sql` file -- header, transactions, types/enums, tables, indices, FKs, comments. Idempotent (`IF NOT EXISTS`). Optional `include_drop` for fresh installs. |
| `export_deployment_bundle` | Write a full deployment directory: `schema.sql` + `indices.sql` (separate for fast bulk loads) + `rollback.sql` + `README.md` with run instructions. |

### Migrations (2 tools)

| Tool | Description |
|------|-------------|
| `snapshot_schema` | Save the current diagram state as a JSON baseline |
| `generate_migration` | Diff a previous snapshot against the current state, produce `ALTER TABLE` statements. Handles added/removed/modified tables, columns, indices, and relationships. Dialect-aware. |

### Read (8 tools)

| Tool | Description |
|------|-------------|
| `get_schema_summary` | High-level overview: table count, relationships, dialect, subject areas, notes |
| `list_tables` | All table names with field counts and comments |
| `describe_table` | Full column definitions for a given table |
| `list_relationships` | All FK relationships with cardinality and referential actions |
| `describe_relationship` | Detailed relationship info between two tables |
| `list_enums` | All user-defined enums |
| `list_types` | All custom types |
| `search_tables` | Search tables/columns by name or comment |

### Write (10 tools)

| Tool | Description |
|------|-------------|
| `add_table` | Create a new table with columns |
| `add_field` | Add a column to an existing table |
| `update_field` | Modify a column's properties |
| `remove_field` | Remove a column (cascades to related relationships) |
| `remove_table` | Remove a table (cascades to related relationships) |
| `add_relationship` | Create a foreign key relationship |
| `remove_relationship` | Remove a relationship by name |
| `add_index` | Add an index to a table |
| `add_enum` | Add a new enum type |
| `add_note` | Add a note to the diagram |

### Export (3 tools)

| Tool | Description |
|------|-------------|
| `export_ddl` | SQL DDL string for any of the 6 supported dialects |
| `export_dbml` | Schema in DBML format (database-agnostic) |
| `export_json` | Full diagram in native DrawDB JSON format |

## Browser Integration Setup

The browser tools work by connecting to a Chrome instance with remote debugging enabled. The `launch_browser` tool handles this automatically:

1. AI calls `launch_browser`
2. Tool searches for Chrome/Edge/Brave/Chromium on Windows, Mac, or Linux
3. Launches it with `--remote-debugging-port=9222` and an isolated user data directory
4. Opens `https://drawdb.app/editor` (or your local instance)
5. AI calls `open_in_drawdb` to push diagrams into the tab

If you prefer to manage Chrome yourself, just launch with:

```bash
chrome --remote-debugging-port=9222
```

Then open DrawDB in any tab. The MCP will find it.

### Local DrawDB instance

If you're running DrawDB locally with `npm run dev`, pass your local URL:

```
launch_browser(url="http://localhost:5173/editor")
```

## Supported SQL Dialects

| Dialect | Identifier quoting | Auto-increment | Other quirks |
|---------|-------------------|----------------|--------------|
| PostgreSQL | `"name"` | `SERIAL` / `BIGSERIAL` | `TIMESTAMPTZ`, `CREATE TYPE` for enums, `COMMENT ON TABLE/COLUMN`, `BEGIN`/`COMMIT` DDL transactions |
| MySQL | `` `name` `` | `AUTO_INCREMENT` | `ENGINE=InnoDB`, inline `ENUM(...)`, inline `COMMENT '...'` |
| MariaDB | `` `name` `` | `AUTO_INCREMENT` | `CREATE TABLE IF NOT EXISTS`, same as MySQL otherwise |
| SQLite | `"name"` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Inline foreign keys, `CHECK` constraints for ENUMs, no `ALTER TABLE ADD CONSTRAINT` |
| MSSQL (T-SQL) | `[name]` | `IDENTITY(1,1)` | `NVARCHAR`, `DATETIME2`, `BIT` for booleans, `GO` separators |
| Oracle | `"name"` | `GENERATED ALWAYS AS IDENTITY` | `VARCHAR2`, `CLOB`, `NUMBER(1)` for booleans, `RAW(16)` for UUIDs |

## File Format

Native DrawDB JSON export format. Top-level keys: `tables`, `relationships`, `notes`, `subjectAreas`, `database`, `types`, `enums`, `title`. You can:

- Import an existing diagram exported from DrawDB (File -> Export -> JSON)
- Let the MCP create one from scratch (auto-create on first run)
- Apply a template via `apply_template`

## Production Output Quality

Generated SQL includes:

- Header with metadata (title, dialect, generation timestamp, table/relationship counts)
- Transactions where the dialect supports DDL transactions (PostgreSQL, MSSQL, Oracle)
- Idempotent creation: `CREATE TABLE IF NOT EXISTS`, `DO $$ EXCEPTION WHEN duplicate_object` for enums
- Proper section ordering: extensions -> types/enums -> tables -> comments -> indices -> foreign keys
- Optional rollback script that drops in safe reverse order with FK removal first
- Run command guidance in the README (`psql -f schema.sql`, `mysql < schema.sql`, etc.)

## Use Cases

- **Production-grade schema design from natural language** -- AI designs databases with event sourcing, partitioning, audit trails, and proper indexing out of the box
- **Visual + textual workflow** -- AI works in JSON, you see the result in DrawDB instantly
- **Schema-aware code generation** -- AI generates ORM models, migrations, and API endpoints aligned with the designed schema
- **Code review with schema context** -- agents cross-reference code against the database design
- **Schema validation in CI/CD** -- catch anti-patterns and scaling risks before deploy
- **Migration generation** -- diff schema versions to produce ALTER TABLE migrations
- **Onboarding** -- `explain_schema` produces plain-English documentation from any DrawDB diagram
- **Schema upgrades** -- `upgrade_to_production` transforms naive schemas into production-grade ones automatically

## How It Compares

| | drawdb-mcp | postgres-mcp | anatoly314/drawdb-mcp |
|--|--|--|--|
| Schema design from scratch | yes | no | yes (via WebSocket GUI control) |
| Sequential thinking | yes | no | no |
| Production templates | 5 templates | no | no |
| Live DrawDB integration | via CDP | n/a | via WebSocket (requires modified DrawDB backend) |
| Multi-dialect DDL output | 6 dialects | PostgreSQL only | 6 dialects |
| Migration generation | yes | no | no |
| Schema review/explain/upgrade | yes | no | no |
| Live DB tuning, EXPLAIN plans | no (use postgres-mcp) | yes | no |
| Requires running database | no | yes | yes (DrawDB GUI) |

drawdb-mcp is for **design time**. postgres-mcp is for **runtime tuning**. Use both.

## License

MIT

## Repository

https://github.com/iceyxsm/drawdb-mcp
