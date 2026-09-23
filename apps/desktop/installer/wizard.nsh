; Internal install engine. The public WPF bootstrap owns all installation UI.
; This engine accepts only its private, per-run confirmed request; opening it
; directly never installs anything. The generated uninstaller retains its UI.
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define MUI_BGCOLOR F4F8FC
!define MUI_TEXTCOLOR 233A4B
!define MUI_WELCOMEPAGE_TITLE "安装风铃"
!define MUI_WELCOMEPAGE_TEXT "选择安装位置和快捷方式。$\r$\n$\r$\n安装前，请保存编辑内容，并从托盘菜单退出风铃。"
!define MUI_LICENSEPAGE_TEXT_TOP "风铃项目采用 MIT 开源许可证。以下是完整许可原文。"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "分发时请保留版权与许可声明。第三方组件沿用各自许可证。"
!define MUI_LICENSEPAGE_BUTTON "下一步(&N) >"
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "点击“完成”退出安装向导。"
!define MUI_FINISHPAGE_RUN_TEXT "启动风铃"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_UNWELCOMEPAGE_TEXT "此向导将卸载这份风铃程序。$\r$\n$\r$\n连接凭据和个人设置将保留，网站中的信件不会被删除。$\r$\n$\r$\n请先保存编辑内容，并从托盘菜单退出风铃。"

!ifndef BUILD_UNINSTALLER
Var WCDesktopChoice
Var WCMenuChoice
Var WCDesktopControl
Var WCMenuControl
Var WCDialog
Var WCLegacy
Var WCConfirmed
Var WCOriginalDir
Var WCLegacyDir
Var WCValidationError
Var WCBootstrapToken
!else
Var WCUnValidationError
Var WCUnCanonical
Var WCUnDepth
Var WCUnSeen
!endif

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${IfNot} ${Silent}
  ${OrIf} ${isUpdated}
  ${OrIf} ${isForAllUsers}
    SetErrorLevel 87
    Quit
  ${EndIf}
  ${GetParameters} $0
  ${GetOptions} $0 "/WC_BOOTSTRAP=" $WCBootstrapToken
  ${If} ${Errors}
    SetErrorLevel 87
    Quit
  ${EndIf}
  StrLen $0 $WCBootstrapToken
  ${If} $0 != 32
    SetErrorLevel 87
    Quit
  ${EndIf}
  ReadINIStr $0 "$EXEDIR\request.ini" "WindChime" "Token"
  ReadINIStr $1 "$EXEDIR\request.ini" "WindChime" "AppId"
  ReadINIStr $2 "$EXEDIR\request.ini" "WindChime" "Protocol"
  ${If} $0 != $WCBootstrapToken
  ${OrIf} $1 != "${APP_ID}"
  ${OrIf} $2 != "1"
    SetErrorLevel 87
    Quit
  ${EndIf}
  StrCpy $WCDesktopChoice ${BST_CHECKED}
  StrCpy $WCMenuChoice ${BST_CHECKED}
  StrCpy $WCConfirmed "0"
  StrCpy $WCLegacy "0"
  ReadRegStr $WCLegacyDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "InstallLocation"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "UninstallString"
  ${If} $0 != ""
    StrCpy $WCLegacy "1"
  ${EndIf}
  SetRegView 32
  ${If} $WCLegacyDir == ""
    ReadRegStr $WCLegacyDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "InstallLocation"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "UninstallString"
  SetRegView 64
  ${If} $0 != ""
    StrCpy $WCLegacy "1"
  ${EndIf}
  ${If} ${FileExists} "$LOCALAPPDATA\WindChime\Update.exe"
    StrCpy $WCLegacy "1"
  ${EndIf}
  ReadINIStr $INSTDIR "$EXEDIR\request.ini" "WindChime" "Directory"
  ReadINIStr $WCDesktopChoice "$EXEDIR\request.ini" "WindChime" "Desktop"
  ReadINIStr $WCMenuChoice "$EXEDIR\request.ini" "WindChime" "StartMenu"
  ${If} $INSTDIR == ""
    SetErrorLevel 87
    Quit
  ${EndIf}
  ${If} $WCDesktopChoice != "0"
  ${AndIf} $WCDesktopChoice != "1"
    SetErrorLevel 87
    Quit
  ${EndIf}
  ${If} $WCMenuChoice != "0"
  ${AndIf} $WCMenuChoice != "1"
    SetErrorLevel 87
    Quit
  ${EndIf}
  Call WCValidateDirectory
  ${If} $WCValidationError != ""
    SetErrorLevel 87
    Quit
  ${EndIf}
  StrCpy $WCConfirmed "1"
