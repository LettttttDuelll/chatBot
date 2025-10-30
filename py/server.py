from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
import json
import asyncio
from langchain_chroma import Chroma
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from typing import List, Optional

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
# RAG components
# -----------------------------
BASE_DIR = os.path.dirname(__file__)
RAG_DATA_DIR = os.path.join(BASE_DIR, "rag_data")
RAG_DB_DIR = os.path.join(BASE_DIR, "rag_db")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "mxbai-embed-large")

embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)


def create_vector_store() -> Optional[Chroma]:
    if os.path.isdir(RAG_DB_DIR) and os.listdir(RAG_DB_DIR):
        try:
            return Chroma(
                persist_directory=RAG_DB_DIR,
                embedding_function=embeddings,
            )
        except Exception:
            return None

    if not os.path.isdir(RAG_DATA_DIR):
        return None

    documents = []
    for root, _, files in os.walk(RAG_DATA_DIR):
        for filename in files:
            path = os.path.join(root, filename)
            loader = TextLoader(path, encoding="utf-8")
            documents.extend(loader.load())

    if not documents:
        return None

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
    chunks = splitter.split_documents(documents)
    store = Chroma.from_documents(
        chunks,
        embeddings,
        persist_directory=RAG_DB_DIR,
    )
    return store


vector_store = create_vector_store()


def retrieve_context(query: str, k: int = 3) -> str:
    if not query or vector_store is None:
        return ""
    results = vector_store.similarity_search(query, k=k)
    snippets: List[str] = []
    for doc in results:
        meta = doc.metadata or {}
        source = meta.get("source", "document")
        snippets.append(f"[{source}] {doc.page_content}")
    return "\n\n".join(snippets)

# -----------------------------
# 1️⃣ API STREAM
# -----------------------------
@app.post("/api/stream")
async def stream_api(request: Request):
    payload = await request.json()
    user_prompt = payload.get("prompt", "")
    context = retrieve_context(user_prompt)
    if context:
        payload["prompt"] = (
            "Bạn là trợ lý thân thiện. Sử dụng thông tin trong Context nếu phù hợp.\n"
            f"Context:\n{context}\n\n"
            f"User: {user_prompt}\nAssistant:"
        )

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
    user_prompt = payload.get("prompt", "")
    context = retrieve_context(user_prompt)
    if context:
        payload["prompt"] = (
            "Bạn là trợ lý thân thiện. Sử dụng thông tin trong Context nếu phù hợp.\n"
            f"Context:\n{context}\n\n"
            f"User: {user_prompt}\nAssistant:"
        )

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
