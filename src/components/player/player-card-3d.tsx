"use client";

/**
 * The player card as a physical object: a bevelled slab carrying the card's
 * own art on both faces, held between two thin acrylic layers with a faint
 * emerald edge. Studio reflections, a clearcoat and a touch of iridescence
 * give it angle-dependent highlights. It leans gently towards the pointer,
 * turns over to show its back, and spins once when the overall goes up.
 * It never moves on its own, so it reads as well standing still.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";
import { Stage } from "@/components/three/stage";

const S = 1 / 100;
/** The card silhouette from the SVG design (320 × 472), centred and in scene units. */
function cardShape(scale = 1) {
  const p = (x: number, y: number): [number, number] => [((x - 160) * S) * scale, (-(y - 236) * S) * scale];
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

/** A flat face of the card with UVs stretched over the design's bounds, so the art lines up. */
function faceGeometry(shape: THREE.Shape) {
  const geometry = new THREE.ShapeGeometry(shape, 24);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uv[index * 2] = position.getX(index) / 3.2 + 0.5;
    uv[index * 2 + 1] = position.getY(index) / 4.72 + 0.5;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

const DEPTH = 0.07;
const BEVEL = 0.025;
const FACE_Z = DEPTH / 2 + BEVEL + 0.002;
const ACRYLIC_Z = 0.17;

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

/** A soft round shadow under the floating card. */
function useShadowTexture() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgb(0 0 0 / 55%)");
    gradient.addColorStop(1, "rgb(0 0 0 / 0%)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function CardObject({
  front,
  back,
  flipped,
  celebrate,
  lite,
  onToggle,
}: {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  flipped: boolean;
  celebrate: boolean;
  lite: boolean;
  onToggle: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const group = useRef<THREE.Group>(null);
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  const frontMap = useCanvasTexture(front, anisotropy);
  const backMap = useCanvasTexture(back, anisotropy);
  const shadow = useShadowTexture();

  const geometry = useMemo(() => {
    const shape = cardShape();
    const body = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 4,
      curveSegments: 24,
    });
    body.translate(0, 0, -DEPTH / 2);
    const face = faceGeometry(shape);
    const shell = new THREE.ShapeGeometry(cardShape(1.035), 24);
    const outline = new THREE.BufferGeometry().setFromPoints(cardShape(1.035).getPoints(48));
    return { body, face, shell, outline };
  }, []);

  const materials = useMemo(() => {
    const physicalFace = (map: THREE.Texture) =>
      new THREE.MeshPhysicalMaterial({
        // The art shows exactly as designed (self-lit, not tone mapped), and the
        // clearcoat, reflections and iridescence add highlights that move with the angle.
        color: "#000000",
        emissive: "#ffffff",
        emissiveMap: map,
        emissiveIntensity: 1,
        toneMapped: false,
        roughness: 0.38,
        metalness: 0,
        envMapIntensity: 0.55,
        clearcoat: 0.6,
        clearcoatRoughness: 0.22,
        iridescence: lite ? 0 : 0.25,
        iridescenceIOR: 1.3,
        iridescenceThicknessMinimum: 120,
        iridescenceThicknessMaximum: 520,
      });
    return {
      front: physicalFace(frontMap),
      back: physicalFace(backMap),
      edge: new THREE.MeshPhysicalMaterial({ color: "#aeb8ae", metalness: 0.92, roughness: 0.3, clearcoat: 0.6 }),
      acrylic: new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.05,
        roughness: 0.06,
        envMapIntensity: 0.35,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        depthWrite: false,
      }),
      line: new THREE.LineBasicMaterial({ color: "#7dff9c", transparent: true, opacity: 0.32, toneMapped: false }),
    };
  }, [frontMap, backMap, lite]);

  useEffect(
    () => () => {
      for (const item of Object.values(geometry)) item.dispose();
      for (const item of Object.values(materials)) item.dispose();
    },
    [geometry, materials],
  );

  // The edge line's material, kept in a ref so the frame loop can brighten it.
  const lineMaterial = useRef<THREE.LineBasicMaterial | null>(null);
  useEffect(() => {
    lineMaterial.current = materials.line;
  }, [materials]);

  // Pointer tilt, hover lift, the flip and the celebration all feed one rotation.
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const motion = useRef({ tiltX: 0, tiltY: 0, lift: 0, turn: flipped ? Math.PI : 0, glow: 0 });
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const element = gl.domElement;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const box = element.getBoundingClientRect();
      pointer.current = {
        x: ((event.clientX - box.left) / box.width) * 2 - 1,
        y: -(((event.clientY - box.top) / box.height) * 2 - 1),
        inside: true,
      };
      invalidate();
    };
    const leave = () => {
      pointer.current.inside = false;
      invalidate();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, [gl, invalidate]);

  useEffect(() => {
    const state = motion.current;
    const turn = flipped ? Math.PI : 0;
    if (reduced) {
      state.turn = turn;
      invalidate();
      return;
    }
    // Always turn the short way round, so flipping back reverses the flip.
    const tween = gsap.to(state, { turn, duration: 0.9, ease: EASE.inOut, onUpdate: invalidate });
    return () => {
      tween.kill();
    };
  }, [flipped, reduced, invalidate]);

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

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    const active = pointer.current.inside && !reduced;
    const ease = 1 - Math.exp(-delta * 7);
    const targetX = active ? -pointer.current.y * 0.18 : 0;
    const targetY = active ? pointer.current.x * 0.26 : 0;
    const targetLift = active ? 0.22 : 0;
    motion.current.tiltX += (targetX - motion.current.tiltX) * ease;
    motion.current.tiltY += (targetY - motion.current.tiltY) * ease;
    motion.current.lift += (targetLift - motion.current.lift) * ease;
    const { tiltX, tiltY, lift, turn, glow } = motion.current;
    node.rotation.set(tiltX, turn + tiltY, 0);
    node.position.set(0, lift * 0.4, lift);
    if (lineMaterial.current) lineMaterial.current.opacity = 0.3 + lift * 0.5 + glow * 0.6;
    const settling =
      Math.abs(targetX - tiltX) > 0.0005 || Math.abs(targetY - tiltY) > 0.0005 || Math.abs(targetLift - lift) > 0.0005;
    if (settling) invalidate();
  });

  return (
    <>
      <group
        ref={group}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <mesh geometry={geometry.body} material={materials.edge} />
        <mesh geometry={geometry.face} material={materials.front} position={[0, 0, FACE_Z]} />
        <mesh geometry={geometry.face} material={materials.back} position={[0, 0, -FACE_Z]} rotation={[0, Math.PI, 0]} />
        {lite ? null : (
          <>
            <mesh geometry={geometry.shell} material={materials.acrylic} position={[0, 0, ACRYLIC_Z]} />
            <mesh geometry={geometry.shell} material={materials.acrylic} position={[0, 0, -ACRYLIC_Z]} rotation={[0, Math.PI, 0]} />
          </>
        )}
        <lineLoop geometry={geometry.outline} material={materials.line} position={[0, 0, ACRYLIC_Z + 0.002]} />
        <lineLoop geometry={geometry.outline} material={materials.line} position={[0, 0, -ACRYLIC_Z - 0.002]} />
      </group>
      <mesh position={[0, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[3.4, 1.1, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
    </>
  );
}

export default function PlayerCard3D({
  front,
  back,
  flipped,
  celebrate,
  lite,
  label,
  onToggle,
  onContextLost,
}: {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  flipped: boolean;
  celebrate: boolean;
  lite: boolean;
  label: string;
  onToggle: () => void;
  onContextLost: () => void;
}) {
  return (
    <Stage
      label={label}
      lite={lite}
      shadows={false}
      environment={1}
      studio="dark"
      camera={{ position: [0, 0, 11.6], fov: 30 }}
      onContextLost={onContextLost}
    >
      <directionalLight position={[3, 4, 6]} intensity={0.85} />
      <directionalLight position={[-5, 2, -3]} intensity={0.7} color="#3be8a3" />
      <ambientLight intensity={0.35} />
      <CardObject front={front} back={back} flipped={flipped} celebrate={celebrate} lite={lite} onToggle={onToggle} />
    </Stage>
  );
}