!macroend

; Prevent the upstream auto-close/force-kill behavior, including tray processes.
; nsProcess performs name lookup without interpolating paths into shell code.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    Call WCValidateDirectory
    ${If} $WCValidationError != ""
      SetErrorLevel 87
      Quit
    ${EndIf}
  !endif
  ${Do}
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    ${If} $0 == 603
      ${ExitDo}
    ${ElseIf} $0 == 0
      ${If} ${Silent}
        SetErrorLevel 32
        Quit
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "风铃仍在运行（可能在托盘中）。$\r$\n请先保存编辑内容，从风铃托盘选择“退出并结束展示”，再点击“重试”。$\r$\n安装器不会强制关闭程序。" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 32
      Quit
    ${Else}
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认风铃是否已退出，请关闭安装向导后重试。"
      ${EndIf}
      SetErrorLevel 32
      Quit
    ${EndIf}
  ${Loop}
!macroend

!macro customHeader
SetFont /LANG=2052 "Microsoft YaHei UI" 9
!ifndef BUILD_UNINSTALLER
; Compile functions after upstream MUI pages have declared their variables.
; Inputs: $3 forbidden root, $6 candidate. Include the separator boundary.
Function WCRejectDescendant
  ${If} $3 == ""
    Return
  ${EndIf}
  GetFullPathName $3 "$3"
  System::Call 'kernel32::GetLongPathNameW(w r3, w .r7, i ${NSIS_MAX_STRLEN})i.r8'
  ${If} $8 != 0
    StrCpy $3 $7
  ${EndIf}
  StrCpy $3 "$3\"
  StrLen $4 $3
  StrCpy $5 "$6\" $4
  ${If} $3 == $5
    StrCpy $WCValidationError "请选择独立的程序目录，不要选择旧版程序、系统或个人配置目录及其子目录。"
  ${EndIf}
FunctionEnd

; Called before the confirmation page and again immediately before extraction.
; A new installation must use a new/empty dedicated WindChime subdirectory.
Function WCValidateDirectory
  StrCpy $WCValidationError ""
  GetFullPathName $INSTDIR "$INSTDIR"
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "WindChime"
    StrCpy $INSTDIR "$INSTDIR\WindChime"
  ${EndIf}
  GetFullPathName $INSTDIR "$INSTDIR"
  StrCpy $6 $INSTDIR
  ; Never overlap the legacy install or the persistent credential directory.
  StrCpy $3 "$LOCALAPPDATA\WindChime"
  Call WCRejectDescendant
  StrCpy $3 "$APPDATA"
  Call WCRejectDescendant
  StrCpy $3 "$WINDIR"
  Call WCRejectDescendant
  StrCpy $3 $WCLegacyDir
  Call WCRejectDescendant
  ${If} $WCValidationError != ""
    Return
  ${EndIf}
  ; Refuse junction/symlink ancestors; do not redirect later uninstall writes.
  StrCpy $1 $INSTDIR
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'
    ${If} $2 != -1
      IntOp $2 $2 & 0x400
      ${If} $2 != 0
        StrCpy $WCValidationError "安装目录不能经过目录链接。请选择普通文件夹。"
        Return
      ${EndIf}
      ; Expand existing short-name ancestors before comparing the protected roots.
      System::Call 'kernel32::GetLongPathNameW(w r1, w .r6, i ${NSIS_MAX_STRLEN})i.r2'
      ${If} $2 != 0
        StrCpy $3 "$LOCALAPPDATA\WindChime"
        Call WCRejectDescendant
        StrCpy $3 "$APPDATA"
        Call WCRejectDescendant
        StrCpy $3 "$WINDIR"
        Call WCRejectDescendant
        StrCpy $3 $WCLegacyDir
        Call WCRejectDescendant
        ${If} $WCValidationError != ""
          Return
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${GetParent} "$1" $2
    ${If} $2 == ""
    ${OrIf} $2 == $1
      ${ExitDo}
    ${EndIf}
    StrCpy $1 $2
  ${Loop}
  ReadRegStr $WCOriginalDir HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $WCOriginalDir != ""
    GetFullPathName $WCOriginalDir "$WCOriginalDir"
  ${EndIf}
  ${If} $INSTDIR == $WCOriginalDir
  ${AndIf} ${FileExists} "$INSTDIR\resources\windchime-install.ini"
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\resources")i.r2'
    IntOp $2 $2 & 0x400
    ${If} $2 != 0
      StrCpy $WCValidationError "安装文件不能经过目录链接。"
      Return
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\resources\windchime-install.ini")i.r2'
    IntOp $2 $2 & 0x400
    ${If} $2 != 0
      StrCpy $WCValidationError "安装标记不能是文件链接。"
      Return
    ${EndIf}
    ReadINIStr $0 "$INSTDIR\resources\windchime-install.ini" "WindChime" "AppId"
    ${If} $0 == "${APP_ID}"
      Return
    ${EndIf}
  ${EndIf}
  FindFirst $0 $1 "$INSTDIR\*"
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      StrCpy $WCValidationError "所选目录已有文件。请选择新的空文件夹，或此安装向导先前安装风铃的位置。"
      Return
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
FunctionEnd

