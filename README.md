# The Little Photobooth ✦

An interactive surprise-event website. Users step up to a vintage
photobooth screen and **draw over a hidden word using a cute flock
of stamps** (birds, hearts, petals, stars, butterflies). Once the
letters are traced enough, a magical reveal page unfolds with
confetti, flying birds, and a personal message.

Perfect for birthdays, proposals, anniversaries, welcome pages,
or any moment you want to feel a bit more special.

## Run it

No build step required — this is plain HTML/CSS/JS.

```bash
# from this folder, any static server works:
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or just double-click `index.html` in Finder.

## Customize the surprise

Everything is configurable via URL query params, so you can send
personalized links to friends.

| Param | What it does | Example |
|---|---|---|
| `word` | The word the user must trace | `?word=LOVE` |
| `name` | Name shown at the top of the message | `?name=Lucy` |
| `message` | Custom message on the reveal page | `?message=Happy%20birthday!` |

Example combined link:

```
index.html?word=HAPPY&name=Lucy&message=Sunday%20brunch%20is%20on%20me
```

You can also set a default word by editing `DEFAULT_WORD` at the
top of `scripts/photobooth.js`, or by running this once in the
console:

```js
localStorage.setItem("photoboothWord", "MAGIC");
```

## Files

```
lucy/
├── index.html          # the photobooth (drawing page)
├── surprise.html       # the reveal page
├── styles/
│   ├── main.css        # base styling
│   └── surprise.css    # reveal-page styling
├── scripts/
│   ├── photobooth.js   # canvas + drawing engine + tracing
│   └── surprise.js     # confetti + flying birds + message
└── README.md
```

## How the tracing works

1. The chosen word is rasterized to an offscreen canvas at low
   opacity — this gives users a faded guide to trace.
2. Every pixel of the letter is stored in a `Uint8Array`
   (`target`), and a parallel `covered` array tracks pixels the
   user has drawn over.
3. Each brush stamp (a rotated emoji drawn onto the canvas) also
   marks a circular region of `covered` pixels. This gives us
   real-time coverage in O(brush-area) per stroke.
4. When coverage reaches **72%** of the letter pixels, the
   reveal is unlocked, a burst of stamps plays, and the page
   transitions to `surprise.html`.

## Tips for hosting the surprise

- Use a short, easy-to-trace word (4–8 letters works best).
- Test in the browser you'll send the link to — emoji rendering
  is native to each OS, which is part of the charm.
- The layout is responsive down to phone-sized screens.

Made with birds, hearts, and a little bit of magic ♡
