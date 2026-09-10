# Éditeur de Tracés Sunae — Journal des modifications

## v6.1 — Correctif : débordement du remplissage TSP hors de la forme

Bug corrigé : le remplissage TSP (dans l'outil Remplissage, à côté de Droites/Vagues) débordait
largement hors de la forme dessinée, avec de longs traits parasites en zigzag partant visiter des
points isolés loin à l'extérieur — visible sur les captures fournies (masse dense au centre, entourée
d'un enchevêtrement de traits qui s'étendent bien au-delà du contour).

**Cause** : lors de la relaxation de Lloyd (l'étape qui répartit les points de façon régulière),
chaque pixel de la grille — y compris ceux HORS de la forme, à densité nulle — recevait un poids
plancher de +0.02 au lieu de 0. Sur une forme dont le rectangle englobant contient une grande zone
vide autour d'elle (courant pour une forme irrégulière ou étroite), cette masse de pixels extérieurs à
poids non-nul, cumulée sur toute la zone vide, suffisait à entraîner des points hors de la forme —
jusqu'à 12 % des points observés, certains dérivant à plus de 3 fois le rayon de la forme. Testé et
confirmé avant correction : sur une forme de 500 points, 63 se retrouvaient dehors, l'un à 168 unités
du centre pour un rayon de forme de 40-55.

**Correction** (`tsp_core.js`, donc effective pour Auto-Trace ET TSP Fill puisqu'ils partagent le même
moteur) :
- Suppression du plancher de poids — un pixel à densité strictement nulle n'a plus aucune influence.
  Vérifié : 0 point hors de la forme après correction sur le même test (contre 63 avant).
- Ajout d'un filet de sécurité supplémentaire (`TSPCore.clampToPolygon`) : tout point qui se
  retrouverait malgré tout hors du contour (cas limite résiduel sur des découpes très dentelées —
  mesuré à environ 1 % sur une forme en étoile très irrégulière, à une distance de l'ordre de 0,0001
  unité du bord, donc un simple arrondi) est replaqué sur le point le plus proche du contour. Câblé
  dans `generateTSPZigzagFill` (index.html) via la fonction `pointInPolygon` déjà utilisée ailleurs
  dans l'application, pour rester cohérent avec la façon dont le reste du logiciel teste
  l'appartenance à une forme.
- La résolution de rasterisation de la forme (utilisée pour convertir le contour en carte de densité)
  suit maintenant le nombre de points demandé (200 à 500 px de côté selon la densité choisie) au lieu
  d'être fixée à 260 — un remplissage plus dense obtient aussi une grille plus fine, pour rester fidèle
  aux découpes complexes.
- Seuil de blanc (Auto-Trace) pré-calculé automatiquement (méthode d'Otsu) dès l'import d'une image,
  plutôt que d'attendre un clic sur "🪄 Seuil auto" — la valeur par défaut était parfois trop permissive
  et laissait filtrer un fond légèrement texturé (filigrane, papier) sans que ce soit évident tant que
  le bouton n'avait pas été utilisé.

### Fichiers modifiés

- `tsp_core.js` — suppression du plancher de poids, ajout de `clampToPolygon`.
- `index.html` — filet de sécurité câblé dans `generateTSPZigzagFill`, résolution de rasterisation
  adaptative, seuil de blanc auto-calculé à l'import (version affichée : v6.1).
- `autotrace.js` — inchangé dans cette passe (déjà en bon état : panneau inline dans l'onglet Transf.,
  seuil d'Otsu, coupure dure du fond, pas de popup).

### Vérifications effectuées

Comme pour chaque correctif de ce projet, la correction a été testée indépendamment sous Node.js avant
d'être considérée acquise : reproduction du bug sur une forme synthétique (12,6 % de points dehors,
jusqu'à 168 unités de débordement), confirmation que la suppression du plancher ramène ce chiffre à 0,
puis re-test sur une forme en étoile très dentelée (cas plus difficile) pour vérifier le filet de
sécurité — les quelques points encore techniquement "dehors" après filet de sécurité se sont révélés
être à une distance de 0,0000 unité du contour (précision flottante au bord, pas un vrai débordement).

---

## v5.0 — Auto-Trace revu en profondeur : approche TSP-art (finitecurve), + outil TSP Fill

Changement majeur suite à un test réel (image de poule au trait, avec cadre décoratif) qui a montré
deux défauts sérieux de l'approche précédente (v4.1.x, inspirée des contours façon SandTrace) :
un fouillis de zigzags sur les zones de dessin dense, et de longs traits parasites traversant le
dessin pour relier des zones séparées. Les deux causes ont été confirmées par analyse directe des
fichiers `.thr` fournis (comparaison point par point avec la sortie SandTrace correspondante) avant
toute décision de correctif — voir le détail plus bas.

**Décision : abandon de l'approche "contours/squelette" au profit d'un moteur TSP-art**, comme
[finitecurve.com](https://www.finitecurve.com/) : un semis de points pondéré par l'obscurité de
l'image (stippling), relié par UNE SEULE tournée optimisée. Par construction, il n'existe plus de
"fragments séparés à recoller" — donc plus de traits parasites — et plus de notion de "contour d'un
trait fin" à tracer deux fois — donc plus de zigzags.

### Pourquoi l'ancienne approche ne pouvait pas bien fonctionner sur ce type d'image

- **Le fouillis de zigzags** : la détection par seuil + marching-squares trace le CONTOUR de chaque
  trait d'encre (les deux bords d'un trait fin), au lieu de sa ligne centrale. Sur un motif dense
  (les plumes en forme de labyrinthe de l'image test), ces doubles-contours quasi parallèles se
  simplifient en zigzags chaotiques. Confirmé en zoomant sur le fichier `.thr` fourni : le contour
  extérieur de la crête est propre, mais l'intérieur (texture, œil, motifs) est un fouillis de petits
  aller-retours.
- **Les traits parasites** : l'image test contient un cadre décoratif rectangulaire + un léger grain
  de papier + un filigrane, en plus du dessin. Ces éléments étaient tracés comme des contours à part
  entière, qu'il fallait ensuite relier au reste par les plus proches voisins disponibles — d'où de
  longs sauts traversant le dessin en diagonale pour rejoindre le cadre ou le filigrane.
- Un correctif "squelette/ligne centrale" façon SandTrace avait été commencé (v4.1.x), et fonctionnait
  correctement sur des tests synthétiques (croisements de lignes, jonctions en T) — mais rester sur
  cette famille d'algorithmes aurait nécessité de re-résoudre indéfiniment ce genre de cas particuliers
  (cadres, bruit de fond, boucles fermées imparfaites). Le passage au modèle TSP-art règle la classe
  de problème à la racine plutôt que cas par cas.

### Le nouveau moteur (`tsp_core.js`, partagé par les deux outils)

- **Stippling pondéré** : échantillonnage-rejet initial + relaxation de Lloyd (variante simplifiée du
  "Weighted Voronoi Stippling" de Secord, 2002) pour une répartition régulière des points dans chaque
  zone, proportionnelle à sa densité (obscurité de l'image, ou intérieur d'une forme pour TSP Fill).
- **Construction initiale** par plus-proche-voisin glouton avec index spatial en grille (rapide même
  sur plusieurs milliers de points), point de départ/arrivée imposables.
- **Amélioration 2-opt** avec listes de voisins (k plus proches) pour rester rapide à grande échelle,
  en conservant les extrémités fixes. Un bug de l'implémentation initiale limitait le gain à ~0% (la
  condition d'élagage ne considérait qu'un seul sens de recherche) ; corrigé en ajoutant la recherche
  symétrique depuis l'autre extrémité de chaque arête — gain mesuré d'environ 11 à 13 % sur des jeux de
  test aléatoires après correction, contre quasiment 0 % avant.
- Performance mesurée : ~150 ms pour 3000 points (construction + 2-opt inclus) — largement dans le
  budget d'un pipeline asynchrone avec barre de progression.
- Chaque brique (stippling, construction, 2-opt, avec extrémités imposées) a été testée
  indépendamment sous Node.js avant intégration, puis re-testée directement sur le code réellement
  embarqué dans `tsp_core.js`.

### Auto-Trace (image → tracé)

- Nouveaux réglages : nombre de points, seuil (fond à ignorer), inversion, flou, **marge à ignorer**
  (exclut un cadre/bord décoratif de la conversion — directement inspiré du problème observé), qualité
  d'optimisation, résolution de travail, miroir final.
- **Sélection du point de départ et d'arrivée** : deux boutons ("📍 Point de départ" / "🏁 Point
  d'arrivée") activent un mode de clic sur l'aperçu ; le point choisi est marqué (D en vert, A en
  rouge) et contraint la tournée calculée.
- Aperçu en direct du semis de points (mis à jour après chaque réglage) pour visualiser la répartition
  avant de lancer le calcul complet.
- Barre de progression détaillée par étape (analyse → placement des points → construction du trajet →
  optimisation 2-opt → mise à l'échelle), avec bouton Annuler.
- Les réglages de recadrage de l'image avant tracé (zoom, rotation, glisser, miroir) sont conservés à
  l'identique de la v4.1.x.

### Nouvel outil : TSP Fill (remplissage par points)

Comme demandé, le même moteur est maintenant aussi disponible comme outil indépendant du canevas
principal, avec sélection du point d'entrée et de sortie. Accessible depuis l'onglet **"🛠️ Outils"**,
bouton **"🎯 TSP Fill (remplir la sélection par points)"**.

Fonctionnement : sélectionnez d'abord un calque formant une forme fermée (dessinée avec l'outil
"🧱 Mur" ou "〰️ Remplissage", ou tout tracé fermé), puis lancez TSP Fill. Une fenêtre affiche la forme,
permet de placer un point de départ/arrivée par clic, règle la densité de points et la qualité, puis
génère un nouveau calque de remplissage par semis de points relié en une ligne continue.

Ce choix d'implémentation (partir d'une forme déjà dessinée avec les outils existants, plutôt que
d'ajouter un mode de dessin de frontière supplémentaire) évite de toucher à la machine à états des
outils du canevas principal — celle-ci a été corrigée avec soin en v4.0 (sélection, rotation,
redimensionnement, miroir) et testée en conséquence ; la modifier à nouveau sans les mêmes vérifications
aurait été risqué.

### Fichiers modifiés/ajoutés

- **`tsp_core.js`** (nouveau) — moteur TSP-art partagé, sans dépendance DOM.
- **`autotrace.js`** — pipeline entièrement réécrit (stippling au lieu de contours/squelette) + nouvel
  outil TSP Fill dans le même fichier.
- **`index.html`** — ajout de `<script src="tsp_core.js"></script>`, bouton "🎯 TSP Fill" dans l'onglet
  Outils (version affichée : v5.0).

---

## v4.1.2 — Correctif : aperçu Auto-Trace toujours hors cadre (vraie cause trouvée)

Le correctif v4.1.1 (CSS `aspect-ratio` + redimensionnement JS) n'était pas suffisant — le
screenshot fourni a permis d'identifier la **vraie cause**, différente de ce qui avait été supposé :

**Cause réelle** : `index.html` définit une règle CSS globale non-scopée :
```css
canvas { position: absolute; top: 0; left: 0; }
```
Prévue pour le canvas de dessin *de l'application principale*, cette règle s'applique en réalité à
**tout élément `<canvas>` du document** — y compris ceux injectés par `autotrace.js` (aperçu + 3
miniatures de mode), puisqu'ils vivent dans la même page. N'ayant jamais réinitialisé `position` sur mes
propres canvases, ils héritaient de `position:absolute; top:0; left:0`, sortaient du flux normal, et se
retrouvaient plaqués en plein écran (calés sur `#autotrace-backdrop`, seul ancêtre positionné) — d'où
l'image géante et pixelisée qui recouvrait tout, y compris les curseurs et boutons (restés en place mais
cachés dessous, puisque les canvases repositionnés se peignent par-dessus).

**Correction** : ajout d'une règle explicite `#autotrace-modal canvas { position: static !important; }`
qui neutralise cet héritage pour tous les canvases de l'outil. Les correctifs de dimensionnement
(`aspect-ratio`, redimensionnement JS) de la v4.1.1 restent en place et redeviennent pleinement
efficaces maintenant que les canvases sont de retour dans le flux normal du document.

### Fichier modifié

- `autotrace.js` uniquement (version affichée dans `index.html` : v4.1.2).

---

## v4.1.1 — Correctif : aperçu Auto-Trace hors cadre

Bug corrigé : à l'import d'une image dans Auto-Trace, l'aperçu s'affichait à sa taille brute au lieu
d'être contenu dans le petit cadre prévu, poussant les curseurs et boutons hors de vue.

**Cause** : les miniatures des 3 modes utilisaient `aspect-ratio:1/1` en CSS pour se dimensionner de
façon fiable, mais ce même réglage avait été oublié sur le canvas d'aperçu principal, qui ne comptait
que sur `width:100%` sans hauteur explicite — un dimensionnement de `<canvas>` peu fiable selon les
navigateurs. La colonne de gauche n'avait pas non plus de `max-width`, donc rien ne l'empêchait de
grandir.

**Correction** : `aspect-ratio:1/1` + `max-width` ajoutés sur le conteneur d'aperçu et sa colonne, et en
complément, la taille du canvas est maintenant fixée explicitement en pixels par JavaScript (à partir de
la taille réelle de son conteneur, recalculée à l'ouverture de l'outil et au redimensionnement de la
fenêtre) — une double sécurité qui ne dépend plus des subtilités de dimensionnement intrinsèque d'un
navigateur à l'autre.

### Fichier modifié

- `autotrace.js` uniquement (version affichée dans `index.html` : v4.1.1).

---

## v4.1 — Outil Auto-Trace (Image → Tracé vectoriel)

Nouvel outil accessible depuis l'onglet **"📐 Transf."** → bouton **"🧵 Auto-Trace (Image → Tracé
vectoriel)"**. Livré dans un fichier séparé, **`autotrace.js`**, pour ne pas alourdir `index.html`
(déjà volumineux) — il s'active à la demande et ne dépend que de l'objet `app` déjà exposé par
`index.html`.

### Ce que ça fait

1. **Importer une image** (glisser-déposer ou sélection de fichier).
2. **La transformer avant tracé** : zoom (molette ou curseur), rotation, glisser pour cadrer/déplacer,
   miroir horizontal/vertical — un cadre pointillé indique la forme du plateau (rond ou rectangulaire)
   pour bien cadrer le sujet.
3. **Choisir un mode**, avec un aperçu miniature en direct pour les 3 modes (mis à jour automatiquement
   après chaque réglage, à la manière du comparatif de SandTrace) :
   - **Seuil (contours)** — binarise l'image selon une luminosité seuil et trace tous les contours.
   - **Silhouette** — comme "Seuil", mais ne garde que la forme principale (composante connexe la plus
     grande), pour un contour propre sans bruit de fond.
   - **Contours fins** — détection de bords par gradient de Sobel (une version simplifiée d'un
     détecteur façon Canny, sans suppression des non-maxima ni hystérésis, pour rester 100% JS et léger).
4. **Régler les curseurs** : seuil de luminosité / sensibilité des contours (selon le mode), flou (réduit
   le bruit avant traitement), détail (précision du tracé), lissage du tracé (arrondit les angles),
   résolution de travail (qualité vs vitesse), inversion, miroir final.
5. **Générer** : une barre de progression détaille chaque étape (prétraitement → détection des contours →
   nettoyage → simplification/lissage → assemblage du trajet → mise à l'échelle), avec un bouton
   Annuler. Le résultat est ajouté comme **nouveau calque indépendant** (type tracé importé), prêt à être
   repositionné/tourné/redimensionné/mis en miroir avec l'outil Sélection (grâce aux corrections de la
   v4.0).

### Comment ça marche (sans dépendance externe type OpenCV)

- Niveaux de gris + flou boîte (séparable) pour réduire le bruit.
- Grille binaire (seuil ou gradient de Sobel selon le mode), avec un cadre de remplissage qui garantit
  que tous les contours se referment proprement.
- **Composantes connexes** (4-connexité) pour isoler la forme principale en mode Silhouette.
- **Contours fermés extraits par "marching squares"** — un algorithme standard de suivi de frontière
  entre pixels "dedans/dehors".
- **Simplification Douglas-Peucker** puis **lissage Chaikin** (subdivision qui arrondit les angles) sur
  chaque contour.
- **Assemblage en un seul tracé continu** par plus-proche-voisin glouton, pour minimiser les
  déplacements "à vide" entre les formes détectées — dans le même esprit que ce que fait SandTrace.

Tous ces algorithmes ont été **développés et testés indépendamment sous Node.js avant intégration** :
grille synthétique (rectangle, anneau avec trou), détection de deux composantes distinctes, réduction
Douglas-Peucker, expansion Chaikin, assemblage par proximité — puis **re-testés une seconde fois
directement sur le code réellement présent dans `autotrace.js`** (extraction automatique du bloc de
code embarqué, pas une copie séparée) pour garantir qu'aucune différence ne s'est glissée pendant
l'intégration.

### Différences assumées avec SandTrace (transparence)

SandTrace (le projet fourni en référence) s'appuie sur un pipeline Python/OpenCV de ~2500 lignes
(détection de contours OpenCV, squelettisation, recherche de plus court chemin par Dijkstra pour
naviguer entre les formes). Le reproduire à l'identique en JavaScript pur, sans dépendance externe,
dans un unique fichier, n'était pas réaliste. Cette implémentation reprend la **même logique en trois
temps** (silhouette / seuil / contours fins, réglages de détail/lissage/miroir, réduction des
déplacements à vide) avec des algorithmes plus simples mais éprouvés (marching squares + plus-proche-
voisin glouton plutôt que squelettisation + Dijkstra). Pour l'immense majorité des logos, photos
contrastées et dessins au trait, le résultat est très proche ; sur des photos très texturées avec
beaucoup de petits détails séparés, SandTrace produira un trajet légèrement plus optimisé. Le curseur
"Détail" et le mode "Silhouette" (qui ignore le bruit de fond) couvrent la plupart des cas pratiques.

### Fichiers modifiés/ajoutés

- **`autotrace.js`** (nouveau) — tout le module Auto-Trace.
- **`index.html`** — 2 ajouts seulement : `<script src="autotrace.js"></script>`, et le bouton
  "🧵 Auto-Trace" dans l'onglet Transf. (version affichée : v4.1).

---

## v4.0 — Transformation unifiée (rotation / redimensionnement / miroir)

Cette version corrige le bug de transformation (rotation/redimensionnement/miroir) rapporté sur les
calques image et tracé importé (.thr), et fait une passe générale de correction/amélioration.

### 🐛 Bug principal corrigé : transformation des calques image / .thr

Trois bugs distincts s'additionnaient :

1. **`recalcImportedPath` était appelée mais n'existait nulle part dans le code.** Chaque déplacement,
   rotation ou redimensionnement d'un calque `.thr` importé déclenchait une erreur silencieuse
   (`ReferenceError`) qui interrompait l'affichage avant même que le dessin ne soit mis à jour — le
   tracé restait visuellement figé quoi que vous fassiez.
2. **Le miroir était mathématiquement impossible.** Les calques image/.thr stockaient une seule valeur
   `scale` + deux booléens `flipH`/`flipV`. Lors d'un redimensionnement, le code faisait
   `scale = ancienScale * Math.max(Math.abs(sx), Math.abs(sy))` — le signe (donc le miroir) était
   systématiquement perdu. Glisser une poignée au-delà du centre ne pouvait jamais inverser le calque.
3. **La boîte de sélection ignorait la rotation.** `getLayerBBox` calculait une boîte axis-aligned à
   partir de la largeur/hauteur *non tournées* de l'image, sans tenir compte de `rot`. Résultat : dès
   qu'un calque était tourné, les poignées de coin s'affichaient au mauvais endroit et le
   redimensionnement produisait un résultat incohérent — c'est le symptôme exact décrit
   ("on peut tourner mais pas redimensionner").

### La correction

Les calques `image`, `imported_path` (.thr) et `text` ont maintenant un **contour orienté (OBB)** qui
suit fidèlement leur rotation :

- `getLayerOBB()` calcule les 4 coins réels du calque dans son repère local, tournés et mis à l'échelle
  correctement — les poignées de sélection sont désormais dessinées à la bonne position, alignées avec
  l'objet, même après rotation.
- Le test de clic sur une poignée (`pointerdown`) et le glissement (`pointermove`) se font dans le
  **repère local de l'objet** (rotation inversée), donc les poignées répondent correctement quel que
  soit l'angle courant.
- Le redimensionnement par poignée de coin utilise un nouveau calcul (`computeOBBScaleDrag`) qui garde
  le **coin opposé parfaitement fixe à l'écran**, quel que soit l'angle du calque — exactement le
  comportement attendu d'un éditeur vectoriel standard. Ce calcul a été vérifié indépendamment par des
  tests automatisés (rotation à 0°, 37°, -110°, avec géométrie asymétrique et échelle déjà inversée).
- **Glisser une poignée au-delà du centre de l'objet inverse maintenant naturellement le signe de
  l'échelle → miroir.** Le modèle `scale` + `flipH`/`flipV` est remplacé par `scaleX`/`scaleY` (le signe
  porte le miroir), aussi bien pour les images que pour les tracés .thr importés.
