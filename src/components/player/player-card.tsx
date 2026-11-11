"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  ATTRIBUTES,
  ATTRIBUTE_KEYS,
  POSITION_META,
  type Attributes,
  type Position,
} from "@/lib/domain";
import { cardTierFor, overallFor } from "@/lib/engine/progression";
import type { CardTierId } from "@/lib/engine/rules";
import type { PlayerProfile } from "@/lib/schema";
import { cn } from "@/lib/utils";

const CARD_PATH =
  "M26 0H294L320 26V384Q320 400 305 407L174 465Q160 471 146 465L15 407Q0 400 0 384V26Z";

export const TIER_FOIL: Record<
  CardTierId,
  { stops: [string, string, string]; accent: string; glow: string }
> = {
  academy: {
    stops: ["#6f7a73", "#d3dbd5", "#59625c"],
    accent: "#d3dbd5",
    glow: "rgb(210 220 214 / 16%)",
  },
  rising: {
    stops: ["#7fa37a", "#e6f8d8", "#5f8a64"],
    accent: "#d9f5bf",
    glow: "rgb(200 240 170 / 18%)",
  },
  "first-team": {
    stops: ["#8bd300", "#f0ffb0", "#c8ff2e"],
    accent: "#c8ff2e",
    glow: "rgb(200 255 46 / 26%)",
  },
  elite: {
    stops: ["#c8ff2e", "#ffe680", "#fff8d8"],
    accent: "#ecff7a",
    glow: "rgb(240 240 90 / 30%)",
  },
  icon: {
    stops: ["#ffffff", "#c8ff2e", "#8ff5ff"],
    accent: "#ffffff",
    glow: "rgb(230 255 170 / 36%)",
  },
};

function fittedNameSize(name: string) {
  return name.length > 13 ? Math.max(20, (38 * 13) / name.length) : 38;
}

function Silhouette({
  number,
  accent,
  uid,
}: {
  number: number;
  accent: string;
  uid: string;
}) {
  return (
    <g transform="translate(70 42) scale(1.12)">
      <defs>
        <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.7" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M100 8c-23 0-39 18-39 43 0 16 6 30 15 39 2 2 3 5 3 8v9c0 4-2 7-6 9l-33 12c-23 9-34 25-38 53l-3 46h202l-3-46c-4-28-15-44-38-53l-33-12c-4-2-6-5-6-9v-9c0-3 1-6 3-8 9-9 15-23 15-39 0-25-16-43-39-43z"
        fill="url(#card-bust)"
      />
      <path
        d="M100 8c-23 0-39 18-39 43 0 16 6 30 15 39 2 2 3 5 3 8v9c0 4-2 7-6 9l-33 12"
        fill="none"
        stroke={`url(#rim-${uid})`}
        strokeWidth="1.2"
      />
      <text
        x="100"
        y="196"
        textAnchor="middle"
        fontFamily="var(--font-barlow-condensed)"
        fontWeight="800"
        fontSize="58"
        fill={accent}
        fillOpacity="0.16"
      >
        {number}
      </text>
    </g>
  );
}

export interface PlayerCardProps {
  profile: Pick<
    PlayerProfile,
    "name" | "positions" | "nationality" | "shirtNumber" | "photo"
  >;
  attributes: Attributes;
  level: number;
  demo?: boolean;
  interactive?: boolean;
  /** No intro, count-up or sweep: the finished card, for rendering onto the 3D card. */
  still?: boolean;
  className?: string;
}

