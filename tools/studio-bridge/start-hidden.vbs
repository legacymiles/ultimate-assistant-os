' Jarvis Studio local renderer, started with no console window.
'
' This is what the Startup shortcut runs (install-autostart.cmd puts it there),
' so the renderer is already up before the owner opens Studio and the page never
' has to tell them to go and start it. Output goes to out\bridge.log, because a
' hidden process with nowhere to write is a process you cannot debug.
'
' server.mjs is named by its FULL path, not relative to the working directory:
' that path is the only thing that tells this node apart from every other node
' on the machine, and stopping the right one later depends on it.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(here & "\out") Then fso.CreateFolder here & "\out"
sh.CurrentDirectory = here
sh.Run "cmd /c node """ & here & "\server.mjs"" >> ""out\bridge.log"" 2>&1", 0, False
