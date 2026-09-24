using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Threading;

namespace WindChime.Setup {
  // The native Common Item Dialog provides the current Windows folder picker
  // without depending on WinForms internals or a legacy tree-view dialog.
  public static class FolderPicker {
    const int Cancelled = unchecked((int)0x800704C7);
    const uint PickFolders = 0x00000020;
    const uint ForceFileSystem = 0x00000040;
    const uint PathMustExist = 0x00000800;
    const uint NoChangeDirectory = 0x00000008;
    const uint DontAddToRecent = 0x02000000;
    const uint FileSystemPath = 0x80058000;

    public static string Show(IntPtr owner, string directory) {
      if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
        throw new InvalidOperationException("文件夹选择器必须在安装向导的界面线程打开。");

      IFileDialog dialog = null;
      IShellItem initialFolder = null;
      IShellItem selectedFolder = null;
      IntPtr selectedPath = IntPtr.Zero;
      try {
        dialog = (IFileDialog)new NativeFileOpenDialog();
        uint options;
        dialog.GetOptions(out options);
        dialog.SetOptions(options | PickFolders | ForceFileSystem | PathMustExist | NoChangeDirectory | DontAddToRecent);
        dialog.SetTitle("选择风铃安装文件夹");
        dialog.SetOkButtonLabel("选择此文件夹");

        var existing = ExistingDirectory(directory);
        if (existing != null) {
          var shellItemId = typeof(IShellItem).GUID;
          Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(existing, IntPtr.Zero, ref shellItemId, out initialFolder));
          // The path field is the user's current choice. Start there instead of
          // a folder remembered by an unrelated earlier file dialog.
          dialog.SetFolder(initialFolder);
        }

        int result = dialog.Show(owner);
        if (result == Cancelled) return null;
        Marshal.ThrowExceptionForHR(result);
        dialog.GetResult(out selectedFolder);
        selectedFolder.GetDisplayName(FileSystemPath, out selectedPath);
        return Marshal.PtrToStringUni(selectedPath);
      } finally {
        if (selectedPath != IntPtr.Zero) Marshal.FreeCoTaskMem(selectedPath);
        Release(selectedFolder);
        Release(initialFolder);
        Release(dialog);
      }
    }

    // New installations often point at a folder that has not been created yet.
    // Browsing starts at its nearest existing parent and never creates it here.
    internal static string ExistingDirectory(string directory) {
      if (String.IsNullOrWhiteSpace(directory)) return null;
      try {
        if (!Path.IsPathRooted(directory)) return null;
        var candidate = new DirectoryInfo(Path.GetFullPath(directory));
        while (candidate != null) {
          if (candidate.Exists) return candidate.FullName;
          candidate = candidate.Parent;
        }
      } catch (ArgumentException) {
      } catch (NotSupportedException) {
      } catch (IOException) {
      } catch (SecurityException) {
      } catch (UnauthorizedAccessException) {
      }
      return null;
    }

    static void Release(object value) {
      if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext,
      ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    class NativeFileOpenDialog { }

    // IModalWindow::Show is the first inherited slot. Keep the IFileDialog
    // methods in their native vtable order, including unused intervening slots.
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
      [PreserveSig] int Show(IntPtr owner);
      void SetFileTypes(uint count, IntPtr filters);
      void SetFileTypeIndex(uint index);
      void GetFileTypeIndex(out uint index);
      void Advise(IntPtr events, out uint cookie);
      void Unadvise(uint cookie);
      void SetOptions(uint options);
      void GetOptions(out uint options);
      void SetDefaultFolder(IShellItem folder);
      void SetFolder(IShellItem folder);
      void GetFolder(out IShellItem folder);
      void GetCurrentSelection(out IShellItem item);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
      void GetResult(out IShellItem item);
      void AddPlace(IShellItem item, uint alignment);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
      void Close(int result);
      void SetClientGuid(ref Guid client);
      void ClearClientData();
      void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
      void BindToHandler(IntPtr bindContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr result);
      void GetParent(out IShellItem parent);
      void GetDisplayName(uint form, out IntPtr name);
      void GetAttributes(uint mask, out uint attributes);
      void Compare(IShellItem other, uint hint, out int order);
    }
  }
}
