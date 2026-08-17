@echo off
REM Corre el Procore Tracker. Pensado para usarse con el Programador de
REM Tareas de Windows (ver README.md, sección "Automatízalo en tu compu").
REM
REM Ajusta la ruta de abajo si tu carpeta del proyecto está en otro lugar.

cd /d "%~dp0"
call .venv\Scripts\activate.bat
python tracker.py >> tracker.log 2>&1
