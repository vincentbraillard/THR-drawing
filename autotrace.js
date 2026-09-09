/* ============================================================================
   AUTOTRACE.JS — Outil "Auto-Trace" pour l'Éditeur de Tracés Sunae (v4.1+)
   ----------------------------------------------------------------------------
   Convertit une image importée en un tracé vectoriel continu (calque
   'imported_path'), dans l'esprit de SandTrace : silhouette / seuil / contours,
   avec réglages de détail, flou, lissage, et une pré-transformation (zoom,
   rotation, recadrage, miroir) de l'image avant tracé.

   Fichier volontairement séparé de index.html pour ne pas l'alourdir. Il ne
   dépend que de l'objet global `app` déjà exposé par index.html (window.app),
   et n'est utilisé qu'au moment où l'utilisateur ouvre l'outil (AutoTrace.open()).

   Algorithmes utilisés (implémentation "from scratch", sans dépendance externe
   type OpenCV) :
     - Niveaux de gris + flou boîte (séparable) pour lisser le bruit.
     - Détection de contours par gradient de Sobel (seuil simple — c'est une
       version simplifiée d'un détecteur façon Canny, sans suppression des
       non-maxima ni hystérésis, pour rester léger et 100% JS).
     - Composantes connexes (4-connexité) pour isoler la forme principale en
       mode Silhouette.
     - Extraction de contours fermés par "marching squares" (avec un cadre
       de padding pour garantir que tous les contours se referment).
     - Simplification Douglas-Peucker + lissage Chaikin.
     - Assemblage des contours en un seul tracé continu par plus-proche-voisin
       glouton (minimise les déplacements "à vide" entre les formes).
   Le pipeline complet a été testé unitairement en Node.js avant intégration
   (grille synthétique, formes avec trous, deux composantes, DP/Chaikin,
   assemblage) — voir le CHANGELOG pour le détail des vérifications.
   ============================================================================ */

