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
