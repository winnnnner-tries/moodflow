@echo off
set /p commit_msg="Enter commit message (or press Enter for 'Auto-update'): "
if "%commit_msg%"=="" set commit_msg=Auto-update

echo Staging changes...
git add .

echo Committing changes...
git commit -m "%commit_msg%"

echo Pushing to GitHub...
git push

echo.
echo Code pushed successfully! Vercel and Render will start redeploying now.
pause
