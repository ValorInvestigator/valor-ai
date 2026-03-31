@echo off
echo ========================================================
echo [Valor AI] Starting with Node v22 (bundled)
echo ========================================================

set NODE_EXE=%~dp0node-v22.14.0-win-x64\node.exe
set NPM_CMD=%~dp0node-v22.14.0-win-x64\npm.cmd

echo [Valor AI] Using Node: %NODE_EXE%
%NODE_EXE% --version

echo [Valor AI] Building...
call %NPM_CMD% run build

echo [Valor AI] Launching...
%NODE_EXE% dist/start.js --ingest "D:\Bingaman Master Files Old\Home Base Claude"

pause
