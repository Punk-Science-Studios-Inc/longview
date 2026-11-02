import { readFileSync } from 'node:fs';
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const version = json('../package.json').version;
const config = json('../src-tauri/tauri.conf.json');
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url),'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (version !== config.version || version !== cargo) throw new Error('package.json, tauri.conf.json, and src-tauri/Cargo.toml versions must match.');
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match application version v${version}.`);
console.log(`Version verified: ${version}`);
