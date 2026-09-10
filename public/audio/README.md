# Custom audio

Shared across the whole suite — each game's slots are independent and namespaced by filename.

## Paint Party

Drop any of these files in here to replace the built-in defaults — no other setup needed:

- `music.wav` — background music, loops for the whole game, gets 5% faster each round.
- `start.wav` — plays right when a round's curtain finishes opening.
- `finish.wav` — plays when a round ends.
- `victory.wav` — the "Player X Wins!" theme after the last round, loops for as long as that screen is showing.
- `drumroll.wav` — plays once as the victory curtain closes and holds before it opens onto the "Player X Wins!" reveal (about 1.8 seconds of build-up).

Any file you don't provide falls back to the built-in synthesized music / spoken announcer / fanfare, independently per slot.

## Stampede Sprint

- `stampede-music.wav` — background music, loops for the whole game, gets 0.5% faster every second (compounding, capped at ~2.85x so it never runs away into an unlistenable screech).
- `stampede-leap.wav` — plays the instant a racer leaves the ground on a jump — loud for your own jumps, very soft for the CPUs'.
- `stampede-alarm.wav` — loops for as long as the big flashing "NEW RACE STARTING" hazard sign is on screen (the pre-split quiet wait plus the whole split-transition cinematic).

Also reuses Paint Party's own `start.wav` (plays when a race begins) and `finish.wav` (plays when the game ends) rather than needing separate copies.

Unlike Paint Party, there's no synthesized fallback for `stampede-music.wav`/`stampede-alarm.wav` — the game is simply quiet until you provide them. `stampede-leap.wav` falls back to a small synthesized blip if not provided.
