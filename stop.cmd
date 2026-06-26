@echo off
REM Stop the gemini-web proxy server
REM Usage: stop.cmd

echo Stopping gemini-web proxy...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    echo Killing PID %%a on port 8080...
    taskkill /F /PID %%a 2>nul
)
echo Done.
