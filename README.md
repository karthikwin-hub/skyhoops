# Skyhoops

A dreamlike 3D basketball world tour, high above the clouds. Swipe (phone/tablet) or flick the mouse (laptop) to shoot, unlock seven worlds, and play live with friends on other devices.

**Worlds**

1. **Golden Rooftop**: free throws and first threes at sunset, with a big aiming guide.
2. **Lantern Festival**: night court among floating sky lanterns. New spot every shot and a shorter guide.
3. **Windy Cliffs**: wind pushes the ball; watch the flags and the wind arrow.
4. **Drifting Isle**: the hoop sits on a floating island that slowly drifts.
5. **Moon Court**: 42% gravity, so swipe much softer than you think.
6. **Portal Garden**: a crystal wall blocks the hoop; shoot through the portal.
7. **Storm Tower**: 60 seconds, wind, a moving hoop, and the rim shrinks with every basket.

Each world has 3 stars to earn. One star unlocks the next world. Three baskets in a row sets the ball on fire, doubles your points, makes the world glow and builds up the music.

## Run it locally

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev command runs the Vite client and the room server (port 8787) together.

To play with friends on the same Wi-Fi, open `http://<your-computer's-IP>:5173` on their phones and tablets.

## Play with friends

1. Tap **Play with Friends**, then **Create a room**.
2. Share the 4-letter code, or tap **Copy invite link** and send it.
3. Friends join with the code or link (up to 6 players). The host picks a world and taps **Start!**
4. Everyone plays the same round at the same time. Friends' shots fly as see-through ghost balls with their names. A live scoreboard and emoji reactions run during the round, and a podium shows at the end.

## Live site (Cloudflare Workers, free plan)

The game is live at **https://skyhoops.karthik-win.workers.dev**.

One Cloudflare Worker (`worker/index.ts`, configured in `wrangler.jsonc`) does two jobs. It serves the built game from `dist/client`, and it sends `/ws` connections to a single Durable Object (`Lobby`) that runs the same room logic as the Node server (`server/rooms.ts`). Rooms live in that object's memory. If Cloudflare restarts it, rounds in progress end and players rejoin with a new code. Solo progress is saved in each player's browser, so it is never affected.

To deploy changes:

```bash
npx wrangler login   # once per computer
npm run deploy       # builds the client and runs wrangler deploy
```

`npm run preview:cf` runs the same Worker locally. `GET /health` returns `{"ok":true,"rooms":N}`.

## Self-hosting on any Node host (alternative)

```bash
npm run build   # type-checks and builds the client into dist/client
npm start       # one Node process serves the game and the /ws room server
```

The server listens on `PORT` (default 8787). On hosts like Render or Railway, use `npm install && npm run build` as the build command, `npm start` as the start command, and `/health` as the health check. Run a single instance, because rooms live in memory.

## Tests

```bash
npm test
```

- `tests/physics.test.ts` fires ideal shots through the real physics world (free throws, threes, the Moon, the shrunken storm rim, a portal shot) and checks that they score, and that overpowered shots miss.
- `tests/scoring.test.ts` covers rim crossing, points (2/3, swish, bank, portal, on fire), and stars.
- `tests/ballistics.test.ts` covers the swipe-to-shot mapping, the aim assist, sideways aim and spin, and gesture parsing.
- `tests/rooms.test.ts` covers the room server: join/leave, host hand-over, shared seed, ghost relay, score clamping, results ranking, timeouts, and reaction rate limiting.
- `tests/stages.test.ts` checks that every shot in every world can be made, rounds are reproducible from a seed, and later worlds give less help.

### Browser playtests (optional)

These need a Chromium binary for `playwright-core` (set `CHROME=/path/to/chrome` if it isn't in the default Playwright cache). Screenshots are saved to `shots/`.

```bash
npm run dev                                                           # in another terminal
npm run playtest -- http://localhost:5173/ rooftop --fast             # desktop, low quality
npm run playtest -- http://localhost:5173/ moon --mobile --fast       # phone-sized screen
npm run playtest:friends -- http://localhost:5173/ rooftop            # two players, full round
node scripts/accuracy.mjs http://localhost:5173/ cliffs               # logs each perfect shot's outcome
node scripts/wssmoke.mjs wss://skyhoops.karthik-win.workers.dev/ws    # room server check, no browser needed
```

## Settings

The buttons on the title screen toggle sound effects, music and graphics quality. High quality adds depth of field and chromatic aberration. It is the default on laptops; phones start on low for smooth frame rates.

## Project layout

```
client/            Vite app (three.js, postprocessing, cannon-es)
  src/engine/      renderer, physics, sky, camera director, procedural textures
  src/game/        ball, hoop, cloth net, input, scoring, ghosts, game loop
  src/stages/      the seven worlds
  src/audio/       synthesized sound effects and generative music
  src/net/         WebSocket client
  src/ui/          screens and HUD
server/            static file server + WebSocket room server
shared/            message types shared by client and server
tests/             Vitest tests
scripts/           headless browser playtests
```
