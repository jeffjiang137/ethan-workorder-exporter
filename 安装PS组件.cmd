@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-ps-native.ps1"
if errorlevel 1 (echo Installation failed. See details above.) else (echo Installation completed.)
pause
