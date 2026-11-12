/**
 * Security and integrity tests against the real migrations in a real
 * Postgres (PGlite). Every rule here is enforced by the database, not by
 * the app, so a modified client can't get around it.
 */

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "@/lib/gps/testing/pg";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const FINGERPRINT = "a".repeat(64);

const matchData = { id: "m-1", goals: 2, assists: 1, rating: 7.5, position: "CM", notes: "Kept", zones: [{ col: 1, row: 1, intensity: 2 }] };
const summary = (level = "usable") => ({ schemaVersion: 1, algorithmVersion: 1, quality: { level }, intervals: [{ start: 0, end: 1 }] });
const heatmap = { encoding: "u16-base64", data: "AAA=" };

let db: PGlite;

async function addImport(user: string, id: string, fingerprint = FINGERPRINT) {
  return asUser(db, user, (tx) =>
    tx.query(
      `insert into public.gps_imports (id, fingerprint, format, byte_size, storage_path, started_at, ended_at, point_count)
       values ($1, $2, 'gpx', 100, $3, now() - interval '1 hour', now(), 100) returning id`,
      [id, fingerprint, `${user}/${id}.gpx`],
    ),
  );
}

async function attach(user: string, matchId: string, importId: string, level = "usable") {
  return asUser(db, user, (tx) =>
    tx.query<{ track_id: string; replaced_import_id: string | null }>(
      `select * from public.attach_gps_track($1, $2, null, 1, $3, $4::jsonb, $5::jsonb)`,
      [matchId, importId, level, JSON.stringify(summary(level)), JSON.stringify(heatmap)],
    ),
  );
}

const rows = async <T>(user: string, sql: string, params: unknown[] = []) =>
  (await asUser(db, user, (tx) => tx.query<T>(sql, params))).rows;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [ALICE, BOB]);
  for (const user of [ALICE, BOB]) {
    await asUser(db, user, (tx) => tx.query(`insert into public.matches (id, data) values ('m-1', $1)`, [matchData]));
  }
});

