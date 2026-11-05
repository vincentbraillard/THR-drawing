/* Segmenter — outil « Segmenter » (Remplissage > ✂️ Segmenter)
 * Un clic sur une partie de l'image de fond (oreille, tête, patte…) → le modèle SAM (SlimSAM, via transformers.js,
 * exécuté dans le navigateur) trouve la forme complète → contour lissé → calque de remplissage.
 * Clic = point positif, Maj+clic (ou bouton « Retrait ») = point négatif.
 * Le modèle se télécharge au premier usage (mis en cache par le navigateur).
 * Pour les tests : définir window.THRSegMock = { predict(pts, w, h) → { mask: Uint8Array(w*h) } } évite le modèle.
 */
(function () {
    const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
    const MODEL_ID = 'Xenova/slimsam-77-uniform';
    const S = 2; // résolution de travail : 2 px par unité de scène

    const $ = (id) => document.getElementById(id);
    const Seg = {
        lib: null, model: null, processor: null, loadingPromise: null,
        embKey: null, emb: null, rawImage: null, src: null,
        pts: [], mask: null, contour: null, overlay: null, taken: null, takenKey: null,
        negMode: false, busy: false, status: '',

        // ---------- état / interface ----------
        t(fr) { return (window.I18N && window.I18N.tr) ? window.I18N.tr(fr) : fr; },
        setStatus(fr) {
            this.status = fr; const el = $('sam-status'); if (el) el.innerText = fr;
        },
        dims() { const rect = app.settings.shape === 'rect'; return { W: rect ? 1200 : 600, H: rect ? 500 : 600 }; },
        refreshButtons() {
            const on = (id, v) => { const el = $(id); if (el) el.disabled = !v; };
            on('sam-validate', !!this.contour && !this.busy); on('sam-undo', this.pts.length > 0 && !this.busy); on('sam-clear', this.pts.length > 0 && !this.busy);
            const nb = $('sam-neg'); if (nb) nb.classList.toggle('btn-primary', this.negMode);
        },
        toggleNeg() { this.negMode = !this.negMode; this.refreshButtons(); },
        onParamChange() {
            const g = $('sam-gran'), s = $('sam-smooth'), sub = $('sam-subtract');
            this.gran = g ? parseInt(g.value) : 1; this.smooth = s ? parseInt(s.value) : 2; this.subtract = sub ? sub.checked : true;
            const v = $('val-sam-smooth'); if (v) v.innerText = this.smooth;
            if (this.pts.length) this.recompute(true);
        },
        gran: 1, smooth: 2, subtract: true,

        reset(keepTaken) {
            this.pts = []; this.mask = null; this.contour = null; this.overlay = null; this.busy = false;
            if (!keepTaken) { this.taken = null; this.takenKey = null; }
            this.setStatus(this.t('Cliquez sur une partie de l\'image (Maj+clic = retirer).'));
            this.refreshButtons(); if (window.app) app.draw();
        },
        undo() { this.pts.pop(); if (this.pts.length) this.recompute(); else this.reset(true); },

        // ---------- image source ----------
        composeSource() {
            const { W, H } = this.dims();
            const imgs = app.layers.filter(l => l.type === 'image' && l.img && l.effectiveVisible);
            if (!imgs.length) return null;
            const key = app.settings.shape + '|' + imgs.map(l => [l.id, l.x, l.y, l.rot, l.scaleX, l.scaleY, l.img.width, l.img.height].join(',')).join('|');
            if (this.src && this.src.key === key) return this.src;
            const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.scale(S, S); ctx.translate(W / 2, H / 2);
            for (const l of imgs) { // même géométrie que la baguette magique, mais en pleine opacité
                ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot * Math.PI / 180);
                ctx.scale(l.scaleX !== undefined ? l.scaleX : 1, l.scaleY !== undefined ? l.scaleY : 1);
                ctx.drawImage(l.img, -l.img.width / 2, -l.img.height / 2); ctx.restore();
            }
            this.src = { key, canvas: c, w: c.width, h: c.height, W, H };
            this.emb = null; this.embKey = null; this.rawImage = null;
            return this.src;
        },

        // ---------- modèle ----------
        async ensureModel() {
            if (window.THRSegMock) return;
            if (this.model) return;
            if (!this.loadingPromise) {
                this.loadingPromise = (async () => {
                    this.setStatus(this.t('Chargement du modèle (premier usage, quelques dizaines de Mo)…'));
                    this.lib = await import(LIB);
                    const prog = (p) => { if (p && p.status === 'progress' && p.file && /onnx/.test(p.file)) this.setStatus(this.t('Téléchargement du modèle') + ' ' + Math.round(p.progress || 0) + ' %'); };
                    this.model = await this.lib.SamModel.from_pretrained(MODEL_ID, { progress_callback: prog });
                    this.processor = await this.lib.AutoProcessor.from_pretrained(MODEL_ID);
                })().catch(e => { this.loadingPromise = null; throw e; });
            }
            await this.loadingPromise;
        },
        async ensureEmbedding(src) {
            if (window.THRSegMock) return;
            if (this.emb && this.embKey === src.key) return;
            this.setStatus(this.t('Analyse de l\'image…'));
            this.rawImage = this.lib.RawImage.fromCanvas(src.canvas);
            this.imgInputs = await this.processor(this.rawImage);
            this.emb = await this.model.get_image_embeddings(this.imgInputs);
            this.embKey = src.key;
        },
        // Retourne { masks: [Uint8Array ×3], scores: [..] } à la résolution de la source
        async predict(src) {
            if (window.THRSegMock) { const r = await window.THRSegMock.predict(this.pts.map(p => ({ x: p.px, y: p.py, pos: p.pos })), src.w, src.h); return { masks: [r.mask, r.mask, r.mask], scores: [1, 1, 1] }; }
            const input_points = [this.pts.map(p => [p.px, p.py])];
            const input_labels = [this.pts.map(p => p.pos ? 1 : 0)];
            const inputs = await this.processor(this.rawImage, { input_points, input_labels });
            const outputs = await this.model({ ...this.emb, ...inputs });
            const masks = await this.processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
            const m = masks[0]; const n = m.dims[1], hh = m.dims[2], ww = m.dims[3];
            const out = []; for (let i = 0; i < n; i++) out.push(new Uint8Array(m.data.buffer ? m.data.slice(i * hh * ww, (i + 1) * hh * ww) : m.data.slice(i * hh * ww, (i + 1) * hh * ww)));
            return { masks: out, scores: Array.from(outputs.iou_scores.data) };
        },

        // ---------- clic ----------
        async onClick(ptScene, shift) {
            if (this.busy) return;
            const src = this.composeSource();
            if (!src) { alert(this.t('Veuillez importer et afficher au moins une image de fond pour utiliser la détection automatique.')); return; }
            const px = (ptScene.x + src.W / 2) * S, py = (ptScene.y + src.H / 2) * S;
            if (px < 0 || py < 0 || px >= src.w || py >= src.h) return;
            this.pts.push({ px, py, pos: !(shift || this.negMode) });
            if (!this.pts.some(p => p.pos)) { this.pts.pop(); return; }
            await this.recompute();
        },
        async recompute(paramOnly) {
            const src = this.composeSource(); if (!src) return;
            this.busy = true; this.refreshButtons();
            try {
                if (!paramOnly || !this.lastPred || this.lastPredN !== this.pts.length) {
                    await this.ensureModel(); await this.ensureEmbedding(src);
                    this.setStatus(this.t('Segmentation…'));
                    this.lastPred = await this.predict(src); this.lastPredN = this.pts.length;
                }
                const { masks, scores } = this.lastPred;
                let idx = (this.pts.length === 1) ? Math.min(this.gran, masks.length - 1) : scores.indexOf(Math.max(...scores));
                this.buildFromMask(masks[idx], src);
            } catch (e) {
                console.error(e); this.pts.pop(); this.lastPred = null;
                this.setStatus(this.t('Erreur : modèle indisponible (connexion internet requise au premier usage).') + ' ' + (e && e.message ? e.message : ''));
            }
            this.busy = false; this.refreshButtons(); app.draw();
        },

        // ---------- masque → contour ----------
        buildFromMask(raw, src) {
            const w = src.w, h = src.h;
            let m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = raw[i] ? 1 : 0;
            if (this.subtract && this.taken && this.takenKey === src.key) for (let i = 0; i < m.length; i++) if (this.taken[i]) m[i] = 0;
            m = this.blurThreshold(m, w, h, 1 + this.smooth);
            const first = this.pts.find(p => p.pos);
            m = this.keepComponent(m, w, h, Math.round(first.px), Math.round(first.py));
            this.fillHoles(m, w, h);
            const area = m.reduce((a, b) => a + b, 0);
            if (area < 30) { this.mask = null; this.contour = null; this.overlay = null; this.setStatus(this.t('Aucune forme trouvée ici : essayez un autre clic.')); return; }
            let poly = this.trace(m, w, h);
            poly = this.simplify(poly, (0.6 + this.smooth * 0.5) * S / 2);
            for (let k = 0; k < 2; k++) poly = this.chaikin(poly);
            this.mask = m; this.src = src;
            this.contour = poly.map(p => ({ x: p.x / S - src.W / 2, y: p.y / S - src.H / 2 }));
            const ov = document.createElement('canvas'); ov.width = w; ov.height = h; const oc = ov.getContext('2d');
            const id = oc.createImageData(w, h);
            for (let i = 0; i < m.length; i++) if (m[i]) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 0; id.data[i * 4 + 2] = 200; id.data[i * 4 + 3] = 90; }
            oc.putImageData(id, 0, 0); this.overlay = ov;
            this.setStatus(this.t('Forme trouvée. Ajoutez des clics pour corriger, puis « Valider la zone ».'));
        },
        blurThreshold(m, w, h, r) {
            const tmp = new Float32Array(w * h), out = new Uint8Array(w * h), n = 2 * r + 1;
            for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += m[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[o + x] = s / n; s += m[o + Math.min(w - 1, x + r + 1)] - m[o + Math.max(0, x - r)]; } }
            for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = (s / n) > 0.5 ? 1 : 0; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
            return out;
        },
        keepComponent(m, w, h, sx, sy) {
            const lab = new Int32Array(w * h), sizes = [0]; let id = 0;
            const stack = [];
            for (let i = 0; i < m.length; i++) {
                if (!m[i] || lab[i]) continue; id++; let cnt = 0; stack.push(i); lab[i] = id;
                while (stack.length) { const p = stack.pop(); cnt++; const x = p % w, y = (p - x) / w;
                    if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
                    if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
                    if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
                    if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); } }
                sizes.push(cnt);
            }
            let keep = (sx >= 0 && sy >= 0 && sx < w && sy < h) ? lab[sy * w + sx] : 0;
            if (!keep) { let best = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > (sizes[best] || 0)) best = k; keep = best; }
            const out = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) out[i] = (lab[i] && lab[i] === keep) ? 1 : 0; return out;
        },
        fillHoles(m, w, h) { // tout ce qui n'est pas relié au bord et n'est pas dans la forme devient forme
            const seen = new Uint8Array(w * h), stack = [];
            const push = (i) => { if (!m[i] && !seen[i]) { seen[i] = 1; stack.push(i); } };
            for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
            while (stack.length) { const p = stack.pop(); const x = p % w, y = (p - x) / w; if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w); }
            for (let i = 0; i < m.length; i++) if (!m[i] && !seen[i]) m[i] = 1;
        },
        trace(m, w, h) { // suivi de bord (Moore), contour extérieur
            let s = -1; for (let i = 0; i < m.length; i++) if (m[i]) { s = i; break; }
            const sx = s % w, sy = (s - sx) / w; const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
            const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
            let cx = sx, cy = sy, d = 4; const pts = []; let guard = 0;
            do {
                pts.push({ x: cx + 0.5, y: cy + 0.5 }); let found = false;
                for (let k = 0; k < 8; k++) { const nd = (d + k) % 8, nx = cx + dx[nd], ny = cy + dy[nd]; if (inside(nx, ny)) { cx = nx; cy = ny; d = (nd + 5) % 8; found = true; break; } }
                if (!found) break;
            } while (!(cx === sx && cy === sy) && ++guard < w * h);
            return pts;
        },
        simplify(pts, eps) { // Douglas-Peucker sur courbe fermée (coupée en 2 au point le plus éloigné)
            if (pts.length < 8) return pts;
            const dist = (p, a, b) => { const A = b.x - a.x, B = b.y - a.y, L = A * A + B * B; if (!L) return Math.hypot(p.x - a.x, p.y - a.y); const t = Math.max(0, Math.min(1, ((p.x - a.x) * A + (p.y - a.y) * B) / L)); return Math.hypot(p.x - a.x - t * A, p.y - a.y - t * B); };
            const dp = (a, b, lo, hi, keep) => { let mi = -1, md = 0; for (let i = lo + 1; i < hi; i++) { const d = dist(pts[i], a, b); if (d > md) { md = d; mi = i; } } if (md > eps) { dp(a, pts[mi], lo, mi, keep); keep[mi] = 1; dp(pts[mi], b, mi, hi, keep); } };
            let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y); if (d > fd) { fd = d; far = i; } }
            const keep = new Uint8Array(pts.length); keep[0] = 1; keep[far] = 1;
            dp(pts[0], pts[far], 0, far, keep); dp(pts[far], pts[0], far, pts.length, keep);
            const closed = pts.concat([pts[0]]); // 2e moitié : far → fin → début
            const keep2 = keep; const out = []; for (let i = 0; i < pts.length; i++) if (keep2[i]) out.push(pts[i]); return out;
        },
        chaikin(pts) { // lissage de courbe fermée
            const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y }); } return out;
        },

        // ---------- validation ----------
        validate() {
            if (!this.contour || this.contour.length < 3) return;
            // mémorise la zone pour pouvoir la retirer des suivantes
            if (!this.taken || this.takenKey !== this.src.key) { this.taken = new Uint8Array(this.mask.length); this.takenKey = this.src.key; }
            for (let i = 0; i < this.mask.length; i++) if (this.mask[i]) this.taken[i] = 1;
            app.pos.currentPath = this.contour.map(p => ({ x: p.x, y: p.y }));
            app.createZigzagLayerFromPath();
            app.pos.currentPath = []; app.invalidateSim(); app.autoSave();
            this.reset(true); this.setStatus(this.t('Zone créée. Cliquez sur la partie suivante.'));
            app.refreshLayerList && app.refreshLayerList();
        },

        // ---------- affichage (dans le repère de la scène) ----------
        drawOverlay(ctx, zoom) {
            if (!this.src) return;
            const { W, H } = this.src;
            if (this.overlay) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(this.overlay, -W / 2, -H / 2, W, H); ctx.restore(); }
            if (this.contour && this.contour.length > 2) {
                ctx.beginPath(); ctx.moveTo(this.contour[0].x, this.contour[0].y); for (let i = 1; i < this.contour.length; i++) ctx.lineTo(this.contour[i].x, this.contour[i].y); ctx.closePath();
                ctx.strokeStyle = 'rgba(255,0,200,0.95)'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([]); ctx.stroke();
            }
            for (const p of this.pts) {
                const x = p.px / S - W / 2, y = p.py / S - H / 2;
                ctx.beginPath(); ctx.arc(x, y, 4.5 / zoom, 0, Math.PI * 2); ctx.fillStyle = p.pos ? '#00e676' : '#ff1744'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / zoom; ctx.stroke();
            }
        }
    };
    window.THRSeg = Seg;
})();
