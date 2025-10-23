import React, { useEffect, useRef, useState } from "react";

// ChatGPT-like UI (single-file React component)
// - Uses Tailwind CSS classes (add Tailwind to your project or convert classes to your CSS)
// - Keeps conversations in localStorage so previous chats persist
// - Uses existing backend endpoints: /api/stream (SSE) and /api/complete
// - Minimal, reusable subcomponents included in this file

export default function ChatApp() {
  // conversations: array of { id, title, messages: [{role: 'user'|'assistant', text, time}] }
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    const raw = localStorage.getItem("llm_conversations_v1");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setConversations(parsed);
        if (parsed.length) setActiveConvId(parsed[0].id);
      } catch (e) {
        console.warn("Failed to parse saved conversations", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("llm_conversations_v1", JSON.stringify(conversations));
  }, [conversations]);

  function createNewConversation() {
    const id = String(Date.now());
    const conv = { id, title: "New chat", messages: [] };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(id);
  }

  function deleteConversation(id) {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConvId === id) setActiveConvId(prev => (conversations[1] ? conversations[1].id : null));
  }

  function updateActiveConversation(updater) {
    setConversations(prev => prev.map(c => (c.id === activeConvId ? updater(c) : c)));
  }

  const activeConv = conversations.find(c => c.id === activeConvId) || null;

  const send = async () => {
    if (!input.trim() || !activeConvId) return;
    const userText = input.trim();
    setInput("");

    // append user message
    updateActiveConversation(conv => ({
      ...conv,
      messages: [...conv.messages, { role: "user", text: userText, time: Date.now() }]
    }));

    setLoading(true);

    // prepare payload for model
    const payload = {
      model: "llama3.2:1b",
      prompt: userText,
      max_tokens: 2048,
      stream: true
    };

    // start streaming
    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("http://localhost:8000/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Upstream error: ${res.status} ${txt}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = part.slice(6).trim();
          if (data === "[DONE]") {
            // finalize
            updateActiveConversation(conv => ({
              ...conv,
              messages: [...conv.messages, { role: "assistant", text: assistantText, time: Date.now() }]
            }));
            setLoading(false);
            abortRef.current = null;
            return;
          }

          try {
            const json = JSON.parse(data);
            const piece = json.choices?.[0]?.text ?? "";
            if (piece) {
              assistantText += piece;
              // show streaming partials as a temporary assistant message
              updateActiveConversation(conv => {
                const msgs = conv.messages.slice();
                // replace or append a temporary assistant message
                const last = msgs[msgs.length - 1];
                if (last && last.role === 'assistant' && last._temp) {
                  last.text = assistantText;
                } else {
                  msgs.push({ role: 'assistant', text: assistantText, time: Date.now(), _temp: true });
                }
                return { ...conv, messages: msgs };
              });
            }
          } catch (err) {
            // ignore non-json keepalive lines
          }
        }
      }

      // fallback: if stream ended without [DONE]
      updateActiveConversation(conv => ({
        ...conv,
        messages: [...conv.messages, { role: "assistant", text: assistantText, time: Date.now() }]
      }));
    } catch (err) {
      console.error(err);
      updateActiveConversation(conv => ({
        ...conv,
        messages: [...conv.messages, { role: "assistant", text: `(error) ${err.message}`, time: Date.now() }]
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setLoading(false);
    abortRef.current = null;
  };

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Local LLM</h1>
          <button className="text-sm text-blue-600" onClick={createNewConversation}>New</button>
        </div>

        <div className="flex-1 overflow-auto">
          {conversations.length === 0 && (
            <div className="text-sm text-gray-500">No conversations yet — click New to start</div>
          )}
          <ul className="space-y-2 mt-2">
            {conversations.map(conv => (
              <li key={conv.id}>
                <button
                  onClick={() => setActiveConvId(conv.id)}
                  className={`w-full text-left p-2 rounded-md flex items-center justify-between ${conv.id === activeConvId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                  <div className="truncate">{conv.title || 'Untitled'}</div>
                  <div className="text-xs text-red-500" onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>Delete</div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-gray-400">Server: http://localhost:8000</div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-6">
          {!activeConv && (
            <div className="h-full flex items-center justify-center text-gray-400">Select or start a conversation</div>
          )}

          {activeConv && (
            <div className="max-w-3xl mx-auto">
              <div className="mb-4">
                <input
                  value={activeConv.title}
                  onChange={(e) => setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, title: e.target.value } : c))}
                  className="w-full text-2xl font-semibold bg-transparent outline-none"
                />
              </div>

              <div className="space-y-4">
                {activeConv.messages.map((m, idx) => (
                  <MessageBubble key={idx} message={m} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t p-4 bg-white">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 items-start">
              <textarea
                rows={2}
                value={input}
                onChange={e => setInput(e.target.value)}
                className="flex-1 p-3 rounded-md border resize-none"
                placeholder="Nhập prompt..."
              />
              <div className="flex flex-col gap-2">
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md" onClick={send} disabled={loading || !input.trim()}>Send</button>
                <button className="px-4 py-2 border rounded-md" onClick={cancel} disabled={!loading}>Cancel</button>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-2">Tip: conversations are saved locally in your browser (localStorage)</div>
          </div>
        </div>
      </main>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const date = new Date(message.time || Date.now()).toLocaleString();
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] p-3 rounded-lg ${isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
        <div className="text-xs text-gray-400 mt-2 text-right">{date}</div>
      </div>
    </div>
  );
}