Function WCConfirmPage
  StrCpy $WCConfirmed "0"
  Call WCValidateDirectory
  !insertmacro MUI_HEADER_TEXT "安装选项" "确认后点击“安装”。"
  nsDialogs::Create 1018
  Pop $WCDialog
  ${If} $WCDialog == error
    SetErrorLevel 87
    Quit
  ${EndIf}
  SetCtlColors $WCDialog 233A4B F4F8FC
  ${NSD_CreateLabel} 0u 0u 300u 12u "安装位置（仅当前 Windows 用户）"
  Pop $0
  ${NSD_CreateLabel} 0u 17u 300u 28u "$INSTDIR"
  Pop $0
  ${NSD_CreateCheckbox} 0u 50u 300u 14u "创建桌面快捷方式"
  Pop $WCDesktopControl
  ${NSD_SetState} $WCDesktopControl $WCDesktopChoice
  ${NSD_CreateCheckbox} 0u 70u 300u 14u "添加到开始菜单"
  Pop $WCMenuControl
  ${NSD_SetState} $WCMenuControl $WCMenuChoice
  ${If} $WCValidationError != ""
    ${NSD_CreateLabel} 0u 100u 300u 54u "$WCValidationError$\r$\n请点击“上一步”重新选择。"
  ${ElseIf} $WCLegacy == "1"
    ${NSD_CreateLabel} 0u 100u 300u 54u "检测到旧版。新版将独立安装并沿用连接设置，旧版不会自动卸载。$\r$\n快捷方式名为“风铃 WindChime”。"
  ${Else}
    ${NSD_CreateLabel} 0u 104u 300u 42u "更新会保留已有连接和个人设置。"
  ${EndIf}
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装(&I)"
  ${If} $WCValidationError != ""
    EnableWindow $0 0
  ${Else}
    EnableWindow $0 1
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function WCConfirmLeave
  ${NSD_GetState} $WCDesktopControl $WCDesktopChoice
  ${NSD_GetState} $WCMenuControl $WCMenuChoice
  Call WCValidateDirectory
  ${If} $WCValidationError != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$WCValidationError"
    Abort
  ${EndIf}
  StrCpy $WCConfirmed "1"
FunctionEnd

Function WCBeforeInstall
  ${If} $WCConfirmed != "1"
    SetErrorLevel 87
    Quit
  ${EndIf}
  ; Our normalizer already produces a dedicated WindChime folder. Keep the
  ; upstream generated pre-function referenced without relying on its substring test.
  Call instFilesPre
  Call WCValidateDirectory
  ${If} $WCValidationError != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$WCValidationError"
    SetErrorLevel 87
    Quit
  ${EndIf}
