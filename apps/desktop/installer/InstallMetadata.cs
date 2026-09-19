using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace WindChime.Setup {
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
    // Late-bound Windows Shell COM, limited to these two fixed shortcut paths.
    static string ReadLink(string file) {
      object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")),link=null;
      try {link=shell.GetType().InvokeMember("CreateShortcut",System.Reflection.BindingFlags.InvokeMethod,null,shell,new object[]{file});return (string)link.GetType().InvokeMember("TargetPath",System.Reflection.BindingFlags.GetProperty,null,link,null);}
      finally {if(link!=null)Marshal.FinalReleaseComObject(link);Marshal.FinalReleaseComObject(shell);}
    }
    static void WriteLink(string file,string target,bool enabled) {
      InstallTransaction.RequireOrdinaryPath(file);
      if(!enabled){if(File.Exists(file))File.Delete(file);return;}
      object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")),link=null;
      try {
        link=shell.GetType().InvokeMember("CreateShortcut",System.Reflection.BindingFlags.InvokeMethod,null,shell,new object[]{file});
        foreach(var item in new[]{new[]{"TargetPath",Path.Combine(target,"WindChime.exe")},new[]{"WorkingDirectory",target},new[]{"Description","风铃 · 私人审阅与手动上屏"}})
          link.GetType().InvokeMember(item[0],System.Reflection.BindingFlags.SetProperty,null,link,new object[]{item[1]});
        link.GetType().InvokeMember("Save",System.Reflection.BindingFlags.InvokeMethod,null,link,null);
      }finally{if(link!=null)Marshal.FinalReleaseComObject(link);Marshal.FinalReleaseComObject(shell);}
    }
  }
}
