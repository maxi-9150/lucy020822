/* ============================================================
   Photo Booth — surprise.js
   Slow cinematic photo slideshow · scroll-triggered paragraph
   reveals · YouTube IFrame API driving Lana Del Rey's "Love"
   as the letter's score.
   ============================================================ */

(() => {
    "use strict";

    // ---------- slideshow -------------------------------------
    const slides = Array.from(document.querySelectorAll(".slide"));
    let idx = 0;
    const ADVANCE_MS = 8500; // slow, cinematic dissolve

    function advanceSlide() {
        slides[idx].classList.remove("is-active");
        idx = (idx + 1) % slides.length;
        slides[idx].classList.add("is-active");
    }

    setTimeout(() => {
        setInterval(advanceSlide, ADVANCE_MS);
    }, ADVANCE_MS);

    // ---------- reveal-on-scroll ------------------------------
    const els = document.querySelectorAll(".reveal-el");
    if ("IntersectionObserver" in window && els.length) {
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        e.target.classList.add("is-visible");
                        io.unobserve(e.target);
                    }
                }
            },
            { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
        );
        els.forEach((el) => io.observe(el));
    } else {
        els.forEach((el) => el.classList.add("is-visible"));
    }

    // ---------- music (Lana Del Rey — "Love") -----------------
    // Uses the local MP3 (assets/love.mp3) so we can autoplay and
    // loop reliably. Browsers usually block unmuted autoplay on
    // navigation without a carried user gesture, so we also arm
    // one-shot listeners on the first pointer/keyboard interaction
    // — as soon as the visitor moves, clicks, scrolls or taps the
    // page, the score starts.
    const audio      = document.getElementById("loveAudio");
    const musicBtn   = document.getElementById("musicBtn");
    const musicIcon  = document.getElementById("musicIcon");
    const musicLabel = document.getElementById("musicLabel");

    audio.volume = 0.7; // gentle default so we don't overwhelm the room
    audio.loop   = true;

    function setUI(isPlaying) {
        if (isPlaying) {
            musicBtn.classList.add("is-playing");
            musicIcon.textContent = "❚❚";
            musicLabel.textContent = "pause";
        } else {
            musicBtn.classList.remove("is-playing");
            musicIcon.textContent = "▶";
            musicLabel.textContent = "play";
        }
    }

    // Reflect actual playback state (in case the browser pauses
    // for its own reasons, or the user uses OS media controls).
    audio.addEventListener("play",  () => setUI(true));
    audio.addEventListener("pause", () => setUI(false));

    // Explicit button — always works because it's a user gesture.
    musicBtn.addEventListener("click", () => {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
    });

    // Try to autoplay immediately. If the browser blocks it,
    // start silently on the first user interaction anywhere.
    function tryAutoplay() {
        const p = audio.play();
        if (!p || typeof p.then !== "function") return;
        p.catch(() => {
            const events = [
                "pointerdown", "click", "touchstart",
                "keydown", "wheel", "scroll",
                "mousemove",
            ];
            const kick = () => {
                audio.play().catch(() => {});
                events.forEach((ev) =>
                    document.removeEventListener(ev, kick, true)
                );
            };
            events.forEach((ev) =>
                document.addEventListener(ev, kick, {
                    capture: true, once: true, passive: true,
                })
            );
            // Also softly pulse the button so the user notices it.
            musicBtn.classList.add("is-inviting");
        });
    }

    // Kick off after DOM has settled a moment.
    if (document.readyState === "complete") {
        tryAutoplay();
    } else {
        window.addEventListener("load", tryAutoplay, { once: true });
    }
})();
