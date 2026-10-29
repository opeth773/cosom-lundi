# Cosom Android — application indépendante

Cette application conserve l'interface et les fonctions de la PWA dans une APK
Android, avec un pont natif pour le microphone, Google, le presse-papiers et les
exports JSON. Android 8.0 ou plus récent est requis. Android System WebView doit
être à jour. Le moteur vocal français est inclus dans l’APK et ne dépend pas du service de dictée Google.

## Séparation de la PWA

- Tout le code Android et sa copie du frontend sont dans `android/`.
- Les fichiers `public/`, `firebase.json`, `firestore.rules` et le déploiement PWA
  ne sont ni modifiés ni utilisés comme entrées de compilation Android.
- `web/` est une copie indépendante, pas un lien ni une copie faite à chaque build.
  `snapshot.json` identifie la version de départ. Les adaptations Android sont
  dans cette copie uniquement.
- Le projet Android est sur la branche `android-native`. Son workflow et ses
  étiquettes `android-v*` ne déclenchent pas le déploiement PWA sur `main`.
- Les comptes, la ligue et les données sont ceux du même projet Firebase
  `cosom-8ab4f`. Une modification de données effectuée dans Android est donc aussi
  visible depuis la PWA, conformément au choix demandé.

L'interface et le SDK Firebase 12.19.0 sont embarqués. Les empreintes et URL
d'origine des trois modules SDK figurent dans `web/vendor/firebase/provenance.json`,
et leur licence est incluse. Internet reste nécessaire pour se connecter et
synchroniser la ligue, comme dans la PWA. L'APK ne promet pas un mode hors ligne.

## Installation et connexion Google

Installer `releases/Cosom-Android-1.0.0-preview.4.apk` sur le téléphone. Android peut
demander d'autoriser l'installation depuis le navigateur ou le gestionnaire de
fichiers utilisé. L'APK est signée avec une clé Android dédiée et porte le nom
**Cosom Android**, pour la distinguer de la PWA installée.

La connexion courriel/mot de passe conserve le flux Firebase existant.
La connexion Google utilise le sélecteur de compte Android (Credential Manager),
puis transmet le jeton Google au SDK Firebase. Aucun écran de connexion Google
n'est intégré dans une WebView.

Pour autoriser cette application Google : dans les paramètres du projet Firebase
`cosom-8ab4f`, ajouter une application Android de package **`ca.cosomlundi.app`** et
enregistrer les empreintes **SHA-1 et SHA-256 de `signing-certificate.txt`**.
Le fournisseur Google doit rester activé dans Firebase Authentication.
Le client OAuth Web déjà configuré pour cette ligue est enregistré dans
`google-web-client-id.txt` ; c'est un identifiant public, pas une clé secrète.
Le fichier `google-services.json` n'est pas nécessaire à ce projet : sa configuration
Firebase publique est déjà embarquée dans `web/firebase-init.json`.

Un certificat de signature différent exige une nouvelle inscription SHA. Les APK
de debug générées en CI n'ont pas la signature de l'APK installable ci-dessus et
ne peuvent pas la remplacer directement.

## Commandes vocales Android

Le mode hors ligne introduit en version 3 et conservé en version 4 remplace
les sessions répétées de `SpeechRecognizer` par **AudioRecord + Vosk 0.3.75**, avec le modèle français
`vosk-model-small-fr-0.22`. Un seul flux PCM 16 kHz reste ouvert depuis
l'activation jusqu'à l'arrêt demandé. La fin d'une phrase finalise uniquement sa
transcription, sans arrêter ou redémarrer le microphone. Aucun son système de
session de dictée Google n'est déclenché. Les bips de l'application pour la
commande et son résultat restent disponibles.

- Le micro demande la permission Android à sa première utilisation.
- Le modèle est extrait sur l'appareil au premier démarrage du mode vocal.
- En mode hors ligne, la reconnaissance se fait localement, sans envoyer l'audio à un serveur.
- Le laboratoire reste actif après une simulation, un nom non reconnu et un
  silence. Il attend les détails du but sans minuterie d'inactivité.
- Après chaque résultat, dire à nouveau « Ajouter un but » pour un autre essai.
- Dire « arrête le test », « arrête le micro » ou utiliser « Arrêter le test »
  ferme le micro. La mise en arrière-plan et les pertes réelles d'accès au
  microphone sont traitées explicitement, sans boucle de redémarrage.
- Les transcriptions tardives après l'arrêt sont ignorées.

