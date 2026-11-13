import { page, serve } from "../serve.mjs";

serve({
  "/": page('<h1>Home</h1><a href="/settings">Settings</a>'),
  "/settings": page('<h1>Settings</h1><script>throw new Error("settings is not defined")</script>'),
});
