import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { watch as fsWatch } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * DiagramStore manages loading, caching, and persisting a DrawDB diagram file.
 * Supports both .json and .ddb formats.
 * If the file does not exist, creates an empty diagram automatically.
 */
export class DiagramStore {
  constructor(filePath, { watch = false } = {}) {
    this.filePath = filePath;
    this.watchEnabled = watch;
    this.diagram = null;
    this.watcher = null;
  }

  async load() {
    if (!existsSync(this.filePath)) {
      // Auto-create an empty diagram. Database left empty intentionally so
      // the AI has to ask the user which dialect they want.
      this.diagram = {
        tables: [],
        relationships: [],
        notes: [],
        subjectAreas: [],
        types: [],
        enums: [],
        database: "",
        title: basename(this.filePath, ".json"),
      };
      // Ensure directory exists
      await mkdir(dirname(this.filePath), { recursive: true });
      await this.save();
    } else {
      const raw = await readFile(this.filePath, "utf-8");
      this.diagram = JSON.parse(raw);
    }

    this._normalize();

    if (this.watchEnabled && !this.watcher) {
      this.watcher = fsWatch(this.filePath, async () => {
        try {
          const updated = await readFile(this.filePath, "utf-8");
          this.diagram = JSON.parse(updated);
          this._normalize();
        } catch {
          // File may be mid-write; ignore transient errors
        }
      });
    }

    return this.diagram;
  }

  async save() {
    const data = JSON.stringify(this.diagram, null, 2);
    await writeFile(this.filePath, data, "utf-8");
  }

  /** Ensure all expected top-level arrays exist */
  _normalize() {
    if (!this.diagram.tables) this.diagram.tables = [];
    if (!this.diagram.relationships) this.diagram.relationships = [];
    if (!this.diagram.notes) this.diagram.notes = [];
    if (!this.diagram.subjectAreas) this.diagram.subjectAreas = [];
    if (!this.diagram.types) this.diagram.types = [];
    if (!this.diagram.enums) this.diagram.enums = [];
    if (this.diagram.database === undefined || this.diagram.database === null) {
      this.diagram.database = "";
    }
    if (!this.diagram.title) this.diagram.title = basename(this.filePath, ".json");
  }

  // --- Accessors ---

  get tables() {
    return this.diagram.tables;
  }

  get relationships() {
    return this.diagram.relationships;
  }

  get notes() {
    return this.diagram.notes;
  }

  get subjectAreas() {
    return this.diagram.subjectAreas;
  }

  get types() {
    return this.diagram.types;
  }

  get enums() {
    return this.diagram.enums;
  }

  get database() {
    return this.diagram.database;
  }

  get title() {
    return this.diagram.title;
  }

  // --- Helpers ---

  findTable(name) {
    return this.tables.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
  }

  findTableById(id) {
    return this.tables.find((t) => t.id === id || String(t.id) === String(id));
  }

  getRelationshipsForTable(tableName) {
    const table = this.findTable(tableName);
    if (!table) return [];
    return this.relationships.filter(
      (r) =>
        String(r.startTableId) === String(table.id) ||
        String(r.endTableId) === String(table.id),
    );
  }

  nextTableId() {
    if (this.tables.length === 0) return 0;
    const maxId = Math.max(
      ...this.tables.map((t) => (typeof t.id === "number" ? t.id : 0)),
    );
    return maxId + 1;
  }

  nextFieldId(table) {
    if (!table.fields || table.fields.length === 0) return 0;
    const maxId = Math.max(
      ...table.fields.map((f) => (typeof f.id === "number" ? f.id : 0)),
    );
    return maxId + 1;
  }

  nextRelationshipId() {
    if (this.relationships.length === 0) return 0;
    const maxId = Math.max(
      ...this.relationships.map((r) => (typeof r.id === "number" ? r.id : 0)),
    );
    return maxId + 1;
  }
}
