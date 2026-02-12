import { useEffect, useRef, useState } from "react";

function App() {
  const [mode, setMode] = useState("random"); // random | group
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const ws = useRef(null);
  const messagesEndRef = useRef(null);

  // 🔔 Enable notifications
  const enableNotifications = () => {
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  };

  // 🔌 Connect WebSocket
  const connectSocket = (selectedMode = mode) => {
    if (ws.current) ws.current.close();

    ws.current = new WebSocket(
      `wss://omeglebackend-production.up.railway.app/ws?mode=${selectedMode}`
    );

    setMessages([]);
    setStatus("Connecting...");

    ws.current.onmessage = (event) => {
      const msg = event.data;

      if (msg === "WAITING") return setStatus("Waiting for stranger...");
      if (msg === "MATCHED") return setStatus("Connected to stranger");
      if (msg === "PARTNER_LEFT") return setStatus("Stranger left. Waiting...");
      if (msg === "CONNECTED_TO_GROUP") return setStatus("Connected to group chat");

      setMessages((prev) => [...prev, { from: "Stranger", text: msg }]);

      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
        const n = new Notification("New message", { body: msg });
        n.onclick = () => { window.focus(); n.close(); };
      }
    };
  };

  useEffect(() => {
    connectSocket();
    return () => ws.current && ws.current.close();
  }, [mode]);

  const sendMessage = () => {
    if (!input.trim()) return;
    ws.current.send(input);
    setMessages((prev) => [...prev, { from: "You", text: input }]);
    setInput("");
  };

  const newStranger = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send("NEW_STRANGER");
      setMessages([]);
      setStatus("Looking for new stranger...");
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getStatusDot = () => {
    if (status.includes("Connected")) return styles.dotGreen;
    if (status.includes("Waiting") || status.includes("Looking")) return styles.dotAmber;
    return styles.dotGrey;
  };

  return (
    <>
      <style>{globalStyles}</style>
      <div style={styles.pageWrapper}>
        {/* Decorative blobs */}
        <div style={styles.blobTopRight} />
        <div style={styles.blobBottomLeft} />

        <div style={styles.card}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerIcon}>💬</div>
            <div>
              <h2 style={styles.title}>Obscura</h2>
              <p style={styles.subtitle}>Connect with strangers worldwide</p>
            </div>
          </div>

          {/* Status bar */}
          <div style={styles.statusBar}>
            <span style={{ ...styles.statusDot, ...getStatusDot() }} />
            <span style={styles.statusText}>{status}</span>
          </div>

          {/* Mode Toggle */}
          <div style={styles.modeToggle}>
            <button
              style={mode === "random" ? { ...styles.toggleBtn, ...styles.toggleBtnActive } : styles.toggleBtn}
              onClick={() => setMode("random")}
            >
              🔀 Stranger
            </button>
            <button
              style={mode === "group" ? { ...styles.toggleBtn, ...styles.toggleBtnActive } : styles.toggleBtn}
              onClick={() => setMode("group")}
            >
              👥 Group
            </button>
          </div>

          {/* Action Buttons */}
          <div style={styles.actionRow}>
            {mode === "random" && (
              <button style={styles.newBtn} onClick={newStranger} className="ripple-btn">
                <span>🔄</span> New Stranger
              </button>
            )}
            {Notification.permission !== "granted" && (
              <button style={styles.notifyBtn} onClick={enableNotifications} className="ripple-btn">
                <span>🔔</span> Enable Alerts
              </button>
            )}
          </div>

          {/* Messages */}
          <div style={styles.messagesBox}>
            {messages.length === 0 && (
              <div style={styles.emptyState}>
                <span style={styles.emptyIcon}>🌐</span>
                <p style={styles.emptyText}>No messages yet. Say hello!</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.messageRow,
                  justifyContent: m.from === "You" ? "flex-end" : "flex-start",
                }}
              >
                {m.from !== "You" && <div style={styles.avatarStranger}>S</div>}
                <div
                  style={{
                    ...styles.bubble,
                    ...(m.from === "You" ? styles.bubbleYou : styles.bubbleStranger),
                  }}
                >
                  <span style={styles.bubbleSender}>{m.from}</span>
                  <span style={styles.bubbleText}>{m.text}</span>
                </div>
                {m.from === "You" && <div style={styles.avatarYou}>Y</div>}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div style={styles.inputArea}>
            <input
              style={styles.textInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message..."
            />
            <button style={styles.sendBtn} onClick={sendMessage} className="send-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Global CSS ────────────────────────────────────────────────────────────────
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Nunito', sans-serif;
    background: #F5F0FA;
  }

  .ripple-btn:active {
    transform: scale(0.96);
    transition: transform 0.1s ease;
  }

  .send-btn:hover {
    background: linear-gradient(135deg, #7C5CBF, #5B8DEF) !important;
    transform: scale(1.05);
    box-shadow: 0 6px 20px rgba(107, 81, 191, 0.45) !important;
  }

  .send-btn:active {
    transform: scale(0.97);
  }

  /* Custom scrollbar */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D8C9F0; border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: #B39DDB; }

  /* Input focus */
  input:focus { outline: none; }

  /* Message pop-in */
  @keyframes popIn {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Status pulse */
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.6; transform: scale(1.3); }
  }

  /* Blob float */
  @keyframes blobFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50%       { transform: translate(-20px, 20px) scale(1.05); }
  }
