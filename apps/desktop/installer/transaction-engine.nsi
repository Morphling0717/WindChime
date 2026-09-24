Unicode true
Name "风铃"
OutFile "${WC_OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
; Non-solid compression streams each File directly to its private destination.
; Solid LZMA would create a complete uncompressed temporary cache and invalidate
; the per-volume disk-space budget.
SetCompressor lzma
SetOverwrite on
Icon "${WC_ICON}"
UninstallIcon "${WC_ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "WindChime"
VIAddVersionKey /LANG=2052 "FileDescription" "风铃安装事务引擎"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (c) 2026 WindChime contributors"

!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!define BUILD_UNINSTALLER
!include "wizard.nsh"
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro customHeader

Var WCTransaction
Var WCToken
Var WCStage
Var WCRemoveError
Function .onInit
  !ifdef WC_GENERATE_UNINSTALLER
    WriteUninstaller "${WC_UNINSTALLER}"
    SetErrorLevel 0
    Quit
  !else
    ${IfNot} ${Silent}
      Goto invalid
    ${EndIf}
    ${GetParameters} $0
    ${GetOptions} $0 "/WC_BOOTSTRAP=" $WCToken
    ${If} ${Errors}
      Goto invalid
    ${EndIf}
    StrLen $0 $WCToken
    ${If} $0 != 32
      Goto invalid
    ${EndIf}
    ReadINIStr $0 "$EXEDIR\request.ini" "WindChime" "Token"
    ${If} $0 != $WCToken
      Goto invalid
    ${EndIf}
    ReadINIStr $0 "$EXEDIR\request.ini" "WindChime" "Protocol"
    ${If} $0 != "2"
      Goto invalid
    ${EndIf}
    ReadINIStr $0 "$EXEDIR\request.ini" "WindChime" "AppId"
    ${If} $0 != "${APP_ID}"
      Goto invalid
    ${EndIf}
    ReadINIStr $WCTransaction "$EXEDIR\request.ini" "WindChime" "Transaction"
    StrLen $0 $WCTransaction
    ${If} $0 != 32
      Goto invalid
    ${EndIf}
    ${GetFileName} "$EXEDIR" $0
    ${If} $0 != ".WindChime-Setup-$WCTransaction"
      Goto invalid
    ${EndIf}
    StrCpy $WCStage "$EXEDIR\new"
    ReadINIStr $0 "$EXEDIR\request.ini" "WindChime" "Stage"
    ${If} $0 != $WCStage
      Goto invalid
    ${EndIf}
    StrCpy $1 $WCStage
    ${Do}
      System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'
      ${If} $2 == -1
        Goto invalid
      ${EndIf}
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        Goto invalid
      ${EndIf}
      ${GetParent} "$1" $2
      ${If} $2 == ""
      ${OrIf} $1 == $2
        ${ExitDo}
      ${EndIf}
      StrCpy $1 $2
    ${Loop}
    FindFirst $0 $1 "$WCStage\*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        FindClose $0
        Goto invalid
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
    Return
    invalid:
    SetErrorLevel 87
    Quit
  !endif
FunctionEnd

Section "Extract verified package to private stage"
  !ifndef WC_GENERATE_UNINSTALLER
    SetOutPath "$WCStage"
    ClearErrors
    File /r "${WC_PAYLOAD}\*"
    ${If} ${Errors}
      SetErrorLevel 74
      Quit
    ${EndIf}
  !endif
SectionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext current
  !insertmacro customUnInit
  ${GetParent} "$INSTDIR" $0
  FindFirst $1 $2 "$0\.WindChime-Setup-*"
  FindClose $1
  ${If} $2 != ""
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "存在未完成的安装恢复记录，请先重新运行风铃安装向导完成恢复，再卸载。"
    ${EndIf}
    SetErrorLevel 87
    Quit
  ${EndIf}
FunctionEnd

; Delete ordinary payload first. A locked file must leave both the ownership
; marker and installed uninstaller intact so a subsequent attempt can continue.
Function un.WCRemovePayload
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  ClearErrors
  FindFirst $1 $2 "$0\*"
  ${If} ${Errors}
    StrCpy $WCRemoveError "无法读取待卸载目录"
    Goto removal_done
  ${EndIf}
  ${DoWhile} $2 != ""
    ${If} $2 != "."
    ${AndIf} $2 != ".."
      StrCpy $4 "$0\$2"
      ${If} $4 != "$INSTDIR\resources\windchime-install.ini"
      ${AndIf} $4 != "$INSTDIR\Uninstall WindChime.exe"
        System::Call 'kernel32::GetFileAttributesW(w r4)i.r3'
        ${If} $3 == -1
          StrCpy $WCRemoveError "待卸载文件已发生变化"
          ${ExitDo}
        ${EndIf}
        IntOp $3 $3 & 0x400
        ${If} $3 != 0
          StrCpy $WCRemoveError "待卸载目录出现链接"
          ${ExitDo}
        ${EndIf}
        IfFileExists "$4\*" removal_directory removal_file
        removal_directory:
          Push $4
          Call un.WCRemovePayload
          ${If} $WCRemoveError != ""
            ${ExitDo}
          ${EndIf}
          ${If} $4 != "$INSTDIR\resources"
            ClearErrors
            RMDir "$4"
            ${If} ${Errors}
              StrCpy $WCRemoveError "目录仍被占用"
              ${ExitDo}
            ${EndIf}
          ${EndIf}
          Goto removal_next
        removal_file:
          ClearErrors
          Delete "$4"
          ${If} ${Errors}
            StrCpy $WCRemoveError "文件仍被占用"
            ${ExitDo}
          ${EndIf}
      ${EndIf}
    ${EndIf}
    removal_next:
    FindNext $1 $2
  ${Loop}
  removal_done:
  FindClose $1
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Section "Uninstall"
  !insertmacro customCheckAppRunning
  Call un.WCVerifyTarget
  SetOutPath "$TEMP"
  StrCpy $WCRemoveError ""
  Push "$INSTDIR"
  Call un.WCRemovePayload
  ${If} $WCRemoveError != ""
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "部分程序文件仍被占用，卸载尚未完成。请关闭相关程序后重试。个人设置保留。"
    ${EndIf}
    SetErrorLevel 74
    Quit
  ${EndIf}
  ; A second complete scan ensures an interrupted enumeration did not leave
  ; ordinary payload behind. Only resources, its marker and this EXE remain.
  Call un.WCVerifyTarget
  ${If} $WCUnSeen != 3
    SetErrorLevel 74
    Quit
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\Uninstall WindChime.exe"
  ${If} ${Errors}
    SetErrorLevel 74
    Quit
  ${EndIf}
  Delete "$INSTDIR\resources\windchime-install.ini"
  ${If} ${Errors}
    CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Uninstall WindChime.exe"
    SetErrorLevel 74
    Quit
  ${EndIf}
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
  ${If} ${Errors}
    ; Preserve a repairable identity if a directory becomes occupied at the
    ; final boundary. No application data is ever part of this directory.
    CreateDirectory "$INSTDIR\resources"
    WriteINIStr "$INSTDIR\resources\windchime-install.ini" "WindChime" "AppId" "${APP_ID}"
    WriteINIStr "$INSTDIR\resources\windchime-install.ini" "WindChime" "Version" "${VERSION}"
    CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Uninstall WindChime.exe"
    SetErrorLevel 74
    Quit
  ${EndIf}
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  SetErrorLevel 0
SectionEnd
