using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media.Imaging;
using System.Windows.Media;
using Microsoft.Win32;

namespace WindChime.Setup {
  public sealed class PayloadFile { public string path {get;set;} public long bytes {get;set;} public string sha256 {get;set;} }
  public sealed class PayloadManifest { public string version {get;set;} public string appId {get;set;} public string engineSha256 {get;set;} public long engineBytes {get;set;} public List<PayloadFile> files {get;set;} }
  public static class InstallPolicy {
    public const string AppId="org.windchime.desktop", RegistryId="e76db02f-8e92-5190-9ffc-b8c1df592d69";
    public static string NormalizeDirectory(string input) {
      if(String.IsNullOrWhiteSpace(input)||!Regex.IsMatch(input.Trim(),@"^[A-Za-z]:[\\/]")||input.IndexOfAny(new[]{'\r','\n','"','\0'})>=0) throw new InvalidOperationException("请选择带盘符的有效安装文件夹。");
      var full=ExpandExistingPath(input.Trim());
      var result=full.Length==3?full:full.TrimEnd(Path.DirectorySeparatorChar);
      if(result.StartsWith("\\\\",StringComparison.Ordinal)||!Path.IsPathRooted(result))throw new InvalidOperationException("请选择本机磁盘上的文件夹。");
      if(!String.Equals(Path.GetFileName(result),"WindChime",StringComparison.OrdinalIgnoreCase)) result=Path.Combine(result,"WindChime");
      return result;
    }
    public static bool Within(string candidate,string root) {
      if(String.IsNullOrWhiteSpace(root))return false;
      return (ExpandExistingPath(candidate).TrimEnd('\\')+"\\").StartsWith(ExpandExistingPath(root).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);
    }
    public static bool SamePath(string left,string right){return !String.IsNullOrWhiteSpace(left)&&!String.IsNullOrWhiteSpace(right)&&String.Equals(ExpandExistingPath(left).TrimEnd('\\'),ExpandExistingPath(right).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);}
    // Resolve existing DOS 8.3 ancestors before protected-root comparisons.
    // The new stage-only engine does not repeat the old builder's path policy.
    static string ExpandExistingPath(string input) {
      var full=Path.GetFullPath(input);var cursor=full;var suffix=new Stack<string>();
      while(!Directory.Exists(cursor)&&!File.Exists(cursor)) {var parent=Path.GetDirectoryName(cursor);if(String.IsNullOrEmpty(parent)||parent==cursor)break;suffix.Push(Path.GetFileName(cursor));cursor=parent;}
      var expanded=new StringBuilder(32768);var length=GetLongPathName(cursor,expanded,expanded.Capacity);
      if(length>0&&length<expanded.Capacity)cursor=expanded.ToString();
      while(suffix.Count>0)cursor=Path.Combine(cursor,suffix.Pop());return cursor;
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    static extern uint GetLongPathName(string input,StringBuilder output,int capacity);
    public static string RegisteredDirectory() {
      using(var key=Registry.CurrentUser.OpenSubKey("Software\\"+RegistryId))return key==null?null:key.GetValue("InstallLocation") as string;
    }
    public static List<string> LegacyDirectories() {
      var roots=new List<string>{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"WindChime")};
      foreach(var view in new[]{RegistryView.Registry32,RegistryView.Registry64})using(var hive=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,view))using(var key=hive.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WindChime")) {
        var value=key==null?null:key.GetValue("InstallLocation") as string;
        if(!String.IsNullOrWhiteSpace(value)&&Path.IsPathRooted(value))roots.Add(value);
      }
      return roots;
    }
    public static bool HasLegacy() {
      if(LegacyDirectories().Any(p=>File.Exists(Path.Combine(p,"Update.exe"))))return true;
      foreach(var view in new[]{RegistryView.Registry32,RegistryView.Registry64})using(var hive=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,view))using(var key=hive.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WindChime"))if(key!=null)return true;
      return false;
    }
    public static void ValidateDirectory(string directory) {
      var protectedRoots=LegacyDirectories();
      protectedRoots.Add(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
      protectedRoots.Add(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
      if(protectedRoots.Any(p=>Within(directory,p)))throw new InvalidOperationException("请选择独立的程序文件夹，不能放在旧版风铃、个人配置或 Windows 目录里。");
      for(var cursor=new DirectoryInfo(directory);cursor!=null;cursor=cursor.Parent)if(cursor.Exists&&(cursor.Attributes&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("安装位置不能经过目录链接，请选择普通文件夹。");
      if(!Directory.Exists(directory)||!Directory.EnumerateFileSystemEntries(directory).Any())return;
      var registered=RegisteredDirectory();
      if(registered!=null&&SamePath(registered,directory)&&HasInstallMarker(directory))return;
      throw new InvalidOperationException("这个文件夹已有其他文件。请选择新的空文件夹，或此前由本向导安装风铃的位置。");
    }
    public static bool HasInstallMarker(string directory) {
      var resources=Path.Combine(directory,"resources");var marker=Path.Combine(resources,"windchime-install.ini");
      if(!File.Exists(marker)||(File.GetAttributes(resources)&FileAttributes.ReparsePoint)!=0||(File.GetAttributes(marker)&FileAttributes.ReparsePoint)!=0)return false;
      var value=new StringBuilder(128);
      GetPrivateProfileString("WindChime","AppId","",value,value.Capacity,marker);
      return value.ToString()==AppId;
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    static extern uint GetPrivateProfileString(string section,string key,string fallback,StringBuilder result,int size,string file);
    public static string CreateRequest(string stage,string transaction,string token) {
      if(!Regex.IsMatch(token??"",@"\A[0-9a-f]{32}\z")||!Regex.IsMatch(transaction??"",@"\A[0-9a-f]{32}\z")||String.IsNullOrWhiteSpace(stage)||!Regex.IsMatch(stage,@"^[A-Za-z]:[\\/]")||stage.IndexOfAny(new[]{'\r','\n','"','\0'})>=0)throw new InvalidOperationException("安装确认信息无效。");
      var normalized=ExpandExistingPath(stage);
      if(Path.GetFileName(normalized)!="new"||Path.GetFileName(Path.GetDirectoryName(normalized))!=InstallTransaction.Prefix+transaction)throw new InvalidOperationException("安装暂存位置无效。");
      return "[WindChime]\r\nProtocol=2\r\nAppId="+AppId+"\r\nToken="+token+"\r\nTransaction="+transaction+"\r\nStage="+normalized+"\r\n";
    }
    public static string PayloadPath(string directory,string relative) {
      if(String.IsNullOrWhiteSpace(relative)||Path.IsPathRooted(relative)||relative.Split('/','\\').Any(p=>p==".."||p=="."||p==""))throw new InvalidOperationException("安装文件清单无效。");
      var file=Path.GetFullPath(Path.Combine(directory,relative.Replace('/',Path.DirectorySeparatorChar)));
      if(!Within(file,directory))throw new InvalidOperationException("安装文件超出指定目录。");
      return file;
    }
  }
  public sealed class GlassSetup {
    Window window; int page; bool working; string installDirectory; PayloadManifest manifest;
    CancellationTokenSource cancellation; InstallTransaction transaction; bool publishing;
    string PendingPath {get{return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"WindChimeSetup","pending.json");}}
    readonly Assembly assembly=Assembly.GetExecutingAssembly();
    T UI<T>(string name) where T:class { var value=window.FindName(name) as T;if(value==null)throw new InvalidOperationException("缺少界面组件："+name);return value; }
    Stream Resource(string name) { var stream=assembly.GetManifestResourceStream("WindChime.Install."+name);if(stream==null)throw new InvalidOperationException("安装文件不完整，请重新下载安装包。");return stream; }
    string ReadResource(string name) { using(var stream=Resource(name))using(var reader=new StreamReader(stream,Encoding.UTF8))return reader.ReadToEnd(); }
    void Error(string message) { UI<TextBlock>("ErrorText").Text=message??""; }
    internal static string FailureMessage(Exception error) {
      while(error.InnerException!=null&&(error is TargetInvocationException||(error is AggregateException&&((AggregateException)error).InnerExceptions.Count==1)))error=error.InnerException;
      return error is OperationCanceledException?"已取消安装，原程序和个人设置保留。":error.Message;
    }
    static string HashFile(string path) { using(var source=File.OpenRead(path))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(source)).Replace("-","").ToLowerInvariant(); }
    public void Run() {
      manifest=new JavaScriptSerializer().Deserialize<PayloadManifest>(ReadResource("Payload.json"));
      if(manifest.appId!=InstallPolicy.AppId||manifest.files==null||manifest.files.Count==0)throw new InvalidOperationException("安装文件清单不完整。");
      using(var stream=Resource("View.xaml"))window=(Window)XamlReader.Load(stream);
      window.Title="风铃安装 · "+manifest.version;
      using(var stream=Resource("Logo.png")){var image=new BitmapImage();image.BeginInit();image.CacheOption=BitmapCacheOption.OnLoad;image.StreamSource=stream;image.EndInit();image.Freeze();UI<Image>("BrandImage").Source=image;}
      using(var stream=Resource("Icon.png")){var image=new BitmapImage();image.BeginInit();image.CacheOption=BitmapCacheOption.OnLoad;image.StreamSource=stream;image.EndInit();window.Icon=image;}
      UI<TextBox>("LicenseBody").Text=ReadResource("LICENSE.txt");
      var current=InstallPolicy.RegisteredDirectory();
      var pending=ReadPending();
      UI<TextBox>("PathBox").Text=pending!=null?pending["target"]:String.IsNullOrWhiteSpace(current)?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","WindChime"):current;
      // Relocation is separate from upgrade: a same-volume swap can reliably
      // restore the old program if any later installation step fails.
      UI<TextBox>("PathBox").IsReadOnly=pending!=null||!String.IsNullOrWhiteSpace(current);
      UI<Button>("BrowseButton").IsEnabled=pending==null&&String.IsNullOrWhiteSpace(current);
      UI<Border>("LegacyNotice").Visibility=InstallPolicy.HasLegacy()?Visibility.Visible:Visibility.Collapsed;
      UI<Button>("CloseButton").Click+=(s,e)=>window.Close();
      UI<Button>("MinimizeButton").Click+=(s,e)=>window.WindowState=WindowState.Minimized;
      UI<Button>("CancelButton").Click+=(s,e)=>{if(working)Cancel();else window.Close();};
      UI<Button>("BackButton").Click+=(s,e)=>{if(!working&&page>0&&page<3)Show(page-1);};
      UI<Button>("NextButton").Click+=async(s,e)=>await Next();
      UI<Button>("BrowseButton").Click+=(s,e)=>Browse();
      UI<FrameworkElement>("TitleBar").MouseLeftButtonDown+=(s,e)=>{if(e.OriginalSource is Button)return;window.DragMove();};
      window.Closing+=(s,e)=>{if(working){e.Cancel=true;Cancel();}};
      window.MaxHeight=SystemParameters.WorkArea.Height-24;window.MaxWidth=SystemParameters.WorkArea.Width-24;
      Show(0);new Application().Run(window);
    }
    void Browse() {
      try {
        var folder=FolderPicker.Show(new System.Windows.Interop.WindowInteropHelper(window).Handle,UI<TextBox>("PathBox").Text);
        if(folder!=null){UI<TextBox>("PathBox").Text=InstallPolicy.NormalizeDirectory(folder);Error(null);}
      }catch{Error("文件夹选择器暂时无法打开，可以直接在安装位置输入完整路径。");}
    }
    void Show(int next) {
      page=next;Error(null);var names=new[]{"WelcomePage","LicensePage","OptionsPage","ProgressPage","FinishPage"};
      for(int i=0;i<names.Length;i++)UI<FrameworkElement>(names[i]).Visibility=i==page?Visibility.Visible:Visibility.Collapsed;
      UI<TextBlock>("PageHeading").Text=new[]{"让每封来信，从容上场。","开放，也保留每一份署名。","按你的习惯安装。","正在为你准备风铃。","风铃，准备就绪。"}[page];
      UI<TextBlock>("PageDescription").Text=new[]{"私人审阅 · 手动上屏 · 独立展示窗口","风铃使用 MIT 开源许可证，以下为完整许可原文。","确认下面的选项，点击“安装风铃”后才开始安装。","安装完成前，请保持此窗口打开。","已有连接和个人设置保留，展示窗口默认保持空白。"}[page];
      UI<Button>("BackButton").Visibility=page>0&&page<3?Visibility.Visible:Visibility.Collapsed;
      UI<Button>("CancelButton").Visibility=page==4?Visibility.Collapsed:Visibility.Visible;
      UI<Button>("NextButton").Content=new[]{"开始设置  →","继续  →","安装风铃","正在安装…","完成"}[page];
      UI<Button>("NextButton").IsEnabled=page!=3;
      UI<Button>("CancelButton").IsEnabled=true;
      for(int i=1;i<=5;i++) {
        bool active=page==i-1;
        UI<Border>("Step"+i+"Dot").Background=(Brush)new BrushConverter().ConvertFromString(active?"#6C9DAD":"#BDFFFFFF");
        UI<TextBlock>("Step"+i+"Number").Foreground=(Brush)new BrushConverter().ConvertFromString(active?"#FFFFFF":"#77909D");
        UI<TextBlock>("Step"+i+"Text").FontWeight=active?FontWeights.SemiBold:FontWeights.Normal;
        UI<TextBlock>("Step"+i+"Text").Opacity=active?1:0.55;
      }
      if(page!=3)window.Dispatcher.BeginInvoke(new Action(()=>UI<Button>("NextButton").Focus()));
    }
    async Task Next() {
      if(working)return;
      if(page<2){Show(page+1);return;}
      if(page==4){if(UI<CheckBox>("RunAfterFinishCheck").IsChecked==true){try{Process.Start(new ProcessStartInfo(Path.Combine(installDirectory,"WindChime.exe")){UseShellExecute=true,WorkingDirectory=installDirectory});}catch{Error("启动失败，可以从安装目录打开 WindChime.exe。");return;}}window.Close();return;}
      try {
        installDirectory=InstallPolicy.NormalizeDirectory(UI<TextBox>("PathBox").Text);
        UI<TextBox>("PathBox").Text=installDirectory;
        RequireStopped();RecoverPending();InstallPolicy.ValidateDirectory(installDirectory);
        InstallTransaction.CheckSpace(installDirectory,manifest.files.Sum(f=>f.bytes),manifest.engineBytes);
        bool desktop=UI<CheckBox>("DesktopCheck").IsChecked==true,menu=UI<CheckBox>("MenuCheck").IsChecked==true;
        working=true;Show(3);
        await Install(desktop,menu);
        working=false;UI<TextBlock>("FinishPath").Text=installDirectory;Show(4);
        if(transaction!=null&&!String.IsNullOrEmpty(transaction.CleanupWarning))Error(transaction.CleanupWarning);
      } catch(Exception ex) {working=false;Show(2);Error(FailureMessage(ex));}
    }
    void Cancel(){if(publishing||(transaction!=null&&transaction.Committing)){Error("正在安全切换程序文件，请等待完成。发生错误会恢复原版本。");return;}if(cancellation!=null){cancellation.Cancel();Error("正在取消并恢复，请稍候…");}}
    static void RequireStopped(){if(Process.GetProcessesByName("WindChime").Any())throw new InvalidOperationException("风铃仍在运行。请保存编辑内容，从托盘选择“退出并结束展示”，再点击安装。安装器不会强制关闭程序。");}
    Dictionary<string,string> ReadPending(){InstallTransaction.RequireOrdinaryPath(PendingPath);if(!File.Exists(PendingPath))return null;return new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(PendingPath));}
    void SavePending(InstallTransaction value){var folder=Path.GetDirectoryName(PendingPath);InstallTransaction.RequireOrdinaryPath(folder);Directory.CreateDirectory(folder);var temporary=PendingPath+".next";File.WriteAllText(temporary,new JavaScriptSerializer().Serialize(new Dictionary<string,string>{{"root",value.Root},{"target",value.Journal.target}}),Encoding.UTF8);if(File.Exists(PendingPath))File.Replace(temporary,PendingPath,null);else File.Move(temporary,PendingPath);}
    void RecoverPending() {
      var pending=ReadPending();
      var roots=pending==null?InstallTransaction.FindPending(installDirectory).ToArray():new[]{pending["root"]};
      foreach(var root in roots) {
        string target=pending==null?installDirectory:pending["target"];
        if(!String.Equals(Path.GetDirectoryName(Path.GetFullPath(root)),Path.GetDirectoryName(Path.GetFullPath(target)),StringComparison.OrdinalIgnoreCase)||!Regex.IsMatch(Path.GetFileName(root),@"\A\.WindChime-Setup-[0-9a-f]{32}\z"))throw new IOException("安装恢复位置无效。");
        InstallTransaction.RequireOrdinaryPath(root);
        // Cleanup can finish just before the process exits, leaving only the
        // private index. No installation data is touched in this case.
        if(!Directory.Exists(root))continue;
        if(!File.Exists(Path.Combine(root,"journal.json"))&&!Directory.EnumerateFileSystemEntries(root).Any()){Directory.Delete(root,false);continue;}
        var recovering=InstallTransaction.Load(root,target,new WindowsInstallMetadata(),null,RequireStopped);
        if(Process.GetProcessesByName(Path.GetFileNameWithoutExtension(recovering.Engine)).Any())throw new IOException("上次安装的解包进程仍在结束，请稍后重试。原程序尚未被替换。");
        recovering.Recover();
      }
      if(pending!=null)File.Delete(PendingPath);
    }
    async Task Install(bool desktop,bool menu) {
      cancellation=new CancellationTokenSource();var cancel=cancellation.Token;
      transaction=InstallTransaction.Begin(installDirectory,manifest.version,desktop,menu,new WindowsInstallMetadata(),null,RequireStopped);
      SavePending(transaction);
      string engine=transaction.Engine,token=Guid.NewGuid().ToString("N"),request=Path.Combine(transaction.Root,"request.ini");
      try {
      var progress=UI<ProgressBar>("ProgressBar");var caption=UI<TextBlock>("ProgressCaption");
      caption.Text="正在准备安装文件…";progress.IsIndeterminate=false;progress.Value=0;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Visible;
      using(var source=Resource("Engine.exe"))using(var destination=new FileStream(engine,FileMode.CreateNew,FileAccess.Write,FileShare.None,131072,true)) {
        var buffer=new byte[131072];int count;long copied=0;
        while((count=await source.ReadAsync(buffer,0,buffer.Length,cancel))>0){await destination.WriteAsync(buffer,0,count,cancel);copied+=count;progress.Value=100d*copied/source.Length;}
      }
      if(!String.Equals(await Task.Run(()=>HashFile(engine)),manifest.engineSha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("安装引擎校验失败，请重新下载安装包。");
      // No shell is involved. The engine independently restricts extraction to
      // this fresh private stage; the transaction checks running apps at commit.
      File.WriteAllText(request,InstallPolicy.CreateRequest(transaction.Stage,transaction.Journal.id,token),Encoding.Unicode);
      caption.Text="正在解压并写入程序文件…";progress.IsIndeterminate=true;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Collapsed;
      var start=new ProcessStartInfo(engine,"/S /WC_BOOTSTRAP="+token){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=transaction.Root};
      using(var process=Process.Start(start)) {
        using(cancel.Register(()=>{try{if(!process.HasExited)process.Kill();}catch(InvalidOperationException){}catch(Win32Exception){}}))await Task.Run(()=>process.WaitForExit());
        cancel.ThrowIfCancellationRequested();
        if(process.ExitCode!=0) {
          if(process.ExitCode==32)throw new InvalidOperationException("风铃尚未退出，请从托盘退出后重试。");
          if(process.ExitCode==87)throw new InvalidOperationException("安装位置或确认信息校验失败，请重新选择安装位置。");
          throw new InvalidOperationException("安装没有完成（错误码 "+process.ExitCode+"）。请检查磁盘空间及文件夹写入权限后重试。");
        }
      }
      caption.Text="正在核对安装文件…";progress.IsIndeterminate=false;progress.Value=0;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Visible;long verified=0,total=manifest.files.Sum(f=>f.bytes);
      foreach(var item in manifest.files) {
        cancel.ThrowIfCancellationRequested();var file=InstallPolicy.PayloadPath(transaction.Stage,item.path);
        if(!File.Exists(file)||new FileInfo(file).Length!=item.bytes||!String.Equals(await Task.Run(()=>HashFile(file)),item.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("安装文件核对失败，请重新运行安装包修复。个人连接设置未被删除。");
        verified+=item.bytes;progress.Value=100d*verified/total;
      }
      await Task.Run(()=>transaction.Prepared(manifest.files));cancel.ThrowIfCancellationRequested();
      publishing=true;caption.Text="正在安全切换程序并保存安装选项…";progress.IsIndeterminate=true;
      await Task.Run(()=>transaction.Commit());
      if(!Directory.Exists(transaction.Root))File.Delete(PendingPath);
      caption.Text="安装完成";progress.Value=100;
      } catch(Exception original) {
        try {transaction.Recover();File.Delete(PendingPath);}
        catch(Exception recovery){throw new IOException("安装未完成，恢复记录已保留。重新运行本安装向导可继续恢复。原因："+FailureMessage(recovery),original);}
        throw;
      } finally {publishing=false;cancellation.Dispose();cancellation=null;}
    }
    [STAThread] public static int Main() {
      try {
        bool first;
        using(var mutex=new Mutex(true,"Local\\WindChime.Setup."+WindowsIdentity.GetCurrent().User.Value,out first)) {
          if(!first){MessageBox.Show("安装向导已经打开，请继续使用现有窗口。","风铃安装",MessageBoxButton.OK,MessageBoxImage.Information);return 1;}
          try{new GlassSetup().Run();return 0;}finally{mutex.ReleaseMutex();}
        }
      }catch(Exception ex){MessageBox.Show(FailureMessage(ex),"风铃安装",MessageBoxButton.OK,MessageBoxImage.Information);return 1;}
    }
  }
}
