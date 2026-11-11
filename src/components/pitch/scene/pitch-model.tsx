"use client";

/**
 * The pitch as an object: a floating plinth, mowed turf, markings built from
 * geometry (so they stay crisp at any zoom), two goals with nets and a ring
 * of slim fence posts. Real proportions throughout (105 × 68 m); one world
 * unit is one metre, with the pitch centred on the origin.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PITCH } from "@/lib/domain";

export const HALF_LENGTH = PITCH.length / 2;
export const HALF_WIDTH = PITCH.width / 2;
/** Run-off between the touchlines and the plinth's edge. */
export const RUN_OFF = 7;
const PLINTH_DEPTH = 2.6;

const LINE = "#efe6cf";
const LINE_WIDTH = 0.22;

/** Converts the app's pitch coordinates (x along the length, y down from the far touchline) to the scene. */
export function toWorld(x: number, y: number): [number, number] {
  return [x - HALF_LENGTH, y - HALF_WIDTH];
}

/** Mowing stripes, a faint cross-cut and a little grain, painted once. */
function useTurfTexture() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 680;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#21422a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stripes = 18;
    const stripeWidth = canvas.width / stripes;
    for (let index = 0; index < stripes; index += 1) {
      if (index % 2 === 0) continue;
      context.fillStyle = "#264b2f";
      context.fillRect(index * stripeWidth, 0, stripeWidth, canvas.height);
    }
    const bands = 8;
    const bandHeight = canvas.height / bands;
    for (let index = 0; index < bands; index += 2) {
      context.fillStyle = "rgb(255 255 255 / 1.6%)";
      context.fillRect(0, index * bandHeight, canvas.width, bandHeight);
    }
    const grain = context.getImageData(0, 0, canvas.width, canvas.height);
    // A fixed-seed generator: the same grain every time, and no randomness during render.
    let seed = 0x2f6b3a;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let index = 0; index < grain.data.length; index += 4) {
      const noise = (next() - 0.5) * 10;
      grain.data[index] += noise;
      grain.data[index + 1] += noise;
      grain.data[index + 2] += noise;
    }
    context.putImageData(grain, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

type Segment = [number, number, number, number];
type Arc = { x: number; z: number; radius: number; start: number; length: number };

/** Every marking on a standard pitch, as straight segments and arcs in scene coordinates. */
function markings(): { segments: Segment[]; arcs: Arc[]; spots: [number, number][] } {
  const L = HALF_LENGTH;
  const W = HALF_WIDTH;
  const segments: Segment[] = [
    [-L, -W, L, -W],
    [-L, W, L, W],
    [-L, -W, -L, W],
    [L, -W, L, W],
    [0, -W, 0, W],
  ];
  const arcs: Arc[] = [{ x: 0, z: 0, radius: 9.15, start: 0, length: Math.PI * 2 }];
  const spots: [number, number][] = [[0, 0]];
  for (const side of [-1, 1]) {
    const goalLine = side * L;
    const box = goalLine - side * 16.5;
    const six = goalLine - side * 5.5;
    segments.push(
      [goalLine, -20.16, box, -20.16],
      [goalLine, 20.16, box, 20.16],
      [box, -20.16, box, 20.16],
      [goalLine, -9.16, six, -9.16],
      [goalLine, 9.16, six, 9.16],
      [six, -9.16, six, 9.16],
    );
    const spot = goalLine - side * 11;
    spots.push([spot, 0]);
    // The "D": the part of the 9.15 m circle around the spot that lies outside the box.
    const reach = Math.acos(5.5 / 9.15);
    arcs.push({ x: spot, z: 0, radius: 9.15, start: side > 0 ? Math.PI - reach : -reach, length: reach * 2 });
    for (const end of [-1, 1]) {
      // Ring angles run anticlockwise from +x in the XY plane, which becomes -z after laying it flat.
      const startAngle = side > 0 ? (end > 0 ? Math.PI / 2 : Math.PI) : end > 0 ? 0 : -Math.PI / 2;
      arcs.push({ x: goalLine, z: end * W, radius: 1, start: startAngle, length: Math.PI / 2 });
    }
  }
  return { segments, arcs, spots };
}

function Markings() {
  const lineMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: 0.9, toneMapped: false }),
    [],
  );
  const parts = useMemo(() => {
    const { segments, arcs, spots } = markings();
    const geometries: { geometry: THREE.BufferGeometry; position: [number, number, number]; rotation: number }[] = [];
    for (const [x1, z1, x2, z2] of segments) {
      const length = Math.hypot(x2 - x1, z2 - z1) + LINE_WIDTH;
      geometries.push({
        geometry: new THREE.PlaneGeometry(length, LINE_WIDTH),
        position: [(x1 + x2) / 2, 0.03, (z1 + z2) / 2],
        rotation: -Math.atan2(z2 - z1, x2 - x1),
      });
    }
    for (const arc of arcs) {
      geometries.push({
        geometry: new THREE.RingGeometry(arc.radius - LINE_WIDTH / 2, arc.radius + LINE_WIDTH / 2, 96, 1, arc.start, arc.length),
        position: [arc.x, 0.03, arc.z],
        rotation: 0,
      });
    }
    for (const [x, z] of spots) {
      geometries.push({ geometry: new THREE.CircleGeometry(0.28, 24), position: [x, 0.03, z], rotation: 0 });
    }
    return geometries;
  }, []);
  useEffect(
    () => () => {
      lineMaterial.dispose();
      for (const part of parts) part.geometry.dispose();
    },
    [lineMaterial, parts],
  );
  return (
    <group>
      {parts.map((part, index) => (
        <mesh
          key={index}
          geometry={part.geometry}
          material={lineMaterial}
          position={part.position}
          rotation={[-Math.PI / 2, 0, part.rotation]}
        />
      ))}
    </group>
  );
}

