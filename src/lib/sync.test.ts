import { describe, expect, it } from "vitest";
import type { Match, PlayerProfile } from "@/lib/schema";
import {
  applyOutbox,
  diffStates,
  enqueue,
  guestHasRealData,
  mergeCareers,
  rowsToState,
  settle,
  type CareerState,
} from "@/lib/sync";

const blank: PlayerProfile = { name: "New Signing", positions: ["CM"], nationality: "ENG", shirtNumber: 10, photo: null };
const profile: PlayerProfile = { ...blank, name: "Sam", shirtNumber: 7 };

function match(id: string, overrides: Partial<Match> = {}): Match {
  return {
    id,
    createdAt: "2026-11-01T10:00:00.000Z",
    date: "2026-11-01",
    format: "7v7",
    position: "ST",
    minutes: 60,
    goals: 1,
    assists: 0,
    result: "win",
    rating: 7,
    skillRatings: {},
    zones: [],
    ...overrides,
  };
}

const state = (matches: Match[], p = profile): CareerState => ({ profile: p, matches });

describe("diffStates", () => {
  it("finds additions, edits and deletions", () => {
    const a = match("a");
    const b = match("b");
    const before = state([a, b]);
    const after = state([{ ...a, goals: 3 }, match("c")]);
    expect(diffStates(before, after).map((op) => op.kind + ":" + ("id" in op ? op.id : "match" in op ? op.match.id : "profile"))).toEqual([
      "upsert-match:a",
      "upsert-match:c",
      "delete-match:b",
    ]);
  });

  it("ignores rebuilt but identical records", () => {
    const a = match("a");
    expect(diffStates(state([a]), state([{ ...a }], { ...profile }))).toEqual([]);
  });

  it("notices profile changes", () => {
    expect(diffStates(state([]), state([], { ...profile, name: "Kai" }))).toEqual([
      { kind: "upsert-profile", profile: { ...profile, name: "Kai" } },
    ]);
  });
});

describe("outbox", () => {
  it("keeps only the latest operation per record", () => {
    const outbox = enqueue(enqueue({}, [{ kind: "upsert-match", match: match("a") }]), [{ kind: "delete-match", id: "a" }]);
    expect(Object.values(outbox)).toEqual([{ kind: "delete-match", id: "a" }]);
  });

  it("settles sent operations but keeps ones replaced mid-flight", () => {
    const first = enqueue({}, [{ kind: "upsert-match", match: match("a") }, { kind: "upsert-match", match: match("b") }]);
    const edited = enqueue(first, [{ kind: "upsert-match", match: match("a", { goals: 4 }) }]);
    const left = settle(edited, first);
    expect(Object.keys(left)).toEqual(["match:a"]);
    expect(left["match:a"]).toEqual({ kind: "upsert-match", match: match("a", { goals: 4 }) });
  });

  it("lays unsynced edits over fresh server data", () => {
    const server = state([match("a"), match("b")], blank);
    const outbox = enqueue({}, [
      { kind: "upsert-match", match: match("a", { goals: 5 }) },
      { kind: "delete-match", id: "b" },
      { kind: "upsert-match", match: match("c") },
      { kind: "upsert-profile", profile },
    ]);
    const merged = applyOutbox(server, outbox);
    expect(merged.profile).toEqual(profile);
    expect(merged.matches.map((m) => [m.id, m.goals])).toEqual([["a", 5], ["c", 1]]);
  });
});

describe("server rows", () => {
  it("skips records the app can't read", () => {
    const result = rowsToState([{ data: profile }], [{ data: match("a") }, { data: { id: "broken" } }], blank);
    expect(result.state.matches.map((m) => m.id)).toEqual(["a"]);
    expect(result.rejected).toBe(1);
    expect(result.hasProfile).toBe(true);
  });

  it("falls back to a blank profile for new accounts", () => {
    const result = rowsToState([], [], blank);
    expect(result.state).toEqual({ profile: blank, matches: [] });
    expect(result.hasProfile).toBe(false);
  });
});

describe("guest import", () => {
  it("ignores demo data when deciding whether to offer an import", () => {
    expect(guestHasRealData(state([match("demo-01", { isSample: true })], { ...profile, isSample: true }), blank)).toBe(false);
    expect(guestHasRealData(state([], blank), blank)).toBe(false);
    expect(guestHasRealData(state([match("m1")], blank), blank)).toBe(true);
    expect(guestHasRealData(state([], profile), blank)).toBe(true);
  });

  it("adds new guest matches and keeps the account's own", () => {
    const account = state([match("shared", { goals: 9 })], blank);
    const guest = state([match("shared"), match("guest-only"), match("demo-01", { isSample: true })], profile);
    const merged = mergeCareers(account, guest, false);
    expect(merged.added).toBe(1);
    expect(merged.state.matches.map((m) => [m.id, m.goals])).toEqual([["shared", 9], ["guest-only", 1]]);
    expect(merged.state.profile).toEqual(profile);
  });

  it("never replaces a profile the account already has", () => {
    const merged = mergeCareers(state([], { ...profile, name: "Account" }), state([], profile), true);
    expect(merged.state.profile.name).toBe("Account");
    expect(merged.usedGuestProfile).toBe(false);
  });
});