- Le bouton "Miroir Horiz./Vert." (onglet Transf.) fonctionne maintenant correctement pour **tous** les
  types de calques, y compris image et .thr (il ne faisait auparavant rien d'utile sur ces types à cause
  du bug n°2, et ne faisait rien du tout sur le texte — voir ci-dessous).
- Les anciens projets `.sunae` sauvegardés avec le modèle `scale`/`flipH`/`flipV` sont migrés
  automatiquement à l'ouverture, sans perte.

### Bonus : texte, opacité, rotation précise

- **Miroir du texte** : c'était complètement silencieux (le même bug `Math.abs()` annulait le signe).
  Le texte utilise maintenant de vrais drapeaux `flipH`/`flipV` : `flipH` inverse l'ordre des lettres et
  chaque glyphe horizontalement, `flipV` inverse chaque glyphe verticalement. La correspondance entre
  la case cliquée à l'écran et la lettre éditée a aussi été corrigée pour rester cohérente après un
  miroir horizontal.
- **Rotation précise** : ajout d'un curseur numérique (-180° à 180°) dans l'onglet "Transf." pour les
  calques image/.thr, en plus de la poignée de rotation à la souris (le champ existait déjà dans le
  code mais l'élément HTML correspondant n'avait jamais été créé — la fonction ne servait à rien).
