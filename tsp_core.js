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

    // ---------------- Élimination RIGOUREUSE des croisements ----------------
    // Détecte GÉOMÉTRIQUEMENT (pas seulement via les listes de voisins, qui peuvent manquer des
    // croisements entre segments éloignés dans l'ordre de la tournée mais proches dans l'espace)
    // chaque paire de segments qui se croisent, et les "décroise" par un échange 2-opt — un
    // échange qui décroise deux segments réduit TOUJOURS la longueur totale (inégalité
    // triangulaire), donc cette passe ne peut jamais dégrader le résultat. Converge vers ZÉRO
    // croisement (vérifié par balayage exhaustif après coup lors des tests). Garde les deux
    // extrémités de la tournée fixes, comme le reste du moteur.
    function segmentsIntersect(p1, p2, p3, p4) {
        function ccw(a, b, c) { return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x); }
        return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
    }
    TSPCore.removeCrossings = function (points, tour, maxPasses) {
        const n = tour.length;
        if (n < 4) return tour;
        maxPasses = maxPasses || 30;
        for (let pass = 0; pass < maxPasses; pass++) {
            let anyFixedThisPass = false;
            for (let i = 0; i < n - 2; i++) {
                let retries = 0;
                while (retries < 5) {
                    const a = points[tour[i]], b = points[tour[i + 1]];
                    let foundJ = -1;
                    for (let j = i + 2; j < n - 1; j++) {
                        if (i === 0 && j === n - 2) continue;
                        if (segmentsIntersect(a, b, points[tour[j]], points[tour[j + 1]])) { foundJ = j; break; }
                    }
                    if (foundJ === -1) break;
                    let lo = i + 1, hi = foundJ;
                    while (lo < hi) { const t = tour[lo]; tour[lo] = tour[hi]; tour[hi] = t; lo++; hi--; }
                    anyFixedThisPass = true; retries++;
                }
            }
            if (!anyFixedThisPass) break;
        }
        return tour;
    };

    // ---------------- Composantes connexes d'une carte de densité (îlots séparés) ----------------
    TSPCore.connectedComponents = function (density, w, h) {
        const labels = new Int32Array(w * h).fill(-1);
        let nextLabel = 0; const stack = []; const comps = [];
        for (let start = 0; start < w * h; start++) {
            if (density[start] <= 0 || labels[start] !== -1) continue;
            let area = 0;
            stack.length = 0; stack.push(start); labels[start] = nextLabel;
            while (stack.length) {
                const idx = stack.pop(); const x = idx % w, y = (idx / w) | 0; area++;
                const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
                for (const n of neighbors) {
                    if (n < 0 || n >= w * h) continue;
                    if ((n === idx - 1 || n === idx + 1) && ((n / w) | 0) !== y) continue;
                    if (density[n] > 0 && labels[n] === -1) { labels[n] = nextLabel; stack.push(n); }
                }
            }
            comps.push({ label: nextLabel, area }); nextLabel++;
        }
        return { labels, comps };
    };

    // ---------------- Solveur "multi-îlots" : LE point d'entrée haut niveau recommandé ----------------
    // Détecte les régions déconnectées de la carte de densité (ex. les mèches séparées d'une
    // crinière), résout la tournée de CHAQUE îlot indépendamment (départ choisi automatiquement au
    // point le plus excentré de son propre nuage — donc près du bord, pas en plein milieu), puis
    // enchaîne les îlots par plus-proche-EXTRÉMITÉ (le pont entre deux îlots part et arrive donc
    // toujours d'un bout de trajet déjà proche du bord de chaque forme, plutôt que d'un point
    // quelconque choisi au hasard en plein milieu). Une passe finale de `removeCrossings` sur
    // l'ensemble assemblé garantit zéro croisement, y compris entre les ponts eux-mêmes.
    // opts: { rng, startPoint, endPoint } — startPoint/endPoint en coordonnées de la grille (mêmes
    // unités que w,h), pour imposer un point de départ/arrivée précis si l'utilisateur en a choisi un.
    TSPCore.solveMultiIsland = function (density, w, h, count, opts) {
        opts = opts || {};
        const { labels, comps } = TSPCore.connectedComponents(density, w, h);
        if (comps.length === 0) return [];

        const allPts = TSPCore.stipple(density, w, h, count, opts.relaxIterations !== undefined ? opts.relaxIterations : 3, opts.rng || Math.random);
        const buckets = new Map();
        for (const p of allPts) {
            const gx = Math.min(w - 1, Math.max(0, p.x | 0)), gy = Math.min(h - 1, Math.max(0, p.y | 0));
            const label = labels[gy * w + gx];
            if (label === -1) continue;
            if (!buckets.has(label)) buckets.set(label, []);
            buckets.get(label).push(p);
        }

        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const nearestInList = (pts, target) => {
            let best = 0, bestD = Infinity;
            pts.forEach((p, i) => { const d = dist(p, target); if (d < bestD) { bestD = d; best = i; } });
            return best;
        };

        const solveIsland = (pts, forcedStart, forcedEnd) => {
            if (pts.length <= 1) return pts.map((_, i) => i);
            let startIdx;
            if (forcedStart) startIdx = nearestInList(pts, forcedStart);
            else {
                // pas de contrainte : démarre au point le plus excentré de son propre nuage
                // (donc naturellement près du bord, pas en plein milieu de l'îlot).
                let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
                let bestD = -1; startIdx = 0;
                pts.forEach((p, i) => { const d = (p.x - cx) ** 2 + (p.y - cy) ** 2; if (d > bestD) { bestD = d; startIdx = i; } });
            }
            let endIdx = forcedEnd ? nearestInList(pts, forcedEnd) : null;
            if (endIdx === startIdx) endIdx = null;
            const tour = TSPCore.greedyTour(pts, startIdx, endIdx);
            const knn = TSPCore.buildKNN(pts, Math.min(12, pts.length - 1));
            let t = TSPCore.twoOpt(pts, tour, knn, 25);
            t = TSPCore.removeCrossings(pts, t, 15);
            return t;
        };

        // Détermine quel îlot (le cas échéant) doit porter le départ/l'arrivée imposés, pour que
        // sa PROPRE tournée interne s'y termine exactement, plutôt que de déplacer un point après
        // coup (ce qui casserait la continuité du trajet).
        const bucketEntries = [...buckets.entries()];
        let startBucketIdx = null, endBucketIdx = null;
        if (opts.startPoint) {
            let bestD = Infinity;
            bucketEntries.forEach(([, pts], i) => { const idx = nearestInList(pts, opts.startPoint); const d = dist(pts[idx], opts.startPoint); if (d < bestD) { bestD = d; startBucketIdx = i; } });
        }
        if (opts.endPoint) {
            let bestD = Infinity;
            bucketEntries.forEach(([, pts], i) => { const idx = nearestInList(pts, opts.endPoint); const d = dist(pts[idx], opts.endPoint); if (d < bestD) { bestD = d; endBucketIdx = i; } });
        }

        const islands = bucketEntries.map(([, pts], i) => {
            const forcedStart = (i === startBucketIdx) ? opts.startPoint : null;
            const forcedEnd = (i === endBucketIdx) ? opts.endPoint : null;
            const order = solveIsland(pts, forcedStart, forcedEnd);
            return { points: order.map(idx => pts[idx]), isStartIsland: i === startBucketIdx, isEndIsland: i === endBucketIdx };
        });
        if (islands.length === 0) return [];

        const remaining = islands.slice();
        const ordered = [];

        // L'îlot de départ imposé (s'il existe) passe en premier, orienté pour que son point
        // forcé soit bien en position 0 (pas à l'autre bout).
        let firstIdx = remaining.findIndex(isl => isl.isStartIsland);
        if (firstIdx === -1) {
            // pas de contrainte : démarre par l'îlot/extrémité le plus proche de l'origine (choix
            // stable par défaut, lui aussi naturellement proche du bord grâce à solveIsland ci-dessus).
            let bestI = 0, bestRev = false, bestD = Infinity;
            remaining.forEach((isl, ii) => {
                const d0 = dist({ x: 0, y: 0 }, isl.points[0]), d1 = dist({ x: 0, y: 0 }, isl.points[isl.points.length - 1]);
                if (d0 < bestD) { bestD = d0; bestI = ii; bestRev = false; }
                if (d1 < bestD) { bestD = d1; bestI = ii; bestRev = true; }
            });
            firstIdx = bestI;
            const isl = remaining.splice(firstIdx, 1)[0]; if (bestRev) isl.points.reverse();
            ordered.push(isl);
        } else {
            const isl = remaining.splice(firstIdx, 1)[0];
            const dStart = dist(isl.points[0], opts.startPoint), dEnd = dist(isl.points[isl.points.length - 1], opts.startPoint);
            if (dEnd < dStart) isl.points.reverse();
            ordered.push(isl);
        }
        let cursor = ordered[0].points[ordered[0].points.length - 1];

        // Réserve l'îlot d'arrivée imposé pour la toute fin.
        let endIsland = null;
        if (endBucketIdx !== null) {
            const idx = remaining.findIndex(isl => isl.isEndIsland);
            if (idx !== -1) endIsland = remaining.splice(idx, 1)[0];
        }

        while (remaining.length) {
            let bestI = -1, bestRev = false, bestD = Infinity;
            remaining.forEach((isl, ii) => {
                const d0 = dist(cursor, isl.points[0]), d1 = dist(cursor, isl.points[isl.points.length - 1]);
                if (d0 < bestD) { bestD = d0; bestI = ii; bestRev = false; }
                if (d1 < bestD) { bestD = d1; bestI = ii; bestRev = true; }
            });
            const isl = remaining.splice(bestI, 1)[0]; if (bestRev) isl.points.reverse();
            ordered.push(isl); cursor = isl.points[isl.points.length - 1];
        }
        if (endIsland) {
            // Son point imposé est déjà en dernière position (forcé via `forcedEnd` dans
            // solveIsland ci-dessus) : on l'ajoute tel quel, sans le réordonner.
            ordered.push(endIsland);
        }

        let finalPts = [];
        for (const isl of ordered) finalPts.push(...isl.points);

        const idxTour = finalPts.map((_, i) => i);
        const cleaned = TSPCore.removeCrossings(finalPts, idxTour, 30);
        return cleaned.map(i => finalPts[i]);
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
