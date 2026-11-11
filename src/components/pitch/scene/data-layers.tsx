"use client";

/**
 * What the player actually recorded, laid over the pitch:
 * - the zone heatmap as a soft, slightly raised glow (from painted zones only);
 * - markers for the positions played, which are roles rather than locations,
 *   so they're labelled as approximate;
 * - a highlight on the zone under the pointer.
 * Nothing here invents tracking data: no events or paths are placed, because
 * the app doesn't record where they happened.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { PITCH, POSITION_META, ZONE_COLS, ZONE_ROWS, type Position } from "@/lib/domain";
import { EASE, gsap, introSeen, prefersReducedMotion } from "@/lib/gsap";
import { densityField, rampColor, type ZoneGrid } from "@/lib/heatmap";
import { HALF_LENGTH, HALF_WIDTH, toWorld } from "@/components/pitch/scene/pitch-model";

export type Cell = { col: number; row: number };

const SEGMENTS_X = 105;
const SEGMENTS_Z = 68;
const RELIEF = 1.6;
const CELL_X = PITCH.length / ZONE_COLS;
const CELL_Z = PITCH.width / ZONE_ROWS;
const LIME = "#c8ff00";

export function cellAt(point: THREE.Vector3): Cell | null {
  const col = Math.floor((point.x + HALF_LENGTH) / CELL_X);
  const row = Math.floor((point.z + HALF_WIDTH) / CELL_Z);
  if (col < 0 || row < 0 || col >= ZONE_COLS || row >= ZONE_ROWS) return null;
  return { col, row };
}

export function cellCentre(cell: Cell): [number, number] {
  return [-HALF_LENGTH + (cell.col + 0.5) * CELL_X, -HALF_WIDTH + (cell.row + 0.5) * CELL_Z];
}

/** The heatmap as a translucent layer that rises gently where play was most repeated. */
export function HeatLayer({ grid }: { grid: ZoneGrid }) {
  const invalidate = useThree((state) => state.invalidate);
  const mesh = useRef<THREE.Mesh>(null);
  const signature = grid.join();
  const target = useMemo(() => {
    const field = densityField(grid, SEGMENTS_X + 1, SEGMENTS_Z + 1);
    const heights = new Float32Array(field.length);
    const colours = new Float32Array(field.length * 4);
    field.forEach((value, index) => {
      const shaped = value ** 1.5;
      const { rgb, alpha } = rampColor(shaped);
      heights[index] = value ** 1.3 * RELIEF;
      colours[index * 4] = rgb[0] / 255;
      colours[index * 4 + 1] = rgb[1] / 255;
      colours[index * 4 + 2] = rgb[2] / 255;
      colours[index * 4 + 3] = alpha * 0.82;
    });
    return { heights, colours };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const shown = useRef<{ heights: Float32Array; colours: Float32Array } | null>(null);

  useEffect(() => {
    const geometry = mesh.current?.geometry;
    if (!geometry) return;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    if (!geometry.attributes.color) {
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(position.count * 4), 4));
    }
    const colour = geometry.attributes.color as THREE.BufferAttribute;
    const from = shown.current ?? {
      heights: new Float32Array(target.heights.length),
      colours: new Float32Array(target.colours.length),
    };
    const progress = { value: 0 };
    const current = { heights: new Float32Array(target.heights.length), colours: new Float32Array(target.colours.length) };
    const apply = () => {
      const t = progress.value;
      for (let index = 0; index < target.heights.length; index += 1) {
        const height = from.heights[index] + (target.heights[index] - from.heights[index]) * t;
        current.heights[index] = height;
        // The plane is laid flat by rotating the mesh, so local Z is height.
        position.setZ(index, height);
      }
      for (let index = 0; index < target.colours.length; index += 1) {
        const value = from.colours[index] + (target.colours[index] - from.colours[index]) * t;
        current.colours[index] = value;
        colour.array[index] = value;
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
      shown.current = current;
      invalidate();
    };
    if (prefersReducedMotion()) {
      progress.value = 1;
      apply();
      return;
    }
    const first = !shown.current;
    // The first time, the heat rises after the pitch does; coming back, it's quicker.
    const arriving = first && !introSeen("pitch-rise");
    const tween = gsap.to(progress, {
      value: 1,
      duration: arriving ? 1.4 : 0.8,
      delay: arriving ? 0.9 : first ? 0.15 : 0,
      ease: EASE.settle,
      onUpdate: apply,
    });
    return () => {
      tween.kill();
    };
  }, [target, invalidate]);

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={2}>
      <planeGeometry args={[PITCH.length, PITCH.width, SEGMENTS_X, SEGMENTS_Z]} />
      <meshBasicMaterial vertexColors transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Invisible surface that turns the pointer into a zone, for the hover readout. */
export function ZonePicker({ onHover }: { onHover: (cell: Cell | null) => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.08, 0]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(cellAt(event.point));
      }}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => onHover(cellAt(event.point))}
      onPointerOut={() => onHover(null)}
    >
      <planeGeometry args={[PITCH.length, PITCH.width]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** A lime outline on the zone under the pointer. */
export function ZoneHighlight({ cell }: { cell: Cell }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(CELL_X, CELL_Z)), []);
  useEffect(() => () => edges.dispose(), [edges]);
  const [x, z] = cellCentre(cell);
  return (
    <group position={[x, 0.12, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={LIME} transparent opacity={0.95} toneMapped={false} />
      </lineSegments>
      <mesh>
        <planeGeometry args={[CELL_X, CELL_Z]} />
        <meshBasicMaterial color={LIME} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A small text label drawn to a canvas, so labels need no font loader in WebGL. */
function useLabel(text: string) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext("2d")!;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-geist") || "sans-serif";
    context.fillStyle = "rgb(17 18 19 / 82%)";
    context.beginPath();
    context.roundRect(8, 16, 240, 64, 32);
    context.fill();
    context.strokeStyle = "rgb(242 240 233 / 22%)";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#f2f0e9";
    context.font = `600 34px ${family}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 49);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function RoleMarker({ position, count, max }: { position: Position; count: number; max: number }) {
  const { x, y } = POSITION_META[position];
  const [wx, wz] = toWorld(x, y);
  const label = useLabel(`${position} · ${count}`);
  const size = 1.4 + (count / max) * 1.2;
  return (
    <group position={[wx, 0, wz]}>
      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[size * 0.82, size, 48]} />
        <meshBasicMaterial color={LIME} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 5, 8]} />
        <meshBasicMaterial color="#f2f0e9" transparent opacity={0.55} />
      </mesh>
      <sprite position={[0, 7.6, 0]} scale={[13, 4.9, 1]}>
        <spriteMaterial map={label} transparent depthWrite={false} toneMapped={false} />
      </sprite>
    </group>
  );
}

/** Where the player lined up, by role (approximate: positions, not GPS). */
export function RoleMarkers({ counts }: { counts: [Position, number][] }) {
  const max = Math.max(1, ...counts.map(([, count]) => count));
  return (
    <group>
      {counts.map(([position, count]) => (
        <RoleMarker key={position} position={position} count={count} max={max} />
      ))}
    </group>
  );
}
