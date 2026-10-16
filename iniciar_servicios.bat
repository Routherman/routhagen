@echo off
title Iniciador Routh-Agent (BD, Ollama, Backend, Ngrok)
echo ===================================================
echo   Iniciando servicios de Routh-Agent...
echo ===================================================

cd /d "%~dp0"

echo [0/4] Verificando y descargando actualizaciones del repositorio (GitHub)...
echo - Actualizando Backend...
cd /d "%~dp0backend"
git pull origin main
echo - Actualizando Frontend...
cd /d "%~dp0frontend"
git pull origin main
cd /d "%~dp0"
echo.

echo [1/4] Levantando Base de Datos local (Docker)...
docker compose up -d

echo [2/4] Verificando servicio de Ollama Local...
powershell -Command "if (!(Test-NetConnection -ComputerName localhost -Port 11434 -InformationLevel Quiet)) { Start-Process ollama -ArgumentList 'serve' -WindowStyle Minimized; Write-Host 'Ollama iniciado' } else { Write-Host 'Ollama ya esta activo en el puerto 11434' }"

echo [3/4] Iniciando Backend en nueva ventana...
start "Backend - Routh Agent" cmd /k "cd /d %~dp0backend && npm run dev"

echo [4/4] Iniciando Ngrok en nueva ventana...
:: Si tienes un dominio estatico en ngrok, agrega: --domain=tu-dominio.ngrok-free.app
start "Ngrok - Puerto 8080" cmd /k "ngrok http 8080"

echo.
echo ===================================================
echo   Todos los servicios han sido lanzados con exito!
echo   IA Local (Ollama): http://localhost:11434
echo   Base de Datos: localhost:3306 (Docker)
echo   Redis Local: localhost:6379 (Docker)
echo   phpMyAdmin: http://localhost:8085
echo   Backend WhatsApp: http://localhost:8080
echo ===================================================
timeout /t 5
