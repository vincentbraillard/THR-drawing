# Éditeur de Tracés Sunae — Journal des modifications

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
