// server.mjs
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const MODEL_URL = process.env.MODEL_URL ?? "http://127.0.0.1:11434/v1/completions";
const app = express();
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"] }));
app.use(express.json());

app.post("/api/stream", async (req, res) => {
  const userName = req.headers["x-user-name"] || req.body.userName || "Friend";
  const { prompt = "", ...rest } = req.body || {};

  // prefix system hướng dẫn cách xưng hô
  const SYSTEM = `You are a helpful assistant. The user's name is ${userName}. 
  Address them by name when natural, and do not invent a different name.`;
  const payload = { ...rest, stream: true, keep_alive: 6000, prompt: `${SYSTEM}\n\nUSER: ${prompt}\nASSISTANT:` };//
  
  const upstream = await fetch(MODEL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify(payload)
  });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  upstream.body.on("data", chunk => res.write(chunk));
  upstream.body.on("end", () => res.end());
  upstream.body.on("error", () => res.end("data: [DONE]\n\n"));
});

app.post("/api/complete", async (req, res) => {
  const payload = { ...req.body, stream: false };
  const upstream = await fetch(MODEL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await upstream.json();
  res.json(json);
});

app.listen(8000, () => console.log("API on http://localhost:8000"));
