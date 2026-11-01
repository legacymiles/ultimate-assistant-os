// The EA Lab page, standalone: the same component the hub mounts at
// /apps/ea-lab, bundled so the runner can serve it on a machine that has no
// hub (the VPS). Built by tools/ea-lab-runner/build-ui.mjs.
import { createRoot } from "react-dom/client";
import { EaLab } from "@/components/ea-lab/EaLab";

createRoot(document.getElementById("root")!).render(<EaLab />);
