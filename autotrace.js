/* ============================================================================
   AUTOTRACE.JS — Conversion Image -> Tracé TSP (Éditeur de Tracés Sunae, v6.0+)
   ----------------------------------------------------------------------------
   Plus de fenêtre pop-up : l'image est importée avec le bouton "+ Image"
   existant, positionnée/tournée/redimensionnée avec l'outil Sélection comme
   n'importe quel autre calque (les corrections v4.0 s'appliquent), puis un
   panneau apparaît dans l'onglet Transf. avec les réglages de conversion.

   Dépend de tsp_core.js (chargé avant ce fichier) et de l'objet global `app`.
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

    // Seuil d'Otsu : sépare automatiquement une distribution de gris bimodale (sujet/fond)
    // au point qui maximise la variance inter-classes — un point de départ nettement plus
    // fiable qu'une simple moyenne pour isoler le sujet du fond, y compris sur des images
    // avec un fond texturé (papier, filigrane léger).
    function otsuThreshold(gray) {
        const hist = new Array(256).fill(0);
        for (let i = 0; i < gray.length; i++) hist[clamp(Math.round(gray[i]), 0, 255)]++;
        const total = gray.length;
        let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
        let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
        for (let t = 0; t < 256; t++) {
            wB += hist[t]; if (wB === 0) continue;
            const wF = total - wB; if (wF === 0) break;
            sumB += t * hist[t];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
        }
        return threshold;
    }

    // Densité (0..1) à partir des pixels bruts de l'image : contraste, coupure dure du fond
    // (seuil de blanc — tout pixel plus clair devient EXACTEMENT 0, pas de résidu), et prise
    // en compte de la transparence (PNG) comme fond additionnel.
    function buildDensityFromImageData(imageData, w, h, opts) {
        const data = imageData.data;
        const gray = toGrayscale(data, w, h);
        const blurred = boxBlur(gray, w, h, opts.blurRadius);
        const density = new Float32Array(w * h);
        const contrastFactor = 1 + (opts.contrast - 50) / 50; // 50 = neutre, 100 = x2, 0 = x0
        const gamma = 2.2; // coupure marquée : réduit le bruit résiduel dans les tons moyens
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const alpha = data[idx * 4 + 3];
                if (alpha < 128) continue; // transparent = fond, densité 0
                let v = clamp((blurred[idx] - 128) * contrastFactor + 128, 0, 255);
                if (v >= opts.whiteCutoff) continue; // coupure DURE du fond, aucun résidu
                let d = clamp((opts.whiteCutoff - v) / opts.whiteCutoff, 0, 1);
                density[idx] = Math.pow(d, gamma);
            }
        }
        return density;
    }

    function nearestPointIndex(pts, target) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < pts.length; i++) { const dx = pts[i].x - target.x, dy = pts[i].y - target.y; const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = i; } }
        return best;
    }

    function yieldUI() { return new Promise(r => setTimeout(r, 0)); }

    // ----------------------------- UI inline (onglet Transf.) -----------------------------

    let tcEls = null, tcBusy = false, tcCancelRequested = false;

    function getTcEls() {
        if (tcEls) return tcEls;
        const els = {
            res: document.getElementById('tc-res'), valRes: document.getElementById('val-tc-res'),
            contrast: document.getElementById('tc-contrast'), valContrast: document.getElementById('val-tc-contrast'),
            white: document.getElementById('tc-white'), valWhite: document.getElementById('val-tc-white'),
            points: document.getElementById('tc-points'), valPoints: document.getElementById('val-tc-points'),
            progressWrap: document.getElementById('tc-progress-wrap'),
            progressFill: document.getElementById('tc-progress-fill'),
            progressLabel: document.getElementById('tc-progress-label'),
            msg: document.getElementById('tc-msg'),
        };
        if (!els.res) return null; // le DOM n'est pas encore prêt (script chargé avant le <body>)
        tcEls = els;
        return tcEls;
    }

    // Affiche en direct la valeur des curseurs pendant le glissement (le calcul, lui, ne se
    // lance qu'au clic sur "Appliquer"). Câblé une fois le DOM prêt, indépendamment de
    // l'ordre de chargement des scripts (autotrace.js est chargé avant le <body>).
    function wireLiveLabels() {
        const els = getTcEls();
        if (!els) return;
        const wire = (input, valEl, fmt) => input.addEventListener('input', () => { valEl.textContent = fmt(input.value); });
        wire(els.res, els.valRes, v => v + 'px');
        wire(els.contrast, els.valContrast, v => v);
        wire(els.white, els.valWhite, v => v);
        wire(els.points, els.valPoints, v => v);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireLiveLabels);
    else wireLiveLabels();

    function tcShowMsg(text, kind) {
        const els = getTcEls();
        els.msg.textContent = text;
        els.msg.style.display = 'block';
        els.msg.style.background = kind === 'err' ? '#ffebee' : '#e8f5e9';
        els.msg.style.color = kind === 'err' ? '#c62828' : '#2e7d32';
    }

    function tcSetProgress(pct, label) {
        const els = getTcEls();
        els.progressWrap.style.display = 'block';
        els.progressFill.style.width = clamp(pct, 0, 100) + '%';
        els.progressLabel.textContent = label;
    }

    function getSelectedImageLayer() {
        const app = window.app;
        if (!app || app.selectedIds.length !== 1) return null;
        const info = app.findLayer(app.selectedIds[0]);
        if (!info || info.layer.type !== 'image' || !info.layer.img) return null;
        return info.layer;
    }

    const AutoTrace = {};

    // Calcule et affiche un seuil de blanc suggéré (Otsu) sur l'image actuellement sélectionnée.
    AutoTrace.suggestWhiteCutoff = function () {
        const layer = getSelectedImageLayer();
        if (!layer) { alert("Sélectionnez d'abord un calque image."); return; }
        const img = layer.img;
        const s = 120;
        const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
        const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, s, s);
        const data = ctx.getImageData(0, 0, s, s).data;
        const gray = toGrayscale(data, s, s);
        const t = otsuThreshold(gray);
        // On se cale légèrement au-dessus du seuil d'Otsu (vers le blanc) pour ne pas mordre sur le sujet.
        const suggested = clamp(t + 15, 120, 254);
        const els = getTcEls();
        els.white.value = suggested; els.valWhite.textContent = suggested;
        tcShowMsg(`Seuil suggéré : ${suggested} (méthode d'Otsu).`, 'ok');
    };

    // Convertit l'image sélectionnée en tracé TSP, en respectant sa position/rotation/échelle
    // ACTUELLES (miroir compris — voir la note v6.4 plus bas sur l'échantillonnage des pixels).
    // "Mettre à jour" : (re)calcule le tracé et l'affiche directement sur le canevas principal,
    // SANS fermer/masquer le panneau de réglages — la sélection reste sur le calque image source,
    // pour que l'utilisateur puisse ajuster les curseurs et recalculer autant de fois qu'il veut.
    // Un calque d'aperçu unique est réutilisé (mis à jour en place) d'un appel à l'autre au lieu
    // d'en créer un nouveau à chaque fois.
    AutoTrace.updatePreview = async function () {
        if (tcBusy) return;
        const layer = getSelectedImageLayer();
        if (!layer) { alert("Sélectionnez d'abord un calque image."); return; }
        if (!window.TSPCore) { alert("Le moteur TSP (tsp_core.js) n'est pas chargé."); return; }
        const els = getTcEls();
        if (!els) { alert("Erreur interne : panneau Auto-Trace introuvable dans la page."); return; }

        tcBusy = true;
        try {
            const app = window.app;
            tcCancelRequested = false;
            els.msg.style.display = 'none';
            tcSetProgress(5, "Préparation de l'image…");
            await yieldUI();

            const resolution = parseInt(els.res.value);
            const contrast = parseInt(els.contrast.value);
            const whiteCutoff = parseInt(els.white.value);
            const pointCount = parseInt(els.points.value);

            const img = layer.img;
            // v6.4 : on respecte maintenant la transformation ACTUELLE de l'image (miroir et
            // échelle non-uniforme éventuelle) au moment même où on échantillonne les pixels,
            // au lieu de toujours partir de l'image brute non transformée. La rotation, elle,
            // est ré-appliquée sur le calque de résultat (mathématiquement équivalent et plus
            // simple), mais le miroir (signe de scaleX/scaleY) doit être appliqué AVANT
            // l'échantillonnage pour que l'aperçu corresponde exactement à ce qui est affiché.
            const scaleX = layer.scaleX !== undefined ? layer.scaleX : 1;
            const scaleY = layer.scaleY !== undefined ? layer.scaleY : 1;
            const dispW = img.width * Math.abs(scaleX), dispH = img.height * Math.abs(scaleY);
            const aspect = dispW / dispH;
            const w = aspect >= 1 ? resolution : Math.round(resolution * aspect);
            const h = aspect >= 1 ? Math.round(resolution / aspect) : resolution;
            const pxToScene = dispW / w; // unités de scène par pixel de travail (cohérent en x et y)

            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d');
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(scaleX < 0 ? -1 : 1, scaleY < 0 ? -1 : 1); // miroir, appliqué ici
            ctx.drawImage(img, -w / 2, -h / 2, w, h); // étiré pour remplir w×h (respecte une échelle non-uniforme)
            ctx.restore();
            const imageData = ctx.getImageData(0, 0, w, h);

            tcSetProgress(20, 'Analyse (contraste, seuil de blanc)…'); await yieldUI();
            const density = buildDensityFromImageData(imageData, w, h, { blurRadius: 1, contrast, whiteCutoff });

            tcSetProgress(35, 'Placement des points, îlots séparés, trajet…'); await yieldUI();
            // v6.4 : solveMultiIsland détecte les zones réellement disjointes (ex. les mèches
            // séparées d'une crinière) et les relie par plus-proche-EXTRÉMITÉ plutôt que par un
            // point quelconque — les ponts partent donc naturellement d'un bord plutôt que du
            // milieu d'une forme, et le départ/l'arrivée par défaut tombent aussi sur un bord
            // (point le plus excentré de son îlot), pas en plein centre.
            const solved = window.TSPCore.solveMultiIsland(density, w, h, pointCount, {});
            if (solved.length < 2) throw new Error('NO_POINTS');

            tcSetProgress(92, 'Mise en place sur le calque…'); await yieldUI();
            // Repère local DÉJÀ à l'échelle actuelle de l'image (miroir inclus, cf. plus haut) :
            // le calque de résultat n'a donc plus qu'à porter le signe ±1 (déjà "consommé" dans le
            // rendu du raster, donc scaleX/scaleY valent ±1 ici, jamais une magnitude différente de 1)
            // et la rotation, qui elle est ré-appliquée telle quelle.
            const scenePoints = solved.map(p => ({
                x: (p.x - w / 2) * pxToScene,
                y: (p.y - h / 2) * pxToScene,
            }));
            const outScaleX = scaleX < 0 ? -1 : 1, outScaleY = scaleY < 0 ? -1 : 1;

            tcSetProgress(100, 'Terminé !'); await yieldUI();

            app.saveState();
            // Réutilise le calque d'aperçu existant s'il y en a un (créé par un appel précédent),
            // sinon en crée un nouveau et retient son id sur le calque image source.
            let previewInfo = layer._autoTracePreviewId ? app.findLayer(layer._autoTracePreviewId) : null;
            if (previewInfo) {
                previewInfo.layer.originalPoints = scenePoints;
                previewInfo.layer.points = [...scenePoints];
                // Resynchronise aussi la position/rotation/miroir avec l'image source au cas où
                // elle a été retransformée depuis la dernière mise à jour.
                previewInfo.layer.x = layer.x; previewInfo.layer.y = layer.y; previewInfo.layer.rot = layer.rot || 0;
                previewInfo.layer.scaleX = outScaleX; previewInfo.layer.scaleY = outScaleY;
            } else {
                app.autoTraceCount = (app.autoTraceCount || 1);
                app.addLayer({
                    type: 'imported_path', name: `🎯 TSP ${app.autoTraceCount++}`,
                    originalPoints: scenePoints, points: [...scenePoints],
                    x: layer.x, y: layer.y, rot: layer.rot || 0,
                    scaleX: outScaleX, scaleY: outScaleY,
                    opacity: 1.0, color: app.ui ? app.ui.color : '#000000', width: 1.0,
                });
                layer._autoTracePreviewId = app.selectedIds[0]; // addLayer vient de le sélectionner
            }
            // Remet la sélection sur le calque IMAGE (pas l'aperçu) pour garder le panneau ouvert.
            app.selectedIds = [layer.id];
            if (typeof app.invalidateSim === 'function') app.invalidateSim();
            if (typeof app.refreshLayerList === 'function') app.refreshLayerList();
            if (typeof app.draw === 'function') app.draw();
            if (typeof app.autoSave === 'function') app.autoSave();

            tcShowMsg(`🔄 Aperçu mis à jour (${scenePoints.length} points) — visible sur le canevas. Ajustez les réglages si besoin, puis cliquez sur "Appliquer les changements" quand vous êtes satisfait.`, 'ok');
        } catch (err) {
            if (err && err.message === 'NO_POINTS') tcShowMsg('Aucun point détecté — essayez de monter le seuil de blanc ou le contraste.', 'err');
            else { console.error('[AutoTrace] erreur pendant la conversion :', err); tcShowMsg('❌ Erreur : ' + (err && err.message ? err.message : err) + ' (détails dans la console du navigateur, F12).', 'err'); }
        } finally {
            tcBusy = false;
            setTimeout(() => { const e = getTcEls(); if (e) e.progressWrap.style.display = 'none'; }, 600);
        }
    };

    // "Appliquer les changements" : termine la conversion — masque le calque image source (sans le
    // supprimer) et bascule la sélection sur le tracé final. Nécessite d'avoir cliqué au moins une
    // fois sur "Mettre à jour" pour qu'un aperçu existe.
    AutoTrace.finalizeConversion = function () {
        const app = window.app;
        const layer = getSelectedImageLayer();
        if (!layer) { alert("Sélectionnez d'abord un calque image."); return; }
        const previewInfo = layer._autoTracePreviewId ? app.findLayer(layer._autoTracePreviewId) : null;
        if (!previewInfo) { alert('Cliquez d\'abord sur "Mettre à jour" pour générer un aperçu.'); return; }

        app.saveState();
        layer.visible = false; // masque l'image source plutôt que de la supprimer (non destructif)
        app.selectedIds = [previewInfo.layer.id];
        if (typeof app.invalidateSim === 'function') app.invalidateSim();
        if (typeof app.refreshLayerList === 'function') app.refreshLayerList();
        if (typeof app.draw === 'function') app.draw();
        if (typeof app.autoSave === 'function') app.autoSave();
    };

    window.AutoTrace = AutoTrace;
})();
