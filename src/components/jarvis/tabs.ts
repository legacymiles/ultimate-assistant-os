// The tab names the shared Jarvis panels (Settings, the updates feed) send to
// the shell's `go`. These used to be the retired /apps/jarvis shell's own
// union; New Jarvis is the only shell now, and it also accepts the old names
// (memory, record, profile, routines, console) and maps them to where they live.
export type TabId =
  | "dashboard" | "chat" | "studio" | "harness" | "queue"
  | "folders" | "photos" | "lists" | "calendar" | "inbox"
  | "skills" | "tools" | "passwords" | "calls" | "router" | "architect" | "timeline" | "plugins" | "settings"
  | "memory" | "record" | "profile";
