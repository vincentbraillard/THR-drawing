/* ============================================================================
   TSP_CORE.JS — Moteur "TSP-art" partagé (stippling pondéré + tournée optimisée)
   ----------------------------------------------------------------------------
   Utilisé par autotrace.js pour :
     - convertir une image en un tracé continu façon finitecurve.com (mode
       Auto-Trace) : la densité de points suit l'obscurité de l'image ;
     - l'outil "TSP Fill" : remplir une forme/limite fermée par une ligne
       continue de même nature, avec point d'entrée/sortie au choix.

   Algorithmes (aucune dépendance externe, testés indépendamment sous Node.js
   avant intégration — voir CHANGELOG) :
     - Stippling pondéré par échantillonnage-rejet + relaxation de Lloyd
       (variante simplifiée du "Weighted Voronoi Stippling" de Secord 2002).
     - Construction initiale par plus-proche-voisin glouton (index spatial en
       grille), avec point de départ/arrivée imposés en option.
     - Amélioration 2-opt avec listes de voisins (k plus proches) pour rester
       rapide sur plusieurs milliers de points, en conservant les extrémités
       fixes.
   ============================================================================ */

(function () {
    'use strict';

    const TSPCore = {};

    // ---------------- Stippling pondéré ----------------
    // density: Float32Array/array de taille w*h, valeurs 0..1 (1 = beaucoup de points).
    TSPCore.stipple = function (density, w, h, count, iterations, rng) {
        rng = rng || Math.random;
        const pts = [];
        let guard = 0;
        while (pts.length < count && guard < count * 400) {
            guard++;
            const x = rng() * w, y = rng() * h;
            const d = density[Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0)];
            if (rng() < d) pts.push({ x, y });
        }
        for (let it = 0; it < iterations; it++) {
            const sumX = new Float64Array(pts.length), sumY = new Float64Array(pts.length), sumW = new Float64Array(pts.length);
            const cell = Math.max(4, Math.sqrt((w * h) / Math.max(1, pts.length)));
            const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
            const buckets = new Map();
            pts.forEach((p, idx) => {
                const gx = Math.min(gw - 1, (p.x / cell) | 0), gy = Math.min(gh - 1, (p.y / cell) | 0);
                const key = gy * gw + gx;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(idx);
            });
            const findNearest = (px, py) => {
                const gx = Math.min(gw - 1, (px / cell) | 0), gy = Math.min(gh - 1, (py / cell) | 0);
                let best = -1, bestD = Infinity;
                for (let r = 0; r < Math.max(gw, gh); r++) {
                    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        const cx = gx + dx, cy = gy + dy; if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
                        const bucket = buckets.get(cy * gw + cx); if (!bucket) continue;
                        for (const idx of bucket) {
                            const ddx = pts[idx].x - px, ddy = pts[idx].y - py; const dd = ddx * ddx + ddy * ddy;
                            if (dd < bestD) { bestD = dd; best = idx; }
                        }
                    }
                    if (best !== -1 && r > 0) break;
                }
                return best;
            };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    // v5.1 : pas de "plancher" de poids ici (c'était +0.02 avant) — un pixel à densité
                    // strictement nulle (hors d'une forme, pour TSP Fill) ne doit avoir AUCUNE influence,
                    // sinon la relaxation de Lloyd entraîne des points hors de la forme (bug confirmé :
                    // jusqu'à 12% des points dérivant à 3-4x le rayon de la forme hors de ses limites).
                    const wgt = density[y * w + x];
                    if (wgt <= 0) continue;
                    const idx = findNearest(x + 0.5, y + 0.5);
                    if (idx === -1) continue;
                    sumX[idx] += (x + 0.5) * wgt; sumY[idx] += (y + 0.5) * wgt; sumW[idx] += wgt;
                }
            }
            for (let i = 0; i < pts.length; i++) {
                if (sumW[i] > 1e-6) { pts[i].x = sumX[i] / sumW[i]; pts[i].y = sumY[i] / sumW[i]; }
            }
        }
        return pts;
    };

    // ---------------- Index spatial (grille) pour recherche de plus proche voisin ----------------
    function buildSpatialGrid(points, cellSize) {
        const grid = new Map();
        const keyOf = (x, y) => ((x / cellSize) | 0) + ',' + ((y / cellSize) | 0);
        points.forEach((p, idx) => {
            const k = keyOf(p.x, p.y);
            if (!grid.has(k)) grid.set(k, new Set());
            grid.get(k).add(idx);
        });
        return {
            remove(idx, p) { const k = keyOf(p.x, p.y); const s = grid.get(k); if (s) s.delete(idx); },
            findNearest(px, py, points, isExcluded) {
                const gx = (px / cellSize) | 0, gy = (py / cellSize) | 0;
                let best = -1, bestD = Infinity;
                for (let r = 0; r < 100000; r++) {
                    let any = false;
                    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        const s = grid.get((gx + dx) + ',' + (gy + dy)); if (!s || s.size === 0) continue;
                        any = true;
                        for (const idx of s) {
                            if (isExcluded && isExcluded(idx)) continue;
                            const ddx = points[idx].x - px, ddy = points[idx].y - py; const dd = ddx * ddx + ddy * ddy;
                            if (dd < bestD) { bestD = dd; best = idx; }
                        }
                    }
                    if (best !== -1 && r >= 1) break;
                    if (!any && best !== -1) break;
                }
                return best;
            }
        };
    }

    // ---------------- Construction gloutonne (plus proche voisin), extrémités imposables ----------------
    TSPCore.greedyTour = function (points, startIdx, endIdx) {
        const n = points.length;
        if (n === 0) return [];
        if (n === 1) return [0];
        const visited = new Uint8Array(n);
        const order = [];
        let cur = (startIdx !== undefined && startIdx !== null) ? startIdx : 0;
        visited[cur] = 1; order.push(cur);
        const hasEnd = (endIdx !== undefined && endIdx !== null) && endIdx !== cur;
        if (hasEnd) visited[endIdx] = 1;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
        const area = Math.max(1, (maxX - minX) * (maxY - minY));
        const cellSize = Math.max(1, Math.sqrt(area / n));
        const grid = buildSpatialGrid(points, cellSize);
        grid.remove(cur, points[cur]);
        if (hasEnd) grid.remove(endIdx, points[endIdx]);

        const targetSteps = n - (hasEnd ? 1 : 0);
        for (let step = 1; step < targetSteps; step++) {
            const nxt = grid.findNearest(points[cur].x, points[cur].y, points, (idx) => visited[idx]);
            if (nxt === -1) break;
            visited[nxt] = 1; grid.remove(nxt, points[nxt]);
            order.push(nxt); cur = nxt;
        }
        if (hasEnd) order.push(endIdx);
        return order;
    };

    // ---------------- k plus proches voisins (pour le 2-opt) ----------------
    TSPCore.buildKNN = function (points, k) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
        const area = Math.max(1, (maxX - minX) * (maxY - minY));
        const cellSize = Math.max(1, Math.sqrt(area / points.length));
        const buckets = new Map();
        const keyOf = (x, y) => ((x / cellSize) | 0) + ',' + ((y / cellSize) | 0);
        points.forEach((p, idx) => { const kk = keyOf(p.x, p.y); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(idx); });
        const neighbors = new Array(points.length);
        for (let i = 0; i < points.length; i++) {
            const gx = (points[i].x / cellSize) | 0, gy = (points[i].y / cellSize) | 0;
            const cands = [];
            for (let r = 0; r < 6 && cands.length < k * 3; r++) {
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const b = buckets.get((gx + dx) + ',' + (gy + dy)); if (!b) continue;
                    for (const idx of b) if (idx !== i) cands.push(idx);
                }
            }
            cands.sort((a, b) => {
                const da = (points[a].x - points[i].x) ** 2 + (points[a].y - points[i].y) ** 2;
                const db = (points[b].x - points[i].x) ** 2 + (points[b].y - points[i].y) ** 2;
                return da - db;
            });
            neighbors[i] = cands.slice(0, k);
        }
        return neighbors;
    };

    // ---------------- 2-opt avec extrémités fixes, listes de voisins ----------------
    TSPCore.twoOpt = function (points, tour, knn, maxPasses) {
        const n = tour.length;
        if (n < 4) return tour;
        const pos = new Int32Array(n);
        tour.forEach((pIdx, i) => { pos[pIdx] = i; });
        const dist = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);

        function tryReverse(i, j) {
            let lo = i + 1, hi = j;
            while (lo < hi) { const tl = tour[lo], th = tour[hi]; tour[lo] = th; tour[hi] = tl; pos[th] = lo; pos[tl] = hi; lo++; hi--; }
        }

        let improved = true, passes = 0;
        while (improved && passes < maxPasses) {
            improved = false; passes++;
            for (let i = 0; i < n - 1; i++) {
                const a = tour[i], b = tour[i + 1];
                const dab = dist(a, b);
                let done = false;
                for (const c of knn[a]) {
                    const j = pos[c];
                    if (j <= i + 1 || j >= n - 1) continue;
                    const dac = dist(a, c);
                    if (dac >= dab) break;
                    const dcd = dist(tour[j], tour[j + 1]);
                    const dbd = dist(b, tour[j + 1]);
                    if (dac + dbd < dab + dcd - 1e-9) { tryReverse(i, j); improved = true; done = true; break; }
                }
                if (done) continue;
                for (const d4 of knn[b]) {
                    const j = pos[d4] - 1;
                    if (j <= i || j >= n - 1 || j < 0) continue;
                    const dbd = dist(b, d4);
                    if (dbd >= dab) break;
                    const c3 = tour[j];
                    const dcd = dist(c3, d4);
                    const dac = dist(a, c3);
                    if (dac + dbd < dab + dcd - 1e-9) { tryReverse(i, j); improved = true; break; }
                }
            }
        }
        return tour;
    };

    TSPCore.tourLength = function (points, tour) {
        let len = 0;
        for (let i = 1; i < tour.length; i++) len += Math.hypot(points[tour[i]].x - points[tour[i - 1]].x, points[tour[i]].y - points[tour[i - 1]].y);
        return len;
    };

    // ---------------- Utilitaire haut niveau : density -> tracé final (indices résolus) ----------------
    // Retourne { points: [{x,y}, ...] } dans l'ordre de la tournée (déjà 2-opt-optimisée).
    TSPCore.run = function (density, w, h, opts) {
        const rng = opts.rng || Math.random;
        const pts = TSPCore.stipple(density, w, h, opts.count, opts.relaxIterations !== undefined ? opts.relaxIterations : 3, rng);
        if (pts.length < 2) return { points: pts.slice() };

        let startIdx = null, endIdx = null;
        if (opts.startPoint) startIdx = nearestIndex(pts, opts.startPoint);
        if (opts.endPoint) endIdx = nearestIndex(pts, opts.endPoint);

        const tour = TSPCore.greedyTour(pts, startIdx, endIdx);
        const knn = TSPCore.buildKNN(pts, opts.knnK || 8);
        const optimized = TSPCore.twoOpt(pts, tour, knn, opts.twoOptPasses !== undefined ? opts.twoOptPasses : 20);
        return { points: optimized.map(i => pts[i]) };
    };

    function nearestIndex(pts, target) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const dx = pts[i].x - target.x, dy = pts[i].y - target.y; const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    // Filet de sécurité pour TSP Fill : reprojette tout point qui se retrouverait hors du
    // polygone (cas limite résiduel, ex. formes très fines) sur le point le plus proche de
    // son contour, pour garantir qu'aucun point ne dépasse jamais la zone à remplir.
    TSPCore.clampToPolygon = function (points, poly, pointInPolygonFn) {
        const closestOnSegment = (p, a, b) => {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            let t = len2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            return { x: a.x + t * dx, y: a.y + t * dy };
        };
        return points.map(p => {
            if (pointInPolygonFn(p.x, p.y, poly)) return p;
            let best = null, bestD = Infinity;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const c = closestOnSegment(p, poly[j], poly[i]);
                const d = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
                if (d < bestD) { bestD = d; best = c; }
            }
            return best || p;
        });
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = TSPCore;
    if (typeof window !== 'undefined') window.TSPCore = TSPCore;
})();
