# COSOM — installation Firebase

Cette version est une PWA : un seul site fonctionne sur Android, iPhone, tablette et ordinateur. Les données sont synchronisées par Cloud Firestore.

## 1) Créer le projet Firebase

1. Va dans **https://console.firebase.google.com/** et crée un projet, par exemple `cosom-ligue-lundi`.
2. Google Analytics est facultatif; l'application n'en dépend pas.
3. Dans **Project settings / Paramètres du projet > Your apps**, ajoute une application **Web** nommée `Cosom PWA`. Tu n'as pas besoin de copier le bloc `firebaseConfig` : Firebase Hosting le fournit automatiquement à l'application.

## 2) Activer l'authentification

Dans Firebase Console, va dans **Build > Authentication > Get started > Sign-in method**.

Active **Google** en premier. Firebase te demandera de choisir un **Project support email** : sélectionne ton adresse Google, puis sauvegarde. C'est la méthode recommandée dans l'app et le bouton **Continuer avec Google** apparaît en premier.

Active aussi **Email/Password > Enable** comme solution de rechange pour les joueurs qui n'ont pas de compte Google.

Donc :
- compte Google disponible → **Continuer avec Google**;
- pas de compte Google → création d'un compte Cosom par **courriel + mot de passe**.

## 3) Créer Firestore

Dans Firebase Console :

**Build > Firestore Database > Create database**.

Choisis **Production mode**. Pour la localisation, `northamerica-northeast1 (Montréal)` convient si elle est offerte dans ton projet.

Ne crée aucune collection manuellement : l'application s'en charge.

## 4) Installer la Firebase CLI sur ton PC

Il faut Node.js installé. Ensuite, ouvre PowerShell ou CMD dans ce dossier et exécute :

```bat
npm install -g firebase-tools
firebase login
firebase use --add
```

À `firebase use --add`, sélectionne ton projet Firebase et donne-lui l'alias `default`.

## 5) Déployer

```bat
firebase deploy --only hosting,firestore
```

Firebase affichera ensuite une adresse du genre :

```text
https://cosom-ligue-lundi.web.app
```

Il n'y a **aucune Cloud Function et aucun push automatique** dans cette version. Hosting + Authentication + Firestore suffisent.

## 6) Calendrier et présences

- La ligue joue par défaut **tous les lundis**.
- L'administrateur crée la ligue une seule fois; l'application prépare automatiquement les lundis futurs.
- Dans **Réglages**, l'administrateur peut choisir l'heure habituelle et combien de semaines doivent être créées d'avance.
- Dans **Calendrier**, chaque lundi affiche le nombre de **présents, absents, incertains et sans réponse**, ainsi que les noms déjà confirmés.
- Chaque joueur lié à son compte peut répondre **Présent / Incertain / Absent** pour n'importe quel lundi futur. Une absence peut donc être enregistrée plusieurs semaines ou mois d'avance.
- Les remplaçants utilisent le même écran avec **Dispo / Incertain / Indispo**.
- Un organisateur peut modifier les réponses de tout le monde.
- Ces réponses servent à planifier. À la fin d'un match, les absences officielles de statistiques restent déterminées par les joueurs réellement placés dans Foncés ou Pâles.

## 7) Match et chrono

- Tous les membres peuvent saisir les buts/passes, répartir les joueurs Foncés/Pâles et contrôler pause/reprise du chrono.
- Un seul appareil à la fois est désigné pour faire sonner l'alarme. Sur la tablette du gym, utilise **Prendre l'alarme**.
- Le chrono est synchronisé à partir d'une heure de fin commune : la base n'est pas écrite à chaque seconde.
- **Réinitialiser chrono** remet seulement la période à sa durée configurée : buts et équipes restent intacts.
- **Vider les équipes** est disponible seulement tant que le match n'a jamais réellement commencé et qu'il ne reste aucun but.

## 8) Installation sur téléphone

### Android
Ouvre l'adresse dans Chrome > menu `⋮` > **Installer l'application** / **Ajouter à l'écran d'accueil**.

### iPhone
Ouvre l'adresse dans Safari > **Partager** > **Sur l'écran d'accueil**.

## 9) Mettre l'app à jour plus tard

```bat
firebase deploy --only hosting,firestore
```

## 10) Fichiers principaux

- `public/index.html` : coque PWA
- `public/styles.css` : affichage mobile/tablette + safe areas Xiaomi/iPhone
- `public/app.js` : application complète
- `public/manifest.webmanifest` : installation PWA
- `public/sw.js` : cache PWA
- `firestore.rules` : sécurité des données
