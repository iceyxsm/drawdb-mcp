#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
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

// Resolve file path: explicit flag > positional arg > default
const filePath = values.file || positionals[0] || "drawdb-schema.json";
const resolvedPath = resolve(filePath);

const server = await createServer({ filePath: resolvedPath, watch: values.watch });
await server.start();
