# Motion routing

The same rules the 3D Studio app's director uses (`src/lib/studio3d/director/motion.ts` in the
hub repo). Apply them in order to every action.

1. **Object, vehicle, effect** (kind `object`) → **Blender** — keyframes, paths, physics,
   particles, geometry nodes.
2. **Creature / quadruped** (kind `creature`) → **Cascadeur** — Mixamo only rigs bipeds.
   Anthropomorphic animals that stand, talk or wear clothes count as humanoids.
3. **Humanoid stunt or contact motion** → **Cascadeur**:
   flip, backflip, somersault, cartwheel, acrobatics · fall, trip, stumble, slip, tumble, collapse ·
   fight, punch, kick, sword, duel, wrestle, tackle, block · climb, vault, parkour, swing, hang ·
   throw, catch, juggle, push, pull, lift, carry, drag · land, dive, skate, surf, ski, balance ·
   squash-and-stretch, exaggerated cartoon motion.
4. **Everyday humanoid motion** → **Mixamo**, with a clip:

| motion words | clip |
|---|---|
| idle, stand, wait, pose | Idle |
| walk, stroll, wander, enter, arrive, approach | Walking |
| run, sprint, jog, chase, rush, race, flee | Running |
| jump, hop, leap | Jumping |
| talk, speak, explain, say, tell, present, narrate, teach, ask | Talking |
| wave, greet, hello, goodbye | Waving |
| dance, groove, party | Hip Hop Dancing |
| clap, cheer, celebrate, applaud | Clapping |
| win, victory, triumph | Victory |
| point, show, indicate | Pointing |
| think, ponder, wonder, curious | Thinking |
| look, search, explore, discover, notice, watch | Looking Around |
| sit, rest, relax | Sitting |
| type, code, computer, laptop | Typing |
| pick, grab, collect, take | Picking Up |
| sad, cry, sigh | Sad Idle |
| laugh, giggle, smile | Laughing |
| salute, bow | Salute |

5. **Specific humanoid performance with no clip** → **Cascadeur** (custom keyed performance).
   A two-word or vaguer description → Mixamo Idle.

Blender always owns the scene: sets, cameras, lights, travel paths (In Place clips + Blender
path), effects, and the render — even for actions routed to Mixamo or Cascadeur.
