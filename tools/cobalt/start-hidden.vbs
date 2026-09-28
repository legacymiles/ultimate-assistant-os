' The local cobalt server, started with no console window.
'
' This is what the Startup shortcut runs (install-autostart.cmd puts it there),
' so the second link-to-video engine is already up before anyone pastes a link
' into Cook Connect. Output goes to out\cobalt.log, because a hidden process
' with nowhere to write is a process you cannot debug.
'
' src/cobalt is named by its FULL path, not relative to the working directory:
' that path is the only thing that tells this node apart from every other node
' on the machine, and stopping the right one later depends on it.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(here & "\out") Then fso.CreateFolder here & "\out"
sh.CurrentDirectory = here & "\app\api"
sh.Run "cmd /c node """ & here & "\app\api\src\cobalt.js"" >> """ & here & "\out\cobalt.log"" 2>&1", 0, False
