const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

test('the actual NSIS tree preflight accepts normal and empty folders and refuses junctions', { skip: process.platform !== 'win32' }, async t => {
  const desktop = path.resolve(__dirname, '..');
  let compiler = process.env.WINDCHIME_NSIS_TEST_COMPILER;
  if (!compiler) {
    const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis-3.0.4.1');
    for (const entry of await fs.readdir(cache, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(cache, entry.name, 'Bin/makensis.exe');
      if ((await fs.stat(candidate).catch(() => null))?.isFile()) { compiler = candidate; break; }
    }
  }
  if (!compiler) { t.skip('Build the Windows package once, or set WINDCHIME_NSIS_TEST_COMPILER to makensis.exe'); return; }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-readonly-tree-'));
  const source = await fs.readFile(path.join(desktop, 'installer/wizard.nsh'), 'utf8');
  const actualFunction = /^Function un\.WCCheckTree\r?\n[\s\S]*?^FunctionEnd\r?$/m.exec(source)?.[0];
  assert(actualFunction, 'Uninstall tree preflight must be available for direct testing');
  // Run the actual read-only production function, not a second JS implementation.
  // Refuse to build this fixture if future changes introduce mutation commands.
  const body = actualFunction.replaceAll('un.WCCheckTree', 'FixtureCheckTree');
  assert(!/^\s*(?:Delete|RMDir|Rename|CopyFiles|Exec\w*|Write\w*|File\w*|CreateDirectory|SetOutPath|Reboot)\s/m.test(body), 'The extracted tree check must stay read-only');
  for (const match of body.matchAll(/System::Call\s+'([^']+)'/g)) assert(/^kernel32::(?:GetFileAttributesW|FindFirstFileW|FindNextFileW|FindClose)\(/.test(match[1]) || match[1] === '*$6(&w260 .r2)', 'The fixture permits only read-only Windows calls');
  const output = path.join(temporary, 'TreePreflightFixture.exe');
  const { nsisEscapeString } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
  const script = `Unicode true\nName "WindChime read-only directory fixture"\nOutFile "${nsisEscapeString(output)}"\nRequestExecutionLevel user\nSilentInstall silent\nAutoCloseWindow true\n!include LogicLib.nsh\nVar WCUnValidationError\nVar WCUnDepth\nVar WCUnSeen\n${body}\nSection\nReadEnvStr $0 "WINDCHIME_TREE_TEST_ROOT"\nStrCpy $WCUnValidationError ""\nStrCpy $WCUnDepth 0\nStrCpy $WCUnSeen 0\nPush $0\nCall FixtureCheckTree\nFileOpen $1 "$EXEDIR\\result.txt" w\nFileWriteUTF16LE $1 "$WCUnValidationError$\\r$\\n"\nFileClose $1\nStrCmp $WCUnValidationError "" good bad\nbad:\nSetErrorLevel 87\nQuit\ngood:\nSetErrorLevel 0\nQuit\nSectionEnd\n`;
  const nsi = path.join(temporary, 'tree-fixture.nsi'); await fs.writeFile(nsi, script);
  await exec(compiler, ['-WX', '-INPUTCHARSET', 'UTF8', nsi], {
    windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NSISDIR: path.dirname(path.dirname(compiler)) },
  });
  const normal = path.join(temporary, '正常 程序'), empty = path.join(temporary, 'empty'), linked = path.join(temporary, 'linked');
  await fs.mkdir(path.join(normal, 'resources', 'empty-child'), { recursive: true });
  await fs.writeFile(path.join(normal, 'resources/app.asar'), 'synthetic ASAR placeholder');
  const sentinel = Buffer.from('synthetic license content must be unchanged');
  await fs.writeFile(path.join(normal, 'LICENSE'), sentinel);
  await fs.mkdir(empty); await fs.mkdir(linked);
  await fs.symlink(normal, path.join(linked, 'redirected-resources'), 'junction');
  const rootLink = path.join(temporary, 'linked-root'); await fs.symlink(normal, rootLink, 'junction');
  const cases = [[normal, 0], [empty, 0], [linked, 87], [rootLink, 87], [path.join(temporary, 'missing'), 87]];
  const results = [];
  for (const [directory, expected] of cases) {
    let exit = 0;
    try { await exec(output, [], { windowsHide: true, timeout: 10000, env: { ...process.env, WINDCHIME_TREE_TEST_ROOT: directory } }); }
    catch (error) { assert.equal(typeof error.code, 'number', 'Read-only fixture must exit normally'); exit = error.code; }
    const errorText = (await fs.readFile(path.join(temporary, 'result.txt'), 'utf16le')).replace(/^\uFEFF/, '').trim();
    results.push({ directory: path.basename(directory), exit, error: errorText });
    assert.equal(exit, expected, `Unexpected preflight result for ${path.basename(directory)}: ${errorText}`);
    assert.equal(Boolean(errorText), expected !== 0);
  }
  assert((await fs.readFile(path.join(normal, 'LICENSE'))).equals(sentinel));
  assert.deepEqual(await fs.readdir(empty), []);
  const report = { passed: true, compiler, temporary, fixtureOnly: true, executedInstaller: false, registeredApplication: false, results };
  await fs.writeFile(path.join(temporary, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  t.diagnostic(JSON.stringify(report));
});
