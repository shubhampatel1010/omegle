import { useEffect, useRef, useState } from "react";

function App() {
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
  const connectSocket = () => {
    if (ws.current) ws.current.close();

    ws.current = new WebSocket(
      "wss://omeglebackend-production.up.railway.app/ws"
    );

    setStatus("Connecting...");
    setMessages([]);

    ws.current.onmessage = (event) => {
      const msg = event.data;

      if (msg === "WAITING") {
        setStatus("Waiting for stranger...");
        return;
      }

      if (msg === "MATCHED") {
        setStatus("Connected to a stranger");
        return;
      }

      if (msg === "PARTNER_LEFT") {
        setStatus("Stranger left. Waiting...");
        setMessages([]);
        return;
      }

      // Stranger message
      setMessages((prev) => [...prev, { from: "Stranger", text: msg }]);

      // 🔔 Notification
      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState === "hidden"
      ) {
        const n = new Notification("New message from Stranger", {
          body: msg,
        });

        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    };
  };

  // Initial connection
  useEffect(() => {
    connectSocket();
    return () => ws.current && ws.current.close();
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;
    ws.current.send(input);
    setMessages((prev) => [...prev, { from: "You", text: input }]);
    setInput("");
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleKeyPress = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  return (
    <div style={styles.container}>
      <div style={styles.chatContainer}>
        <h2 style={styles.title}>Anonymous Random Chat</h2>
        <p style={styles.status}>{status}</p>

        {/* 🔔 Notification permission */}
        {Notification.permission !== "granted" && (
          <button style={styles.notifyBtn} onClick={enableNotifications}>
            Enable Notifications 🔔
          </button>
        )}

        {/* 🔄 New Stranger button */}
        <button style={styles.newBtn} onClick={connectSocket}>
          New Stranger 🔄
        </button>

        <div style={styles.messages}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...styles.message,
                alignSelf: m.from === "You" ? "flex-end" : "flex-start",
                backgroundColor: m.from === "You" ? "#DCF8C6" : "#FFF",
              }}
            >
              <b>{m.from}:</b> {m.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div style={styles.inputContainer}>
          <input
            style={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message..."
          />
          <button style={styles.button} onClick={sendMessage}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    backgroundColor: "#F0F2F5",
    fontFamily: "Arial, sans-serif",
  },
  chatContainer: {
    display: "flex",
    flexDirection: "column",
    width: "400px",
    height: "650px",
    border: "1px solid #ccc",
    borderRadius: "10px",
    backgroundColor: "#FAFAFA",
    padding: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  },
  title: { textAlign: "center" },
  status: { textAlign: "center", fontStyle: "italic" },

  notifyBtn: {
    background: "#ff9800",
    color: "#fff",
    border: "none",
    padding: "6px",
    borderRadius: "6px",
    marginBottom: "6px",
    cursor: "pointer",
  },
  newBtn: {
    background: "#2196F3",
    color: "#fff",
    border: "none",
    padding: "8px",
    borderRadius: "6px",
    marginBottom: "10px",
    cursor: "pointer",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "10px",
    border: "1px solid #e0e0e0",
    borderRadius: "10px",
    backgroundColor: "#FFF",
  },
  message: {
    padding: "8px 12px",
    borderRadius: "15px",
    maxWidth: "70%",
  },
  inputContainer: {
    display: "flex",
    gap: "10px",
    marginTop: "10px",
  },
  input: {
    flex: 1,
    padding: "10px",
    borderRadius: "20px",
    border: "1px solid #ccc",
  },
  button: {
    padding: "10px 20px",
    borderRadius: "20px",
    border: "none",
    backgroundColor: "#4CAF50",
    color: "#fff",
    cursor: "pointer",
  },
};

export default App;
