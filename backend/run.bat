@echo off
REM Quick start script for IMDB Vision AI Backend

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  IMDB Vision AI - Product Extraction Backend              ║
echo ║  Rule-Based Engine (No Gemini Required)                  ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Check if Python 3.13 is installed
py -3.13 --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Python 3.13 is not installed
    echo Please install Python 3.13
    pause
    exit /b 1
)

REM Check if dependencies are installed
py -3.13 -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    py -3.13 -m pip install -r requirements.txt
    if errorlevel 1 (
        echo ✗ Failed to install dependencies
        pause
        exit /b 1
    )
)

echo ✓ Dependencies verified
echo.
echo Starting FastAPI server...
echo.
echo 📍 API will be available at: http://localhost:8000
echo 📖 Swagger UI: http://localhost:8000/docs
echo 📘 ReDoc: http://localhost:8000/redoc
echo.
echo Press Ctrl+C to stop the server
echo.

py -3.13 app.py
