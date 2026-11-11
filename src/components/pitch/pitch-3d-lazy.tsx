"use client";

import dynamic from "next/dynamic";
import type { Position } from "@/lib/domain";
import type { ZoneGrid } from "@/lib/heatmap";
import { WebGLBoundary } from "@/components/three/capabilities";
import type { PitchView } from "@/components/pitch/pitch-3d";

export { prefersLiteRendering, supportsWebGL } from "@/components/three/capabilities";
export type { PitchView };

type Cell = { col: number; row: number };

const loadPitch3D = () => import("@/components/pitch/pitch-3d");

/** Three.js only downloads once the 3D view is shown. */
const Pitch3D = dynamic(loadPitch3D, {
  ssr: false,
  loading: () => <div className="skeleton size-full rounded-lg" aria-label="Loading 3D pitch" />,
});

/** Warms the 3D bundle on hover or focus of the toggle. */
export function preloadPitch3D() {
  void loadPitch3D();
}

export function LazyPitch3D(props: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
  label: string;
  lite: boolean;
  view: PitchView;
  resetKey: number;
  focusKey?: string;
  positions: [Position, number][];
  onFail: () => void;
}) {
  const { onFail, ...rest } = props;
  return (
    <WebGLBoundary onError={onFail}>
      <Pitch3D {...rest} onContextLost={onFail} />
    </WebGLBoundary>
  );
}
