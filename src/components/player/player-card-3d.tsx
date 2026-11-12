"use client";

/**
 * The player card as a physical collectible: a graphite core inside a
 * bevelled metal frame, with the card's own art set into the recess in three
 * layers (background, portrait, printed type) under a sheet of glass. The
 * layers sit at slightly different depths, so they shift against each other
 * as the card tilts, and the glass and metal pick up the studio's softboxes,
 * so highlights slide across the surface as the angle changes.
 *
 * All the light is tied to the card's own motion: one state drives the tilt,
 * the lift, the halo behind it, the brightness of the art and the pinstripe,
 * so nothing glows on its own. It never moves unless touched, flipped,
 * inspected or celebrating, so it reads as well standing still.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";
import { Stage } from "@/components/three/stage";
import type { CardFaces } from "@/components/player/card-texture";
import { TIER_FINISH } from "@/components/player/player-card";
import type { CardTierId } from "@/lib/engine/rules";

/** The card's design is 320 × 472; one scene unit is 100 design pixels. */
const S = 1 / 100;
const WIDTH = 3.2;
const HEIGHT = 4.72;

/** How much of the canvas height the card fills; the stage sizes its canvas to match. */
export const CARD_FILL = 1 / 1.36;
const FOV = 30;
const CAMERA_Z = HEIGHT / CARD_FILL / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));

const CORE = 0.06; // the graphite core's thickness
/** A stepped bezel: a polished outer frame, then a lower gunmetal step the glass rests on. */
const FRAME = { border: 0.072, rise: 0.13 };
const STEP = { border: 0.104, rise: 0.08 };
const BORDER = STEP.border; // where the art's window begins
const BEVEL = 0.014;
/** Depths of the art layers and the glass above the core. */
const DEPTH = { base: 0.004, foil: 0.008, portrait: 0.04, info: 0.074, glass: 0.11 } as const;

/** The card silhouette from the SVG design, centred, scaled in x and y. */
function cardShape(sx = 1, sy = sx) {
  const p = (x: number, y: number): [number, number] => [(x - 160) * S * sx, -(y - 236) * S * sy];
  const shape = new THREE.Shape();
  shape.moveTo(...p(26, 0));
  shape.lineTo(...p(294, 0));
  shape.lineTo(...p(320, 26));
  shape.lineTo(...p(320, 384));
  shape.quadraticCurveTo(...p(320, 400), ...p(305, 407));
  shape.lineTo(...p(174, 465));
  shape.quadraticCurveTo(...p(160, 471), ...p(146, 465));
  shape.lineTo(...p(15, 407));
  shape.quadraticCurveTo(...p(0, 400), ...p(0, 384));
  shape.lineTo(...p(0, 26));
  shape.closePath();
  return shape;
}

/** Scales that inset the outline by `border` on every side. */
const inset = (border: number) => ({ x: (WIDTH - 2 * border) / WIDTH, y: (HEIGHT - 2 * border) / HEIGHT });
const INNER = inset(BORDER);

/** A bevelled ring standing `rise` above the core, from `outer` to `inner` in from the edge. */
function ringGeometry(outer: number, inner: number, rise: number) {
  const bevelThickness = Math.min(0.02, rise / 4);
  // The bevel grows the ring outwards and into its opening, so start it that much smaller.
  const from = inset(outer + BEVEL);
  const to = inset(inner - BEVEL);
  const ring = cardShape(from.x, from.y);
  ring.holes.push(new THREE.Path(cardShape(to.x, to.y).getPoints(64)));
  const geometry = new THREE.ExtrudeGeometry(ring, {
    depth: rise - 2 * bevelThickness,
    bevelEnabled: true,
    bevelThickness,
    bevelSize: BEVEL,
    bevelSegments: 4,
    curveSegments: 32,
  });
  geometry.translate(0, 0, bevelThickness);
  return geometry;
}

