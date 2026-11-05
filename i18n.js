/* ============================================================================
   i18n.js — Interface bilingue FR / EN (v6.7)

   Principe : l'interface est écrite en français dans index.html (source de vérité).
   Quand la langue active est l'anglais, chaque texte français est remplacé à l'affichage
   par sa traduction (dictionnaire EN ci-dessous). Cela couvre :
     - le HTML statique (libellés, boutons, options de listes, attributs title),
     - les textes écrits dynamiquement par le code (aide contextuelle, messages d'état,
       noms de calques par défaut…) grâce à un MutationObserver,
     - les boîtes de dialogue alert() / confirm() / prompt().
   Repasser en français restaure les textes d'origine. Les données du projet (noms de
   calques, fichiers .sunae) ne sont jamais modifiées : la traduction est purement visuelle.

   Langue au démarrage : choix mémorisé > langue du navigateur (français => FR, sinon EN).
   ============================================================================ */
(function () {
    'use strict';

    // ------------------------------------------------------------------ Dictionnaire FR -> EN
    const EN = {
        // Barre du haut / onglets
        '▶ Cacher': '▶ Hide', '◀ Afficher': '◀ Show',
        '📁 Fichier': '📁 File', '🖌️ Outils': '🖌️ Tools', '📑 Calques': '📑 Layers',   // « 📐 Transf. » reste identique (abréviation valable en anglais)

        // Onglet Fichier
        '💾 Fichier & Projet': '💾 File & Project', 'Nom :': 'Name:',
        '📂 Ouvrir': '📂 Open', '🗑️ Nouveau': '🗑️ New', '💾 Enregistrer': '💾 Save', '📝 Sous...': '📝 Save as...',
        '✓ Auto-sauvegarde active': '✓ Auto-save on', '… Sauvegarde en cours': '… Saving',
        '✓ Sauvegardé (images omises, espace limité)': '✓ Saved (images omitted, limited space)',
        '⚠️ Erreur — pensez à 💾 Enregistrer manuellement': '⚠️ Error — remember to 💾 Save manually',
        '🖥️ Espace de travail': '🖥️ Workspace', 'Forme :': 'Shape:', 'Table Ronde': 'Round table',
        '🔍 Zoom du Canevas :': '🔍 Canvas zoom:',
        '🟢/🔴 Points globaux (Simulation)': '🟢/🔴 Global points (Simulation)',
        '🔗 Lignes de liaison inter-calques': '🔗 Links between layers',
        '🏖️ Aperçu du rendu': '🏖️ Render preview', 'Affichage :': 'Display:',
        '✏️ Traits': '✏️ Lines', '🏖️ Sable (simulation)': '🏖️ Sand (simulation)',
        'Ø zone de sable (mm) :': 'Sand area Ø (mm):', 'Qualité :': 'Quality:',
        'Rapide': 'Fast', 'Normale': 'Normal', 'Fine (plus lent)': 'Fine (slower)',
        '▶ Simuler le sable': '▶ Simulate sand', '✕ Annuler': '✕ Cancel',
        "Mode Traits : affichage normal de l'éditeur.": 'Lines mode: normal editor display.',
        '📤 Exporter vers Machine (.thr)': '📤 Export to Machine (.thr)',
        "Le dessin a changé : l'aperçu sable est obsolète. Re-sélectionne « Sable » pour relancer.": 'The drawing has changed: the sand preview is outdated. Re-select “Sand” to restart.',
        'Réglages modifiés : clique sur « Simuler le sable ».': 'Settings changed: click “Simulate sand”.',
        'Simulation annulée.': 'Simulation cancelled.',
        '✓ Simulation terminée. Repasse en « Traits » pour modifier le dessin.': '✓ Simulation complete. Switch back to “Lines” to edit the drawing.',
        'Aucun tracé à simuler !': 'No path to simulate!',

        // Onglet Outils
        '🛠️ Outils Actifs': '🛠️ Active Tools',
        '🖐️ Sélection (Transformer & Vue)': '🖐️ Select (Transform & View)',
        '✏️ Crayon (Dessin continu)': '✏️ Pencil (Freehand drawing)',
        '🔤 Texte (Cases & Lettres)': '🔤 Text (Boxes & Letters)',
        '〰️ Remplissage (Zones)': '〰️ Fill (Areas)',
        '💧 Déformation (Relief)': '💧 Warp (Relief)',
        '🧬 Interpolation (Morphing)': '🧬 Interpolation (Morphing)',
        '🧱 Mur (Exclusion)': '🧱 Wall (Exclusion)',
        '🎨 Couleur du trait': '🎨 Line color',

        '🖌️ Paramètres Crayon': '🖌️ Pencil Settings',
        '📏 Épaisseur du trait :': '📏 Line width:',
        '🫨 Lissage Anti-tremblement :': '🫨 Anti-tremor smoothing:',
        '〰️ Lissage (Corde) :': '〰️ Smoothing (Rope):',

        '🔤 Paramètres Texte': '🔤 Text Settings',
        '1. Cliquez sur la table pour placer les cases.': '1. Click on the table to place the boxes.',
        '2. Cliquez sur une case pour y écrire.': '2. Click a box to type in it.',
        '🔢 Nombre de cases :': '🔢 Number of boxes:',
        '↔️ Largeur case :': '↔️ Box width:', '↕️ Hauteur case :': '↕️ Box height:',
        '📏 Espacement :': '📏 Spacing:',
        'Entrez une lettre (Laissez vide pour effacer) :': 'Enter a letter (leave empty to erase):',

        '〰️ Paramètres Remplissage': '〰️ Fill Settings',
        'Dessinez une forme fermée ou utilisez la baguette magique.': 'Draw a closed shape or use the magic wand.',
        'Dessinez une forme fermée à main levée, ou choisissez Points / Détection auto.': 'Draw a closed shape freehand, or choose Points / Auto-detect.',
        'Cliquez pour placer des points reliés par des lignes droites. Fermez en recliquant sur le 1er point (ou double-clic / Entrée).': 'Click to place points joined by straight lines. Close by clicking the 1st point again (or double-click / Enter).',
        'Cliquez sur une image de fond pour générer un remplissage.': 'Click a background image to generate a fill.',
        '✏️ Crayon': '✏️ Pencil', '🪄 Détection auto': '🪄 Auto-detect',
        '🎨 Composer': '🎨 Compose', "Composer : à partir d'une image noir et blanc simple, détecte les zones et propose un remplissage pour chacune": 'Compose: from a simple black-and-white image, detects the zones and suggests a fill for each',
        'Importez une image simple en noir et blanc (type coloriage), puis analysez-la.': 'Import a simple black-and-white image (colouring-page style), then analyse it.',
        '◐ Seuil noir / blanc :': '◐ Black / white threshold:', '🔗 Fermer les petits trous :': '🔗 Close small gaps:', '📏 Taille mini des zones :': '📏 Minimum zone size:',
        ' Ignorer le fond (zones touchant le bord)': ' Ignore background (zones touching the edge)', "🔍 Analyser l'image": '🔍 Analyse image',
        '🎨 Style :': '🎨 Style:', 'Auto (proposé)': 'Auto (suggested)', '〰️ Lignes parallèles': '〰️ Parallel lines', '🌀 Spirale / concentrique': '🌀 Spiral / concentric',
        '✳️ Hachures croisées': '✳️ Cross-hatching', '🎯 Points TSP': '🎯 TSP points', '✏️ Contour seul': '✏️ Outline only', '🚫 Ignorer': '🚫 Ignore',
        '📐 Angle des lignes :': '📐 Line angle:', ' Angle automatique (sens de la forme)': ' Automatic angle (along the shape)',
        'Style de toutes les zones :': 'Style of all zones:', '〰️ Lignes': '〰️ Lines', '🌀 Spirale': '🌀 Spiral', '🚫 Tout ignorer': '🚫 Ignore all',
        '✨ Générer les calques': '✨ Generate layers',
        "Composer : analysez une image noir et blanc simple, choisissez le style de chaque zone, puis générez les calques.": 'Compose: analyse a simple black-and-white image, pick each zone\'s style, then generate the layers.',
        "Zones détectées. Cliquez une zone pour changer son style, Maj+clic pour l'ignorer.": 'Zones detected. Click a zone to change its style, Shift+click to ignore it.',
        'Aucune zone fermée trouvée : ajustez le seuil ou « Fermer les petits trous ».': 'No closed zone found: adjust the threshold or “Close small gaps”.',
        "⚠️ Beaucoup de zones sont plus fines que la bille (Ø12 mm) : agrandissez l'image sur la table ou augmentez la taille mini des zones.": '⚠️ Many zones are thinner than the ball (Ø12 mm): enlarge the image on the table or raise the minimum zone size.',
        '↔️ Marge le long des traits :': '↔️ Margin along the lines:',
        'zones': 'zones', 'à remplir': 'to fill', 'Zone': 'Zone', 'style proposé': 'suggested style',
        'Calques générés dans le dossier « Composition » : ': 'Layers generated in the “Composition” folder: ', "liaisons tracées à l'intérieur du dessin": 'links drawn inside the drawing',
        '✅ Fermer la forme': '✅ Close shape', '↩️ Dernier point': '↩️ Last point', '✖️ Annuler': '✖️ Cancel',
        '🎚️ Sensibilité :': '🎚️ Sensitivity:',
        '〰️ Droites': '〰️ Straight', '🌊 Vagues': '🌊 Waves',
        'Orientation :': 'Orientation:', 'Angle Fixe': 'Fixed angle', 'Suivre une Courbe': 'Follow a curve', 'Spirale de Contour': 'Contour spiral',
        'Sens Spirale :': 'Spiral direction:', 'Extérieur ➡️ Centre': 'Outside ➡️ Center', 'Centre ➡️ Extérieur': 'Center ➡️ Outside',
        '🔄 Angle :': '🔄 Angle:', '🔄 Rotation départ :': '🔄 Start rotation:',
        '✏️ Dessiner la courbe guide': '✏️ Draw the guide curve',
        'Tracez la courbe sur la table...': 'Draw the curve on the table...',
        '2. Tracez maintenant la courbe au centre.': '2. Now draw the curve in the center.',
        '↕️ Hauteur Vague :': '↕️ Wave height:', '↔️ Longueur Vague :': '↔️ Wave length:',
        'Le remplissage recalcule automatiquement quelques instants après avoir relâché un curseur.': 'The fill recalculates automatically a moment after you release a slider.',
        '⏳ Calcul du remplissage…': '⏳ Computing fill…',
        '📍 Départ': '📍 Start', '🏁 Arrivée': '🏁 End',
        "🎯 Cliquez sur la table pour placer le point. Vous pouvez changer d'outil entre-temps sans perdre la visée : elle reste active jusqu'à ce que vous cliquiez sur la table (ou appuyiez à nouveau sur ce bouton pour annuler).": '🎯 Click on the table to place the point. You can switch tools in the meantime without losing the aim: it stays active until you click on the table (or press this button again to cancel).',
        "💡 Le trajet ne se croise jamais lui-même. Si la forme comporte des zones vraiment séparées (ex. plusieurs traits disjoints), un pont en ligne droite reste nécessaire pour les relier — c'est inévitable, mais il part et arrive toujours près d'un bord plutôt que du milieu d'une forme.": '💡 The path never crosses itself. If the shape has truly separate areas (e.g. several disjoint strokes), a straight bridge is still needed to join them — this is unavoidable, but it always starts and ends near an edge rather than in the middle of a shape.',
        '🔬 Résolution (nb. points) :': '🔬 Resolution (no. of points):',
        '⚠️ Aucun point généré — la forme est peut-être trop petite, ou mal fermée.': '⚠️ No points generated — the shape may be too small or not properly closed.',
        "✏️ Tracez la courbe guide sur la table — vous pouvez changer d'outil sans perdre ce tracé en attente": '✏️ Draw the guide curve on the table — you can switch tools without losing this pending stroke',
        "📍 Cliquez pour placer le Départ — reste en attente si vous changez d'outil": '📍 Click to place the Start — stays pending if you switch tools',
        "🏁 Cliquez pour placer l'Arrivée — reste en attente si vous changez d'outil": '🏁 Click to place the End — stays pending if you switch tools',

        '💧 Pinceau Déformation': '💧 Warp Brush',
        'Glissez sur la table pour tordre le tracé sélectionné. Le contour initial des zigzags est protégé.': 'Drag over the table to twist the selected path. The initial outline of zigzags is protected.',
        '🔴 Taille du pinceau :': '🔴 Brush size:', '💪 Force :': '💪 Strength:',

        '🧬 Paramètres Interpolation': '🧬 Interpolation Settings',
        '1. Dessinez le premier trait.': '1. Draw the first stroke.', '2. Dessinez le deuxième trait.': '2. Draw the second stroke.',
        '🔢 Nombre de traits :': '🔢 Number of strokes:', '🔄 Tracé Aller-Retour': '🔄 Round-trip path',

        // Onglet Transformations
        '📂 + Tracé (.thr)': '📂 + Path (.thr)',
        "🎯 Convertir l'image en tracé TSP": '🎯 Convert image to TSP path',
        'Positionnez et redimensionnez d\'abord l\'image avec l\'outil Sélection. Réglez les curseurs puis cliquez sur "Mettre à jour" pour voir le résultat sur le canevas (le panneau reste ouvert, ajustez autant de fois que besoin). Cliquez sur "Appliquer les changements" une fois satisfait.': 'First position and resize the image with the Select tool. Adjust the sliders then click "Update" to see the result on the canvas (the panel stays open, adjust as many times as needed). Click "Apply changes" once satisfied.',
        '🖥️ Résolution :': '🖥️ Resolution:', '◐ Contraste :': '◐ Contrast:',
        '⚪ Seuil de blanc (fond) :': '⚪ White threshold (background):', '⚫ Nombre de points :': '⚫ Number of points:',
        '🪄 Seuil auto': '🪄 Auto threshold', '🔄 Mettre à jour': '🔄 Update', '✅ Appliquer les changements': '✅ Apply changes',
        'Préparation…': 'Preparing…', "Préparation de l'image…": 'Preparing the image…',
        'Analyse (contraste, seuil de blanc)…': 'Analyzing (contrast, white threshold)…',
        'Placement des points, îlots séparés, trajet…': 'Placing points, separate islands, route…',
        'Mise en place sur le calque…': 'Placing on the layer…', 'Terminé !': 'Done!',
        'Aucun point détecté — essayez de monter le seuil de blanc ou le contraste.': 'No points detected — try raising the white threshold or the contrast.',
        '📐 Transformer la sélection': '📐 Transform the selection',
        '💡 Utilisez l\'outil "🖐️ Sélection" pour déplacer, tourner et redimensionner le calque': '💡 Use the "🖐️ Select" tool to move, rotate and resize the layer',
        'ou le groupe': 'or the group',
        "sur la table (poignées d'angle = redimensionner, glisser au-delà du centre = miroir).": 'on the table (corner handles = resize, drag past the center = mirror).',
        'Maintenez SHIFT ou CTRL pour conserver les proportions ou créer des angles stricts (15°).': 'Hold SHIFT or CTRL to keep proportions or create strict angles (15°).',
        '🔗 Conserver les proportions (sans SHIFT — pratique sur tablette)': '🔗 Keep proportions (without SHIFT — handy on tablet)',
        'Miroir Global :': 'Global mirror:', '↔️ Horiz.': '↔️ Horiz.', '↕️ Vert.': '↕️ Vert.',
        '🔄 Rotation précise :': '🔄 Precise rotation:', '🌗 Opacité :': '🌗 Opacity:',

        // Onglet Calques
        'Organisation :': 'Organization:', 'Choix multiple': 'Multi-select', '🌟 Halo de sélection': '🌟 Selection halo',
        '📁 Grouper': '📁 Group', '📂 Sortir': '📂 Ungroup',
        'Maintien long pour glisser-déposer (Drag&Drop)': 'Long-press to drag & drop',
        '🔒 Verr.': '🔒 Lock', '🔒 Verrouiller': '🔒 Lock', '🔓 Déverrouiller': '🔓 Unlock',
        '📑 Dupl.': '📑 Dupl.', '🔗 Fus.': '🔗 Merge', '🗑️ Sup.': '🗑️ Del.',
        'Nouveau nom :': 'New name:',
        '▶️ Simulateur de tracé (Bille) :': '▶️ Path simulator (Ball):',
        'v6.7 (Langues FR/EN · Infobulles « i »)': 'v6.7 (FR/EN languages · “i” help popups)',

        // Attributs title
        'Dessin à main levée': 'Freehand drawing',
        'Forme par points reliés par des lignes droites': 'Shape made of points joined by straight lines',
        "Détection automatique sur l'image de fond": 'Automatic detection on the background image',
        'Monter': 'Move up', 'Descendre': 'Move down',

        // Dialogues & erreurs
        "Placez au moins 3 points pour fermer une forme.": 'Place at least 3 points to close a shape.',
        'Veuillez sélectionner un calque déverrouillé pour le déformer.': 'Please select an unlocked layer to warp it.',
        "Le calque visé n'existe plus, la sélection du point a été annulée.": 'The targeted layer no longer exists, point selection was cancelled.',
        "Le calque visé n'existe plus, le tracé de la courbe guide a été annulé.": 'The targeted layer no longer exists, guide curve drawing was cancelled.',
        'Veuillez importer et afficher au moins une image de fond pour utiliser la détection automatique.': 'Please import and show at least one background image to use auto-detect.',
        'Aucune zone trouvée.': 'No area found.',
        "La zone sélectionnée est trop petite ou le bord n'a pas pu être tracé.": 'The selected area is too small or its edge could not be traced.',
        "Sélectionnez d'abord le calque de remplissage TSP à modifier.": 'First select the TSP fill layer to edit.',
        'Impossible de déplacer un dossier dans lui-même.': 'Cannot move a folder into itself.',
        'Veuillez sélectionner 1 seul calque pour le déplacer.': 'Please select a single layer to move it.',
        'Veuillez sélectionner au moins 2 tracés pour fusionner.': 'Please select at least 2 paths to merge.',
        'Ce fichier .thr semble vide ou invalide.': 'This .thr file seems empty or invalid.',
        "Impossible d'ouvrir ce fichier. Il est peut-être corrompu.": 'Unable to open this file. It may be corrupted.',
        'Aucun tracé à exporter !': 'No path to export!',
        'Entrez le nom du fichier :': 'Enter the file name:',
        "Sélectionnez d'abord un calque image.": 'First select an image layer.',
        "Le moteur TSP (tsp_core.js) n'est pas chargé.": 'The TSP engine (tsp_core.js) is not loaded.',
        'Erreur interne : panneau Auto-Trace introuvable dans la page.': 'Internal error: Auto-Trace panel not found in the page.',
        'Cliquez d\'abord sur "Mettre à jour" pour générer un aperçu.': 'First click "Update" to generate a preview.',
        'Forme :\n1: Table Ronde\n2: Rectangle (1200x500)': 'Shape:\n1: Round table\n2: Rectangle (1200x500)'
    };

    // Noms de calques par défaut (créés par l'application en français)
    const LAYER_WORDS = { 'Remplissage': 'Fill', 'Texte': 'Text', 'Interpolation': 'Interpolation', 'Dossier': 'Folder',
                          'Tracé': 'Path', 'Fusion': 'Merge', 'Image': 'Image', 'Mur': 'Wall' };

    // Messages contenant des valeurs variables
    const PATTERNS = [
        [/^(\S+\s)?(Remplissage|Texte|Interpolation|Dossier|Tracé|Fusion|Image|Mur) (\d+)( \(Copie\))?(\s[🔒🔓])?$/u,
            m => (m[1] || '') + LAYER_WORDS[m[2]] + ' ' + m[3] + (m[4] ? ' (Copy)' : '') + (m[5] || '')],
        [/^(.*) \(Copie\)$/su, m => m[1] + ' (Copy)'],
        [/^Impossible de lancer la simulation dans ce navigateur : (.*)$/su, m => 'Unable to start the simulation in this browser: ' + m[1]],
        [/^Simulation en cours… \((\d+) points\)$/u, m => 'Simulation in progress… (' + m[1] + ' points)'],
        [/^Erreur de simulation : (.*)$/su, m => 'Simulation error: ' + m[1].replace(/^inconnue$/, 'unknown')],
        [/^❌ Erreur : (.*) \(détails dans la console du navigateur, F12\)\.$/su, m => '❌ Error: ' + m[1] + ' (details in the browser console, F12).'],
        [/^Seuil suggéré : (\d+) \(méthode d'Otsu\)\.$/u, m => 'Suggested threshold: ' + m[1] + ' (Otsu method).'],
        [/^🔄 Aperçu mis à jour \((\d+) points\) — visible sur le canevas\. Ajustez les réglages si besoin, puis cliquez sur "Appliquer les changements" quand vous êtes satisfait\.$/u,
            m => '🔄 Preview updated (' + m[1] + ' points) — visible on the canvas. Adjust the settings if needed, then click "Apply changes" when you are satisfied.'],
        [/^⚠️ (\d+) point\(s\) semblent situés hors des limites physiques du plateau\. Le moteur pourrait forcer sur la mécanique\. Exporter quand même \?$/u,
            m => '⚠️ ' + m[1] + ' point(s) appear to be outside the physical limits of the table. The motor could strain the mechanics. Export anyway?']
    ];

    const FLAG = {
        fr: '<svg viewBox="0 0 30 20" width="24" height="16" aria-hidden="true"><rect width="10" height="20" fill="#0055A4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#EF4135"/><rect width="30" height="20" fill="none" stroke="rgba(0,0,0,.18)"/></svg>',
        en: '<svg viewBox="0 0 60 40" width="24" height="16" aria-hidden="true"><clipPath id="i18n-uk-clip"><path d="M30,20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z"/></clipPath><rect width="60" height="40" fill="#012169"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" stroke-width="8"/><path d="M0,0 L60,40 M60,0 L0,40" clip-path="url(#i18n-uk-clip)" stroke="#C8102E" stroke-width="5"/><path d="M30,0 v40 M0,20 h60" stroke="#fff" stroke-width="13"/><path d="M30,0 v40 M0,20 h60" stroke="#C8102E" stroke-width="8"/><rect width="60" height="40" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/></svg>'
    };
    const TITLE = { fr: 'Éditeur de Tracés Sunae', en: 'Sunae Path Editor' };

    // ------------------------------------------------------------------ Traduction d'une chaîne
    function tr(s) {
        if (typeof s !== 'string') return null;
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
        const core = m[2];
        if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return null;   // rien à traduire (nombres, icônes seules…)
        let out = Object.prototype.hasOwnProperty.call(EN, core) ? EN[core] : undefined;
        if (out === undefined) {
            for (let i = 0; i < PATTERNS.length; i++) {
                const mm = PATTERNS[i][0].exec(core);
                if (mm) { out = PATTERNS[i][1](mm); break; }
            }
        }
        return out === undefined ? null : m[1] + out + m[3];
    }

    let lang = 'fr';
    // Texte pour les dialogues : traduit seulement en mode anglais.
    function t(s) { if (lang !== 'en') return s; const r = tr(String(s)); return r === null ? s : r; }

    // ------------------------------------------------------------------ Parcours du DOM
    const origText = new WeakMap();   // nœud texte -> { fr, en }
    const ATTRS = ['title', 'placeholder'];

    function skipped(node) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return true;
        if (el.closest && el.closest('.i18n-skip, script, style, textarea')) return true;
        return false;
    }

    function translateTextNode(n) {
        if (lang !== 'en' || skipped(n)) return;
        const rec = origText.get(n);
        if (rec && n.nodeValue === rec.en) return;
        const out = tr(n.nodeValue);
        if (out !== null && out !== n.nodeValue) { origText.set(n, { fr: n.nodeValue, en: out }); n.nodeValue = out; }
    }

    function translateAttrs(el) {
        if (lang !== 'en' || skipped(el)) return;
        ATTRS.forEach(a => {
            const v = el.getAttribute(a); if (v === null) return;
            const kEn = 'data-i18n-en-' + a, kFr = 'data-i18n-fr-' + a;
            if (el.hasAttribute(kEn) && el.getAttribute(kEn) === v) return;   // déjà traduit
            const out = tr(v);
            if (out !== null && out !== v) { el.setAttribute(kFr, v); el.setAttribute(kEn, out); el.setAttribute(a, out); }
        });
    }

    function translateTree(root) {
        if (lang !== 'en' || !root) return;
        if (root.nodeType === 3) { translateTextNode(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 11) return;
        if (root.nodeType === 1) { if (skipped(root)) return; translateAttrs(root); }
        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) { if (n.nodeType === 3) translateTextNode(n); else translateAttrs(n); }
    }

    function restoreTree(root) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) {
                const rec = origText.get(n);
                if (rec) { if (n.nodeValue === rec.en) n.nodeValue = rec.fr; origText.delete(n); }
            } else {
                ATTRS.forEach(a => {
                    const kEn = 'data-i18n-en-' + a, kFr = 'data-i18n-fr-' + a;
                    if (n.hasAttribute(kEn)) {
                        if (n.getAttribute(a) === n.getAttribute(kEn)) n.setAttribute(a, n.getAttribute(kFr));
                        n.removeAttribute(kEn); n.removeAttribute(kFr);
                    }
                });
            }
        }
    }

    // Les écritures du code (innerText, innerHTML…) sont traduites dès leur insertion.
    // La réécriture par le traducteur déclenche un 2e passage qui ne trouve rien à faire (idempotent).
    const observer = new MutationObserver(records => {
        if (lang !== 'en') return;
        for (const r of records) {
            if (r.type === 'childList') r.addedNodes.forEach(translateTree);
            else if (r.type === 'characterData') translateTextNode(r.target);
            else if (r.type === 'attributes') translateAttrs(r.target);
        }
    });

    // ------------------------------------------------------------------ Dialogues
    ['alert', 'confirm', 'prompt'].forEach(fn => {
        const orig = window[fn] && window[fn].bind(window);
        if (!orig) return;
        window[fn] = function (msg, def) { return fn === 'prompt' ? orig(t(msg), def) : orig(t(msg)); };
    });

    // ------------------------------------------------------------------ Choix de la langue
    const STORE_KEY = 'thr-lang';
    function detect() {
        try { const s = localStorage.getItem(STORE_KEY); if (s === 'fr' || s === 'en') return s; } catch (e) {}
        const l = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
        return /^fr(\b|-|_)/i.test(l) ? 'fr' : 'en';
    }

    const listeners = [];
    function updateSwitch() {
        document.querySelectorAll('.lang-btn').forEach(b => {
            const on = b.dataset.lang === lang; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function setLang(next, persist) {
        if (next !== 'fr' && next !== 'en') return;
        const changed = next !== lang;
        lang = next;
        if (persist) { try { localStorage.setItem(STORE_KEY, lang); } catch (e) {} }
        document.documentElement.lang = lang;
        document.title = TITLE[lang];
        if (lang === 'en') translateTree(document.body); else restoreTree(document.body);
        updateSwitch();
        if (changed || persist === undefined) listeners.forEach(cb => { try { cb(lang); } catch (e) { console.error(e); } });
    }

    function buildSwitch() {
        const css = document.createElement('style');
        css.textContent = '.lang-switch{display:flex;gap:4px;flex:0 0 auto;align-items:center}' +
            '#undo-redo-bar .lang-btn{flex:0 0 auto;width:36px;height:32px;padding:0;display:flex;align-items:center;justify-content:center;border:2px solid transparent;border-radius:6px;background:#fff;opacity:.5;cursor:pointer;transition:opacity .15s,border-color .15s}' +
            '#undo-redo-bar .lang-btn:hover{opacity:.85}' +
            '#undo-redo-bar .lang-btn.active{opacity:1;border-color:#0078D7;box-shadow:0 0 0 2px rgba(0,120,215,.18)}';
        document.head.appendChild(css);
        const bar = document.getElementById('undo-redo-bar'); if (!bar) return;
        const box = document.createElement('div'); box.className = 'lang-switch i18n-skip';
        box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Langue / Language');
        ['fr', 'en'].forEach(code => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'lang-btn'; b.dataset.lang = code;
            b.title = code === 'fr' ? 'Français' : 'English'; b.setAttribute('aria-label', b.title); b.innerHTML = FLAG[code];
            b.addEventListener('click', () => setLang(code, true));
            box.appendChild(b);
        });
        bar.appendChild(box);
    }

    function init() {
        buildSwitch();
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        lang = 'fr';              // l'HTML source est en français
        setLang(detect());        // applique la langue détectée / mémorisée (sans mémoriser la détection)
    }

    window.I18N = {
        get lang() { return lang; },
        setLang: l => setLang(l, true),
        t: t,
        tr: tr,
        onChange: cb => { listeners.push(cb); },
        // Aide au contrôle qualité : liste des textes encore en français quand l'anglais est actif.
        _dictionarySize: () => Object.keys(EN).length
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