`;

// ─── Inline Styles ─────────────────────────────────────────────────────────────
const styles = {
  pageWrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(145deg, #EDE7F6 0%, #E8F0FE 50%, #FCE4EC 100%)",
    fontFamily: "'Nunito', sans-serif",
    position: "relative",
    overflow: "hidden",
    padding: "20px",
  },

  // Decorative blobs
  blobTopRight: {
    position: "fixed",
    top: "-80px",
    right: "-80px",
    width: "320px",
    height: "320px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(186,149,255,0.25) 0%, transparent 70%)",
    animation: "blobFloat 8s ease-in-out infinite",
    pointerEvents: "none",
  },
  blobBottomLeft: {
    position: "fixed",
    bottom: "-80px",
    left: "-80px",
    width: "280px",
    height: "280px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(100,181,246,0.2) 0%, transparent 70%)",
    animation: "blobFloat 10s ease-in-out infinite reverse",
    pointerEvents: "none",
  },

  card: {
    display: "flex",
    flexDirection: "column",
    width: "420px",
    maxWidth: "100%",
    height: "680px",
    borderRadius: "24px",
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 20px 60px rgba(124,92,191,0.15), 0 4px 16px rgba(0,0,0,0.06)",
    padding: "24px",
    gap: "14px",
    position: "relative",
    zIndex: 1,
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingBottom: "14px",
    borderBottom: "1px solid rgba(186,149,255,0.2)",
  },
  headerIcon: {
    fontSize: "28px",
    width: "48px",
    height: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #EDE7F6, #E8EAF6)",
    boxShadow: "0 2px 8px rgba(124,92,191,0.15)",
    flexShrink: 0,
  },
  title: {
    fontSize: "20px",
    fontWeight: "800",
    color: "#3D2B6B",
    letterSpacing: "-0.3px",
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: "12px",
    color: "#9B8BB4",
    fontWeight: "500",
    marginTop: "2px",
  },

  // Status
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #F3EEFF, #EEF2FF)",
    border: "1px solid rgba(186,149,255,0.25)",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
    animation: "pulse 2s ease-in-out infinite",
  },
  dotGreen: { background: "#4CAF87", boxShadow: "0 0 6px rgba(76,175,135,0.5)" },
  dotAmber: { background: "#F4A23A", boxShadow: "0 0 6px rgba(244,162,58,0.5)" },
  dotGrey:  { background: "#B0A8C4", boxShadow: "0 0 6px rgba(176,168,196,0.4)" },
  statusText: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#5C4A8A",
  },

  // Mode Toggle
  modeToggle: {
    display: "flex",
    gap: "8px",
    padding: "4px",
    background: "#EDE7F6",
    borderRadius: "14px",
  },
  toggleBtn: {
    flex: 1,
    padding: "9px 0",
    fontSize: "13px",
    fontWeight: "700",
    border: "none",
    borderRadius: "11px",
    cursor: "pointer",
    background: "transparent",
    color: "#9B8BB4",
    transition: "all 0.2s ease",
    fontFamily: "'Nunito', sans-serif",
  },
  toggleBtnActive: {
    background: "#fff",
    color: "#6B51BF",
    boxShadow: "0 2px 10px rgba(107,81,191,0.18)",
  },

  // Action Buttons
  actionRow: {
    display: "flex",
    gap: "8px",
  },
  newBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "9px 16px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(107,81,191,0.3)",
    transition: "all 0.2s ease",
  },
  notifyBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "9px 16px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #F6A947, #F47C7C)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(244,120,80,0.3)",
    transition: "all 0.2s ease",
  },

  // Messages
  messagesBox: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "14px",
    borderRadius: "18px",
    background: "linear-gradient(160deg, #F9F7FF 0%, #F0F4FF 100%)",
    border: "1px solid rgba(186,149,255,0.18)",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    margin: "auto",
    paddingTop: "30px",
  },
  emptyIcon: { fontSize: "36px", opacity: 0.4 },
  emptyText: {
    fontSize: "13px",
    color: "#B0A8C4",
    fontWeight: "600",
    fontStyle: "italic",
  },

  // Message rows
  messageRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    animation: "popIn 0.25s ease",
  },
  avatarStranger: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #CE93D8, #9575CD)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: "800",
    color: "#fff",
    flexShrink: 0,
    boxShadow: "0 2px 6px rgba(149,117,205,0.35)",
  },
  avatarYou: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #80DEEA, #4FC3F7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: "800",
    color: "#fff",
    flexShrink: 0,
    boxShadow: "0 2px 6px rgba(79,195,247,0.35)",
  },
  bubble: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "68%",
    padding: "10px 14px",
    borderRadius: "18px",
    lineHeight: 1.5,
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  },
  bubbleStranger: {
    background: "#fff",
    borderBottomLeftRadius: "4px",
    border: "1px solid rgba(186,149,255,0.2)",
  },
  bubbleYou: {
    background: "linear-gradient(135deg, #B39DDB, #90CAF9)",
    borderBottomRightRadius: "4px",
    border: "none",
  },
  bubbleSender: {
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    marginBottom: "3px",
    opacity: 0.65,
    color: "inherit",
  },
  bubbleText: {
    fontSize: "14px",
    fontWeight: "500",
    color: "#3D2B6B",
    wordBreak: "break-word",
  },

  // Input area
  inputArea: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    borderRadius: "18px",
    background: "#fff",
    border: "1.5px solid rgba(186,149,255,0.3)",
    boxShadow: "0 2px 12px rgba(124,92,191,0.08)",
    transition: "border-color 0.2s ease",
  },
  textInput: {
    flex: 1,
    border: "none",
    background: "transparent",
    fontSize: "14px",
    fontWeight: "500",
    color: "#3D2B6B",
    fontFamily: "'Nunito', sans-serif",
    caretColor: "#8B6AD1",
  },
  sendBtn: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 4px 14px rgba(107,81,191,0.35)",
    transition: "all 0.2s ease",
  },
};

export default App;