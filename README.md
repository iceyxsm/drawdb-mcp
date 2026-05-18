# drawdb-mcp

MCP (Model Context Protocol) server for [DrawDB](https://github.com/drawdb-io/drawdb) -- exposes database schema diagrams to AI development agents for reading, writing, and exporting.

## Features

- **Read** -- Inspect tables, columns, relationships, enums, types, and notes
- **Write** -- Add/remove/update tables, fields, relationships, indices, and enums
- **Export** -- Generate SQL DDL (all 6 dialects), DBML, and JSON
- **File watching** -- Automatically reloads when the diagram file changes
- **Zero setup** -- Runs on Node.js with no external services or API keys
- **Compatible** -- Works with any DrawDB JSON export (`.json` or `.ddb` files)

## Quick Start

### With npx (no install)

```bash
npx drawdb-mcp --file ./schema.json
```

### Install globally

```bash
npm install -g drawdb-mcp
drawdb-mcp --file ./schema.json --watch
```

## MCP Client Configuration

### Claude Code

```bash
claude mcp add drawdb-mcp -- npx drawdb-mcp --file ./schema.json
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "drawdb": {
      "command": "npx",
      "args": ["drawdb-mcp", "--file", "./schema.json"]
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
      "args": ["drawdb-mcp", "--file", "./schema.json"]
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
      "args": ["drawdb-mcp", "--file", "./schema.json"]
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.drawdb]
command = "npx"
args = ["drawdb-mcp", "--file", "./schema.json"]
```

## Available Tools

### Read Tools

| Tool | Description |
|------|-------------|
| `get_schema_summary` | High-level overview: table count, relationships, dialect, etc. |
| `list_tables` | All table names with field counts and comments |
| `describe_table` | Full column definitions for a given table |
| `list_relationships` | All FK relationships with cardinality and actions |
| `describe_relationship` | Detailed relationship info between two tables |
| `list_enums` | All user-defined enums |
| `list_types` | All custom types |
| `search_tables` | Search tables/columns by name or comment |

### Write Tools

| Tool | Description |
|------|-------------|
| `add_table` | Create a new table with columns |
| `add_field` | Add a column to an existing table |
| `update_field` | Modify a column's properties |
| `remove_field` | Remove a column (and related relationships) |
| `remove_table` | Remove a table (and related relationships) |
| `add_relationship` | Create a foreign key relationship |
| `remove_relationship` | Remove a relationship by name |
| `add_index` | Add an index to a table |
| `add_enum` | Add a new enum type |
| `add_note` | Add a note to the diagram |

### Export Tools

| Tool | Description |
|------|-------------|
| `export_ddl` | SQL DDL for all 6 dialects (MySQL, PostgreSQL, SQLite, MariaDB, MSSQL, Oracle) |
| `export_dbml` | Schema in DBML format |
| `export_json` | Full diagram in native DrawDB JSON format |

### Architect Tools

| Tool | Description |
|------|-------------|
| `get_design_prompt` | Returns the database architecture system prompt. **Call this FIRST before any schema design work** to prime the AI with production-grade design principles. |
| `design_schema` | Design a full production-grade schema from product requirements. Returns architecture doc + actionable steps for the write tools. |
| `validate_schema_quality` | Quick automated check -- flags missing PKs, unindexed FKs, missing timestamps, orphan tables, etc. Returns a scored report. |
| `explain_schema` | Explain the current schema in plain English -- domain, data flow, relationships in business terms, design patterns detected, and implicit assumptions. |
| `review_schema` | Senior staff engineer production review -- performance risks, scalability analysis, data integrity, security/compliance, and concrete fix recommendations. |
| `upgrade_to_production` | Take any schema (even a naive 3-table CRUD) and generate a phased upgrade plan to production-grade with exact tool calls the AI can execute. |

### How the Architect Flow Works

**Designing from scratch:**
1. `get_design_prompt` -> primes AI with senior architect expertise
2. `design_schema` -> full architecture from product requirements
3. Execute the plan with `add_table`, `add_field`, `add_relationship`, `add_index`
4. `validate_schema_quality` -> catch remaining issues

**Understanding an existing schema:**
1. `explain_schema` -> full plain-English breakdown of what the schema does

**Upgrading a basic schema to production:**
1. `review_schema` -> get a brutal honest critique (like a Stripe PR review)
2. `upgrade_to_production` -> get a phased action plan with exact tool calls
3. Execute the plan -> schema is now production-grade

This means even a junior dev who designs a basic `users + posts + comments` schema can run `upgrade_to_production` and get it transformed into something with proper audit trails, indices, partitioning strategy, soft deletes, and event sourcing -- automatically.

## File Format

This server works with DrawDB's native JSON export format (`.json` or `.ddb` files). You can export a diagram from DrawDB via **File -> Export -> JSON**, or create one programmatically using the write tools.

## Use Cases

- **Production-grade schema design** -- AI agents design databases with event sourcing, partitioning, audit trails, and proper indexing out of the box
- **Schema-aware code generation** -- AI agents generate ORM models, migrations, and API endpoints aligned with your schema
- **Code review with schema context** -- Agents cross-reference code against the database design
- **Natural language querying** -- Ask "which tables reference users?" and get instant answers
- **Documentation generation** -- Produce data dictionaries from the source of truth
- **Schema validation** -- Catch anti-patterns, missing indices, and scaling risks before they hit production

## License

AGPL-3.0 (same as DrawDB)
