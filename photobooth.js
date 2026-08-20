/* ============================================================
   Photo Booth — photobooth.js
   Camera background · MediaPipe hand tracking · green bird
   following the index-finger · symbol trail · Web Audio synth
   · word-coverage detection · shutter reveal.
   ============================================================ */

(() => {
    "use strict";

    // ---------- customization via URL -------------------------
    const url = new URL(window.location.href);
    const DEFAULT_WORD = "Lucy";
    // Target word is rendered in a flourishing script — keep the
    // capitalization the user typed rather than force-uppercasing.
    const rawWord =
        url.searchParams.get("word") ||
        localStorage.getItem("photoboothWord") ||
        DEFAULT_WORD;
    const targetWord = rawWord.slice(0, 14);

    const STAMPS = {
        birds:   ["✦", "❋", "✧", "❉"],
        hearts:  ["♥", "♡", "❦", "❥"],
        flowers: ["✿", "❀", "❁", "❃"],
        stars:   ["✦", "✧", "★", "✩"],
        notes:   ["♪", "♫", "♩", "♬"],
    };

    // Misty cornflower palette — foggy but with real blue in it.
    // Every drop picks a color at random so the trail reads as a
    // woven mist-and-cornflower-blue swarm.
    const BLUE_WHITE_PALETTE = [
        "#dfe6f2",  // fog white
        "#b8c6de",  // dusty ice
        "#94a8c9",  // soft dust blue
        "#8ea1c1",  // silver-blue
        "#6a85af",  // stormy steel
        "#5578a3",  // dusty steel
        "#4a6690",  // deep slate blue
        "#3f5a8e",  // dusty royal
    ];

    // ---------- element refs ----------------------------------
    const gate            = document.getElementById("gate");
    const startBtn        = document.getElementById("startBtn");
    const gateError       = document.getElementById("gateError");
    const videoEl         = document.getElementById("videoEl");
    const paintCanvas     = document.getElementById("paintCanvas");
    const app             = document.getElementById("app");
    const handStatus      = document.getElementById("handStatus");
    const shutterBtn      = document.getElementById("shutterBtn");
    const shutterProgress = document.getElementById("shutterProgress");
    const resetBtn        = document.getElementById("resetBtn");
    const muteBtn         = document.getElementById("muteBtn");
    const effectBtns      = document.querySelectorAll(".effect-btn");
    const statusLine      = document.getElementById("statusLine");

    const ctx = paintCanvas.getContext("2d");

    // ---------- global state ----------------------------------
    const state = {
        running:    false,
        landmarker: null,
        handSmooth: null,          // { x, y } smoothed display coords
        trail:      [],            // { x, y, t }
        symbols:    [],            // dropped glyphs
        activeStamp:"birds",
        unlocked:   false,
        captured:   false,
        muted:      false,
        synth:      null,
        lastFrame:  0,             // for MediaPipe timestamp
    };

    // ---------- canvas sizing ---------------------------------
    let W = 0, H = 0;
    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        paintCanvas.width  = W * dpr;
        paintCanvas.height = H * dpr;
        paintCanvas.style.width  = W + "px";
        paintCanvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rasterizeTarget();
    }
    window.addEventListener("resize", resizeCanvas);

    // ---------- target-text rasterization ---------------------
    // We track pixel coverage on a fixed 1200x800 grid to stay
    // resolution-independent from the display canvas.
    const GRID_W = 1200;
    const GRID_H = 800;

    const target  = new Uint8Array(GRID_W * GRID_H);
    const covered = new Uint8Array(GRID_W * GRID_H);
    let totalTarget = 0;
    let coveredCount = 0;

    const offCanvas = document.createElement("canvas");
    offCanvas.width  = GRID_W;
    offCanvas.height = GRID_H;
    const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });

    function splitInTwoLines(word) {
        const s = word.indexOf(" ");
        if (s > 0) return [word.slice(0, s), word.slice(s + 1)];
        const m = Math.round(word.length / 2);
        return [word.slice(0, m), word.slice(m)];
    }

    function rasterizeTarget() {
        offCtx.clearRect(0, 0, GRID_W, GRID_H);
        // Rasterize the word in a soft dusty-blue tone; the display
        // layer draws this with a "screen" composite so it appears
        // as a faint cornflower glow over the camera.
        offCtx.fillStyle = "#94a8c9";
        offCtx.textAlign = "center";
        offCtx.textBaseline = "middle";

        // Render as ONE flourishing script line — the whole word
        // reads like handwriting.
        const lines = [targetWord];
        const availW = GRID_W - 240;
        const availH = GRID_H - 260;
        const perLineH = availH / lines.length;

        let fontSize = Math.min(perLineH * 1.4, 620);
        const fontFor = (s) =>
            `${s}px "Great Vibes", "Allura", "Pinyon Script", ` +
            `"Snell Roundhand", cursive`;
        offCtx.font = fontFor(fontSize);
        while (fontSize > 80) {
            offCtx.font = fontFor(fontSize);
            const widest = Math.max(
                ...lines.map((l) => offCtx.measureText(l).width)
            );
            if (widest <= availW) break;
            fontSize -= 8;
        }

        const cx = GRID_W / 2;
        const totalH = perLineH * lines.length;
        const startY = (GRID_H - totalH) / 2 + perLineH / 2;
        // A little downward nudge — script fonts baseline sits high.
        const baselineNudge = fontSize * 0.05;
        lines.forEach((line, i) => {
            offCtx.fillText(
                line,
                cx,
                startY + i * perLineH + baselineNudge
            );
        });

        const img = offCtx.getImageData(0, 0, GRID_W, GRID_H);
        const data = img.data;
        totalTarget = 0;
        for (let i = 0; i < target.length; i++) {
            if (data[i * 4 + 3] > 60) {
                target[i] = 1;
                totalTarget++;
            } else {
                target[i] = 0;
            }
        }
        covered.fill(0);
        coveredCount = 0;
    }

    // ---------- coverage marking ------------------------------
    // Map display coords → grid coords, mark pixels within the
    // brush radius that overlap the target letters.
    function markCovered(dispX, dispY, radiusPx) {
        const gx = (dispX / W) * GRID_W;
        const gy = (dispY / H) * GRID_H;
        const gr = Math.max(radiusPx * (GRID_W / W), 22);
        const r2 = gr * gr;
        const x0 = Math.max(0, Math.floor(gx - gr));
        const x1 = Math.min(GRID_W - 1, Math.ceil(gx + gr));
        const y0 = Math.max(0, Math.floor(gy - gr));
        const y1 = Math.min(GRID_H - 1, Math.ceil(gy + gr));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - gx;
                const dy = y - gy;
                if (dx * dx + dy * dy <= r2) {
                    const idx = y * GRID_W + x;
                    if (target[idx] && !covered[idx]) {
                        covered[idx] = 1;
                        coveredCount++;
                    }
                }
            }
        }
        updateProgress();
    }

    // ---------- shutter progress + unlock ---------------------
    const UNLOCK_THRESHOLD = 0.62;
    const RING_CIRC = 289.02; // 2π * 46

    function updateProgress() {
        if (totalTarget === 0) return;
        const raw = coveredCount / totalTarget;
        const pct = Math.min(1, raw / UNLOCK_THRESHOLD);
        shutterProgress.style.strokeDashoffset = RING_CIRC * (1 - pct);
        if (raw >= UNLOCK_THRESHOLD && !state.unlocked) {
            state.unlocked = true;
            shutterBtn.disabled = false;
            statusLine.textContent =
                "press the shutter to open her letter";
        } else if (raw > 0.25 && raw < UNLOCK_THRESHOLD) {
            statusLine.textContent = "keep tracing her name…";
        }
    }

    // ---------- camera ----------------------------------------
    async function startCamera() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Your browser does not support camera access. " +
                "Try a recent version of Chrome, Safari, or Firefox."
            );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width:  { ideal: 1280 },
                height: { ideal: 720  },
            },
            audio: false,
        });
        videoEl.srcObject = stream;
        await new Promise((resolve) => {
            if (videoEl.readyState >= 2) return resolve();
            videoEl.onloadedmetadata = () => resolve();
        });
        try { await videoEl.play(); } catch (_) { /* autoplay handled */ }
    }

    // ---------- MediaPipe hand landmarker ---------------------
    async function loadLandmarker() {
        const modUrl =
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";
        const wasmBase =
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm";
        const modelUrl =
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

        const mod = await import(modUrl);
        const vision = await mod.FilesetResolver.forVisionTasks(wasmBase);
        return mod.HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence:  0.5,
            minTrackingConfidence:      0.5,
        });
    }

    // ---------- detect + render loop --------------------------
    function detectLoop() {
        if (!state.running) return;
        const now = performance.now();

        if (
            state.landmarker &&
            videoEl.readyState >= 2 &&
            videoEl.videoWidth > 0
        ) {
            // MediaPipe requires strictly increasing timestamps.
            const ts = now > state.lastFrame ? now : state.lastFrame + 1;
            state.lastFrame = ts;
            try {
                const res = state.landmarker.detectForVideo(videoEl, ts);
                if (res && res.landmarks && res.landmarks.length) {
                    const tip = res.landmarks[0][8]; // index-fingertip
                    // Video is CSS-mirrored (selfie), so flip x.
                    const rawX = (1 - tip.x) * W;
                    const rawY = tip.y * H;
                    if (!state.handSmooth) {
                        state.handSmooth = { x: rawX, y: rawY };
                    } else {
                        state.handSmooth.x =
                            state.handSmooth.x * 0.55 + rawX * 0.45;
                        state.handSmooth.y =
                            state.handSmooth.y * 0.55 + rawY * 0.45;
                    }
                    onHandDetected(
                        state.handSmooth.x,
                        state.handSmooth.y,
                        now
                    );
                    if (handStatus) {
                        handStatus.textContent =
                            "the bird is with you";
                        handStatus.classList.add("is-tracking");
                    }
                } else {
                    onHandLost();
                }
            } catch (_) { /* swallow single-frame errors */ }
        }

        render(now);
        requestAnimationFrame(detectLoop);
    }

    let lastSymbolAt = 0;
    function onHandDetected(x, y, now) {
        state.trail.push({ x, y, t: now });
        if (state.trail.length > 80) state.trail.shift();

        markCovered(x, y, 60);

        if (now - lastSymbolAt > 60 && Math.random() < 0.75) {
            lastSymbolAt = now;
            const glyphs = STAMPS[state.activeStamp] || STAMPS.birds;
            const glyph = glyphs[
                Math.floor(Math.random() * glyphs.length)
            ];
            const color = BLUE_WHITE_PALETTE[
                Math.floor(Math.random() * BLUE_WHITE_PALETTE.length)
            ];
            state.symbols.push({
                x: x + (Math.random() - 0.5) * 22,
                y: y + (Math.random() - 0.5) * 22,
                glyph,
                color,
                size: 14 + Math.random() * 12,
                rot: (Math.random() - 0.5) * 0.6,
                t: now,
            });
            if (state.symbols.length > 220) state.symbols.shift();

            if (state.synth && !state.muted) {
                state.synth.pluck(x / W, y / H);
            }
        }
    }

    function onHandLost() {
        if (handStatus) {
            handStatus.textContent = "looking for your hand…";
            handStatus.classList.remove("is-tracking");
        }
    }

    // ---------- rendering -------------------------------------
    const SYMBOL_LIFE = 6500;

    function render(now) {
        ctx.clearRect(0, 0, W, H);

        // faded target word — silver-mist ghost over dimmed camera
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.globalCompositeOperation = "screen";
        ctx.drawImage(offCanvas, 0, 0, W, H);
        ctx.restore();

        // dropped symbols — wispy cyan, fade fast
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = state.symbols.length - 1; i >= 0; i--) {
            const s = state.symbols[i];
            const age = (now - s.t) / SYMBOL_LIFE;
            if (age >= 1) {
                state.symbols.splice(i, 1);
                continue;
            }
            const alpha = (1 - age * age) * 0.55;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(s.x, s.y);
            ctx.rotate(s.rot);
            // Render as text — no color-emoji fallback — so
            // fillStyle actually applies (blue + white palette).
            ctx.font =
                `${s.size}px "Cormorant Garamond", "Times New Roman", ` +
                `Georgia, serif`;
            ctx.fillStyle = s.color;
            const isMisty = s.color === "#dfe6f2" ||
                            s.color === "#b8c6de" ||
                            s.color === "#94a8c9";
            ctx.shadowColor = isMisty
                ? "rgba(184, 198, 222, 0.55)"
                : "rgba(70, 100, 160, 0.55)";
            ctx.shadowBlur = 8;
            ctx.fillText(s.glyph, 0, 0);
            ctx.restore();
        }

        // trailing tail — wispy foggy cornflower-blue glow
        if (state.trail.length > 1) {
            ctx.lineCap = "round";
            ctx.shadowColor = "rgba(70, 100, 160, 0.45)";
            ctx.shadowBlur = 10;
            for (let i = 1; i < state.trail.length; i++) {
                const p0 = state.trail[i - 1];
                const p1 = state.trail[i];
                const t = i / state.trail.length;
                const a = 0.05 + t * 0.24;
                // alternate between misty highlight and dusty blue
                // so the trail reads as woven fog + cornflower
                ctx.strokeStyle = i % 2
                    ? `rgba(184, 198, 222, ${a})`
                    : `rgba(63, 90, 142, ${a})`;
                ctx.lineWidth = 1 + t * 5;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
        }

        // the bird at the head of the trail
        if (state.handSmooth) {
            let angle = 0;
            if (state.trail.length >= 4) {
                const a = state.trail[state.trail.length - 4];
                const b = state.trail[state.trail.length - 1];
                angle = Math.atan2(b.y - a.y, b.x - a.x);
            }
            drawBird(state.handSmooth.x, state.handSmooth.y, angle);
        }
    }

    // -------- Blue Magpie --------
    // Small elegant body facing the direction of motion (+x) with
    // long streaming tail feathers extending BEHIND (-x). Draws in
    // the bird's local frame — canvas is rotated so tails always
    // trail correctly behind the finger.
    function drawBird(x, y, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        const t = performance.now();

        // ---- long streaming tail feathers (behind body, -x)
        ctx.save();
        ctx.shadowColor = "rgba(70, 100, 160, 0.5)";
        ctx.shadowBlur = 16;

        // slow "wave" so tail feathers gently undulate
        const wave = Math.sin(t / 320) * 3;

        // outermost feather (longest, most transparent tip) — dusty blue
        const featherGrad = ctx.createLinearGradient(-12, 0, -85, 0);
        featherGrad.addColorStop(0,   "rgba(63, 90, 142, 0.9)");
        featherGrad.addColorStop(0.55,"rgba(85, 120, 163, 0.55)");
        featherGrad.addColorStop(1,   "rgba(85, 120, 163, 0)");
        ctx.fillStyle = featherGrad;
        ctx.beginPath();
        ctx.moveTo(-12, -3);
        ctx.quadraticCurveTo(-40, -2 + wave, -85, 6 + wave * 1.4);
        ctx.quadraticCurveTo(-45, 4 + wave, -12, 3);
        ctx.closePath();
        ctx.fill();

        // middle feather with foggy blue core
        const midGrad = ctx.createLinearGradient(-10, 0, -70, 0);
        midGrad.addColorStop(0,    "rgba(184, 198, 222, 0.9)");
        midGrad.addColorStop(0.55, "rgba(126, 155, 195, 0.55)");
        midGrad.addColorStop(1,    "rgba(126, 155, 195, 0)");
        ctx.fillStyle = midGrad;
        ctx.beginPath();
        ctx.moveTo(-12, 1);
        ctx.quadraticCurveTo(-32, 4 + wave * 0.7, -70, 12 + wave * 1.2);
        ctx.quadraticCurveTo(-35, 8 + wave * 0.7, -12, 5);
        ctx.closePath();
        ctx.fill();

        // wispy filaments extending past feather tips
        ctx.strokeStyle = "rgba(74, 106, 157, 0.5)";
        ctx.lineCap = "round";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-80, 4 + wave);
        ctx.quadraticCurveTo(-100, 8 + wave * 1.6, -118, 14 + wave * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(223, 230, 242, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-70, 0 + wave * 0.6);
        ctx.quadraticCurveTo(-88, 2 + wave, -108, 8 + wave * 1.4);
        ctx.stroke();

        ctx.restore();

        // ---- body: soft mist belly + dusty blue back
        ctx.shadowColor = "rgba(70, 100, 160, 0.4)";
        ctx.shadowBlur = 12;

        // mist belly (whole oval)
        ctx.fillStyle = "#dfe6f2";
        ctx.beginPath();
        ctx.ellipse(0, 1, 13, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        // dusty-blue mantle (top half only)
        const back = ctx.createLinearGradient(0, -10, 0, 2);
        back.addColorStop(0,   "#6a85af");
        back.addColorStop(0.55,"#3f5a8e");
        back.addColorStop(1,   "#1e2e60");
        ctx.fillStyle = back;
        ctx.beginPath();
        ctx.ellipse(0, 1, 13, 10, 0, Math.PI, 0, false);
        ctx.fill();

        // ---- folded wing (subtle flap)
        const flap = Math.sin(t / 120) * 0.28;
        ctx.save();
        ctx.translate(-1, 0);
        ctx.rotate(flap);
        const wingGrad = ctx.createLinearGradient(-4, -3, 6, 3);
        wingGrad.addColorStop(0,   "#94a8c9");
        wingGrad.addColorStop(0.55,"#3f5a8e");
        wingGrad.addColorStop(1,   "#1e2e60");
        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8.5, 4.2, -0.32, 0, Math.PI * 2);
        ctx.fill();
        // wing highlight (misty pale-blue shine)
        ctx.fillStyle = "rgba(223, 230, 242, 0.65)";
        ctx.beginPath();
        ctx.ellipse(-2, -1, 4.5, 1.6, -0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ---- head (mist base + dusty blue crown)
        ctx.fillStyle = "#dfe6f2";
        ctx.beginPath();
        ctx.arc(11, -4, 7.5, 0, Math.PI * 2);
        ctx.fill();

        // dusty blue crown
        const crown = ctx.createLinearGradient(11, -12, 11, -2);
        crown.addColorStop(0,    "#94a8c9");
        crown.addColorStop(0.55, "#3f5a8e");
        crown.addColorStop(1,    "#1e2e60");
        ctx.fillStyle = crown;
        ctx.beginPath();
        ctx.arc(11, -4, 7.5, Math.PI, 0, false);
        ctx.fill();

        // ---- dark eye stripe (magpie signature)
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#1a1f30";
        ctx.beginPath();
        ctx.ellipse(13, -3.5, 5, 2, -0.1, 0, Math.PI * 2);
        ctx.fill();

        // eye
        ctx.fillStyle = "#cfd6e0";
        ctx.beginPath();
        ctx.arc(14.4, -4, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#05070d";
        ctx.beginPath();
        ctx.arc(14.6, -4, 0.5, 0, Math.PI * 2);
        ctx.fill();

        // ---- beak (small, dark, pointed forward)
        ctx.fillStyle = "#1a1f30";
        ctx.beginPath();
        ctx.moveTo(18.5, -3);
        ctx.lineTo(24, -2);
        ctx.lineTo(18.5, -1);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    // ---------- Web Audio synth -------------------------------
    class Synth {
        constructor() {
            const AC = window.AudioContext || window.webkitAudioContext;
            const audio = new AC();
            this.ctx = audio;

            const master = audio.createGain();
            master.gain.value = 0.14;
            master.connect(audio.destination);
            this.master = master;

            const filter = audio.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 2800;
            filter.Q.value = 0.7;
            filter.connect(master);

            const delay = audio.createDelay(2);
            delay.delayTime.value = 0.42;
            const feedback = audio.createGain();
            feedback.gain.value = 0.34;
            const wet = audio.createGain();
            wet.gain.value = 0.45;
            delay.connect(feedback).connect(delay);
            delay.connect(wet).connect(master);
            filter.connect(delay);

            this.dst = filter;

            // ambient pad — softly-detuned sines fading in
            const pad = audio.createGain();
            pad.gain.value = 0.0;
            pad.connect(filter);
            [[220, 0], [220, -8], [329.63, 3], [277.18, -4]].forEach(
                ([f, det]) => {
                    const o = audio.createOscillator();
                    o.type = "sine";
                    o.frequency.value = f;
                    o.detune.value = det;
                    o.connect(pad);
                    o.start();
                }
            );
            pad.gain.setTargetAtTime(
                0.08,
                audio.currentTime + 0.2,
                0.6
            );
            this.pad = pad;

            // A minor pentatonic across two octaves
            this.scale = [0, 3, 5, 7, 10];
            this.rootMidi = 57; // A3
            this.lastPluckAt = 0;
        }

        pluck(x01, y01) {
            const now = this.ctx.currentTime;
            if (now - this.lastPluckAt < 0.09) return;
            this.lastPluckAt = now;

            const octaves = 2;
            const step = Math.floor(
                (1 - y01) * this.scale.length * octaves
            );
            const semis =
                this.scale[step % this.scale.length] +
                Math.floor(step / this.scale.length) * 12;
            const midi = this.rootMidi + semis;
            const freq = 440 * Math.pow(2, (midi - 69) / 12);

            const osc = this.ctx.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = freq;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(0.22, now + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
            osc.connect(g).connect(this.dst);
            osc.start(now);
            osc.stop(now + 1.5);
        }

        setMuted(m) {
            this.master.gain.setTargetAtTime(
                m ? 0 : 0.14,
                this.ctx.currentTime,
                0.05
            );
        }
    }

    // ---------- UI wiring -------------------------------------
    effectBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            effectBtns.forEach((b) => {
                b.classList.remove("is-active");
                b.setAttribute("aria-checked", "false");
            });
            btn.classList.add("is-active");
            btn.setAttribute("aria-checked", "true");
            state.activeStamp = btn.dataset.stamp;
        });
    });

    resetBtn?.addEventListener("click", () => {
        if (state.captured) return;
        state.symbols = [];
        state.trail = [];
        covered.fill(0);
        coveredCount = 0;
        state.unlocked = false;
        shutterBtn.disabled = true;
        shutterProgress.style.strokeDashoffset = RING_CIRC;
        statusLine.textContent =
            "trace her name to unlock the surprise";
    });

    muteBtn?.addEventListener("click", () => {
        state.muted = !state.muted;
        muteBtn.classList.toggle("is-muted", state.muted);
        state.synth?.setMuted(state.muted);
    });

    shutterBtn?.addEventListener("click", () => {
        if (!state.unlocked || state.captured) return;
        state.captured = true;
        triggerReveal();
    });

    function triggerReveal() {
        statusLine.textContent = "Capturing…";
        const flash = document.createElement("div");
        flash.className = "capture-flash is-flashing";
        document.body.appendChild(flash);

        const params = new URLSearchParams();
        params.set("word", targetWord);
        const msg = url.searchParams.get("message");
        if (msg) params.set("message", msg);
        const name = url.searchParams.get("name");
        if (name) params.set("name", name);

        setTimeout(() => {
            window.location.href = "surprise.html?" + params.toString();
        }, 700);
    }

    // ---------- boot flow -------------------------------------
    startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        startBtn.textContent = "Starting…";
        gateError.textContent = "";
        try {
            // audio must be started from a user gesture
            state.synth = new Synth();

            await startCamera();

            startBtn.textContent = "Loading tracker…";
            state.landmarker = await loadLandmarker();

            // ensure canvas is sized to the actual viewport now
            resizeCanvas();

            state.running = true;
            gate.classList.add("is-dismissed");
            app.classList.remove("is-hidden");
            setTimeout(() => {
                gate.style.display = "none";
            }, 700);
            requestAnimationFrame(detectLoop);
        } catch (err) {
            console.error(err);
            startBtn.disabled = false;
            startBtn.textContent = "Enable camera & sound";
            const msg = describeError(err);
            gateError.textContent = msg;
        }
    });

    function describeError(err) {
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            return "Camera access was blocked. Please allow it in your browser " +
                   "and click the button again.";
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") {
            return "No camera was found on this device.";
        }
        if (name === "NotReadableError") {
            return "The camera is being used by another app. " +
                   "Close it and try again.";
        }
        if (err && err.message) return err.message;
        return "Something went wrong starting the experience.";
    }
})();
