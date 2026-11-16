@echo off
rem Rempart - enleve toutes les protections et remet Internet comme avant (demande les droits administrateur).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remise-a-zero.ps1"
