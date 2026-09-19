using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

namespace WindChime.Setup {
  public sealed class InstallTree {
    public List<PayloadFile> files {get;set;}
    public List<string> directories {get;set;}
  }
  public sealed class InstallJournal {
    public int protocol {get;set;}
    public string id {get;set;}
    public string owner {get;set;}
    public string target {get;set;}
    public string phase {get;set;}
    public bool hadTarget {get;set;}
    public InstallTree before {get;set;}
    public InstallTree after {get;set;}
    public string metadata {get;set;}
    public string version {get;set;}
    public bool desktop {get;set;}
    public bool menu {get;set;}
  }
  // The transaction knows only this product's metadata. Tests inject a file
  // implementation, never Windows registry keys or the user's shortcuts.
  public interface IInstallMetadata {
    string Capture();
    void Apply(string target,string version,bool desktop,bool menu);
    void Restore(string snapshot);
    void Verify(string target,string version,bool desktop,bool menu);
  }
  public sealed class InstallTransaction {
    public const string Prefix=".WindChime-Setup-";
    public const long MiB=1024L*1024;
    readonly IInstallMetadata metadata;
    readonly Action<string> checkpoint;
    readonly Action requireStopped;
    public string Root {get;private set;}
    public InstallJournal Journal {get;private set;}
    public string Stage {get{return Path.Combine(Root,"new");}}
    public string Old {get{return Path.Combine(Root,"old");}}
    public string Retired {get{return Path.Combine(Root,"retired");}}
    public string Engine {get{return Path.Combine(Root,"WindChime-Extract-"+Journal.id+".exe");}}
    public bool Committing {get;private set;}
    public string CleanupWarning {get;private set;}
    static readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=16*1024*1024};
    static string Owner {get{return WindowsIdentity.GetCurrent().User.Value;}}
    static string Canonical(string path){return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);}
    static void ValidateTargetLocation(string target) {
      if(!String.Equals(Path.GetFileName(target),"WindChime",StringComparison.OrdinalIgnoreCase))throw new IOException("安装位置必须是独立的 WindChime 目录。");
      var protectedRoots=InstallPolicy.LegacyDirectories();protectedRoots.Add(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));protectedRoots.Add(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
      if(protectedRoots.Any(root=>InstallPolicy.Within(target,root)||InstallPolicy.Within(root,target)))throw new IOException("安装事务不能覆盖个人数据、系统或旧版程序。");
      RequireOrdinaryPath(target);
    }
    public static string Hash(string path){using(var stream=File.OpenRead(path))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    public static long RequiredBytes(long payload,long engine,bool sameVolume) {
      if(payload<0||engine<0)throw new ArgumentOutOfRangeException();
      // New files and the engine coexist on the destination volume. The old
      // directory is renamed, not copied. NSIS File streams from the engine;
      // unlike the old builder there is no full 7z-out copy or installer cache.
      checked {var amount=payload+engine+8*MiB+(sameVolume?64*MiB:0);return amount+Math.Max(128*MiB,amount/10);}
    }
    public static long TemporaryRequiredBytes {get{return 64*MiB+128*MiB;}}
    public static void CheckSpace(string target,long payload,long engine) {
      var destination=new DriveInfo(Path.GetPathRoot(target));var temporary=new DriveInfo(Path.GetPathRoot(Path.GetTempPath()));
      bool same=String.Equals(destination.Name,temporary.Name,StringComparison.OrdinalIgnoreCase);
      if(destination.AvailableFreeSpace<RequiredBytes(payload,engine,same))throw new IOException("安装磁盘空间不足，需要同时容纳新程序和安装引擎。请释放空间后重试。");
      if(!same&&temporary.AvailableFreeSpace<TemporaryRequiredBytes)throw new IOException("Windows 临时文件所在磁盘空间不足，请释放临时磁盘空间后重试。");
    }
    public static void RequireOrdinaryPath(string path) {
      for(var node=new DirectoryInfo(Canonical(path));node!=null;node=node.Parent)
        if(node.Exists&&(node.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("安装事务不能经过目录链接。");
      if(File.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("安装事务不能使用文件链接。");
    }
    static void Walk(string root,string directory,InstallTree tree) {
      RequireOrdinaryPath(directory);
      foreach(var entry in Directory.EnumerateFileSystemEntries(directory)) {
        var attributes=File.GetAttributes(entry);
        if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("安装目录含有链接，已停止操作。");
        string relative=entry.Substring(root.Length+1).Replace('\\','/');
        InstallPolicy.PayloadPath(root,relative);
        if(relative.Length>220||tree.files.Count+tree.directories.Count>=100000)throw new IOException("安装目录大小或路径超出可安全检查的范围。");
        if((attributes&FileAttributes.Directory)!=0){tree.directories.Add(relative);Walk(root,entry,tree);}
        else tree.files.Add(new PayloadFile{path=relative,bytes=new FileInfo(entry).Length,sha256=Hash(entry)});
      }
    }
    public static InstallTree Inspect(string directory) {
      RequireOrdinaryPath(directory);
      var tree=new InstallTree{files=new List<PayloadFile>(),directories=new List<string>()};
      if(!Directory.Exists(directory))throw new DirectoryNotFoundException(directory);
      Walk(Canonical(directory),Canonical(directory),tree);return tree;
    }
    public static void VerifyFiles(string directory,IEnumerable<PayloadFile> files) {
      RequireOrdinaryPath(directory);
      foreach(var item in files) {
        var file=InstallPolicy.PayloadPath(directory,item.path);RequireOrdinaryPath(file);
        if(!File.Exists(file)||new FileInfo(file).Length!=item.bytes||!String.Equals(Hash(file),item.sha256,StringComparison.OrdinalIgnoreCase))throw new IOException("安装文件核对失败："+item.path);
      }
    }
    static void VerifyTree(string directory,InstallTree expected) {
      if(expected==null||expected.files==null||expected.directories==null)throw new IOException("安装事务文件清单无效。");
      var actual=Inspect(directory);
      if(!actual.files.Select(f=>f.path).OrderBy(x=>x,StringComparer.OrdinalIgnoreCase).SequenceEqual(expected.files.Select(f=>f.path).OrderBy(x=>x,StringComparer.OrdinalIgnoreCase),StringComparer.OrdinalIgnoreCase)
        ||!actual.directories.OrderBy(x=>x,StringComparer.OrdinalIgnoreCase).SequenceEqual(expected.directories.OrderBy(x=>x,StringComparer.OrdinalIgnoreCase),StringComparer.OrdinalIgnoreCase))throw new IOException("安装目录出现不属于本次事务的文件，已停止恢复。");
      VerifyFiles(directory,expected.files);
    }
    // No recursive delete: validate the complete exact tree, unlink manifest
    // files, then remove only known empty directories from deepest to shallowest.
    static void RemoveTree(string directory,InstallTree expected,Action<string> checkpoint=null) {
      if(!Directory.Exists(directory))return;
      // Cleanup itself may be interrupted. Permit an already-removed subset,
      // but never new names, altered bytes or redirected directories.
      var actual=Inspect(directory);var files=expected.files.ToDictionary(f=>f.path,StringComparer.OrdinalIgnoreCase);
      if(actual.files.Any(f=>!files.ContainsKey(f.path)||files[f.path].bytes!=f.bytes||files[f.path].sha256!=f.sha256)
        ||actual.directories.Any(d=>!expected.directories.Contains(d,StringComparer.OrdinalIgnoreCase)))throw new IOException("恢复备份已被修改，已停止清理。");
      foreach(var file in actual.files){File.Delete(InstallPolicy.PayloadPath(directory,file.path));if(checkpoint!=null)checkpoint("cleanup-file");}
      foreach(var child in actual.directories.OrderByDescending(x=>x.Length))Directory.Delete(InstallPolicy.PayloadPath(directory,child),false);
      Directory.Delete(directory,false);
    }
    InstallTransaction(string root,InstallJournal journal,IInstallMetadata store,Action<string> fault,Action stopped){Root=root;Journal=journal;metadata=store;checkpoint=fault??(_=>{});requireStopped=stopped??(()=>{});}
    public static InstallTransaction Begin(string target,string version,bool desktop,bool menu,IInstallMetadata store,Action<string> fault=null,Action stopped=null) {
      target=Canonical(target);ValidateTargetLocation(target);
      if(FindPending(target).Any())throw new IOException("存在尚未恢复的安装事务，请先恢复。");
      var id=Guid.NewGuid().ToString("N");var root=Path.Combine(Path.GetDirectoryName(target),Prefix+id);
      var security=new DirectorySecurity();security.SetAccessRuleProtection(true,false);
      security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      var journal=new InstallJournal {protocol=1,id=id,owner=Owner,target=target,phase="created",version=version,desktop=desktop,menu=menu,hadTarget=Directory.Exists(target),metadata=store.Capture()};
      if(journal.hadTarget)journal.before=Inspect(target);
      Directory.CreateDirectory(root,security);
      var transaction=new InstallTransaction(root,journal,store,fault,stopped);transaction.Save("created");Directory.CreateDirectory(transaction.Stage);return transaction;
    }
    public static IEnumerable<string> FindPending(string target) {
      var parent=Path.GetDirectoryName(Canonical(target));RequireOrdinaryPath(parent);
      return Directory.Exists(parent)?Directory.GetDirectories(parent,Prefix+"*",SearchOption.TopDirectoryOnly):new string[0];
    }
    public static InstallTransaction Load(string root,string target,IInstallMetadata store,Action<string> fault=null,Action stopped=null) {
      root=Canonical(root);target=Canonical(target);RequireOrdinaryPath(root);ValidateTargetLocation(target);
      if(!String.Equals(Path.GetDirectoryName(root),Path.GetDirectoryName(target),StringComparison.OrdinalIgnoreCase))throw new IOException("安装事务不属于所选位置。");
      var journalFile=Path.Combine(root,"journal.json");RequireOrdinaryPath(journalFile);
      var journal=json.Deserialize<InstallJournal>(File.ReadAllText(journalFile,Encoding.UTF8));
      if(journal==null||journal.protocol!=1||journal.owner!=Owner||!System.Text.RegularExpressions.Regex.IsMatch(journal.id??"",@"\A[0-9a-f]{32}\z")||Path.GetFileName(root)!=Prefix+journal.id||!String.Equals(Canonical(journal.target),target,StringComparison.OrdinalIgnoreCase))throw new IOException("安装恢复记录的身份或路径不匹配。");
      return new InstallTransaction(root,journal,store,fault,stopped);
    }
    void Save(string phase) {
      Journal.phase=phase;var target=Path.Combine(Root,"journal.json");var temporary=Path.Combine(Root,"journal.next");RequireOrdinaryPath(Root);
      using(var file=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){
        var bytes=Encoding.UTF8.GetBytes(json.Serialize(Journal));file.Write(bytes,0,bytes.Length);file.Flush(true);
      }
      if(File.Exists(target))File.Replace(temporary,target,null);else File.Move(temporary,target);
      checkpoint(phase);
    }
    public void Prepared(IEnumerable<PayloadFile> expected) {
      VerifyFiles(Stage,expected);Journal.after=Inspect(Stage);
      if(Journal.after.files.Count!=expected.Count())throw new IOException("暂存目录含有未声明的安装文件。");
      Save("prepared");
    }
    public void Commit() {
      if(Journal.phase!="prepared")throw new IOException("安装文件尚未核对。");
      Committing=true;requireStopped();VerifyTree(Stage,Journal.after);
      if(new DriveInfo(Path.GetPathRoot(Journal.target)).AvailableFreeSpace<128*MiB)throw new IOException("剩余磁盘空间不足以安全提交安装，原版本将保留。");
      if(Journal.hadTarget)VerifyTree(Journal.target,Journal.before);else if(Directory.Exists(Journal.target)||File.Exists(Journal.target))throw new IOException("安装位置已被其他程序创建。");
      Save("move-old");
      if(Journal.hadTarget)Directory.Move(Journal.target,Old);
      checkpoint("old-moved");Save("move-new");Directory.Move(Stage,Journal.target);checkpoint("new-moved");Save("metadata");
      metadata.Apply(Journal.target,Journal.version,Journal.desktop,Journal.menu);
      checkpoint("metadata-written");metadata.Verify(Journal.target,Journal.version,Journal.desktop,Journal.menu);VerifyTree(Journal.target,Journal.after);
      Save("committed");Committing=false;
      try {Cleanup();}catch(Exception ex){CleanupWarning="安装已完成，恢复备份暂时保留："+ex.Message;}
    }
    public void Recover() {
      requireStopped();RequireOrdinaryPath(Root);
      if(Journal.phase=="committed") {VerifyTree(Journal.target,Journal.after);metadata.Verify(Journal.target,Journal.version,Journal.desktop,Journal.menu);Cleanup();return;}
      // Before moving anything, both copies must match their recorded manifests.
      if(Directory.Exists(Old)) {
        VerifyTree(Old,Journal.before);
        if(Directory.Exists(Journal.target)){VerifyTree(Journal.target,Journal.after);if(Directory.Exists(Retired))throw new IOException("恢复目录冲突。");Directory.Move(Journal.target,Retired);}
        Directory.Move(Old,Journal.target);
      } else if(Journal.hadTarget) VerifyTree(Journal.target,Journal.before);
      else if(Directory.Exists(Journal.target)) {
        VerifyTree(Journal.target,Journal.after);if(Directory.Exists(Retired))throw new IOException("恢复目录冲突。");Directory.Move(Journal.target,Retired);
      }
      checkpoint("files-restored");metadata.Restore(Journal.metadata);checkpoint("metadata-restored");
      // A partial extraction is our fresh private directory, never the target.
      // Record its actual tree before cleanup; no unknown path can enter it.
      if(Directory.Exists(Stage))RemoveTree(Stage,Inspect(Stage));
      if(Directory.Exists(Retired))RemoveTree(Retired,Journal.after);
      Save("restored");Cleanup();Committing=false;
    }
    public void Cleanup() {
      if(Journal.phase=="committed"&&Directory.Exists(Old))RemoveTree(Old,Journal.before,checkpoint);
      foreach(var name in new[]{"request.ini",Path.GetFileName(Engine),"journal.next"}){var file=Path.Combine(Root,name);RequireOrdinaryPath(file);if(File.Exists(file))File.Delete(file);}
      var extras=Directory.EnumerateFileSystemEntries(Root).Where(p=>Path.GetFileName(p)!="journal.json").ToArray();
      if(extras.Length!=0)throw new IOException("事务目录含有未确认文件，已保留供恢复。");
      File.Delete(Path.Combine(Root,"journal.json"));Directory.Delete(Root,false);
    }
  }
}
