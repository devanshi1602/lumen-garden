# Lumen Garden

**Bend light with your hands to wake a tiny garden on your desk. A seated, hands-only mixed reality puzzle with a new garden every day.**

Built for the Meta VR Start Developer Competition 2026. Planned entry: **Gaming track, New Experience division**. It is also aimed at these special awards: *Best First Five Minutes*, *Best Reason to Come Back*, and *Best Accessibility Forward Experience*.

- **Tech:** WebXR, plain JavaScript and WebGL, with no libraries and no build tools needed.
- **The whole game is one file,** `dist/index.html` (about 77 KB). Every sound is generated in code, so there are no audio files.

---

## 1. Try it right now (on a computer)

Double-click `dist/index.html` and click **Play on this screen**.

- Click a mirror to turn it.
- Drag to look around, and scroll to zoom.

## 2. Put it online (GitHub Pages, about 5 minutes)

Judges need a public **https** link. WebXR only works over https.

1. Create a free account at github.com, then click **New repository** and name it `lumen-garden`. Make it **Public**.
2. Click **Add file → Upload files** and upload **`dist/index.html`**. It must be named `index.html` and sit at the top level of the repository.
3. Go to **Settings → Pages**. Under **Source**, choose *Deploy from a branch*, select the branch `main` and the folder `/ (root)`, then click **Save**.
4. Wait about 1 minute. Your link will be `https://<your-username>.github.io/lumen-garden/`.

To update the game later, edit the files in `src/`, run `node build.js`, and upload the new `dist/index.html`.

## 3. Play it on a Meta Quest

1. Open your link in the **Meta Quest Browser**.
2. Tap **Play in mixed reality** and allow hand tracking if asked.
3. Put the controllers down. The garden appears about 46 cm in front of you, around desk height.
   - **Touch** a mirror with your index finger, or **point and pinch** at it from a distance.
   - The **Lower** and **Raise** buttons let you rest the board on your real desk.
   - **Center** moves the board back in front of you.

## 4. Test without a headset

Install Meta's **Immersive Web Emulator** extension in Chrome. Open your link, open DevTools, go to the WebXR tab, and switch the emulated device to hand input.

## 5. What has been checked (and what hasn't)

| Check | Result |
|---|---|
| Puzzle engine: 5 lessons + 365 days of daily puzzles + 40 endless puzzles. Each one is checked as solvable and not already solved, and for daily puzzles the hint always leads to a solution (`node tests/puzzle.test.js`) | ✅ passed |
| Full playthrough in desktop Chrome by clicking mirrors and the panel: 5 lessons → daily → endless. Save and resume after reload | ✅ passed, no errors |
| WebXR code with a **mocked** headset, in both VR and mixed reality: finger poke, pinch-ray select on mirrors and panel buttons, exiting the session | ✅ passed, no errors |
| **Real Meta Quest hardware** | ⚠️ **not tested yet.** Do this first, see the checklist below |

### Headset test checklist (before you record the video)

- [ ] Board size and height are comfortable while seated, and the Lower/Raise buttons work.
- [ ] Poking a mirror flips it exactly once.
- [ ] Pinch-ray works on mirrors and panel buttons.
- [ ] Passthrough works, so you see your room behind the board.
- [ ] The frame rate stays smooth (watch for stutters when many flowers bloom).
- [ ] Taking the headset off and putting it back on resumes the game, and the sound comes back.
- [ ] Opening the Quest menu pauses the sound.

---

## 6. How it maps to the judging criteria

| Criterion | What Lumen Garden does |
|---|---|
| **Innovation & Creativity** | A light-and-mirror puzzle you solve on your real desk. Every correct move makes something grow: flowers bloom as light reaches them and close again when it's lost. |
| **Experience Design** | Seated with no movement. Usable with **hands only, start to finish**, by direct touch or pinch-ray. Lesson 1 is solved with a single touch in about 5 seconds. Each puzzle takes 1–3 minutes. Progress saves after every move, so play resumes exactly where you left off. |
| **Technical Implementation** | Hand-joint tracking for poking, transient pinch-ray input, passthrough MR (`immersive-ar`), **spatial audio** using HRTF panning at each mirror and flower, a puzzle generator that always produces a solvable daily puzzle (the same puzzle for everyone on a given date), and a solver that powers the hints. **Small field of view:** the board and panel fit in a narrow forward view, which also suits the upcoming Meta VR Glasses. |
| **Polish & Presentation** | Generated music: a background pad brightens as more seeds glow, each flower has its own bell note, and a chord plays on completion. Petal bursts and fireflies add motion. |
| **Accessibility** | Works one-handed with no time pressure. A **high-contrast mode**. Each seed has a different petal count (4, 5, 6 or 8), so colour isn't the only cue. Sound cues for every state change. Large panel buttons. Board height is adjustable. Hints are available at any time, and lessons offer one automatically when you seem stuck. |
| **Reason to Come Back** | A new **Daily Garden** each day, a **streak**, and a shelf of potted flowers beside the board that grows by one pot for each daily garden you finish. Endless mode for longer sessions. |