- **Opacité** : le curseur d'opacité ne s'appliquait qu'aux images. Il fonctionne maintenant aussi sur
  les tracés .thr importés, et le rendu des calques vectoriels respecte enfin le champ `opacity` s'il
  est défini.

### 🔍 Passe de revue générale

- Script vérifié syntaxiquement valide (`node --check`).
- Recherche systématique de tous les appels `this.xxx(...)` sans définition correspondante dans l'objet
  `app` (c'est ce qui a révélé le bug `recalcImportedPath` en premier lieu) — plus aucun appel orphelin
  détecté après correction.
- Recherche systématique de tous les `document.getElementById('xxx')` sans élément `id="xxx"`
  correspondant dans le HTML (c'est ce qui a révélé que le curseur `img-rot` n'existait pas) — plus
  aucune référence orpheline détectée après correction.
- Le calcul de transformation par ancre a été testé unitairement en dehors du navigateur (Node.js) sur
  4 scénarios géométriques différents avant d'être intégré, puis re-testé une seconde fois directement
  sur le code réellement intégré dans `index.html`.

### Limitation connue (mineure, sans impact pratique)

Le pivot de rotation d'un tracé `.thr` importé reste l'origine locale (0,0) du fichier — c'est-à-dire le
centre physique du plateau au moment de l'import — plutôt que le centre géométrique exact de la boîte
englobante du tracé. Pour la quasi-totalité des fichiers `.thr` (coordonnées polaires centrées sur le
plateau par construction), les deux coïncident quasiment. Si un tracé importé est très excentré, le
bouton miroir peut légèrement déplacer le centre visuel plutôt que de tourner parfaitement sur place —
un simple ajustement de position après coup suffit à corriger.

## 📁 Fichiers à copier dans votre dépôt

- `index.html` — remplace le fichier existant à la racine du dépôt.
- `autotrace.js` — nouveau fichier, à placer à côté de `index.html`.
- `alphabet.js` — inchangé (fourni pour référence).

## À venir (prochaine étape, sur demande)

- Outil de remplissage par ligne continue façon TSP (finitecurve), avec contrainte de point de
  départ/arrivée et réglages de densité.
