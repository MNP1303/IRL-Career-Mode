"use client";

/**
 * A GPS heatmap on the 3D pitch: one transparent texture laid on the grass,
 * painted from the same density grid as the 2D view (`paintHeat`). No mesh
 * per cell. It sits just above the turf and markings with depth writes off
 * and a polygon offset, so it never z-fights, and the texture is disposed
 * when the grid changes or the layer unmounts.
 *
 * The 3D pitch is always a standard 105 × 68 m model, so a smaller pitch's
 * grid is scaled onto it along each axis. The 2D view keeps true proportions.
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PITCH } from "@/lib/domain";
import type { DrawableGrid } from "@/lib/gps/record";
import { paintHeat } from "@/lib/gps/render";
import type { PitchDimensions } from "@/lib/gps/types";
import { RUN_OFF } from "@/components/pitch/scene/pitch-model";

const SURFACE_LENGTH = PITCH.length + RUN_OFF * 2;
const SURFACE_WIDTH = PITCH.width + RUN_OFF * 2;
const TEXTURE_WIDTH = 1024;

export function GpsHeatLayer({ grid, pitch }: { grid: DrawableGrid; pitch: PitchDimensions }) {
  const invalidate = useThree((state) => state.invalidate);
  const texture = useMemo(() => {
    const width = TEXTURE_WIDTH;
    const height = Math.round((TEXTURE_WIDTH * SURFACE_WIDTH) / SURFACE_LENGTH);
    const sx = pitch.length / PITCH.length;
    const sy = pitch.width / PITCH.width;
    const pixels = paintHeat(grid, width, height, (u, v) => ({
      x: (-RUN_OFF + u * SURFACE_LENGTH) * sx,
      y: (-RUN_OFF + v * SURFACE_WIDTH) * sy,
    }));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  }, [grid, pitch.length, pitch.width]);

  useEffect(() => {
    invalidate();
    return () => texture.dispose();
  }, [texture, invalidate]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={3}>
      <planeGeometry args={[SURFACE_LENGTH, SURFACE_WIDTH]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}
