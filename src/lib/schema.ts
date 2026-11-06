import { z } from "zod";
import {
  FORMATS,
  POSITIONS,
  RESULTS,
  ZONE_COLS,
  ZONE_ROWS,
} from "@/lib/domain";

export const LIMITS = {
  name: 32,
  notes: 500,
  opponent: 40,
  minutes: 150,
  perMatchStat: 30,
  score: 60,
  shirtMax: 99,
  preferredPositions: 3,
} as const;

const halfStepRating = z
  .number()
  .min(1, "Ratings run from 1 to 10")
  .max(10, "Ratings run from 1 to 10")
  .refine((value) => Number.isInteger(value * 2), "Ratings use half-point steps");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a valid date");

const zoneCell = z.object({
  col: z.number().int().min(0).max(ZONE_COLS - 1),
  row: z.number().int().min(0).max(ZONE_ROWS - 1),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const skillRatings = z.object({
  pac: halfStepRating.optional(),
  sho: halfStepRating.optional(),
  pas: halfStepRating.optional(),
  dri: halfStepRating.optional(),
  def: halfStepRating.optional(),
  phy: halfStepRating.optional(),
});

/** Fields a player enters. Ids and bookkeeping live on `matchSchema`. */
export const matchFieldsSchema = z
  .object({
    date: isoDate,
    format: z.enum(FORMATS),
    position: z.enum(POSITIONS),
    minutes: z
      .number()
      .int("Whole minutes only")
      .min(1, "A match needs at least 1 minute")
      .max(LIMITS.minutes, `No more than ${LIMITS.minutes} minutes`),
    goals: z.number().int().min(0).max(LIMITS.perMatchStat),
    assists: z.number().int().min(0).max(LIMITS.perMatchStat),
    result: z.enum(RESULTS),
    opponent: z.string().trim().max(LIMITS.opponent).optional(),
    teamScore: z.number().int().min(0).max(LIMITS.score).optional(),
    opponentScore: z.number().int().min(0).max(LIMITS.score).optional(),
    rating: halfStepRating,
    skillRatings,
    zones: z.array(zoneCell).max(ZONE_COLS * ZONE_ROWS),
    notes: z.string().trim().max(LIMITS.notes).optional(),
  })
  .superRefine((match, ctx) => {
    const hasTeam = match.teamScore !== undefined;
    const hasOpponent = match.opponentScore !== undefined;
    if (hasTeam !== hasOpponent) {
      ctx.addIssue({
        code: "custom",
        path: [hasTeam ? "opponentScore" : "teamScore"],
        message: "Enter both scores, or leave both blank",
      });
      return;
    }
    if (match.teamScore === undefined || match.opponentScore === undefined) return;

    const implied =
      match.teamScore > match.opponentScore
        ? "win"
        : match.teamScore < match.opponentScore
          ? "loss"
          : "draw";
    if (implied !== match.result) {
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: `The score says ${implied}, but the result says ${match.result}`,
      });
    }
    if (match.goals + match.assists > match.teamScore) {
      ctx.addIssue({
        code: "custom",
        path: ["goals"],
        message: `Your goals and assists can't exceed your team's ${match.teamScore}`,
      });
    }
  });

export const matchSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.string().min(1),
    isSample: z.boolean().optional(),
  })
  .and(matchFieldsSchema);

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Your player needs a name")
    .max(LIMITS.name, `Keep it under ${LIMITS.name} characters`),
  positions: z
    .array(z.enum(POSITIONS))
    .min(1, "Pick at least one position")
    .max(LIMITS.preferredPositions, `Pick up to ${LIMITS.preferredPositions} positions`),
  nationality: z.string().min(2, "Pick a nationality").max(3),
  shirtNumber: z
    .number({ error: "Enter a shirt number" })
    .int("Whole numbers only")
    .min(1, "Numbers start at 1")
    .max(LIMITS.shirtMax, `Numbers stop at ${LIMITS.shirtMax}`),
  photo: z.string().nullable(),
  isSample: z.boolean().optional(),
});

/** Shape written by Export and accepted by Import. */
export const careerFileSchema = z.object({
  app: z.literal("irl-career-mode"),
  schemaVersion: z.literal(1),
  exportedAt: z.string().optional(),
  profile: profileSchema.optional(),
  matches: z.array(matchSchema),
});

export type ZoneCell = z.infer<typeof zoneCell>;
export type SkillRatings = z.infer<typeof skillRatings>;
export type MatchFields = z.infer<typeof matchFieldsSchema>;
export type Match = z.infer<typeof matchSchema>;
export type PlayerProfile = z.infer<typeof profileSchema>;
export type CareerFile = z.infer<typeof careerFileSchema>;
