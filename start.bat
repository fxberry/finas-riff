@echo off
rem Finas Riff starten: kleiner lokaler Webserver + Browser.
rem (Direktes Doppelklicken der index.html geht nicht - Browser laden 3D-Modelle nur ueber http.)
cd /d "%~dp0"
set PORT=8765
start "" "http://localhost:%PORT%/"
where py >nul 2>nul && (py -3 -m http.server %PORT% & goto :eof)
where python >nul 2>nul && (python -m http.server %PORT% & goto :eof)
where npx >nul 2>nul && (npx --yes serve -l %PORT% . & goto :eof)
echo Weder Python noch Node gefunden. Bitte Python installieren: https://www.python.org/downloads/
pause
