const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
async function hashFile(file) { const sha=createHash('sha256');for await(const chunk of createReadStream(file))sha.update(chunk);return sha.digest('hex'); }
async function listPayload(directory, prefix='') {
  const files=[];
  for(const item of await fs.readdir(directory,{withFileTypes:true})) {
    const filename=path.join(directory,item.name),relative=prefix+item.name;
    if(item.isSymbolicLink())throw Error('Packaged application contains an unexpected link');
    if(item.isDirectory())files.push(...await listPayload(filename,relative+'/'));
    else if(item.isFile())files.push({path:relative,bytes:(await fs.stat(filename)).size,sha256:await hashFile(filename)});
    else throw Error('Unexpected packaged file type');
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
async function buildGlassSetup({root,packaged,engine,output}) {
  const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const work=path.join(path.dirname(engine),'glass-build');await fs.mkdir(work,{recursive:true});
  const payload={version,appId:'org.windchime.desktop',engineSha256:await hashFile(engine),engineBytes:(await fs.stat(engine)).size,files:await listPayload(packaged)};
  const payloadFile=path.join(work,'Payload.json');await fs.writeFile(payloadFile,JSON.stringify(payload,null,2)+'\n');
  const assemblyFile=path.join(work,'AssemblyInfo.cs');
  await fs.writeFile(assemblyFile,`using System.Reflection;\n[assembly:AssemblyTitle("WindChime 安装")]\n[assembly:AssemblyProduct("WindChime")]\n[assembly:AssemblyVersion("${version}.0")]\n[assembly:AssemblyFileVersion("${version}.0")]\n[assembly:AssemblyCopyright("Copyright (c) 2026 WindChime contributors")]\n`);
  const resources={
    'Engine.exe':engine,
    'View.xaml':path.join(root,'installer/GlassWizard.xaml'),
    'Logo.png':path.resolve(root,'../../assets/branding/windchime_logo/02_Lockups/WindChime_stacked_glass_light.png'),
    'Icon.png':path.join(root,'build/icon.png'),
    'LICENSE.txt':path.resolve(root,'../../LICENSE'),
    'Payload.json':payloadFile,
  };
  const framework=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319');
  const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/out:'+output,'/win32icon:'+path.join(root,'build/icon.ico'),'/win32manifest:'+path.join(root,'installer/glass.manifest'),
    '/reference:System.dll','/reference:System.Core.dll','/reference:System.Xaml.dll','/reference:System.Web.Extensions.dll',
    ...['WindowsBase','PresentationCore','PresentationFramework'].map(name=>'/reference:'+path.join(framework,'WPF',name+'.dll')),
    ...Object.entries(resources).map(([name,file])=>'/resource:'+file+',WindChime.Install.'+name),
    path.join(root,'installer/GlassSetup.cs'),path.join(root,'installer/FolderPicker.cs'),path.join(root,'installer/InstallTransaction.cs'),path.join(root,'installer/InstallMetadata.cs'),assemblyFile];
  const result=await exec(path.join(framework,'csc.exe'),args,{windowsHide:true,maxBuffer:4*1024*1024});
  if(result.stdout.trim())console.log(result.stdout.trim());
  await fs.writeFile(path.join(work,'resources.json'),JSON.stringify({version,output,resources:await Promise.all(Object.entries(resources).map(async([name,file])=>({name:'WindChime.Install.'+name,sha256:await hashFile(file),bytes:(await fs.stat(file)).size})))},null,2)+'\n');
  return {output,manifest:payloadFile,resourceManifest:path.join(work,'resources.json')};
}
module.exports={buildGlassSetup,listPayload,hashFile};
