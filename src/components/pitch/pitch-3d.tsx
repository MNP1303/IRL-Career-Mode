"use client";

/**
 * The season heatmap as a landscape: the same density field that colours the
 * 2D map raises the turf, so the most repeated areas stand tallest. Loaded
 * only when someone switches the pitch to 3D.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PITCH, ZONE_COLS, ZONE_ROWS } from "@/lib/domain";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";
import { densityField, heatmapCanvas, type ZoneGrid } from "@/lib/heatmap";

type Cell = { col: number; row: number };

// One vertex per metre is smooth enough for the gentle density field.
const SEGMENTS_X = PITCH.length;
const SEGMENTS_Z = PITCH.width;
const PEAK_HEIGHT = 11;
const TEXTURE_SCALE = 12;
const CELL_X = PITCH.length / ZONE_COLS;
const CELL_Z = PITCH.width / ZONE_ROWS;
const LIME = "#c8ff00";

/** Turf, heat and markings painted once per selection, matching the 2D pitch. */
function paintPitch(grid: ZoneGrid) {
  const canvas = document.createElement("canvas");
  canvas.width = PITCH.length * TEXTURE_SCALE;
  canvas.height = PITCH.width * TEXTURE_SCALE;
  const context = canvas.getContext("2d")!;
  context.scale(TEXTURE_SCALE, TEXTURE_SCALE);

  context.fillStyle = "#0f2c19";
  context.fillRect(0, 0, PITCH.length, PITCH.width);
  context.fillStyle = "#123520";
  const stripes = 14;
  for (let index = 0; index < stripes; index += 2) {
    context.fillRect((index * PITCH.length) / stripes, 0, PITCH.length / stripes, PITCH.width);
  }

  const heat = heatmapCanvas(grid);
  if (heat) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(heat, 0, 0, PITCH.length, PITCH.width);
  }

  context.strokeStyle = "rgb(255 255 255 / 78%)";
  context.lineWidth = 0.3;
  context.strokeRect(0, 0, PITCH.length, PITCH.width);
  context.beginPath();
  context.moveTo(PITCH.length / 2, 0);
  context.lineTo(PITCH.length / 2, PITCH.width);
  context.stroke();
  context.beginPath();
  context.arc(PITCH.length / 2, PITCH.width / 2, 9.15, 0, Math.PI * 2);
  context.stroke();
  for (const flipped of [false, true]) {
    context.save();
    if (flipped) {
      context.translate(PITCH.length, 0);
      context.scale(-1, 1);
    }
    context.strokeRect(0, 13.84, 16.5, 40.32);
    context.strokeRect(0, 24.84, 5.5, 18.32);
    context.beginPath();
    context.arc(11, 34, 9.15, -0.9273, 0.9273);
    context.stroke();
    context.restore();
  }
  return canvas;
}

/** Heights for every vertex, row by row from the far touchline. */
function heightsFor(grid: ZoneGrid) {
  const field = densityField(grid, SEGMENTS_X + 1, SEGMENTS_Z + 1);
  return field.map((value) => value ** 1.2 * PEAK_HEIGHT);
}

function cellAt(point: THREE.Vector3): Cell | null {
  const col = Math.floor((point.x + PITCH.length / 2) / CELL_X);
  const row = Math.floor((point.z + PITCH.width / 2) / CELL_Z);
  if (col < 0 || row < 0 || col >= ZONE_COLS || row >= ZONE_ROWS) return null;
  return { col, row };
}

function cellPeak(heights: Float32Array, cell: Cell) {
  let peak = 0;
  const x0 = Math.floor(cell.col * CELL_X);
  const z0 = Math.floor(cell.row * CELL_Z);
  for (let z = z0; z <= Math.min(SEGMENTS_Z, Math.ceil(z0 + CELL_Z)); z += 1) {
    for (let x = x0; x <= Math.min(SEGMENTS_X, Math.ceil(x0 + CELL_X)); x += 1) {
      peak = Math.max(peak, heights[z * (SEGMENTS_X + 1) + x]);
    }
  }
  return peak;
}

