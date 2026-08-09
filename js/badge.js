// ============================================================
// js/badge.js — SRM NCR WebRing badge editor
// Builds the animated 88x31 member badge on a <canvas>: emblem,
// colour/accent presets, a frame strip, and GIF export via gif.js.
// ============================================================
function init() {
    // Idempotent guard — init() may be called both by DOMContentLoaded (when
    // badge DOM is present in the page directly, e.g. badge.html) and by
    // js/badge-panel.js (when badge DOM is mounted into a cube panel).
    if (window.__SRMBadgeInited) return;
    var canvas = document.getElementById('badgeCanvas');
    if (!canvas) return; // No badge DOM yet — let badge-panel.js mount and call us.
    window.__SRMBadgeInited = true;

    // Preload the ring tree logo for the badge emblem (same-origin, tiny).
    var badgeLogo = new Image();
    badgeLogo.src = 'img/tree_yellow.png';
    var logoReady = false;
    badgeLogo.onload = function () {
        logoReady = true;
        // Redraw already-generated frames so the emblem appears immediately.
        if (typeof frames !== 'undefined' && frames.length > 0) generatePresetFrames();
    };

    function isLight(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
    }

    const badgeCanvas = document.getElementById('badgeCanvas');
    const ctx = badgeCanvas.getContext('2d');

    // Dynamic editor logic
    const badgeText = document.getElementById('badgeText');
    const badgeSubtext = document.getElementById('badgeSubtext');
    const bgColor1 = document.getElementById('bgColor1');
    const bgColor2 = document.getElementById('bgColor2');
    const accentColor = document.getElementById('accentColor');
    const treeColor = document.getElementById('treeColor');
    const presetButtons = document.querySelectorAll('.preset-btn');
    const frameStrip = document.getElementById('frameStrip');
    const btnAddFrame = document.getElementById('btnAddFrame');
    const btnDeleteFrame = document.getElementById('btnDeleteFrame');
    const btnClearFrames = document.getElementById('btnClearFrames');
    const btnExport = document.getElementById('btnExport');
    const exportStatus = document.getElementById('exportStatus');
    const frameDelayInput = document.getElementById('frameDelay');

    let frames = []; // Array of ImageData representing each frame
    let currentFrameIndex = 0;
    let selectedPreset = 'shimmer';
    let animationTimer = null;
    let frameDelay = 250; // ms per frame (preview + exported GIF)

    // Layout constants for the 88x31 canvas
    const EMBLEM_X = 1, EMBLEM_W = 25;          // left emblem panel
    const DIVIDER_X = EMBLEM_X + EMBLEM_W;      // thin accent divider
    const TEXT_X = DIVIDER_X + 4;               // text starts here

    // Draw one badge frame. Shared by every preset; animation handled below.
    function drawBadgeFrame(tempCtx, width, height, frameIndex, totalFrames) {
        // Background gradient
        const grad = tempCtx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, bgColor1.value);
        grad.addColorStop(1, bgColor2.value);
        tempCtx.fillStyle = grad;
        tempCtx.fillRect(0, 0, width, height);

        // Emblem panel (subtle contrast so the logo reads on any background)
        tempCtx.fillStyle = isLight(bgColor1.value) ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.08)';
        tempCtx.fillRect(EMBLEM_X, 1, EMBLEM_W, height - 2);

        // Tree emblem (tinted with the tree color picker)
        var tintCache = null;
        function getTintedLogo() {
            if (tintCache && tintCache.color === treeColor.value) return tintCache.canvas;
            const w = 22;
            const h = Math.round(w * (badgeLogo.height / badgeLogo.width));
            const off = document.createElement('canvas');
            off.width = w;
            off.height = h;
            const o = off.getContext('2d');
            o.drawImage(badgeLogo, 0, 0, w, h);
            o.globalCompositeOperation = 'source-in';
            o.fillStyle = treeColor.value;
            o.fillRect(0, 0, w, h);
            tintCache = { color: treeColor.value, canvas: off };
            return off;
        }

        if (logoReady) {
            const logo = getTintedLogo();
            tempCtx.drawImage(logo, EMBLEM_X + 2, (height - logo.height) / 2);
        } else {
            // Fallback: primitive tree so the badge still has an emblem
            tempCtx.fillStyle = treeColor.value;
            tempCtx.beginPath();
            tempCtx.moveTo(13, 6);
            tempCtx.lineTo(20, 18);
            tempCtx.lineTo(6, 18);
            tempCtx.closePath();
            tempCtx.fill();
            tempCtx.fillRect(11, 18, 4, 6);
        }

        // Accent divider between emblem and text
        tempCtx.fillStyle = accentColor.value;
        tempCtx.fillRect(DIVIDER_X, 3, 1, height - 6);

        // Accent border
        tempCtx.strokeStyle = accentColor.value;
        tempCtx.lineWidth = 1;
        tempCtx.strokeRect(0.5, 0.5, width - 1, height - 1);

        const textVal = badgeText.value.toUpperCase();
        const subVal = badgeSubtext.value;

        // Draw a text label, auto-shrinking to fit the text region.
        // Integer font sizes + rounded positions keep small text crisp.
        function drawTextLabel(val, fullVal, y, size, alpha) {
            let f = Math.max(5, Math.round(size));
            tempCtx.font = 'bold ' + f + "px Arial, 'Helvetica Neue', sans-serif";
            tempCtx.textBaseline = 'middle';
            const maxW = width - TEXT_X - 2;
            while (f > 5 && tempCtx.measureText(fullVal).width > maxW) {
                f -= 1;
                tempCtx.font = 'bold ' + f + "px Arial, 'Helvetica Neue', sans-serif";
            }
            tempCtx.globalAlpha = alpha;
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillText(val, Math.round(TEXT_X), Math.round(y));
            tempCtx.globalAlpha = 1;
        }

        if (selectedPreset === 'shimmer') {
            drawTextLabel(textVal, textVal, 11, 10, 1);
            drawTextLabel(subVal, subVal, 22, 7, 1);

            // Diagonal shimmer sweep
            const progress = frameIndex / (totalFrames - 1);
            const sweepX = -20 + progress * (width + 40);

            tempCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            tempCtx.beginPath();
            tempCtx.moveTo(sweepX, 0);
            tempCtx.lineTo(sweepX + 15, 0);
            tempCtx.lineTo(sweepX + 5, height);
            tempCtx.lineTo(sweepX - 10, height);
            tempCtx.closePath();
            tempCtx.fill();

        } else if (selectedPreset === 'glitch') {
            // Clean base: text (background, emblem, and border are drawn above).
            drawTextLabel(textVal, textVal, 11, 10, 1);
            drawTextLabel(subVal, subVal, 22, 7, 1);

            // Short bursts of corruption between clean frames, so the glitch
            // reads as a brief signal interruption instead of constant noise.
            const burst = [2, 4, 6, 8];
            const heavy = 6;
            if (burst.indexOf(frameIndex) !== -1) {
                const isHeavy = frameIndex === heavy;

                // Snapshot the clean frame so horizontal bands can be torn from it.
                const snap = document.createElement('canvas');
                snap.width = width;
                snap.height = height;
                snap.getContext('2d').drawImage(tempCtx.canvas, 0, 0);

                // Tear horizontal slices and slide each one sideways.
                const sliceCount = isHeavy ? 6 : 3;
                for (let s = 0; s < sliceCount; s++) {
                    const sliceH = 2 + Math.floor(Math.random() * (isHeavy ? 7 : 4));
                    const sliceY = Math.floor(Math.random() * (height - sliceH));
                    const dir = Math.random() < 0.5 ? -1 : 1;
                    const shift = isHeavy
                        ? dir * (3 + Math.floor(Math.random() * 6))
                        : dir * (1 + Math.floor(Math.random() * 3));
                    tempCtx.drawImage(snap, 0, sliceY, width, sliceH, shift, sliceY, width, sliceH);
                }

                // Chromatic aberration: red fringe left, cyan fringe right.
                if (isHeavy) {
                    function tintPass(color, dx) {
                        const pass = document.createElement('canvas');
                        pass.width = width;
                        pass.height = height;
                        const pctx = pass.getContext('2d');
                        pctx.drawImage(snap, 0, 0);
                        pctx.globalCompositeOperation = 'source-in';
                        pctx.fillStyle = color;
                        pctx.fillRect(0, 0, width, height);
                        tempCtx.globalCompositeOperation = 'lighter';
                        tempCtx.globalAlpha = 0.5;
                        tempCtx.drawImage(pass, dx, 0);
                        tempCtx.globalAlpha = 1;
                        tempCtx.globalCompositeOperation = 'source-over';
                    }
                    tintPass('#ff2020', -1);
                    tintPass('#20ffff', 1);
                }

                // Glitch scanlines across the badge.
                const scanCount = isHeavy ? 2 : 1;
                for (let s = 0; s < scanCount; s++) {
                    tempCtx.fillStyle = accentColor.value;
                    tempCtx.globalAlpha = 0.9;
                    tempCtx.fillRect(0, Math.floor(Math.random() * height), width, 1);
                }
                tempCtx.globalAlpha = 1;
            }

        } else if (selectedPreset === 'typewriter') {
            // Reveal text character by character
            const charsToDraw = Math.ceil((frameIndex / (totalFrames - 3)) * textVal.length);
            const partialText = textVal.substring(0, Math.max(0, charsToDraw));
            drawTextLabel(partialText, textVal, 11, 10, 1);

            // Subtext types after the main text finishes
            if (frameIndex > totalFrames / 2) {
                const subChars = Math.ceil(((frameIndex - totalFrames / 2) / (totalFrames / 2 - 1)) * subVal.length);
                const partialSub = subVal.substring(0, Math.max(0, subChars));
                drawTextLabel(partialSub, subVal, 22, 7, 1);
            }
        }
    }

    // Generate frames based on selected preset
    function generatePresetFrames() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 88;
        tempCanvas.height = 31;
        const tempCtx = tempCanvas.getContext('2d');

        frames = [];
        const numFrames = selectedPreset === 'shimmer' ? 12 : selectedPreset === 'glitch' ? 10 : 15;

        for (let i = 0; i < numFrames; i++) {
            tempCtx.clearRect(0, 0, 88, 31);
            drawBadgeFrame(tempCtx, 88, 31, i, numFrames);
            frames.push(tempCtx.getImageData(0, 0, 88, 31));
        }

        currentFrameIndex = 0;
        updateFrameStripUI();
        startPlayback();
    }

    // Render current frame to main preview canvas
    function renderPreviewFrame() {
        if (frames.length === 0) return;
        ctx.putImageData(frames[currentFrameIndex], 0, 0);
    }

    // Playback loop
    function startPlayback() {
        if (animationTimer) clearInterval(animationTimer);
        animationTimer = setInterval(() => {
            if (frames.length > 0) {
                currentFrameIndex = (currentFrameIndex + 1) % frames.length;
                renderPreviewFrame();
                highlightFrameStripActive();
            }
        }, frameDelay); // ms per frame
    }

    // UI Frame strip rendering
    function updateFrameStripUI() {
        if (!frameStrip) return;
        frameStrip.innerHTML = '';

        frames.forEach((frame, index) => {
            const thumb = document.createElement('canvas');
            thumb.width = 88;
            thumb.height = 31;
            const thumbCtx = thumb.getContext('2d');
            thumbCtx.putImageData(frame, 0, 0);

            const container = document.createElement('div');
            container.className = 'frame-thumbnail' +
                (index === currentFrameIndex ? ' is-active' : '');
            container.dataset.index = index;
            container.appendChild(thumb);

            const numLabel = document.createElement('span');
            numLabel.className = 'frame-num';
            numLabel.textContent = index + 1;
            container.appendChild(numLabel);

            container.addEventListener('click', () => {
                clearInterval(animationTimer);
                currentFrameIndex = index;
                renderPreviewFrame();
                highlightFrameStripActive(true);
            });

            frameStrip.appendChild(container);
        });
    }

    function highlightFrameStripActive(doScroll) {
        if (!frameStrip) return;
        const thumbs = frameStrip.querySelectorAll('.frame-thumbnail');
        thumbs.forEach((t, index) => {
            if (index === currentFrameIndex) {
                t.classList.add('is-active');
                // Scroll only on a manual thumbnail click, and only ever scroll
                // the frame strip itself — never the page — so a stationary
                // cursor can't be shifted onto a neighbouring control.
                if (doScroll) {
                    const stripRect = frameStrip.getBoundingClientRect();
                    const thumbRect = t.getBoundingClientRect();
                    if (thumbRect.left < stripRect.left || thumbRect.right > stripRect.right) {
                        frameStrip.scrollBy({
                            left: thumbRect.left < stripRect.left
                                ? thumbRect.left - stripRect.left - 4
                                : thumbRect.right - stripRect.right + 4,
                            behavior: 'smooth'
                        });
                    }
                }
            } else {
                t.classList.remove('is-active');
            }
        });
    }

    // Preset selection change
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            selectedPreset = btn.dataset.preset;
            generatePresetFrames();
        });
    });

    // Form input listeners
    [badgeText, badgeSubtext, bgColor1, bgColor2, accentColor, treeColor].forEach(input => {
        if (input) {
            ['input', 'change'].forEach(evt => {
                input.addEventListener(evt, () => {
                    generatePresetFrames();
                });
            });
        }
    });

    // Frame strip controls
    if (btnAddFrame) {
        btnAddFrame.addEventListener('click', () => {
            // Duplicate current frame
            if (frames.length > 0) {
                clearInterval(animationTimer);
                const currentData = frames[currentFrameIndex];
                const copyData = ctx.createImageData(currentData);
                copyData.data.set(currentData.data);
                frames.splice(currentFrameIndex + 1, 0, copyData);
                currentFrameIndex++;
                updateFrameStripUI();
                renderPreviewFrame();
            }
        });
    }

    if (btnDeleteFrame) {
        btnDeleteFrame.addEventListener('click', () => {
            if (frames.length > 1) {
                clearInterval(animationTimer);
                frames.splice(currentFrameIndex, 1);
                currentFrameIndex = Math.min(currentFrameIndex, frames.length - 1);
                updateFrameStripUI();
                renderPreviewFrame();
            } else {
                alert("Cannot delete the only frame!");
            }
        });
    }

    if (btnClearFrames) {
        btnClearFrames.addEventListener('click', () => {
            generatePresetFrames();
        });
    }

    // GIF delay control (applies to preview playback and exported GIF)
    if (frameDelayInput) {
        frameDelayInput.addEventListener('input', () => {
            const n = parseInt(frameDelayInput.value, 10);
            frameDelay = isNaN(n) ? 250 : Math.min(2000, Math.max(50, n));
            frameDelayInput.value = frameDelay;
            if (animationTimer) startPlayback();
        });
    }

    // Real Browser-Side GIF Encoding via gif.js and cross-origin Web Worker trick
    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            if (frames.length === 0) {
                alert("No frames to export!");
                return;
            }

            btnExport.disabled = true;
            exportStatus.textContent = 'Generating worker...';

            try {
                // Fetch the worker content from cloudflare cdnjs to avoid CORS blocks
                const workerScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
                const workerResponse = await fetch(workerScriptUrl);
                const workerBlob = await workerResponse.blob();
                const workerBlobUrl = URL.createObjectURL(workerBlob);

                // Initialize gif.js
                const gif = new GIF({
                    workers: 2,
                    quality: 10,
                    width: 88,
                    height: 31,
                    workerScript: workerBlobUrl
                });

                // Add all frames
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = 88;
                tempCanvas.height = 31;
                const tempCtx = tempCanvas.getContext('2d');

                frames.forEach((frameData) => {
                    tempCtx.putImageData(frameData, 0, 0);
                    gif.addFrame(tempCtx, { copy: true, delay: frameDelay });
                });

                exportStatus.textContent = 'Rendering GIF...';

                gif.on('finished', (blob) => {
                    exportStatus.textContent = 'Download ready!';
                    btnExport.disabled = false;

                    // Trigger browser download
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${badgeText.value.toLowerCase().replace(/\s+/g, '-')}-badge.gif`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    // Revoke URL to save memory
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                });

                gif.render();

            } catch (err) {
                console.error(err);
                exportStatus.textContent = 'Export failed: Check console.';
                btnExport.disabled = false;
            }
        });
    }

    // Initialize Editor on start
    generatePresetFrames();
}

// Exposed for late-mount (e.g. cube panel injection by js/badge-panel.js).
window.__SRMBadgeInit = init;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
