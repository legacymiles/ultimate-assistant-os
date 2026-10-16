import type { StrategyDef } from "../strategy";
import { HFT_SECRET } from "./hftSecret";
import { HFT_SECRET_V2 } from "./hftSecretV2";
import { OPENING_RANGE } from "./openingRange";

/** The bots that ship with Replay. Ported and hand-written bots are added beside them at runtime. */
export const BUILTIN_STRATEGIES: StrategyDef[] = [HFT_SECRET_V2, HFT_SECRET, OPENING_RANGE];

export { HFT_SECRET, HFT_SECRET_V2, OPENING_RANGE };
