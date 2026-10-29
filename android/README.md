# Cosom Android — application indépendante

Cette application conserve l'interface et les fonctions de la PWA dans une APK
Android, avec un pont natif pour le microphone, Google, le presse-papiers et les
exports JSON. Android 8.0 ou plus récent est requis. Android System WebView doit
être à jour. La reconnaissance vocale nécessite un service vocal Android actif,
par exemple « Reconnaissance et synthèse vocales Google ».

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

Installer `releases/Cosom-Android-1.0.0-preview.1.apk` sur le téléphone. Android peut
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

Le mode vocal de match et le laboratoire admin utilisent `SpeechRecognizer`
d'Android en **français canadien (`fr-CA`)**, avec résultats partiels et plusieurs
interprétations. Le même interpréteur de commandes que la PWA gère « Ajouter un
but », les joueurs, les aides et les corrections.

- Le micro demande une permission Android à la première utilisation.
- L'écoute continue est composée de sessions natives successives. Le silence
  déclenche une reprise temporisée plutôt qu'une boucle de démarrages rapides.
- Chaque segment conserve son index entre résultats partiels et finaux, afin que
  l'interpréteur ne compte pas deux fois la même phrase.
- Fermer le mode vocal ou quitter l'application annule les résultats tardifs.
- Passer en arrière-plan arrête le microphone. Il faut réactiver le mode vocal
  manuellement au retour. Aucun service microphone ne tourne en arrière-plan.
- Une connexion Internet peut être nécessaire au moteur vocal du téléphone.

## Compiler et tester

Prérequis : JDK 17 ou 21, Android SDK Platform 36 et Build Tools 35.0.0, Node.js
pour les tests JavaScript. Le wrapper Gradle 8.13 vérifie la somme SHA-256 de sa
distribution. Définir `ANDROID_HOME` ou un `local.properties` ignoré par Git.

Depuis `android/` :

```sh
node --test tests/*.test.cjs
./gradlew assembleDebug lintDebug
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
Le frontend embarqué démarre jusqu'à l'écran de connexion sans requête externe
et sans erreur JavaScript dans un navigateur mobile de test.

La connexion à un vrai compte Google et les commandes vocales dans le bruit du gym
doivent être validées sur un téléphone Android après l'inscription Firebase.
Un test simulé ne prouve pas ces comportements matériels. Aucune création de
compte, de ligue, ni modification de données de production n'est effectuée pour
les tests.
