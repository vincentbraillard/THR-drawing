/* ============================================================================
   AUTOTRACE.JS — Outil "Auto-Trace" pour l'Éditeur de Tracés Sunae (v5.0+)
   ----------------------------------------------------------------------------
   Convertit une image en un tracé vectoriel continu (calque 'imported_path'),
   à la manière de finitecurve.com : un semis de points pondéré par l'obscurité
   de l'image (stippling), relié par une tournée optimisée (type "TSP-art") —
   une seule ligne continue, sans reconstruction de contours ni recollage de
   fragments, donc pas de traits parasites qui traversent le dessin.

   Dépend de tsp_core.js (chargé avant ce fichier) pour le moteur de calcul
   (stippling pondéré + construction gloutonne + 2-opt), et de l'objet global
   `app` (window.app) déjà exposé par index.html.
   ============================================================================ */

(function () {
    'use strict';

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function toGrayscale(data, w, h) {
        const out = new Float32Array(w * h);
        for (let i = 0, p = 0; p < w * h; i += 4, p++) out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        return out;
    }

    function boxBlur(src, w, h, radius) {
        if (radius <= 0) return src;
        const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            let sum = 0;
            for (let x = -radius; x <= radius; x++) sum += src[y * w + clamp(x, 0, w - 1)];
            for (let x = 0; x < w; x++) {
                tmp[y * w + x] = sum / (radius * 2 + 1);
                sum += src[y * w + clamp(x + radius + 1, 0, w - 1)] - src[y * w + clamp(x - radius, 0, w - 1)];
            }
        }
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
            for (let y = 0; y < h; y++) {
                out[y * w + x] = sum / (radius * 2 + 1);
                sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x];
            }
        }
        return out;
    }

    // Construit la carte de densité (0..1) à partir du gris flouté : un pixel plus sombre
    // que le seuil reçoit une densité qui croît jusqu'à 1 vers le noir pur ; au-dessus du
    // seuil (fond), densité ~0. La marge extérieure (bordure/cadre à ignorer) est mise à 0.
    function buildDensity(gray, w, h, opts) {
        const blurred = boxBlur(gray, w, h, opts.blurRadius);
        const density = new Float32Array(w * h);
        const marginPx = Math.round(Math.min(w, h) * (opts.marginFrac || 0));
        const gamma = 1.4; // accentue le contraste entre zones claires et sombres
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (marginPx > 0 && (x < marginPx || y < marginPx || x >= w - marginPx || y >= h - marginPx)) continue;
                let v = blurred[y * w + x];
                if (opts.invert) v = 255 - v;
                let d = clamp((opts.threshold - v) / Math.max(1, opts.threshold), 0, 1);
                d = Math.pow(d, gamma);
                density[y * w + x] = d;
            }
        }
        return density;
    }

    function mapPixelPathToScene(path, targetSize, mirrorH) {
        if (path.length === 0) return [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        path.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
        const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
        const scale = targetSize / Math.max(w, h);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        return path.map(p => ({ x: (mirrorH ? -1 : 1) * (p.x - cx) * scale, y: (p.y - cy) * scale }));
    }

    // ============================ ÉTAT & PARAMÈTRES ==========================

    const state = {
        built: false,
        srcImage: null, srcName: '',
        tx: { zoom: 1.0, rotDeg: 0, panX: 0, panY: 0, flipH: false, flipV: false },
        params: {
            resolution: 420, blurRadius: 1, threshold: 150, invert: false,
            marginFrac: 0.0, pointCount: 1500, quality: 20,
            mirrorFinal: false,
        },
        pickMode: null, // null | 'start' | 'end'
        startPointPreview: null, // {x,y} en pixels bitmap du canvas d'aperçu (0..previewCanvas.width)
        endPointPreview: null,
        cancelRequested: false, busy: false,
        thumbTimer: null,
    };

    // ================================ STYLES =================================

    function injectStyles() {
        if (document.getElementById('autotrace-styles')) return;
        const css = `
        #autotrace-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center; }
        #autotrace-modal { background:#fff; width:min(920px, 96vw); max-height:92vh; overflow-y:auto; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.3); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
        #autotrace-modal * { box-sizing:border-box; }
        .at-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #eee; position:sticky; top:0; background:#fff; border-radius:12px 12px 0 0; z-index:2; }
        .at-header h2 { margin:0; font-size:16px; }
        .at-close { border:none; background:#f2f2f2; border-radius:8px; width:32px; height:32px; font-size:16px; cursor:pointer; }
        .at-body { display:flex; gap:18px; padding:18px; flex-wrap:wrap; }
        .at-col-left { flex:1 1 380px; min-width:280px; max-width:420px; }
        .at-col-right { flex:1 1 300px; min-width:280px; }
        .at-drop { border:2px dashed #bbb; border-radius:10px; padding:22px; text-align:center; color:#777; cursor:pointer; font-size:13px; }
        .at-drop:hover { border-color:#0078D7; color:#0078D7; }
        .at-preview-wrap { position:relative; margin-top:12px; border-radius:10px; overflow:hidden; background:#e5e5e5; border:1px solid #ddd; width:100%; max-width:400px; aspect-ratio:1/1; }
        /* La page hôte définit "canvas { position:absolute; top:0; left:0; }" pour SON canvas — on
           neutralise cet héritage pour tous les canvases de cet outil (cf. CHANGELOG v4.1.2). */
        #autotrace-modal canvas { position: static !important; top: auto !important; left: auto !important; }
        #at-preview-canvas { display:block; width:100%; height:100%; max-width:100%; max-height:100%; touch-action:none; }
        #at-preview-canvas.at-cursor-grab { cursor:grab; }
        #at-preview-canvas.at-cursor-pick { cursor:crosshair; }
        .at-preview-hint { font-size:11px; color:#888; margin-top:6px; text-align:center; }
        .at-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:13px; }
        .at-row-slider { display:flex; align-items:center; gap:6px; margin-bottom:12px; }
        .at-row-slider input[type=range] { flex:1; }
        .at-badge { font-size:12px; background:#eef4fc; color:#0078D7; padding:2px 8px; border-radius:10px; font-weight:bold; min-width:42px; text-align:center; }
        .at-fieldset { border:1px solid #e2e2e2; border-radius:8px; padding:10px 12px; margin-bottom:14px; }
        .at-fieldset legend { font-size:12px; font-weight:bold; color:#444; padding:0 4px; }
        .at-checkbox-row { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:normal; margin-bottom:8px; }
        .at-btn { padding:9px 14px; border-radius:8px; border:1px solid #ccc; background:#fff; cursor:pointer; font-weight:bold; font-size:13px; }
        .at-btn.active { background:#0078D7; color:#fff; border-color:#0078D7; }
        .at-btn-primary { background:#0078D7; color:#fff; border-color:#0078D7; width:100%; padding:12px; font-size:14px; }
        .at-btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
        .at-btn-row { display:flex; gap:8px; margin-top:6px; }
        .at-point-row { display:flex; gap:6px; margin-bottom:12px; }
        .at-point-row .at-btn { flex:1; font-size:12px; padding:8px 6px; }
        .at-progress-wrap { display:none; margin-top:14px; }
        .at-progress-track { background:#eee; border-radius:8px; height:14px; overflow:hidden; }
        .at-progress-fill { background:#0078D7; height:100%; width:0%; transition:width .15s; }
        .at-progress-label { font-size:12px; color:#555; margin-top:6px; text-align:center; }
        .at-msg { font-size:12px; border-radius:8px; padding:8px 10px; margin-top:10px; display:none; }
        .at-msg.ok { display:block; background:#e8f5e9; color:#2e7d32; }
        .at-msg.err { display:block; background:#ffebee; color:#c62828; }
        `;
        const style = document.createElement('style');
        style.id = 'autotrace-styles'; style.textContent = css;
        document.head.appendChild(style);
    }

    // ================================ DOM UI ==================================

    let els = {};

    function buildModal() {
        injectStyles();
        const backdrop = document.createElement('div');
        backdrop.id = 'autotrace-backdrop'; backdrop.style.display = 'none';
        backdrop.innerHTML = `
        <div id="autotrace-modal">
            <div class="at-header">
                <h2>🧵 Auto-Trace — Image → Tracé TSP</h2>
                <button class="at-close" id="at-btn-close">✕</button>
            </div>
            <div class="at-body">
                <div class="at-col-left">
                    <input type="file" id="at-file-input" accept="image/png, image/jpeg, image/webp" style="display:none;">
                    <div class="at-drop" id="at-drop-zone">📂 Cliquez pour choisir une image<br><span style="font-size:11px;">(ou glissez-déposez un fichier ici)</span></div>
                    <div class="at-preview-wrap" id="at-preview-wrap" style="display:none;">
                        <canvas id="at-preview-canvas" width="360" height="360" class="at-cursor-grab"></canvas>
                    </div>
                    <div class="at-preview-hint" id="at-preview-hint" style="display:none;">Glissez pour cadrer, molette pour zoomer.</div>

                    <div id="at-point-controls" style="display:none; margin-top:10px;">
                        <div class="at-point-row">
                            <button class="at-btn" id="at-btn-pick-start">📍 Point de départ</button>
                            <button class="at-btn" id="at-btn-pick-end">🏁 Point d'arrivée</button>
                            <button class="at-btn" id="at-btn-clear-points">✕</button>
                        </div>
                    </div>

                    <div id="at-transform-controls" style="display:none; margin-top:10px;">
                        <div class="at-row"><label>🔍 Zoom :</label><span class="at-badge" id="at-val-zoom">100%</span></div>
                        <div class="at-row-slider"><input type="range" id="at-zoom" min="20" max="400" value="100"></div>
                        <div class="at-row"><label>🔄 Rotation :</label><span class="at-badge" id="at-val-imgrot">0°</span></div>
                        <div class="at-row-slider"><input type="range" id="at-imgrot" min="-180" max="180" value="0"></div>
                        <div style="display:flex; gap:8px;">
                            <label class="at-checkbox-row"><input type="checkbox" id="at-flip-h"> ↔️ Miroir H</label>
                            <label class="at-checkbox-row"><input type="checkbox" id="at-flip-v"> ↕️ Miroir V</label>
                            <button class="at-btn" id="at-btn-recenter" style="margin-left:auto;">Recentrer</button>
                        </div>
                    </div>
                </div>

                <div class="at-col-right">
                    <div class="at-preview-wrap" id="at-stipple-wrap" style="display:none; max-width:100%; aspect-ratio:1/1; margin-bottom:14px;">
                        <canvas id="at-stipple-canvas" width="300" height="300"></canvas>
                    </div>

                    <fieldset class="at-fieldset">
                        <legend>⚙️ Réglages (façon finitecurve)</legend>

                        <div class="at-row"><label>⚫ Nombre de points :</label><span class="at-badge" id="at-val-points">1500</span></div>
                        <div class="at-row-slider"><input type="range" id="at-points" min="150" max="5000" step="50" value="1500"></div>

                        <div class="at-row"><label>🌗 Seuil (fond à ignorer) :</label><span class="at-badge" id="at-val-threshold">150</span></div>
                        <div class="at-row-slider"><input type="range" id="at-threshold" min="10" max="255" value="150"></div>

                        <label class="at-checkbox-row"><input type="checkbox" id="at-invert"> 🌓 Inverser (sujet clair sur fond sombre)</label>

                        <div class="at-row"><label>🧽 Flou (réduit le bruit) :</label><span class="at-badge" id="at-val-blur">1</span></div>
                        <div class="at-row-slider"><input type="range" id="at-blur" min="0" max="6" value="1"></div>

                        <div class="at-row"><label>🖼️ Marge à ignorer (cadre/bord) :</label><span class="at-badge" id="at-val-margin">0%</span></div>
                        <div class="at-row-slider"><input type="range" id="at-margin" min="0" max="15" value="0"></div>

                        <div class="at-row"><label>🧮 Qualité (optimisation) :</label><span class="at-badge" id="at-val-quality">20</span></div>
                        <div class="at-row-slider"><input type="range" id="at-quality" min="0" max="40" value="20"></div>

                        <div class="at-row"><label>🖥️ Résolution de travail :</label><span class="at-badge" id="at-val-res">420px</span></div>
                        <div class="at-row-slider"><input type="range" id="at-res" min="200" max="700" step="20" value="420"></div>

                        <label class="at-checkbox-row"><input type="checkbox" id="at-mirror-final"> 🪞 Miroir du tracé final</label>
                    </fieldset>

                    <button class="at-btn at-btn-primary" id="at-btn-generate" disabled>✨ Générer le tracé</button>
                    <div class="at-btn-row">
                        <button class="at-btn" id="at-btn-cancel" style="display:none; flex:1;">⛔ Annuler</button>
                    </div>

                    <div class="at-progress-wrap" id="at-progress-wrap">
                        <div class="at-progress-track"><div class="at-progress-fill" id="at-progress-fill"></div></div>
                        <div class="at-progress-label" id="at-progress-label">Préparation…</div>
                    </div>
                    <div class="at-msg" id="at-msg"></div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(backdrop);

        els = {
            backdrop,
            fileInput: backdrop.querySelector('#at-file-input'),
            dropZone: backdrop.querySelector('#at-drop-zone'),
            previewWrap: backdrop.querySelector('#at-preview-wrap'),
            previewCanvas: backdrop.querySelector('#at-preview-canvas'),
            previewHint: backdrop.querySelector('#at-preview-hint'),
            pointControls: backdrop.querySelector('#at-point-controls'),
            btnPickStart: backdrop.querySelector('#at-btn-pick-start'),
            btnPickEnd: backdrop.querySelector('#at-btn-pick-end'),
            btnClearPoints: backdrop.querySelector('#at-btn-clear-points'),
            transformControls: backdrop.querySelector('#at-transform-controls'),
            zoom: backdrop.querySelector('#at-zoom'), valZoom: backdrop.querySelector('#at-val-zoom'),
            imgrot: backdrop.querySelector('#at-imgrot'), valImgrot: backdrop.querySelector('#at-val-imgrot'),
            flipH: backdrop.querySelector('#at-flip-h'), flipV: backdrop.querySelector('#at-flip-v'),
            btnRecenter: backdrop.querySelector('#at-btn-recenter'),
            stippleWrap: backdrop.querySelector('#at-stipple-wrap'),
            stippleCanvas: backdrop.querySelector('#at-stipple-canvas'),
            points: backdrop.querySelector('#at-points'), valPoints: backdrop.querySelector('#at-val-points'),
            threshold: backdrop.querySelector('#at-threshold'), valThreshold: backdrop.querySelector('#at-val-threshold'),
            invert: backdrop.querySelector('#at-invert'),
            blur: backdrop.querySelector('#at-blur'), valBlur: backdrop.querySelector('#at-val-blur'),
            margin: backdrop.querySelector('#at-margin'), valMargin: backdrop.querySelector('#at-val-margin'),
            quality: backdrop.querySelector('#at-quality'), valQuality: backdrop.querySelector('#at-val-quality'),
            res: backdrop.querySelector('#at-res'), valRes: backdrop.querySelector('#at-val-res'),
            mirrorFinal: backdrop.querySelector('#at-mirror-final'),
            btnGenerate: backdrop.querySelector('#at-btn-generate'),
            btnCancel: backdrop.querySelector('#at-btn-cancel'),
            progressWrap: backdrop.querySelector('#at-progress-wrap'),
            progressFill: backdrop.querySelector('#at-progress-fill'),
            progressLabel: backdrop.querySelector('#at-progress-label'),
            msg: backdrop.querySelector('#at-msg'),
            btnClose: backdrop.querySelector('#at-btn-close'),
        };

        wireEvents();
        state.built = true;
    }

    function showMsg(text, kind) { els.msg.textContent = text; els.msg.className = 'at-msg ' + (kind || 'ok'); }
    function clearMsg() { els.msg.className = 'at-msg'; els.msg.textContent = ''; }

    // -------------------------- Chargement de l'image --------------------------

    function loadFile(file) {
        if (!file || !file.type.startsWith('image/')) { showMsg("Ce fichier n'est pas une image.", 'err'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                state.srcImage = img; state.srcName = file.name;
                state.tx = { zoom: 1.0, rotDeg: 0, panX: 0, panY: 0, flipH: false, flipV: false };
                state.startPointPreview = null; state.endPointPreview = null; state.pickMode = null;
                els.dropZone.style.display = 'none';
                els.previewWrap.style.display = 'block'; els.previewHint.style.display = 'block';
                els.transformControls.style.display = 'block'; els.pointControls.style.display = 'block';
                els.stippleWrap.style.display = 'block';
                els.btnGenerate.disabled = false;
                autoSuggestThreshold();
                renderPreview(); scheduleStipplePreview();
            };
            img.onerror = () => showMsg("Impossible de lire cette image.", 'err');
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function autoSuggestThreshold() {
        const tmp = document.createElement('canvas'); const s = 60; tmp.width = s; tmp.height = s;
        const tctx = tmp.getContext('2d'); tctx.drawImage(state.srcImage, 0, 0, s, s);
        const data = tctx.getImageData(0, 0, s, s).data;
        let sum = 0; for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const avg = Math.round(sum / (s * s));
        // seuil de départ légèrement au-dessus de la moyenne, pour capter le sujet sans le fond
        state.params.threshold = clamp(avg + 20, 40, 250);
        els.threshold.value = state.params.threshold; els.valThreshold.textContent = state.params.threshold;
    }

    // ------------------------- Rendu de l'aperçu (canvas) -----------------------

    function drawTransformed(ctx, cw, ch, forExport) {
        ctx.save();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
        const panScaleX = forExport ? cw / els.previewCanvas.width : 1;
        const panScaleY = forExport ? ch / els.previewCanvas.height : 1;
        ctx.translate(cw / 2 + state.tx.panX * panScaleX, ch / 2 + state.tx.panY * panScaleY);
        ctx.rotate(state.tx.rotDeg * Math.PI / 180);
        ctx.scale(state.tx.zoom * (state.tx.flipH ? -1 : 1), state.tx.zoom * (state.tx.flipV ? -1 : 1));
        const img = state.srcImage;
        const fitScale = Math.min(cw, ch) / Math.max(img.width, img.height);
        ctx.drawImage(img, -img.width * fitScale / 2, -img.height * fitScale / 2, img.width * fitScale, img.height * fitScale);
        ctx.restore();

        if (!forExport) {
            ctx.save(); ctx.strokeStyle = 'rgba(0,120,215,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            const shape = (window.app && window.app.settings) ? window.app.settings.shape : 'round';
            if (shape === 'rect') { const margin = 10; ctx.strokeRect(margin, cw * 0.2, cw - margin * 2, ch - cw * 0.4); }
            else { ctx.beginPath(); ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2 - 6, 0, Math.PI * 2); ctx.stroke(); }
            ctx.restore();

            // Marqueurs des points de départ/arrivée choisis par l'utilisateur.
            const drawMarker = (p, color, label) => {
                if (!p) return;
                ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, p.x, p.y);
                ctx.restore();
            };
            drawMarker(state.startPointPreview, '#2e7d32', 'D');
            drawMarker(state.endPointPreview, '#c62828', 'A');
        }
    }

    function renderPreview() {
        if (!state.srcImage) return;
        layoutPreviewCanvas();
        const canvas = els.previewCanvas; const ctx = canvas.getContext('2d');
        drawTransformed(ctx, canvas.width, canvas.height, false);
    }

    function layoutPreviewCanvas() {
        const wrap = els.previewWrap;
        const box = wrap.getBoundingClientRect();
        let size = Math.min(box.width || 340, 400);
        if (size < 100) size = Math.min(340, window.innerWidth - 60);
        els.previewCanvas.style.width = size + 'px';
        els.previewCanvas.style.height = size + 'px';
    }

    // Convertit une position client (souris/tactile) en coordonnées PIXEL BITMAP du
    // canvas d'aperçu (0..previewCanvas.width), quelle que soit sa taille CSS affichée.
    function clientToPreviewBitmap(clientX, clientY) {
        const rect = els.previewCanvas.getBoundingClientRect();
        const scaleX = els.previewCanvas.width / rect.width, scaleY = els.previewCanvas.height / rect.height;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function wirePreviewInteraction() {
        const canvas = els.previewCanvas;
        let dragging = false, lastX = 0, lastY = 0;
        canvas.addEventListener('pointerdown', (e) => {
            if (!state.srcImage) return;
            if (state.pickMode) {
                const p = clientToPreviewBitmap(e.clientX, e.clientY);
                if (state.pickMode === 'start') state.startPointPreview = p; else state.endPointPreview = p;
                setPickMode(null);
                renderPreview();
                return;
            }
            dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            state.tx.panX += (e.clientX - lastX); state.tx.panY += (e.clientY - lastY);
            lastX = e.clientX; lastY = e.clientY;
            renderPreview();
        });
        const endDrag = () => { if (dragging) { dragging = false; canvas.style.cursor = ''; scheduleStipplePreview(); } };
        canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('pointerleave', endDrag);
        canvas.addEventListener('wheel', (e) => {
            if (!state.srcImage) return;
            e.preventDefault();
            const newZoom = clamp(state.tx.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.2, 4.0);
            state.tx.zoom = newZoom; els.zoom.value = Math.round(newZoom * 100); els.valZoom.textContent = Math.round(newZoom * 100) + '%';
            renderPreview(); scheduleStipplePreview();
        }, { passive: false });
    }

    function setPickMode(mode) {
        state.pickMode = mode;
        els.btnPickStart.classList.toggle('active', mode === 'start');
        els.btnPickEnd.classList.toggle('active', mode === 'end');
        els.previewCanvas.classList.toggle('at-cursor-pick', !!mode);
        els.previewCanvas.classList.toggle('at-cursor-grab', !mode);
    }

    // ------------------------------ Aperçu du semis de points --------------------------

    function scheduleStipplePreview() {
        clearTimeout(state.thumbTimer);
        state.thumbTimer = setTimeout(computeStipplePreview, 260);
    }

    function computeStipplePreview() {
        if (!state.srcImage || !window.TSPCore) return;
        const S = 220;
        const cv = els.stippleCanvas; cv.width = S; cv.height = S;
        const cctx = cv.getContext('2d');
        const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
        const tctx = tmp.getContext('2d'); drawTransformed(tctx, S, S, true);
        const data = tctx.getImageData(0, 0, S, S).data;
        const gray = toGrayscale(data, S, S);
        const density = buildDensity(gray, S, S, {
            blurRadius: state.params.blurRadius, threshold: state.params.threshold,
            invert: state.params.invert, marginFrac: state.params.marginFrac,
        });
        const previewCount = Math.min(900, Math.round(state.params.pointCount * (S * S) / (state.params.resolution * state.params.resolution)));
        const pts = window.TSPCore.stipple(density, S, S, Math.max(80, previewCount), 2, Math.random);
        cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, S, S);
        cctx.fillStyle = '#111';
        pts.forEach(p => { cctx.beginPath(); cctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2); cctx.fill(); });
    }

    // ------------------------------ Progression async ----------------------------

    function yieldUI() { return new Promise(r => setTimeout(r, 0)); }
    function setProgress(pct, label) { els.progressFill.style.width = clamp(pct, 0, 100) + '%'; els.progressLabel.textContent = label; }
    function checkCancel() { if (state.cancelRequested) throw new Error('__AUTOTRACE_CANCELLED__'); }

    // --------------------------------- Génération ---------------------------------

    async function generate() {
        if (!state.srcImage || state.busy || !window.TSPCore) return;
        state.busy = true; state.cancelRequested = false;
        clearMsg();
        els.btnGenerate.disabled = true; els.btnCancel.style.display = 'block';
        els.progressWrap.style.display = 'block';
        setProgress(2, "Préparation de l'image…");

        try {
            await yieldUI(); checkCancel();

            const res = state.params.resolution;
            const img = state.srcImage;
            const aspect = img.width / img.height;
            const w = aspect >= 1 ? res : Math.round(res * aspect);
            const h = aspect >= 1 ? Math.round(res / aspect) : res;

            const work = document.createElement('canvas'); work.width = w; work.height = h;
            const wctx = work.getContext('2d');
            drawTransformed(wctx, w, h, true);
            const imageData = wctx.getImageData(0, 0, w, h);

            setProgress(10, 'Analyse (niveaux de gris, flou)…'); await yieldUI(); checkCancel();
            const gray = toGrayscale(imageData.data, w, h);
            const density = buildDensity(gray, w, h, {
                blurRadius: state.params.blurRadius, threshold: state.params.threshold,
                invert: state.params.invert, marginFrac: state.params.marginFrac,
            });

            setProgress(20, 'Placement des points (stippling pondéré)…'); await yieldUI(); checkCancel();
            const rng = Math.random;
            const pts = window.TSPCore.stipple(density, w, h, state.params.pointCount, 4, rng);
            if (pts.length < 2) throw new Error('NO_POINTS');
            await yieldUI(); checkCancel();

            setProgress(45, 'Construction du trajet (plus proche voisin)…'); await yieldUI(); checkCancel();
            let startIdx = null, endIdx = null;
            if (state.startPointPreview) {
                const wp = previewBitmapToWorkSpace(state.startPointPreview, w, h);
                startIdx = nearestPointIndex(pts, wp);
            }
            if (state.endPointPreview) {
                const wp = previewBitmapToWorkSpace(state.endPointPreview, w, h);
                endIdx = nearestPointIndex(pts, wp);
                if (endIdx === startIdx) endIdx = null;
            }
            const tour = window.TSPCore.greedyTour(pts, startIdx, endIdx);
            await yieldUI(); checkCancel();

            setProgress(65, 'Optimisation du trajet (2-opt)…'); await yieldUI(); checkCancel();
            const knn = window.TSPCore.buildKNN(pts, 8);
            await yieldUI(); checkCancel();
            const optimized = window.TSPCore.twoOpt(pts, tour, knn, state.params.quality);
            const finalPath = optimized.map(i => pts[i]);

            setProgress(92, "Mise à l'échelle sur le plateau…"); await yieldUI(); checkCancel();
            const app = window.app;
            const shape = (app && app.settings) ? app.settings.shape : 'round';
            const targetSize = shape === 'rect' ? 420 : 380;
            const scenePoints = mapPixelPathToScene(finalPath, targetSize, state.params.mirrorFinal);

            setProgress(100, 'Terminé !'); await yieldUI();

            if (app && typeof app.addLayer === 'function') {
                app.autoTraceCount = (app.autoTraceCount || 1);
                app.addLayer({
                    type: 'imported_path',
                    name: `🧵 AutoTrace TSP ${app.autoTraceCount++}`,
                    originalPoints: scenePoints, points: [...scenePoints],
                    x: 0, y: 0, scaleX: 1.0, scaleY: 1.0, opacity: 1.0, rot: 0,
                    color: app.ui ? app.ui.color : '#000000', width: 1.0,
                });
                if (typeof app.invalidateSim === 'function') app.invalidateSim();
                if (typeof app.draw === 'function') app.draw();
                if (typeof app.autoSave === 'function') app.autoSave();
            }

            showMsg(`✅ Tracé ajouté (${scenePoints.length} points). Vous pouvez maintenant le repositionner avec l'outil Sélection.`, 'ok');
        } catch (err) {
            if (err && err.message === '__AUTOTRACE_CANCELLED__') showMsg('Génération annulée.', 'err');
            else if (err && err.message === 'NO_POINTS') showMsg('Aucun point détecté — essayez de baisser le seuil ou la marge.', 'err');
            else { console.error(err); showMsg('Une erreur est survenue pendant la génération.', 'err'); }
        } finally {
            state.busy = false;
            els.btnGenerate.disabled = false; els.btnCancel.style.display = 'none';
            setTimeout(() => { els.progressWrap.style.display = 'none'; }, 600);
        }
    }

    // Convertit un point choisi en coordonnées "pixel bitmap de l'aperçu" (0..previewCanvas.width,
    // toujours carré) vers l'espace du canvas de travail final (w x h, pas nécessairement carré) —
    // même convention que panScaleX/Y dans drawTransformed (mise à l'échelle par axe).
    function previewBitmapToWorkSpace(p, w, h) {
        const ps = els.previewCanvas.width;
        return { x: (p.x / ps) * w, y: (p.y / ps) * h };
    }

    function nearestPointIndex(pts, target) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const dx = pts[i].x - target.x, dy = pts[i].y - target.y; const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    // --------------------------------- Câblage UI ---------------------------------

    function wireEvents() {
        els.dropZone.addEventListener('click', () => els.fileInput.click());
        els.fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
        ['dragover', 'dragenter'].forEach(evt => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.style.borderColor = '#0078D7'; }));
        ['dragleave', 'drop'].forEach(evt => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.style.borderColor = '#bbb'; }));
        els.dropZone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

        wirePreviewInteraction();

        els.btnPickStart.addEventListener('click', () => setPickMode(state.pickMode === 'start' ? null : 'start'));
        els.btnPickEnd.addEventListener('click', () => setPickMode(state.pickMode === 'end' ? null : 'end'));
        els.btnClearPoints.addEventListener('click', () => { state.startPointPreview = null; state.endPointPreview = null; setPickMode(null); renderPreview(); });

        els.zoom.addEventListener('input', () => { state.tx.zoom = els.zoom.value / 100; els.valZoom.textContent = els.zoom.value + '%'; renderPreview(); });
        els.zoom.addEventListener('change', scheduleStipplePreview);
        els.imgrot.addEventListener('input', () => { state.tx.rotDeg = parseInt(els.imgrot.value); els.valImgrot.textContent = els.imgrot.value + '°'; renderPreview(); });
        els.imgrot.addEventListener('change', scheduleStipplePreview);
        els.flipH.addEventListener('change', () => { state.tx.flipH = els.flipH.checked; renderPreview(); scheduleStipplePreview(); });
        els.flipV.addEventListener('change', () => { state.tx.flipV = els.flipV.checked; renderPreview(); scheduleStipplePreview(); });
        els.btnRecenter.addEventListener('click', () => {
            state.tx = { zoom: 1.0, rotDeg: 0, panX: 0, panY: 0, flipH: false, flipV: false };
            els.zoom.value = 100; els.valZoom.textContent = '100%'; els.imgrot.value = 0; els.valImgrot.textContent = '0°';
            els.flipH.checked = false; els.flipV.checked = false;
            renderPreview(); scheduleStipplePreview();
        });

        els.points.addEventListener('input', () => { state.params.pointCount = parseInt(els.points.value); els.valPoints.textContent = state.params.pointCount; });
        els.points.addEventListener('change', scheduleStipplePreview);
        els.threshold.addEventListener('input', () => { state.params.threshold = parseInt(els.threshold.value); els.valThreshold.textContent = state.params.threshold; });
        els.threshold.addEventListener('change', scheduleStipplePreview);
        els.invert.addEventListener('change', () => { state.params.invert = els.invert.checked; scheduleStipplePreview(); });
        els.blur.addEventListener('input', () => { state.params.blurRadius = parseInt(els.blur.value); els.valBlur.textContent = state.params.blurRadius; });
        els.blur.addEventListener('change', scheduleStipplePreview);
        els.margin.addEventListener('input', () => { state.params.marginFrac = parseInt(els.margin.value) / 100; els.valMargin.textContent = els.margin.value + '%'; });
        els.margin.addEventListener('change', scheduleStipplePreview);
        els.quality.addEventListener('input', () => { state.params.quality = parseInt(els.quality.value); els.valQuality.textContent = state.params.quality; });
        els.res.addEventListener('input', () => { state.params.resolution = parseInt(els.res.value); els.valRes.textContent = state.params.resolution + 'px'; });
        els.mirrorFinal.addEventListener('change', () => { state.params.mirrorFinal = els.mirrorFinal.checked; });

        els.btnGenerate.addEventListener('click', generate);
        els.btnCancel.addEventListener('click', () => { state.cancelRequested = true; });
        els.btnClose.addEventListener('click', AutoTrace.close);
        els.backdrop.addEventListener('click', (e) => { if (e.target === els.backdrop && !state.busy) AutoTrace.close(); });
    }

    // ================================= API PUBLIQUE ================================

    const AutoTrace = {};

    AutoTrace.open = function () {
        if (!window.app) { alert("L'application principale n'est pas prête."); return; }
        if (!window.TSPCore) { alert("Le moteur TSP (tsp_core.js) n'est pas chargé."); return; }
        if (!state.built) buildModal();
        els.backdrop.style.display = 'flex';
        requestAnimationFrame(() => { layoutPreviewCanvas(); renderPreview(); });
        window.addEventListener('resize', onWindowResizeWhileOpen);
    };

    function onWindowResizeWhileOpen() { layoutPreviewCanvas(); renderPreview(); }

    AutoTrace.close = function () {
        if (state.busy) { if (!confirm('Une génération est en cours, annuler et fermer ?')) return; state.cancelRequested = true; }
        if (els.backdrop) els.backdrop.style.display = 'none';
        window.removeEventListener('resize', onWindowResizeWhileOpen);
    };

    window.AutoTrace = AutoTrace;

    /* ========================================================================
       TSP FILL — remplissage d'une forme déjà présente sur la table par un
       tracé continu façon TSP-art (même moteur que Auto-Trace : tsp_core.js).
       Fonctionne sur le calque actuellement sélectionné (doit être une forme
       fermée : dessinée avec l'outil Mur, Remplissage/Zigzag, ou tout tracé
       fermé). Ceci évite de modifier la machine à états des outils de dessin
       du canevas principal (déjà corrigée avec soin — voir CHANGELOG v4.0) :
       on part d'une forme que l'utilisateur a DÉJÀ dessinée avec les outils
       existants, plutôt que d'ajouter un mode de dessin supplémentaire.
       ======================================================================== */

    function pointInPolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function getSelectedBoundary() {
        const app = window.app;
        if (!app || !app.selectedIds || app.selectedIds.length !== 1) return null;
        const info = app.findLayer(app.selectedIds[0]);
        if (!info) return null;
        const l = info.layer;
        const poly = (l.boundary && l.boundary.length >= 3) ? l.boundary : (l.points && l.points.length >= 3 ? l.points : null);
        if (!poly) return null;
        return { points: poly, name: l.name || 'la forme sélectionnée' };
    }

    const tfState = {
        built: false, boundary: null,
        params: { pointCount: 900, quality: 20, resolution: 260 },
        pickMode: null, startPt: null, endPt: null, // en coordonnées SCÈNE (mêmes unités que la table)
        cancelRequested: false, busy: false,
    };
    let tfEls = {};

    function tfInjectStyles() {
        if (document.getElementById('tspfill-styles')) return;
        const css = `
        #tspfill-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center; }
        #tspfill-modal { background:#fff; width:min(560px, 96vw); max-height:92vh; overflow-y:auto; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.3); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
        #tspfill-modal * { box-sizing:border-box; }
        .tf-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #eee; }
        .tf-header h2 { margin:0; font-size:16px; }
        .tf-close { border:none; background:#f2f2f2; border-radius:8px; width:32px; height:32px; font-size:16px; cursor:pointer; }
        .tf-body { padding:18px; }
        .tf-preview-wrap { position:relative; border-radius:10px; overflow:hidden; background:#f5f5f5; border:1px solid #ddd; width:100%; max-width:400px; aspect-ratio:1/1; margin:0 auto 14px; }
        #tspfill-modal canvas { position:static !important; top:auto !important; left:auto !important; }
        #tf-canvas { display:block; width:100%; height:100%; }
        #tf-canvas.tf-cursor-pick { cursor:crosshair; }
        .tf-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:13px; }
        .tf-row-slider { display:flex; align-items:center; gap:6px; margin-bottom:12px; }
        .tf-row-slider input[type=range] { flex:1; }
        .tf-badge { font-size:12px; background:#eef4fc; color:#0078D7; padding:2px 8px; border-radius:10px; font-weight:bold; min-width:42px; text-align:center; }
        .tf-point-row { display:flex; gap:6px; margin-bottom:14px; }
        .tf-btn { padding:9px 14px; border-radius:8px; border:1px solid #ccc; background:#fff; cursor:pointer; font-weight:bold; font-size:13px; flex:1; }
        .tf-btn.active { background:#0078D7; color:#fff; border-color:#0078D7; }
        .tf-btn-primary { background:#0078D7; color:#fff; border-color:#0078D7; width:100%; padding:12px; font-size:14px; }
        .tf-btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
        .tf-progress-wrap { display:none; margin-top:14px; }
        .tf-progress-track { background:#eee; border-radius:8px; height:14px; overflow:hidden; }
        .tf-progress-fill { background:#0078D7; height:100%; width:0%; transition:width .15s; }
        .tf-progress-label { font-size:12px; color:#555; margin-top:6px; text-align:center; }
        .tf-msg { font-size:12px; border-radius:8px; padding:8px 10px; margin-top:10px; display:none; }
        .tf-msg.ok { display:block; background:#e8f5e9; color:#2e7d32; }
        .tf-msg.err { display:block; background:#ffebee; color:#c62828; }
        .tf-msg.info { display:block; background:#e3f2fd; color:#1565c0; }
        `;
        const style = document.createElement('style');
        style.id = 'tspfill-styles'; style.textContent = css;
        document.head.appendChild(style);
    }

    function tfBuildModal() {
        tfInjectStyles();
        const backdrop = document.createElement('div');
        backdrop.id = 'tspfill-backdrop'; backdrop.style.display = 'none';
        backdrop.innerHTML = `
        <div id="tspfill-modal">
            <div class="tf-header"><h2>🎯 TSP Fill — remplissage par points</h2><button class="tf-close" id="tf-btn-close">✕</button></div>
            <div class="tf-body">
                <div class="tf-preview-wrap"><canvas id="tf-canvas" width="360" height="360"></canvas></div>
                <div class="tf-point-row">
                    <button class="tf-btn" id="tf-btn-pick-start">📍 Point de départ</button>
                    <button class="tf-btn" id="tf-btn-pick-end">🏁 Point d'arrivée</button>
                    <button class="tf-btn" id="tf-btn-clear-points" style="flex:0 0 44px;">✕</button>
                </div>
                <div class="tf-row"><label>⚫ Nombre de points :</label><span class="tf-badge" id="tf-val-points">900</span></div>
                <div class="tf-row-slider"><input type="range" id="tf-points" min="100" max="4000" step="50" value="900"></div>
                <div class="tf-row"><label>🧮 Qualité (optimisation) :</label><span class="tf-badge" id="tf-val-quality">20</span></div>
                <div class="tf-row-slider"><input type="range" id="tf-quality" min="0" max="40" value="20"></div>
                <button class="tf-btn tf-btn-primary" id="tf-btn-generate">✨ Générer le remplissage</button>
                <div class="tf-progress-wrap" id="tf-progress-wrap">
                    <div class="tf-progress-track"><div class="tf-progress-fill" id="tf-progress-fill"></div></div>
                    <div class="tf-progress-label" id="tf-progress-label">Préparation…</div>
                </div>
                <div class="tf-msg" id="tf-msg"></div>
            </div>
        </div>`;
        document.body.appendChild(backdrop);
        tfEls = {
            backdrop,
            canvas: backdrop.querySelector('#tf-canvas'),
            btnPickStart: backdrop.querySelector('#tf-btn-pick-start'),
            btnPickEnd: backdrop.querySelector('#tf-btn-pick-end'),
            btnClearPoints: backdrop.querySelector('#tf-btn-clear-points'),
            points: backdrop.querySelector('#tf-points'), valPoints: backdrop.querySelector('#tf-val-points'),
            quality: backdrop.querySelector('#tf-quality'), valQuality: backdrop.querySelector('#tf-val-quality'),
            btnGenerate: backdrop.querySelector('#tf-btn-generate'),
            progressWrap: backdrop.querySelector('#tf-progress-wrap'),
            progressFill: backdrop.querySelector('#tf-progress-fill'),
            progressLabel: backdrop.querySelector('#tf-progress-label'),
            msg: backdrop.querySelector('#tf-msg'),
            btnClose: backdrop.querySelector('#tf-btn-close'),
        };
        tfWireEvents();
        tfState.built = true;
    }

    function tfShowMsg(text, kind) { tfEls.msg.textContent = text; tfEls.msg.className = 'tf-msg ' + (kind || 'ok'); }

    // Calcule la transformation "scène -> aperçu carré" (bbox du polygone + marge).
    function tfGetSceneToCanvasFit() {
        const poly = tfState.boundary.points;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        poly.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
        const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
        const pad = Math.max(w, h) * 0.08;
        return { minX: minX - pad, minY: minY - pad, span: Math.max(w, h) + pad * 2 };
    }

    function tfRenderPreview() {
        if (!tfState.boundary) return;
        const canvas = tfEls.canvas; const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
        const fit = tfGetSceneToCanvasFit();
        const toCanvas = (p) => ({ x: (p.x - fit.minX) / fit.span * cw, y: (p.y - fit.minY) / fit.span * ch });
        const poly = tfState.boundary.points.map(toCanvas);
        ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,120,215,0.08)'; ctx.fill();
        ctx.strokeStyle = '#0078D7'; ctx.lineWidth = 2; ctx.stroke();

        const drawMarker = (pScene, color, label) => {
            if (!pScene) return;
            const p = toCanvas(pScene);
            ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, p.x, p.y);
            ctx.restore();
        };
        drawMarker(tfState.startPt, '#2e7d32', 'D');
        drawMarker(tfState.endPt, '#c62828', 'A');
    }

    function tfSetPickMode(mode) {
        tfState.pickMode = mode;
        tfEls.btnPickStart.classList.toggle('active', mode === 'start');
        tfEls.btnPickEnd.classList.toggle('active', mode === 'end');
        tfEls.canvas.classList.toggle('tf-cursor-pick', !!mode);
    }

    function tfCanvasClickToScene(clientX, clientY) {
        const canvas = tfEls.canvas; const rect = canvas.getBoundingClientRect();
        const cx = (clientX - rect.left) / rect.width * canvas.width;
        const cy = (clientY - rect.top) / rect.height * canvas.height;
        const fit = tfGetSceneToCanvasFit();
        return { x: fit.minX + (cx / canvas.width) * fit.span, y: fit.minY + (cy / canvas.height) * fit.span };
    }

    function tfYield() { return new Promise(r => setTimeout(r, 0)); }
    function tfSetProgress(pct, label) { tfEls.progressFill.style.width = clamp(pct, 0, 100) + '%'; tfEls.progressLabel.textContent = label; }
    function tfCheckCancel() { if (tfState.cancelRequested) throw new Error('__TSPFILL_CANCELLED__'); }

    async function tfGenerate() {
        if (!tfState.boundary || tfState.busy || !window.TSPCore) return;
        tfState.busy = true; tfState.cancelRequested = false;
        tfEls.btnGenerate.disabled = true; tfEls.progressWrap.style.display = 'block';
        tfSetProgress(5, 'Préparation de la zone…');
        try {
            await tfYield(); tfCheckCancel();
            const fit = tfGetSceneToCanvasFit();
            const res = tfState.params.resolution;
            const poly = tfState.boundary.points;

            const density = new Float32Array(res * res);
            for (let y = 0; y < res; y++) {
                for (let x = 0; x < res; x++) {
                    const sx = fit.minX + (x / res) * fit.span, sy = fit.minY + (y / res) * fit.span;
                    density[y * res + x] = pointInPolygon(sx, sy, poly) ? 1 : 0;
                }
            }
            tfSetProgress(20, 'Placement des points…'); await tfYield(); tfCheckCancel();
            const pts = window.TSPCore.stipple(density, res, res, tfState.params.pointCount, 3, Math.random);
            if (pts.length < 2) throw new Error('NO_POINTS');

            tfSetProgress(45, 'Construction du trajet…'); await tfYield(); tfCheckCancel();
            const sceneToRaster = (p) => ({ x: (p.x - fit.minX) / fit.span * res, y: (p.y - fit.minY) / fit.span * res });
            let startIdx = null, endIdx = null;
            if (tfState.startPt) startIdx = nearestPointIndex(pts, sceneToRaster(tfState.startPt));
            if (tfState.endPt) { endIdx = nearestPointIndex(pts, sceneToRaster(tfState.endPt)); if (endIdx === startIdx) endIdx = null; }
            const tour = window.TSPCore.greedyTour(pts, startIdx, endIdx);
            await tfYield(); tfCheckCancel();

            tfSetProgress(65, 'Optimisation (2-opt)…'); await tfYield(); tfCheckCancel();
            const knn = window.TSPCore.buildKNN(pts, 8);
            await tfYield(); tfCheckCancel();
            const optimized = window.TSPCore.twoOpt(pts, tour, knn, tfState.params.quality);

            tfSetProgress(90, 'Conversion en coordonnées scène…'); await tfYield(); tfCheckCancel();
            const scenePoints = optimized.map(i => ({ x: fit.minX + (pts[i].x / res) * fit.span, y: fit.minY + (pts[i].y / res) * fit.span }));

            tfSetProgress(100, 'Terminé !'); await tfYield();
            const app = window.app;
            if (app && typeof app.addLayer === 'function') {
                app.autoTraceCount = (app.autoTraceCount || 1);
                app.addLayer({
                    type: 'imported_path', name: `🎯 TSP Fill ${app.autoTraceCount++}`,
                    originalPoints: scenePoints, points: [...scenePoints],
                    x: 0, y: 0, scaleX: 1.0, scaleY: 1.0, opacity: 1.0, rot: 0,
                    color: app.ui ? app.ui.color : '#000000', width: 1.0,
                });
                if (typeof app.invalidateSim === 'function') app.invalidateSim();
                if (typeof app.draw === 'function') app.draw();
                if (typeof app.autoSave === 'function') app.autoSave();
            }
            tfShowMsg(`✅ Remplissage ajouté (${scenePoints.length} points).`, 'ok');
        } catch (err) {
            if (err && err.message === '__TSPFILL_CANCELLED__') tfShowMsg('Annulé.', 'err');
            else if (err && err.message === 'NO_POINTS') tfShowMsg('Aucun point placé — la forme est peut-être trop petite.', 'err');
            else { console.error(err); tfShowMsg('Une erreur est survenue.', 'err'); }
        } finally {
            tfState.busy = false; tfEls.btnGenerate.disabled = false;
            setTimeout(() => { tfEls.progressWrap.style.display = 'none'; }, 600);
        }
    }

    function tfWireEvents() {
        tfEls.canvas.addEventListener('pointerdown', (e) => {
            if (!tfState.pickMode) return;
            const p = tfCanvasClickToScene(e.clientX, e.clientY);
            if (tfState.pickMode === 'start') tfState.startPt = p; else tfState.endPt = p;
            tfSetPickMode(null); tfRenderPreview();
        });
        tfEls.btnPickStart.addEventListener('click', () => tfSetPickMode(tfState.pickMode === 'start' ? null : 'start'));
        tfEls.btnPickEnd.addEventListener('click', () => tfSetPickMode(tfState.pickMode === 'end' ? null : 'end'));
        tfEls.btnClearPoints.addEventListener('click', () => { tfState.startPt = null; tfState.endPt = null; tfSetPickMode(null); tfRenderPreview(); });
        tfEls.points.addEventListener('input', () => { tfState.params.pointCount = parseInt(tfEls.points.value); tfEls.valPoints.textContent = tfState.params.pointCount; });
        tfEls.quality.addEventListener('input', () => { tfState.params.quality = parseInt(tfEls.quality.value); tfEls.valQuality.textContent = tfState.params.quality; });
        tfEls.btnGenerate.addEventListener('click', tfGenerate);
        tfEls.btnClose.addEventListener('click', TSPFill.close);
        tfEls.backdrop.addEventListener('click', (e) => { if (e.target === tfEls.backdrop && !tfState.busy) TSPFill.close(); });
    }

    const TSPFill = {};

    TSPFill.open = function () {
        if (!window.app) { alert("L'application principale n'est pas prête."); return; }
        if (!window.TSPCore) { alert("Le moteur TSP (tsp_core.js) n'est pas chargé."); return; }
        const boundary = getSelectedBoundary();
        if (!boundary) {
            alert("Sélectionnez d'abord un calque formant une forme fermée (dessinée avec l'outil Mur ou Remplissage, ou un tracé fermé), puis relancez TSP Fill.");
            return;
        }
        tfState.boundary = boundary; tfState.startPt = null; tfState.endPt = null; tfState.pickMode = null;
        if (!tfState.built) tfBuildModal();
        tfEls.msg.className = 'tf-msg'; tfEls.progressWrap.style.display = 'none';
        tfEls.backdrop.style.display = 'flex';
        requestAnimationFrame(tfRenderPreview);
    };

    TSPFill.close = function () {
        if (tfState.busy) { if (!confirm('Une génération est en cours, annuler et fermer ?')) return; tfState.cancelRequested = true; }
        if (tfEls.backdrop) tfEls.backdrop.style.display = 'none';
    };

    window.TSPFill = TSPFill;
})();