export function PlayerCard({
  profile,
  attributes,
  level,
  demo,
  interactive = true,
  still = false,
  className,
}: PlayerCardProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const ovrText = useRef<SVGTextElement>(null);
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);

  const position = (profile.positions[0] ?? "CM") as Position;
  const ovr = overallFor(attributes, position);
  const tier = cardTierFor(ovr);
  const foil = TIER_FOIL[tier.id];

  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.35);
  const spring = { stiffness: 170, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(pointerX, [0, 1], [-8, 8]), spring);
  const rotateX = useSpring(useTransform(pointerY, [0, 1], [6, -6]), spring);
  const sheenX = useSpring(useTransform(pointerX, [0, 1], [0, 320]), spring);
  const sheenY = useSpring(useTransform(pointerY, [0, 1], [0, 472]), spring);
  const glow = useMotionTemplate`drop-shadow(0 22px 34px rgb(0 0 0 / 60%)) drop-shadow(0 0 12px ${foil.glow})`;

  useEffect(() => {
    const node = ovrText.current;
    if (!node) return;
    if (reduceMotion || still) {
      node.textContent = String(ovr);
      return;
    }
    const controls = animate(40, ovr, {
      duration: 1.1,
      delay: 0.25,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        node.textContent = String(Math.round(value));
      },
    });
    return () => controls.stop();
  }, [ovr, reduceMotion, still]);

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!interactive || event.pointerType === "touch" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    // Seen from behind, left and right swap, so the lean still follows the pointer.
    pointerX.set(flipped ? 1 - x : x);
    pointerY.set((event.clientY - rect.top) / rect.height);
  }

  function onPointerLeave() {
    pointerX.set(0.5);
    pointerY.set(0.35);
  }

  const summary = `${profile.name}, ${ovr} overall, ${POSITION_META[position].name}, level ${level}. ${ATTRIBUTE_KEYS.map(
    (key) => `${ATTRIBUTES[key].name} ${Math.round(attributes[key])}`,
  ).join(", ")}.`;

  const rows = [
    ["pac", "dri"],
    ["sho", "def"],
    ["pas", "phy"],
  ] as const;

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={
        interactive ? () => setFlipped((current) => !current) : undefined
      }
      className={cn(
        "relative mx-auto w-full max-w-[340px] [perspective:1100px]",
        className,
      )}
    >
      <motion.div
        initial={still ? false : { opacity: 0, y: 26, rotateY: -24 }}
        animate={{ opacity: 1, y: 0, rotateY: flipped ? 180 : 0 }}
        transition={{
          duration: 0.8,
          ease: [0.16, 1, 0.3, 1],
          rotateY: { type: "spring", stiffness: 110, damping: 15 },
        }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <motion.div
          className="relative"
          style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        >
          <motion.svg
            data-card-face="front"
            role="img"
            aria-label={summary}
            aria-hidden={flipped || undefined}
            viewBox="0 0 320 472"
            className="block w-full overflow-visible"
            style={{
              filter: glow,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
            }}
          >
            <defs>
              <clipPath id={`clip-${uid}`}>
                <path d={CARD_PATH} />
              </clipPath>
              <linearGradient id={`base-${uid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#202223" />
                <stop offset="0.5" stopColor="#141516" />
                <stop offset="1" stopColor="#0a0b0b" />
              </linearGradient>
              <linearGradient id={`foil-${uid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={foil.stops[0]} />
                <stop offset="0.48" stopColor={foil.stops[1]} />
                <stop offset="1" stopColor={foil.stops[2]} />
              </linearGradient>
              <radialGradient id={`halo-${uid}`} cx="0.62" cy="0.3" r="0.6">
                <stop offset="0" stopColor={foil.accent} stopOpacity="0.1" />
                <stop offset="1" stopColor={foil.accent} stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`sheen-${uid}`}>
                <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
                <stop
                  offset="0.55"
                  stopColor={foil.accent}
                  stopOpacity="0.08"
                />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0e0f10" stopOpacity="0" />
                <stop offset="1" stopColor="#0e0f10" stopOpacity="1" />
              </linearGradient>
              <linearGradient id="card-bust" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3b3f3d" />
                <stop offset="1" stopColor="#151717" />
              </linearGradient>
              {/* Seigaiha waves, engraved so faintly they read as texture, not decoration. */}
              <pattern
                id={`lines-${uid}`}
                width="24"
                height="12"
                patternUnits="userSpaceOnUse"
              >
                <g
                  fill="none"
                  stroke={foil.accent}
                  strokeOpacity="0.075"
                  strokeWidth="0.8"
                >
                  <path d="M-12 6a12 12 0 0 1 24 0M-8 6a8 8 0 0 1 16 0M-4 6a4 4 0 0 1 8 0" />
                  <path d="M12 6a12 12 0 0 1 24 0M16 6a8 8 0 0 1 16 0M20 6a4 4 0 0 1 8 0" />
                  <path d="M0 12a12 12 0 0 1 24 0M4 12a8 8 0 0 1 16 0M8 12a4 4 0 0 1 8 0" />
                </g>
              </pattern>
            </defs>

            {/* data-layer marks the card's depth layers: the 3D card draws each at its own depth. */}
            <path data-layer="base" d={CARD_PATH} fill={`url(#base-${uid})`} />

            <g clipPath={`url(#clip-${uid})`}>
              <g data-layer="base">
                <rect width="320" height="472" fill={`url(#lines-${uid})`} />
                <rect width="320" height="300" fill={`url(#halo-${uid})`} />
                <text
                  x="306"
                  y="214"
                  textAnchor="end"
                  fontFamily="var(--font-barlow-condensed)"
                  fontStyle="italic"
                  fontWeight="800"
                  fontSize="210"
                  fill={foil.accent}
                  fillOpacity="0.05"
                >
                  {profile.shirtNumber}
                </text>
              </g>

              <g data-layer="portrait">
                {profile.photo ? (
                  <image
                    href={profile.photo}
                    x="86"
                    y="30"
                    width="232"
                    height="240"
                    preserveAspectRatio="xMidYMin slice"
                  />
                ) : (
                  <Silhouette
                    number={profile.shirtNumber}
                    accent={foil.accent}
                    uid={uid}
                  />
                )}

                <rect
                  y="196"
                  width="320"
                  height="82"
                  fill={`url(#fade-${uid})`}
                />
                <rect y="277" width="320" height="195" fill="#0e0f10" />
              </g>
              {/* The 3D card lights itself, so its art leaves out the pointer sheen. */}
              {still ? null : (
                <motion.circle
                  cx={sheenX}
                  cy={sheenY}
                  r="190"
                  fill={`url(#sheen-${uid})`}
                  style={{ mixBlendMode: "screen" }}
                />
              )}
              {reduceMotion || still ? null : (
                <motion.rect
                  y="-60"
                  width="70"
                  height="600"
                  fill="#fff"
                  fillOpacity="0.1"
                  transform="rotate(16)"
                  initial={{ x: -180 }}
                  animate={{ x: 480 }}
                  transition={{ duration: 1.3, delay: 0.7, ease: "easeInOut" }}
                />
              )}
            </g>

            {/* The printed border; the 3D card has a real metal frame instead. */}
            <path
              data-layer="frame"
              d={CARD_PATH}
              fill="none"
              stroke={`url(#foil-${uid})`}
              strokeWidth="2.4"
            />

            <g data-layer="info" fontFamily="var(--font-barlow-condensed)">
              <path
                d={CARD_PATH}
                fill="none"
                stroke={`url(#foil-${uid})`}
                strokeOpacity="0.32"
                strokeWidth="1"
                transform="translate(160 236) scale(0.955 0.966) translate(-160 -236)"
              />
              <text
                ref={ovrText}
                x="32"
                y="92"
                fontWeight="800"
                fontSize="80"
                fill={`url(#foil-${uid})`}
                letterSpacing="-1"
              >
                {ovr}
              </text>
              <text
                x="34"
                y="122"
                fontWeight="700"
                fontSize="29"
                fill={foil.accent}
                letterSpacing="1"
              >
                {position}
              </text>
              <line
                x1="34"
                x2="78"
                y1="134"
                y2="134"
                stroke={foil.accent}
                strokeOpacity="0.4"
              />
              <text
                x="34"
                y="158"
                fontWeight="600"
                fontSize="21"
                fill="#f3f6ef"
                letterSpacing="1.5"
              >
                {profile.nationality}
              </text>
              <text
                x="34"
                y="182"
                fontWeight="600"
                fontSize="21"
                fill="#98a399"
                letterSpacing="0.5"
              >
                #{profile.shirtNumber}
              </text>

              {demo ? (
                <g>
                  <rect
                    x="252"
                    y="26"
                    width="46"
                    height="20"
                    rx="3"
                    fill={foil.accent}
                  />
                  <text
                    x="275"
                    y="41"
                    textAnchor="middle"
                    fontWeight="800"
                    fontSize="14"
                    letterSpacing="1"
                    fill="#0d1400"
                  >
                    DEMO
                  </text>
                </g>
              ) : null}

              <text
                x="160"
                y="302"
                textAnchor="middle"
                fontWeight="800"
                fontSize={fittedNameSize(profile.name)}
                fill="#f3f6ef"
                letterSpacing="0.5"
              >
                {profile.name.toUpperCase()}
              </text>
              <line
                x1="44"
                x2="276"
                y1="316"
                y2="316"
                stroke={foil.accent}
                strokeOpacity="0.28"
              />
              <line
                x1="160"
                x2="160"
                y1="326"
                y2="420"
                stroke={foil.accent}
                strokeOpacity="0.16"
              />

              {rows.map(([left, right], index) => {
                const y = 350 + index * 33;
                return (
                  <g key={left}>
                    <text
                      x="98"
                      y={y}
                      textAnchor="end"
                      fontWeight="700"
                      fontSize="28"
                      fill="#f3f6ef"
                    >
                      {Math.round(attributes[left])}
                    </text>
                    <text
                      x="105"
                      y={y}
                      fontWeight="500"
                      fontSize="20"
                      fill="#98a399"
                      letterSpacing="1"
                    >
                      {ATTRIBUTES[left].code}
                    </text>
                    <text
                      x="218"
                      y={y}
                      textAnchor="end"
                      fontWeight="700"
                      fontSize="28"
                      fill="#f3f6ef"
                    >
                      {Math.round(attributes[right])}
                    </text>
                    <text
                      x="225"
                      y={y}
                      fontWeight="500"
                      fontSize="20"
                      fill="#98a399"
                      letterSpacing="1"
                    >
                      {ATTRIBUTES[right].code}
                    </text>
                  </g>
                );
              })}

              <text
                x="160"
                y="437"
                textAnchor="middle"
                fontWeight="700"
                fontSize="14"
                letterSpacing="2.5"
                fill={foil.accent}
              >
                {tier.name.toUpperCase()}
              </text>
              <text
                x="160"
                y="450"
                textAnchor="middle"
                fontWeight="600"
                fontSize="12"
                letterSpacing="1.5"
                fill="#98a399"
              >
                LV {level}
              </text>
            </g>
          </motion.svg>
          <CardBack
            uid={uid}
            foil={foil}
            profile={profile}
            attributes={attributes}
            ovr={ovr}
            level={level}
            tierName={tier.name}
            hidden={!flipped}
          />
        </motion.div>
      </motion.div>
      {interactive ? (
        <button
          type="button"
          aria-pressed={flipped}
          aria-label={
            flipped
              ? "Show the front of the player card"
              : "Show the back of the player card"
          }
          onClick={(event) => {
            event.stopPropagation();
            setFlipped((current) => !current);
          }}
          className="absolute right-0 bottom-0 grid size-9 place-items-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition-[color,transform] duration-(--dur-hover) outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <RotateCw className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The reverse of the card: every attribute by name with a bar, in the
 * same foil and type as the front. It shares the front's gradients and
 * pattern by id, so the two faces always match.
 */
function CardBack({
  uid,
  foil,
  profile,
  attributes,
  ovr,
  level,
  tierName,
  hidden,
}: {
  uid: string;
  foil: (typeof TIER_FOIL)[CardTierId];
  profile: PlayerCardProps["profile"];
  attributes: Attributes;
  ovr: number;
  level: number;
  tierName: string;
  hidden: boolean;
}) {
  const label = `Back of the card: ${ATTRIBUTE_KEYS.map(
    (key) => `${ATTRIBUTES[key].name} ${Math.round(attributes[key])}`,
  ).join(", ")}. ${ovr} overall, level ${level}.`;
  return (
    <svg
      data-card-face="back"
      role="img"
      aria-label={label}
      aria-hidden={hidden || undefined}
      viewBox="0 0 320 472"
      className="absolute inset-0 block size-full overflow-visible"
      style={{
        transform: "rotateY(180deg)",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        filter: `drop-shadow(0 22px 34px rgb(0 0 0 / 60%)) drop-shadow(0 0 12px ${foil.glow})`,
      }}
    >
      <path d={CARD_PATH} fill={`url(#base-${uid})`} />
      <g clipPath={`url(#clip-${uid})`}>
        <rect width="320" height="472" fill={`url(#lines-${uid})`} />
        <rect
          width="320"
          height="300"
          fill={`url(#halo-${uid})`}
          opacity="0.6"
        />
      </g>
      <path
        data-layer="frame"
        d={CARD_PATH}
        fill="none"
        stroke={`url(#foil-${uid})`}
        strokeWidth="2.4"
      />
      <g fontFamily="var(--font-barlow-condensed)">
        <text
          x="160"
          y="58"
          textAnchor="middle"
          fontWeight="700"
          fontSize="13"
          letterSpacing="2.5"
          fill={foil.accent}
        >
          PLAYER PROFILE
        </text>
        <text
          x="160"
          y="92"
          textAnchor="middle"
          fontWeight="800"
          fontSize={fittedNameSize(profile.name) * 0.78}
          fill="#f3f6ef"
          letterSpacing="0.5"
        >
          {profile.name.toUpperCase()}
        </text>
        <text
          x="160"
          y="114"
          textAnchor="middle"
          fontWeight="600"
          fontSize="15"
          fill="#98a399"
          letterSpacing="1"
        >
          {profile.positions.join(" · ")} · #{profile.shirtNumber}
        </text>
        <line
          x1="44"
          x2="276"
          y1="128"
          y2="128"
          stroke={foil.accent}
          strokeOpacity="0.28"
        />
        {ATTRIBUTE_KEYS.map((key, index) => {
          const y = 158 + index * 37;
          const value = Math.round(attributes[key]);
          return (
            <g key={key}>
              <text
                x="48"
                y={y}
                fontWeight="600"
                fontSize="15"
                letterSpacing="1"
                fill="#f3f6ef"
              >
                {ATTRIBUTES[key].name.toUpperCase()}
              </text>
              <text
                x="272"
                y={y}
                textAnchor="end"
                fontWeight="700"
                fontSize="22"
                fill="#f3f6ef"
              >
                {value}
              </text>
              <rect
                x="48"
                y={y + 8}
                width="224"
                height="3"
                rx="1.5"
                fill="#ffffff"
                fillOpacity="0.1"
              />
              <rect
                x="48"
                y={y + 8}
                width={(224 * value) / 99}
                height="3"
                rx="1.5"
                fill={foil.accent}
              />
            </g>
          );
        })}
        <text
          x="160"
          y="408"
          textAnchor="middle"
          fontWeight="800"
          fontSize="24"
          fill={foil.accent}
        >
          {ovr} OVR
        </text>
        <text
          x="160"
          y="437"
          textAnchor="middle"
          fontWeight="700"
          fontSize="14"
          letterSpacing="2.5"
          fill={foil.accent}
        >
          {tierName.toUpperCase()}
        </text>
        <text
          x="160"
          y="450"
          textAnchor="middle"
          fontWeight="600"
          fontSize="12"
          letterSpacing="1.5"
          fill="#98a399"
        >
          LV {level}
        </text>
      </g>
    </svg>
  );
}
