import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// The React adapter's agents dependency uses a caret range. Version 1.12.0
// bundled its own table-selection implementation, which registers "cell" a
// second time when used with the 1.11.0 editor. A lockfile change alone does
// not replace an existing lab/offline node_modules directory.
const inspectDocxRuntime = (root) => {
  const require = createRequire(path.join(root, 'package.json'));
  const readPackage = (entry) => {
    let directory = path.dirname(entry);
    while (directory !== path.dirname(directory)) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
        if (pkg.name) return { ...pkg, directory };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      directory = path.dirname(directory);
    }
    throw new Error(`Cannot find package metadata for ${entry}`);
  };
  const reactEntry = require.resolve('@heyirisai/docx-editor-react');
  const reactDirectory = readPackage(reactEntry).directory;
  const fromReact = createRequire(reactEntry);
  const expected = require('./package.json').dependencies['@heyirisai/docx-editor-react'];
  const entries = [
    reactEntry,
    require.resolve('@heyirisai/docx-editor-core'),
    fromReact.resolve('@heyirisai/docx-editor-core'),
    fromReact.resolve('@heyirisai/docx-editor-agents/react'),
  ];
  const mismatches = entries.map(readPackage).filter(pkg => pkg.version !== expected);
  return { expected, mismatches, reactDirectory };
};

export function verifyDocxRuntime(root) {
  const { expected, mismatches } = inspectDocxRuntime(root);
  if (mismatches.length) {
    throw new Error(
      `The installed Notes editor dependencies do not match this checkout: ` +
      mismatches.map(pkg => `${pkg.name}@${pkg.version}`).join(', ') +
      `. Expected ${expected}. Stop the app, run "npm run repair:notes" in ` +
      `Frontend/workbench, then restart the same Electron command. This targeted ` +
      `repair does not reinstall Electron or require a network connection.`,
    );
  }
}

export function repairDocxRuntime(root) {
  const { mismatches, reactDirectory } = inspectDocxRuntime(root);
  const nestedRoot = path.resolve(reactDirectory, 'node_modules');
  const removable = new Map();
  mismatches.forEach((pkg) => {
    const directory = path.resolve(pkg.directory);
    if (directory.startsWith(`${nestedRoot}${path.sep}`)) {
      removable.set(directory, pkg);
    }
  });
  removable.forEach((pkg, directory) => {
    try {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
      });
    } catch (error) {
      throw new Error(
        `Could not remove ${pkg.name}@${pkg.version}. Close every running ` +
        `Electron/workbench window and run "npm run repair:notes" again. ` +
        `(${error.message})`,
      );
    }
  });
  verifyDocxRuntime(root);
  return [...removable.values()].map((pkg) => `${pkg.name}@${pkg.version}`);
}

export const docxRuntime = () => ({
  name: 'verified-docx-runtime',
  configResolved(config) {
    verifyDocxRuntime(config.root);
  },
});

export const docxDedupe = [
  '@heyirisai/docx-editor-core',
  '@heyirisai/docx-editor-react',
  'prosemirror-model', 'prosemirror-state', 'prosemirror-view',
  'prosemirror-transform', 'prosemirror-tables', 'prosemirror-keymap',
  'prosemirror-commands', 'prosemirror-history', 'prosemirror-dropcursor',
];

export const docxOptimizeDeps = {
  // Rebuild on server startup so an optimized editor left by an older manual
  // installation cannot survive a source update/restart on the same port.
  force: true,
  include: [
    '@heyirisai/docx-editor-react',
    '@heyirisai/docx-editor-core/prosemirror/commands',
    'prosemirror-state', 'prosemirror-tables',
  ],
};
