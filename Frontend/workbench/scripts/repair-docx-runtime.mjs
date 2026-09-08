import process from 'node:process';
import { repairDocxRuntime } from './docxRuntime.mjs';

try {
  const removed = repairDocxRuntime(process.cwd());
  if (removed.length) {
    console.log(`Notes editor repaired: removed ${removed.join(', ')}.`);
  } else {
    console.log('Notes editor dependencies are already consistent.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
