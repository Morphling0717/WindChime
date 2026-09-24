const {describe,test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const desktop=path.resolve(__dirname,'..');

describe('real .NET installation transactions in new isolated fixtures',{skip:process.platform!=='win32'},()=>{
 let temporary,fixture;
 before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-transaction-tests-'));
  const source=path.join(temporary,'Fixture.cs');fixture=path.join(temporary,'Fixture.exe');
  await fs.writeFile(source,String.raw`
using System;using System.IO;using System.Linq;using WindChime.Setup;
sealed class Store:IInstallMetadata {
 readonly string file;readonly bool fail; public Store(string directory,bool broken){file=Path.Combine(directory,"metadata.txt");fail=broken;}
 public string Capture(){return File.Exists(file)?File.ReadAllText(file):null;}
 public void Apply(string directory,string version,bool desktop,bool menu){File.WriteAllText(file,"registry="+version+"\nshortcuts="+desktop+","+menu);if(fail)throw new IOException("injected metadata write failure");}
 public void Restore(string value){if(value==null)File.Delete(file);else File.WriteAllText(file,value);}
 public void Verify(string directory,string version,bool desktop,bool menu){if(Capture()!="registry="+version+"\nshortcuts="+desktop+","+menu)throw new IOException("metadata differs");}
}
static class Fixture {
 public static int Main(string[] args){try {
  string mode=args[0],root=Path.GetFullPath(args[1]),phase=args.Length>2?args[2]:"",target=Path.Combine(root,"WindChime");
  if(!root.StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(root).StartsWith("case-"))throw new IOException("Fixture path guard");
  var store=new Store(root,mode=="metadata-failure");
  Action<string> fault=p=>{if(p==phase)Environment.Exit(91);};
  if(mode=="recover") {foreach(var pending in InstallTransaction.FindPending(target))InstallTransaction.Load(pending,target,store,fault).Recover();return 0;}
  if(mode=="space"){Console.WriteLine(InstallTransaction.RequiredBytes(400*InstallTransaction.MiB,100*InstallTransaction.MiB,true));Console.WriteLine(InstallTransaction.RequiredBytes(400*InstallTransaction.MiB,100*InstallTransaction.MiB,false));return 0;}
  var tx=InstallTransaction.Begin(target,"new",true,false,store,fault);
  Directory.CreateDirectory(Path.Combine(tx.Stage,"resources"));
  File.WriteAllText(Path.Combine(tx.Stage,"WindChime.exe"),"synthetic new executable");
  File.WriteAllText(Path.Combine(tx.Stage,"resources","app.asar"),"synthetic new payload");
  var expected=InstallTransaction.Inspect(tx.Stage).files;
  if(mode=="corrupt")File.WriteAllText(Path.Combine(tx.Stage,"resources","app.asar"),"damaged after manifest");
  if(mode=="partial"){File.WriteAllText(Path.Combine(tx.Stage,"partial.bin"),"partial extraction");Environment.Exit(92);}
  try {tx.Prepared(expected);tx.Commit();}
  catch {tx.Recover();throw;}
  return 0;
 }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 73;}}
}
`);
  const fw=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319');
  try {await exec(path.join(fw,'csc.exe'),['/nologo','/target:exe','/platform:x64','/main:Fixture','/out:'+fixture,
   '/reference:System.dll','/reference:System.Core.dll','/reference:System.Xaml.dll','/reference:System.Web.Extensions.dll',
   ...['WindowsBase','PresentationCore','PresentationFramework'].map(n=>'/reference:'+path.join(fw,'WPF',n+'.dll')),
   ...['GlassSetup','FolderPicker','InstallTransaction','InstallMetadata'].map(n=>path.join(desktop,'installer',n+'.cs')),source],{windowsHide:true,timeout:30000});}
  catch(error){throw new Error(error.stdout||error.message);}
 });
 async function scenario(old=true){const root=await fs.mkdtemp(path.join(temporary,'case-'));if(old){await fs.mkdir(path.join(root,'WindChime/resources'),{recursive:true});await fs.writeFile(path.join(root,'WindChime/WindChime.exe'),'old executable');await fs.writeFile(path.join(root,'WindChime/resources/app.asar'),'old payload');await fs.writeFile(path.join(root,'metadata.txt'),'original registry and shortcut bytes');}return root;}
 async function run(root,mode,phase='',code=0){try{const result=await exec(fixture,[mode,root,phase],{windowsHide:true,timeout:15000});assert.equal(code,0);return result.stdout;}catch(error){assert.equal(error.code,code,error.stderr||error.message);return error.stdout;}}
 async function original(root,old){if(old){assert.equal(await fs.readFile(path.join(root,'WindChime/WindChime.exe'),'utf8'),'old executable');assert.equal(await fs.readFile(path.join(root,'WindChime/resources/app.asar'),'utf8'),'old payload');assert.equal(await fs.readFile(path.join(root,'metadata.txt'),'utf8'),'original registry and shortcut bytes');}else{await assert.rejects(fs.stat(path.join(root,'WindChime')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(root,'metadata.txt')),{code:'ENOENT'});}assert.equal((await fs.readdir(root)).filter(n=>n.startsWith('.WindChime-Setup-')).length,0);}
 for(const old of [false,true]) for(const phase of ['created','prepared','move-old','old-moved','move-new','new-moved','metadata','metadata-written'])
  test(`${old?'upgrade':'fresh'} process death at ${phase} restores exact prior files and metadata`,async()=>{const root=await scenario(old);await run(root,'install',phase,91);await run(root,'recover');await original(root,old);await run(root,'install');assert.equal(await fs.readFile(path.join(root,'WindChime/WindChime.exe'),'utf8'),'synthetic new executable');});
 for(const old of [false,true])test(`${old?'upgrade':'fresh'} durable commit survives process death without rolling back success`,async()=>{const root=await scenario(old);await run(root,'install','committed',91);await run(root,'recover');assert.equal(await fs.readFile(path.join(root,'WindChime/WindChime.exe'),'utf8'),'synthetic new executable');assert.equal(await fs.readFile(path.join(root,'metadata.txt'),'utf8'),'registry=new\nshortcuts=True,False');});
 for(const mode of ['metadata-failure','corrupt'])test(`${mode} restores the old working installation before returning failure`,async()=>{const root=await scenario();await run(root,mode,'',73);await original(root,true);});
 test('partial first extraction is recoverable and a second install works in the same directory',async()=>{const root=await scenario(false);await run(root,'partial','',92);await run(root,'recover');await original(root,false);await run(root,'install');});
 test('recovery refuses an externally changed new directory and retains the old backup',async()=>{const root=await scenario();await run(root,'install','metadata',91);await fs.writeFile(path.join(root,'WindChime/unrelated.txt'),'do not delete');await run(root,'recover','',73);assert.equal(await fs.readFile(path.join(root,'WindChime/unrelated.txt'),'utf8'),'do not delete');const pending=(await fs.readdir(root)).find(n=>n.startsWith('.WindChime-Setup-'));assert.equal(await fs.readFile(path.join(root,pending,'old/WindChime.exe'),'utf8'),'old executable');});
 test('space budget combines destination engine and temp overhead only on the same drive',async()=>{const root=await scenario(false);const values=(await run(root,'space')).trim().split(/\s+/).map(Number);assert.equal(values[0],700*1024*1024);assert.equal(values[1],636*1024*1024);});
 for(const phase of ['files-restored','metadata-restored'])test(`recovery interrupted at ${phase} can itself be resumed`,async()=>{const root=await scenario();await run(root,'install','metadata-written',91);await run(root,'recover',phase,91);await run(root,'recover');await original(root,true);});
 test('cleanup interrupted after deleting an old file resumes without undoing a successful install',async()=>{const root=await scenario();await run(root,'install','cleanup-file',91);await run(root,'recover');assert.equal(await fs.readFile(path.join(root,'WindChime/WindChime.exe'),'utf8'),'synthetic new executable');assert.equal((await fs.readdir(root)).filter(n=>n.startsWith('.WindChime-Setup-')).length,0);});
});
