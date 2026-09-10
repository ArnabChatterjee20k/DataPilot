import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const dataDir = path.join(process.cwd(), "e2e", ".tmp");
export const seedDbPath = path.join(dataDir, "e2e-seed.db");

/**
 * Build the SQLite database the tests browse.
 *
 * It deliberately contains the awkward cases: a NULL, an empty string, a value
 * with a single quote in it, a JSON column, a timestamp, a low-cardinality
 * "status" column and a column whose name looks like a credential.
 */
function seed() {
  // Playwright starts the web servers before this runs, so the server's own
  // data directory must not be wiped here - only the seed file is replaced.
  fs.mkdirSync(path.join(dataDir, "bucket"), { recursive: true });
  fs.rmSync(seedDbPath, { force: true });

  const db = new DatabaseSync(seedDbPath);

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      status TEXT NOT NULL,
      api_token TEXT,
      settings TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX users_email_idx ON users (email);

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      total REAL NOT NULL,
      note TEXT
    );
  `);

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, status, api_token, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const users: [string, string | null, string, string | null, string, string][] = [
    ["Alice Johnson", "alice@example.com", "active", "tok_alice", '{"theme":"dark"}', "2024-03-01T09:15:00"],
    ["Bob Miller", "bob@example.com", "active", "tok_bob", '{"theme":"light"}', "2024-03-02T11:30:00"],
    ["Carol O'Brien", "carol@example.com", "suspended", null, "{}", "2024-03-03T14:45:00"],
    ["Dan Wu", "", "active", "tok_dan", '{"theme":"dark"}', "2024-03-04T08:00:00"],
    ["Erin Blake", null, "invited", null, "{}", "2024-03-05T16:20:00"],
    ["Frank Diaz", "frank@example.com", "suspended", "tok_frank", "{}", "2024-03-06T10:10:00"],
  ];
  for (const user of users) insertUser.run(...user);

  const insertOrder = db.prepare(
    "INSERT INTO orders (user_id, total, note) VALUES (?, ?, ?)"
  );
  for (let index = 1; index <= 120; index += 1) {
    insertOrder.run(
      (index % 6) + 1,
      Number((index * 3.75).toFixed(2)),
      index % 4 === 0 ? null : `Order note ${index}`
    );
  }

  db.close();
}

export default function globalSetup() {
  seed();
}
