import os
import asyncio
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Resolve and load environment variables
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(dotenv_path=env_path)

# Import routers
from routers import feed, tracks, profile, sync
from services.trending import daily_trending_sync_task

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run the daily sync task in the background on startup
    asyncio.create_task(daily_trending_sync_task())
    yield

app = FastAPI(
    title="MoodFlow API",
    description="Backend API for the MoodFlow music application, providing parametric feeds and search services.",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS middleware
frontend_url_env = os.getenv("FRONTEND_URL", "")
origins = ["http://localhost:5173", "http://localhost:4173"]
if frontend_url_env:
    origins.extend([url.strip() for url in frontend_url_env.split(",")])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
)

# Register routers
app.include_router(feed.router, tags=["Feed"])
app.include_router(tracks.router, tags=["Tracks"])
app.include_router(profile.router, tags=["Profiles"])
app.include_router(sync.router, tags=["Sync"])

from pydantic import BaseModel

class LogPayload(BaseModel):
    level: str
    message: str
    track_name: Optional[str] = None
    error: Optional[str] = None

@app.post("/log")
def log_frontend_message(payload: LogPayload):
    from datetime import datetime
    print(f"\n[FRONTEND LOG - {payload.level.upper()}] {payload.message}")
    if payload.track_name:
        print(f"  Track: {payload.track_name}")
    if payload.error:
        print(f"  Error Detail: {payload.error}")
        
    log_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend_debug.log")
    try:
        with open(log_file_path, "a", encoding="utf-8") as f:
            timestamp = datetime.now().isoformat()
            f.write(f"[{timestamp}] [{payload.level.upper()}] {payload.message}\n")
            if payload.track_name:
                f.write(f"  Track: {payload.track_name}\n")
            if payload.error:
                f.write(f"  Error: {payload.error}\n")
            f.write("-" * 40 + "\n")
    except Exception as e:
        print(f"Failed to write log file: {e}")
        
    return {"status": "logged"}

@app.get("/")
def read_root():
    return {"message": "Welcome to the MoodFlow API!"}


if __name__ == "__main__":
    import uvicorn
    # Start the server, dynamically binding to the port set by Render (or 8000 default)
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
