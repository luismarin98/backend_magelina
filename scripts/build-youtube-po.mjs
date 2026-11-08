// Compile the pinned, still-open upstream PR #229 against the installed SABR plugin.
// Kept separate because this is experimental, not an upstream release.
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = resolve(root, '.tools/lavalink');
const source = resolve(tools, 'youtube-source-po');
const revision = '1ddb648257d5b547aa1e2dfb8104edf6cb1089be';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== revision) throw new Error('La revision del PR no coincide.');
const classes = resolve(tools, `po-classes-${revision}`), serverClasses = resolve(tools, 'probe-server-classes');
await mkdir(classes, { recursive: true }); await mkdir(serverClasses, { recursive: true });
const quote = value => `'${value.replaceAll("'", "''")}'`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$probeArchive=[System.IO.Compression.ZipFile]::OpenRead(${quote(resolve(tools, 'Lavalink.jar'))})
try { foreach ($probeEntry in $probeArchive.Entries) { if ($probeEntry.FullName -match '^BOOT-INF/classes/([a-zA-Z0-9_$/.-]+[.]class)$' -and !$Matches[1].Contains('..')) { $probeTarget=Join-Path ${quote(serverClasses)} $Matches[1]; [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($probeTarget)) | Out-Null; [System.IO.Compression.ZipFileExtensions]::ExtractToFile($probeEntry,$probeTarget,$true) } } } finally { $probeArchive.Dispose() }`], { windowsHide: true });
async function files(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name), extension) : entry.name.endsWith(extension) ? [resolve(directory, entry.name)] : []))).flat();
}
const plugin = resolve(tools, 'plugins/youtube-plugin.jar');
const classpath = [serverClasses, ...(await files(resolve(tools, 'probe-libs'), '.jar')), plugin].join(';');
const sources = (await Promise.all(['common', 'v2', 'plugin'].map(module => files(resolve(source, module, 'src/main/java'), '.java')))).flat();
const argsFile = resolve(tools, 'po-compile.args');
await writeFile(argsFile, ['-21', '-nowarn', '-cp', JSON.stringify(classpath.replaceAll('\\', '/')), '-d', JSON.stringify(classes.replaceAll('\\', '/')), ...sources.map(file => JSON.stringify(file.replaceAll('\\', '/')))].join('\n'));
const runtime = JSON.parse(await readFile(resolve(tools, 'runtime.json'), 'utf8'));
try { execFileSync(runtime.java, ['-jar', resolve(tools, 'ecj-3.40.0.jar'), `@${argsFile}`], { windowsHide: true, stdio: 'pipe' }); }
catch (error) { console.error(error.stderr?.toString().slice(-6000)); throw new Error('No se pudo compilar el PR de tokens PO.'); }
await mkdir(resolve(tools, 'plugin-backups'), { recursive: true });
await copyFile(plugin, resolve(tools, 'plugin-backups/youtube-plugin-sabr.jar'));
execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$probeArchive=[System.IO.Compression.ZipFile]::Open(${quote(plugin)},[System.IO.Compression.ZipArchiveMode]::Update)
try { Get-ChildItem -LiteralPath ${quote(classes)} -Recurse -File -Filter '*.class' | ForEach-Object { $probeName=$_.FullName.Substring(${classes.length + 1}).Replace('\\','/'); $probeOld=$probeArchive.GetEntry($probeName); if ($probeOld) { $probeOld.Delete() }; [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($probeArchive,$_.FullName,$probeName) | Out-Null } } finally { $probeArchive.Dispose() }`], { windowsHide: true });
await writeFile(resolve(tools, 'po-build.json'), JSON.stringify({ revision, base: runtime.versions.youtube }));
console.log(`Plugin experimental compilado localmente desde el PR #229: ${revision}.`);
