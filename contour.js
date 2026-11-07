/* ============================================================================
   contour.js — Onglet « Import » : image -> contours -> UN SEUL tracé continu (v6.13)
   ----------------------------------------------------------------------------
   Étape 1 (live)  : réglages de l'image -> squelette (lignes d'1 px) affiché sur la table.
   Étape 2 (bouton): « Dessiner » -> calcule le tracé unique idéal et crée un calque Crayon.

   Règles du tracé :
   - on ne suit que des contours existants ; jamais de raccourci au travers d'une forme ;
   - les éléments isolés sont rejoints par le chemin le plus court, qui longe les contours
     existants autant que possible (coût faible sur le trait, élevé dans une forme, très
     élevé hors de la silhouette), et on repasse par le même trait ;
   - tout est re-découpé en pas ≤ 2 unités (le simulateur et la machine interpolent en polaire :
     un long segment droit deviendrait un arc).
   Algorithme : Zhang-Suen (amincissement) -> graphe du squelette -> ébarbage -> liaisons
   (Dijkstra pondéré) -> postier chinois (appariement glouton + 2-opt) -> chemin eulérien ouvert.
   ============================================================================ */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const NB = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

    // ------------------------------------------------------------------ outils bas niveau
    function dims() { const rect = app.settings.shape === 'rect'; return { W: rect ? 1200 : 600, H: rect ? 500 : 600 }; }

    function boxBlur(src, w, h, r) {
        if (r <= 0) return src;
        const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
        for (let y = 0; y < h; y++) {
            let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) { tmp[y * w + x] = s / k; s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
        }
        for (let x = 0; x < w; x++) {
            let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) { out[y * w + x] = s / k; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
        }
        return out;
    }

    function dilate(m, w, h, r) {
        if (r <= 0) return m;
        const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && m[y * w + xx]) v = 1; } t[y * w + x] = v;
        }
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
            let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x]) v = 1; } o[y * w + x] = v;
        }
        return o;
    }

    // Zhang-Suen : amincit un masque binaire en lignes d'1 pixel
    function thin(mask, w, h) {
        const m = Uint8Array.from(mask); const del = [];
        let changed = true, guard = 0;
        // les bords de l'image sont forcés à 0 pour éviter les tests de limites
        for (let x = 0; x < w; x++) { m[x] = 0; m[(h - 1) * w + x] = 0; } for (let y = 0; y < h; y++) { m[y * w] = 0; m[y * w + w - 1] = 0; }
        while (changed && guard++ < 200) {
            changed = false;
            for (let pass = 0; pass < 2; pass++) {
                del.length = 0;
                for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                    const i = y * w + x; if (!m[i]) continue;
                    const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
                    const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
                    const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2); if (A !== 1) continue;
                    if (pass === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; } else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
                    del.push(i);
                }
                if (del.length) { changed = true; for (const i of del) m[i] = 0; }
            }
        }
        return m;
    }

    // binary heap (clé, id)
    class Heap {
        constructor() { this.k = []; this.v = []; }
        get size() { return this.k.length; }
        push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
        pop() {
            const k = this.k, v = this.v; const rk = k[0], rv = v[0]; const lk = k.pop(), lv = v.pop(); const n = k.length;
            if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
            this.rk = rk; return rv;
        }
    }

    function dpSimplify(pts, eps) {
        if (pts.length < 3) return pts.slice();
        const A0 = pts[0], B0 = pts[pts.length - 1];
        if (Math.hypot(A0.x - B0.x, A0.y - B0.y) < 1e-6 && pts.length > 3) { // boucle fermée : on coupe au point le plus éloigné
            let m = 1, dm = -1; for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i].x - A0.x, pts[i].y - A0.y); if (d > dm) { dm = d; m = i; } }
            return dpSimplify(pts.slice(0, m + 1), eps).concat(dpSimplify(pts.slice(m), eps).slice(1));
        }
        const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
        while (st.length) {
            const [a, b] = st.pop(); let dm = -1, im = -1; const A = pts[a], B = pts[b]; const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1e-9;
            for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / L; if (d > dm) { dm = d; im = i; } }
            if (dm > eps) { keep[im] = 1; st.push([a, im], [im, b]); }
        }
        return pts.filter((_, i) => keep[i]);
    }
    function chaikinOpen(pts) {
        if (pts.length < 3) return pts.slice(); const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y }, { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y }); }
        out.push(pts[pts.length - 1]); return out;
    }
    function densify(pts, step) {
        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i]; const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.ceil(d / step));
            for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
        }
        return out;
    }

    // ------------------------------------------------------------------ graphe du squelette
    // nodes: {x,y,pix[]}, edges: {a,b,poly[{x,y}],pix[],len}
    function buildGraph(mask, w, h) {
        const N = w * h; const nb = new Uint8Array(N);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
            const i = y * w + x; if (!mask[i]) continue;
            nb[i] = mask[i - w - 1] + mask[i - w] + mask[i - w + 1] + mask[i - 1] + mask[i + 1] + mask[i + w - 1] + mask[i + w] + mask[i + w + 1];
        }
        const nodeId = new Int32Array(N).fill(-1); const nodes = [], edges = [];
        // pixels-nœuds : extrémités (nb=1) et jonctions (nb>=3), les jonctions voisines sont regroupées
        for (let i = 0; i < N; i++) {
            if (!mask[i] || nodeId[i] >= 0 || nb[i] === 2 || nb[i] === 0) continue;
            const id = nodes.length; const node = { x: 0, y: 0, pix: [] }; nodes.push(node);
            const st = [i]; nodeId[i] = id;
            while (st.length) {
                const p = st.pop(); node.pix.push(p); const px = p % w, py = (p - px) / w;
                if (nb[p] === 1) continue; // une extrémité n'est pas étendue
                for (const [dx, dy] of NB) { const q = (py + dy) * w + px + dx; if (mask[q] && nodeId[q] < 0 && nb[q] >= 3) { nodeId[q] = id; st.push(q); } }
            }
            for (const p of node.pix) { node.x += p % w; node.y += Math.floor(p / w); } node.x /= node.pix.length; node.y /= node.pix.length;
        }
        const visited = new Uint8Array(N);
        const nbrs = (p) => { const px = p % w, py = (p - px) / w, o = []; for (const [dx, dy] of NB) { const q = (py + dy) * w + px + dx; if (mask[q]) o.push(q); } return o; };
        function trace(u) {
            for (const v of nbrs(u)) {
                if (nodeId[v] >= 0) { if (nodeId[v] !== nodeId[u] && u < v) edges.push({ a: nodeId[u], b: nodeId[v], pix: [], poly: null }); continue; }
                if (visited[v]) continue;
                let prev = u, cur = v; const pix = []; let end = -1;
                for (let guard = 0; guard < N; guard++) {
                    visited[cur] = 1; pix.push(cur);
                    let next = -1; for (const q of nbrs(cur)) { if (q !== prev && !(q === u && pix.length === 1)) { next = q; break; } }
                    if (next < 0) break; // impasse (ne devrait pas arriver)
                    if (nodeId[next] >= 0) { end = nodeId[next]; break; }
                    if (visited[next]) break;
                    prev = cur; cur = next;
                }
                if (end >= 0) edges.push({ a: nodeId[u], b: end, pix, poly: null });
                else for (const p of pix) visited[p] = 0 || visited[p]; // chaîne coupée : ignorée
            }
        }
        for (let i = 0; i < N; i++) if (nodeId[i] >= 0 && mask[i]) trace(i);
        // cycles purs (aucun nœud)
        for (let i = 0; i < N; i++) {
            if (!mask[i] || visited[i] || nodeId[i] >= 0) continue;
            const id = nodes.length; nodes.push({ x: i % w, y: Math.floor(i / w), pix: [i] }); nodeId[i] = id; trace(i);
        }
        for (const e of edges) finishEdge(e, nodes, w);
        return { nodes, edges, w, h };
    }
    function finishEdge(e, nodes, w) {
        if (!e.poly) { e.poly = [{ x: nodes[e.a].x, y: nodes[e.a].y }]; for (const p of e.pix) e.poly.push({ x: p % w, y: Math.floor(p / w) }); e.poly.push({ x: nodes[e.b].x, y: nodes[e.b].y }); }
        let L = 0; for (let i = 1; i < e.poly.length; i++) L += Math.hypot(e.poly[i].x - e.poly[i - 1].x, e.poly[i].y - e.poly[i - 1].y); e.len = Math.max(L, 0.5);
    }

    function degrees(g) { const deg = new Int32Array(g.nodes.length); for (const e of g.edges) { deg[e.a]++; deg[e.b]++; } return deg; }

    // supprime les petites branches terminales (ébarbage) puis fusionne les nœuds de degré 2
    function pruneGraph(g, minSpur) {
        for (let pass = 0; pass < 4 && minSpur > 0; pass++) {
            const deg = degrees(g); let removed = 0;
            g.edges = g.edges.filter(e => {
                if (e.len >= minSpur || e.a === e.b) return true;
                const t = (deg[e.a] === 1 && deg[e.b] >= 3) || (deg[e.b] === 1 && deg[e.a] >= 3);
                if (t) { removed++; return false; } return true;
            });
            if (!removed) break;
            // libère les nœuds devenus isolés ; les degrés changent donc on boucle
            const d2 = degrees(g); g.nodes.forEach((n, i) => { if (!d2[i]) n.dead = true; });
        }
        mergeDeg2(g); return g;
    }
    function mergeDeg2(g) {
        let again = true;
        while (again) {
            again = false; const deg = degrees(g); const inc = g.nodes.map(() => []);
            g.edges.forEach((e, i) => { inc[e.a].push(i); if (e.b !== e.a) inc[e.b].push(i); });
            for (let n = 0; n < g.nodes.length; n++) {
                if (deg[n] !== 2 || g.nodes[n].dead || inc[n].length !== 2) continue;
                const [i1, i2] = inc[n]; if (i1 === i2) continue; const e1 = g.edges[i1], e2 = g.edges[i2];
                // orienter e1 pour qu'elle arrive en n, e2 pour qu'elle en parte
                const a = e1.b === n ? e1 : { a: e1.b, b: e1.a, pix: e1.pix.slice().reverse(), poly: e1.poly.slice().reverse() };
                const b = e2.a === n ? e2 : { a: e2.b, b: e2.a, pix: e2.pix.slice().reverse(), poly: e2.poly.slice().reverse() };
                const merged = { a: a.a, b: b.b, pix: a.pix.concat(g.nodes[n].pix, b.pix), poly: a.poly.concat(b.poly.slice(1)) };
                finishEdge(merged, g.nodes, g.w);
                g.nodes[n].dead = true; g.edges[i1] = merged; g.edges[i2] = null; g.edges = g.edges.filter(Boolean); again = true; break;
            }
        }
    }
    function graphMask(g) { const m = new Uint8Array(g.w * g.h); const deg = degrees(g); g.nodes.forEach((n, i) => { if (deg[i] && !n.dead) for (const p of n.pix) m[p] = 1; }); for (const e of g.edges) for (const p of e.pix) m[p] = 1; return m; }

    // composantes connexes du graphe -> id par arête
    function graphComps(g) {
        const par = g.nodes.map((_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
        for (const e of g.edges) par[f(e.a)] = f(e.b);
        const map = new Map(), comps = [];
        for (const e of g.edges) {
            const r = f(e.a); let c = map.get(r); if (!c) { c = { id: comps.length, edges: [], len: 0, minx: 1e9, miny: 1e9, maxx: -1e9, maxy: -1e9, removed: false }; map.set(r, c); comps.push(c); }
            c.edges.push(e); c.len += e.len; e.comp = c.id;
            for (const p of e.poly) { if (p.x < c.minx) c.minx = p.x; if (p.x > c.maxx) c.maxx = p.x; if (p.y < c.miny) c.miny = p.y; if (p.y > c.maxy) c.maxy = p.y; }
        }
        return comps;
    }

    // ------------------------------------------------------------------ module
    const C = {
        ready: false, active: false, graph: null, comps: [], src: null, removedPts: [], timer: null, busy: false, lastMode: '',
        t(fr) { const r = (window.I18N && window.I18N.tr) ? window.I18N.tr(fr) : fr; return r == null ? fr : r; },
        status(fr, extra, warn) { const el = $('ct-status'); if (!el) return; el.innerText = this.t(fr) + (extra || ''); el.style.background = warn ? '#fff3e0' : '#eef4fc'; el.style.color = warn ? '#e65100' : '#0b3d6e'; },
        setActive(on) { this.active = !!on; if (on && !this.ready) this.onParam(true); if (window.app) app.draw(); },
        v(id) { const e = $(id); return e ? parseFloat(e.value) : 0; },
        chk(id) { const e = $(id); return !!(e && e.checked); },

        onParam(now) {
            ['ct-thr', 'ct-sens', 'ct-close', 'ct-spur', 'ct-min'].forEach(id => { const b = $('val-' + id); if (b) b.innerText = $(id).value; });
            clearTimeout(this.timer); this.timer = setTimeout(() => this.analyze(), now ? 0 : 140);
        },
        resetPicks() { this.removedPts = []; this.onParam(true); },

        composeSource() {
            const { W, H } = dims();
            const imgs = app.layers ? app.getFlatLayers().filter(l => l.type === 'image' && l.img && l.effectiveVisible) : [];
            if (!imgs.length) return null;
            const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.translate(W / 2, H / 2);
            for (const l of imgs) {
                ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot * Math.PI / 180); ctx.scale(l.scaleX !== undefined ? l.scaleX : 1, l.scaleY !== undefined ? l.scaleY : 1);
                ctx.globalAlpha = 1; ctx.drawImage(l.img, -l.img.width / 2, -l.img.height / 2); ctx.restore();
            }
            return { w: W, h: H, W, H, data: ctx.getImageData(0, 0, W, H).data, layers: imgs };
        },

        // masque d'encre (1 = trait) selon le mode
        inkMask(gray, w, h, mode) {
            const N = w * h; let ink = new Uint8Array(N);
            if (mode === 'traits') {
                const thr = this.v('ct-thr'); for (let i = 0; i < N; i++) ink[i] = gray[i] < thr ? 1 : 0;
            } else {
                const g = boxBlur(boxBlur(gray, w, h, 1), w, h, 1); const mag = new Float32Array(N);
                for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                    const i = y * w + x;
                    const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
                    const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
                    mag[i] = Math.hypot(gx, gy) / 4;
                }
                const s = this.v('ct-sens') / 100; const hi = 90 * (1 - s) + 6, lo = hi * 0.45;
                // hystérésis
                const st = []; for (let i = 0; i < N; i++) if (mag[i] >= hi) { ink[i] = 1; st.push(i); }
                while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (!ink[q] && mag[q] >= lo) { ink[q] = 1; st.push(q); } } }
            }
            return ink;
        },

        analyze() {
            const t0 = performance.now();
            const src = this.composeSource();
            if (!src) { this.ready = false; this.graph = null; this.comps = []; this.status('Importez une image (bouton « + Image ») pour commencer.', '', true); this.updateUI(); if (window.app) app.draw(); return; }
            const { w, h } = src; const d = src.data; const gray = new Float32Array(w * h);
            for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
            let mode = $('ct-mode').value;
            if (mode === 'auto') {
                // finesse moyenne des traits : épaisse => formes pleines/photo => on prend les contours des formes
                const ink0 = this.inkMask(gray, w, h, 'traits'); let n0 = 0; for (let i = 0; i < ink0.length; i++) n0 += ink0[i];
                let n1 = 0; if (n0) { const sk = thin(ink0, w, h); for (let i = 0; i < sk.length; i++) n1 += sk[i]; }
                mode = (n0 && n1 && n0 / n1 <= 6) ? 'traits' : 'contours';
            }
            this.lastMode = mode;
            let ink = this.inkMask(gray, w, h, mode);
            ink = dilate(ink, w, h, Math.round(this.v('ct-close')));
            const skel = thin(ink, w, h);
            let g = buildGraph(skel, w, h);
            pruneGraph(g, this.v('ct-spur'));
            // composantes : petites poussières retirées, objet principal, éléments retirés à la main
            let comps = graphComps(g); const minLen = this.v('ct-min');
            comps = comps.filter(c => c.len >= minLen); comps.forEach((c, i) => { c.idx = i; });
            if (this.chk('ct-main') && comps.length > 1) {
                const main = comps.reduce((a, b) => (b.len > a.len ? b : a)); const mx = (main.maxx - main.minx) * 0.08 + 6, my = (main.maxy - main.miny) * 0.08 + 6;
                for (const c of comps) { const cx = (c.minx + c.maxx) / 2, cy = (c.miny + c.maxy) / 2; if (!(cx > main.minx - mx && cx < main.maxx + mx && cy > main.miny - my && cy < main.maxy + my)) c.removed = true; }
            }
            // éléments retirés/restaurés par clic : mémorisés en points de scène
            const owner = new Map(); // pixel -> comp (échantillonné via polylignes)
            for (const rp of this.removedPts) {
                const px = rp.x + src.W / 2, py = rp.y + src.H / 2; let best = null, bd = 8;
                for (const c of comps) for (const e of c.edges) for (const p of e.poly) { const dd = Math.hypot(p.x - px, p.y - py); if (dd < bd) { bd = dd; best = c; } }
                if (best) best.removed = !best.removed;
            }
            this.src = src; this.graph = g; this.comps = comps; this.ready = true; this.mode = mode;
            this.updateUI();
            const act = comps.filter(c => !c.removed); const L = act.reduce((a, c) => a + c.len, 0);
            this.status(act.length ? ('Aperçu : ' + act.length + ' ' + this.t(act.length > 1 ? 'éléments' : 'élément') + ', ' + Math.round(L) + ' ' + this.t('unités de trait') + ' — ' + this.t(mode === 'traits' ? 'mode traits' : 'mode contours') + '. ') + this.t('Réglez puis cliquez sur « Dessiner ».')
                : 'Aucun contour trouvé : ajustez le seuil / la sensibilité.', '', !act.length);
            this.ms = Math.round(performance.now() - t0);
            if (window.app) app.draw();
        },

        updateUI() { const b = $('ct-draw'); if (b) b.disabled = !(this.ready && this.comps.some(c => !c.removed)); },

        onClick(pt) {
            if (!this.ready || !this.chk('ct-pick')) return false;
            this.removedPts.push({ x: pt.x, y: pt.y }); this.analyze(); return true;
        },

        // ---------------------------------------------------------------- étape 2 : tracé unique
        generate() {
            if (!this.ready) return;
            const t0 = performance.now(); const { w, h, W, H } = this.src; const N = w * h;
            const act = this.comps.filter(c => !c.removed); if (!act.length) return;
            // masque du squelette actif
            let mask = new Uint8Array(N); const deg = degrees(this.graph);
            const used = new Set(); act.forEach(c => c.edges.forEach(e => { used.add(e.a); used.add(e.b); for (const p of e.pix) mask[p] = 1; }));
            used.forEach(n => { for (const p of this.graph.nodes[n].pix) mask[p] = 1; });
            // 1) liaisons entre composantes isolées (Dijkstra pondéré)
            let outsideBridge = 0, nBridge = 0;
            let comps = act.length;
            if (comps > 1) {
                const r = this.bridge(mask, w, h, act); mask = r.mask; outsideBridge = r.outside; nBridge = r.n;
                mask = thin(mask, w, h);
            }
            const g = buildGraph(mask, w, h); mergeDeg2(g);
            if (!g.edges.length) { this.status('Rien à tracer.', '', true); return; }
            // 2) parcours unique (postier chinois ouvert) sur chaque composante restante (normalement une seule)
            const finalComps = graphComps(g).length;
            const seq = this.euler(g);
            // 3) polyligne finale
            let pts = [];
            const ox = W / 2, oy = H / 2;
            for (const s of seq) {
                let poly = s.d ? s.e.poly.slice().reverse() : s.e.poly;
                poly = dpSimplify(poly, 0.7); poly = chaikinOpen(poly);
                for (let i = (pts.length ? 1 : 0); i < poly.length; i++) pts.push({ x: poly[i].x, y: poly[i].y });
            }
            pts = densify(pts, 1.8).map(p => ({ x: +(p.x - ox).toFixed(2), y: +(p.y - oy).toFixed(2) }));
            // vérifie qu'aucun pas ne dépasse 2 unités
            let maxStep = 0; for (let i = 1; i < pts.length; i++) maxStep = Math.max(maxStep, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
            let tot = 0; for (const e of g.edges) tot += e.len; let walked = 0; for (const s of seq) walked += s.e.len;
            app.addLayer({ type: 'pen', name: '✏️ Contour ' + (app.contourCount = (app.contourCount || 0) + 1), color: app.ui.color, width: app.ui.penWidth, points: pts });
            if (this.chk('ct-hide')) { this.src.layers.forEach(l => { l.visible = false; }); }
            app.invalidateSim(); app.refreshLayerList(); app.autoSave(); app.draw();
            this.report = { points: pts.length, maxStep: +maxStep.toFixed(2), skeleton: Math.round(tot), walked: Math.round(walked), repeated: Math.round(Math.max(0, walked - tot)), bridges: nBridge, finalComps, outsidePx: outsideBridge, comps, ms: Math.round(performance.now() - t0) };
            this.status('Tracé créé : ', this.report.points + ' pts, ' + this.t('repassages') + ' ' + Math.round(100 * this.report.repeated / Math.max(1, tot)) + ' %' + (nBridge ? ', ' + nBridge + ' ' + this.t('liaison(s)') : '') + (outsideBridge ? ' — ⚠️ ' + this.t('une liaison passe hors silhouette (formes séparées)') : '') + '.', outsideBridge > 0);
        },

        // Prim sur les composantes : chemin le plus court qui préfère longer les traits, puis l'intérieur, rarement l'extérieur
        bridge(mask, w, h, act) {
            const N = w * h;
            // composantes en pixels (8-connexité)
            const lab = new Int32Array(N).fill(-1); const compPix = [];
            for (let i = 0; i < N; i++) {
                if (!mask[i] || lab[i] >= 0) continue; const id = compPix.length, st = [i], pix = []; lab[i] = id;
                while (st.length) { const p = st.pop(); pix.push(p); const x = p % w, y = (p - x) / w; for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (mask[q] && lab[q] < 0) { lab[q] = id; st.push(q); } } }
                compPix.push(pix);
            }
            if (compPix.length < 2) return { mask, outside: 0, n: 0 };
            // silhouette F = squelette dilaté (3 px) + trous remplis ; hors de F = extérieur
            const dil = dilate(mask, w, h, 3); const outside = new Uint8Array(N); const st = [];
            for (let x = 0; x < w; x++) { for (const i of [x, (h - 1) * w + x]) if (!dil[i] && !outside[i]) { outside[i] = 1; st.push(i); } }
            for (let y = 0; y < h; y++) { for (const i of [y * w, y * w + w - 1]) if (!dil[i] && !outside[i]) { outside[i] = 1; st.push(i); } }
            while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (!dil[q] && !outside[q]) { outside[q] = 1; st.push(q); } } }
            const cost = new Float32Array(N); for (let i = 0; i < N; i++) cost[i] = mask[i] ? 0.2 : (outside[i] ? 40 : 3);
            const inTree = new Uint8Array(compPix.length); let start = 0; for (let i = 1; i < compPix.length; i++) if (compPix[i].length > compPix[start].length) start = i; inTree[start] = 1;
            const out = new Uint8Array(mask); let nb = 0, outPx = 0, remaining = compPix.length - 1;
            const dist = new Float64Array(N), par = new Int32Array(N); const heap = new Heap();
            while (remaining > 0) {
                dist.fill(Infinity); par.fill(-1); heap.k.length = 0; heap.v.length = 0;
                for (let c = 0; c < compPix.length; c++) if (inTree[c]) for (const p of compPix[c]) { dist[p] = 0; heap.push(0, p); }
                let hit = -1;
                while (heap.size) {
                    const p = heap.pop(), dp = heap.rk; if (dp > dist[p]) continue;
                    if (lab[p] >= 0 && !inTree[lab[p]]) { hit = p; break; }
                    const x = p % w, y = (p - x) / w;
                    for (let k = 0; k < 8; k++) { const xx = x + NB[k][0], yy = y + NB[k][1]; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; const nd = dp + cost[q] * (k & 1 ? 1 : 1.4142); if (nd < dist[q]) { dist[q] = nd; par[q] = p; heap.push(nd, q); } }
                }
                if (hit < 0) break;
                const c = lab[hit]; let p = hit; while (p >= 0 && !(lab[p] >= 0 && inTree[lab[p]])) { out[p] = 1; if (outside[p]) outPx++; p = par[p]; }
                out[p >= 0 ? p : hit] = 1; inTree[c] = 1; remaining--; nb++;
            }
            return { mask: out, outside: outPx, n: nb };
        },

        // Chemin eulérien ouvert de coût minimal (postier chinois approché)
        euler(g) {
            const n = g.nodes.length, E = g.edges;
            // garde la plus grosse composante connexe (les autres n'existent normalement pas après liaisons)
            const comps = graphComps(g); let best = comps[0]; for (const c of comps) if (c.len > best.len) best = c; const eset = new Set(best.edges);
            const edges = E.filter(e => eset.has(e)); const adj = Array.from({ length: n }, () => []);
            edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
            const all = edges.slice(); // copie modifiable (arêtes dupliquées ajoutées)
            const odd = []; for (let v = 0; v < n; v++) if (adj[v].length % 2) odd.push(v);
            let start = -1;
            if (odd.length > 2) {
                const K = odd.length; const idxOf = new Map(odd.map((v, i) => [v, i])); const D = new Float32Array(K * K);
                const dijk = (src) => {
                    const dist = new Float64Array(n).fill(Infinity), pe = new Int32Array(n).fill(-1); dist[src] = 0; const hp = new Heap(); hp.push(0, src);
                    while (hp.size) { const u = hp.pop(), du = hp.rk; if (du > dist[u]) continue; for (const ei of adj[u]) { const e = edges[ei]; const v = e.a === u ? e.b : e.a; const nd = du + e.len; if (nd < dist[v]) { dist[v] = nd; pe[v] = ei; hp.push(nd, v); } } }
                    return { dist, pe };
                };
                for (let i = 0; i < K; i++) { const { dist } = dijk(odd[i]); for (let j = 0; j < K; j++) D[i * K + j] = dist[odd[j]]; }
                // appariement glouton
                const pairs = []; for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) pairs.push([D[i * K + j], i, j]); pairs.sort((a, b) => a[0] - b[0]);
                const mate = new Int32Array(K).fill(-1); for (const [, i, j] of pairs) if (mate[i] < 0 && mate[j] < 0) { mate[i] = j; mate[j] = i; }
                // amélioration 2-opt
                const list = []; for (let i = 0; i < K; i++) if (mate[i] > i) list.push([i, mate[i]]);
                for (let pass = 0; pass < 30; pass++) {
                    let imp = false;
                    for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
                        const [a, b] = list[p], [c, d] = list[q]; const cur = D[a * K + b] + D[c * K + d];
                        const o1 = D[a * K + c] + D[b * K + d], o2 = D[a * K + d] + D[b * K + c];
                        if (o1 + 1e-6 < cur && o1 <= o2) { list[p] = [a, c]; list[q] = [b, d]; imp = true; } else if (o2 + 1e-6 < cur) { list[p] = [a, d]; list[q] = [b, c]; imp = true; }
                    }
                    if (!imp) break;
                }
                // le couple le plus coûteux n'est pas dupliqué : il devient départ / arrivée
                let wi = 0; for (let p = 1; p < list.length; p++) if (D[list[p][0] * K + list[p][1]] > D[list[wi][0] * K + list[wi][1]]) wi = p;
                start = odd[list[wi][0]]; list.splice(wi, 1);
                for (const [a, b] of list) {
                    const { pe } = dijk(odd[a]); let v = odd[b]; const target = odd[a];
                    while (v !== target) { const ei = pe[v]; const e = edges[ei]; all.push({ a: e.a, b: e.b, poly: e.poly, pix: e.pix, len: e.len, dup: true }); v = e.a === v ? e.b : e.a; }
                }
            } else if (odd.length === 2) start = odd[0];
            else start = edges.length ? edges[0].a : 0;
            // Hierholzer (arêtes avec direction)
            const adj2 = Array.from({ length: n }, () => []); all.forEach((e, i) => { adj2[e.a].push(i); if (e.b !== e.a) adj2[e.b].push(i); else adj2[e.a].push(i); });
            const usedE = new Uint8Array(all.length), ptr = new Int32Array(n); const stack = [{ v: start, e: -1, d: 0 }], res = [];
            while (stack.length) {
                const top = stack[stack.length - 1]; const A = adj2[top.v]; while (ptr[top.v] < A.length && usedE[A[ptr[top.v]]]) ptr[top.v]++;
                if (ptr[top.v] < A.length) { const ei = A[ptr[top.v]++]; usedE[ei] = 1; const e = all[ei]; const to = e.a === top.v ? e.b : e.a; stack.push({ v: to, e: ei, d: e.a === top.v ? 0 : 1 }); }
                else { stack.pop(); if (top.e >= 0) res.push({ e: all[top.e], d: top.d }); }
            }
            res.reverse(); return res;
        },

        // ---------------------------------------------------------------- aperçu
        drawOverlay(ctx, zoom) {
            if (!this.ready || !this.graph) return; const { W, H } = this.src;
            if (this.chk('ct-fade')) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(-W / 2, -H / 2, W, H); ctx.restore(); }
            ctx.save(); ctx.translate(-W / 2, -H / 2); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            for (const c of this.comps) {
                ctx.beginPath(); ctx.strokeStyle = c.removed ? 'rgba(130,130,130,0.55)' : '#e91e63'; ctx.lineWidth = (c.removed ? 1 : 1.6) / zoom;
                ctx.setLineDash(c.removed ? [3 / zoom, 3 / zoom] : []);
                for (const e of c.edges) { ctx.moveTo(e.poly[0].x + 0.5, e.poly[0].y + 0.5); for (let i = 1; i < e.poly.length; i++) ctx.lineTo(e.poly[i].x + 0.5, e.poly[i].y + 0.5); }
                ctx.stroke();
            }
            ctx.restore(); ctx.setLineDash([]);
        }
    };
    window.Contour = C;
})();
