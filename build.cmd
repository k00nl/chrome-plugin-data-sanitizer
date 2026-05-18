@echo off
setlocal
cd /d "%~dp0"

echo [1/4] Dependencies...
call npm install || goto :error

echo [2/4] Bundelen...
call npm run build || goto :error

echo [3/4] Bestanden klaarzetten...
set BUILD=build
set STAGE=%BUILD%\k00-sanitizer
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%STAGE%\dist" || goto :error
mkdir "%STAGE%\icons" || goto :error

copy /y manifest.json   "%STAGE%\"        >nul || goto :error
copy /y popup.html      "%STAGE%\"        >nul || goto :error
copy /y popup.css       "%STAGE%\"        >nul || goto :error
copy /y dist\content.js "%STAGE%\dist\"   >nul || goto :error
copy /y dist\popup.js   "%STAGE%\dist\"   >nul || goto :error
copy /y dist\heavy.js   "%STAGE%\dist\"   >nul || goto :error
copy /y icons\*.png     "%STAGE%\icons\"  >nul || goto :error

echo [4/4] Zippen...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%BUILD%\k00-sanitizer.zip' -Force" || goto :error

echo.
echo Klaar.
echo   Delen:    %BUILD%\k00-sanitizer.zip
echo   Unpacked: %STAGE%
echo.
echo Laden: chrome://extensions, ontwikkelaarsmodus aan, "Uitgepakte extensie laden", kies de map hierboven.
goto :eof

:error
echo.
echo Build mislukt.
exit /b 1
