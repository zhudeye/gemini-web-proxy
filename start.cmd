@echo off
REM Start gemini-web proxy, loading environment from .env
REM Usage: start.cmd

setlocal enabledelayedexpansion

REM Load .env into process environment
for /f "usebackq delims=" %%a in (".env") do (
    set "line=%%a"
    REM Skip comments and empty lines
    if not "!line!"=="" if "!line:~0,1!" neq "#" if "!line:~0,1!" neq ";" (
        REM Split on first =
        for /f "tokens=1,* delims==" %%b in ("!line!") do (
            set "key=%%b"
            set "val=%%c"
            REM Strip surrounding quotes if present
            if "!val:~0,1!"==""^" if "!val:~-1!"==""^" set "val=!val:~1,-1!"
            set "key=!key: =!"
            if not "!key!"=="" set "!key!=!val!"
        )
    )
)

echo Starting gemini-web proxy on port %PORT%...
start /B /MIN "" node dist\server.js
echo PID: !ERRORLEVEL!
echo.
echo Proxy running at http://127.0.0.1:%PORT%/v1/chat/completions
echo API Key: %API_KEYS%
