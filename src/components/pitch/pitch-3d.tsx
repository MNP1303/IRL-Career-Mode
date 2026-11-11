"use client";

/**
 * The 3D pitch: a floating, properly marked pitch in a dark studio, with the
 * player's recorded zones glowing over the turf and their roles marked. The
 * camera has an isometric view, an overhead tactical view and a focus that
 * flies towards the most active zone of a selected match. Loaded only when
 * the 3D view is shown.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PITCH, type Position } from "@/lib/domain";
import { EASE, gsap, introSeen, markIntroSeen, prefersReducedMotion } from "@/lib/gsap";
import { cellIndex, type ZoneGrid } from "@/lib/heatmap";
import { Stage } from "@/components/three/stage";
import { OrbitRig, type CameraView } from "@/components/three/orbit-rig";
import { PitchModel, RUN_OFF } from "@/components/pitch/scene/pitch-model";
import {
  HeatLayer,
  RoleMarkers,
  ZoneHighlight,
  ZonePicker,
  cellCentre,
  type Cell,
} from "@/components/pitch/scene/data-layers";
import { ZONE_COLS, ZONE_ROWS } from "@/lib/domain";

export type PitchView = "iso" | "overhead";

const FOV = 32;

/** Far enough back that the whole plinth fits the frame, whatever its shape. */
function fitDistance(aspect: number, view: PitchView) {
  const halfWidth = (PITCH.length + RUN_OFF * 2) / 2;
  const halfDepth = (PITCH.width + RUN_OFF * 2) / 2;
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  // The isometric view sees the plinth corner-on, so fit its diagonal.
  const across = view === "iso" ? Math.hypot(halfWidth, halfDepth) * 1.02 : halfWidth;
  const byWidth = across / (tan * aspect);
  const byHeight = (view === "iso" ? halfDepth * 1.35 : halfDepth) / tan;
  return Math.max(byWidth, byHeight) * 1.0;
}

function views(aspect: number) {
  const iso = fitDistance(aspect, "iso");
  const elevation = THREE.MathUtils.degToRad(42);
  const azimuth = THREE.MathUtils.degToRad(-32);
  const isoView: CameraView = {
    position: [
      iso * Math.cos(elevation) * Math.sin(azimuth),
      iso * Math.sin(elevation),
      iso * Math.cos(elevation) * Math.cos(azimuth),
    ],
    target: [0, -1, 0],
  };
  const overhead = fitDistance(aspect, "overhead");
  const overheadView: CameraView = { position: [0, overhead, 0.01], target: [0, 0, 0] };
  return { iso: isoView, overhead: overheadView, distance: iso };
}

/** The brightest recorded zone, where a selected match's camera move heads. */
function hottestCell(grid: ZoneGrid): Cell | null {
  let best = -1;
  let found: Cell | null = null;
  for (let row = 0; row < ZONE_ROWS; row += 1) {
    for (let col = 0; col < ZONE_COLS; col += 1) {
      const value = grid[cellIndex(col, row)];
      if (value > best && value > 0) {
        best = value;
        found = { col, row };
      }
    }
  }
  return found;
}

/** Lighting shared by the scene: a soft key with shadows, a cool fill and a faint emerald rim. */
function Lights({ lite }: { lite: boolean }) {
  return (
    <>
      <hemisphereLight args={["#bfe9dc", "#0a1210", 0.42]} />
      <directionalLight
        position={[-60, 90, 50]}
        intensity={1.75}
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={260}
        shadow-bias={-0.0004}
        shadow-radius={6}
      />
      <directionalLight position={[70, 25, -60]} intensity={0.55} color="#38e0a0" />
    </>
  );
}

/** A shadow catcher under the floating pitch, so it sits in space rather than on nothing. */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]} receiveShadow>
      <planeGeometry args={[600, 600]} />
      <shadowMaterial transparent opacity={0.45} />
    </mesh>
  );
}

/** Raises the pitch into place the first time the scene appears in a session. */
function Rise({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const node = group.current;
    if (!node || prefersReducedMotion() || introSeen("pitch-rise")) return;
    node.position.y = -10;
    node.rotation.y = -0.18;
    const tween = gsap.to(node.position, { y: 0, duration: 1.6, ease: EASE.settle, onUpdate: invalidate });
    const turn = gsap.to(node.rotation, {
      y: 0,
      duration: 1.8,
      ease: EASE.settle,
      onUpdate: invalidate,
      onComplete: () => markIntroSeen("pitch-rise"),
    });
    return () => {
      tween.kill();
      turn.kill();
      node.position.y = 0;
      node.rotation.y = 0;
    };
  }, [invalidate]);
  return <group ref={group}>{children}</group>;
}

function Scene({
  grid,
  hovered,
  onHover,
  lite,
  view,
  resetKey,
  focusKey,
  positions,
}: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
  lite: boolean;
  view: PitchView;
  resetKey: number;
  focusKey?: string;
  positions: [Position, number][];
}) {
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(size.height, 1);
  const framing = useMemo(() => views(aspect), [aspect]);
  const hot = hottestCell(grid);

  // A selected match pulls the camera towards its most active zone; otherwise, the chosen view.
  let camera = view === "overhead" ? framing.overhead : framing.iso;
  if (focusKey && hot) {
    const [x, z] = cellCentre(hot);
    const base = camera;
    const pull = view === "overhead" ? 0.62 : 0.6;
    camera = {
      target: [x * 0.6, 0, z * 0.6],
      position: [
        base.position[0] * pull + x * 0.6,
        base.position[1] * pull,
        base.position[2] * pull + z * 0.6,
      ],
    };
  }
  const viewKey = `${view}:${focusKey ?? "all"}:${resetKey}:${Math.round(aspect * 10)}`;
  const intro: CameraView = {
    position: [framing.iso.position[0] * 1.5, framing.iso.position[1] * 0.55, framing.iso.position[2] * 1.5],
    target: [0, -6, 0],
  };

  return (
    <>
      <Lights lite={lite} />
      <Ground />
      <Rise>
        <PitchModel lite={lite}>
          <HeatLayer grid={grid} />
          <ZonePicker onHover={onHover} />
          {hovered ? <ZoneHighlight cell={hovered} /> : null}
          {positions.length ? <RoleMarkers counts={positions} /> : null}
        </PitchModel>
      </Rise>
      <OrbitRig
        view={camera}
        viewKey={viewKey}
        intro={intro}
        introKey="pitch-camera"
        minDistance={framing.distance * 0.35}
        maxDistance={framing.distance * 1.6}
        maxPolarAngle={1.25}
      />
    </>
  );
}

export default function Pitch3D({
  grid,
  hovered,
  onHover,
  label,
  lite,
  view,
  resetKey,
  focusKey,
  positions,
  onContextLost,
}: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
  label: string;
  lite: boolean;
  view: PitchView;
  resetKey: number;
  focusKey?: string;
  positions: [Position, number][];
  onContextLost: () => void;
}) {
  return (
    <Stage
      label={label}
      lite={lite}
      environment={0.35}
      camera={{ position: [0, 160, 0.01], fov: FOV, near: 1, far: 900 }}
      onContextLost={onContextLost}
    >
      <Scene
        grid={grid}
        hovered={hovered}
        onHover={onHover}
        lite={lite}
        view={view}
        resetKey={resetKey}
        focusKey={focusKey}
        positions={positions}
      />
    </Stage>
  );
}

