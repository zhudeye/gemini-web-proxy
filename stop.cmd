@echo off
REM Stop the gemini-web proxy server
REM Usage: stop.cmd

echo Stopping gemini-web proxy...
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID:"') do (
    for /f "tokens=1" %%b in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%b 2>nul
    )
)
echo Done.
