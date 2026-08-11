import React, { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Stage } from "@react-three/drei";
import EMBLEM_FALLBACK from "../../../assets/navair-seal-384.webp";

// The 3D model is fetched at runtime by useGLTF, so it has to stay a URL, and
// it is addressed through Vite's configured base rather than a leading "/".
// An absolute path only resolves when the app is served from the server root —
// true for the dev server and Electron's file:// load, false when the built
// bundle is hosted in a document library subfolder. BASE_URL is "./" in the
// SharePoint builds, so this is the same URL as before wherever the app
// already worked.
//
// The still seal underneath is imported instead of addressed, because a build
// destined for an `<iframe srcdoc>` has no URL to resolve against at all. As a
// module asset it is emitted with the rest of the bundle — hashed in the normal
// builds, inlined as a data URI in the single-file one.
const EMBLEM_MODEL = `${import.meta.env.BASE_URL}3demblem.glb`;

// ---------------------------------------------------------------------
// HeaderEmblem — the living 3D medallion in the module header brand mark.
// ---------------------------------------------------------------------
// Mirrors the workbench home page's LauncherEmblem recipe (same
// 3demblem.glb + Canvas/Stage lighting) so the brand reads consistently
// across the whole workbench. Kept module-local (rather than importing the
// shell's component) to preserve module isolation. Always gently alive: a
// slow sway keeps the engraved front face toward the viewer, with a soft
// float + breathing tilt. Non-interactive by design.
// ---------------------------------------------------------------------
function AliveEmblem({ onReady }) {
  const { scene } = useGLTF(EMBLEM_MODEL);
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
        src={EMBLEM_FALLBACK}
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

useGLTF.preload(EMBLEM_MODEL);
