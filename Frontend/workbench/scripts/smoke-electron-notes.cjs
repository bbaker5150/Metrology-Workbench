// Run with the installed Electron binary, from the workbench directory:
// node_modules/electron/dist/electron.exe scripts/smoke-electron-notes.cjs
// Uses the real Vite dependency optimizer and editor, not the jsdom mock.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notes-electron-')));
let server;
let window;
let exitCode = 0;
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocxEditor, createDocumentWithText } from '@heyirisai/docx-editor-react';
import { insertImageFromFile } from '@heyirisai/docx-editor-core/prosemirror/commands';
import { CellSelection } from 'prosemirror-tables';
import { Selection } from 'prosemirror-state';
import SessionNotesWorkspace from '/src/modules/uncertainty/features/analysis/components/SessionNotesWorkspace.jsx';
import '@heyirisai/docx-editor-react/styles.css';
window.CellSelection = CellSelection;
window.Selection = Selection;
window.editorRef = React.createRef();
window.root = createRoot(document.getElementById('root'));
window.mountEditor = (buffer) => {
  window.editorReady = false;
  window.root.render(React.createElement(DocxEditor, {
    key: buffer ? 'reopened' : 'initial', ref: window.editorRef,
    ...(buffer ? { documentBuffer: new Uint8Array(buffer) } :
      { document: createDocumentWithText('Electron notes regression') }),
    onEditorViewReady: () => { window.editorReady = true; },
    onError: e => { window.editorFailure = e.message; }
  }));
};
window.mountEditor();
window.mountWorkspace = () => {
  window.root.render(React.createElement(SessionNotesWorkspace, {
    sessionData: { id: 'electron-smoke', name: 'Electron smoke', notes: 'Workspace smoke text' },
    onNotesSave: async () => {},
  }));
};
`;

async function waitForEditor() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await window.webContents.executeJavaScript(
      '({ready: window.editorReady, error: window.editorFailure})',
    );
    if (state.error) throw new Error(state.error);
    if (state.ready) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The real DOCX editor did not become ready in Electron.');
}

app.whenReady().then(async () => {
  const deadline = setTimeout(() => { console.error('Electron Notes smoke test exceeded 90 seconds.'); app.exit(1); }, 90000);
  try {
    const { createServer } = await import('vite');
    server = await createServer({
      server: { host: '127.0.0.1', port: 4193, strictPort: false, open: false },
      plugins: [{
        name: 'electron-notes-smoke-page',
        resolveId(id) {
          if (id === '/__notes-smoke.jsx') return path.resolve('__notes-smoke.jsx').replaceAll('\\', '/');
        },
        load(id) {
          if (id === path.resolve('__notes-smoke.jsx').replaceAll('\\', '/')) return source;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url === '/__notes-smoke') {
              res.setHeader('Content-Type', 'text/html');
              res.end(await vite.transformIndexHtml(req.url,
                '<html><body><div id="root"></div><script type="module" src="/__notes-smoke.jsx"></script></body></html>'));
              return;
            }
            next();
          });
        },
      }],
    });
    await server.listen();
    const address = server.httpServer.address();
    window = new BrowserWindow({ show: false, width: 1280, height: 900,
      webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: false, backgroundThrottling: false, offscreen: true } });
    window.webContents.on('console-message', (event) => {
      const { message } = event;
      if (/Error|failed|Duplicate/i.test(message)) console.error(message);
    });
    await window.loadURL(`http://127.0.0.1:${address.port}/__notes-smoke`);
    await waitForEditor();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const view = window.editorRef.current.getEditorRef().getView();
      view.dispatch(view.state.tr.insertText(' edited', 2));
      const table = view.state.schema.nodes.table.createAndFill();
      const tablePos = view.state.doc.content.size;
      view.dispatch(view.state.tr.insert(tablePos, table));
      const selection = window.CellSelection.create(view.state.doc, tablePos + 2);
      view.dispatch(view.state.tr.setSelection(selection));
      if (!(window.Selection.fromJSON(view.state.doc, selection.toJSON()) instanceof window.CellSelection)) {
        throw new Error('Table selection was registered by a second module instance.');
      }
      const saved = await window.editorRef.current.save({selective: false});
      window.savedNotes = Array.from(new Uint8Array(saved));
      return {text: view.state.doc.textContent, size: window.savedNotes.length};
    })()`);
    assert.match(result.text, / edited/);
    assert.ok(result.size > 100);
    await window.webContents.executeJavaScript('window.mountEditor(window.savedNotes)');
    await waitForEditor();
    const reopened = await window.webContents.executeJavaScript('window.editorRef.current.getEditorRef().getView().state.doc.textContent');
    assert.equal(reopened, result.text);
    await window.webContents.executeJavaScript('window.mountWorkspace()');
    let workspaceReady = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      workspaceReady = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('.session-notes-workspace')) && Boolean(document.querySelector('.ProseMirror')) && document.body.innerText.includes('Workspace smoke text')`,
      );
      if (workspaceReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Let the hidden window composite the newly mounted workspace before capture.
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise(resolve => setTimeout(resolve, 250));
    const screenshot = path.join(os.tmpdir(), 'electron-notes-smoke.png');
    fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
    if (!workspaceReady) console.error(await window.webContents.executeJavaScript(
      `({text:document.body.innerText.slice(-2500),editables:[...document.querySelectorAll('[contenteditable]')].map(e=>e.className)})`,
    ));
    assert.ok(workspaceReady, 'The actual SessionNotesWorkspace must render its note text.');
    console.log(`PASS: Electron ${process.versions.electron}: real Notes editor mounted, edited, selected a table cell, saved ${result.size} DOCX bytes, reopened with matching text, and rendered SessionNotesWorkspace. Screenshot: ${screenshot}`);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(deadline);
    window?.destroy();
    await server?.close();
    app.exit(exitCode);
  }
});
