const { app, BrowserWindow, Menu, MenuItem, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

// -------------------------------------------------------------------
// Theme sync
// Keep the native window chrome, resize/reload paint color, and OS
// title bar aligned with the React app's current theme. The chosen
// theme is persisted to userData so subsequent launches open with the
// correct backgroundColor and don't flash the opposite theme.
// -------------------------------------------------------------------
const THEME_BACKGROUND = {
    // Must match --background-color in App.css for both themes.
    light: '#f5f7fb',
    dark: '#0b1220',
};

function getThemeConfigPath() {
    return path.join(app.getPath('userData'), 'theme.json');
}

function readPersistedTheme() {
    try {
        const raw = fs.readFileSync(getThemeConfigPath(), 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark')) {
            return parsed.theme;
        }
    } catch (_) {
        // file missing or invalid — treat as unset
    }
    return null;
}

function persistTheme(theme) {
    try {
        const filePath = getThemeConfigPath();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ theme }), 'utf-8');
    } catch (err) {
        console.error('Failed to persist theme:', err);
    }
}

function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    nativeTheme.themeSource = theme;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(THEME_BACKGROUND[theme]);
    }
    persistTheme(theme);
}

function resolveInitialTheme() {
    const persisted = readPersistedTheme();
    if (persisted) return persisted;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function createWindow() {
    const initialTheme = resolveInitialTheme();
    // Prime nativeTheme so OS-level chrome (title bar, scrollbars on some
    // platforms, dialogs) matches from the first paint.
    nativeTheme.themeSource = initialTheme;

    // Use a fully frameless window on Windows so we can draw our own
    // minimize / maximize / close buttons inside the React chrome. The
    // renderer reveals them on hover of the top bar and invokes window
    // controls over IPC. macOS keeps its native traffic lights.
    const isWindows = process.platform === 'win32';

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Metrology Workbench",
        icon: path.join(__dirname, 'favicon.ico'),
        autoHideMenuBar: true,
        backgroundColor: THEME_BACKGROUND[initialTheme],
        frame: !isWindows,
        titleBarStyle: isWindows ? 'hidden' : 'default',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            spellcheck: false
        },
    });

    // Forward maximize / unmaximize events to the renderer so the custom
    // caption toggle icon can swap between maximize and restore glyphs.
    const sendMaximizeState = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('window-maximize-state', mainWindow.isMaximized());
    };
    mainWindow.on('maximize', sendMaximizeState);
    mainWindow.on('unmaximize', sendMaximizeState);
    mainWindow.webContents.on('did-finish-load', sendMaximizeState);

    // Apply the default UI zoom once on first load (not on every reload, so a
    // user's manual zoom isn't reset when the renderer reloads in dev).
    let initialZoomApplied = false;
    mainWindow.webContents.on('did-finish-load', () => {
        if (initialZoomApplied) return;
        initialZoomApplied = true;
        mainWindow.webContents.setZoomFactor(0.75);
    });

    const isDev = !app.isPackaged;

    // --- CONTEXT MENU (INSPECT ELEMENT) ---
    mainWindow.webContents.on('context-menu', (event, params) => {
        if (isDev) {
            const menu = new Menu();
            menu.append(new MenuItem({
                label: 'Inspect Element',
                click: () => {
                    mainWindow.webContents.inspectElement(params.x, params.y);
                }
            }));
            menu.popup({ window: mainWindow, x: params.x, y: params.y });
        }
    });

    // --- ZOOM LOGIC ---
    mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
        const currentZoom = mainWindow.webContents.getZoomFactor();
        if (zoomDirection === 'in') {
            mainWindow.webContents.setZoomFactor(currentZoom + 0.1);
        } else {
            mainWindow.webContents.setZoomFactor(Math.max(0.1, currentZoom - 0.1));
        }
    });

    // --- DEVTOOLS HOTKEY ---
    mainWindow.webContents.on('before-input-event', (event, input) => {
        const isDevToolsHotkey = 
            input.key === 'F12' || 
            (input.control && input.shift && input.key.toLowerCase() === 'i');
        if (isDevToolsHotkey) {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    const devPort = process.env.FRONTEND_PORT || '3000';
    const startUrl = isDev
        ? `http://localhost:${devPort}`
        : `file://${path.join(__dirname, '../build/index.html')}`;

    mainWindow.loadURL(startUrl);
    
    if (isDev) mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => (mainWindow = null));
}

ipcMain.on('theme-changed', (event, theme) => {
    applyTheme(theme);
});

// Allow the renderer to read back the theme the main process booted
// with — useful if the React app wants to reconcile its in-memory state
// with what Electron already painted (prevents a mid-load flash).
ipcMain.handle('theme-get', () => {
    return resolveInitialTheme();
});

// -------------------------------------------------------------------
// Custom caption controls — the React header renders its own
// minimize / maximize / close buttons (hover-to-reveal) and asks the
// main process to perform the actual window ops.
// -------------------------------------------------------------------
ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window-maximize-toggle', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});

ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
    return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized();
});

function startBackend() {
    const isDev = !app.isPackaged;
    let backendPath;
    let backendArgs = [];
    let backendDir;

    if (isDev) {
        // Adjust the number of '..' based on where electron.js is. 
        // If in public/electron.js, '..', '..', '..' hits the Root.
        const projectRoot = path.join(__dirname, '..', '..', '..');

        backendDir = path.join(projectRoot, 'Backend', 'ac_shunt');
        backendPath = path.join(projectRoot, 'venv', 'Scripts', 'python.exe');
        backendArgs = ['-u', path.join(backendDir, 'entry_point.py')]; 
    } else {
        backendDir = path.join(process.resourcesPath, 'ac_shunt_backend');
        backendPath = path.join(backendDir, 'ac_shunt_backend.exe');
    }

    console.log("Launching Backend from:", backendPath);

    backendProcess = spawn(backendPath, backendArgs, {
        cwd: backendDir,
        shell: false,
        windowsHide: true
    });

    backendProcess.stdout.on('data', (data) => {
        console.log(`Backend: ${data}`);
    });

    backendProcess.stderr.on('data', (data) => {
        const message = data.toString();
        console.log(`[PYTHON] ${message.trim()}`);
        // if (message.includes('200') || message.includes('CONNECT') || message.includes('HANDSHAKE')) {
        //     console.log(`Backend Log: ${message}`);
        // } else {
        //     console.error(`Backend Error: ${message}`);
        // }
    });

    backendProcess.on('error', (err) => {
        console.error("Backend failed to start:", err);
    });
}

app.on('ready', () => {
    Menu.setApplicationMenu(null);
    // Dev (electron:npm / electron:dev): backend is already started by start:backend in
    // package.json — do not spawn a second process on 8000.
    if (app.isPackaged) {
        startBackend();
        setTimeout(createWindow, 5000);
    } else {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    if (backendProcess) {
        backendProcess.kill();
    }
});
