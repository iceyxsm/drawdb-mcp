#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createServer } from "../src/index.js";

const { values, positionals } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    watch: { type: "boolean", short: "w", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
drawdb-mcp -- MCP server for DrawDB diagrams

Usage:
  drawdb-mcp [options] [file]

Options:
  -f, --file <path>   Path to a .ddb or .json diagram file (optional)
  -w, --watch         Watch the file for changes and reload automatically
  -h, --help          Show this help message

If no file is specified, defaults to ./drawdb-schema.json in the current
working directory. If the file does not exist, it will be created automatically
as an empty diagram.

Examples:
  drawdb-mcp
  drawdb-mcp --file ./schema.json
  drawdb-mcp --file ./schema.json --watch
  drawdb-mcp ./my-project/database.ddb

The server communicates over stdio using the Model Context Protocol.
Compatible with Claude Code, Cursor, VS Code (Copilot), Windsurf, Kiro, and more.
`);
  process.exit(0);
}

// Detect interactive terminal usage. MCP servers communicate over stdio,
// so if a human is running this directly in a TTY, show setup instructions
// instead of silently hanging waiting for protocol messages.
if (process.stdin.isTTY) {
  console.error(`
drawdb-mcp is an MCP server -- it talks to AI clients (Claude Code, Cursor,
Kiro, VS Code Copilot, etc.) over stdio. It is not meant to run directly in a
terminal. Running it like this will appear to hang because it is waiting for
MCP protocol messages on stdin that will never come.

To use it, add this to your MCP client config:

  Claude Code:    claude mcp add drawdb-mcp -- npx drawdb-mcp
  Cursor:         .cursor/mcp.json
  Kiro:           .kiro/settings/mcp.json
  VS Code:        .vscode/mcp.json
  Codex:          ~/.codex/config.toml

Example config (Cursor / Kiro / VS Code):

  {
    "mcpServers": {
      "drawdb": {
        "command": "npx",
        "args": ["drawdb-mcp"]
      }
    }
  }

Then ask your AI assistant to design or review a database, and it will call
the drawdb-mcp tools automatically.

Full docs: https://github.com/iceyxsm/drawdb-mcp

Run with --help to see CLI options. Press Ctrl+C to exit.
`);
}

// Resolve file path: explicit flag > positional arg > default
const filePath = values.file || positionals[0] || "drawdb-schema.json";
const resolvedPath = resolve(filePath);

const server = await createServer({ filePath: resolvedPath, watch: values.watch });
await server.start();
