' EA Lab runner, started with no console window.
'
' This is what the Startup shortcut runs (install-autostart.cmd puts it there),
' so the runner is already up when the owner opens EA Lab. Output goes to
' out\runner.log, because a hidden process with nowhere to write is a process
' you cannot debug.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(here & "\out") Then fso.CreateFolder here & "\out"
sh.CurrentDirectory = here
sh.Run "cmd /c node """ & here & "\server.mjs"" >> ""out\runner.log"" 2>&1", 0, False
