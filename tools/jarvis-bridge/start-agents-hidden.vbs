' Jarvis's 24/7 agents, started with no console window.
'
' This is what the Startup shortcut runs, so an agent carries on as soon as
' this PC is signed in — with the browser shut and Jarvis never opened. Output
' goes to out\agents.log, because a hidden process with nowhere to write is a
' process you cannot debug.
'
' agents-wake.mjs is named by its FULL path, not relative to the working
' directory: that path is the only thing that tells this node apart from every
' other node on the machine, and stopping the right one later depends on it.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(here & "\out") Then fso.CreateFolder here & "\out"
sh.CurrentDirectory = here
sh.Run "cmd /c node """ & here & "\agents-wake.mjs"" >> ""out\agents.log"" 2>&1", 0, False