describe("GPS tables: ownership and isolation", () => {
  it("attaches an import to the player's own match and leaves the match untouched", async () => {
    await addImport(ALICE, "11111111-1111-4111-8111-111111111111");
    const result = await attach(ALICE, "m-1", "11111111-1111-4111-8111-111111111111");
    expect(result.rows[0].track_id).toBeTruthy();
    expect(result.rows[0].replaced_import_id).toBeNull();
    const [match] = await rows<{ data: typeof matchData }>(ALICE, `select data from public.matches where id = 'm-1'`);
    expect(match.data).toEqual(matchData);
  });

  it("hides one player's GPS data from another", async () => {
    expect(await rows(BOB, `select * from public.gps_imports`)).toEqual([]);
    expect(await rows(BOB, `select * from public.match_gps_tracks`)).toEqual([]);
    const updated = await rows(BOB, `update public.match_gps_tracks set heatmap_source = 'manual' returning id`);
    expect(updated).toEqual([]);
    const deleted = await rows(BOB, `delete from public.gps_imports returning id`);
    expect(deleted).toEqual([]);
    expect(await rows(ALICE, `select id from public.gps_imports`)).toHaveLength(1);
  });

  it("refuses to link a track to another player's match or import", async () => {
    // Bob has a match with the same id, but Alice's import can't be linked to it.
    await expect(attach(BOB, "m-1", "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/Import not found/);
    // Writing the row directly is stopped by RLS and the composite foreign keys.
    await expect(
      asUser(db, BOB, (tx) =>
        tx.query(
          `insert into public.match_gps_tracks (user_id, match_id, import_id, algorithm_version, quality, summary, heatmap)
           values ($1, 'm-1', '11111111-1111-4111-8111-111111111111', 1, 'usable', '{}', '{}')`,
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await addImport(BOB, "22222222-2222-4222-8222-222222222222");
    await expect(
      asUser(db, BOB, (tx) =>
        tx.query(
          `insert into public.match_gps_tracks (match_id, import_id, algorithm_version, quality, summary, heatmap)
           values ('m-1', '11111111-1111-4111-8111-111111111111', 1, 'usable', '{}', '{}')`,
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("refuses a match the player doesn't have", async () => {
    await expect(attach(ALICE, "m-missing", "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/Match not found/);
  });

  it("refuses anonymous access entirely", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.gps_imports`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.attach_gps_track('m-1', gen_random_uuid(), null, 1, 'usable', '{}', '{}')`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("only accepts storage paths inside the owner's folder", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(
          `insert into public.gps_imports (id, fingerprint, format, byte_size, storage_path, started_at, ended_at, point_count)
           values ('33333333-3333-4333-8333-333333333333', $1, 'gpx', 100, $2, now(), now(), 10)`,
          ["b".repeat(64), `${BOB}/33333333-3333-4333-8333-333333333333.gpx`],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("flags duplicates per player by fingerprint", async () => {
    await expect(addImport(ALICE, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/duplicate key/);
    // The same file is fine for a different player (Bob uploaded it in an earlier test).
    expect(await rows(BOB, `select fingerprint from public.gps_imports`)).toEqual([{ fingerprint: FINGERPRINT }]);
  });

  it("validates the payload on the server", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(`select * from public.attach_gps_track('m-1', '11111111-1111-4111-8111-111111111111', null, 1, 'usable', '{"schemaVersion":1}', $1)`, [heatmap]),
      ),
    ).rejects.toThrow(/summary is invalid/);
    // Insufficient recordings can't be stored as a heatmap.
    await expect(attach(ALICE, "m-1", "11111111-1111-4111-8111-111111111111", "insufficient")).rejects.toThrow(/check constraint/);
  });
});

describe("GPS tables: replace, delete and cleanup", () => {
  it("replaces the active track atomically and reports the import it replaced", async () => {
    await addImport(ALICE, "66666666-6666-4666-8666-666666666666", "c".repeat(64));
    await asUser(db, ALICE, (tx) => tx.query(`update public.match_gps_tracks set heatmap_source = 'manual'`));
    const result = await attach(ALICE, "m-1", "66666666-6666-4666-8666-666666666666");
    expect(result.rows[0].replaced_import_id).toBe("11111111-1111-4111-8111-111111111111");
    const tracks = await rows<{ import_id: string; heatmap_source: string }>(ALICE, `select import_id, heatmap_source from public.match_gps_tracks`);
    expect(tracks).toEqual([{ import_id: "66666666-6666-4666-8666-666666666666", heatmap_source: "manual" }]);
  });

  it("keeps the previous track when a replacement fails", async () => {
    await expect(attach(ALICE, "m-1", "77777777-7777-4777-8777-777777777777")).rejects.toThrow();
    expect(await rows(ALICE, `select id from public.match_gps_tracks where is_active`)).toHaveLength(1);
  });

  it("won't move a track to another match", async () => {
    await asUser(db, ALICE, (tx) => tx.query(`insert into public.matches (id, data) values ('m-2', '{}')`));
    await expect(asUser(db, ALICE, (tx) => tx.query(`update public.match_gps_tracks set match_id = 'm-2'`))).rejects.toThrow(/cannot be moved/);
  });

  it("deleting an import deletes its tracking but never the match", async () => {
    await rows(ALICE, `delete from public.gps_imports where id = '66666666-6666-4666-8666-666666666666'`);
    expect(await rows(ALICE, `select id from public.match_gps_tracks`)).toEqual([]);
    const [match] = await rows<{ data: typeof matchData }>(ALICE, `select data from public.matches where id = 'm-1'`);
    expect(match.data).toEqual(matchData);
  });

  it("deleting a match deletes its tracking", async () => {
    await attach(ALICE, "m-1", "11111111-1111-4111-8111-111111111111");
    await rows(ALICE, `delete from public.matches where id = 'm-1'`);
    expect(await rows(ALICE, `select id from public.match_gps_tracks`)).toEqual([]);
    // The import stays until the app removes it with its file (see the service's cleanup).
    expect(await rows(ALICE, `select id from public.gps_imports where id = '11111111-1111-4111-8111-111111111111'`)).toHaveLength(1);
  });

  it("keeps saved calibrations private and unique by name", async () => {
    await rows(ALICE, `insert into public.gps_calibrations (name, data) values ('Home pitch', '{"version":1}')`);
    await expect(rows(ALICE, `insert into public.gps_calibrations (name, data) values ('Home pitch', '{}')`)).rejects.toThrow(/duplicate key/);
    expect(await rows(BOB, `select * from public.gps_calibrations`)).toEqual([]);
  });
});

describe("GPS storage policies", () => {
  it("lets players manage files only in their own folder", async () => {
    const own = `${ALICE}/11111111-1111-4111-8111-111111111111.gpx`;
    await rows(ALICE, `insert into storage.objects (bucket_id, name) values ('gps-files', $1)`, [own]);
    await expect(
      rows(ALICE, `insert into storage.objects (bucket_id, name) values ('gps-files', $1)`, [`${BOB}/11111111-1111-4111-8111-111111111111.gpx`]),
    ).rejects.toThrow(/row-level security/);
    await expect(rows(ALICE, `insert into storage.objects (bucket_id, name) values ('gps-files', $1)`, [`${ALICE}/notes.txt`])).rejects.toThrow(
      /row-level security/,
    );
    expect(await rows(BOB, `select name from storage.objects`)).toEqual([]);
    expect(await rows(BOB, `delete from storage.objects returning name`)).toEqual([]);
    expect(await rows(ALICE, `select name from storage.objects`)).toEqual([{ name: own }]);
    // No update policy: files can't be overwritten in place.
    expect(await rows(ALICE, `update storage.objects set name = name returning name`)).toEqual([]);
  });

  it("creates a private, size-limited bucket", async () => {
    const [bucket] = (await db.query<{ public: boolean; file_size_limit: number }>(`select public, file_size_limit from storage.buckets where id = 'gps-files'`)).rows;
    expect(bucket).toEqual({ public: false, file_size_limit: 26214400 });
  });

  it("can run the migrations again safely", async () => {
    const again = await createTestDatabase();
    await expect(again.exec(`select 1`)).resolves.toBeTruthy();
  });
});
