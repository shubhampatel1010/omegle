import { useEffect, useRef, useState } from "react";

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const ws = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    ws.current = new WebSocket("ws://localhost:8000/ws");

    ws.current.onmessage = (event) => {
      if (event.data === "WAITING") {
        setStatus("Waiting for stranger...");
      } else if (event.data === "MATCHED") {
        setStatus("Connected to a stranger");
      } else if (event.data === "PARTNER_LEFT") {
        setStatus("Stranger left. Waiting...");
        setMessages([]);
      } else {
        setMessages((prev) => [...prev, { from: "Stranger", text: event.data }]);
      }
    };

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
    height: "600px",
    border: "1px solid #ccc",
    borderRadius: "10px",
    backgroundColor: "#FAFAFA",
    padding: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  },
  title: {
    margin: "0 0 10px 0",
    textAlign: "center",
    color: "#333",
  },
  status: {
    textAlign: "center",
    marginBottom: "10px",
    fontStyle: "italic",
    color: "#666",
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
    marginBottom: "10px",
  },
  message: {
    padding: "8px 12px",
    borderRadius: "15px",
    maxWidth: "70%",
    wordBreak: "break-word",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  inputContainer: {
    display: "flex",
    gap: "10px",
  },
  input: {
    flex: 1,
    padding: "10px",
    borderRadius: "20px",
    border: "1px solid #ccc",
    outline: "none",
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
