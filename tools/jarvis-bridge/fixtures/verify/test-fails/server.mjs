import { page, serve } from "../serve.mjs";

serve({ "/": page("<h1>Home</h1>") });
