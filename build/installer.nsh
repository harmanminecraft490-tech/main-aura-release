; NSIS Installer Script for Aura AI
; Handles cleanup of old installers after successful installation

!macro customInit
  ; Delete old installer files on installation
  ${If} ${FileExists} "$INSTDIR\..\Aura Setup 1.0.0.exe"
    Delete "$INSTDIR\..\Aura Setup 1.0.0.exe"
  ${EndIf}

  ; Search and delete any old setup files in release folder.
  ; Guarded so a missing folder / failed FindFirst cannot loop forever:
  ; the loop only runs while FindNext keeps returning files, and it
  ; stops the moment $1 is empty (FindNext sets it to "" when exhausted).
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\..\..\release\Aura Setup*.exe"
  ${IfNot} ${Errors}
    aura_cleanup_loop:
      StrCmp $1 "" aura_cleanup_done
      Delete "$INSTDIR\..\..\release\$1"
      FindNext $0 $1
      Goto aura_cleanup_loop
    aura_cleanup_done:
    FindClose $0
  ${EndIf}
!macroend

!macro customInstall
  ; Custom installation steps
  DetailPrint "Installing Aura AI..."
  
  ; Create shortcuts with proper icons
  CreateShortcut "$DESKTOP\Aura.lnk" "$INSTDIR\Aura.exe" "" "$INSTDIR\Aura.exe" 0
  CreateShortcut "$SMPROGRAMS\Aura.lnk" "$INSTDIR\Aura.exe" "" "$INSTDIR\Aura.exe" 0
!macroend

!macro customUnInit
  ; Cleanup on uninstall
  DetailPrint "Removing Aura AI..."
  
  ; Delete shortcuts
  Delete "$DESKTOP\Aura.lnk"
  Delete "$SMPROGRAMS\Aura.lnk"
  
  ; Remove application data if user chooses (skipped in silent mode so an
  ; automated /S uninstall cannot block forever on the dialog)
  ${IfNot} ${Silent}
    MessageBox MB_YESNO "Do you want to remove all Aura AI data including settings, conversations, and memories?" IDNO skip_data_removal
      RMDir /r "$APPDATA\aura-ai"
      RMDir /r "$LOCALAPPDATA\aura-ai"
    skip_data_removal:
  ${EndIf}
!macroend