/** A flat face with UVs stretched over the design's bounds, so the art lines up. */
function faceGeometry(shape: THREE.Shape) {
  const geometry = new THREE.ShapeGeometry(shape, 32);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uv[index * 2] = position.getX(index) / WIDTH + 0.5;
    uv[index * 2 + 1] = position.getY(index) / HEIGHT + 0.5;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Chrome rails standing off the card's lower edges, stepping outwards like
 * the trim on a premium collectible. Each follows the outline from `from`
 * (in design pixels down the card) round the point and back up the other
 * side, `offset` out from the edge, and runs through the card's thickness.
 */
function railGeometry(offset: number, width: number, from: number) {
  const base = cardShape(1).getSpacedPoints(480);
  const scale = (border: number) => inset(-border);
  const outer = scale(offset + width);
  const inner = scale(offset);
  const limit = -(from - 236) * S;
  // The outline starts at the top left; the lower part is one unbroken run in the middle of it.
  const run = base.filter((point) => point.y < limit);
  const ribbon = new THREE.Shape(run.map((point) => new THREE.Vector2(point.x * outer.x, point.y * outer.y)));
  for (const point of [...run].reverse()) ribbon.lineTo(point.x * inner.x, point.y * inner.y);
  ribbon.closePath();
  const depth = CORE + 0.05;
  const geometry = new THREE.ExtrudeGeometry(ribbon, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/**
 * The foil printed under the portrait: the card's own outline echoed inwards
 * and rays fanning out from behind the player. It's drawn as a mask for a
 * mirror-finish, iridescent layer, so it stays dark until the light catches
 * it as the card turns, and fades out well before the name and stats.
 */
function useFoilTexture() {
  const texture = useMemo(() => {
    const k = 2; // canvas pixels per design pixel
    const canvas = document.createElement("canvas");
    canvas.width = 320 * k;
    canvas.height = 472 * k;
    const context = canvas.getContext("2d")!;
    context.scale(k, k);
    context.fillStyle = "#000";
    context.fillRect(0, 0, 320, 472);
    const outline = new Path2D("M26 0H294L320 26V384Q320 400 305 407L174 465Q160 471 146 465L15 407Q0 400 0 384V26Z");
    context.save();
    context.clip(outline);
    context.strokeStyle = "#fff";
    // Echoes of the silhouette, closer together towards the middle.
    for (let step = 0; step < 9; step += 1) {
      const border = 16 + step * (13 - step * 0.6);
      const sx = (320 - 2 * border) / 320;
      const sy = (472 - 2 * border) / 472;
      context.save();
      context.translate(160, 236);
      context.scale(sx, sy);
      context.translate(-160, -236);
      context.lineWidth = 0.9 / Math.min(sx, sy);
      context.globalAlpha = 0.9 - step * 0.06;
      context.stroke(outline);
      context.restore();
    }
    // Rays from behind the portrait.
    context.globalAlpha = 0.5;
    context.lineWidth = 0.7;
    for (let ray = 0; ray < 48; ray += 1) {
      const angle = (ray / 48) * Math.PI * 2;
      context.beginPath();
      context.moveTo(160 + Math.cos(angle) * 40, 150 + Math.sin(angle) * 40);
      context.lineTo(160 + Math.cos(angle) * 420, 150 + Math.sin(angle) * 420);
      context.stroke();
    }
    context.restore();
    // Strongest round the portrait, gone before the name and stats.
    context.globalCompositeOperation = "destination-in";
    const fade = context.createLinearGradient(0, 0, 0, 472);
    fade.addColorStop(0, "rgb(255 255 255 / 70%)");
    fade.addColorStop(0.45, "rgb(255 255 255 / 100%)");
    fade.addColorStop(0.68, "rgb(255 255 255 / 15%)");
    fade.addColorStop(0.78, "rgb(255 255 255 / 0%)");
    context.fillStyle = fade;
    context.fillRect(0, 0, 320, 472);
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#000";
    context.fillRect(0, 0, 320, 472);
    const map = new THREE.CanvasTexture(canvas);
    map.anisotropy = 8;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** The frame metal for each tier: silver through to champagne and platinum. */
const METAL: Record<CardTierId, { color: string; iridescence: number }> = {
  academy: { color: TIER_FINISH.academy.metal, iridescence: 0 },
  rising: { color: TIER_FINISH.rising.metal, iridescence: 0 },
  "first-team": { color: TIER_FINISH["first-team"].metal, iridescence: 0.12 },
  elite: { color: TIER_FINISH.elite.metal, iridescence: 0.1 },
  icon: { color: TIER_FINISH.icon.metal, iridescence: 0.45 },
};

/** The foil's metal and iridescence per tier (how strongly it shows, and the rails, come from TIER_FINISH). */
const TIER_FOIL_METAL: Record<CardTierId, { color: string; iridescence: number }> = {
  academy: { color: "#d9e2dc", iridescence: 0 },
  rising: { color: "#d9e2dc", iridescence: 0.25 },
  "first-team": { color: "#dde6d5", iridescence: 0.5 },
  elite: { color: "#efd28c", iridescence: 0.35 },
  icon: { color: "#f4f8f8", iridescence: 1 },
};

function useCanvasTexture(canvas: HTMLCanvasElement, anisotropy: number) {
  const texture = useMemo(() => {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = anisotropy;
    return map;
  }, [canvas, anisotropy]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** The halo's canvas: the 320 × 472 outline with room for its blur all round. */
const HALO_CANVAS = { width: 448, height: 600 };

/** Soft light textures: the room's ambient wash, the card-shaped halo and the floor shadow. */
function useGlowTextures(accent: string) {
  const textures = useMemo(() => {
    const radial = (stops: [number, string][]) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d")!;
      const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
      for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };

    // The halo takes the card's own outline, blurred, so it reads as light spilling from its edges.
    const canvas = document.createElement("canvas");
    canvas.width = HALO_CANVAS.width;
    canvas.height = HALO_CANVAS.height;
    const context = canvas.getContext("2d")!;
    const path = new Path2D("M26 0H294L320 26V384Q320 400 305 407L174 465Q160 471 146 465L15 407Q0 400 0 384V26Z");
    // Drawn off the canvas, with only its blurred shadow landing in view (shadowBlur works everywhere).
    context.translate((HALO_CANVAS.width - 320) / 2 - 2000, (HALO_CANVAS.height - 472) / 2);
    context.shadowColor = accent;
    context.shadowBlur = 34;
    context.shadowOffsetX = 2000;
    context.fill(path);
    const halo = new THREE.CanvasTexture(canvas);
    halo.colorSpace = THREE.SRGBColorSpace;

    return {
      ambient: radial([
        [0, "rgb(214 236 226 / 100%)"],
        [0.35, "rgb(120 200 170 / 45%)"],
        [1, "rgb(0 0 0 / 0%)"],
      ]),
      halo,
      shadow: radial([
        [0, "rgb(0 0 0 / 62%)"],
        [1, "rgb(0 0 0 / 0%)"],
      ]),
    };
  }, [accent]);
  useEffect(() => () => Object.values(textures).forEach((texture) => texture.dispose()), [textures]);
  return textures;
}

export type CardPointer = { x: number; y: number; inside: boolean };

function CardObject({
  faces,
  tier,
  accent,
  flipped,
  celebrate,
  focus,
  raised,
  inspect,
  lite,
  surface,
  onToggle,
  onSettle,
  onFirstFrame,
}: {
  faces: CardFaces;
  tier: CardTierId;
  accent: string;
  flipped: boolean;
  celebrate: boolean;
  focus: boolean;
  raised: boolean;
  inspect: boolean;
  lite: boolean;
  surface: HTMLElement | null;
  onToggle: () => void;
  onSettle: (back: boolean) => void;
  onFirstFrame?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const viewport = useThree((state) => state.viewport);
  const card = useRef<THREE.Group>(null);
  const aura = useRef<THREE.Group>(null);
  const shadowMesh = useRef<THREE.Mesh>(null);
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  const maps = {
    base: useCanvasTexture(faces.base, anisotropy),
    portrait: useCanvasTexture(faces.portrait, anisotropy),
    info: useCanvasTexture(faces.info, anisotropy),
    back: useCanvasTexture(faces.back, anisotropy),
  };
  const glow = useGlowTextures(accent);
  const foil = useFoilTexture();

  const geometry = useMemo(() => {
    const core = new THREE.ExtrudeGeometry(cardShape(1), {
      depth: CORE,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 32,
    });
    core.translate(0, 0, -CORE / 2);

    const frame = ringGeometry(0, FRAME.border, FRAME.rise);
    const step = ringGeometry(FRAME.border - 0.01, STEP.border, STEP.rise);

    const face = faceGeometry(cardShape(1));
    const opening = inset(FRAME.border);
    const glass = faceGeometry(cardShape(opening.x, opening.y));
    const pinstripe = new THREE.BufferGeometry().setFromPoints(cardShape(INNER.x * 0.985, INNER.y * 0.99).getPoints(64));
    const rails = [railGeometry(0.05, 0.026, 150), railGeometry(0.1, 0.02, 270)];
    return { core, frame, step, face, glass, pinstripe, railNear: rails[0], railFar: rails[1] };
  }, []);

  const materials = useMemo(() => {
    const metal = METAL[tier];
    const detail = { ...TIER_FINISH[tier], foilColor: TIER_FOIL_METAL[tier].color, iridescence: TIER_FOIL_METAL[tier].iridescence };
    const art = (map: THREE.Texture, transparent: boolean) =>
      // The art shows exactly as designed (unlit, not tone mapped); the glass above carries the reflections.
      new THREE.MeshBasicMaterial({ map, transparent, depthWrite: !transparent, toneMapped: false });
    return {
      base: art(maps.base, false),
      portrait: art(maps.portrait, true),
      info: art(maps.info, true),
      back: art(maps.back, false),
      core: new THREE.MeshPhysicalMaterial({
        color: "#16181a",
        metalness: 0.6,
        roughness: 0.38,
        clearcoat: 0.4,
        clearcoatRoughness: 0.3,
      }),
      frame: new THREE.MeshPhysicalMaterial({
        color: metal.color,
        metalness: 1,
        roughness: 0.13,
        envMapIntensity: 1.6,
        clearcoat: 0.5,
        clearcoatRoughness: 0.12,
        iridescence: lite ? 0 : metal.iridescence,
        iridescenceIOR: 1.4,
        iridescenceThicknessMinimum: 200,
        iridescenceThicknessMaximum: 480,
      }),
      step: new THREE.MeshPhysicalMaterial({ color: "#3a3e41", metalness: 1, roughness: 0.34, envMapIntensity: 0.9 }),
      rail: new THREE.MeshPhysicalMaterial({
        color: metal.color,
        metalness: 1,
        roughness: 0.1,
        envMapIntensity: 1.8,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
      }),
      // Mirror foil seen only through its pattern, added over the print: dark until it catches the light.
      foil: new THREE.MeshPhysicalMaterial({
        color: detail.foilColor,
        metalness: 1,
        roughness: 0.24,
        envMapIntensity: lite ? 1 : 1.5,
        alphaMap: foil,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.55,
        iridescence: lite ? 0 : detail.iridescence,
        iridescenceIOR: 1.8,
        iridescenceThicknessMinimum: 120,
        iridescenceThicknessMaximum: 820,
      }),
      // Only the reflections are drawn (black, added on top), as on real glass over a print.
      glass: new THREE.MeshPhysicalMaterial({
        color: "#000000",
        metalness: 0,
        roughness: 0.07,
        envMapIntensity: 1.7,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        iridescence: lite ? 0 : 0.5,
        iridescenceIOR: 1.35,
        iridescenceThicknessMinimum: 200,
        iridescenceThicknessMaximum: 420,
      }),
      pinstripe: new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.4, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({
        map: glow.halo,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      ambient: new THREE.MeshBasicMaterial({
        map: glow.ambient,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      shadow: new THREE.MeshBasicMaterial({ map: glow.shadow, transparent: true, depthWrite: false }),
    };
  }, [maps.base, maps.portrait, maps.info, maps.back, tier, accent, glow, foil, lite]);

  useEffect(
    () => () => {
      for (const item of Object.values(geometry)) item.dispose();
      for (const item of Object.values(materials)) item.dispose();
    },
    [geometry, materials],
  );

  // Materials the frame loop adjusts, kept in a ref (hook values stay untouched).
  const live = useRef<typeof materials | null>(null);
  useEffect(() => {
    live.current = materials;
    invalidate();
  }, [materials, invalidate]);

  const reduced = prefersReducedMotion();
  // Keyboard focus lifts the card into the light as hovering does, without the lean.
  const raisedRef = useRef(raised);
  useEffect(() => {
    raisedRef.current = raised;
    invalidate();
  }, [raised, invalidate]);
  const pointer = useRef<CardPointer>({ x: 0, y: 0, inside: false });
  const drag = useRef<{ id: number; x: number; y: number; turn: number; moved: boolean } | null>(null);
  const motion = useRef({ tiltX: 0, tiltY: 0, dragTilt: 0, lift: 0, turn: flipped ? Math.PI : 0, glow: 0, focus: 0 });

  // Callbacks read through refs, so listeners never need re-binding.
  const handlers = useRef({ onToggle, onSettle });
  useEffect(() => {
    handlers.current = { onToggle, onSettle };
  }, [onToggle, onSettle]);

  useEffect(() => {
    if (!surface) return;
    const local = (event: PointerEvent) => {
      const box = surface.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) / box.width) * 2 - 1,
        y: -(((event.clientY - box.top) / box.height) * 2 - 1),
      };
    };
    const move = (event: PointerEvent) => {
      const grab = drag.current;
      if (grab && grab.id === event.pointerId) {
        const dx = event.clientX - grab.x;
        const dy = event.clientY - grab.y;
        if (Math.hypot(dx, dy) > 4) grab.moved = true;
        motion.current.turn = grab.turn + dx * 0.009;
        motion.current.dragTilt = THREE.MathUtils.clamp(dy * 0.004, -0.35, 0.35);
        invalidate();
        return;
      }
      if (event.pointerType === "touch") return;
      pointer.current = { ...local(event), inside: true };
      invalidate();
    };
    const leave = () => {
      pointer.current.inside = false;
      invalidate();
    };
    const down = (event: PointerEvent) => {
      if (!inspect || event.button > 0) return;
      surface.setPointerCapture(event.pointerId);
      gsap.killTweensOf(motion.current, "turn,dragTilt");
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, turn: motion.current.turn, moved: false };
    };
    const up = (event: PointerEvent) => {
      const grab = drag.current;
      if (!grab || grab.id !== event.pointerId) return;
      drag.current = null;
      const state = motion.current;
      gsap.to(state, { dragTilt: 0, duration: 0.6, ease: EASE.settle, onUpdate: invalidate });
      if (!grab.moved) {
        handlers.current.onToggle();
        return;
      }
      // Settle on whichever face is nearer, and report it so the flip state agrees.
      const half = Math.round(state.turn / Math.PI);
      const back = Math.abs(half % 2) === 1;
      gsap.to(state, { turn: half * Math.PI, duration: reduced ? 0 : 0.7, ease: EASE.settle, onUpdate: invalidate });
      handlers.current.onSettle(back);
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", up);
    return () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", up);
    };
  }, [surface, inspect, reduced, invalidate]);

  // Turning over: to the nearest angle that shows the asked-for face.
  useEffect(() => {
    const state = motion.current;
    const face = flipped ? Math.PI : 0;
    const turn = face + Math.round((state.turn - face) / (Math.PI * 2)) * Math.PI * 2;
    if (Math.abs(turn - state.turn) < 0.001) return;
    if (reduced) {
      state.turn = turn;
      invalidate();
      return;
    }
    const tween = gsap.to(state, { turn, duration: 0.9, ease: EASE.inOut, onUpdate: invalidate });
    return () => {
      tween.kill();
    };
  }, [flipped, reduced, invalidate]);

  // Inspecting brings the card into the light.
  useEffect(() => {
    const tween = gsap.to(motion.current, {
      focus: focus ? 1 : 0,
      duration: reduced ? 0 : 0.8,
      ease: EASE.inOut,
      onUpdate: invalidate,
    });
    return () => {
      tween.kill();
    };
  }, [focus, reduced, invalidate]);

  useEffect(() => {
    if (!celebrate || reduced) return;
    const state = motion.current;
    const timeline = gsap.timeline({ onUpdate: invalidate, delay: 0.5 });
    timeline
      .fromTo(state, { turn: state.turn - Math.PI * 2 }, { turn: state.turn, duration: 1.9, ease: EASE.settle })
      .to(state, { glow: 1, duration: 0.35, ease: "power2.out" }, 0.1)
      .to(state, { glow: 0, duration: 1.2, ease: "power2.inOut" }, 0.6);
    return () => {
      timeline.kill();
    };
  }, [celebrate, reduced, invalidate]);

  // Reported once, after the first frame is on screen (read through a ref, so it's always the latest callback).
  const firstFrame = useRef({ fired: false, callback: onFirstFrame });
  useEffect(() => {
    firstFrame.current.callback = onFirstFrame;
  }, [onFirstFrame]);

  useFrame((_, delta) => {
    const node = card.current;
    const halo = aura.current;
    const m = live.current;
    if (!node || !halo || !m) return;
    if (!firstFrame.current.fired) {
      firstFrame.current.fired = true;
      requestAnimationFrame(() => firstFrame.current.callback?.());
    }
    const state = motion.current;
    const hover = pointer.current.inside && !reduced && !drag.current;
    const ease = 1 - Math.exp(-delta * 7);
    const targetX = hover ? -pointer.current.y * 0.16 : 0;
    const targetY = hover ? pointer.current.x * 0.24 : 0;
    const targetLift = hover || (raisedRef.current && !drag.current) ? 0.18 : 0;
    state.tiltX += (targetX - state.tiltX) * ease;
    state.tiltY += (targetY - state.tiltY) * ease;
    state.lift += (targetLift - state.lift) * ease;
    const { tiltX, tiltY, dragTilt, lift, turn, focus: lit } = state;
    const energy = lift / 0.18; // 0 at rest, 1 when held up to the light

    node.rotation.set(tiltX + dragTilt, turn + tiltY, 0);
    node.position.set(0, lift * 0.3, lift);
    // The halo stays behind the card whichever face is showing, leaning with it.
    // It turns with whichever face is towards the camera, so seen edge-on it narrows to nothing.
    const facing = turn - Math.round(turn / Math.PI) * Math.PI;
    halo.rotation.set((tiltX + dragTilt) * 0.6, facing + tiltY * 0.6, 0);
    halo.position.set(-tiltY * 0.5, lift * 0.3 + tiltX * 0.3, lift - 0.55);

    m.halo.opacity = (0.2 + energy * 0.12 + lit * 0.1 + state.glow * 0.5) * Math.abs(Math.cos(facing));
    m.ambient.opacity = 0.05 + energy * 0.03 + lit * 0.05 + state.glow * 0.12;
    const brightness = 0.9 + energy * 0.08 + lit * 0.06 + state.glow * 0.1;
    m.base.color.setScalar(brightness);
    m.portrait.color.setScalar(brightness);
    m.info.color.setScalar(Math.min(1.08, brightness + 0.04));
    m.back.color.setScalar(brightness);
    m.foil.opacity = TIER_FINISH[tier].foil * (0.28 + energy * 0.32 + lit * 0.18 + state.glow * 0.4);
    m.pinstripe.opacity = 0.32 + energy * 0.35 + lit * 0.2 + state.glow * 0.5;
    const shadow = shadowMesh.current;
    if (shadow) {
      shadow.scale.set(3.6 + energy * 0.7, 1 + energy * 0.25, 1);
      (shadow.material as THREE.MeshBasicMaterial).opacity = 0.75 - energy * 0.3;
    }

    const settling =
      Math.abs(targetX - tiltX) > 0.0005 || Math.abs(targetY - tiltY) > 0.0005 || Math.abs(targetLift - lift) > 0.0005;
    if (settling) invalidate();
  });

  const detail = TIER_FINISH[tier];
  // The core's faces, including its bevel, so everything mounted on it sits clear of it.
  const front = CORE / 2 + 0.009;
  // The room's wash fills the view behind the card, fading out well before the canvas edge.
  const wash = (CAMERA_Z + 1.6) / CAMERA_Z;

  return (
    <>
      <mesh position={[0, 0, -1.6]} scale={[viewport.width * wash, viewport.height * wash, 1]} material={materials.ambient}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <group ref={aura}>
        <mesh
          scale={[(WIDTH * HALO_CANVAS.width * 1.03) / 320, (HEIGHT * HALO_CANVAS.height * 1.03) / 472, 1]}
          material={materials.halo}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>

      <group ref={card}>
        <mesh geometry={geometry.core} material={materials.core} />
        {detail.rails >= 1 ? <mesh geometry={geometry.railNear} material={materials.rail} /> : null}
        {detail.rails >= 2 ? <mesh geometry={geometry.railFar} material={materials.rail} /> : null}
        {[1, -1].map((side) => (
          <group key={side} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
            <mesh geometry={geometry.frame} material={materials.frame} position={[0, 0, front]} />
            <mesh geometry={geometry.step} material={materials.step} position={[0, 0, front]} />
            {side === 1 ? (
              <>
                <mesh geometry={geometry.face} material={materials.base} position={[0, 0, front + DEPTH.base]} renderOrder={1} />
                {detail.foil > 0 ? (
                  <mesh geometry={geometry.face} material={materials.foil} position={[0, 0, front + DEPTH.foil]} renderOrder={1} />
                ) : null}
                <mesh
                  geometry={geometry.face}
                  material={materials.portrait}
                  position={[0, 0, front + DEPTH.portrait]}
                  renderOrder={2}
                />
                <mesh geometry={geometry.face} material={materials.info} position={[0, 0, front + DEPTH.info]} renderOrder={3} />
              </>
            ) : (
              <mesh geometry={geometry.face} material={materials.back} position={[0, 0, front + DEPTH.base]} renderOrder={1} />
            )}
            <lineLoop geometry={geometry.pinstripe} material={materials.pinstripe} position={[0, 0, front + DEPTH.info + 0.004]} />
            <mesh geometry={geometry.glass} material={materials.glass} position={[0, 0, front + DEPTH.glass]} renderOrder={4} />
          </group>
        ))}
      </group>

      <mesh ref={shadowMesh} position={[0, -HEIGHT / 2 - 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.shadow}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  );
}

export default function PlayerCard3D({
  faces,
  tier,
  accent,
  flipped,
  celebrate,
  focus = false,
  raised = false,
  inspect = false,
  lite,
  label,
  surface,
  onToggle,
  onSettle,
  onFirstFrame,
  onContextLost,
}: {
  faces: CardFaces;
  tier: CardTierId;
  /** The tier's accent colour, for the pinstripe and halo. */
  accent: string;
  flipped: boolean;
  celebrate: boolean;
  /** Brings the card into the light (while it's being inspected). */
  focus?: boolean;
  /** Lifts the card into the light without tilting it (while it has keyboard focus). */
  raised?: boolean;
  /** Lets the card be dragged round, and clicking turns it over. */
  inspect?: boolean;
  lite: boolean;
  label: string;
  /** The element over the card that the pointer moves on. */
  surface: HTMLElement | null;
  onToggle: () => void;
  /** Called with the face a drag came to rest on. */
  onSettle?: (back: boolean) => void;
  onFirstFrame?: () => void;
  onContextLost: () => void;
}) {
  return (
    <Stage
      label={label}
      lite={lite}
      shadows={false}
      environment={1}
      studio="dark"
      camera={{ position: [0, 0, CAMERA_Z], fov: FOV }}
      onContextLost={onContextLost}
      className="pointer-events-none size-full"
    >
      <directionalLight position={[3, 4, 6]} intensity={0.9} />
      <directionalLight position={[-5, 2, -3]} intensity={1.3} color="#3be8a3" />
      <directionalLight position={[5, 3, -4]} intensity={0.6} color="#f2f0e9" />
      <ambientLight intensity={0.25} />
      <CardObject
        faces={faces}
        tier={tier}
        accent={accent}
        flipped={flipped}
        celebrate={celebrate}
        focus={focus}
        raised={raised}
        inspect={inspect}
        lite={lite}
        surface={surface}
        onToggle={onToggle}
        onSettle={onSettle ?? (() => {})}
        onFirstFrame={onFirstFrame}
      />
    </Stage>
  );
}