function Terrain({
  grid,
  hovered,
  onHover,
}: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const mesh = useRef<THREE.Mesh>(null);
  // Keyed on the values, so a re-render with an equal grid repaints nothing.
  const signature = grid.join();
  const texture = useMemo(() => {
    const map = new THREE.CanvasTexture(paintPitch(grid));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo(() => heightsFor(grid), [signature]);
  // Starts flat, so the first view rises out of the turf.
  const current = useRef(new Float32Array(target.length));
  const raised = useRef(false);

  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    const geometry = mesh.current?.geometry;
    if (!geometry) return;
    const from = current.current.slice();
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const progress = { value: 0 };
    const apply = () => {
      for (let index = 0; index < target.length; index += 1) {
        const height = from[index] + (target[index] - from[index]) * progress.value;
        current.current[index] = height;
        // The plane is laid flat by rotating the mesh, so local Z is height.
        position.setZ(index, height);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      invalidate();
    };
    if (prefersReducedMotion()) {
      progress.value = 1;
      apply();
      return;
    }
    // The first rise waits for the camera to start moving; later filters morph in place.
    const tween = gsap.to(progress, {
      value: 1,
      duration: raised.current ? 0.7 : 1.4,
      delay: raised.current ? 0 : 0.45,
      ease: EASE.settle,
      onUpdate: apply,
    });
    raised.current = true;
    return () => {
      tween.kill();
    };
  }, [target, invalidate]);

  const peak = hovered ? cellPeak(target, hovered) : 0;

  return (
    <>
      <mesh
        ref={mesh}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(cellAt(event.point));
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => onHover(cellAt(event.point))}
        onPointerOut={() => onHover(null)}
      >
        <planeGeometry args={[PITCH.length, PITCH.width, SEGMENTS_X, SEGMENTS_Z]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={0.32}
          roughness={0.88}
          metalness={0}
        />
      </mesh>
      {hovered ? <HoverColumn cell={hovered} height={peak + 1.2} /> : null}
    </>
  );
}

/** A lime wireframe column over the zone under the pointer. */
function HoverColumn({ cell, height }: { cell: Cell; height: number }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL_X, 1, CELL_Z)), []);
  useEffect(() => () => edges.dispose(), [edges]);
  const x = -PITCH.length / 2 + (cell.col + 0.5) * CELL_X;
  const z = -PITCH.width / 2 + (cell.row + 0.5) * CELL_Z;
  return (
    <group position={[x, height / 2, z]} scale={[1, height, 1]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={LIME} transparent opacity={0.9} />
      </lineSegments>
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CELL_X, CELL_Z]} />
        <meshBasicMaterial color={LIME} transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  );
}

const FOV = 38;
const ELEVATION = THREE.MathUtils.degToRad(44);

/** The resting camera: far enough back that the whole pitch fits the frame's width. */
function homePosition(aspect: number) {
  const halfWidth = (PITCH.length + 8) / 2;
  // The near touchline is closer than the centre, so it needs extra room.
  const distance = (halfWidth / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect)) * 1.24;
  return new THREE.Vector3(0, distance * Math.sin(ELEVATION), distance * Math.cos(ELEVATION));
}

function CameraRig({ resetKey }: { resetKey: number }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const introduced = useRef(false);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 45;
    controls.maxDistance = 260;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = 1.2;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    // One finger keeps scrolling the page; two fingers orbit and zoom.
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    if (controls.domElement) controls.domElement.style.touchAction = "pan-y";
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate]);

  // Fly from a top-down view to the resting angle; the same move resets the view.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const view = controls.object;
    const home = homePosition(size.width / size.height);
    const settle = () => {
      controls.update();
      invalidate();
    };
    controls.target.set(0, 0, 0);
    if (prefersReducedMotion()) {
      view.position.copy(home);
      settle();
      return;
    }
    if (!introduced.current) view.position.set(0, home.length() * 1.25, 0.1);
    introduced.current = true;
    const tween = gsap.to(view.position, {
      x: home.x,
      y: home.y,
      z: home.z,
      duration: 1.6,
      ease: EASE.inOut,
      onUpdate: settle,
    });
    return () => {
      tween.kill();
    };
    // Resizes shouldn't replay the flight, only an explicit reset should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, invalidate]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}

export default function Pitch3D({
  grid,
  hovered,
  onHover,
  label,
  lite,
  resetKey,
  onContextLost,
}: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
  label: string;
  /** Lower resolution and no antialiasing for weaker devices. */
  lite: boolean;
  resetKey: number;
  onContextLost: () => void;
}) {
  return (
    <div role="img" aria-label={label} className="size-full">
      <Canvas
        frameloop="demand"
        dpr={lite ? [1, 1.25] : [1, 1.75]}
        camera={{ fov: FOV, near: 1, far: 800, position: [0, 140, 0.1] }}
        gl={{ antialias: !lite, alpha: true, powerPreference: lite ? "low-power" : "high-performance" }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onContextLost();
          });
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[-40, 90, 50]} intensity={2.4} />
        <directionalLight position={[60, 30, -40]} intensity={0.5} color={LIME} />
        {/* The surround the pitch sits on. */}
        <mesh position={[0, -1.01, 0]}>
          <boxGeometry args={[PITCH.length + 8, 2, PITCH.width + 8]} />
          <meshStandardMaterial color="#0a1f12" roughness={1} />
        </mesh>
        <Terrain grid={grid} hovered={hovered} onHover={onHover} />
        <CameraRig resetKey={resetKey} />
      </Canvas>
    </div>
  );
}
