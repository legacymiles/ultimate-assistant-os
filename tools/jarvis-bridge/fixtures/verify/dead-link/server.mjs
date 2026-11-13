import { page, serve } from "../serve.mjs";

serve({ "/": page('<h1>Home</h1><a href="/missing">A page that is not there</a>') });
