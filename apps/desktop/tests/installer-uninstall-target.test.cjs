const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);

test('the complete NSIS uninstall target check validates identity and canonical paths without changing fixture data',{skip:process.platform!=='win32'},async t=>{
 const desktop=path.resolve(__dirname,'..');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'windchime-uninstall-target-')));
 const data=path.join(temporary,'独立 测试数据');await fs.mkdir(data);
 const id=crypto.randomUUID(),owner=crypto.randomBytes(32).toString('hex');
 const registryKey='Software\\WindChimeAcceptance\\UninstallTarget-'+id;
 assert.match(registryKey,/^Software\\WindChimeAcceptance\\UninstallTarget-[0-9a-f-]{36}$/);
 const shell=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const registryScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$r=$env:WINDCHIME_TARGET_REGISTRY_FIXTURE|ConvertFrom-Json
if($r.key -notmatch '^Software\\WindChimeAcceptance\\UninstallTarget-[0-9a-f-]{36}$'){throw 'Unsafe fixture registry namespace'}
$hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
$key=$null
try {
 $key=$hive.OpenSubKey($r.key,$true)
 if($r.mode -eq 'create'){
  if($null-ne$key){throw 'Fixture registry collision'}
  $key=$hive.CreateSubKey($r.key);$key.SetValue('FixtureOwner',$r.owner)
 }else{
  if($null-eq$key -or $key.GetValue('FixtureOwner') -ne $r.owner){throw 'Fixture registry ownership mismatch'}
  if($r.mode -eq 'set'){
   if($null-eq$r.target){$key.DeleteValue('InstallLocation',$false)}else{$key.SetValue('InstallLocation',$r.target)}
  }elseif($r.mode -eq 'remove'){
   $key.Dispose();$key=$null;$hive.DeleteSubKeyTree($r.key,$false)
  }else{throw 'Unknown fixture operation'}
 }
}finally{if($key){$key.Dispose()};$hive.Dispose()}
`;
 const registry=async(mode,target)=>exec(shell,['-NoProfile','-NonInteractive','-Command',registryScript],{windowsHide:true,timeout:30000,env:{...process.env,WINDCHIME_TARGET_REGISTRY_FIXTURE:JSON.stringify({key:registryKey,owner,mode,target})}});
 await registry('create');
 t.after(async()=>{await registry('remove');});
 const sourceFile=process.env.WINDCHIME_UNINSTALL_TARGET_SOURCE_FILE||path.join(desktop,'installer/wizard.nsh');
 const source=await fs.readFile(sourceFile,'utf8');
 const functions=['WCCheckTree','WCCheckProtectedRoot','WCVerifyTarget'].map(name=>{
  const body=new RegExp('^Function un\\.'+name+'\\r?\\n[\\s\\S]*?^FunctionEnd\\r?$','m').exec(source)?.[0];
  assert(body,'Actual production function is required: '+name);return body;
 }).join('\n');
 assert(!/^\s*(?:Delete\w*|RMDir|Rename|CopyFiles|Exec\w*|Write\w*|FileOpen|FileWrite\w*|CreateDirectory|SetOutPath|Reboot)\b/m.test(functions),'Production preflight must remain read-only');
 // Reject new plugin calls before compiling or executing extracted code. These
 // exact APIs only read paths/enumerate files; allocation is fixture-local memory.
 const allowedSystemStatements=new Set([
  String.raw`System::Call 'kernel32::GetFileAttributesW(w r0)i.r3'`,
  String.raw`System::Call 'kernel32::GetFileAttributesW(w r4)i.r3'`,
  String.raw`System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'`,
  String.raw`System::Call 'kernel32::FindFirstFileW(w "$0\*", p r5)p.r1 ?e'`,
  String.raw`System::Call 'kernel32::FindNextFileW(p r1, p r5)i.r3 ?e'`,
  String.raw`System::Call 'kernel32::FindClose(p r1)i'`,
  "System::Call 'kernel32::GetLongPathNameW(w r0, w .r1, i ${NSIS_MAX_STRLEN})i.r2'",
  "System::Call 'kernel32::GetLongPathNameW(w r1, w .r0, i ${NSIS_MAX_STRLEN})i.r2'",
  "System::Call 'kernel32::GetLongPathNameW(w r0, w .r3, i ${NSIS_MAX_STRLEN})i.r2'",
  "System::Call 'kernel32::GetLongPathNameW(w r1, w .r3, i ${NSIS_MAX_STRLEN})i.r2'",
  String.raw`System::Call '*$6(&w260 .r2)'`,
  'System::Alloc 592',
  'System::Free $5',
 ]);
 for(const line of functions.split(/\r?\n/)){
  if(/^\s*[^\s;]+::/.test(line))assert(allowedSystemStatements.has(line.trim()),'Unreviewed plugin call in read-only preflight: '+line.trim());
 }
 // Bind only the external context to this test: our private registry namespace
 // and a synthetic protected root. The three production algorithms stay intact.
 const legacy='"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WindChime"';
 assert.equal(functions.split(legacy).length-1,2);
 assert.equal(functions.split('Push "$APPDATA"').length-1,1);
 let body=functions.replaceAll('un.WC','FixtureWC').replaceAll(legacy,'"${INSTALL_REGISTRY_KEY}\\Legacy"').replace('Push "$APPDATA"','Push "$FixtureProtectedRoot"');
 assert.equal((body.match(/^\s*Quit\s*$/gm)||[]).length,1);
 // Keep the real failure exit. Record the real reason before Quit terminates
 // this synthetic executable, without ever running an uninstall section.
 body=body.replace(/^\s*Quit\s*$/m,'  Call FixtureReport\n  Quit');
 const {getMakeNsisPath}=require('app-builder-lib/out/toolsets/windows');
 const compiler=await getMakeNsisPath();
 const {nsisEscapeString:escape}=require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
 const executable=path.join(temporary,'TargetPreflightFixture.exe'),reportFile=path.join(temporary,'result.txt');
 const script=`Unicode true\nName "Private WindChime target preflight fixture"\nOutFile "${escape(executable)}"\nRequestExecutionLevel user\nSilentInstall silent\nAutoCloseWindow true\n!include LogicLib.nsh\n!include FileFunc.nsh\n!define APP_ID "org.windchime.desktop"\n!define INSTALL_REGISTRY_KEY "${escape(registryKey)}"\nVar WCUnValidationError\nVar WCUnCanonical\nVar WCUnDepth\nVar WCUnSeen\nVar FixtureProtectedRoot\n${body}\nFunction FixtureReport\nFileOpen $R9 "$EXEDIR\\result.txt" w\nFileWriteUTF16LE $R9 "$WCUnValidationError$\\r$\\n$WCUnCanonical$\\r$\\n$INSTDIR$\\r$\\n$WCUnSeen$\\r$\\n"\nFileClose $R9\nFunctionEnd\nSection\nSetRegView 64\nSetShellVarContext current\nReadEnvStr $INSTDIR "WINDCHIME_TARGET_DIRECTORY"\nReadEnvStr $FixtureProtectedRoot "WINDCHIME_TARGET_PROTECTED"\nCall FixtureWCVerifyTarget\nCall FixtureReport\nSetErrorLevel 0\nSectionEnd\n`;
 assert(!script.includes('e76db02f-8e92-5190-9ffc-b8c1df592d69'));
 const nsi=path.join(temporary,'target-fixture.nsi');await fs.writeFile(nsi,script);
 await exec(compiler.path,['-INPUTCHARSET','UTF8','-V2',nsi],{windowsHide:true,timeout:30000,env:{...process.env,...compiler.env}});
 async function installFolder(name,appId='org.windchime.desktop'){
  const target=path.join(data,name,'WindChime');await fs.mkdir(path.join(target,'resources'),{recursive:true});
  await fs.writeFile(path.join(target,'payload-sentinel.bin'),'synthetic payload must not change');
  if(appId!==null)await fs.writeFile(path.join(target,'resources/windchime-install.ini'),'\ufeff[WindChime]\r\nAppId='+appId+'\r\nVersion=0.8.3\r\n','utf16le');
  return target;
 }
 const exact=await installFolder('正常 中文安装目录');
 const mismatch=await installFolder('不同注册目录');
 const missingMarker=await installFolder('缺少标记',null),wrongMarker=await installFolder('错误标记','org.windchime.some-other-product');
 const ancestorReal=await installFolder('祖先链接实际目录');
 const ancestorLink=path.join(data,'祖先链接');await fs.symlink(path.dirname(ancestorReal),ancestorLink,'junction');
 const ancestor=path.join(ancestorLink,'WindChime');
 const descendant=await installFolder('子目录链接');await fs.symlink(path.dirname(mismatch),path.join(descendant,'linked-child'),'junction');
 const protectedTarget=await installFolder('模拟个人数据');
 const protectedRoot=path.dirname(protectedTarget);
 const containsProtected=await installFolder('包含模拟个人数据');const contained=path.join(containsProtected,'private-data');await fs.mkdir(contained);
 const safeProtected=path.join(data,'独立保护目录');await fs.mkdir(safeProtected);
 const shortScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class TargetFixtureShortPath{[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern uint GetShortPathName(string input,StringBuilder output,int capacity);public static string Read(string path){var value=new StringBuilder(32768);uint length=GetShortPathName(path,value,value.Capacity);if(length==0||length>=value.Capacity)throw new Exception("Cannot query fixture short path");return value.ToString();}}'
[TargetFixtureShortPath]::Read($env:WINDCHIME_TARGET_SHORT_INPUT)
`;
 const short=(await exec(shell,['-NoProfile','-NonInteractive','-Command',shortScript],{windowsHide:true,timeout:30000,env:{...process.env,WINDCHIME_TARGET_SHORT_INPUT:exact}})).stdout.trim();
 const hasAlias=short.toLowerCase()!==exact.toLowerCase();
 async function snapshot(directory){
  const result={};
  async function walk(folder,prefix=''){
   for(const item of await fs.readdir(folder,{withFileTypes:true})){
    const name=prefix+item.name,file=path.join(folder,item.name);
    if(item.isSymbolicLink())result[name]={link:await fs.readlink(file)};
    else if(item.isDirectory()){result[name]={directory:true};await walk(file,name+'/');}
    else result[name]={sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')};
   }
  }
  await walk(directory);return result;
 }
 const sentinel=await snapshot(data),results=[];
 const cases=[
  {name:'exact long Unicode path',input:exact,registered:exact,expected:0},
  {name:'trailing separator',input:exact+'\\',registered:exact,expected:0},
  {name:'8.3 uninstall location with long registry',input:short,registered:exact,expected:0,skip:!hasAlias},
  {name:'8.3 registry with long uninstall location',input:exact,registered:short,expected:0,skip:!hasAlias},
  {name:'matching 8.3 locations',input:short,registered:short,expected:0,skip:!hasAlias},
  {name:'registry mismatch',input:exact,registered:mismatch,expected:87},
  {name:'missing registry value',input:exact,registered:null,expected:87},
  {name:'missing ownership marker',input:missingMarker,registered:missingMarker,expected:87},
  {name:'wrong application identity',input:wrongMarker,registered:wrongMarker,expected:87},
  {name:'ancestor junction',input:ancestor,registered:ancestor,expected:87},
  {name:'descendant junction',input:descendant,registered:descendant,expected:87},
  {name:'inside protected root',input:protectedTarget,registered:protectedTarget,protected:protectedRoot,expected:87},
  {name:'contains protected root',input:containsProtected,registered:containsProtected,protected:contained,expected:87},
 ];
 for(const entry of cases)await t.test(entry.name,{skip:entry.skip?'8.3 aliases are not available for this temporary fixture':false},async()=>{
  await registry('set',entry.registered);
  // A failed launch or unexpected early Quit must not reuse the previous result.
  await fs.unlink(reportFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
  let code=0,failure;
  try{await exec(executable,[],{windowsHide:true,timeout:45000,env:{...process.env,WINDCHIME_TARGET_DIRECTORY:entry.input,WINDCHIME_TARGET_PROTECTED:entry.protected||safeProtected}});}catch(error){code=error.code;failure=error;}
  const [reason,canonical,returnedDirectory]=(await fs.readFile(reportFile,'utf16le')).replace(/^\uFEFF/,'').split(/\r?\n/);
  results.push({name:entry.name,code,reason,expected:entry.expected});
  assert.equal(failure?.killed??false,false,'Fixture must return normally');
  assert.equal(failure?.signal??null,null,'Fixture must not terminate by signal');
  assert.equal(code,entry.expected,`Unexpected target decision; reason=${reason}`);
  assert.equal(Boolean(reason.trim()),entry.expected!==0,'Rejected targets must give a specific nonempty reason');
  if(entry.expected===0){assert.equal(canonical.toLowerCase(),exact.toLowerCase());assert.equal(returnedDirectory.toLowerCase(),exact.toLowerCase(),'Successful verification returns the canonical long install directory');}
  assert.deepEqual(await snapshot(data),sentinel,'Read-only preflight must preserve all fixture files and links');
 });
 assert.deepEqual(await snapshot(data),sentinel,'All synthetic sentinels remain unchanged');
 const report={sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),sourceOverride:!!process.env.WINDCHIME_UNINSTALL_TARGET_SOURCE_FILE,fixtureOnly:true,realUninstallerExecuted:false,productionRegistryTouched:false,temporaryRegistryNamespace:registryKey,shortAliasesAvailable:hasAlias,allSentinelsUnchanged:true,results};
 await fs.writeFile(path.join(temporary,'target-preflight-report.json'),JSON.stringify(report,null,2)+'\n');
 t.diagnostic(JSON.stringify({fixtureOnly:true,realUninstallerExecuted:false,sourceOverride:report.sourceOverride,shortAliasesAvailable:hasAlias,allSentinelsUnchanged:true,results}));
});