/** A goal: slim ivory posts and crossbar with a fine net behind. */
function Goal({ side }: { side: 1 | -1 }) {
  const frame = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ece6d6", metalness: 0.55, roughness: 0.32 }),
    [],
  );
  const net = useMemo(() => {
    const points: number[] = [];
    const depth = 2;
    const width = 7.32;
    const height = 2.44;
    const step = 0.4;
    // Back panel and roof, as a grid of thin lines.
    for (let z = -width / 2; z <= width / 2 + 0.001; z += step) {
      points.push(depth, 0, z, depth, height, z, 0, height, z, depth, height, z);
    }
    for (let y = 0; y <= height + 0.001; y += step) points.push(depth, y, -width / 2, depth, y, width / 2);
    for (let x = 0; x <= depth + 0.001; x += step) {
      points.push(x, height, -width / 2, x, height, width / 2);
      for (const z of [-width / 2, width / 2]) points.push(x, 0, z, x, height, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, []);
  const netMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#f2f0e9", transparent: true, opacity: 0.28 }),
    [],
  );
  useEffect(
    () => () => {
      frame.dispose();
      net.dispose();
      netMaterial.dispose();
    },
    [frame, net, netMaterial],
  );
  const post = 0.06;
  return (
    <group position={[side * HALF_LENGTH, 0, 0]} scale={[side, 1, 1]}>
      {[-3.66, 3.66].map((z) => (
        <mesh key={z} material={frame} position={[0, 1.22, z]} castShadow>
          <cylinderGeometry args={[post, post, 2.44, 10]} />
        </mesh>
      ))}
      <mesh material={frame} position={[0, 2.44, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[post, post, 7.44, 10]} />
      </mesh>
      <lineSegments geometry={net} material={netMaterial} />
    </group>
  );
}

/** Slim posts around the plinth's edge, drawn as one instanced mesh. */
function Fence() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const result: [number, number][] = [];
    const x = HALF_LENGTH + RUN_OFF - 0.6;
    const z = HALF_WIDTH + RUN_OFF - 0.6;
    const spacing = 6;
    for (let along = -x; along <= x + 0.01; along += (2 * x) / Math.round((2 * x) / spacing)) {
      result.push([along, -z], [along, z]);
    }
    for (let across = -z + 6; across <= z - 5.9; across += (2 * z) / Math.round((2 * z) / spacing)) {
      result.push([-x, across], [x, across]);
    }
    return result;
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b3532", metalness: 0.7, roughness: 0.4 }), []);
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), []);
  useLayoutEffect(() => {
    const node = mesh.current;
    if (!node) return;
    const matrix = new THREE.Matrix4();
    spots.forEach(([x, z], index) => {
      matrix.makeTranslation(x, 1.6, z);
      node.setMatrixAt(index, matrix);
    });
    node.instanceMatrix.needsUpdate = true;
  }, [spots]);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  return <instancedMesh ref={mesh} args={[geometry, material, spots.length]} castShadow />;
}

/**
 * "ATTACKING ›››" painted along both side strips of the attacking half, so
 * the direction of play stays readable however the pitch is turned.
 */
function AttackMarkings() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 96;
    const context = canvas.getContext("2d")!;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-geist") || "sans-serif";
    context.fillStyle = "#c8ff00";
    context.font = `600 58px ${family}`;
    context.textBaseline = "middle";
    context.letterSpacing = "14px";
    context.fillText("ATTACKING", 24, 50);
    // Chevrons pointing the way, fading in towards the goal.
    for (let index = 0; index < 3; index += 1) {
      const x = 640 + index * 110;
      context.globalAlpha = 0.45 + index * 0.25;
      context.beginPath();
      context.moveTo(x, 18);
      context.lineTo(x + 42, 48);
      context.lineTo(x, 78);
      context.lineWidth = 12;
      context.strokeStyle = "#c8ff00";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  // The strip between the turf's edge (3 m out) and the plinth's edge.
  const offset = HALF_WIDTH + 3 + (RUN_OFF - 3) / 2;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[HALF_LENGTH / 2, 0.004, side * offset]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[34, 3.2]} />
          <meshBasicMaterial map={texture} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function PitchModel({ lite, children }: { lite: boolean; children?: React.ReactNode }) {
  const turf = useTurfTexture();
  const width = PITCH.length + RUN_OFF * 2;
  const depth = PITCH.width + RUN_OFF * 2;
  return (
    <group>
      {/* The plinth the pitch stands on. */}
      <mesh position={[0, -PLINTH_DEPTH / 2 - 0.01, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, PLINTH_DEPTH, depth]} />
        <meshStandardMaterial color="#1b2623" roughness={0.85} metalness={0.15} />
      </mesh>
      {/* A thin lighter rim along the top edge, catching the key light. */}
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#26332f" roughness={0.75} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[PITCH.length + 6, PITCH.width + 6]} />
        <meshStandardMaterial map={turf} roughness={0.95} metalness={0} />
      </mesh>
      <Markings />
      <Goal side={1} />
      <Goal side={-1} />
      <AttackMarkings />
      {lite ? null : <Fence />}
      {children}
    </group>
  );
}
