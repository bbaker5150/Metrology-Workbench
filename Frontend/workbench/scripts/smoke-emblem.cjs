// Compare the original and optimized asset with identical camera/materials.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const assert = require("node:assert/strict");
app.on("window-all-closed", () => {});
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "emblem-ui-")));
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
const source = `
import React, {Suspense, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame} from '@react-three/fiber';
import {Stage, useGLTF} from '@react-three/drei';
const file = new URLSearchParams(location.search).get('asset');
const start = performance.now();
function Model() {
 const {scene} = useGLTF('/'+file); const ready = useRef(false);
 useFrame(({gl})=>{ if(!ready.current) { ready.current=true; requestAnimationFrame(()=>{ window.emblemResult={ms:performance.now()-start, triangles:gl.info.render.triangles}; }); } });
 return <primitive object={scene} scale={1.7}/>;
}
createRoot(document.getElementById('root')).render(<Canvas camera={{position:[0,0,4.5],fov:45}} gl={{alpha:true,preserveDrawingBuffer:true}} dpr={1}><ambientLight intensity={0.9}/><directionalLight position={[5,5,5]} intensity={2.1}/><directionalLight position={[-4,2,4]} intensity={0.8}/><Suspense fallback={null}><Stage environment={null} intensity={0.75} adjustCamera={false} shadows={false}><Model/></Stage></Suspense></Canvas>);
`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let server,
    win,
    status = 0;
  const deadline = setTimeout(() => app.exit(1), 120000);
  try {
    const { createServer } = await import("vite");
    const virtual = path.resolve("__emblem-smoke.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), "emblem-vite-")),
      server: { host: "127.0.0.1", port: 4202, strictPort: false, open: false },
      plugins: [
        {
          name: "emblem-smoke",
          resolveId: (id) =>
            id === "/__emblem-smoke.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (!req.url.startsWith("/__emblem-smoke?")) return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body style="margin:0;background:#0e1726"><div id="root" style="width:480px;height:480px"></div><script type="module" src="/__emblem-smoke.jsx"></script></body></html>',
                ),
              );
            });
          },
        },
      ],
    });
    await server.listen();
    win = new BrowserWindow({
      show: false,
      width: 480,
      height: 480,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    const results = {};
    for (const asset of ["3demblem.glb", "3demblem-optimized.glb"]) {
      await win.loadURL(
        "http://127.0.0.1:" +
          server.httpServer.address().port +
          "/__emblem-smoke?asset=" +
          asset,
      );
      for (let i = 0; i < 500; i++) {
        if (
          await win.webContents.executeJavaScript(
            "Boolean(window.emblemResult)",
          )
        )
          break;
        await pause(100);
      }
      results[asset] = await win.webContents.executeJavaScript(
        "window.emblemResult",
      );
      assert.ok(results[asset]?.triangles > 0, "Model rendered: " + asset);
      await pause(300);
      fs.writeFileSync(
        path.join(os.tmpdir(), asset + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      if (
        process.env.WRITE_EMBLEM_PREVIEW === "1" &&
        asset.includes("optimized")
      ) {
        const preview = await win.webContents.executeJavaScript(
          "document.querySelector('canvas').toDataURL('image/webp',0.92)",
        );
        fs.writeFileSync(
          path.resolve("src/assets/emblem-preview.webp"),
          Buffer.from(preview.split(",")[1], "base64"),
        );
      }
    }
    assert.ok(
      results["3demblem-optimized.glb"].triangles <
        results["3demblem.glb"].triangles,
    );
    console.log("PASS emblem render comparison", JSON.stringify(results));
  } catch (error) {
    console.error(error);
    status = 1;
  } finally {
    clearTimeout(deadline);
    win?.destroy();
    await server?.close();
    app.exit(status);
  }
});
