/* ============================================================================
   help.js — Infobulles « i » (v6.7)

   - Outils : petit « i » à droite de chaque outil. Au survol (souris) ou au clic / toucher,
     une bulle affiche une courte animation d'exemple (SVG animé, boucle de 6 s) + une phrase.
   - Paramètres : petit « i » à côté du libellé de chaque réglage ; la bulle explique en texte
     ce que fait le réglage.
   Les textes existent en français et en anglais (suivent la langue choisie via i18n.js).
   ============================================================================ */
(function () {
    'use strict';

    const lang = () => (window.I18N ? window.I18N.lang : 'fr');

    // ========================================================================= Aides SVG / SMIL
    const DUR = 6;                                  // durée de la boucle (s)
    const n2 = x => +(+x).toFixed(2);

    // Normalise une liste de keyframes [[t, valeur], …] : débute à 0, finit à 1, temps croissants.
    function norm(kf) {
        const out = [];
        kf.forEach(k => {
            let t = k[0];
            if (out.length && t <= out[out.length - 1][0]) t = out[out.length - 1][0] + 0.0005;
            out.push([Math.min(t, 1), k[1]]);
        });
        if (out[0][0] > 0) out.unshift([0, out[0][1]]);
        if (out[out.length - 1][0] < 1) out.push([1, out[out.length - 1][1]]);
        return out;
    }
    const kt = f => f.map(k => +k[0].toFixed(4)).join(';');
    const anim = (attr, kf) => { const f = norm(kf); return `<animate attributeName="${attr}" dur="${DUR}s" repeatCount="indefinite" keyTimes="${kt(f)}" values="${f.map(k => k[1]).join(';')}"/>`; };
    const animT = (type, kf) => { const f = norm(kf); return `<animateTransform attributeName="transform" type="${type}" dur="${DUR}s" repeatCount="indefinite" keyTimes="${kt(f)}" values="${f.map(k => k[1]).join(';')}"/>`; };

    // Apparition douce entre t0 et t1
    const vis = (t0, t1) => anim('opacity', [[0, 0], [t0, 0], [t0 + 0.02, 1], [t1, 1], [t1 + 0.03, 0]]);
    const fadeIn = t0 => anim('opacity', [[0, 0], [t0, 0], [t0 + 0.03, 1]]);

    // Trait qui se dessine progressivement (pathLength normalisé à 100)
    function stroke(d, t0, t1, color, w) {
        return `<path d="${d}" pathLength="100" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="100 300" stroke-dashoffset="100">${anim('stroke-dashoffset', [[0, 100], [t0, 100], [t1, 0]])}</path>`;
    }

    const CUR = '<path d="M0,0 L0,16 L4.2,12.4 L7,18.6 L9.6,17.5 L6.8,11.3 L12.2,11.3 Z" fill="#fff" stroke="#222" stroke-width="1.2" stroke-linejoin="round"/>';
    const cursor = frames => `<g>${animT('translate', frames.map(f => [f[0], n2(f[1]) + ',' + n2(f[2])]))}${CUR}</g>`;
    const ripple = (t, x, y) => `<circle cx="${x}" cy="${y}" fill="none" stroke="#0078D7" stroke-width="2">${anim('r', [[0, 2], [t, 2], [t + 0.08, 15]])}${anim('opacity', [[0, 0], [t - 0.002, 0], [t, 0.9], [t + 0.08, 0]])}</circle>`;

    const BG = '<rect width="240" height="150" fill="#f4efe3"/><circle cx="120" cy="75" r="68" fill="#e9dfc7" stroke="#b9a678" stroke-width="2"/><circle cx="120" cy="75" r="2.5" fill="#b9a678" opacity=".7"/>';
    const svg = inner => `<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${BG}<g>${anim('opacity', [[0, 0], [0.02, 1], [0.9, 1], [0.95, 0]])}${inner}</g></svg>`;

    const bez = (p0, p1, p2, p3, t) => {
        const u = 1 - t;
        return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    };
    const bezPath = c => `M${c[0]} C${c[1]} ${c[2]} ${c[3]}`;                 // c = ["x,y", "x,y", "x,y", "x,y"]
    const toPt = s => s.split(',').map(Number);

    // ========================================================================= Animations des outils
    const DEMOS = {
        // 🖐️ Sélection : déplacer, redimensionner, tourner
        select() {
            const c0 = '98,74', c1 = '134,82';
            const body = '<rect x="-28" y="-18" width="56" height="36" rx="5" fill="#ffb74d" stroke="#e65100" stroke-width="2"/>' +
                '<path d="M-16,10 L-5,-6 L3,4 L9,-2 L19,10 Z" fill="#fff" opacity=".65"/><circle cx="14" cy="-8" r="4" fill="#fff" opacity=".65"/>';
            let corners = '';
            [[-33, -23], [33, -23], [-33, 23], [33, 23]].forEach(c => { corners += `<rect x="${c[0] - 3.5}" y="${c[1] - 3.5}" width="7" height="7" fill="#fff" stroke="#0078D7" stroke-width="1.5"/>`; });
            const frame = '<rect x="-33" y="-23" width="66" height="46" fill="none" stroke="#0078D7" stroke-width="1.5" stroke-dasharray="4 3"/>' + corners +
                '<line x1="0" y1="-23" x2="0" y2="-35" stroke="#0078D7" stroke-width="1.5"/><circle cx="0" cy="-35" r="4" fill="#fff" stroke="#0078D7" stroke-width="1.5"/>';
            return `<g>${animT('translate', [[0, c0], [0.12, c0], [0.32, c1]])}` +
                `<g>${animT('rotate', [[0, 0], [0.66, 0], [0.86, -30]])}` +
                `<g>${animT('scale', [[0, 1], [0.4, 1], [0.58, 1.5]])}${body}<g>${anim('opacity', [[0, 0], [0.09, 0], [0.11, 1]])}${frame}</g></g></g></g>` +
                cursor([[0, 205, 128], [0.09, 98, 74], [0.12, 98, 74], [0.32, 134, 82], [0.33, 134, 82], [0.4, 167, 105], [0.58, 182, 115], [0.66, 134, 31], [0.86, 108.5, 37.8], [0.92, 190, 125]]);
        },

        // ✏️ Crayon : trait à main levée
        pen() {
            const n = 56, pts = [];
            for (let i = 0; i <= n; i++) { const u = i / n; pts.push([40 + 160 * u, 78 + 26 * Math.sin(u * Math.PI * 3) + 9 * Math.sin(u * Math.PI * 8 + 0.6)]); }
            const d = 'M' + pts.map(p => n2(p[0]) + ',' + n2(p[1])).join(' L');
            const t0 = 0.08, t1 = 0.64;
            const frames = [[0, 205, 130]].concat(pts.map((p, i) => [t0 + (t1 - t0) * i / n, p[0], p[1]]));
            frames.push([0.74, 205, 120]);
            return stroke(d, t0, t1, '#222', 3) + cursor(frames);
        },

        // 🔤 Texte : poser des cases puis y écrire des lettres
        text() {
            let boxes = '', letters = '', ripples = ripple(0.1, 120, 75);
            const word = 'SUNAE', starts = [0.26, 0.39, 0.52, 0.65, 0.78];
            for (let i = 0; i < 5; i++) {
                const x = 33 + 36 * i;
                boxes += `<rect x="${x}" y="55" width="30" height="40" rx="3" fill="#f3e5f5" stroke="#8e24aa" stroke-width="1.6" stroke-dasharray="4 3"/>`;
                letters += `<text x="${x + 15}" y="83" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="#6a1b9a">${word[i]}${fadeIn(starts[i])}</text>`;
                ripples += ripple(starts[i] - 0.015, x + 15, 80);
            }
            const fr = [[0, 205, 128], [0.09, 120, 75], [0.12, 120, 75], [0.2, 48, 80], [0.27, 48, 80]];
            for (let i = 1; i < 5; i++) { fr.push([starts[i] - 0.06, 48 + 36 * i, 80]); fr.push([starts[i] + 0.01, 48 + 36 * i, 80]); }
            fr.push([0.9, 205, 128]);
            return `<g>${fadeIn(0.12)}${boxes}</g>${letters}${ripples}${cursor(fr)}`;
        },

        // 〰️ Remplissage : contour à main levée puis remplissage automatique en zigzag
        zigzag() {
            const segs = [
                ['120,38', '150,28', '180,52', '170,82'], ['170,82', '162,108', '130,118', '110,108'],
                ['110,108', '82,112', '58,92', '66,64'], ['66,64', '70,46', '96,34', '120,38']
            ];
            const blob = 'M120,38 C150,28 180,52 170,82 C162,108 130,118 110,108 C82,112 58,92 66,64 C70,46 96,34 120,38 Z';
            const samples = [];
            segs.forEach(s => { for (let k = 0; k < 6; k++) samples.push(bez(toPt(s[0]), toPt(s[1]), toPt(s[2]), toPt(s[3]), k / 6)); });
            samples.push([120, 38]);
            const t0 = 0.08, t1 = 0.32;
            const frames = [[0, 205, 130]].concat(samples.map((p, i) => [t0 + (t1 - t0) * i / (samples.length - 1), p[0], p[1]]));
            frames.push([0.42, 120, 75], [0.82, 150, 100], [0.9, 205, 128]);
            // zigzag : lignes horizontales reliées alternativement à gauche / à droite, découpées par la forme
            let zz = 'M50,30'; let y = 30, i = 0;
            while (y < 124) { zz += (i % 2 === 0 ? ' L190,' : ' L50,') + y; y += 6.5; i++; zz += (i % 2 === 1 ? ' L190,' : ' L50,') + y; }
            return `<clipPath id="hp-zz-clip"><path d="${blob}"/></clipPath>` +
                `<path d="${blob}" fill="#ff9800" fill-opacity=".14">${fadeIn(0.34)}</path>` +
                `<g clip-path="url(#hp-zz-clip)">${stroke(zz, 0.4, 0.84, '#e65100', 1.5)}</g>` +
                stroke(blob, t0, t1, '#ff9800', 3) + cursor(frames);
        },

        // 💧 Déformation : le pinceau tord des lignes
        liquify() {
            let lines = '';
            const ys = [], N = 7;
            for (let i = 0; i < N; i++) ys.push(36 + 13 * i);
            ys.forEach(y => {
                const w = Math.exp(-Math.pow((y - 76) / 26, 2));
                const q = (dx, dy) => `M54,${y} Q${n2(120 + dx * w)},${n2(y + dy * w)} 186,${y}`;
                lines += `<path d="${q(0, 0)}" fill="none" stroke="#37474f" stroke-width="2" stroke-linecap="round">${anim('d', [[0, q(0, 0)], [0.14, q(0, 0)], [0.6, q(34, 40)], [0.9, q(34, 40)]])}</path>`;
            });
            const brush = '<circle r="17" fill="rgba(229,57,53,.13)" stroke="rgba(229,57,53,.75)" stroke-width="1.6"/>';
            return lines + `<g>${animT('translate', [[0, '98,52'], [0.14, '98,52'], [0.6, '138,102']])}${fadeIn(0.08)}${brush}</g>` +
                cursor([[0, 205, 128], [0.08, 98, 52], [0.14, 98, 52], [0.6, 138, 102], [0.9, 205, 128]]);
        },

        // 🧬 Interpolation : deux traits -> traits intermédiaires
        interp() {
            const A = ['40,50', '85,15', '150,85', '200,42'], B = ['40,112', '95,140', '150,70', '200,118'];
            const a = A.map(toPt), b = B.map(toPt);
            const sample = (c, t0, t1) => { const out = []; for (let k = 0; k <= 10; k++) { const p = bez(c[0], c[1], c[2], c[3], k / 10); out.push([t0 + (t1 - t0) * k / 10, p[0], p[1]]); } return out; };
            let mids = '';
            [1, 2, 3, 4].forEach((k, idx) => {
                const t = k / 5, c = a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
                mids += `<path d="${bezPath(c.map(p => n2(p[0]) + ',' + n2(p[1])))}" fill="none" stroke="#7e57c2" stroke-width="2" stroke-linecap="round">${fadeIn(0.58 + idx * 0.06)}</path>`;
            });
            const fr = [[0, 205, 128]].concat(sample(a, 0.06, 0.26), [[0.29, 40, 112]], sample(b, 0.32, 0.52), [[0.64, 205, 128]]);
            return stroke(bezPath(A), 0.06, 0.26, '#1565c0', 3) + stroke(bezPath(B), 0.32, 0.52, '#2e7d32', 3) + mids + cursor(fr);
        },

        // 🧱 Mur : zone interdite que le tracé contourne
        wall() {
            const cx = 120, cy = 84, R = 27, v = [];
            for (let k = 0; k < 6; k++) { const ang = (-90 + 60 * k) * Math.PI / 180; v.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]); }
            const poly = 'M' + v.map(p => n2(p[0]) + ',' + n2(p[1])).join(' L') + ' Z';
            const frames = [[0, 205, 128]]; const t0 = 0.08, t1 = 0.4;
            for (let k = 0; k <= 6; k++) { const p = v[k % 6]; frames.push([t0 + (t1 - t0) * k / 6, p[0], p[1]]); }
            frames.push([0.5, 40, 100], [0.9, 205, 128]);
            const route = 'M32,86 C64,86 84,34 120,34 C156,34 176,86 208,86';
            return `<path d="${poly}" fill="rgba(229,57,53,.28)" stroke="none">${fadeIn(0.42)}</path>` +
                stroke(poly, t0, t1, '#e53935', 3) +
                stroke(route, 0.5, 0.86, '#37474f', 2.2) +
                `<circle r="5" fill="#455a64" stroke="#fff" stroke-width="1.5">${fadeIn(0.5)}<animateMotion dur="${DUR}s" repeatCount="indefinite" path="${route}" keyPoints="0;0;1;1" keyTimes="0;0.5;0.86;1" calcMode="linear"/></circle>` +
                cursor(frames);
        }
    };

    // ========================================================================= Textes des outils
    const TOOLS = {
        select: {
            title: { fr: '🖐️ Sélection', en: '🖐️ Select' },
            fr: "Cliquez un calque pour le sélectionner. Glissez-le pour le déplacer, tirez un coin pour le redimensionner, utilisez la poignée ronde du haut pour le tourner. Glissez dans le vide pour déplacer la vue.",
            en: "Click a layer to select it. Drag it to move it, pull a corner to resize it, use the round handle on top to rotate it. Drag on empty space to pan the view."
        },
        pen: {
            title: { fr: '✏️ Crayon', en: '✏️ Pencil' },
            fr: "Maintenez et glissez sur la table pour dessiner à main levée. Chaque trait devient un calque, avec un lissage réglable.",
            en: "Press and drag on the table to draw freehand. Each stroke becomes a layer, with adjustable smoothing."
        },
        text: {
            title: { fr: '🔤 Texte', en: '🔤 Text' },
            fr: "Cliquez sur la table pour poser une rangée de cases, puis cliquez sur une case pour y écrire une lettre. Les lettres sont converties en tracé.",
            en: "Click on the table to place a row of boxes, then click a box to type a letter. Letters are turned into a path."
        },
        zigzag: {
            title: { fr: '〰️ Remplissage', en: '〰️ Fill' },
            fr: "Dessinez le contour d'une zone fermée (crayon, points ou détection auto) : elle est remplie automatiquement de lignes, de vagues ou d'un trajet TSP.",
            en: "Outline a closed area (pencil, points or auto-detect): it is filled automatically with lines, waves or a TSP path."
        },
        liquify: {
            title: { fr: '💧 Déformation', en: '💧 Warp' },
            fr: "Sélectionnez un tracé, puis passez le pinceau dessus en glissant : le tracé se déforme comme de la pâte à modeler.",
            en: "Select a path, then drag the brush over it: the path bends like clay."
        },
        interp: {
            title: { fr: '🧬 Interpolation', en: '🧬 Interpolation' },
            fr: "Dessinez deux traits : l'outil crée les traits intermédiaires qui passent progressivement de l'un à l'autre.",
            en: "Draw two strokes: the tool creates the in-between strokes that morph gradually from one to the other."
        },
        wall: {
            title: { fr: '🧱 Mur', en: '🧱 Wall' },
            fr: "Dessinez une zone interdite (en rouge) : les tracés ne pourront plus passer à l'intérieur.",
            en: "Draw a forbidden zone (in red): paths can no longer go inside it."
        }
    };

    // ========================================================================= Textes des paramètres
    // id = élément du réglage (le « i » se place à côté de son libellé) ; host = sélecteur explicite ;
    // sibling = placer le « i » juste après le libellé (au lieu de dedans).
    const PARAMS = [
        // Crayon
        // Import
        { id: 'ct-mode', fr: "Dessin au trait : on suit les lignes noires (centre du trait). Formes / photo : on détecte les bords des formes. Auto choisit selon l'épaisseur des traits.", en: "Line drawing: follows the black lines (centre of the stroke). Shapes / photo: detects the edges of shapes. Auto picks based on stroke thickness." },
        { id: 'ct-thr', fr: "Mode trait : tout ce qui est plus sombre que ce seuil devient du trait. Montez-le pour capter des traits plus clairs.", en: "Line mode: anything darker than this threshold becomes stroke. Raise it to catch lighter lines." },
        { id: 'ct-sens', fr: "Mode formes / photo : plus c'est haut, plus de bords (et de détails) sont détectés.", en: "Shapes / photo mode: the higher, the more edges (and details) are detected." },
        { id: 'ct-close', fr: "Épaissit les traits pour refermer les petits trous et relier les traits presque jointifs.", en: "Thickens strokes to close small gaps and join almost-touching lines." },
        { id: 'ct-spur', fr: "Supprime les petites branches qui dépassent d'un trait (poils, barbules). 0 = tout garder.", en: "Removes short branches sticking out of a line (hairs, burrs). 0 = keep everything." },
        { id: 'ct-min', fr: "Les éléments dont la longueur de trait est inférieure sont ignorés (poussières, bruit).", en: "Elements with a shorter stroke length are ignored (dust, noise)." },
        { id: 'ct-main', fr: "Garde l'objet le plus grand et ce qui l'entoure de près ; retire le reste (fond, éléments éloignés).", en: "Keeps the biggest object and what is close to it; removes the rest (background, distant elements)." },
        { id: 'ct-pick', fr: "Cliquez sur un élément de l'aperçu pour le retirer (il devient gris) ; recliquez pour le remettre.", en: "Click an element in the preview to remove it (it turns grey); click again to restore it." },
        { host: '#pen-mode-row', fr: "Mode de tracé. Libre : à main levée. Points : cliquez des points reliés par des lignes droites (double-clic ou Entrée pour terminer, clic sur le 1er point pour fermer).", en: "Drawing mode. Freehand: draw by hand. Points: click points joined by straight lines (double-click or Enter to finish, click the 1st point to close)." },
        { id: 'slider-width', fr: "Épaisseur d'affichage du trait à l'écran. N'influence pas le tracé envoyé à la machine.", en: "Display thickness of the line on screen. It does not affect the path sent to the machine." },
        { id: 'slider-tremor', fr: "Atténue les tremblements de la main : plus la valeur est haute, plus le trait suit le curseur avec douceur (et un peu de retard).", en: "Smooths out hand tremor: the higher the value, the more gently (and slightly later) the line follows the cursor." },
        { id: 'slider-rope', fr: "Longueur de la « corde » : le trait est tiré derrière le curseur comme au bout d'une corde, ce qui arrondit les angles. 0 = le trait suit exactement le curseur.", en: "Length of the “rope”: the line is dragged behind the cursor as if on a rope, which rounds the corners. 0 = the line follows the cursor exactly." },
        // Texte
        { id: 'text-c', fr: "Nombre de cases (donc de lettres) dans la rangée.", en: "Number of boxes (so of letters) in the row." },
        { id: 'text-w', fr: "Largeur d'une case.", en: "Width of one box." },
        { id: 'text-h', fr: "Hauteur d'une case, donc taille des lettres.", en: "Height of one box, i.e. the size of the letters." },
        { id: 'text-s', fr: "Espace entre deux cases.", en: "Gap between two boxes." },
        // Remplissage
        { host: '#zigzag-mode-row', fr: "Mode de tracé du contour. Crayon : à main levée. Points : cliquez des points reliés par des lignes droites, puis refermez sur le 1er point. Détection auto : cliquez sur une image de fond pour détecter la zone (visible seulement avec une image).", en: "How the outline is drawn. Pencil: freehand. Points: click points joined by straight lines, then close on the 1st point. Auto-detect: click a background image to detect the area (only shown when an image is present)." },
        { id: 'wand-tol', fr: "Sensibilité de la détection : plus elle est haute, plus la zone s'étend sur des couleurs proches de celle où vous cliquez.", en: "Detection sensitivity: the higher it is, the further the area spreads over colors close to the one you click." },
        { host: '#btn-zig-straight:parent', fr: "Style de remplissage. Droites : lignes en zigzag. Vagues : lignes ondulées. TSP : un seul trajet continu qui ne se croise jamais et dessine la zone avec le nombre de points choisi.", en: "Fill style. Straight: zigzag lines. Waves: wavy lines. TSP: one continuous path that never crosses itself and draws the area with the chosen number of points." },
        { id: 'zigzag-type', fr: "Direction des lignes. Angle fixe : lignes parallèles selon un angle. Suivre une courbe : les lignes épousent une courbe guide que vous dessinez. Spirale de contour : une spirale qui suit le contour.", en: "Direction of the lines. Fixed angle: parallel lines at an angle. Follow a curve: the lines follow a guide curve you draw. Contour spiral: a spiral that follows the outline." },
        { id: 'spiral-dir', fr: "Sens de parcours de la spirale : de l'extérieur vers le centre, ou du centre vers l'extérieur.", en: "Direction of the spiral: from the outside toward the center, or from the center outward." },
        { id: 'zigzag-angle', sibling: true, fr: "Angle des lignes de remplissage, en degrés (pour la spirale : rotation du point de départ).", en: "Angle of the fill lines, in degrees (for the spiral: rotation of the starting point)." },
        { id: 'zigzag-spacing', fr: "Écart entre deux lignes de remplissage : plus petit = remplissage plus dense.", en: "Distance between two fill lines: smaller = denser fill." },
        { id: 'wave-amp', fr: "Hauteur (amplitude) des vagues.", en: "Height (amplitude) of the waves." },
        { id: 'wave-len', fr: "Longueur d'une vague, d'un creux au suivant.", en: "Length of one wave, from one trough to the next." },
        { host: '#btn-tsp-pick-start:parent', fr: "Départ / Arrivée : choisissez où le trajet TSP commence et se termine en cliquant sur la table. Le bouton ✕ efface les deux points.", en: "Start / End: choose where the TSP path begins and ends by clicking on the table. The ✕ button clears both points." },
        { id: 'tsp-res', fr: "Nombre de points du trajet TSP : plus il est élevé, plus le détail est fin (mais plus le calcul est long).", en: "Number of points in the TSP path: the higher it is, the finer the detail (but the longer the computation)." },
        // Déformation
        { id: 'liq-radius', fr: "Taille de la zone déformée par le pinceau.", en: "Size of the area warped by the brush." },
        { id: 'liq-str', fr: "Intensité avec laquelle le pinceau déplace le tracé.", en: "How strongly the brush pushes the path." },
        // Interpolation
        { id: 'interp-steps', fr: "Nombre de traits intermédiaires générés entre les deux traits dessinés.", en: "Number of in-between strokes generated between the two drawn strokes." },
        { id: 'chk-interp-roundtrip', fr: "Relie les traits en aller-retour (un trait, puis le suivant parcouru en sens inverse) pour obtenir un seul tracé continu.", en: "Joins the strokes back and forth (one stroke, then the next traversed in reverse) to get a single continuous path." },
        // Conversion image -> TSP
        { id: 'tc-res', fr: "Résolution de travail de la conversion : plus haute = plus précis mais plus lent.", en: "Working resolution of the conversion: higher = more precise but slower." },
        { id: 'tc-contrast', fr: "Accentue le contraste de l'image avant conversion pour mieux séparer le sombre du clair.", en: "Boosts the image contrast before conversion to better separate dark from light." },
        { id: 'tc-white', fr: "Les pixels plus clairs que cette valeur sont considérés comme du fond et ignorés. Le bouton « Seuil auto » calcule une valeur adaptée (méthode d'Otsu).", en: "Pixels lighter than this value are treated as background and ignored. The “Auto threshold” button computes a suitable value (Otsu method)." },
        { id: 'tc-points', fr: "Nombre de points du tracé généré à partir de l'image : plus il y en a, plus le dessin est détaillé.", en: "Number of points in the path generated from the image: the more points, the more detailed the drawing." },
        // Transformation
        { id: 'chk-lock-aspect', fr: "Garde le rapport largeur / hauteur lors du redimensionnement, sans avoir à maintenir SHIFT.", en: "Keeps the width / height ratio when resizing, without having to hold SHIFT." },
        { host: '#lbl-mirror', fr: "Retourne la sélection horizontalement ou verticalement.", en: "Flips the selection horizontally or vertically." },
        { id: 'img-rot', fr: "Rotation précise du calque sélectionné, en degrés.", en: "Precise rotation of the selected layer, in degrees." },
        { id: 'img-opacity', fr: "Transparence de l'image : 0 = invisible, 100 = opaque.", en: "Image transparency: 0 = invisible, 100 = opaque." },
        // Fichier
        { id: 'zoom-workspace', fr: "Zoom de l'affichage du canevas. N'a aucun effet sur le tracé exporté.", en: "Zoom of the canvas display. It has no effect on the exported path." },
        { id: 'chk-sim-points', fr: "Affiche le point de départ (vert) et le point d'arrivée (rouge) du tracé complet.", en: "Shows the start point (green) and end point (red) of the whole path." },
        { id: 'chk-show-links', fr: "Affiche les lignes pointillées qui relient la fin d'un calque au début du suivant.", en: "Shows the dotted lines that join the end of one layer to the start of the next." },
        { id: 'render-mode', fr: "Traits : affichage normal de l'éditeur. Sable : simulation du rendu final d'une bille dans le sable.", en: "Lines: normal editor display. Sand: simulation of the final result of a ball in the sand." },
        { id: 'sand-diameter', fr: "Diamètre de la zone de sable de la vraie table, en millimètres.", en: "Diameter of the sand area of the real table, in millimeters." },
        { id: 'sand-quality', fr: "Qualité de la simulation : plus fine = plus réaliste mais plus lente.", en: "Simulation quality: finer = more realistic but slower." },
        // Calques et simulateur
        { id: 'multi-select-mode', fr: "Permet de sélectionner plusieurs calques à la fois (pour les grouper, les fusionner ou les déplacer ensemble).", en: "Lets you select several layers at once (to group, merge or move them together)." },
        { id: 'chk-highlight-sel', fr: "Entoure d'un halo le calque sélectionné sur la table.", en: "Draws a halo around the selected layer on the table." },
        { id: 'slider-sim', fr: "Fait avancer la bille le long du tracé complet pour prévisualiser son parcours.", en: "Moves the ball along the whole path to preview its route." }
    ];

    // Aides avec média (GIF) : « i » à côté de l'export THR
    const MEDIA = [{
        host: '#export-i-host', gif: 'media/export_thr.gif',
        title: { fr: '📲 Importer le .thr dans l\'app Sunae', en: '📲 Import the .thr in the Sunae app' },
        fr: "Après l'export : dans l'app Sunae, Dessins → « + » → Centre de téléchargement → icône dossier → choisissez le fichier .thr dans Téléchargements. Le dessin s'importe puis apparaît dans Dessins.",
        en: "After exporting: in the Sunae app, Drawings → “+” → Download center → folder icon → pick the .thr file in Downloads. The drawing imports and then appears in Drawings."
    }];

    // ========================================================================= Placement des « i »
    function makeIcon(kind, key) {
        const s = document.createElement('span');
        s.className = 'info-i i18n-skip' + (kind === 'tool' ? ' tool-i' : '');
        s.textContent = 'i';
        s.tabIndex = 0; s.setAttribute('role', 'button');
        s.dataset.kind = kind; s.dataset.key = key;
        s.setAttribute('translate', 'no');
        return s;
    }

    function resolveHost(p) {
        if (p.host) {
            const parent = /:parent$/.test(p.host);
            const el = document.querySelector(p.host.replace(/:parent$/, ''));
            return el ? (parent ? el.parentElement : el) : null;
        }
        const el = document.getElementById(p.id); if (!el) return null;
        if (el.type === 'checkbox') return el.closest('label');
        const row = el.closest('.row-slider');
        if (row) { const prev = row.previousElementSibling; return prev ? (prev.querySelector('label') || prev) : null; }
        const r = el.closest('.row'); return r ? (r.querySelector('label') || r) : null;
    }

    function install() {
        // Outils
        document.querySelectorAll('input[name="tool"]').forEach(radio => {
            const label = radio.closest('label'); const key = radio.value;
            if (label && TOOLS[key] && !label.querySelector('.info-i')) label.appendChild(makeIcon('tool', key));
        });
        MEDIA.forEach((m, i) => {
            const host = document.querySelector(m.host); if (!host || host.querySelector('.info-i')) return;
            host.appendChild(makeIcon('media', String(i)));
        });
        // Paramètres
        PARAMS.forEach((p, i) => {
            const host = resolveHost(p); if (!host) return;
            const icon = makeIcon('param', String(i));
            if (p.sibling) { icon.classList.add('after-label'); host.insertAdjacentElement('afterend', icon); }
            else host.appendChild(icon);
        });
    }

    // ========================================================================= Bulle
    let pop = null, activeIcon = null, pinned = false, showT = null, hideT = null;

    function buildPop() {
        const css = document.createElement('style');
        css.textContent =
            '.info-i{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:5px;border-radius:50%;background:#e3f2fd;color:#0078D7;border:1px solid #90caf9;font:italic bold 10px/1 Georgia,"Times New Roman",serif;cursor:help;user-select:none;-webkit-user-select:none;flex-shrink:0;vertical-align:middle;box-sizing:border-box;transition:background .12s,color .12s}' +
            '.info-i:hover,.info-i:focus-visible,.info-i.active{background:#0078D7;color:#fff;outline:none}' +
            '.info-i.tool-i{margin-left:auto}.info-i.after-label{margin-right:auto}' +
            '#help-pop{position:fixed;z-index:10000;display:none;width:270px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #b8c4d0;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:10px;font-size:12.5px;line-height:1.4;color:#333}' +
            '#help-pop.hp-text-only{width:240px}' +
            '#help-pop .hp-title{font-weight:bold;font-size:13.5px;margin-bottom:6px;color:#0b3d6e}' +
            '#help-pop .hp-demo svg{display:block;width:100%;height:auto;border-radius:8px;border:1px solid #e0d8c3}' +
            '#help-pop .hp-demo{margin-bottom:8px}';
        document.head.appendChild(css);
        pop = document.createElement('div'); pop.id = 'help-pop'; pop.className = 'i18n-skip'; pop.setAttribute('role', 'tooltip');
        pop.addEventListener('mouseenter', () => clearTimeout(hideT));
        pop.addEventListener('mouseleave', () => { if (!pinned) hideT = setTimeout(close, 200); });
        document.body.appendChild(pop);
    }

    function fill(icon) {
        const L = lang(); const kind = icon.dataset.kind, key = icon.dataset.key;
        if (kind === 'tool') {
            const d = TOOLS[key];
            pop.classList.remove('hp-text-only');
            pop.innerHTML = `<div class="hp-title">${d.title[L]}</div><div class="hp-demo">${svg(DEMOS[key]())}</div><div>${d[L]}</div>`;
        } else if (kind === 'media') {
            const m = MEDIA[+key];
            pop.classList.remove('hp-text-only');
            pop.innerHTML = `<div class="hp-title">${m.title[L]}</div><div class="hp-demo" style="text-align:center"><img src="${m.gif}" alt="" style="display:block;margin:0 auto;max-width:100%;max-height:55vh;width:auto;height:auto;border-radius:8px;border:1px solid #e0d8c3"></div><div>${m[L]}</div>`;
            const im = pop.querySelector('img'); if (im) im.addEventListener('load', () => position(icon));
        } else {
            const p = PARAMS[+key];
            pop.classList.add('hp-text-only');
            pop.innerHTML = `<div>${p[L]}</div>`;
        }
        icon.setAttribute('aria-label', L === 'en' ? 'Help' : 'Aide');
    }

    function position(icon) {
        const r = icon.getBoundingClientRect(); const pw = pop.offsetWidth, ph = pop.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight, m = 8;
        // Icône dans le panneau de droite : la bulle se place à gauche du panneau (sur le canevas) pour ne pas
        // masquer les libellés. Sinon, à droite de l'icône (ou à gauche s'il n'y a pas la place).
        const panel = icon.closest('#right-panel');
        let left = panel ? panel.getBoundingClientRect().left - pw - 10 : r.right + 10;
        if (!panel && left + pw > vw - m) left = r.left - pw - 10;
        left = Math.max(m, Math.min(left, vw - pw - m));
        let top = r.top + r.height / 2 - ph / 2;
        top = Math.max(m, Math.min(top, vh - ph - m));
        pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }

    function open(icon, pin) {
        clearTimeout(hideT); clearTimeout(showT);
        if (activeIcon === icon && pop.style.display === 'block') { if (pin) pinned = true; return; }
        if (activeIcon) activeIcon.classList.remove('active');
        activeIcon = icon; icon.classList.add('active'); pinned = !!pin;
        fill(icon); pop.style.display = 'block'; position(icon);
    }

    function close() {
        clearTimeout(hideT); clearTimeout(showT);
        if (!pop) return;
        pop.style.display = 'none'; pop.innerHTML = '';   // vider arrête l'animation (elle repart de 0 à la prochaine ouverture)
        if (activeIcon) activeIcon.classList.remove('active');
        activeIcon = null; pinned = false;
    }

    const canHover = () => !(window.matchMedia && window.matchMedia('(hover: none)').matches);
    const iconOf = t => (t && t.closest) ? t.closest('.info-i') : null;

    function bindEvents() {
        document.addEventListener('mouseover', e => {
            const ic = iconOf(e.target);
            if (ic && canHover()) { clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(() => open(ic, false), 120); }
        });
        document.addEventListener('mouseout', e => {
            const ic = iconOf(e.target); if (!ic) return;
            const to = e.relatedTarget;
            if (to && (ic.contains(to) || (pop && pop.contains(to)))) return;
            clearTimeout(showT);
            if (!pinned) hideT = setTimeout(close, 220);
        });
        document.addEventListener('click', e => {
            const ic = iconOf(e.target);
            if (ic) {
                // Le « i » est dans un <label> : on empêche d'activer la case / l'outil associé.
                e.preventDefault(); e.stopPropagation();
                if (activeIcon === ic && pinned) close(); else open(ic, true);
            } else if (pop && pinned && !pop.contains(e.target)) close();
        }, true);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
            else if ((e.key === 'Enter' || e.key === ' ') && iconOf(document.activeElement)) { e.preventDefault(); document.activeElement.click(); }
        });
        window.addEventListener('resize', close);
        document.addEventListener('scroll', close, true);
        if (window.I18N) window.I18N.onChange(() => {
            document.querySelectorAll('.info-i').forEach(i => i.setAttribute('aria-label', lang() === 'en' ? 'Help' : 'Aide'));
            if (activeIcon && pop.style.display === 'block') { const ic = activeIcon; fill(ic); position(ic); }
        });
    }

    function init() {
        buildPop(); install(); bindEvents();
        document.querySelectorAll('.info-i').forEach(i => i.setAttribute('aria-label', lang() === 'en' ? 'Help' : 'Aide'));
    }

    window.THRHelp = { _demos: DEMOS, _tools: TOOLS, _params: PARAMS, open: (el, pin) => open(el, pin), close: close };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
