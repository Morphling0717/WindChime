const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const desktop = path.resolve(__dirname, '..');

// Real .NET Framework and Windows Unicode COM, but ONLY unique temporary .lnk
// files. No installation, HKCU write, real desktop/start-menu shortcut or launch.
describe('Windows installer Unicode shortcuts', { skip: process.platform !== 'win32' }, () => {
  let temporary, fixture;
  before(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-shortcut-tests-'));
    fixture = path.join(temporary, 'Fixture.exe');
    const source = path.join(temporary, 'Fixture.cs');
    await fs.writeFile(source, String.raw`
using System;using System.IO;using System.Text;using System.Reflection;using System.Threading;using System.Threading.Tasks;using System.Globalization;using System.Runtime.InteropServices;using WindChime.Setup;
static class ShortcutFixture {
 static object Call(string name,params object[] args){try{return typeof(WindowsInstallMetadata).GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args);}catch(TargetInvocationException error){throw error.InnerException;}}
 static void Require(bool value,string message){if(!value)throw new Exception(message);}
 static void Check(string root,string mode){
  var target=Path.Combine(root,"风铃 安装目录");Directory.CreateDirectory(target);File.WriteAllText(Path.Combine(target,"WindChime.exe"),"not executable");
  var file=Path.Combine(root,"风铃 WindChime.lnk");
  if(mode=="roundtrip") {
   Call("WriteLink",file,target,true);Require(File.Exists(file),"Shortcut missing");
   Require(InstallPolicy.SamePath((string)Call("ReadLink",file),Path.Combine(target,"WindChime.exe")),"Unicode target changed");
   object native=new ShellLinkObject();try{
    ((System.Runtime.InteropServices.ComTypes.IPersistFile)native).Load(file,0);
    var value=new StringBuilder(32768);((IShellLinkUnicode)native).GetWorkingDirectory(value,value.Capacity);Require(InstallPolicy.SamePath(value.ToString(),target),"Working directory changed");
    value.Clear();((IShellLinkUnicode)native).GetDescription(value,value.Capacity);Require(value.ToString()=="风铃 · 私人审阅与手动上屏","Description changed");
   }finally{Marshal.FinalReleaseComObject(native);}
   Call("VerifyLink",file,target,true);File.Move(file,file+".moved");File.Move(file+".moved",file);
  } else if(mode=="disabled") {
   var unrelated=Path.Combine(root,"keep.txt");File.WriteAllText(unrelated,"keep");Call("WriteLink",file,target,true);Call("WriteLink",file,target,false);Call("VerifyLink",file,target,false);Require(File.ReadAllText(unrelated)=="keep","Unrelated file changed");
  } else if(mode=="save-error"||mode=="read-error") {
   bool failed=false;try{if(mode=="save-error")Call("WriteLink",Path.Combine(root,"missing-parent","风铃.lnk"),target,true);else{File.WriteAllText(file,"invalid shortcut");Call("ReadLink",file);}}
   catch(IOException error){failed=true;Require(error.InnerException!=null,"Native cause lost");Require(error.Message.StartsWith("无法"),"No action context");Require(!error.Message.Contains("target of an invocation"),"Reflection wrapper shown");}
   Require(failed,"Broken shortcut unexpectedly succeeded");
  } else if(mode=="errors") {
   Require(GlassSetup.FailureMessage(new TargetInvocationException(new AggregateException(new IOException("actual native error"))))=="actual native error","Wrapper not unwrapped");
   Require(GlassSetup.FailureMessage(new TargetInvocationException(new OperationCanceledException())).StartsWith("已取消安装"),"Cancellation translation lost");
   Require(GlassSetup.FailureMessage(new IOException("恢复记录已保留",new Exception("cause")))=="恢复记录已保留","Recovery context lost");
  } else throw new Exception("Unknown test mode");
 }
 [STAThread] public static int Main(string[] args){try{
  Console.OutputEncoding=new UTF8Encoding(false);var root=Path.GetFullPath(args[0]);
  Require(root.StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(root).StartsWith("case-"),"Temporary fixture guard");
  // .NET Framework compatibility mode need not flow the caller's culture into
  // Task.Run. Set and assert it on the actual COM-calling thread for each case.
  Action checkedRun=()=>{Thread.CurrentThread.CurrentCulture=CultureInfo.GetCultureInfo(args[2]);Require(Thread.CurrentThread.CurrentCulture.Name==args[2],"COM thread culture differs from the requested test culture");Check(root,args[1]);};
  if(args[3]=="MTA")Task.Run(()=>{Require(Thread.CurrentThread.GetApartmentState()==ApartmentState.MTA,"Not background MTA");checkedRun();}).GetAwaiter().GetResult();else checkedRun();
  Console.WriteLine("PASS");return 0;
 }catch(Exception error){while(error.InnerException!=null){Console.Error.WriteLine(error.GetType().FullName+": "+error.Message);error=error.InnerException;}Console.Error.WriteLine(error.ToString());return 1;}}
}
`);
    const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319');
    await exec(path.join(framework, 'csc.exe'), [
      '/nologo', '/target:exe', '/platform:x64', '/main:ShortcutFixture', '/out:' + fixture,
      '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Xaml.dll', '/reference:System.Web.Extensions.dll',
      ...['WindowsBase', 'PresentationCore', 'PresentationFramework'].map(name => '/reference:' + path.join(framework, 'WPF', name + '.dll')),
      ...['GlassSetup', 'FolderPicker', 'InstallTransaction', 'InstallMetadata'].map(name => path.join(desktop, 'installer', name + '.cs')), source,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  });
  async function run(mode, culture = 'en-MY', apartment = 'MTA') {
    const directory = await fs.mkdtemp(path.join(temporary, 'case-'));
    const { stdout } = await exec(fixture, [directory, mode, culture, apartment], { windowsHide: true, timeout: 30000 });
    assert.equal(stdout.trim(), 'PASS');
  }
  for (const culture of ['en-MY', 'zh-CN']) for (const apartment of ['STA', 'MTA']) {
    test(`Chinese filename, target, working directory and description survive ${culture} ${apartment}`, () => run('roundtrip', culture, apartment));
  }
  test('disabling a shortcut removes only the isolated link and releases file handles', () => run('disabled'));
  test('save failure retains the native cause and readable action context', () => run('save-error'));
  test('invalid shortcut read retains the native cause and readable action context', () => run('read-error'));
  test('installer unwraps reflection and single-task errors without losing recovery context', () => run('errors'));
});
