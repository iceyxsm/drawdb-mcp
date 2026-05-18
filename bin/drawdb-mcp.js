#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createServer } from "../src/index.js";

const { values } = parseArgs({
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
  -f, --file <path>   Path to a .ddb or .json diagram file
  -w, --watch         Watch the file for changes and reload automatically
  -h, --help          Show this help message

Examples:
  drawdb-mcp --file ./schema.ddb
  drawdb-mcp --file ./schema.json --watch
  drawdb-mcp ./my-project/database.ddb

The server communicates over stdio using the Model Context Protocol.
Compatible with Claude Code, Cursor, VS Code (Copilot), Windsurf, Kiro, and more.
`);
  process.exit(0);
}

const filePath = values.file || process.argv[process.argv.length - 1];

if (!filePath || filePath.endsWith("drawdb-mcp.js")) {
  console.error(
    "Error: No diagram file specified. Use --file <path> or pass a file as argument.",
  );
  console.error("Run drawdb-mcp --help for usage information.");
  process.exit(1);
}

const resolvedPath = resolve(filePath);

const server = await createServer({ filePath: resolvedPath, watch: values.watch });
await server.start();
