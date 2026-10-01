# Orbit Hop

One-tap space hopper for phone and desktop browsers. You circle a planet, tap to launch, land on the next planet, grab stars, dodge asteroids and climb as high as you can. Stars unlock 9 skins.

**Play:** https://kushalat2017-cell.github.io/orbit-hop/

- Plain HTML, JS and canvas: no build step, no dependencies, no asset files (sounds are generated in code).
- Works offline once loaded. Progress (best score, stars, skins) is saved in the browser.
- Controls: tap, click, Space, Enter or Up arrow.

## Files

| File | What it does |
|---|---|
| `index.html` | Page, menus, styles |
| `game.js` | The game: physics, levels, game feel, shop, sound |
| `monetize.js` | Ad SDK wrapper for CrazyGames and Poki (does nothing anywhere else) |
| `icon.svg`, `manifest.webmanifest` | App icon; lets people "Add to Home Screen" |

## How it makes money

Web game portals put ads around your game and pay you a share. `monetize.js` already handles their ad calls:

- **Between games:** an ad every 3rd "Play again" (`midgame`).
- **Rewarded ad:** after a run of 3+ planets the player can watch an ad to revive once. This button only appears on a portal.
- The game tells the portal when play starts and stops, so ads never interrupt a run. Sound mutes during ads.

On GitHub Pages and itch.io there are no ads; the game just runs.

### Steps only the owner can do (accounts, terms, payouts)

1. **CrazyGames** (best first target, open submissions): sign up at https://developer.crazygames.com, upload a zip of this folder, and fill in payout details. The game loads their SDK by itself on their domain.
2. **Poki** (curated, higher traffic, invite/apply): apply at https://developers.poki.com and share the GitHub Pages link.
3. **itch.io** (no ads, optional tips): create a page at https://itch.io/game/new, choose "HTML", upload the zip, set "pay what you want".
4. **GameDistribution / GameMonetize**: other portals with a similar revenue share. They need their own SDK calls, which can be added to `monetize.js`.

Make the zip with: `zip -r orbit-hop.zip index.html game.js monetize.js icon.svg manifest.webmanifest`

Before submitting, check each portal's current SDK docs. The calls in `monetize.js` follow CrazyGames SDK v3 and Poki SDK v2. Test with `?portal=crazygames` or `?portal=poki` added to the URL.

## Tuning

Gameplay constants are at the top of `game.js` (`FLY_SPEED`, `MAX_FLIGHT`, `CAPTURE_GAP`, and the rest). Difficulty ramps over the first 60 planets in `difficulty()`. Skin prices are in `SKINS`.

## Credits

Built with Claude Code. Game-feel numbers from the `game-juice` skill.
