# Cosom PWA — v4

PWA synchronisée pour **La ligue du lundi**.

Cette version ajoute de vrais rôles :
- **Administrateur** : joueurs, associations comptes↔joueurs, rôles, invitations, réglages, création de matchs et export.
- **Compte normal** : calendrier, présence/absence, statistiques et opérations de match au gym (équipes, chrono, buts/passes).

La ligue ne peut être créée qu'une seule fois. Le premier créateur devient propriétaire/administrateur. Tous les comptes suivants peuvent uniquement la rejoindre avec le code d'invitation.

Le site cible est **https://cosomlundi.web.app**. Pour déployer une mise à jour, double-clique `DEPLOYER.bat`.

## Version 5.0.0

Cette version inclut notamment : Google Sign-In avec courriel/mot de passe en solution de rechange, calendrier des lundis et absences déclarables d'avance, rôles Administrateur/Compte normal, création unique de la ligue par le premier propriétaire, association compte-joueur gérée par les admins, et target Firebase Hosting `app -> cosomlundi`.

## Calendrier administrateur (v6)

Dans **Calendrier**, un administrateur peut ajouter un match manuel à n'importe quelle date et supprimer un match futur. Si un lundi généré automatiquement est supprimé, l'application conserve cette date comme lundi annulé afin de ne pas le recréer automatiquement. Recréer manuellement un match ce lundi réactive la date.

## Corriger les alignements après une partie

Un administrateur peut ouvrir une partie terminée, puis **Alignements**, pour ajouter
un joueur ou gardien oublié, changer son équipe (Foncés/Pâles), sa position ou le
retirer de l'alignement. Les changements sont enregistrés immédiatement et les
statistiques de saison sont recalculées à partir de l'alignement corrigé. Les
comptes normaux conservent un affichage en lecture seule pour les alignements finaux.

Le workflow GitHub teste ces corrections et déploie `firestore.rules` avant le
site Hosting. Pour un déploiement manuel avec les droits Firebase appropriés,
utiliser `firebase deploy --project cosom-8ab4f --only hosting:app,firestore:rules`.
Le compte de service GitHub doit disposer du rôle **Firebase Rules Admin**
(`roles/firebaserules.admin`) en plus de ses droits Hosting. Son adresse figure
dans l'annotation « Firebase deployment account » du workflow. Un échec du
déploiement des règles bloque la publication du site.

Tests de régression locaux (Node.js, sans dépendances supplémentaires) :
`node --test tests/final-lineups.test.cjs`. Ils vérifient les corrections et les
statistiques avec Firebase simulé; ils ne remplacent pas un test des règles dans
l'émulateur Firestore.
