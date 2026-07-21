import React, { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Stage } from "@react-three/drei";

// ---------------------------------------------------------------------
// HeaderEmblem — the living 3D medallion in the module header brand mark.
// ---------------------------------------------------------------------
// Mirrors the workbench home page's LauncherEmblem recipe (same
// /3demblem.glb + Canvas/Stage lighting) so the brand reads consistently
// across the whole workbench. Kept module-local (rather than importing the
// shell's component) to preserve module isolation. Always gently alive: a
// slow sway keeps the engraved front face toward the viewer, with a soft
// float + breathing tilt. Non-interactive by design.
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
    node.rotation.y = Math.sin(t * 0.6) * 0.32;
    node.rotation.x = Math.sin(t * 0.4) * 0.07;
    node.position.y = Math.sin(t * 1.1) * 0.05;
  });

  return <primitive ref={ref} object={scene} scale={1.7} />;
}

export default function HeaderEmblem() {
  const [modelReady, setModelReady] = useState(false);

  return (
    <div className="app-header-emblem-layers">
      <img
        src="/navair-seal-384.webp"
        alt=""
        width="384"
        height="384"
        className={`app-header-emblem-fallback${modelReady ? " is-ready" : ""}`}
        aria-hidden
      />
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
            <AliveEmblem onReady={() => setModelReady(true)} />
          </Stage>
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/3demblem.glb");
