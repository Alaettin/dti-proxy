@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title DTI Proxy

rem Ohne Vorgabe von aussen: Datenbank neben dieses Skript, Oberflaeche aus dem Bau.
if "%PORT%"=="" set "PORT=3000"
if "%DATA_DIR%"=="" set "DATA_DIR=%~dp0daten"
if "%SESSION_SECRET%"=="" set "SESSION_SECRET=lokaler-start-nur-auf-diesem-rechner"
set "WEB_DIR=%~dp0apps\web\dist"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte von https://nodejs.org installieren und dieses Fenster neu oeffnen.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Abhaengigkeiten werden installiert. Beim ersten Mal dauert das ein paar Minuten.
  echo.
  call npm install
  if errorlevel 1 goto :fehler
)

rem Immer bauen. Ein "nur wenn dist fehlt" wuerde nach jeder Codeaenderung den
rem alten Stand starten, und danach sucht man lange.
echo Anwendung wird gebaut.
echo.
call npm run build
if errorlevel 1 goto :fehler

echo.
echo   DTI Proxy laeuft gleich auf http://localhost:%PORT%
echo.
echo   Verwaltung   http://localhost:%PORT%/admin
echo   Swagger      http://localhost:%PORT%/swagger
echo   Anmeldung    NeoAdmin
echo.
echo   Daten        %DATA_DIR%
echo.
echo   Zum Beenden Strg+C druecken oder dieses Fenster schliessen.
echo.

rem Der Browser wird von einem eigenen Fenster geoeffnet, das kurz wartet.
rem ping statt timeout: timeout bricht ab, sobald stdin umgeleitet ist.
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://localhost:%PORT%/admin"

node "apps\server\dist\index.js"
set "ENDE=%ERRORLEVEL%"
if not "%ENDE%"=="0" (
  echo.
  echo Der Server hat sich mit Code %ENDE% beendet.
  pause
)
endlocal
exit /b 0

:fehler
echo.
echo Der Start ist fehlgeschlagen. Die Ursache steht in den Meldungen oben.
echo.
pause
endlocal
exit /b 1
