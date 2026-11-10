@echo off
chcp 65001 >nul
title Letras en vivo - Director
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando por primera vez, puede tardar unos minutos...
  call npm install
)
call npm run director
echo.
echo El director se cerro. Podes cerrar esta ventana.
pause
