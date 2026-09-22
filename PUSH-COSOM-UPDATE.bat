@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   COSOM - PUSH UPDATE TO GITHUB
echo ==========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERREUR: Git n'est pas disponible dans le PATH.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERREUR: Ce fichier doit etre place a la racine du repo cosom-pwa.
  pause
  exit /b 1
)

echo [1/5] Fichiers modifies:
git status --short
echo.

git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo Rien a envoyer: aucun changement detecte.
  echo.
  pause
  exit /b 0
)

set "MSG=Update COSOM"
set /p "USERMSG=Message du commit [Update COSOM]: "
if not "%USERMSG%"=="" set "MSG=%USERMSG%"

echo.
echo [2/5] Creation du commit...
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo ERREUR pendant le commit.
  pause
  exit /b 1
)

echo.
echo [3/5] Recuperation des changements GitHub...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo ERREUR pendant le git pull --rebase.
  echo Aucun push n'a ete fait. Regarde le message ci-dessus.
  pause
  exit /b 1
)

echo.
echo [4/5] Push vers GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo ERREUR pendant le push.
  pause
  exit /b 1
)

echo.
echo [5/5] Termine.
echo GitHub Actions devrait maintenant deployer le site automatiquement.
echo.
pause
