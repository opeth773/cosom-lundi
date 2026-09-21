@echo off
setlocal
cd /d "%~dp0"
echo.
echo COSOM - Deploiement Firebase
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI n'est pas installee.
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Installe Node.js LTS, puis relance ce fichier.
    pause
    exit /b 1
  )
  echo Installation de firebase-tools...
  call npm install -g firebase-tools
  if errorlevel 1 goto error
)

echo.
echo Connexion Firebase si necessaire...
call firebase login
if errorlevel 1 goto error

echo.
echo Si aucun projet n'est encore lie, execute d'abord: firebase use --add
call firebase use
if errorlevel 1 (
  echo.
  echo Aucun projet lie. Selectionne ton projet maintenant.
  call firebase use --add
  if errorlevel 1 goto error
)

echo.
echo Deploiement Hosting + Firestore...
call firebase deploy --only hosting,firestore
if errorlevel 1 goto error

echo.
echo TERMINE. L'adresse web.app est affichee ci-dessus.
pause
exit /b 0

:error
echo.
echo ECHEC. Lis le message Firebase ci-dessus.
pause
exit /b 1
