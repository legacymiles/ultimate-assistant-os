import { page, serve } from "../serve.mjs";

// Has its viewport tag, and really is too wide for a phone.
serve({ "/": page('<h1>Home</h1><div style="width:900px">A table that does not fit</div>') });
