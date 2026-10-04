import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const inventory = path.resolve(process.argv[2] ?? path.join(source, '../../workspace/canonical-services-root'));
const target = path.join(inventory, 'todo-app');
try {
  await access(target);
  throw new Error('todo-app already exists. Keep its data; do not add it again.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(inventory, { recursive: true });
await mkdir(target);
await cp(path.join(source, 'service.json'), path.join(target, 'service.json'));
await cp(path.join(source, 'package.json'), path.join(target, 'package.json'));
await cp(path.join(source, 'package-lock.json'), path.join(target, 'package-lock.json'));
await cp(path.join(source, 'runtime'), path.join(target, 'runtime'), { recursive: true });
console.log(`Added todo-app to ${inventory}. Restart your Lasso instance to discover it, then open its Network URL in Admin.`);