---

## 7. Devpost submission draft

**Name:** Lumen Garden

**Tagline (133/140 characters):** Bend light with your hands to wake a tiny garden on your desk. A seated, hands-only mixed reality puzzle with a new garden every day.

**Track / Division:** Gaming, New Experience

**Description (~330 words):**

> **Inspiration.** We wanted a game that feels at home on a desk, not in a play space. You can play it in a two-minute break and never stand up. Light is a natural fit for hands. You reach out, turn a small mirror, and watch a beam swing across the table. When it touches a seed, a flower opens.
>
> **What it is.** Lumen Garden is a seated mixed reality puzzle. A small garden board appears in front of you in passthrough. A lantern sends out a beam of light. Turn mirrors to guide it, use crystals to split it, avoid stones, and get light to every seed at the same time. You can play entirely with your hands: touch a mirror directly, or point and pinch from a distance. Five short lessons teach everything by doing. The first one is solved with a single touch. Then a new **Daily Garden** appears every day (the same puzzle for every player), with a streak and a shelf of flowers that grows each day you return.
>
> **How we built it.** Lumen Garden is a WebXR app written from scratch in JavaScript and WebGL with no engine, which keeps it to a ~77 KB page that loads instantly in the Meta Quest Browser. It uses hand-joint tracking for direct touch, pinch-ray input for distance, and `immersive-ar` passthrough. All audio is generated in code and placed in space with HRTF panning, so each mirror clicks and each flower rings from where it sits. Behind the scenes, a puzzle generator builds the daily gardens from the date, and a solver checks that each one can be solved and powers the hint button.
>
> **Accessibility.** One-handed play, no timers, high-contrast mode, seeds marked by petal count as well as colour, sound cues for every change, and adjustable board height.
>
> **What's next.** Snapping the board onto your real desk automatically, new pieces (coloured filters, moving mirrors), a garden you can decorate with your collected flowers, and a mode where friends solve the same daily garden and compare turn counts.

**How hand interactions work:** Index-fingertip poke is detected against each mirror's tile, and it fires once each time your finger enters, with a short cooldown so a mirror can't flip twice by accident. The panel buttons are pressed by poking through the panel from the front. The transient pinch-ray uses the system's `select` event and ray. The ray hides automatically when your hand is close to the board, so the two styles don't conflict.

---

## 8. Demo video plan (keep it under 3 minutes)

Record it in the headset (Quest: **Meta button → Camera → Record video**) while seated at a real desk.

| Time | Shot |
|---|---|
| 0:00–0:08 | **Hook:** a close-up of your finger touching a mirror, the beam swinging, and a flower blooming with its chime. Show the title. |
| 0:08–0:35 | Lesson 1 → 2 → 3 at normal speed. Show that there's no tutorial text wall; the game teaches by doing. |
| 0:35–1:10 | A crystal splitting the beam. Lose a flower (it closes), then win it back. Show the full win burst. |
| 1:10–1:45 | Pinch-ray from a relaxed seated position, then the Lower and Raise buttons resting the board on the real desk. |
| 1:45–2:20 | The Daily Garden, the streak counter, the flower shelf, and endless mode. |
| 2:20–2:45 | Accessibility: high contrast, petal shapes, one-handed play. |
| 2:45–2:55 | End card: name, tagline, and "Play it now in the Meta Quest Browser" with your link. |

Upload the video to YouTube as **Public** (or Unlisted only if the rules allow it) and paste the link into Devpost.

---

## 9. Your to-do list before Nov 18 (12:00pm PST = 1:30am IST Nov 19)

1. **Today:** apply to the **Start program** and register on Devpost.
2. Read the rules and confirm two things: (a) that a plain **WebXR** link is accepted (the rules mention "IWSDK (WebXR)"; if IWSDK is required, ask in the competition Discord or forum, because the game could be ported), and (b) that India is an eligible country.
3. Publish to GitHub Pages and run the headset checklist above.
4. Get 3–5 friends to play. Watch where they get stuck, and adjust the lessons.
5. Record the video and submit at least **one day early**. The build can't be changed after the deadline.

## 10. Project structure

```
src/
  index.html   landing page + boot code
  game.js      scene, hands/controller/mouse input, WebXR session, UI panel, save/resume
  puzzle.js    light-routing rules, lessons, daily/endless generator, solver, hints
  gl.js        small WebGL renderer (lighting, glow, text panel)
  audio.js     generated spatial audio and adaptive music
  math.js      matrix and vector helpers
build.js       inlines everything into dist/index.html
tests/         puzzle tests, browser playthrough, mocked-XR test
```

Run the tests:

```bash
node tests/puzzle.test.js
python3 tests/play.py
python3 tests/xr.py
```

The last two need Playwright.

### Ideas to make it stronger (if time allows)

- Auto-place the board on your real desk using WebXR plane detection or hit-test.
- Use spatial anchors so the garden stays where you left it between sessions.
- New pieces: colour filters (seeds that need a specific colour) and mirrors that rotate on a timer.
- Social: a shared daily leaderboard of fewest turns (this would target the Social award).
