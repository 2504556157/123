const fs = require("fs");
const path = require("path");

let _wasmBinary = null;
try {
  const wasmPath = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
  _wasmBinary = fs.readFileSync(wasmPath);
} catch(e) { console.error("WASM load failed:", e.message); }

let DB_PATH = path.join(__dirname, "data", "stock_analysis.db");
if (process.env.DATA_DIR) {
  DB_PATH = path.join(process.env.DATA_DIR, "stock_analysis.db");
}

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let _db = null;

function save() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function prepare(sql) {
  const stmt = _db.prepare(sql);
  return {
    all(params) {
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    get(...paramsArgs) {
      if (paramsArgs && paramsArgs.length > 0) {
        const arr = paramsArgs.length === 1 && Array.isArray(paramsArgs[0]) ? paramsArgs[0] : paramsArgs;
        stmt.bind(arr);
      }
      let row = null;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row;
    },
    run(...paramsArgs) {
      if (paramsArgs && paramsArgs.length > 0) {
        const arr = paramsArgs.length === 1 && Array.isArray(paramsArgs[0]) ? paramsArgs[0] : paramsArgs;
        stmt.bind(arr);
      }
      stmt.run();
      stmt.free();
      const r = _db.exec("SELECT last_insert_rowid() as id, changes() as changes");
      save();
      return {
        lastInsertRowid: r[0]?.values[0]?.[0],
        changes: r[0]?.values[0]?.[1] || 0
      };
    }
  };
}

function exec(sql) {
  _db.run(sql);
  save();
}

module.exports = (async () => {
  const initSqlJs = require("sql.js");
  // WASM preloaded above
const SQL = await initSqlJs(_wasmBinary ? { wasmBinary: _wasmBinary } : {});
  // Fallback: locate WASM file relative to project root
  if (!_wasmBinary && !SQL) {
    const SQL = await initSqlJs({
      locateFile: file => path.join(__dirname, 'node_modules/sql.js/dist/', file)
    });
  }
  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");

  // Create tables
  _db.run(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'stock' CHECK(type IN ('stock', 'sector')),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(code, type)
    );
    CREATE TABLE IF NOT EXISTS analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id),
      analysis_date TEXT NOT NULL,
      chan_theory TEXT NOT NULL DEFAULT '',
      volume_price TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(stock_id, analysis_date)
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL REFERENCES analysis(id),
      direction TEXT NOT NULL CHECK(direction IN ('up', 'down', 'sideways')),
      reason TEXT DEFAULT '',
      actual_result TEXT CHECK(actual_result IN ('up', 'down', 'sideways', NULL)),
      is_correct INTEGER CHECK(is_correct IN (0, 1, NULL)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS daily_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_date TEXT UNIQUE NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  save();

  // Migration: add price columns
  try { _db.run("ALTER TABLE predictions ADD COLUMN reference_price REAL"); } catch(e) {}
  try { _db.run("ALTER TABLE predictions ADD COLUMN price_date TEXT"); } catch(e) {}
  save();

  return { prepare, exec };
})();
