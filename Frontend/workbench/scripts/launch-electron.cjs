const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const workbenchRoot = path.resolve(__dirname, '..');
const electronDist = path.join(workbenchRoot, 'node_modules', 'electron', 'dist');

const executableByPlatform = {
  win32: path.join(electronDist, 'electron.exe'),
  linux: path.join(electronDist, 'electron'),
  darwin: path.join(
    electronDist,
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron',
  ),
};

const executable = executableByPlatform[process.platform];

if (!executable || !fs.existsSync(executable)) {
  console.error(
    `Electron runtime not found at ${executable || electronDist}. ` +
      'Install Electron or place the offline Electron dist folder under ' +
      'Frontend/workbench/node_modules/electron/dist.',
  );
  process.exit(1);
}

if (process.argv.includes('--check')) {
  console.log(`Electron runtime found: ${executable}`);
  process.exit(0);
}

// Launch the binary directly so offline/manual lab installations do not
// depend on Electron's postinstall-generated path.txt metadata. Keep this
// small parent process alive so concurrently can still observe Electron's
// real exit code and shut down the development servers with it.
const child = spawn(executable, ['.'], {
  cwd: workbenchRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!child.killed) child.kill();
  });
}

child.on('error', (error) => {
  console.error(`Electron failed to start: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron stopped by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
