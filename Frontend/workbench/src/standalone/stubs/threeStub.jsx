import React from 'react';

// ---------------------------------------------------------------------------
// Stand-in for @react-three/fiber and @react-three/drei in the single-file
// build.
// ---------------------------------------------------------------------------
// The header medallion loads 3demblem.glb with useGLTF, which is a *runtime
// fetch*. A single-file build has no URL to fetch from — everything must be
// inlined — so the 3D emblem cannot work there by construction.
//
// HeaderEmblem already renders a static navair-seal-384.webp behind the canvas
// and only fades it out once the model reports ready. With this stub the model
// never reports ready, so the static seal simply stays: the header still looks
// right, just without the slow sway.
//
// Aliasing the packages away (rather than branching inside the component) also
// keeps three.js out of the bundle entirely, which is around a megabyte we
// would otherwise be inlining as base64 for no visible benefit.

/** Renders nothing; the static fallback image shows through. */
export function Canvas() {
  return null;
}

export function useFrame() {}

export function useGLTF() {
  return { scene: null };
}
useGLTF.preload = () => {};

export function Stage({ children }) {
  return <>{children}</>;
}

export function Environment() {
  return null;
}

export function OrbitControls() {
  return null;
}

export function PerspectiveCamera() {
  return null;
}

export default { Canvas, useFrame, useGLTF, Stage, Environment, OrbitControls, PerspectiveCamera };
