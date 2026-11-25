# alex-moves: the clips that make Alex's real face move

LiveTalking (`C:\dev\livetalking`, wav2lip) only redraws Alex's **mouth**. Anything else he does,
like blinking, glancing at chat, sipping coffee, laughing or waving, has to be in the video it plays.
Alex used to be one still photo, so he stared. This tool renders his moving clips for free on this
PC with WanGP and installs them into LiveTalking.

| Clip | Where it plays |
|---|---|
| `idle` | While he's quiet: blinks, glances at a second screen, small smile (LiveTalking audiotype 1) |
| `talk` | Under the lip sync while he speaks: small nods and sways. Rebuilt as avatar `alex_live` |
| `sip` `laugh` `think` `wave` `lean` | One-off actions, audiotypes 2–6 in `clips.json` order |

Every clip starts **and** ends on the same picture (`out/base.png`, H3 FL2VA start = end), so any
clip can follow any other without a jump.

## Run it

WanGP's MCP server must be up on :42004 (see `tools/h3-render/README.md`). **Stop LiveTalking
first**: the two don't fit together in 6 GB.

```bash
node tools/alex-moves/moves.mjs base                 # Flux 2 Klein: chest-up Alex at a desk, from public/ai-live-studio/alex.jpg (~45 s)
node tools/alex-moves/moves.mjs render [ids…]        # MiniMax H3 FL2VA, 4 turbo steps, 480x832, ~5 s each (~6 min a clip)
node tools/alex-moves/moves.mjs install              # frames + wavs into LiveTalking, avatar alex_live, data/alex_moves.json
```

Then start LiveTalking with the moves:

```bash
cd C:\dev\livetalking
.venv\Scripts\python.exe app.py --transport webrtc --model wav2lip --avatar_id alex_live --modelres 256 --customvideo_config data/alex_moves.json --REF_FILE en-US-AndrewNeural --listenport 8010
```

`render` with no ids renders only the clips not made yet; name ids to redo them. Change a clip's
look by editing its prompt in `clips.json` (or its `seed`). Outputs in `out/` are gitignored.

## How Jarvis uses them

`src/lib/new-jarvis/avatar/moves.ts` (pure, tested) is the choreography. After each line Alex
reacts to its mood (a laugh after something funny, a wave on hello, the thinking pose on a
question), and while he's quiet he does something on his own every 18–40 s (a sip, the thinking
pose, a lean in). `liveFace.ts` plays the moves through `/set_audiotype` and cuts one short when he
has to talk. LiveTalking otherwise finishes an action before it speaks.

**Adding a move:** add a clip with `"use": "action"` to the end of `clips.json`, render it, run
`install`, and add it to `MOVES` with the next audiotype. `moves.test.ts` checks the two lists
agree.

## Limits

- No action plays while he talks, because a hand or cup over the mouth breaks the lip sync.
  Actions happen between lines.
- A new clip takes minutes on the RTX 3050, so a move can't be made in the middle of a conversation.
