@echo off
setlocal
cd /d "%~dp0"
echo.
echo COSOM - Deploiement vers https://cosomlundi.web.app
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
echo Deploiement sur cosomlundi.web.app + regles Firestore...
call firebase deploy --project cosom-8ab4f --only hosting:app,firestore
if errorlevel 1 goto error

echo.
echo TERMINE : https://cosomlundi.web.app
pause
exit /b 0

:error
echo.
echo ECHEC. Lis le message Firebase ci-dessus.
pause
exit /b 1
