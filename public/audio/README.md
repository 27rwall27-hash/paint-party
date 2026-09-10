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

- `stampede-music.wav` — background music, loops for the whole game, gets 10% faster every 10 seconds (compounding, capped at ~2.85x so it never runs away into an unlistenable screech).
- `stampede-leap.wav` — plays the instant a racer leaves the ground on a jump — loud for your own jumps, very soft for the CPUs'.

Unlike Paint Party, there's no synthesized fallback for `stampede-music.wav` — the game is simply quiet until you provide one. `stampede-leap.wav` falls back to a small synthesized blip if not provided.
