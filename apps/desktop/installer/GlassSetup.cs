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
  public sealed class PayloadManifest { public string version {get;set;} public string appId {get;set;} public string engineSha256 {get;set;} public List<PayloadFile> files {get;set;} }
  public static class InstallPolicy {
    public const string AppId="org.windchime.desktop", RegistryId="e76db02f-8e92-5190-9ffc-b8c1df592d69";
    public static string NormalizeDirectory(string input) {
      if(String.IsNullOrWhiteSpace(input)||!Regex.IsMatch(input.Trim(),@"^[A-Za-z]:[\\/]")||input.IndexOfAny(new[]{'\r','\n','"','\0'})>=0) throw new InvalidOperationException("请选择带盘符的有效安装文件夹。");
      var full=Path.GetFullPath(input.Trim());
      var result=full.Length==3?full:full.TrimEnd(Path.DirectorySeparatorChar);
      if(result.StartsWith("\\\\",StringComparison.Ordinal)||!Path.IsPathRooted(result))throw new InvalidOperationException("请选择本机磁盘上的文件夹。");
      if(!String.Equals(Path.GetFileName(result),"WindChime",StringComparison.OrdinalIgnoreCase)) result=Path.Combine(result,"WindChime");
      return result;
    }
    public static bool Within(string candidate,string root) {
      if(String.IsNullOrWhiteSpace(root))return false;
      return (Path.GetFullPath(candidate).TrimEnd('\\')+"\\").StartsWith(Path.GetFullPath(root).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);
    }
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
      if(registered!=null&&String.Equals(Path.GetFullPath(registered).TrimEnd('\\'),directory.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)&&HasInstallMarker(directory))return;
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
    public static string CreateRequest(string directory,string token,bool desktop,bool menu) {
      var normalized=NormalizeDirectory(directory);
      if(!Regex.IsMatch(token??"",@"\A[0-9a-f]{32}\z"))throw new InvalidOperationException("安装确认信息无效。");
      return "[WindChime]\r\nProtocol=1\r\nAppId="+AppId+"\r\nToken="+token+"\r\nDirectory="+normalized+"\r\nDesktop="+(desktop?"1":"0")+"\r\nStartMenu="+(menu?"1":"0")+"\r\n";
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
    readonly Assembly assembly=Assembly.GetExecutingAssembly();
    T UI<T>(string name) where T:class { var value=window.FindName(name) as T;if(value==null)throw new InvalidOperationException("缺少界面组件："+name);return value; }
    Stream Resource(string name) { var stream=assembly.GetManifestResourceStream("WindChime.Install."+name);if(stream==null)throw new InvalidOperationException("安装文件不完整，请重新下载安装包。");return stream; }
    string ReadResource(string name) { using(var stream=Resource(name))using(var reader=new StreamReader(stream,Encoding.UTF8))return reader.ReadToEnd(); }
    void Error(string message) { UI<TextBlock>("ErrorText").Text=message??""; }
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
      UI<TextBox>("PathBox").Text=String.IsNullOrWhiteSpace(current)?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","WindChime"):current;
      UI<Border>("LegacyNotice").Visibility=InstallPolicy.HasLegacy()?Visibility.Visible:Visibility.Collapsed;
      UI<Button>("CloseButton").Click+=(s,e)=>window.Close();
      UI<Button>("MinimizeButton").Click+=(s,e)=>window.WindowState=WindowState.Minimized;
      UI<Button>("CancelButton").Click+=(s,e)=>window.Close();
      UI<Button>("BackButton").Click+=(s,e)=>{if(!working&&page>0&&page<3)Show(page-1);};
      UI<Button>("NextButton").Click+=async(s,e)=>await Next();
      UI<Button>("BrowseButton").Click+=(s,e)=>Browse();
      UI<FrameworkElement>("TitleBar").MouseLeftButtonDown+=(s,e)=>{if(e.OriginalSource is Button)return;window.DragMove();};
      window.Closing+=(s,e)=>{if(working){e.Cancel=true;Error("正在安装，请等待完成后关闭窗口。");}};
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
      UI<Button>("CancelButton").IsEnabled=page!=3;
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
        InstallPolicy.ValidateDirectory(installDirectory);
        if(Process.GetProcessesByName("WindChime").Any())throw new InvalidOperationException("风铃仍在运行。请保存编辑内容，从托盘选择“退出并结束展示”，再点击安装。安装器不会强制关闭程序。");
        var disk=new DriveInfo(Path.GetPathRoot(installDirectory));
        if(disk.AvailableFreeSpace<manifest.files.Sum(f=>f.bytes)+128L*1024*1024)throw new InvalidOperationException("所选磁盘空间不足，请更换安装位置。");
        bool desktop=UI<CheckBox>("DesktopCheck").IsChecked==true,menu=UI<CheckBox>("MenuCheck").IsChecked==true;
        working=true;Show(3);
        await Install(desktop,menu);
        working=false;UI<TextBlock>("FinishPath").Text=installDirectory;Show(4);
      } catch(Exception ex) {working=false;Show(2);Error(ex.Message);}
    }
    async Task Install(bool desktop,bool menu) {
      var work=Path.Combine(Path.GetTempPath(),"WindChimeSetup-"+Guid.NewGuid().ToString("N"));
      var security=new DirectorySecurity();security.SetAccessRuleProtection(true,false);
      security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      Directory.CreateDirectory(work,security);
      string engine=Path.Combine(work,"engine.exe"),token=Guid.NewGuid().ToString("N"),request=Path.Combine(work,"request.ini");
      try {
      var progress=UI<ProgressBar>("ProgressBar");var caption=UI<TextBlock>("ProgressCaption");
      caption.Text="正在准备安装文件…";progress.IsIndeterminate=false;progress.Value=0;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Visible;
      using(var source=Resource("Engine.exe"))using(var destination=new FileStream(engine,FileMode.CreateNew,FileAccess.Write,FileShare.None,131072,true)) {
        var buffer=new byte[131072];int count;long copied=0;
        while((count=await source.ReadAsync(buffer,0,buffer.Length))>0){await destination.WriteAsync(buffer,0,count);copied+=count;progress.Value=100d*copied/source.Length;}
      }
      if(!String.Equals(await Task.Run(()=>HashFile(engine)),manifest.engineSha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("安装引擎校验失败，请重新下载安装包。");
      InstallPolicy.ValidateDirectory(installDirectory);
      // Only the confirmed form values enter a private per-run request. No shell
      // is involved; the engine independently checks directory and running-app rules.
      File.WriteAllText(request,InstallPolicy.CreateRequest(installDirectory,token,desktop,menu),Encoding.Unicode);
      caption.Text="正在解压并写入程序文件…";progress.IsIndeterminate=true;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Collapsed;
      var start=new ProcessStartInfo(engine,"/S /WC_BOOTSTRAP="+token){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=work};
      using(var process=Process.Start(start)) {
        await Task.Run(()=>process.WaitForExit());
        if(process.ExitCode!=0) {
          if(process.ExitCode==32)throw new InvalidOperationException("风铃尚未退出，请从托盘退出后重试。");
          if(process.ExitCode==87)throw new InvalidOperationException("安装位置或确认信息校验失败，请重新选择安装位置。");
          throw new InvalidOperationException("安装没有完成（错误码 "+process.ExitCode+"）。请检查磁盘空间及文件夹写入权限后重试。");
        }
      }
      caption.Text="正在核对安装文件…";progress.IsIndeterminate=false;progress.Value=0;UI<TextBlock>("ProgressPercent").Visibility=Visibility.Visible;long verified=0,total=manifest.files.Sum(f=>f.bytes);
      foreach(var item in manifest.files) {
        var file=InstallPolicy.PayloadPath(installDirectory,item.path);
        if(!File.Exists(file)||new FileInfo(file).Length!=item.bytes||!String.Equals(await Task.Run(()=>HashFile(file)),item.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("安装文件核对失败，请重新运行安装包修复。个人连接设置未被删除。");
        verified+=item.bytes;progress.Value=100d*verified/total;
      }
      caption.Text="安装完成";progress.Value=100;
      } finally {
        // Remove only the two exact files created by this invocation. No recursive
        // cleanup, registry changes or old installation files are involved.
        try {File.Delete(request);File.Delete(engine);Directory.Delete(work,false);}catch(IOException){}catch(UnauthorizedAccessException){}
      }
    }
    [STAThread] public static int Main() {
      try {
        bool first;
        using(var mutex=new Mutex(true,"Local\\WindChime.Setup."+WindowsIdentity.GetCurrent().User.Value,out first)) {
          if(!first){MessageBox.Show("安装向导已经打开，请继续使用现有窗口。","风铃安装",MessageBoxButton.OK,MessageBoxImage.Information);return 1;}
          try{new GlassSetup().Run();return 0;}finally{mutex.ReleaseMutex();}
        }
      }catch(Exception ex){MessageBox.Show(ex.Message,"风铃安装",MessageBoxButton.OK,MessageBoxImage.Information);return 1;}
    }
  }
}