FunctionEnd
!else
; Read-only uninstall preflight. The upstream updater's un.atomicRMDir walks
; directories recursively, so checking only resources/marker would leave other
; linked descendants exposed. Check the complete tree again before any mutation.
Function un.WCCheckTree
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  StrCpy $1 -1
  StrCpy $5 0
  IntOp $WCUnDepth $WCUnDepth + 1
  ${If} $WCUnDepth > 64
    StrCpy $WCUnValidationError "安装目录层级异常，已停止卸载。"
    Goto wc_un_tree_done
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w r0)i.r3'
  ${If} $3 == -1
    StrCpy $WCUnValidationError "无法读取安装目录，已停止卸载。"
    Goto wc_un_tree_done
  ${EndIf}
  IntOp $4 $3 & 0x400
  ${If} $4 != 0
    StrCpy $WCUnValidationError "安装目录中存在目录或文件链接，已停止卸载。"
    Goto wc_un_tree_done
  ${EndIf}
  IntOp $4 $3 & 0x10
  ${If} $4 == 0
    StrCpy $WCUnValidationError "安装位置不是目录，已停止卸载。"
    Goto wc_un_tree_done
  ${EndIf}
  ; NSIS FindNext does not preserve GetLastError across its own string/plugin
  ; work. Capture the native result with System's ?e option in the same call.
  ; WIN32_FIND_DATAW is 592 bytes; cFileName starts after its 44-byte header.
  System::Alloc 592
  Pop $5
  ${If} $5 == 0
    StrCpy $WCUnValidationError "无法分配目录检查内存，已停止卸载。"
    Goto wc_un_tree_done
  ${EndIf}
  System::Call 'kernel32::FindFirstFileW(w "$0\*", p r5)p.r1 ?e'
  Pop $6
  ${If} $1 == -1
    ${If} $6 != 2
    ${AndIf} $6 != 18
      StrCpy $WCUnValidationError "无法检查安装目录中的文件，已停止卸载。"
    ${EndIf}
    Goto wc_un_tree_done
  ${EndIf}
  ${Do}
    IntOp $6 $5 + 44
    System::Call '*$6(&w260 .r2)'
    ${If} $2 != "."
    ${AndIf} $2 != ".."
      IntOp $WCUnSeen $WCUnSeen + 1
      ${If} $WCUnSeen > 100000
        StrCpy $WCUnValidationError "安装目录文件数量异常，已停止卸载。"
        ${ExitDo}
      ${EndIf}
      StrLen $3 $0
      StrLen $4 $2
      IntOp $3 $3 + $4
      IntOp $3 $3 + 2
      ${If} $3 >= ${NSIS_MAX_STRLEN}
        StrCpy $WCUnValidationError "安装文件路径过长，无法安全确认卸载范围。"
        ${ExitDo}
      ${EndIf}
      StrCpy $4 "$0\$2"
      System::Call 'kernel32::GetFileAttributesW(w r4)i.r3'
      ${If} $3 == -1
        StrCpy $WCUnValidationError "安装文件发生变化或无法读取，已停止卸载。"
        ${ExitDo}
      ${EndIf}
      IntOp $4 $3 & 0x400
      ${If} $4 != 0
        StrCpy $WCUnValidationError "安装目录中存在目录或文件链接，已停止卸载。"
        ${ExitDo}
      ${EndIf}
      IntOp $4 $3 & 0x10
      ${If} $4 != 0
        Push "$0\$2"
        Call un.WCCheckTree
        ${If} $WCUnValidationError != ""
          ${ExitDo}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::FindNextFileW(p r1, p r5)i.r3 ?e'
    Pop $6
    ${If} $3 == 0
      ${If} $6 != 18
        StrCpy $WCUnValidationError "读取安装目录时遇到异常，已停止卸载。"
      ${EndIf}
      ${ExitDo}
    ${EndIf}
  ${Loop}
  wc_un_tree_done:
  ${If} $1 != -1
    System::Call 'kernel32::FindClose(p r1)i'
  ${EndIf}
  ${If} $5 != 0
    System::Free $5
  ${EndIf}
  IntOp $WCUnDepth $WCUnDepth - 1
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Refuse either direction of overlap with persistent data, Windows or legacy
; programs. Expand existing short names before comparing separator boundaries.
Function un.WCCheckProtectedRoot
  Exch $0
  Push $1
  Push $2
  Push $3
  ${If} $0 != ""
    GetFullPathName $0 "$0"
    System::Call 'kernel32::GetLongPathNameW(w r0, w .r1, i ${NSIS_MAX_STRLEN})i.r2'
    ${If} $2 != 0
      StrCpy $0 $1
    ${EndIf}
    StrCpy $0 "$0\"
    StrCpy $1 "$WCUnCanonical\"
    StrLen $2 $0
    StrCpy $3 $1 $2
    ${If} $3 == $0
      StrCpy $WCUnValidationError "安装位置与个人数据、系统或旧版程序重叠，已停止卸载。"
    ${EndIf}
    StrLen $2 $1
    StrCpy $3 $0 $2
    ${If} $3 == $1
      StrCpy $WCUnValidationError "安装位置包含个人数据、系统或旧版程序，已停止卸载。"
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.WCVerifyTarget
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $WCUnValidationError ""
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 == ""
    Goto wc_un_invalid
  ${EndIf}
  GetFullPathName $0 "$0"
  GetFullPathName $1 "$INSTDIR"
  ${If} $0 != $1
    Goto wc_un_invalid
  ${EndIf}
  ${GetFileName} "$1" $2
  ${If} $2 != "WindChime"
    Goto wc_un_invalid
  ${EndIf}
  StrCpy $WCUnCanonical $1
  System::Call 'kernel32::GetLongPathNameW(w r1, w .r0, i ${NSIS_MAX_STRLEN})i.r2'
  ${If} $2 == 0
    Goto wc_un_invalid
  ${EndIf}
  StrCpy $WCUnCanonical $0
  ; Reject replacement of the install root or any ancestor with a reparse point.
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'
    ${If} $2 == -1
      Goto wc_un_invalid
    ${EndIf}
    IntOp $3 $2 & 0x400
    ${If} $3 != 0
      Goto wc_un_invalid
    ${EndIf}
    ${GetParent} "$1" $0
    ${If} $0 == ""
    ${OrIf} $0 == $1
      ${ExitDo}
    ${EndIf}
    StrCpy $1 $0
  ${Loop}
  Push "$APPDATA"
  Call un.WCCheckProtectedRoot
  Push "$WINDIR"
  Call un.WCCheckProtectedRoot
  Push "$LOCALAPPDATA\WindChime"
  Call un.WCCheckProtectedRoot
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "InstallLocation"
  Push $0
  Call un.WCCheckProtectedRoot
  SetRegView 32
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WindChime" "InstallLocation"
  SetRegView 64
  Push $0
  Call un.WCCheckProtectedRoot
  ${If} $WCUnValidationError != ""
    Goto wc_un_invalid
  ${EndIf}
  StrCpy $WCUnDepth 0
  StrCpy $WCUnSeen 0
  Push "$INSTDIR"
  Call un.WCCheckTree
  ${If} $WCUnValidationError != ""
    Goto wc_un_invalid
  ${EndIf}
  ; Only read the marker after the complete tree has passed its link checks.
  ReadINIStr $0 "$INSTDIR\resources\windchime-install.ini" "WindChime" "AppId"
  ${If} $0 != "${APP_ID}"
    Goto wc_un_invalid
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Return
  wc_un_invalid:
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法安全确认这份风铃的安装目录。已停止卸载，个人设置未被删除。$\r$\n请检查安装位置是否被移动或包含目录、文件链接。"
  ${EndIf}
  SetErrorLevel 87
  Quit
FunctionEnd
!endif
!macroend

!macro customPageAfterChangeDir
  ; Replace the upstream substring-based directory sanitizer with our own check.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  Page custom WCConfirmPage WCConfirmLeave
  !define MUI_PAGE_CUSTOMFUNCTION_PRE WCBeforeInstall
!macroend

!macro customInstall
  WriteINIStr "$INSTDIR\resources\windchime-install.ini" "WindChime" "AppId" "${APP_ID}"
  WriteINIStr "$INSTDIR\resources\windchime-install.ini" "WindChime" "Version" "${VERSION}"
  ${If} $WCDesktopChoice == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  ${If} $WCMenuChoice == ${BST_CHECKED}
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInit
  ; Upgrades use the upstream KEEP_APP_DATA contract; explicit deletion is not
  ; supported by this product's uninstaller, even when supplied on a command line.
  ${GetParameters} $0
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    SetErrorLevel 87
    Quit
  ${EndIf}
  Call un.WCVerifyTarget
!macroend

!macro customUnInstall
  ; The confirmation window can stay open while the directory changes. Repeat
  ; the read-only check immediately before shortcuts or application files move.
  Call un.WCVerifyTarget
  ; These two dedicated names are owned by this installer, never by Squirrel.
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
!macroend
