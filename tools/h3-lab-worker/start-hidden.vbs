' H3 Prompt Lab worker, started with no console window.
'
' This is what the Startup shortcut runs (install-autostart.cmd puts it there),
' so the lab's renders and agent ticks carry on without a window open. Output
' goes to out\worker.log, because a hidden process with nowhere to write is a
' process you cannot debug.
'
' worker.mjs is named by its FULL path: that path is what tells this node apart
' from every other node on the machine, and stopping the right one depends on it.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(here & "\out") Then fso.CreateFolder here & "\out"
sh.CurrentDirectory = here
sh.Run "cmd /c node """ & here & "\worker.mjs"" >> ""out\worker.log"" 2>&1", 0, False
