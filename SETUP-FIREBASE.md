# COSOM — configuration actuelle

Projet Firebase : `cosom-8ab4f`  
Site Hosting : `https://cosomlundi.web.app`

Firebase Authentication doit avoir **Google** et **Email/Password** activés, et `cosomlundi.web.app` doit être présent dans **Authentication > Settings > Authorized domains**.

Firestore est utilisé en mode production avec les règles fournies dans `firestore.rules`.

## Rôles

Le premier compte qui crée la ligue devient **propriétaire / administrateur**. Après la création, l'écran de démarrage ne permet plus de créer d'autre ligue : les nouveaux comptes voient seulement **Joindre avec un code**.

Dans l'onglet **Admin**, un administrateur peut :
- associer chaque compte à son joueur;
- promouvoir un compte normal en administrateur;
- remettre un administrateur en compte normal;
- gérer les joueurs/gardiens/remplaçants;
- gérer les réglages et le calendrier;
- copier le code d'invitation;
- exporter les données.

Le propriétaire ne peut pas être rétrogradé. Un administrateur ne peut pas modifier son propre rôle depuis l'interface.

Les comptes normaux peuvent consulter la ligue, répondre à leurs présences/absences et participer à l'opération du match (équipes, buts/passes, chrono). Ils ne peuvent pas modifier la configuration de la ligue ou les comptes.

## Déployer

Double-clique `DEPLOYER.bat`, ou exécute :

```bat
firebase deploy --project cosom-8ab4f --only hosting:app,firestore
```