### Option Google en français canadien (version 4)

Le choix par défaut reste le moteur hors ligne. Dans **Admin → Laboratoire →
Reconnaissance vocale**, sélectionner **Google — français canadien** pour essayer
la reconnaissance `fr-CA` du service Google installé. Les noms de la
ligue sont transmis comme indices (`EXTRA_BIASING_STRINGS`). Le choix est conservé
sur l'appareil et s'applique aussi au mode vocal des parties, où le même sélecteur
est accessible aux comptes normaux.

Ce mode nécessite Android 13+, un service de reconnaissance Google accessible et
Internet. **L'audio est transmis à Google dans ce mode.** L'application fournit un
flux PCM via `EXTRA_AUDIO_SOURCE`, demande
`EXTRA_SEGMENTED_SESSION=EXTRA_AUDIO_SOURCE` et traite `onSegmentResults` sans
rouvrir le microphone. Elle ne relance pas une session terminée par le fournisseur.
Les fournisseurs peuvent ignorer ces fonctionnalités : les erreurs et fins de
session non segmentées sont affichées, sans bascule silencieuse vers le moteur
hors ligne. La compatibilité et la précision québécoise doivent être confirmées
sur le téléphone. Les tests automatisés valident les paramètres et le contrôleur,
pas le service Google réel.

Le modèle reconnaît le français général ; la précision des noms et des accents
québécois dans le bruit du gym doit être validée sur téléphone. Le même
interpréteur de joueurs, buts et aides reste utilisé. La PWA n'a pas changé.
L'archive du modèle est épinglée par SHA-256 dans `voice-model.json` et préparée
par `tools/prepare_voice_model.py`. Le modèle et Vosk sont sous Apache-2.0 ; la
licence est embarquée dans l'APK. L'augmentation de taille de l'APK est due au
modèle et aux bibliothèques natives, pas aux données de la ligue.

## Compiler et tester

Prérequis : JDK 17 ou 21, Android SDK Platform 36 et Build Tools 35.0.0, Node.js
pour les tests JavaScript. Le wrapper Gradle 8.13 vérifie la somme SHA-256 de sa
distribution. Définir `ANDROID_HOME` ou un `local.properties` ignoré par Git.

Depuis `android/` :

```sh
python3 tools/prepare_voice_model.py
node --test tests/*.test.cjs
./gradlew testDebugUnitTest assembleDebug lintDebug
```

Pour une APK signée, créer un fichier de propriétés **hors du dépôt** contenant
`storeFile`, `storePassword`, `keyAlias`, `keyPassword`, puis définir
`COSOM_ANDROID_SIGNING_PROPERTIES` vers ce fichier avant d'exécuter :

```sh
./gradlew assembleRelease lintRelease
```

La clé de la première APK et ses propriétés sont conservées dans
`/workspace/.cosom-android-signing/`, hors du dépôt. **Sauvegarder ce dossier
privé dans un emplacement sûr** : la même clé est nécessaire pour installer les
mises à jour sans désinstaller l'application. Ne pas publier ce dossier, ses
mots de passe ou son contenu dans GitHub. Seules les empreintes publiques sont
suivies dans Git.

Le workflow Android exécute les tests, compile une variante de debug et lance
Lint. Une étiquette `android-v*` peut publier l'APK signée déjà vérifiée, conservée
dans `releases/`, après vérification de son empreinte et de sa signature.

## Validation et limites de la première version

Les tests automatiques couvrent le pont vocal, les segments partiels/finalisés,
l'annulation des résultats tardifs, les erreurs de permission, l'export, le
cycle de vie, la connexion native simulée et les corrections d'alignement/statistiques.
Cinq tests Android du contrôleur vérifient notamment des centaines de phrases
sans remplacer le flux audio et un long silence simulé. Un essai complémentaire
avec le vrai modèle français et une voix synthétique reconnaît plusieurs
commandes séparées par des silences dans le même décodeur. Ces tests ne prouvent
pas encore la capture matérielle sur un téléphone réel.
Le frontend embarqué démarre jusqu'à l'écran de connexion sans requête externe
et sans erreur JavaScript dans un navigateur mobile de test.

La connexion à un vrai compte Google et les commandes vocales dans le bruit du gym
doivent être validées sur un téléphone Android après l'inscription Firebase.
Un test simulé ne prouve pas ces comportements matériels. Aucune création de
compte, de ligue, ni modification de données de production n'est effectuée pour
les tests.
