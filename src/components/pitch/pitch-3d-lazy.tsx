"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import type { ZoneGrid } from "@/lib/heatmap";

type Cell = { col: number; row: number };

const loadPitch3D = () => import("@/components/pitch/pitch-3d");

/** Three.js only downloads once someone asks for the 3D view. */
const Pitch3D = dynamic(loadPitch3D, {
  ssr: false,
  loading: () => <div className="skeleton size-full rounded-lg" aria-label="Loading 3D pitch" />,
});

/** Warms the 3D bundle on hover or focus of the toggle. */
export function preloadPitch3D() {
  void loadPitch3D();
}

export function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Few cores, little memory or Data Saver: render the 3D view at lower cost. */
export function prefersLiteRendering() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
}

class WebGLBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LazyPitch3D(props: {
  grid: ZoneGrid;
  hovered: Cell | null;
  onHover: (cell: Cell | null) => void;
  label: string;
  lite: boolean;
  resetKey: number;
  onFail: () => void;
}) {
  const { onFail, ...rest } = props;
  return (
    <WebGLBoundary onError={onFail}>
      <Pitch3D {...rest} onContextLost={onFail} />
    </WebGLBoundary>
  );
}
