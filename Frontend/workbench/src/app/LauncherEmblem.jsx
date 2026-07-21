import React, { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Stage } from "@react-three/drei";

// ---------------------------------------------------------------------
// LauncherEmblem — the living 3D medallion on the workbench home page.
// ---------------------------------------------------------------------
// Reuses the same /3demblem.glb + Canvas/Stage lighting recipe as the
// AC-Shunt header (App.jsx) so the brand reads consistently. Unlike the
// header coin — which only animates while a calibration is active — this
// one is *always* gently alive: a slow sway keeps the engraved front face
// toward the viewer (the medallion's back is blank), with a soft float and
// breathing tilt so it never looks static. Non-interactive by design.
// ---------------------------------------------------------------------
function AliveEmblem({ onReady }) {
  const { scene } = useGLTF("/3demblem.glb");
  const ref = useRef();

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useFrame((state) => {
    const node = ref.current;
    if (!node) return;
    const t = state.clock.elapsedTime;
    // Keep the front face dominant; deeper yaw exposes the model's dark back
    // disk against dark-mode backgrounds.
    node.rotation.y = Math.sin(t * 0.6) * 0.34;
    // Subtle vertical tilt + float for a "floating in light" feel.
    node.rotation.x = Math.sin(t * 0.4) * 0.07;
    node.position.y = Math.sin(t * 1.1) * 0.05;
  });

  return <primitive ref={ref} object={scene} scale={1.7} />;
}

export default function LauncherEmblem({ onReady }) {
  // gl alpha:true keeps the canvas transparent so the page background /
  // CSS glow show through behind the medallion.
  return (
    <Canvas
      camera={{ position: [0, 0, 4.5], fov: 45 }}
      gl={{ alpha: true }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[5, 5, 5]} intensity={2.1} />
      <directionalLight position={[-4, 2, 4]} intensity={0.8} />
      <Suspense fallback={null}>
        <Stage
          environment={null}
          intensity={0.75}
          adjustCamera={false}
          shadows={false}
        >
          <AliveEmblem onReady={onReady} />
        </Stage>
      </Suspense>
    </Canvas>
  );
}
