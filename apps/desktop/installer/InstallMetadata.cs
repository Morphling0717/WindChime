using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace WindChime.Setup {
  [ComImport,Guid("00021401-0000-0000-C000-000000000046"),ClassInterface(ClassInterfaceType.None)]
  sealed class ShellLinkObject {}
  // Use the Unicode shell interface explicitly. WScript.Shell's late-bound
  // shortcut implementation can use ANSI paths on non-Chinese Windows systems.
  [ComImport,Guid("000214F9-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellLinkUnicode {
    void GetPath([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int capacity,IntPtr findData,uint flags);
    void GetIDList(out IntPtr value);
    void SetIDList(IntPtr value);
    void GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int capacity);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int capacity);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int capacity);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetHotkey(out short value);
    void SetHotkey(short value);
    void GetShowCmd(out int value);
    void SetShowCmd(int value);
    void GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int capacity,out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value,int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value,uint reserved);
    void Resolve(IntPtr window,uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
  }
  public sealed class RegistrySnapshotValue {public string name {get;set;} public int kind {get;set;} public string text {get;set;} public string[] strings {get;set;} public long number {get;set;}}
  public sealed class RegistrySnapshot {public bool exists {get;set;} public List<RegistrySnapshotValue> values {get;set;}}
  public sealed class MetadataSnapshot {public RegistrySnapshot application {get;set;} public RegistrySnapshot uninstall {get;set;} public string desktop {get;set;} public string menu {get;set;}}
  public sealed class WindowsInstallMetadata : IInstallMetadata {
    const string ApplicationKey="Software\\"+InstallPolicy.RegistryId;
    const string UninstallKey="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+InstallPolicy.RegistryId;
    static readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=2*1024*1024};
    string Desktop {get{return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"风铃 WindChime.lnk");}}
    string Menu {get{return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"风铃 WindChime.lnk");}}
    static RegistryKey Hive(){return RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64);}
    static RegistrySnapshot CaptureKey(string path) {
      using(var hive=Hive())using(var key=hive.OpenSubKey(path)){
        var result=new RegistrySnapshot{exists=key!=null,values=new List<RegistrySnapshotValue>()};if(key==null)return result;
        if(key.GetSubKeyNames().Length!=0)throw new IOException("安装注册信息包含未知子项，已停止更新。");
        foreach(var name in key.GetValueNames()) {
          var kind=key.GetValueKind(name);var value=key.GetValue(name,null,RegistryValueOptions.DoNotExpandEnvironmentNames);var item=new RegistrySnapshotValue{name=name,kind=(int)kind};
          if(kind==RegistryValueKind.Binary||kind==RegistryValueKind.None)item.text=Convert.ToBase64String((byte[])value);
          else if(kind==RegistryValueKind.MultiString)item.strings=(string[])value;
          else if(kind==RegistryValueKind.DWord)item.number=(int)value;
          else if(kind==RegistryValueKind.QWord)item.number=(long)value;
          else item.text=(string)value;
          result.values.Add(item);
        }return result;
      }
    }
    static void RestoreKey(string path,RegistrySnapshot snapshot) {
      if(snapshot==null)throw new IOException("安装注册备份不完整。");
      using(var hive=Hive()) {
        using(var current=hive.OpenSubKey(path)){if(current!=null&&current.SubKeyCount!=0)throw new IOException("注册信息被其他程序修改，恢复已停止。");}
        if(!snapshot.exists){hive.DeleteSubKey(path,false);return;}
        using(var key=hive.CreateSubKey(path)) {
          foreach(var name in key.GetValueNames())key.DeleteValue(name,false);
          foreach(var item in snapshot.values) {
            var kind=(RegistryValueKind)item.kind;object value;
            if(kind==RegistryValueKind.Binary||kind==RegistryValueKind.None)value=Convert.FromBase64String(item.text);
            else if(kind==RegistryValueKind.MultiString)value=item.strings;
            else if(kind==RegistryValueKind.DWord)value=checked((int)item.number);
            else if(kind==RegistryValueKind.QWord)value=item.number;
            else value=item.text;
            key.SetValue(item.name,value,kind);
          }key.Flush();
        }
      }
    }
    string CaptureLink(string path) {
      InstallTransaction.RequireOrdinaryPath(path);
      if(!File.Exists(path))return null;
      // Never overwrite a same-name shortcut belonging to an unrelated app.
      var target=ReadLink(path);var registered=InstallPolicy.RegisteredDirectory();
      if(String.IsNullOrWhiteSpace(registered)||!InstallPolicy.SamePath(target,Path.Combine(registered,"WindChime.exe")))throw new IOException("同名快捷方式不属于当前风铃安装，已停止更新。");
      var data=File.ReadAllBytes(path);if(data.Length>1024*1024)throw new IOException("快捷方式文件大小异常。");return Convert.ToBase64String(data);
    }
    public string Capture(){return json.Serialize(new MetadataSnapshot{application=CaptureKey(ApplicationKey),uninstall=CaptureKey(UninstallKey),desktop=CaptureLink(Desktop),menu=CaptureLink(Menu)});}
    public void Restore(string value) {
      var snapshot=json.Deserialize<MetadataSnapshot>(value);if(snapshot==null)throw new IOException("安装恢复信息无效。");
      RestoreKey(ApplicationKey,snapshot.application);RestoreKey(UninstallKey,snapshot.uninstall);RestoreLink(Desktop,snapshot.desktop);RestoreLink(Menu,snapshot.menu);
    }
    static void RestoreLink(string path,string bytes){InstallTransaction.RequireOrdinaryPath(path);if(bytes==null){if(File.Exists(path))File.Delete(path);}else File.WriteAllBytes(path,Convert.FromBase64String(bytes));}
    public void Apply(string target,string version,bool desktop,bool menu) {
      using(var hive=Hive()) {
        using(var key=hive.CreateSubKey(ApplicationKey)) {key.SetValue("InstallLocation",target);key.SetValue("KeepShortcuts","true");key.SetValue("ShortcutName","风铃 WindChime");key.Flush();}
        using(var key=hive.CreateSubKey(UninstallKey)) {
          key.SetValue("DisplayName","WindChime "+version+"（安装向导版）");key.SetValue("DisplayVersion",version);key.SetValue("Publisher","WindChime contributors");
          key.SetValue("InstallLocation",target);key.SetValue("DisplayIcon",Path.Combine(target,"WindChime.exe")+",0");
          var uninstaller="\""+Path.Combine(target,"Uninstall WindChime.exe")+"\"";
          key.SetValue("UninstallString",uninstaller);key.SetValue("QuietUninstallString",uninstaller+" /S");
          key.SetValue("NoModify",1,RegistryValueKind.DWord);key.SetValue("NoRepair",1,RegistryValueKind.DWord);key.Flush();
        }
      }
      WriteLink(Desktop,target,desktop);WriteLink(Menu,target,menu);
    }
    public void Verify(string target,string version,bool desktop,bool menu) {
      using(var hive=Hive())using(var application=hive.OpenSubKey(ApplicationKey))using(var uninstall=hive.OpenSubKey(UninstallKey)) {
        if(application==null||uninstall==null||(string)application.GetValue("InstallLocation")!=target||(string)uninstall.GetValue("DisplayVersion")!=version
          ||(string)uninstall.GetValue("UninstallString")!="\""+Path.Combine(target,"Uninstall WindChime.exe")+"\"")throw new IOException("安装注册信息核对失败。");
      }
      VerifyLink(Desktop,target,desktop);VerifyLink(Menu,target,menu);
    }
    static void VerifyLink(string path,string target,bool enabled) {
      if(enabled){if(!File.Exists(path)||!InstallPolicy.SamePath(ReadLink(path),Path.Combine(target,"WindChime.exe")))throw new IOException("安装快捷方式核对失败。");}
      else if(File.Exists(path))throw new IOException("快捷方式选项未正确保存。");
    }
    static IOException ShortcutFailure(string operation,Exception cause) {
      while(cause is System.Reflection.TargetInvocationException&&cause.InnerException!=null)cause=cause.InnerException;
      return new IOException("无法"+operation+"风铃快捷方式。请检查桌面或开始菜单目录的写入权限。原因："+cause.Message,cause);
    }
    // No shortcut is executed or resolved through a shell. The installer calls
    // these helpers only for its two fixed, ownership-checked shortcut paths.
    static string ReadLink(string file) {
      object link=null;
      try {
        link=new ShellLinkObject();
        ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(file,0);
        var target=new StringBuilder(32768);
        ((IShellLinkUnicode)link).GetPath(target,target.Capacity,IntPtr.Zero,4);
        return target.ToString();
      }catch(Exception ex){throw ShortcutFailure("读取",ex);}
      finally {if(link!=null)Marshal.FinalReleaseComObject(link);}
    }
    static void WriteLink(string file,string target,bool enabled) {
      InstallTransaction.RequireOrdinaryPath(file);
      if(!enabled){if(File.Exists(file))File.Delete(file);return;}
      object link=null;
      try {
        link=new ShellLinkObject();var shortcut=(IShellLinkUnicode)link;
        shortcut.SetPath(Path.Combine(target,"WindChime.exe"));shortcut.SetWorkingDirectory(target);
        shortcut.SetDescription("风铃 · 私人审阅与手动上屏");
        ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(file,true);
      }catch(Exception ex){throw ShortcutFailure("保存",ex);}
      finally{if(link!=null)Marshal.FinalReleaseComObject(link);}
    }
  }
}
