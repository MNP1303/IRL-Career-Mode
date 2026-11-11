"use client";

/**
 * The shared stage for every 3D scene: one look (studio reflections, soft
 * shadows, filmic tone mapping) and one set of performance limits, so the
 * pitch and the player card feel like parts of the same world.
 */

import { useEffect, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * A dark photo studio: near-black walls with a few soft light panels and a
 * faint emerald strip. Glossy surfaces pick up crisp, moving highlights
 * instead of a uniform white wash.
 */
function darkStudio() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050607");
  const plane = new THREE.PlaneGeometry(1, 1);
  const panel = (size: [number, number], position: [number, number, number], color: string, strength: number) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(plane, material);
    mesh.scale.set(size[0], size[1], 1);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  panel([7, 2.2], [0, 6, 3], "#ffffff", 2.4); // overhead softbox
  panel([2.6, 5], [6, 1, 5], "#f2f0e9", 1.6); // key, front right
  panel([1.4, 4], [-6, 0.5, 4], "#f2f0e9", 0.7); // fill, front left
  panel([0.5, 6], [-5, 0, -4], "#3be8a3", 1.2); // emerald rim behind
  return scene;
}

/**
 * Reflections generated on the device (no HDR download): a bright studio
 * room for matte scenes, or the dark studio for glossy objects.
 */
function StudioEnvironment({ intensity = 0.55, kind }: { intensity?: number; kind: "room" | "dark" }) {
  const get = useThree((state) => state.get);

  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = kind === "dark" ? darkStudio() : new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      target.dispose();
      room.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      pmrem.dispose();
    };
  }, [get, intensity, kind]);

  return null;
}

export function Stage({
  children,
  label,
  lite,
  camera,
  shadows = true,
  environment = 0.55,
  studio = "room",
  onContextLost,
  className,
}: {
  children: ReactNode;
  /** What the scene shows, for assistive technology. */
  label: string;
  /** Lower resolution, no antialiasing and no shadows for weaker devices. */
  lite: boolean;
  camera: { position: [number, number, number]; fov: number; near?: number; far?: number };
  shadows?: boolean;
  environment?: number;
  /** "dark" for glossy objects, so reflections read as highlights. */
  studio?: "room" | "dark";
  onContextLost: () => void;
  className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={className ?? "size-full"}>
      <Canvas
        frameloop="demand"
        dpr={lite ? [1, 1.25] : [1, 1.75]}
        shadows={shadows && !lite ? "percentage" : false}
        camera={{ near: 0.1, far: 800, ...camera }}
        gl={{
          antialias: !lite,
          alpha: true,
          powerPreference: lite ? "low-power" : "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onContextLost();
          });
        }}
      >
        <StudioEnvironment intensity={environment} kind={studio} />
        {children}
      </Canvas>
    </div>
  );
}
