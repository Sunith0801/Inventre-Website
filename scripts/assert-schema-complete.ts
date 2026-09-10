/**
 * Assert that the database in DATABASE_URL contains everything db/schema.ts
 * declares.
 *
 * WHY. `npx tsx db/migrate.ts` succeeding only proves the migrations ran. It
 * does not prove they built the right schema — and for most of this project's
 * life they did not. `drizzle-kit push` had put one schema, eleven tables, an
 * enum and 110 columns onto the live databases that no migration ever wrote
 * down, and nothing anywhere compared the two. The application kept working
 * because it queries the live databases, which had the columns; only a
 * rebuild from source would have revealed the gap, and nobody rebuilds from
 * source until the day they must.
 *
 * So this is the check that would have caught it: every table and column
 * drizzle knows about must exist in the database the migrations just built.
 *
 * The comparison is deliberately one-way. Columns that exist in the database
 * but not in schema.ts are NOT failures — schools.grade_offset and
 * schools.kit_label are exactly that, live columns the schema no longer
 * describes, and demanding their removal would be this script picking a fight
 * with production. What matters is the direction that breaks the app: a
 * column the code selects and the database does not have.
 *
 * Used by the CI build job. Exits 1 and names every missing object.
 */
import postgres from "postgres";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_DIRECT_URL;
  if (!url) {
    console.error("[assert-schema] DATABASE_URL must be set");
    process.exit(1);
  }

  // What db/schema.ts declares.
  const declared = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    const key = `${cfg.schema ?? "public"}.${cfg.name}`;
    declared.set(key, new Set(cfg.columns.map((c) => c.name)));
  }

  const client = postgres(url, { max: 1, prepare: false });
  try {
    const rows = await client<{ table_schema: string; table_name: string; column_name: string }[]>`
      SELECT table_schema, table_name, column_name
        FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `;

    const actual = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!actual.has(key)) actual.set(key, new Set());
      actual.get(key)!.add(r.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const [table, columns] of declared) {
      const present = actual.get(table);
      if (!present) {
        missingTables.push(table);
        continue;
      }
      for (const column of columns) {
        if (!present.has(column)) missingColumns.push(`${table}.${column}`);
      }
    }

    const declaredColumns = [...declared.values()].reduce((n, s) => n + s.size, 0);

    if (missingTables.length === 0 && missingColumns.length === 0) {
      console.log(
        `[assert-schema] OK — all ${declared.size} tables and ${declaredColumns} columns declared in db/schema.ts exist in the database.`
      );
      return;
    }

    console.error(
      `[assert-schema] the database is missing objects that db/schema.ts declares.\n` +
        `This means db/migrations cannot build the schema the application is typed against.\n`
    );
    for (const t of missingTables.sort()) console.error(`  missing table   ${t}`);
    for (const c of missingColumns.sort()) console.error(`  missing column  ${c}`);
    console.error(
      `\n${missingTables.length} table(s) and ${missingColumns.length} column(s) missing. ` +
        `Add them in a migration — see db/migrations/0014_missing_pushed_tables.sql.`
    );
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main();
