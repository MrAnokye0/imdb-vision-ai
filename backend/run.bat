@echo off
REM Quick start script for IMDB Vision AI Backend

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  IMDB Vision AI - Product Extraction Backend              ║
echo ║  Rule-Based Engine (No Gemini Required)                  ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://www.python.org
    pause
    exit /b 1
)

REM Check if dependencies are installed
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
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

python app.py
