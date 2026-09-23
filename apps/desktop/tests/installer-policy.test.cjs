const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const desktop = path.resolve(__dirname, '..');

// Compile the real installer source as a library, then call only InstallPolicy
// under the same .NET Framework runtime as the published WPF setup. Neither its
// Main/Run method nor the embedded installer is ever called. Registry access is
// read-only; every filesystem fixture lives in this run's unique temporary tree.
describe('Windows installer destination and confirmation protocol', { skip: process.platform !== 'win32' }, () => {
  let temporary, library, rootDrive;
  before(async () => {
    // Windows CI may expose TEMP through an 8.3 alias (for example RUNNER~1).
    // Resolve the existing fixture independently of InstallPolicy so exact path
    // assertions compare canonical names while the alias tests remain intact.
    temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-installer-policy-')));
    rootDrive = path.parse(temporary).root;
    library = path.join(temporary, 'InstallPolicy.dll');
    const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319');
    await exec(path.join(framework, 'csc.exe'), [
      '/nologo', '/target:library', '/platform:x64', '/out:' + library,
      '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Xaml.dll',
      '/reference:System.Web.Extensions.dll', '/reference:System.Windows.Forms.dll',
      ...['WindowsBase', 'PresentationCore', 'PresentationFramework'].map(name => '/reference:' + path.join(framework, 'WPF', name + '.dll')),
      path.join(desktop, 'installer/GlassSetup.cs'),
      path.join(desktop, 'installer/FolderPicker.cs'),
      path.join(desktop, 'installer/InstallTransaction.cs'),
      path.join(desktop, 'installer/InstallMetadata.cs'),
    ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  });

  async function policy(operations) {
    const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = $env:WINDCHIME_INSTALLER_POLICY_TEST | ConvertFrom-Json
[void][System.Reflection.Assembly]::LoadFrom($request.library)
$results = @()
foreach ($operation in $request.operations) {
  try {
    $value = $null
    switch ($operation.kind) {
      'normalize' { $value = [WindChime.Setup.InstallPolicy]::NormalizeDirectory($operation.input) }
      'within' { $value = [WindChime.Setup.InstallPolicy]::Within($operation.input, $operation.root) }
      'same' { $value = [WindChime.Setup.InstallPolicy]::SamePath($operation.input, $operation.root) }
      'short' {
        Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class ShortNameFixture{[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern uint GetShortPathName(string input,StringBuilder output,int size);public static string Read(string path){var value=new StringBuilder(32768);return GetShortPathName(path,value,value.Capacity)>0?value.ToString():path;}}'
        $value = [ShortNameFixture]::Read($operation.input)
      }
      'payload' { $value = [WindChime.Setup.InstallPolicy]::PayloadPath($operation.root, $operation.input) }
      'validate' { [WindChime.Setup.InstallPolicy]::ValidateDirectory($operation.input); $value = $true }
      'marker' { $value = [WindChime.Setup.InstallPolicy]::HasInstallMarker($operation.input) }
      'identity' { $value = [pscustomobject]@{appId=[WindChime.Setup.InstallPolicy]::AppId;registryId=[WindChime.Setup.InstallPolicy]::RegistryId} }
      'request' { $value = [WindChime.Setup.InstallPolicy]::CreateRequest($operation.input, $operation.transaction, $operation.token) }
      default { throw 'Unknown policy fixture operation' }
    }
    $results += [pscustomobject]@{ok=$true; value=$value}
  } catch {
    $caughtException = $_.Exception
    while ($null -ne $caughtException.InnerException) { $caughtException = $caughtException.InnerException }
    $results += [pscustomobject]@{ok=$false; type=$caughtException.GetType().FullName; message=$caughtException.Message}
  }
}
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
`;
    const shell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await exec(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, WINDCHIME_INSTALLER_POLICY_TEST: JSON.stringify({ library, operations }) },
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }

  test('absolute choices keep their drive, Unicode and an exactly-once application folder', async () => {
    const cases = [
      [path.join(rootDrive, 'Applications'), path.join(rootDrive, 'Applications', 'WindChime')],
      [path.join(rootDrive, 'Applications', 'WindChime') + '\\', path.join(rootDrive, 'Applications', 'WindChime')],
      [path.join(rootDrive, 'Applications', 'windchime'), path.join(rootDrive, 'Applications', 'windchime')],
      ['  ' + path.join(rootDrive, '应用 程序') + '  ', path.join(rootDrive, '应用 程序', 'WindChime')],
      [rootDrive, path.join(rootDrive, 'WindChime')],
    ];
    const results = await policy(cases.map(([input]) => ({ kind: 'normalize', input })));
    results.forEach((result, i) => { assert(result.ok, cases[i][0]); assert.equal(result.value, cases[i][1]); assert(path.win32.isAbsolute(result.value)); });
  });

  test('ambiguous drive-relative, remote, device and injected directory inputs are refused', async () => {
    const inputs = [null, '', ' ', '.', 'WindChime', rootDrive.slice(0, 2) + 'relative', '\\relative',
      '\\\\server\\share\\WindChime', '\\\\?\\' + rootDrive + 'Applications',
      path.join(rootDrive, 'bad"path'), path.join(rootDrive, 'bad\tpath'), path.join(rootDrive, 'bad\0path'),
      path.join(rootDrive, 'safe') + '\r\n[WindChime]\r\nDesktop=1',
    ];
    const results = await policy(inputs.map(input => ({ kind: 'normalize', input })));
    results.forEach((result, i) => assert.equal(result.ok, false, `Accepted ambiguous/injected input at index ${i}`));
  });

  test('containment respects directory boundaries, case and normalized parent traversal', async () => {
    const base = path.join(temporary, 'WindChime');
    const cases = [[base, true], [path.join(base, 'resources/app.asar'), true], [base.toUpperCase(), true],
      [base + '-Other', false], [base + '\\..\\Other\\app.asar', false]];
    const results = await policy(cases.map(([input]) => ({ kind: 'within', input, root: base })));
    results.forEach((result, i) => { assert(result.ok); assert.equal(result.value, cases[i][1]); });
    assert.equal((await policy([{ kind: 'within', input: base, root: '' }]))[0].value, false);
  });

  test('registered locations and shortcuts treat existing DOS aliases as the same path', async t => {
    const directory=path.join(temporary,'Long installed location fixture','WindChime');await fs.mkdir(directory,{recursive:true});
    const alias=(await policy([{kind:'short',input:directory}]))[0];assert(alias.ok);
    const results=await policy([{kind:'same',input:alias.value,root:directory},{kind:'same',input:path.join(alias.value,'WindChime.exe'),root:path.join(directory,'WindChime.exe')},{kind:'normalize',input:alias.value}]);
    assert.equal(results[0].value,true);assert.equal(results[1].value,true);assert.equal(results[2].value,directory);
    if(!alias.value.includes('~'))t.diagnostic('This Windows volume returned no shortened alias; canonical equality verified without assuming 8.3 creation is enabled.');
  });

  test('runtime verification paths cannot escape, alias a stream or name an absolute file', async () => {
    const base = path.join(temporary, 'payload', 'WindChime');
    const safe = await policy(['resources/app.asar', 'resources\\windchime-install.ini'].map(input => ({ kind: 'payload', root: base, input })));
    assert.deepEqual(safe.map(item => item.value), [path.join(base, 'resources/app.asar'), path.join(base, 'resources/windchime-install.ini')]);
    const inputs = ['', '.', '..', '../outside', 'resources/../../outside', '/absolute', path.join(rootDrive, 'outside'),
      'resources//app.asar', 'resources/./app.asar', 'resources/app.asar:alternate', 'resources\0/app.asar'];
    const results = await policy(inputs.map(input => ({ kind: 'payload', root: base, input })));
    results.forEach((result, i) => assert.equal(result.ok, false, `Accepted unsafe payload path at index ${i}`));
  });

  test('destination validation is read-only and refuses unrelated files or a forged standalone marker', async () => {
    const empty = path.join(temporary, 'empty', 'WindChime'), fresh = path.join(temporary, 'new', 'WindChime');
    const occupied = path.join(temporary, 'occupied', 'WindChime');
    await fs.mkdir(empty, { recursive: true }); await fs.mkdir(path.join(occupied, 'resources'), { recursive: true });
    const sentinel = Buffer.from('existing unrelated data must remain byte-identical');
    await fs.writeFile(path.join(occupied, 'private-data.txt'), sentinel);
    await fs.writeFile(path.join(occupied, 'resources/windchime-install.ini'), '[WindChime]\r\nAppId=org.windchime.desktop\r\n');
    const results = await policy([empty, fresh, occupied].map(input => ({ kind: 'validate', input })));
    assert.deepEqual(results.map(item => item.ok), [true, true, false]);
    assert.deepEqual(await fs.readdir(empty), []); await assert.rejects(fs.stat(fresh), { code: 'ENOENT' });
    assert((await fs.readFile(path.join(occupied, 'private-data.txt'))).equals(sentinel));
    assert.deepEqual((await fs.readdir(occupied)).sort(), ['private-data.txt', 'resources']);
  });

  test('known credential, legacy and Windows directories are protected without touching them', async () => {
    const local = process.env.LOCALAPPDATA, roaming = process.env.APPDATA, windows = process.env.WINDIR || 'C:\\Windows';
    assert(local && roaming);
    const inputs = [path.join(local, 'WindChime'), path.join(local, 'WindChime', 'new', 'WindChime'),
      path.join(roaming, 'WindChime'), path.join(roaming, 'new', 'WindChime'), path.join(windows, 'new', 'WindChime')];
    const results = await policy(inputs.map(input => ({ kind: 'validate', input })));
    results.forEach(result => assert.equal(result.ok, false));
  });

  test('junction ancestors cannot redirect a new installation to a different directory', async () => {
    const target = path.join(temporary, 'junction-target'), link = path.join(temporary, 'junction-link');
    await fs.mkdir(target); await fs.symlink(target, link, 'junction');
    const results = await policy([{ kind: 'validate', input: path.join(link, 'WindChime') }]);
    assert.equal(results[0].ok, false); assert.deepEqual(await fs.readdir(target), []);
  });

  test('the upgrade marker identifies this application and does not follow a resources junction', async () => {
    const values = [
      ['', false],
      ['[WindChime]\r\nAppId=some.other.application\r\n', false],
      ['[OtherSection]\r\nAppId=org.windchime.desktop\r\n', false],
      ['[WindChime]\r\nAppId=org.windchime.desktop\r\nVersion=0.8.1\r\n', true],
    ];
    const roots = [];
    for (let index = 0; index < values.length; index++) {
      const directory = path.join(temporary, `marker-${index}`, 'WindChime'); roots.push(directory);
      await fs.mkdir(path.join(directory, 'resources'), { recursive: true });
      if (values[index][0]) await fs.writeFile(path.join(directory, 'resources/windchime-install.ini'), '\uFEFF' + values[index][0], 'utf16le');
    }
    const redirected = path.join(temporary, 'marker-redirect', 'WindChime');
    await fs.mkdir(redirected, { recursive: true });
    await fs.symlink(path.join(roots.at(-1), 'resources'), path.join(redirected, 'resources'), 'junction');
    const results = await policy([...roots, redirected].map(input => ({ kind: 'marker', input })));
    assert(results.every(result => result.ok)); assert.deepEqual(results.map(result => result.value), [...values.map(value => value[1]), false]);
  });

  test('WPF and the installed engine agree on the application identity and registry namespace', async () => {
    const { installerConfig } = require('../installer.config.cjs');
    const { UUID } = require('builder-util-runtime');
    const configuration = installerConfig(desktop, path.join(temporary, 'not-built'));
    const identity = (await policy([{ kind: 'identity' }]))[0]; assert(identity.ok);
    assert.equal(identity.value.appId, configuration.appId);
    // Match electron-builder's real namespace algorithm rather than maintaining
    // another copied hard-coded GUID. A mismatch silently loses upgrade lookup.
    const guid = configuration.nsis.guid || UUID.v5(configuration.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    assert.equal(identity.value.registryId, guid);
  });

  test('private staging request survives the real Windows INI parser with exact scope and Unicode', async () => {
    const directory = path.join(temporary, '中文 空格=测试'), token = '0123456789abcdef0123456789abcdef';
    const variants = ['0','1','2','3'].map(n=>n.repeat(32));
    const stage = id => path.join(directory,'.WindChime-Setup-'+id,'new');
    const results = await policy(variants.map(transaction => ({ kind: 'request', input: stage(transaction), token, transaction })));
    for (let index = 0; index < results.length; index++) {
      assert(results[index].ok, 'InstallPolicy.CreateRequest must serialize the confirmed request');
      await fs.writeFile(path.join(temporary, `request-${index}.ini`), '\uFEFF' + results[index].value, 'utf16le');
    }
    // The engine's ReadINIStr uses this Windows API rather than a JS INI parser.
    const parser = String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class IniFixture { [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetPrivateProfileString(string section,string key,string fallback,StringBuilder result,uint size,string path); public static string Read(string path,string key) { var output=new StringBuilder(32768);GetPrivateProfileString("WindChime",key,"<missing>",output,32768,path);return output.ToString();} }'
$results=@(); foreach($index in 0..3) { $file=Join-Path $env:WINDCHIME_INI_FIXTURE ("request-"+$index+".ini");$row=@{};foreach($key in @('Protocol','AppId','Token','Transaction','Stage')){$row[$key]=[IniFixture]::Read($file,$key)};$results+=$row };ConvertTo-Json -InputObject @($results) -Compress
`;
    const { stdout } = await exec(path.join(process.env.WINDIR || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', parser], {
      windowsHide: true, timeout: 30000, env: { ...process.env, WINDCHIME_INI_FIXTURE: temporary },
    });
    const parsed = JSON.parse(stdout.trim());
    parsed.forEach((row, i) => assert.deepEqual(row, { Protocol: '2', AppId: 'org.windchime.desktop', Token: token, Transaction:variants[i],Stage:stage(variants[i]) }));
    const invalid = await policy(['', 'a'.repeat(31), 'x'.repeat(32), 'a'.repeat(32) + '\r\nDesktop=1'].map(value => ({ kind: 'request', input: stage(variants[0]), token: value, transaction:variants[0] })));
    invalid.forEach(result => assert.equal(result.ok, false, 'Malformed protocol tokens must not serialize'));
    const injected = await policy([rootDrive.slice(0, 2) + 'relative', directory + '\r\nStartMenu=1', directory + '\0suffix',path.join(directory,'wrong-stage')].map(input => ({ kind: 'request', input, token, transaction:variants[0] })));
    injected.forEach(result => assert.equal(result.ok, false, 'Malformed destination must not enter a confirmed request'));
  });
});
