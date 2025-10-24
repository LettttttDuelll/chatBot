from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
import json
import asyncio

app = FastAPI()

# -----------------------------
# CORS Middleware
# -----------------------------
origins = [
    "http://localhost:5173",
    "http://localhost:3000"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Model URL configuration
# -----------------------------
MODEL_URL = os.getenv("MODEL_URL", "http://127.0.0.1:11434/v1/completions")

# -----------------------------
# 1️⃣ API STREAM
# -----------------------------
@app.post("/api/stream")
async def stream_api(request: Request):
    payload = await request.json()

    async def event_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                MODEL_URL,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream"
                },
                content=json.dumps(payload)
            ) as upstream:
                async for chunk in upstream.aiter_text():
                     for line in chunk.splitlines():
        # Chỉ gửi lại những dòng bắt đầu bằng "data: "
                        if line.startswith("data: "):
                         yield f"{line}\n\n"
        yield "data: [DONE]\n\n"  # end of stream signal

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# -----------------------------
# 2️⃣ API COMPLETE
# -----------------------------
@app.post("/api/complete")
async def complete_api(request: Request):
    """
    
    """
    payload = await request.json()
    payload["stream"] = False

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            MODEL_URL,
            headers={"Content-Type": "application/json"},
            content=json.dumps(payload)
        )
        data = resp.json()

    return JSONResponse(content=data)

# -----------------------------
# 3️⃣ Run server
# -----------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