(function () {
    'use strict';

    // ============================== ALGOS PURS ==============================
    // (identiques à ceux validés indépendamment sous Node — voir CHANGELOG)

    const Core = {};

    Core.makePaddedGrid = function (w, h, sampleFn) {
        const pw = w + 2, ph = h + 2;
        const grid = new Uint8Array(pw * ph);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) grid[(y + 1) * pw + (x + 1)] = sampleFn(x, y) ? 1 : 0;
        }
        return { grid, pw, ph };
    };

    Core.connectedComponents = function (grid, pw, ph) {
        const labels = new Int32Array(pw * ph).fill(-1);
        const comps = [];
        let nextLabel = 0;
        const stack = [];
        for (let start = 0; start < pw * ph; start++) {
            if (grid[start] !== 1 || labels[start] !== -1) continue;
            let area = 0;
            stack.length = 0; stack.push(start); labels[start] = nextLabel;
            while (stack.length) {
                const idx = stack.pop();
                const x = idx % pw, y = (idx / pw) | 0;
                area++;
                const neighbors = [idx - 1, idx + 1, idx - pw, idx + pw];
                for (const n of neighbors) {
                    if (n < 0 || n >= pw * ph) continue;
                    if ((n === idx - 1 || n === idx + 1) && ((n / pw) | 0) !== y) continue;
                    if (grid[n] === 1 && labels[n] === -1) { labels[n] = nextLabel; stack.push(n); }
                }
            }
            comps.push({ label: nextLabel, area });
            nextLabel++;
        }
        return { labels, comps };
    };

    Core.keepLargestComponents = function (grid, pw, ph, keep) {
        const { labels, comps } = Core.connectedComponents(grid, pw, ph);
        if (comps.length <= keep) return grid;
        const sorted = [...comps].sort((a, b) => b.area - a.area);
        const keepSet = new Set(sorted.slice(0, keep).map(c => c.label));
        const out = new Uint8Array(pw * ph);
        for (let i = 0; i < grid.length; i++) if (grid[i] === 1 && keepSet.has(labels[i])) out[i] = 1;
        return out;
    };

    Core.traceContours = function (grid, pw, ph) {
        const segments = [];
        const at = (x, y) => grid[y * pw + x];
        for (let y = 0; y < ph - 1; y++) {
            for (let x = 0; x < pw - 1; x++) {
                const tl = at(x, y), tr = at(x + 1, y), bl = at(x, y + 1), br = at(x + 1, y + 1);
                const c = tl * 8 + tr * 4 + br * 2 + bl * 1;
                if (c === 0 || c === 15) continue;
                const top = { x: x + 0.5, y: y }, bottom = { x: x + 0.5, y: y + 1 };
                const left = { x: x, y: y + 0.5 }, right = { x: x + 1, y: y + 0.5 };
                switch (c) {
                    case 1: segments.push({ a: left, b: bottom }); break;
                    case 2: segments.push({ a: bottom, b: right }); break;
                    case 3: segments.push({ a: left, b: right }); break;
                    case 4: segments.push({ a: top, b: right }); break;
                    case 5: segments.push({ a: left, b: top }); segments.push({ a: bottom, b: right }); break;
                    case 6: segments.push({ a: top, b: bottom }); break;
                    case 7: segments.push({ a: left, b: top }); break;
                    case 8: segments.push({ a: top, b: left }); break;
                    case 9: segments.push({ a: top, b: bottom }); break;
                    case 10: segments.push({ a: top, b: right }); segments.push({ a: left, b: bottom }); break;
                    case 11: segments.push({ a: top, b: right }); break;
                    case 12: segments.push({ a: right, b: left }); break;
                    case 13: segments.push({ a: right, b: bottom }); break;
                    case 14: segments.push({ a: bottom, b: left }); break;
                }
            }
        }
        const key = (p) => p.x + ',' + p.y;
        const bucket = new Map();
        segments.forEach((s, i) => {
            [['a', s.a], ['b', s.b]].forEach(([which, p]) => {
                const k = key(p); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push({ i, which });
            });
        });
        const used = new Uint8Array(segments.length);
        const contours = [];
        for (let i = 0; i < segments.length; i++) {
            if (used[i]) continue;
            used[i] = 1;
            const loop = [segments[i].a, segments[i].b];
            let guard = 0;
            while (guard++ < segments.length * 2) {
                const tail = loop[loop.length - 1];
                const candidates = bucket.get(key(tail)) || [];
                let next = null;
                for (const cand of candidates) { if (!used[cand.i]) { next = cand; break; } }
                if (!next) break;
                used[next.i] = 1;
                const seg = segments[next.i];
                const nextPoint = next.which === 'a' ? seg.b : seg.a;
                if (Math.abs(nextPoint.x - tail.x) > 1e-9 || Math.abs(nextPoint.y - tail.y) > 1e-9) loop.push(nextPoint);
                if (Math.abs(nextPoint.x - loop[0].x) < 1e-9 && Math.abs(nextPoint.y - loop[0].y) < 1e-9) break;
            }
            if (loop.length >= 4) contours.push(loop);
        }
        return contours;
    };

    Core.simplifyDP = function (points, tolerance) {
        if (points.length < 3 || tolerance <= 0) return points.slice();
        const sqTolerance = tolerance * tolerance;
        const sqDist = (p, a, b) => {
            let x = a.x, y = a.y, dx = b.x - x, dy = b.y - y;
            if (dx !== 0 || dy !== 0) {
                const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
                if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
            }
            dx = p.x - x; dy = p.y - y; return dx * dx + dy * dy;
        };
        const simplifyRec = (pts, first, last, out) => {
            let maxDist = sqTolerance, index = -1;
            for (let i = first + 1; i < last; i++) {
                const d = sqDist(pts[i], pts[first], pts[last]);
                if (d > maxDist) { index = i; maxDist = d; }
            }
            if (index > -1) {
                if (index - first > 1) simplifyRec(pts, first, index, out);
                out.push(pts[index]);
                if (last - index > 1) simplifyRec(pts, index, last, out);
            }
        };
        const out = [points[0]];
        simplifyRec(points, 0, points.length - 1, out);
        out.push(points[points.length - 1]);
        return out;
    };

    Core.chaikinSmooth = function (points, iterations) {
        let pts = points;
        for (let it = 0; it < iterations; it++) {
            const out = []; const n = pts.length;
            for (let i = 0; i < n; i++) {
                const p0 = pts[i], p1 = pts[(i + 1) % n];
                out.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
                out.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
            }
            pts = out;
        }
        return pts;
    };

    Core.stitchContours = function (contours, startPoint) {
        if (contours.length === 0) return [];
        const remaining = contours.map(c => c.slice());
        const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
        let cursor = startPoint || { x: 0, y: 0 };
        const finalPath = [];
        while (remaining.length) {
            let bestIdx = 0, bestOffset = 0, bestDist = Infinity;
            for (let ci = 0; ci < remaining.length; ci++) {
                const loop = remaining[ci];
                for (let oi = 0; oi < loop.length; oi++) {
                    const d = dist2(cursor, loop[oi]);
                    if (d < bestDist) { bestDist = d; bestIdx = ci; bestOffset = oi; }
                }
            }
            const loop = remaining.splice(bestIdx, 1)[0];
            const rotated = loop.slice(bestOffset).concat(loop.slice(0, bestOffset));
            rotated.push(rotated[0]);
            finalPath.push(...rotated);
            cursor = rotated[rotated.length - 1];
        }
        return finalPath;
    };

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

    function sobelMagnitude(gray, w, h) {
        const mag = new Float32Array(w * h);
        const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
        let maxMag = 1;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                let sx = 0, sy = 0, k = 0;
                for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++, k++) {
                    const v = gray[(y + ky) * w + (x + kx)]; sx += v * gx[k]; sy += v * gy[k];
                }
                const m = Math.hypot(sx, sy); mag[y * w + x] = m; if (m > maxMag) maxMag = m;
            }
        }
        return { mag, maxMag };
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

    // Construit la grille binaire selon le mode choisi (seuil / silhouette / contours).
    function buildBinaryGrid(gray, w, h, opts) {
        const blurred = boxBlur(gray, w, h, opts.blurRadius);
        if (opts.mode === 'edges') {
            const { mag, maxMag } = sobelMagnitude(blurred, w, h);
            const cutoff = (1 - opts.edgeSensitivity / 100) * maxMag * 0.5;
            return Core.makePaddedGrid(w, h, (x, y) => mag[y * w + x] > cutoff);
        }
        // seuil / silhouette
        return Core.makePaddedGrid(w, h, (x, y) => {
            const dark = blurred[y * w + x] < opts.threshold;
            return opts.invert ? !dark : dark;
        });
    }

    // ============================ ÉTAT & PARAMÈTRES ==========================

    const state = {
        built: false,
        srcImage: null, srcName: '',
        tx: { zoom: 1.0, rotDeg: 0, panX: 0, panY: 0, flipH: false, flipV: false },
        mode: 'threshold', // 'threshold' | 'silhouette' | 'edges'
        params: {
            resolution: 500, blurRadius: 1, threshold: 128, invert: false,
            edgeSensitivity: 55, keepLargestOnly: true, detail: 55, chaikinIters: 1,
            mirrorFinal: false,
        },
        cancelRequested: false, busy: false,
        thumbTimer: null,
    };

    function detailToParams(detail) {
        // detail: 0 (grossier) .. 100 (fin). Contrôle à la fois la tolérance de
        // simplification et le nombre minimal de points pour garder un petit contour.
        const t = clamp(detail, 0, 100) / 100;
        return {
            dpTolerance: 3.0 - t * 2.7,       // 3.0 -> 0.3
            minContourPoints: Math.round(50 - t * 42), // 50 -> 8
        };
    }

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
        /* IMPORTANT : la page hôte (index.html) définit une règle globale "canvas { position:absolute;
           top:0; left:0; }" pour SON propre canvas de dessin. Sans réinitialisation explicite ici, cette
           règle s'appliquerait aussi à nos canvases (ils sont dans le même document) et les ferait sortir
           du flux normal pour se plaquer en plein écran, cachant boutons et curseurs en dessous. */
        #autotrace-modal canvas { position: static !important; top: auto !important; left: auto !important; }
        #at-preview-canvas { display:block; width:100%; height:100%; max-width:100%; max-height:100%; touch-action:none; cursor:grab; }
        .at-preview-hint { font-size:11px; color:#888; margin-top:6px; text-align:center; }
        .at-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:13px; }
        .at-row-slider { display:flex; align-items:center; gap:6px; margin-bottom:12px; }
        .at-row-slider input[type=range] { flex:1; }
        .at-badge { font-size:12px; background:#eef4fc; color:#0078D7; padding:2px 8px; border-radius:10px; font-weight:bold; min-width:42px; text-align:center; }
        .at-fieldset { border:1px solid #e2e2e2; border-radius:8px; padding:10px 12px; margin-bottom:14px; }
        .at-fieldset legend { font-size:12px; font-weight:bold; color:#444; padding:0 4px; }
        .at-modes { display:flex; gap:8px; margin-bottom:14px; }
        .at-mode-card { flex:1; border:2px solid #ddd; border-radius:8px; padding:6px; cursor:pointer; text-align:center; background:#fafafa; }
        .at-mode-card.active { border-color:#0078D7; background:#eef4fc; }
        .at-mode-card canvas { width:100%; aspect-ratio:1/1; background:#fff; border-radius:4px; display:block; }
        .at-mode-card div.at-mode-label { font-size:11px; margin-top:4px; font-weight:bold; color:#333; }
        .at-checkbox-row { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:normal; margin-bottom:8px; }
        .at-btn { padding:9px 14px; border-radius:8px; border:1px solid #ccc; background:#fff; cursor:pointer; font-weight:bold; font-size:13px; }
        .at-btn-primary { background:#0078D7; color:#fff; border-color:#0078D7; width:100%; padding:12px; font-size:14px; }
        .at-btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
        .at-btn-row { display:flex; gap:8px; margin-top:6px; }
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

    let els = {}; // cache des références DOM

    function buildModal() {
        injectStyles();
        const backdrop = document.createElement('div');
        backdrop.id = 'autotrace-backdrop'; backdrop.style.display = 'none';
        backdrop.innerHTML = `
        <div id="autotrace-modal">
            <div class="at-header">
                <h2>🧵 Auto-Trace — Image → Tracé</h2>
                <button class="at-close" id="at-btn-close">✕</button>
            </div>
            <div class="at-body">
                <div class="at-col-left">
                    <input type="file" id="at-file-input" accept="image/png, image/jpeg, image/webp" style="display:none;">
                    <div class="at-drop" id="at-drop-zone">📂 Cliquez pour choisir une image<br><span style="font-size:11px;">(ou glissez-déposez un fichier ici)</span></div>
                    <div class="at-preview-wrap" id="at-preview-wrap" style="display:none;">
                        <canvas id="at-preview-canvas" width="360" height="360"></canvas>
                    </div>
                    <div class="at-preview-hint" id="at-preview-hint" style="display:none;">Glissez pour cadrer l'image, molette pour zoomer.</div>

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
                    <div class="at-modes" id="at-modes" style="display:none;">
                        <div class="at-mode-card active" data-mode="threshold"><canvas width="90" height="90"></canvas><div class="at-mode-label">Seuil (contours)</div></div>
                        <div class="at-mode-card" data-mode="silhouette"><canvas width="90" height="90"></canvas><div class="at-mode-label">Silhouette</div></div>
                        <div class="at-mode-card" data-mode="edges"><canvas width="90" height="90"></canvas><div class="at-mode-label">Contours fins</div></div>
                    </div>

                    <fieldset class="at-fieldset">
                        <legend>⚙️ Réglages</legend>

                        <div id="at-row-threshold">
                            <div class="at-row"><label>🌗 Seuil de luminosité :</label><span class="at-badge" id="at-val-threshold">128</span></div>
                            <div class="at-row-slider"><input type="range" id="at-threshold" min="0" max="255" value="128"></div>
                        </div>

                        <div id="at-row-edges" style="display:none;">
                            <div class="at-row"><label>📶 Sensibilité des contours :</label><span class="at-badge" id="at-val-edgesens">55</span></div>
                            <div class="at-row-slider"><input type="range" id="at-edgesens" min="1" max="100" value="55"></div>
                        </div>

                        <label class="at-checkbox-row"><input type="checkbox" id="at-invert"> 🌓 Inverser (sujet clair sur fond sombre)</label>
                        <div id="at-row-keeplargest">
                            <label class="at-checkbox-row"><input type="checkbox" id="at-keeplargest" checked> 🎯 Garder uniquement la forme principale</label>
                        </div>

                        <div class="at-row"><label>🧽 Flou (réduit le bruit) :</label><span class="at-badge" id="at-val-blur">1</span></div>
                        <div class="at-row-slider"><input type="range" id="at-blur" min="0" max="6" value="1"></div>

                        <div class="at-row"><label>🔬 Détail :</label><span class="at-badge" id="at-val-detail">55</span></div>
                        <div class="at-row-slider"><input type="range" id="at-detail" min="0" max="100" value="55"></div>

                        <div class="at-row"><label>〰️ Lissage du tracé :</label><span class="at-badge" id="at-val-chaikin">1</span></div>
                        <div class="at-row-slider"><input type="range" id="at-chaikin" min="0" max="4" value="1"></div>

                        <div class="at-row"><label>🖥️ Résolution de travail :</label><span class="at-badge" id="at-val-res">500px</span></div>
                        <div class="at-row-slider"><input type="range" id="at-res" min="200" max="900" step="50" value="500"></div>

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
            transformControls: backdrop.querySelector('#at-transform-controls'),
            zoom: backdrop.querySelector('#at-zoom'), valZoom: backdrop.querySelector('#at-val-zoom'),
            imgrot: backdrop.querySelector('#at-imgrot'), valImgrot: backdrop.querySelector('#at-val-imgrot'),
            flipH: backdrop.querySelector('#at-flip-h'), flipV: backdrop.querySelector('#at-flip-v'),
            btnRecenter: backdrop.querySelector('#at-btn-recenter'),
            modes: backdrop.querySelector('#at-modes'),
            rowThreshold: backdrop.querySelector('#at-row-threshold'),
            rowEdges: backdrop.querySelector('#at-row-edges'),
            rowKeepLargest: backdrop.querySelector('#at-row-keeplargest'),
            threshold: backdrop.querySelector('#at-threshold'), valThreshold: backdrop.querySelector('#at-val-threshold'),
            edgesens: backdrop.querySelector('#at-edgesens'), valEdgesens: backdrop.querySelector('#at-val-edgesens'),
            invert: backdrop.querySelector('#at-invert'), keeplargest: backdrop.querySelector('#at-keeplargest'),
            blur: backdrop.querySelector('#at-blur'), valBlur: backdrop.querySelector('#at-val-blur'),
            detail: backdrop.querySelector('#at-detail'), valDetail: backdrop.querySelector('#at-val-detail'),
            chaikin: backdrop.querySelector('#at-chaikin'), valChaikin: backdrop.querySelector('#at-val-chaikin'),
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

    function showMsg(text, kind) {
        els.msg.textContent = text; els.msg.className = 'at-msg ' + (kind || 'ok');
    }
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
                els.dropZone.style.display = 'none';
                els.previewWrap.style.display = 'block'; els.previewHint.style.display = 'block';
                els.transformControls.style.display = 'block'; els.modes.style.display = 'flex';
                els.btnGenerate.disabled = false;
                autoSuggestThreshold();
                renderPreview(); scheduleThumbnails();
            };
            img.onerror = () => showMsg("Impossible de lire cette image.", 'err');
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function autoSuggestThreshold() {
        // Moyenne de luminosité sur une version miniature -> seuil de départ raisonnable.
        const tmp = document.createElement('canvas'); const s = 60; tmp.width = s; tmp.height = s;
        const tctx = tmp.getContext('2d'); tctx.drawImage(state.srcImage, 0, 0, s, s);
        const data = tctx.getImageData(0, 0, s, s).data;
        let sum = 0; for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const avg = Math.round(sum / (s * s));
        state.params.threshold = clamp(avg, 10, 245);
        els.threshold.value = state.params.threshold; els.valThreshold.textContent = state.params.threshold;
    }

    // ------------------------- Rendu de l'aperçu (canvas) -----------------------

    // Dessine l'image transformée (zoom/rotation/pan/miroir) sur un canvas de travail
    // donné, centrée, avec un cadre de fond neutre. Réutilisé pour l'aperçu ET pour
    // générer les pixels envoyés au pipeline (mêmes réglages, juste une résolution différente).
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
            // Aperçu de la forme du plateau (cadre de référence, purement indicatif)
            ctx.save(); ctx.strokeStyle = 'rgba(0,120,215,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            const shape = (window.app && window.app.settings) ? window.app.settings.shape : 'round';
            if (shape === 'rect') {
                const margin = 10; ctx.strokeRect(margin, cw * 0.2, cw - margin * 2, ch - cw * 0.4);
            } else {
                ctx.beginPath(); ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2 - 6, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.restore();
        }
    }

    function renderPreview() {
        if (!state.srcImage) return;
        layoutPreviewCanvas();
        const canvas = els.previewCanvas; const ctx = canvas.getContext('2d');
        drawTransformed(ctx, canvas.width, canvas.height, false);
    }

    // Filet de sécurité : fixe explicitement la taille CSS (en px) du canvas d'aperçu à
    // partir de son conteneur, au lieu de compter uniquement sur `aspect-ratio` / le
    // dimensionnement intrinsèque d'un <canvas> (peu fiable selon les navigateurs), pour
    // garantir que l'aperçu ne déborde jamais hors de sa zone quelle que soit la taille
    // de l'image importée.
    function layoutPreviewCanvas() {
        const wrap = els.previewWrap;
        const box = wrap.getBoundingClientRect();
        let size = Math.min(box.width || 340, 400);
        if (size < 100) size = Math.min(340, window.innerWidth - 60); // repli si le layout n'est pas encore prêt
        els.previewCanvas.style.width = size + 'px';
        els.previewCanvas.style.height = size + 'px';
    }

    function wirePreviewInteraction() {
        const canvas = els.previewCanvas;
        let dragging = false, lastX = 0, lastY = 0;
        canvas.addEventListener('pointerdown', (e) => {
            if (!state.srcImage) return;
            dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            state.tx.panX += (e.clientX - lastX); state.tx.panY += (e.clientY - lastY);
            lastX = e.clientX; lastY = e.clientY;
            renderPreview();
        });
        const endDrag = () => { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; scheduleThumbnails(); } };
        canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('pointerleave', endDrag);
        canvas.addEventListener('wheel', (e) => {
            if (!state.srcImage) return;
            e.preventDefault();
            const newZoom = clamp(state.tx.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.2, 4.0);
            state.tx.zoom = newZoom; els.zoom.value = Math.round(newZoom * 100); els.valZoom.textContent = Math.round(newZoom * 100) + '%';
            renderPreview(); scheduleThumbnails();
        }, { passive: false });
    }

    // ------------------------------ Miniatures modes -----------------------------

    function scheduleThumbnails() {
        clearTimeout(state.thumbTimer);
        state.thumbTimer = setTimeout(computeThumbnails, 260);
    }

    function computeThumbnails() {
        if (!state.srcImage) return;
        const S = 90;
        const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
        const tctx = tmp.getContext('2d'); drawTransformed(tctx, S, S, true);
        const data = tctx.getImageData(0, 0, S, S).data;
        const gray = toGrayscale(data, S, S);
        const det = detailToParams(state.params.detail);

        const modeConfigs = [
            { mode: 'threshold', card: 0 },
            { mode: 'silhouette', card: 1 },
            { mode: 'edges', card: 2 },
        ];
        modeConfigs.forEach(({ mode, card }) => {
            const cardEl = els.modes.children[card]; const cv = cardEl.querySelector('canvas');
            const cctx = cv.getContext('2d'); cctx.clearRect(0, 0, S, S); cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, S, S);
            try {
                const opts = {
                    mode, blurRadius: state.params.blurRadius, threshold: state.params.threshold, invert: state.params.invert,
                    edgeSensitivity: state.params.edgeSensitivity, keepLargestOnly: state.params.keepLargestOnly,
                    dpTolerance: det.dpTolerance, minContourPoints: Math.max(4, Math.round(det.minContourPoints / 3)), chaikinIters: 0,
                };
                let { grid, pw, ph } = buildBinaryGrid(gray, S, S, opts);
                if (mode === 'silhouette' && opts.keepLargestOnly) grid = Core.keepLargestComponents(grid, pw, ph, 1);
                const contours = Core.traceContours(grid, pw, ph).filter(c => c.length >= opts.minContourPoints);
                cctx.strokeStyle = '#000'; cctx.lineWidth = 1;
                contours.forEach(c => {
                    cctx.beginPath(); cctx.moveTo(c[0].x, c[0].y);
                    for (let i = 1; i < c.length; i++) cctx.lineTo(c[i].x, c[i].y);
                    cctx.stroke();
                });
            } catch (err) { /* aperçu best-effort uniquement */ }
        });
    }

    // ------------------------------ Progression async ----------------------------

    function yieldUI() { return new Promise(r => setTimeout(r, 0)); }

    function setProgress(pct, label) {
        els.progressFill.style.width = clamp(pct, 0, 100) + '%';
        els.progressLabel.textContent = label;
    }

    function checkCancel() { if (state.cancelRequested) throw new Error('__AUTOTRACE_CANCELLED__'); }

    // --------------------------------- Génération ---------------------------------

    async function generate() {
        if (!state.srcImage || state.busy) return;
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

            setProgress(12, 'Analyse (niveaux de gris, flou)…'); await yieldUI(); checkCancel();
            const gray = toGrayscale(imageData.data, w, h);
            const blurred = boxBlur(gray, w, h, state.params.blurRadius);

            setProgress(25, 'Détection des contours…'); await yieldUI(); checkCancel();
            const det = detailToParams(state.params.detail);
            const opts = {
                mode: state.mode, blurRadius: 0 /* déjà flouté ci-dessus */, threshold: state.params.threshold,
                invert: state.params.invert, edgeSensitivity: state.params.edgeSensitivity,
                keepLargestOnly: state.params.keepLargestOnly, dpTolerance: det.dpTolerance,
                minContourPoints: det.minContourPoints, chaikinIters: state.params.chaikinIters,
            };
            let { grid, pw, ph } = buildBinaryGrid(blurred, w, h, opts);
            await yieldUI(); checkCancel();

            setProgress(45, 'Isolation de la forme principale…');
            if (state.mode === 'silhouette' && opts.keepLargestOnly) grid = Core.keepLargestComponents(grid, pw, ph, 1);
            await yieldUI(); checkCancel();

            setProgress(55, 'Extraction des contours (marching squares)…');
            let contours = Core.traceContours(grid, pw, ph);
            await yieldUI(); checkCancel();

            setProgress(65, 'Filtrage du bruit…');
            contours = contours.filter(c => c.length >= opts.minContourPoints);
            if (contours.length === 0) throw new Error('NO_CONTOURS');
            await yieldUI(); checkCancel();

            setProgress(75, 'Simplification & lissage…');
            const smoothed = [];
            for (let i = 0; i < contours.length; i++) {
                let c = Core.simplifyDP(contours[i], opts.dpTolerance);
                c = Core.chaikinSmooth(c, opts.chaikinIters);
                smoothed.push(c);
                if (i % 20 === 0) { await yieldUI(); checkCancel(); }
            }

            setProgress(88, 'Optimisation du trajet (assemblage)…'); await yieldUI(); checkCancel();
            let stitched = Core.stitchContours(smoothed, { x: 0, y: 0 });

            // Garde-fou : trop de points ralentirait la simulation/l'export -> une passe
            // de simplification globale supplémentaire si nécessaire.
            if (stitched.length > 14000) {
                stitched = Core.simplifyDP(stitched, opts.dpTolerance * 1.6);
            }

            setProgress(96, "Mise à l'échelle sur le plateau…"); await yieldUI(); checkCancel();
            const app = window.app;
            const shape = (app && app.settings) ? app.settings.shape : 'round';
            const targetSize = shape === 'rect' ? 420 : 380;
            const scenePoints = mapPixelPathToScene(stitched, targetSize, state.params.mirrorFinal);

            setProgress(100, 'Terminé !');
            await yieldUI();

            if (app && typeof app.addLayer === 'function') {
                app.autoTraceCount = (app.autoTraceCount || 1);
                app.addLayer({
                    type: 'imported_path',
                    name: `🧵 AutoTrace ${app.autoTraceCount++}`,
                    originalPoints: scenePoints, points: [...scenePoints],
                    x: 0, y: 0, scaleX: 1.0, scaleY: 1.0, opacity: 1.0, rot: 0,
                    color: app.ui ? app.ui.color : '#000000', width: 1.0,
                });
                if (typeof app.invalidateSim === 'function') app.invalidateSim();
                if (typeof app.draw === 'function') app.draw();
                if (typeof app.autoSave === 'function') app.autoSave();
            }

            showMsg(`✅ Tracé ajouté (${scenePoints.length} points, ${smoothed.length} contour(s)). Vous pouvez maintenant le repositionner avec l'outil Sélection.`, 'ok');
        } catch (err) {
            if (err && err.message === '__AUTOTRACE_CANCELLED__') {
                showMsg('Génération annulée.', 'err');
            } else if (err && err.message === 'NO_CONTOURS') {
                showMsg("Aucun contour détecté avec ces réglages — essayez d'ajuster le seuil, la sensibilité, ou le détail.", 'err');
            } else {
                console.error(err); showMsg('Une erreur est survenue pendant la génération.', 'err');
            }
        } finally {
            state.busy = false;
            els.btnGenerate.disabled = false; els.btnCancel.style.display = 'none';
            setTimeout(() => { els.progressWrap.style.display = 'none'; }, 600);
        }
    }

    // --------------------------------- Câblage UI ---------------------------------

    function updateModeVisibility() {
        els.rowThreshold.style.display = (state.mode === 'threshold' || state.mode === 'silhouette') ? 'block' : 'none';
        els.rowEdges.style.display = (state.mode === 'edges') ? 'block' : 'none';
        els.rowKeepLargest.style.display = (state.mode === 'silhouette') ? 'block' : 'none';
    }

    function wireEvents() {
        els.dropZone.addEventListener('click', () => els.fileInput.click());
        els.fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
        ['dragover', 'dragenter'].forEach(evt => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.style.borderColor = '#0078D7'; }));
        ['dragleave', 'drop'].forEach(evt => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.style.borderColor = '#bbb'; }));
        els.dropZone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

        wirePreviewInteraction();

        els.zoom.addEventListener('input', () => { state.tx.zoom = els.zoom.value / 100; els.valZoom.textContent = els.zoom.value + '%'; renderPreview(); });
        els.zoom.addEventListener('change', scheduleThumbnails);
        els.imgrot.addEventListener('input', () => { state.tx.rotDeg = parseInt(els.imgrot.value); els.valImgrot.textContent = els.imgrot.value + '°'; renderPreview(); });
        els.imgrot.addEventListener('change', scheduleThumbnails);
        els.flipH.addEventListener('change', () => { state.tx.flipH = els.flipH.checked; renderPreview(); scheduleThumbnails(); });
        els.flipV.addEventListener('change', () => { state.tx.flipV = els.flipV.checked; renderPreview(); scheduleThumbnails(); });
        els.btnRecenter.addEventListener('click', () => {
            state.tx = { zoom: 1.0, rotDeg: 0, panX: 0, panY: 0, flipH: false, flipV: false };
            els.zoom.value = 100; els.valZoom.textContent = '100%'; els.imgrot.value = 0; els.valImgrot.textContent = '0°';
            els.flipH.checked = false; els.flipV.checked = false;
            renderPreview(); scheduleThumbnails();
        });

        Array.from(els.modes.children).forEach((card) => {
            card.addEventListener('click', () => {
                Array.from(els.modes.children).forEach(c => c.classList.remove('active'));
                card.classList.add('active'); state.mode = card.dataset.mode; updateModeVisibility();
            });
        });

        els.threshold.addEventListener('input', () => { state.params.threshold = parseInt(els.threshold.value); els.valThreshold.textContent = state.params.threshold; });
        els.threshold.addEventListener('change', scheduleThumbnails);
        els.edgesens.addEventListener('input', () => { state.params.edgeSensitivity = parseInt(els.edgesens.value); els.valEdgesens.textContent = state.params.edgeSensitivity; });
        els.edgesens.addEventListener('change', scheduleThumbnails);
        els.invert.addEventListener('change', () => { state.params.invert = els.invert.checked; scheduleThumbnails(); });
        els.keeplargest.addEventListener('change', () => { state.params.keepLargestOnly = els.keeplargest.checked; scheduleThumbnails(); });
        els.blur.addEventListener('input', () => { state.params.blurRadius = parseInt(els.blur.value); els.valBlur.textContent = state.params.blurRadius; });
        els.blur.addEventListener('change', scheduleThumbnails);
        els.detail.addEventListener('input', () => { state.params.detail = parseInt(els.detail.value); els.valDetail.textContent = state.params.detail; });
        els.detail.addEventListener('change', scheduleThumbnails);
        els.chaikin.addEventListener('input', () => { state.params.chaikinIters = parseInt(els.chaikin.value); els.valChaikin.textContent = state.params.chaikinIters; });
        els.res.addEventListener('input', () => { state.params.resolution = parseInt(els.res.value); els.valRes.textContent = state.params.resolution + 'px'; });
        els.mirrorFinal.addEventListener('change', () => { state.params.mirrorFinal = els.mirrorFinal.checked; });

        els.btnGenerate.addEventListener('click', generate);
        els.btnCancel.addEventListener('click', () => { state.cancelRequested = true; });
        els.btnClose.addEventListener('click', AutoTrace.close);
        els.backdrop.addEventListener('click', (e) => { if (e.target === els.backdrop && !state.busy) AutoTrace.close(); });

        updateModeVisibility();
    }

    // ================================= API PUBLIQUE ================================

    const AutoTrace = {};

    AutoTrace.open = function () {
        if (!window.app) { alert("L'application principale n'est pas prête."); return; }
        if (!state.built) buildModal();
        els.backdrop.style.display = 'flex';
        // Le conteneur vient d'apparaître : sa taille réelle n'est connue qu'après layout,
        // donc on recale le canvas juste après (et à chaque redimensionnement de fenêtre).
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
})();
