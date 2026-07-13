import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'generated');
const to = path.join(root, 'dist', 'generated');

rmSync(to, { recursive: true, force: true });
mkdirSync(path.dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
