@echo off
cd /d "%~dp0"
title Satpraxis TK Scheduler - Local Test v7
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 pause
