"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";

export type CameraView = {
  position: [number, number, number];
  target: [number, number, number];
};

/**
 * Orbit, zoom and named camera views, with every change of view interpolated
 * (never a cut). The first view flies in from `intro`, so a scene arrives
 * rather than appears. One finger keeps scrolling the page on phones; two
 * fingers orbit and zoom.
 */
export function OrbitRig({
  view,
  viewKey,
  intro,
  minDistance,
  maxDistance,
  maxPolarAngle = 1.3,
}: {
  view: CameraView;
  /** Changing this replays the move to `view`, even if the numbers match (a reset). */
  viewKey: string;
  intro?: CameraView;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle?: number;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const arrived = useRef(false);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.minPolarAngle = 0.0001;
    controls.maxPolarAngle = maxPolarAngle;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
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
  }, [camera, gl, invalidate, minDistance, maxDistance, maxPolarAngle]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const eye = controls.object;
    const settle = () => {
      controls.update();
      invalidate();
    };
    if (prefersReducedMotion()) {
      eye.position.set(...view.position);
      controls.target.set(...view.target);
      settle();
      arrived.current = true;
      return;
    }
    if (!arrived.current && intro) {
      eye.position.set(...intro.position);
      controls.target.set(...intro.target);
    }
    const first = !arrived.current;
    arrived.current = true;
    const position = { x: eye.position.x, y: eye.position.y, z: eye.position.z };
    const target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    const timeline = gsap.timeline({ defaults: { duration: first ? 1.8 : 1.1, ease: EASE.inOut }, onUpdate: settle });
    timeline
      .to(position, {
        x: view.position[0],
        y: view.position[1],
        z: view.position[2],
        onUpdate: () => eye.position.set(position.x, position.y, position.z),
      })
      .to(
        target,
        {
          x: view.target[0],
          y: view.target[1],
          z: view.target[2],
          onUpdate: () => controls.target.set(target.x, target.y, target.z),
        },
        0,
      );
    return () => {
      timeline.kill();
    };
    // The view is described by viewKey; numbers alone shouldn't restart a move mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, invalidate]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}
