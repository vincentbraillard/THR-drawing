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
        blackCost: 40, // traverser un trait noir (= une crête du dessin) coûte cher : on n'y marche pas dessus, on ne le croise que si nécessaire
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
            // distance (px) de chaque pixel blanc au trait noir le plus proche : sert à garder une marge le long des traits
            const dt = new Float32Array(w * h); for (let i = 0; i < dt.length; i++) dt[i] = black[i] ? 0 : 1e9;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!dt[i]) continue; let v = dt[i];
                if (x > 0) v = Math.min(v, dt[i - 1] + 1); if (y > 0) { v = Math.min(v, dt[i - w] + 1); if (x > 0) v = Math.min(v, dt[i - w - 1] + 1.414); if (x < w - 1) v = Math.min(v, dt[i - w + 1] + 1.414); } dt[i] = v; }
            for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!dt[i]) continue; let v = dt[i];
                if (x < w - 1) v = Math.min(v, dt[i + 1] + 1); if (y < h - 1) { v = Math.min(v, dt[i + w] + 1); if (x < w - 1) v = Math.min(v, dt[i + w + 1] + 1.414); if (x > 0) v = Math.min(v, dt[i + w - 1] + 1.414); } dt[i] = v; }
            const dmaxPx = new Float32Array(stats.length); for (let i = 0; i < dt.length; i++) { const l = labels[i]; if (l > 0 && dt[i] > dmaxPx[l] && dt[i] < 1e8) dmaxPx[l] = dt[i]; }
            const outside = new Uint8Array(stats.length); for (let k = 1; k < stats.length; k++) if (stats[k].border) outside[k] = 1; // blanc relié au bord = extérieur du dessin
            const regions = [];
            for (let k = 1; k < stats.length; k++) {
                const s = stats[k]; if (s.n < minArea) continue;
                const mx = s.sx / s.n, my = s.sy / s.n; const cxx = s.sxx / s.n - mx * mx, cyy = s.syy / s.n - my * my, cxy = s.sxy / s.n - mx * my;
                const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
                const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
                const area = s.n / (S * S), per = Math.max(1, s.per) / S;
                regions.push({ id: s.id, area, cx: mx / S - src.W / 2, cy: my / S - src.H / 2, ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI,
                    elong: Math.sqrt(l1 / l2), width: 2 * area / per, circ: Math.min(1, 4 * Math.PI * area / (per * per)), bbox: [s.minx, s.miny, s.maxx, s.maxy],
                    border: s.border, dmax: dmaxPx[s.id] / S, style: null, angle: null, contours: null });
            }
            regions.sort((a, b) => b.area - a.area); if (regions.length > 400) regions.length = 400;
            this.dt = dt; this.dmaxPx = dmaxPx; this.ignoreBg = ignoreBg; this.outside = outside; this.src = src; this.labels = labels; this.regions = regions; this.byId = new Map(regions.map(r => [r.id, r])); this.buildGrid(); this.selected = null; this.ready = true;
            this.rebuildOverlay(); this.updateUI();
            const kept = regions.filter(r => !(r.border && ignoreBg)); const thin = kept.filter(r => r.dmax < 5.2).length; // 5,2 u ≈ rayon de la bille (6 mm)
            this.setStatus(!regions.length ? 'Aucune zone fermée trouvée : ajustez le seuil ou « Fermer les petits trous ».' : 'Zones détectées. Cliquez une zone pour changer son style, Maj+clic pour l\'ignorer.',
                (kept.length && thin / kept.length > 0.4) ? ' ' + this.t('⚠️ Beaucoup de zones sont plus fines que la bille (Ø12 mm) : agrandissez l\'image sur la table ou augmentez la taille mini des zones.') : '');
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
            if (r.dmax < 3.2) return 'outline'; // trop fin pour être rempli (la bille fait Ø12 mm) : un seul passage
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
        // Contours à remplir : la zone réduite d'une marge (la bille ne doit pas écraser les traits qui forment le dessin).
        // Une zone peut se scinder en plusieurs morceaux après réduction. Zone très fine : on garde son « cœur ».
        regionContours(r) {
            const inset = parseFloat($('compo-inset').value) || 0;
            if (r.contours && r.cInset === inset) return r.contours;
            const { w } = this.src; const [x0, y0, x1, y1] = r.bbox; const pad = 2; const bw = x1 - x0 + 1 + 2 * pad, bh = y1 - y0 + 1 + 2 * pad;
            const rho = Math.min(inset * S, Math.max(0.55 * this.dmaxPx[r.id], 1.5));
            const m = new Uint8Array(bw * bh);
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (this.labels[i] === r.id && this.dt[i] >= rho) m[(y - y0 + pad) * bw + (x - x0 + pad)] = 1; }
            // composantes connexes de la zone réduite
            const lab = new Int32Array(bw * bh), out = []; let id = 0; const st = [];
            for (let i = 0; i < m.length; i++) {
                if (!m[i] || lab[i]) continue; id++; const pix = []; lab[i] = id; st.push(i);
                while (st.length) { const q = st.pop(); pix.push(q); const x = q % bw, y = (q - x) / bw;
                    if (x > 0 && m[q - 1] && !lab[q - 1]) { lab[q - 1] = id; st.push(q - 1); } if (x < bw - 1 && m[q + 1] && !lab[q + 1]) { lab[q + 1] = id; st.push(q + 1); }
                    if (y > 0 && m[q - bw] && !lab[q - bw]) { lab[q - bw] = id; st.push(q - bw); } if (y < bh - 1 && m[q + bw] && !lab[q + bw]) { lab[q + bw] = id; st.push(q + bw); } }
                if (pix.length < 10) continue;
                const cm = new Uint8Array(bw * bh); for (const q of pix) cm[q] = 1; this.fillHoles(cm, bw, bh);
                let poly = this.trace(cm, bw, bh); poly = this.simplify(poly, 0.8); for (let k = 0; k < 2; k++) poly = this.chaikin(poly);
                if (poly.length >= 3) out.push(poly.map(p => ({ x: (p.x + x0 - pad) / S - this.src.W / 2, y: (p.y + y0 - pad) / S - this.src.H / 2 })));
            }
            r.contours = out; r.cInset = inset; return out;
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

        // ---------- grille de cheminement (liaisons entre zones) ----------
        buildGrid() {
            const { w, h } = this.src, CELL = 4, gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL);
            const inside = new Uint8Array(gw * gh), zone = new Int32Array(gw * gh);
            const L = (x, y) => this.labels[Math.min(h - 1, y) * w + Math.min(w - 1, x)];
            for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
                const x0 = gx * CELL, y0 = gy * CELL; let out = 0;
                for (const [dx, dy] of [[1, 1], [3, 1], [1, 3], [3, 3]]) { const l = L(x0 + dx, y0 + dy); if (l > 0 && this.outside[l]) out++; }
                const c = L(x0 + 2, y0 + 2); const z = (c > 0 && !this.outside[c] && this.byId.has(c)) ? c : 0;
                zone[gy * gw + gx] = z; inside[gy * gw + gx] = (out < 2 || z > 0) ? 1 : 0;
            }
            this.grid = { gw, gh, CELL, inside, zone };
        },
        cellOf(p) { const g = this.grid; return Math.min(g.gh - 1, Math.max(0, Math.floor((p.y + this.src.H / 2) * S / g.CELL))) * g.gw + Math.min(g.gw - 1, Math.max(0, Math.floor((p.x + this.src.W / 2) * S / g.CELL))); },
        cellPt(i) { const g = this.grid; const gx = i % g.gw, gy = (i - gx) / g.gw; return { x: (gx * g.CELL + g.CELL / 2) / S - this.src.W / 2, y: (gy * g.CELL + g.CELL / 2) / S - this.src.H / 2 }; },
        // Dijkstra depuis une cellule : coût 1 sur le trait / zones pas encore remplies, 25 sur les zones déjà remplies (ou jamais remplies), interdit hors du dessin.
        dijkstra(src, zoneCost) {
            const g = this.grid, n = g.gw * g.gh, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
            const hk = [], hv = []; // tas binaire
            const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const pa = (i - 1) >> 1; if (hk[pa] <= hk[i]) break; [hk[pa], hk[i]] = [hk[i], hk[pa]]; [hv[pa], hv[i]] = [hv[i], hv[pa]]; i = pa; } };
            const pop = () => { const k = hk[0], v = hv[0]; const lk = hk.pop(), lv = hv.pop(); if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [k, v]; };
            const cost = (c) => g.inside[c] ? (g.zone[c] > 0 ? zoneCost[g.zone[c]] : this.blackCost) : Infinity;
            dist[src] = 0; push(0, src);
            const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
            while (hk.length) {
                const [d, u] = pop(); if (d > dist[u]) continue; const ux = u % g.gw, uy = (u - ux) / g.gw;
                for (const [dx, dy, st] of D) {
                    const vx = ux + dx, vy = uy + dy; if (vx < 0 || vy < 0 || vx >= g.gw || vy >= g.gh) continue; const v = vy * g.gw + vx;
                    if (dx && dy && (!g.inside[uy * g.gw + vx] || !g.inside[vy * g.gw + ux])) continue; // pas de coupe-coin hors du dessin
                    const cv = cost(v); if (cv === Infinity) continue; const nd = d + st * cv;
                    if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
                }
            }
            return { dist, prev };
        },
        simplifyOpen(pts, eps) {
            if (pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
            const dist = (p, a, b) => { const A = b.x - a.x, B = b.y - a.y, Lq = A * A + B * B; if (!Lq) return Math.hypot(p.x - a.x, p.y - a.y); const t = Math.max(0, Math.min(1, ((p.x - a.x) * A + (p.y - a.y) * B) / Lq)); return Math.hypot(p.x - a.x - t * A, p.y - a.y - t * B); };
            const rec = (lo, hi) => { let mi = -1, md = 0; for (let i = lo + 1; i < hi; i++) { const d = dist(pts[i], pts[lo], pts[hi]); if (d > md) { md = d; mi = i; } } if (md > eps) { keep[mi] = 1; rec(lo, mi); rec(mi, hi); } };
            rec(0, pts.length - 1); return pts.filter((_, i) => keep[i]);
        },

        // ---------- génération des calques ----------
        buildLayer(boundary, over, name) {
            const b = boundary.map(p => ({ x: p.x, y: p.y })); b.push({ ...b[0] });
            const layer = Object.assign({ type: 'zigzag', name, visible: true, locked: false, color: app.ui.color, width: 1.3, boundary: b, zigzagType: 'angle', spiralDir: 'in', lineStyle: 'straight', waveAmp: app.ui.waveAmp, waveLen: app.ui.waveLen, angle: 0, spacing: app.ui.zigzagSpacing, tspPointCount: app.ui.tspPointCount, guideCurve: null, points: [] }, over);
            layer.points = (layer.lineStyle === 'tsp') ? app.generateTSPZigzagFill(layer) : app.generateZigzag(layer);
            return layer;
        },
        // Un « travail » = une zone à tracer ; chaque candidat = une façon de la parcourir (sens, point de départ) avec son départ et son arrivée.
        buildTask(r, n, c) {
            const st = this.styleOf(r), a = Math.round(this.angleOf(r)); if (!c || c.length < 3) return null;
            const nm = (t) => `${t} ${n}`; const rev = (arr) => arr.slice().reverse(); const f = (L) => ({ s: L.points[0], e: L.points[L.points.length - 1] });
            const task = { r, st, cands: [] };
            const dual = (L) => { // lignes / vagues / TSP : 2 sens possibles
                if (!L.points.length) return;
                const q = f(L);
                task.cands.push({ s: q.s, e: q.e, make: () => [L] });
                task.cands.push({ s: q.e, e: q.s, make: () => { const M = Object.assign({}, L, { points: rev(L.points) }); if (L.lineStyle !== 'tsp') M.reversed = true; return [M]; } });
            };
            if (st === 'lines') dual(this.buildLayer(c, { angle: a }, nm('〰️ Lignes')));
            else if (st === 'wave') dual(this.buildLayer(c, { angle: a, lineStyle: 'wave' }, nm('🌊 Vagues')));
            else if (st === 'tsp') dual(this.buildLayer(c, { lineStyle: 'tsp' }, nm('🎯 TSP')));
            else if (st === 'spiral') { // du centre vers l'extérieur : on entre par le centre (zone encore vierge) et on finit au bord
                const L = this.buildLayer(c, { zigzagType: 'spiral', spiralDir: 'out' }, nm('🌀 Spirale')); if (L.points.length) { const q = f(L); task.cands.push({ s: q.s, e: q.e, make: () => [L] }); }
            } else if (st === 'hatch') {
                const A = this.buildLayer(c, { angle: a }, nm('✳️ Hachures')), B = this.buildLayer(c, { angle: a + 90 }, nm('✳️ Hachures ⊥'));
                if (A.points.length && B.points.length) for (const ra of [false, true]) {
                    const A2 = ra ? Object.assign({}, A, { points: rev(A.points), reversed: true }) : A; const ea = A2.points[A2.points.length - 1];
                    const sb = B.points[0], eb = B.points[B.points.length - 1];
                    const rb = Math.hypot(ea.x - eb.x, ea.y - eb.y) < Math.hypot(ea.x - sb.x, ea.y - sb.y);
                    const B2 = rb ? Object.assign({}, B, { points: rev(B.points), reversed: true }) : B;
                    task.cands.push({ s: A2.points[0], e: B2.points[B2.points.length - 1], make: () => [A2, B2] });
                }
            } else if (st === 'outline') {
                const K = Math.min(c.length, 12);
                for (let i = 0; i < K; i++) { const k = Math.floor(i * c.length / K); const pts = c.slice(k).concat(c.slice(0, k + 1)).map(p => ({ x: p.x, y: p.y })); task.cands.push({ s: pts[0], e: pts[pts.length - 1], make: () => [{ type: 'pen', name: nm('✏️ Contour'), visible: true, locked: false, color: app.ui.color, width: app.ui.penWidth, points: pts }] }); }
            }
            return task.cands.length ? task : null;
        },
        generate() {
            if (!this.ready) return;
            const t0 = performance.now(); const todo = this.regions.filter(r => this.styleOf(r) !== 'ignore');
            let tasks = []; const remaining = new Map(); todo.forEach((r, i) => { this.regionContours(r).forEach((c, j) => { const t = this.buildTask(r, (i + 1) + (j ? String.fromCharCode(96 + j) : ''), c); if (t) { tasks.push(t); remaining.set(r.id, (remaining.get(r.id) || 0) + 1); } }); });
            if (!tasks.length) return;
            // coût de traversée : 1 = zone encore à remplir (la liaison sera recouverte) ; 6 = zone déjà remplie (un trait court y passe presque inaperçu) ; 40 = trait noir du dessin ou zone jamais remplie (à ne pas abîmer) ; 8 = trait fin déjà creusé
            const maxId = Math.max(...this.regions.map(r => r.id), 0); const zc = new Float32Array(maxId + 2).fill(40);
            for (const t of tasks) zc[t.r.id] = (t.st === 'outline') ? 8 : 1; // 1 = encore à remplir (la liaison sera recouverte) ; 8 = trait fin qu'on peut croiser
            const seq = []; let cur = null, links = 0, jumps = 0, linkLen = 0;
            while (tasks.length) {
                let best = null, route = null;
                if (!cur) { // départ : au plus près du centre de la table
                    let bd = Infinity; tasks.forEach(t => t.cands.forEach(c => { const d = Math.hypot(c.s.x, c.s.y); if (d < bd) { bd = d; best = { t, c }; } }));
                } else {
                    const { dist, prev } = this.dijkstra(this.cellOf(cur), zc); let bd = Infinity;
                    tasks.forEach(t => t.cands.forEach(c => { const d = dist[this.cellOf(c.s)]; if (d < bd) { bd = d; best = { t, c }; } }));
                    if (best) { // reconstitue le trajet de liaison
                        const cells = []; let u = this.cellOf(best.c.s); const src = this.cellOf(cur); let guard = 0;
                        while (u !== -1 && u !== src && guard++ < 1e6) { cells.push(u); u = prev[u]; }
                        cells.reverse(); route = [cur, ...cells.map(i => this.cellPt(i)), best.c.s];
                    } else { // pièce isolée : pas de chemin possible dans le dessin → saut direct (rare)
                        let bd2 = Infinity; tasks.forEach(t => t.cands.forEach(c => { const d = Math.hypot(c.s.x - cur.x, c.s.y - cur.y); if (d < bd2) { bd2 = d; best = { t, c }; } })); jumps++;
                    }
                }
                if (route) {
                    const pts = this.simplifyOpen(route, 1.2); let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
                    if (len > 2.5 && pts.length >= 2) { links++; linkLen += len; seq.push({ type: 'pen', name: `↪ Liaison ${links}`, visible: true, locked: false, color: app.ui.color, width: app.ui.penWidth, points: pts }); }
                }
                seq.push(...best.c.make()); cur = best.c.e; const left = remaining.get(best.t.r.id) - 1; remaining.set(best.t.r.id, left); if (left <= 0) zc[best.t.r.id] = (best.t.st === 'outline') ? 8 : 6; tasks = tasks.filter(t => t !== best.t);
            }
            app.saveState();
            const folder = { id: app.genId(), type: 'folder', name: '🎨 Composition ' + (app.compoCount = (app.compoCount || 0) + 1), visible: true, locked: false, isOpen: false, layers: [] };
            folder.layers = seq.map(l => Object.assign({ id: app.genId() }, l)).reverse(); // le tracé part du bas de la liste
            app.layers.unshift(folder); app.selectedIds = [folder.id];
            app.invalidateSim(); app.refreshLayerList(); app.autoSave(); app.draw();
            this.lastReport = { zones: seq.filter(l => l.type !== 'pen' || !/Liaison/.test(l.name)).length, links, linkLen: Math.round(linkLen), jumps, ms: Math.round(performance.now() - t0) };
            this.setStatus('Calques générés dans le dossier « Composition » : ', links + ' ' + this.t('liaisons tracées à l\'intérieur du dessin') + '.');
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
                for (const c of this.regionContours(this.selected)) if (c.length > 2) {
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
