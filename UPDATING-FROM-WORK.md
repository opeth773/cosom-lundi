# Mettre Cosom à jour sans rien installer sur le PC

Le repo GitHub est `opeth773/cosom-lundi`. Le déploiement vers `https://cosomlundi.web.app` est automatique dès qu'un commit arrive sur la branche `main`.

## Modifier directement dans le navigateur

1. Ouvre le repo GitHub.
2. Appuie sur la touche `.` pour ouvrir `github.dev`.
3. Modifie les fichiers voulus, surtout dans `public/`.
4. Ouvre **Source Control** à gauche.
5. Entre un message de commit.
6. Clique **Commit & Push**.
7. Va dans **GitHub > Actions** et attends que `Deploy to Firebase Hosting on merge` soit vert.
8. Recharge `https://cosomlundi.web.app`.

Aucun BAT, Node, Git ou Firebase CLI n'est requis sur le PC de travail.

## Installer une version complète reçue en ZIP

1. Télécharge le ZIP et utilise **Extraire tout** de Windows. Aucune installation n'est requise.
2. Dans github.dev, remplace les fichiers correspondants du repo par ceux du ZIP.
3. Ne supprime pas les GitHub Secrets. Ils ne sont pas dans le ZIP et restent dans les réglages du repo.
4. Commit & Push.

Pour une mise à jour normale de l'interface, les fichiers principaux sont :
- `public/app.js`
- `public/styles.css`
- `public/index.html`
- `public/sw.js`

Si `firestore.rules`, `firestore.indexes.json`, `firebase.json` ou `.firebaserc` changent, garde aussi ces fichiers dans le commit. Le workflow actuel déploie Hosting automatiquement; les règles Firestore doivent être déployées séparément si elles changent.
