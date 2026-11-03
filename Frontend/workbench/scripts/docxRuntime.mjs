import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

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

// The React adapter's agents dependency uses a caret range. Version 1.12.0
// bundled its own table-selection implementation, which registers "cell" a
// second time when used with the 1.11.0 editor. A lockfile change alone does
// not replace an existing lab/offline node_modules directory.
const inspectDocxRuntime = (root) => {
  const require = createRequire(path.join(root, 'package.json'));
  const reactEntry = require.resolve('@heyirisai/docx-editor-react');
  const reactDirectory = readPackage(reactEntry).directory;
  const fromReact = createRequire(reactEntry);
  const expected = require('./package.json').dependencies['@heyirisai/docx-editor-react'];
  const entries = [
    reactEntry,
    require.resolve('@heyirisai/docx-editor-core'),
    fromReact.resolve('@heyirisai/docx-editor-core'),
    fromReact.resolve('@heyirisai/docx-editor-agents/react'),
    fromReact.resolve('@heyirisai/docx-editor-i18n'),
  ];
  const packages = entries.map(readPackage);
  const mismatches = packages.filter(pkg => pkg.version !== expected);
  return { expected, mismatches, reactDirectory, packages };
};

export function verifyDocxRuntime(root) {
  const { expected, mismatches, packages } = inspectDocxRuntime(root);
  if (mismatches.length) {
    throw new Error(
      `The installed Notes editor dependencies do not match this checkout: ` +
      mismatches.map(pkg => `${pkg.name}@${pkg.version}`).join(', ') +
      `. Expected ${expected}. Stop the app and run "npm install" in Frontend/workbench ` +
      `after updating this checkout. For leftover nested copies, run "npm run repair:notes", ` +
      `then restart the same Electron command. The targeted repair needs no network connection.`,
    );
  }
  return packages;
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

// An offline repair can replace a distribution without changing package-lock.
// Include the actual installed editor files in Vite's dependency cache key.
function installedEditorHash(root, packages) {
  const hash = createHash('sha256');
  const visit = directory => {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (/\.(?:[mc]?js|json|css)$/.test(entry.name)) {
        hash.update(filename).update('\0').update(readFileSync(filename)).update('\0');
      }
    }
  };
  const directories = new Set(packages.map(pkg => pkg.directory));
  // Offline layouts may have peers only beside the importing editor package.
  // Fingerprint the copies present without making hoisted peers mandatory.
  for (const origin of [root, ...directories]) {
    const require = createRequire(path.join(origin, 'package.json'));
    for (const name of docxDedupe) {
      const entry = name === '@heyirisai/docx-editor-agents' ? name + '/react' : name;
      try {
        directories.add(readPackage(require.resolve(entry)).directory);
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      }
    }
  }
  for (const directory of directories) visit(directory);
  return hash.digest('hex');
}

export const docxRuntime = ({ reuseOptimizer = false } = {}) => ({
  name: 'verified-docx-runtime',
  config(config, { command }) {
    const root = path.resolve(config.root || process.cwd());
    const packages = verifyDocxRuntime(root);
    if (command === 'serve' && reuseOptimizer) {
      const define = { __WORKBENCH_NOTES_RUNTIME_HASH__: JSON.stringify(installedEditorHash(root, packages)) };
      return { optimizeDeps: { esbuildOptions: { define } } };
    }
  },
});

export const docxDedupe = [
  '@heyirisai/docx-editor-core',
  '@heyirisai/docx-editor-react',
  '@heyirisai/docx-editor-agents',
  '@heyirisai/docx-editor-i18n',
  'prosemirror-model', 'prosemirror-state', 'prosemirror-view',
  'prosemirror-transform', 'prosemirror-tables', 'prosemirror-keymap',
  'prosemirror-commands', 'prosemirror-history', 'prosemirror-dropcursor',
];

export const docxOptimizeDeps = {
  include: [
    '@heyirisai/docx-editor-react',
    '@heyirisai/docx-editor-core/prosemirror/commands',
    'prosemirror-state', 'prosemirror-tables',
  ],
};
