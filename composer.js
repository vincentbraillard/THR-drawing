/* Composer — outil « 🎨 Composer » (Remplissage > Composer)
 * À partir d'une image simple en noir et blanc (type coloriage) : détecte les zones blanches fermées,
 * propose un style de remplissage pour chacune (lignes dans le sens de la forme, spirale, contour seul…),
 * laisse l'utilisateur corriger zone par zone, puis génère tous les calques en un clic.
 * Clic = sélectionner une zone, Maj+clic = l'ignorer / la réactiver.
 */
(function () {
    const S = 2; // px de travail par unité de scène
    const $ = (id) => document.getElementById(id);
    const COLORS = { lines: [30, 120, 255], wave: [0, 190, 200], spiral: [220, 0, 180], hatch: [255, 140, 0], tsp: [0, 170, 80], outline: [230, 50, 50], ignore: [120, 120, 120] };

    const C = {
        src: null, labels: null, regions: [], byId: new Map(), selected: null, overlay: null, ready: false,
        t(fr) { return (window.I18N && window.I18N.tr) ? window.I18N.tr(fr) : fr; },
        setStatus(fr, extra) { const el = $('compo-status'); if (el) el.innerText = this.t(fr) + (extra || ''); },
        dims() { const rect = app.settings.shape === 'rect'; return { W: rect ? 1200 : 600, H: rect ? 500 : 600 }; },

        reset() { this.labels = null; this.regions = []; this.byId = new Map(); this.selected = null; this.overlay = null; this.ready = false; this.src = null; this.updateUI(); if (window.app) app.draw(); },
        onParam() {
            const t = $('compo-thr'), c = $('compo-close'), m = $('compo-min');
            if ($('val-compo-thr') && t) $('val-compo-thr').innerText = t.value; if ($('val-compo-close') && c) $('val-compo-close').innerText = c.value; if ($('val-compo-min') && m) $('val-compo-min').innerText = m.value;
            if (this.ready) this.analyze();
        },

        // ---------- image source (noir/blanc) ----------
        composeSource() {
            const { W, H } = this.dims();
            const imgs = app.layers.filter(l => l.type === 'image' && l.img && l.effectiveVisible);
            if (!imgs.length) return null;
            const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.scale(S, S); ctx.translate(W / 2, H / 2);
            for (const l of imgs) {
                ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot * Math.PI / 180);
                ctx.scale(l.scaleX !== undefined ? l.scaleX : 1, l.scaleY !== undefined ? l.scaleY : 1);
                ctx.drawImage(l.img, -l.img.width / 2, -l.img.height / 2); ctx.restore();
            }
            return { canvas: c, w: c.width, h: c.height, W, H };
        },

        // ---------- analyse : zones blanches fermées ----------
        analyze() {
            const src = this.composeSource();
            if (!src) { alert(this.t('Veuillez importer et afficher au moins une image de fond pour utiliser la détection automatique.')); return; }
            const { w, h } = src; const thr = parseInt($('compo-thr').value), close = parseInt($('compo-close').value);
            const minArea = parseFloat($('compo-min').value) * S * S, ignoreBg = $('compo-bg').checked;
            const d = src.canvas.getContext('2d').getImageData(0, 0, w, h).data;
            let black = new Uint8Array(w * h);
            for (let i = 0; i < black.length; i++) black[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) < thr ? 1 : 0;
            if (close > 0) black = this.dilate(black, w, h, close);
            // étiquetage des composantes blanches (4-connexité)
            const labels = new Int32Array(w * h); const st = []; const stats = [null];
            let id = 0;
            for (let i = 0; i < labels.length; i++) {
                if (black[i] || labels[i]) continue; id++;
                const s = { id, n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0, syy: 0, minx: w, miny: h, maxx: 0, maxy: 0, per: 0, border: false };
                labels[i] = id; st.push(i);
                while (st.length) {
                    const p = st.pop(); const x = p % w, y = (p - x) / w;
                    s.n++; s.sx += x; s.sy += y; s.sxx += x * x; s.sxy += x * y; s.syy += y * y;
                    if (x < s.minx) s.minx = x; if (x > s.maxx) s.maxx = x; if (y < s.miny) s.miny = y; if (y > s.maxy) s.maxy = y;
                    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) s.border = true;
                    let edge = false;
                    if (x > 0) { const q = p - 1; if (!black[q] && !labels[q]) { labels[q] = id; st.push(q); } else if (black[q]) edge = true; } else edge = true;
                    if (x < w - 1) { const q = p + 1; if (!black[q] && !labels[q]) { labels[q] = id; st.push(q); } else if (black[q]) edge = true; } else edge = true;
                    if (y > 0) { const q = p - w; if (!black[q] && !labels[q]) { labels[q] = id; st.push(q); } else if (black[q]) edge = true; } else edge = true;
                    if (y < h - 1) { const q = p + w; if (!black[q] && !labels[q]) { labels[q] = id; st.push(q); } else if (black[q]) edge = true; } else edge = true;
                    if (edge) s.per++;
                }
                stats.push(s);
            }
            const regions = [];
            for (let k = 1; k < stats.length; k++) {
                const s = stats[k]; if (s.n < minArea) continue;
                const mx = s.sx / s.n, my = s.sy / s.n; const cxx = s.sxx / s.n - mx * mx, cyy = s.syy / s.n - my * my, cxy = s.sxy / s.n - mx * my;
                const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
                const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
                const area = s.n / (S * S), per = Math.max(1, s.per) / S;
                regions.push({ id: s.id, area, cx: mx / S - src.W / 2, cy: my / S - src.H / 2, ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI,
                    elong: Math.sqrt(l1 / l2), width: 2 * area / per, circ: Math.min(1, 4 * Math.PI * area / (per * per)), bbox: [s.minx, s.miny, s.maxx, s.maxy],
                    border: s.border, style: null, angle: null, contour: null });
            }
            regions.sort((a, b) => b.area - a.area); if (regions.length > 400) regions.length = 400;
            this.ignoreBg = ignoreBg; this.src = src; this.labels = labels; this.regions = regions; this.byId = new Map(regions.map(r => [r.id, r])); this.selected = null; this.ready = true;
            this.rebuildOverlay(); this.updateUI();
            this.setStatus(regions.length ? 'Zones détectées. Cliquez une zone pour changer son style, Maj+clic pour l\'ignorer.' : 'Aucune zone fermée trouvée : ajustez le seuil ou « Fermer les petits trous ».');
            app.draw();
        },
        dilate(m, w, h, r) {
            const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) { const b = y * w; let last = -1e9; for (let x = 0; x < w + r; x++) { if (x < w && m[b + x]) last = x; } for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w && m[b + xx]) { v = 1; break; } } t[b + x] = v; } }
            for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let v = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x]) { v = 1; break; } } o[y * w + x] = v; }
            return o;
        },

        // ---------- style proposé ----------
        suggest(r) {
            if (r.border && this.ignoreBg) return 'ignore';
            if (r.width < 5) return 'outline';
            if (r.area < 2500 && r.circ > 0.55) return 'spiral';
            return 'lines';
        },
        styleOf(r) { return r.style || this.suggest(r); },
        angleOf(r) { return r.angle !== null ? r.angle : r.ang; },

        // ---------- clic / sélection ----------
        onClick(pt, shift) {
            if (!this.ready) return;
            const px = Math.round((pt.x + this.src.W / 2) * S), py = Math.round((pt.y + this.src.H / 2) * S);
            let r = null; if (px >= 0 && py >= 0 && px < this.src.w && py < this.src.h) r = this.byId.get(this.labels[py * this.src.w + px]) || null;
            if (r && shift) { r.style = (r.style === 'ignore') ? null : 'ignore'; this.rebuildOverlay(); }
            this.selected = r; this.updateUI(); app.draw();
        },
        setStyle() {
            const r = this.selected; if (!r) return; const v = $('compo-style').value; r.style = (v === 'auto') ? null : v; this.rebuildOverlay(); this.updateUI(); app.draw();
        },
        setAngle() {
            const r = this.selected; if (!r) return; r.angle = parseInt($('compo-angle').value); $('compo-angle-auto').checked = false; this.updateUI();
        },
        angleAuto() { const r = this.selected; if (!r) return; if ($('compo-angle-auto').checked) r.angle = null; else r.angle = Math.round(r.ang); this.updateUI(); },
        applyAll() {
            const v = $('compo-all').value; if (!v) return;
            for (const r of this.regions) r.style = (v === 'auto') ? null : v;
            $('compo-all').value = ''; this.rebuildOverlay(); this.updateUI(); app.draw();
        },
        updateUI() {
            const sel = $('compo-sel'), gen = $('compo-generate'), info = $('compo-count'); if (!sel) return;
            const n = this.regions.length, on = this.regions.filter(r => this.styleOf(r) !== 'ignore').length;
            if (info) info.innerText = this.ready ? (n + ' ' + this.t('zones') + ' · ' + on + ' ' + this.t('à remplir')) : '';
            if (gen) gen.disabled = !(this.ready && on > 0);
            const adv = $('compo-after'); if (adv) adv.style.display = this.ready ? 'block' : 'none';
            const r = this.selected; sel.style.display = r ? 'block' : 'none';
            if (r) {
                $('compo-style').value = r.style || 'auto';
                const a = $('compo-angle'); a.value = Math.round(this.angleOf(r)); $('val-compo-angle').innerText = a.value + '°';
                $('compo-angle-auto').checked = (r.angle === null);
                $('compo-sel-info').innerText = this.t('Zone') + ' · ' + Math.round(r.area) + ' u² · ' + this.t('style proposé') + ' : ' + this.suggest(r);
            }
        },

        // ---------- contour d'une zone ----------
        regionContour(r) {
            if (r.contour) return r.contour;
            const { w } = this.src; const [x0, y0, x1, y1] = r.bbox; const pad = 2; const bw = x1 - x0 + 1 + 2 * pad, bh = y1 - y0 + 1 + 2 * pad;
            const m = new Uint8Array(bw * bh);
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.labels[y * w + x] === r.id) m[(y - y0 + pad) * bw + (x - x0 + pad)] = 1;
            this.fillHoles(m, bw, bh);
            let poly = this.trace(m, bw, bh);
            poly = this.simplify(poly, 0.8); for (let k = 0; k < 2; k++) poly = this.chaikin(poly);
            r.contour = poly.map(p => ({ x: (p.x + x0 - pad) / S - this.src.W / 2, y: (p.y + y0 - pad) / S - this.src.H / 2 }));
            return r.contour;
        },
        fillHoles(m, w, h) {
            const seen = new Uint8Array(w * h), stack = []; const push = (i) => { if (!m[i] && !seen[i]) { seen[i] = 1; stack.push(i); } };
            for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
            while (stack.length) { const p = stack.pop(); const x = p % w, y = (p - x) / w; if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w); }
            for (let i = 0; i < m.length; i++) if (!m[i] && !seen[i]) m[i] = 1;
        },
        trace(m, w, h) {
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
        simplify(pts, eps) {
            if (pts.length < 8) return pts;
            const dist = (p, a, b) => { const A = b.x - a.x, B = b.y - a.y, L = A * A + B * B; if (!L) return Math.hypot(p.x - a.x, p.y - a.y); const t = Math.max(0, Math.min(1, ((p.x - a.x) * A + (p.y - a.y) * B) / L)); return Math.hypot(p.x - a.x - t * A, p.y - a.y - t * B); };
            const dp = (a, b, lo, hi, keep) => { let mi = -1, md = 0; for (let i = lo + 1; i < hi; i++) { const dd = dist(pts[i], a, b); if (dd > md) { md = dd; mi = i; } } if (md > eps) { dp(a, pts[mi], lo, mi, keep); keep[mi] = 1; dp(pts[mi], b, mi, hi, keep); } };
            let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const dd = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y); if (dd > fd) { fd = dd; far = i; } }
            const keep = new Uint8Array(pts.length); keep[0] = 1; keep[far] = 1;
            dp(pts[0], pts[far], 0, far, keep); dp(pts[far], pts[0], far, pts.length, keep);
            return pts.filter((_, i) => keep[i]);
        },
        chaikin(pts) { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y }); } return out; },

        // ---------- génération des calques ----------
        orderRegions(list) { // plus proche voisin, départ au plus près du centre de la table
            const rest = list.slice(); const out = []; let cur = { cx: 0, cy: 0 };
            while (rest.length) { let bi = 0, bd = Infinity; rest.forEach((r, i) => { const d = Math.hypot(r.cx - cur.cx, r.cy - cur.cy); if (d < bd) { bd = d; bi = i; } }); cur = rest.splice(bi, 1)[0]; out.push(cur); }
            return out;
        },
        makeFill(boundary, over, name) {
            const b = boundary.map(p => ({ x: p.x, y: p.y })); b.push({ ...b[0] });
            const layer = Object.assign({ type: 'zigzag', name, color: app.ui.color, width: 1.3, boundary: b, zigzagType: 'angle', spiralDir: 'in', lineStyle: 'straight', waveAmp: app.ui.waveAmp, waveLen: app.ui.waveLen, angle: 0, spacing: app.ui.zigzagSpacing, tspPointCount: app.ui.tspPointCount, guideCurve: null, points: [] }, over);
            if (layer.lineStyle !== 'tsp' && (layer.zigzagType === 'angle' || layer.zigzagType === 'spiral')) layer.points = app.generateZigzag(layer);
            app.addLayer(layer);
            if (layer.lineStyle === 'tsp') app.regenerateTSPFill(app.findLayer(app.selectedIds[0]).layer);
        },
        generate() {
            if (!this.ready) return;
            const todo = this.orderRegions(this.regions.filter(r => this.styleOf(r) !== 'ignore'));
            if (!todo.length) return;
            app.saveState();
            let folder = { id: app.genId(), type: 'folder', name: '🎨 Composition ' + (app.compoCount = (app.compoCount || 0) + 1), visible: true, locked: false, isOpen: false, layers: [] };
            app.layers.unshift(folder); app.selectedIds = [folder.id];
            let n = 0;
            for (const r of todo) {
                const st = this.styleOf(r), a = Math.round(this.angleOf(r)), c = this.regionContour(r); n++;
                if (c.length < 3) continue;
                const nm = (s) => `${s} ${n}`;
                if (st === 'lines') this.makeFill(c, { angle: a }, nm('〰️ Lignes'));
                else if (st === 'wave') this.makeFill(c, { angle: a, lineStyle: 'wave' }, nm('🌊 Vagues'));
                else if (st === 'spiral') this.makeFill(c, { zigzagType: 'spiral' }, nm('🌀 Spirale'));
                else if (st === 'hatch') { this.makeFill(c, { angle: a }, nm('✳️ Hachures')); this.makeFill(c, { angle: a + 90 }, nm('✳️ Hachures ⊥')); }
                else if (st === 'tsp') this.makeFill(c, { lineStyle: 'tsp' }, nm('🎯 TSP'));
                else if (st === 'outline') { const pts = c.map(p => ({ x: p.x, y: p.y })); pts.push({ ...pts[0] }); app.addLayer({ type: 'pen', name: nm('✏️ Contour'), color: app.ui.color, width: app.ui.penWidth, points: pts }); }
            }
            app.invalidateSim(); app.refreshLayerList(); app.autoSave(); app.draw();
            this.setStatus('Calques générés dans un dossier « Composition ». Vous pouvez les retoucher dans l\'onglet Calques.');
        },

        // ---------- affichage ----------
        rebuildOverlay() {
            if (!this.labels) { this.overlay = null; return; }
            const { w, h } = this.src; const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d'); const id = ctx.createImageData(w, h); const px = id.data;
            const col = new Map(); for (const r of this.regions) { const st = this.styleOf(r); col.set(r.id, [COLORS[st] || COLORS.lines, st === 'ignore' ? 40 : 95]); }
            for (let i = 0; i < this.labels.length; i++) { const c = col.get(this.labels[i]); if (c) { px[i * 4] = c[0][0]; px[i * 4 + 1] = c[0][1]; px[i * 4 + 2] = c[0][2]; px[i * 4 + 3] = c[1]; } }
            ctx.putImageData(id, 0, 0); this.overlay = cv;
        },
        drawOverlay(ctx, zoom) {
            if (!this.src) return; const { W, H } = this.src;
            if (this.overlay) ctx.drawImage(this.overlay, -W / 2, -H / 2, W, H);
            if (this.selected) {
                const c = this.regionContour(this.selected); if (c.length > 2) {
                    ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
                    ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 3 / zoom; ctx.setLineDash([]); ctx.stroke();
                    const a = this.angleOf(this.selected) * Math.PI / 180, L = 25; // sens des lignes (angle 0 = horizontal, comme le réglage de l'outil)
                    ctx.beginPath(); ctx.moveTo(this.selected.cx - Math.cos(a) * L, this.selected.cy - Math.sin(a) * L); ctx.lineTo(this.selected.cx + Math.cos(a) * L, this.selected.cy + Math.sin(a) * L);
                    ctx.strokeStyle = '#000'; ctx.lineWidth = 2 / zoom; ctx.stroke();
                }
            }
        }
    };
    window.THRCompo = C;
})();
