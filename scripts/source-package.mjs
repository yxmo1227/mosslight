// Create a standalone source ZIP from explicit, reviewed source directories.
// Dependencies, build products, Foundry records and user saves are never inputs.
import assert from 'node:assert/strict';
import { lstat, readdir, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { resolve, relative, isAbsolute, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const topFiles = ['package.json', 'package-lock.json', 'tsconfig.json', '.npmrc', '.gitignore', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md'];
const sourceDirs = ['src', 'scripts', 'docs', '.github'];
const files = [];
function contained(path) {
  const rel = relative(root, path);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Source path escaped product root');
}
async function add(path) {
  contained(path);
  const stat = await lstat(path);
  assert(!stat.isSymbolicLink(), 'Source links are not allowed');
  if (stat.isDirectory()) {
    const children = await readdir(path);
    for (const child of children.sort()) await add(join(path, child));
    return;
  }
  assert(stat.isFile() && stat.nlink === 1 && stat.size < 2_000_000, 'Unexpected source file');
  const name = relative(root, path).replaceAll('\\', '/');
  assert(!/(^|\/)(AGENTS\.md|PROJECT_BRIEF\.md|\.env.*|node_modules|release|dist|\.foundry|\.git)(\/|$)/i.test(name), 'Private/generated file in source directories');
  assert(topFiles.includes(name) || /\.(ts|mjs|html|css|md|yml|yaml|txt)$/.test(name), 'Unreviewed source file type');
  const bytes = await readFile(path);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString()), 'Private key detected');
  files.push({ name, bytes });
}
for (const name of [...topFiles, ...sourceDirs]) await add(resolve(root, name));
files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
const version = JSON.parse(files.find(file => file.name === 'package.json').bytes.toString()).version;
assert(/^\d+\.\d+\.\d+$/.test(version), 'Invalid version');
const manifest = files.map(file => ({ path: file.name, bytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') }));
files.push({ name: 'SOURCE_MANIFEST.json', bytes: Buffer.from(JSON.stringify({ format: 1, product: 'Mosslight', version, files: manifest }, null, 2) + '\n') });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
const entries = []; const directory = []; let offset = 0;
for (const file of files) {
  const name = Buffer.from(`Mosslight-${version}-source/${file.name}`);
  const compressed = deflateRawSync(file.bytes, { level: 9 });
  const checksum = crc32(file.bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12); // Deterministic ZIP date: 1980-01-01.
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26);
  entries.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(file.bytes.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  directory.push(central, name); offset += local.length + name.length + compressed.length;
}
const central = Buffer.concat(directory); const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...entries, central, end]);
const release = resolve(root, 'release'); contained(release); await mkdir(release, { recursive: true });
assert(!(await lstat(release)).isSymbolicLink(), 'Release directory must not be a link');
const destination = join(release, `Mosslight-${version}-source.zip`);
const temporary = join(release, `source-${randomUUID()}.tmp`);
await writeFile(temporary, archive, { flag: 'wx' }); await rename(temporary, destination);
console.log(JSON.stringify({ file: relative(root, destination), sourceFiles: files.length, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }, null, 2));
