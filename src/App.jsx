import { useEffect, useRef, useState, useCallback } from "react";

// ─── WebRTC ICE config ─────────────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
  ],
};

function App() {
  const [mode, setMode] = useState("random");
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  // ── Video call state ─────────────────────────────────────────────────────────
  const [callState, setCallState] = useState("idle"); // idle | calling | ringing | in-call
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const ws = useRef(null);
  const messagesEndRef = useRef(null);
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  // BUG FIX 1: store remote stream so we can attach it once the video element mounts
  const remoteStreamRef = useRef(null);
  const callTimerRef = useRef(null);
  const pendingCandidates = useRef([]);

  // ─── Notifications ───────────────────────────────────────────────────────────
  const enableNotifications = () => {
    if ("Notification" in window) Notification.requestPermission();
  };

  // ─── Attach stream to element safely ─────────────────────────────────────────
  // BUG FIX 2: helper that sets srcObject AND explicitly calls play()
  // because some browsers (especially mobile) won't autoplay without it
  const attachStream = (videoEl, stream) => {
    if (!videoEl || !stream) return;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
    videoEl.play().catch(() => {
      // autoplay blocked – user interaction will unblock it
    });
  };

  // BUG FIX 3: whenever remoteVideoRef mounts (callState becomes "in-call"),
  // immediately attach any already-received remote stream
  useEffect(() => {
    if (callState === "in-call") {
      if (remoteStreamRef.current && remoteVideoRef.current) {
        attachStream(remoteVideoRef.current, remoteStreamRef.current);
      }
      if (localStreamRef.current && localVideoRef.current) {
        attachStream(localVideoRef.current, localStreamRef.current);
      }
    }
  }, [callState]);

  // ─── WebRTC helpers ──────────────────────────────────────────────────────────
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: "ice-candidate", candidate }));
      }
    };

    // BUG FIX 4: store remote stream in ref, and ALSO try to attach immediately
    // (in case the video element is already mounted)
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      remoteStreamRef.current = stream;
      // try immediate attach — works if video panel is already rendered
      if (remoteVideoRef.current) {
        attachStream(remoteVideoRef.current, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        hangUp(false);
      }
    };

    // BUG FIX 5: log ICE errors to help debugging
    pc.onicecandidateerror = (e) => {
      console.warn("ICE candidate error:", e.errorCode, e.errorText);
    };

    return pc;
  }, []);

  const cleanupMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidates.current = [];
    clearInterval(callTimerRef.current);
    setCallDuration(0);
    setIsMuted(false);
    setIsCamOff(false);
    setIsFullscreen(false);
  }, []);

  const startLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
    });
    localStreamRef.current = stream;
    // BUG FIX 6: don't assign to ref here — video element may not exist yet.
    // The useEffect above handles attachment when the panel mounts.
    return stream;
  };

  const startCallTimer = () => {
    clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  };

  // BUG FIX 7: flush pending ICE candidates — shared helper used by BOTH sides
  const flushPendingCandidates = async () => {
    if (!pcRef.current) return;
    for (const c of pendingCandidates.current) {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("Failed to add buffered ICE candidate:", err);
      }
    }
    pendingCandidates.current = [];
  };

  const startCall = async () => {
    try {
      setCallState("calling");
      const stream = await startLocalStream();
      const pc = createPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      ws.current?.send(JSON.stringify({ type: "video-offer", sdp: pc.localDescription }));
    } catch (err) {
      console.error("startCall failed:", err);
      setCallState("idle");
      cleanupMedia();
    }
  };

  const acceptCall = async () => {
    try {
      const stream = await startLocalStream();
      stream.getTracks().forEach((t) => pcRef.current.addTrack(t, stream));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      ws.current?.send(JSON.stringify({ type: "video-answer", sdp: pcRef.current.localDescription }));
      // Set state first so video panel mounts, THEN flush candidates
      setCallState("in-call");
      startCallTimer();
      await flushPendingCandidates();
    } catch (err) {
      console.error("acceptCall failed:", err);
      rejectCall();
    }
  };

  const rejectCall = () => {
    ws.current?.send(JSON.stringify({ type: "video-reject" }));
    cleanupMedia();
    setCallState("idle");
  };

  const hangUp = useCallback((notify = true) => {
    if (notify && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "video-end" }));
    }
    cleanupMedia();
    setCallState("idle");
  }, [cleanupMedia]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    // BUG FIX 8: toggle correctly — if currently muted (enabled=false), we want enabled=true
    const newEnabled = isMuted; // isMuted=true means currently muted → enabling → newEnabled=true
    tracks.forEach((t) => { t.enabled = newEnabled; });
    setIsMuted((m) => !m);
  };

  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    const newEnabled = isCamOff;
    tracks.forEach((t) => { t.enabled = newEnabled; });
    setIsCamOff((c) => !c);
  };

  const formatDuration = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // ─── WebSocket connect ───────────────────────────────────────────────────────
  const connectSocket = useCallback((selectedMode = mode) => {
    if (ws.current) ws.current.close();

    ws.current = new WebSocket(
      // `ws://localhost:8000/ws?mode=${selectedMode}`
      `wss://omeglebackend-production.up.railway.app/ws?mode=${selectedMode}`
    );

    setMessages([]);
    setStatus("Connecting...");
    setIsConnected(false);
    hangUp(false);

    ws.current.onmessage = async (event) => {
      const raw = event.data;

      // ── System signals ──────────────────────────────────────────────────────
      if (raw === "WAITING") { setStatus("Waiting for stranger..."); setIsConnected(false); return; }
      if (raw === "MATCHED") { setStatus("Connected to stranger"); setIsConnected(true); return; }
      if (raw === "PARTNER_LEFT") {
        setStatus("Stranger left. Waiting...");
        setIsConnected(false);
        hangUp(false);
        return;
      }
      if (raw === "CONNECTED_TO_GROUP") { setStatus("Connected to group chat"); setIsConnected(true); return; }

      // ── Try JSON (WebRTC signalling) ────────────────────────────────────────
      try {
        const data = JSON.parse(raw);

        if (data.type === "video-offer") {
          // Incoming call — build PC and store the offer's remote description
          const pc = createPeerConnection();
          pcRef.current = pc;
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          setCallState("ringing");
          return;
        }

        if (data.type === "video-answer") {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
            // BUG FIX 9: flush pending candidates on CALLER side too
            await flushPendingCandidates();
            setCallState("in-call");
            startCallTimer();
          }
          return;
        }

        if (data.type === "ice-candidate") {
          if (pcRef.current?.remoteDescription) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              console.warn("addIceCandidate failed:", err);
            }
          } else {
            // Buffer candidates that arrive before remoteDescription is set
            pendingCandidates.current.push(data.candidate);
          }
          return;
        }

        if (data.type === "video-reject") { cleanupMedia(); setCallState("idle"); return; }
        if (data.type === "video-end")    { hangUp(false); return; }

      } catch {
        // not JSON → plain chat message
      }

      // ── Plain chat message ──────────────────────────────────────────────────
      setMessages((prev) => [...prev, { from: "Stranger", text: raw }]);

      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
        const n = new Notification("New message", { body: raw });
        n.onclick = () => { window.focus(); n.close(); };
      }
    };
  }, [mode, hangUp, createPeerConnection, cleanupMedia]);

  useEffect(() => {
    connectSocket();
    return () => {
      ws.current?.close();
      cleanupMedia();
    };
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
      setIsConnected(false);
      hangUp(false);
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

  const showVideoPanel = callState !== "idle";

  return (
    <>
      <style>{globalStyles}</style>
      <div style={styles.pageWrapper}>
        <div style={styles.blobTopRight} />
        <div style={styles.blobBottomLeft} />

        <div style={{ ...styles.card, ...(showVideoPanel ? styles.cardExpanded : {}) }}>

          {/* ── Header ─────────────────────────────────────────────────────────── */}
          <div style={styles.header}>
            <div style={styles.headerIcon}>💬</div>
            <div style={{ flex: 1 }}>
              <h2 style={styles.title}>Obscura</h2>
              <p style={styles.subtitle}>Connect with strangers worldwide</p>
            </div>
            {isConnected && callState === "idle" && (
              <button style={styles.videoCallBtn} onClick={startCall} title="Start video call">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              </button>
            )}
          </div>

          {/* ── Status bar ─────────────────────────────────────────────────────── */}
          <div style={styles.statusBar}>
            <span style={{ ...styles.statusDot, ...getStatusDot() }} />
            <span style={{ ...styles.statusText, flex: 1 }}>{status}</span>
            {callState === "in-call" && (
              <span style={styles.callTimer}>🔴 {formatDuration(callDuration)}</span>
            )}
          </div>

          {/* ── Mode Toggle ─────────────────────────────────────────────────────── */}
          <div style={styles.modeToggle}>
            <button
              style={mode === "random" ? { ...styles.toggleBtn, ...styles.toggleBtnActive } : styles.toggleBtn}
              onClick={() => setMode("random")}
            >🔀 Stranger</button>
            <button
              style={mode === "group" ? { ...styles.toggleBtn, ...styles.toggleBtnActive } : styles.toggleBtn}
              onClick={() => setMode("group")}
            >👥 Group</button>
          </div>

          {/* ── Video Panel ─────────────────────────────────────────────────────── */}
          {showVideoPanel && (
            <div style={{ ...styles.videoPanel, ...(isFullscreen ? styles.videoPanelFullscreen : {}) }}>

              {/* CALLING */}
              {callState === "calling" && (
                <div style={styles.videoOverlay}>
                  <div style={styles.ringWrap}>
                    <div style={styles.ringCircle} />
                    <span style={styles.ringIcon}>📹</span>
                  </div>
                  <p style={styles.overlayLabel}>Calling stranger…</p>
                  <button style={styles.rejectBtn} onClick={() => hangUp(true)}>✕ Cancel</button>
                </div>
              )}

              {/* RINGING */}
              {callState === "ringing" && (
                <div style={styles.videoOverlay}>
                  <div style={styles.ringWrap}>
                    <div style={styles.ringCircle} />
                    <span style={styles.ringIcon}>📞</span>
                  </div>
                  <p style={styles.overlayLabel}>Incoming video call…</p>
                  <div style={styles.incomingBtns}>
                    <button style={styles.acceptBtn} onClick={acceptCall}>✓ Accept</button>
                    <button style={styles.rejectBtn} onClick={rejectCall}>✕ Decline</button>
                  </div>
                </div>
              )}

              {/* IN CALL */}
              {callState === "in-call" && (
                <>
                  {/* Remote — placeholder behind real video */}
                  <div style={styles.remoteVideoPlaceholder}>
                    <span style={{ fontSize: "38px", opacity: 0.2 }}>👤</span>
                  </div>
                  {/* BUG FIX 10: ref callback instead of ref prop so we can call play()
                      the instant the DOM node is created */}
                  <video
                    ref={(el) => {
                      remoteVideoRef.current = el;
                      if (el && remoteStreamRef.current) {
                        attachStream(el, remoteStreamRef.current);
                      }
                    }}
                    autoPlay
                    playsInline
                    // remote video must NOT be muted — this was the #1 audio bug
                    style={styles.remoteVideo}
                  />

                  {/* Local PiP */}
                  {!isCamOff ? (
                    <video
                      ref={(el) => {
                        localVideoRef.current = el;
                        if (el && localStreamRef.current) {
                          attachStream(el, localStreamRef.current);
                        }
                      }}
                      autoPlay
                      playsInline
                      muted   // local preview must be muted to prevent echo
                      style={styles.localPip}
                    />
                  ) : (
                    <div style={styles.localPipOff}>
                      {/* Keep local video element alive (just hidden) so tracks don't stop */}
                      <video
                        ref={(el) => { localVideoRef.current = el; }}
                        autoPlay playsInline muted
                        style={{ display: "none" }}
                      />
                      <span style={{ fontSize: "18px" }}>📷</span>
                    </div>
                  )}

                  {/* Controls */}
                  <div style={styles.callControls}>
                    <button
                      style={{ ...styles.ctrlBtn, ...(isMuted ? styles.ctrlBtnOn : {}) }}
                      onClick={toggleMute}
                      title={isMuted ? "Unmute" : "Mute"}
                    >{isMuted ? "🔇" : "🎤"}</button>

                    <button style={styles.hangUpBtn} onClick={() => hangUp(true)} title="End call">
                      📵
                    </button>

                    <button
                      style={{ ...styles.ctrlBtn, ...(isCamOff ? styles.ctrlBtnOn : {}) }}
                      onClick={toggleCam}
                      title={isCamOff ? "Camera on" : "Camera off"}
                    >{isCamOff ? "🚫" : "📷"}</button>

                    
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Action Buttons ──────────────────────────────────────────────────── */}
          <div style={styles.actionRow}>
            {mode === "random" && (
              <button style={styles.newBtn} onClick={newStranger} className="ripple-btn">
                <span>🔄</span> New Stranger
              </button>
            )}
            {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
              <button style={styles.notifyBtn} onClick={enableNotifications} className="ripple-btn">
                <span>🔔</span> Enable Alerts
              </button>
            )}
          </div>

          {/* ── Messages ────────────────────────────────────────────────────────── */}
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
                style={{ ...styles.messageRow, justifyContent: m.from === "You" ? "flex-end" : "flex-start" }}
              >
                {m.from !== "You" && <div style={styles.avatarStranger}>S</div>}
                <div style={{ ...styles.bubble, ...(m.from === "You" ? styles.bubbleYou : styles.bubbleStranger) }}>
                  <span style={styles.bubbleSender}>{m.from}</span>
                  <span style={styles.bubbleText}>{m.text}</span>
                </div>
                {m.from === "You" && <div style={styles.avatarYou}>Y</div>}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Input Area ──────────────────────────────────────────────────────── */}
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
  body { font-family: 'Nunito', sans-serif; background: #F5F0FA; }

  .ripple-btn:active { transform: scale(0.96); transition: transform 0.1s ease; }

  .send-btn:hover {
    background: linear-gradient(135deg, #7C5CBF, #5B8DEF) !important;
    transform: scale(1.05);
    box-shadow: 0 6px 20px rgba(107,81,191,0.45) !important;
  }
  .send-btn:active { transform: scale(0.97); }

  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D8C9F0; border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: #B39DDB; }

  input:focus { outline: none; }

  @keyframes popIn {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.6; transform: scale(1.3); }
  }
  @keyframes blobFloat {
    0%, 100% { transform: translate(0,0) scale(1); }
    50%       { transform: translate(-20px,20px) scale(1.05); }
  }
  @keyframes ringPulse {
    0%   { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(1.9); opacity: 0; }
  }
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  pageWrapper: {
    minHeight: "100vh",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(145deg, #EDE7F6 0%, #E8F0FE 50%, #FCE4EC 100%)",
    fontFamily: "'Nunito', sans-serif",
    position: "relative", overflow: "hidden", padding: "20px",
  },
  blobTopRight: {
    position: "fixed", top: "-80px", right: "-80px",
    width: "320px", height: "320px", borderRadius: "50%",
    background: "radial-gradient(circle, rgba(186,149,255,0.25) 0%, transparent 70%)",
    animation: "blobFloat 8s ease-in-out infinite", pointerEvents: "none",
  },
  blobBottomLeft: {
    position: "fixed", bottom: "-80px", left: "-80px",
    width: "280px", height: "280px", borderRadius: "50%",
    background: "radial-gradient(circle, rgba(100,181,246,0.2) 0%, transparent 70%)",
    animation: "blobFloat 10s ease-in-out infinite reverse", pointerEvents: "none",
  },
  card: {
    display: "flex", flexDirection: "column",
    width: "420px", maxWidth: "100%", height: "680px",
    borderRadius: "24px",
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 20px 60px rgba(124,92,191,0.15), 0 4px 16px rgba(0,0,0,0.06)",
    padding: "24px", gap: "14px",
    position: "relative", zIndex: 1,
    transition: "height 0.35s cubic-bezier(0.4,0,0.2,1)",
    overflow: "hidden",
  },
  cardExpanded: { height: "900px" },

  header: {
    display: "flex", alignItems: "center", gap: "12px",
    paddingBottom: "14px", borderBottom: "1px solid rgba(186,149,255,0.2)",
  },
  headerIcon: {
    fontSize: "28px", width: "48px", height: "48px",
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #EDE7F6, #E8EAF6)",
    boxShadow: "0 2px 8px rgba(124,92,191,0.15)", flexShrink: 0,
  },
  title: { fontSize: "20px", fontWeight: "800", color: "#3D2B6B", letterSpacing: "-0.3px", lineHeight: 1.2 },
  subtitle: { fontSize: "12px", color: "#9B8BB4", fontWeight: "500", marginTop: "2px" },
  videoCallBtn: {
    width: "42px", height: "42px", borderRadius: "13px", border: "none",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    color: "#fff", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, boxShadow: "0 4px 14px rgba(107,81,191,0.4)",
    transition: "all 0.2s ease", animation: "fadeSlideIn 0.3s ease",
  },

  statusBar: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "10px 14px", borderRadius: "12px",
    background: "linear-gradient(135deg, #F3EEFF, #EEF2FF)",
    border: "1px solid rgba(186,149,255,0.25)",
  },
  statusDot: {
    width: "8px", height: "8px", borderRadius: "50%",
    flexShrink: 0, animation: "pulse 2s ease-in-out infinite",
  },
  dotGreen: { background: "#4CAF87", boxShadow: "0 0 6px rgba(76,175,135,0.5)" },
  dotAmber: { background: "#F4A23A", boxShadow: "0 0 6px rgba(244,162,58,0.5)" },
  dotGrey:  { background: "#B0A8C4", boxShadow: "0 0 6px rgba(176,168,196,0.4)" },
  statusText: { fontSize: "13px", fontWeight: "600", color: "#5C4A8A" },
  callTimer: {
    fontSize: "12px", fontWeight: "700", color: "#E53935",
    background: "rgba(229,57,53,0.1)", padding: "3px 9px",
    borderRadius: "8px", letterSpacing: "0.4px", flexShrink: 0,
  },

  modeToggle: {
    display: "flex", gap: "8px", padding: "4px",
    background: "#EDE7F6", borderRadius: "14px",
  },
  toggleBtn: {
    flex: 1, padding: "9px 0", fontSize: "13px", fontWeight: "700",
    border: "none", borderRadius: "11px", cursor: "pointer",
    background: "transparent", color: "#9B8BB4",
    transition: "all 0.2s ease", fontFamily: "'Nunito', sans-serif",
  },
  toggleBtnActive: { background: "#fff", color: "#6B51BF", boxShadow: "0 2px 10px rgba(107,81,191,0.18)" },

  videoPanel: {
    position: "relative", width: "100%", height: "230px",
    borderRadius: "18px", background: "#120c1e",
    overflow: "hidden", flexShrink: 0,
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.07)",
    animation: "fadeSlideIn 0.3s ease",
  },
  videoPanelFullscreen: {
    position: "fixed", inset: 0, zIndex: 9999,
    borderRadius: 0, height: "100vh", width: "100vw",
  },

  remoteVideoPlaceholder: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(145deg, #1a1025, #2a1840)", zIndex: 0,
  },
  remoteVideo: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    objectFit: "cover", zIndex: 1,
    // no muted attribute — we WANT to hear the remote person
  },
  localPip: {
    position: "absolute", bottom: "54px", right: "10px",
    width: "88px", height: "66px", borderRadius: "10px",
    objectFit: "cover", border: "2px solid rgba(255,255,255,0.3)",
    zIndex: 3, boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
  },
  localPipOff: {
    position: "absolute", bottom: "54px", right: "10px",
    width: "88px", height: "66px", borderRadius: "10px",
    background: "#2a1840", border: "2px solid rgba(255,255,255,0.12)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 3, boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
  },

  callControls: {
    position: "absolute", bottom: "10px", left: "50%",
    transform: "translateX(-50%)",
    display: "flex", gap: "10px", alignItems: "center",
    zIndex: 4,
    background: "rgba(15,8,30,0.65)", backdropFilter: "blur(10px)",
    padding: "7px 16px", borderRadius: "40px",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  ctrlBtn: {
    width: "36px", height: "36px", borderRadius: "50%", border: "none",
    background: "rgba(255,255,255,0.14)", fontSize: "15px", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.2s ease", color: "#fff",
  },
  ctrlBtnOn: { background: "rgba(229,57,53,0.3)", border: "1px solid rgba(229,57,53,0.5)" },
  hangUpBtn: {
    width: "44px", height: "44px", borderRadius: "50%", border: "none",
    background: "linear-gradient(135deg, #E53935, #B71C1C)", fontSize: "17px",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 14px rgba(229,57,53,0.55)", transition: "all 0.2s ease",
  },

  videoOverlay: {
    position: "absolute", inset: 0, zIndex: 5,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "14px",
    background: "linear-gradient(145deg, #1a1025, #2a1840)",
  },
  ringWrap: {
    position: "relative", width: "64px", height: "64px",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  ringCircle: {
    position: "absolute", inset: 0, borderRadius: "50%",
    border: "3px solid rgba(139,106,209,0.55)",
    animation: "ringPulse 1.4s ease-out infinite",
  },
  ringIcon: {
    fontSize: "26px", width: "54px", height: "54px", borderRadius: "50%",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1,
  },
  overlayLabel: {
    fontSize: "13px", fontWeight: "700",
    color: "rgba(255,255,255,0.65)", letterSpacing: "0.3px",
  },
  incomingBtns: { display: "flex", gap: "12px" },
  acceptBtn: {
    padding: "9px 24px", borderRadius: "22px", border: "none",
    background: "linear-gradient(135deg, #4CAF87, #26A69A)",
    color: "#fff", fontWeight: "700", fontSize: "13px",
    cursor: "pointer", fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(76,175,135,0.45)",
  },
  rejectBtn: {
    padding: "9px 24px", borderRadius: "22px", border: "none",
    background: "linear-gradient(135deg, #E53935, #C62828)",
    color: "#fff", fontWeight: "700", fontSize: "13px",
    cursor: "pointer", fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(229,57,53,0.45)",
  },

  actionRow: { display: "flex", gap: "8px" },
  newBtn: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
    padding: "9px 16px", borderRadius: "12px", border: "none",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    color: "#fff", fontSize: "13px", fontWeight: "700",
    cursor: "pointer", fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(107,81,191,0.3)", transition: "all 0.2s ease",
  },
  notifyBtn: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
    padding: "9px 16px", borderRadius: "12px", border: "none",
    background: "linear-gradient(135deg, #F6A947, #F47C7C)",
    color: "#fff", fontSize: "13px", fontWeight: "700",
    cursor: "pointer", fontFamily: "'Nunito', sans-serif",
    boxShadow: "0 4px 14px rgba(244,120,80,0.3)", transition: "all 0.2s ease",
  },

  messagesBox: {
    flex: 1, overflowY: "auto",
    display: "flex", flexDirection: "column", gap: "12px",
    padding: "14px", borderRadius: "18px",
    background: "linear-gradient(160deg, #F9F7FF 0%, #F0F4FF 100%)",
    border: "1px solid rgba(186,149,255,0.18)",
  },
  emptyState: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: "10px", margin: "auto", paddingTop: "30px",
  },
  emptyIcon: { fontSize: "36px", opacity: 0.4 },
  emptyText: { fontSize: "13px", color: "#B0A8C4", fontWeight: "600", fontStyle: "italic" },

  messageRow: {
    display: "flex", alignItems: "flex-end", gap: "8px",
    animation: "popIn 0.25s ease",
  },
  avatarStranger: {
    width: "28px", height: "28px", borderRadius: "50%",
    background: "linear-gradient(135deg, #CE93D8, #9575CD)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: "800", color: "#fff",
    flexShrink: 0, boxShadow: "0 2px 6px rgba(149,117,205,0.35)",
  },
  avatarYou: {
    width: "28px", height: "28px", borderRadius: "50%",
    background: "linear-gradient(135deg, #80DEEA, #4FC3F7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: "800", color: "#fff",
    flexShrink: 0, boxShadow: "0 2px 6px rgba(79,195,247,0.35)",
  },
  bubble: {
    display: "flex", flexDirection: "column",
    maxWidth: "68%", padding: "10px 14px",
    borderRadius: "18px", lineHeight: 1.5,
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  },
  bubbleStranger: {
    background: "#fff", borderBottomLeftRadius: "4px",
    border: "1px solid rgba(186,149,255,0.2)",
  },
  bubbleYou: {
    background: "linear-gradient(135deg, #B39DDB, #90CAF9)",
    borderBottomRightRadius: "4px", border: "none",
  },
  bubbleSender: {
    fontSize: "10px", fontWeight: "800", letterSpacing: "0.5px",
    textTransform: "uppercase", marginBottom: "3px", opacity: 0.65, color: "inherit",
  },
  bubbleText: {
    fontSize: "14px", fontWeight: "500",
    color: "#3D2B6B", wordBreak: "break-word",
  },

  inputArea: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "10px 14px", borderRadius: "18px",
    background: "#fff", border: "1.5px solid rgba(186,149,255,0.3)",
    boxShadow: "0 2px 12px rgba(124,92,191,0.08)", transition: "border-color 0.2s ease",
  },
  textInput: {
    flex: 1, border: "none", background: "transparent",
    fontSize: "14px", fontWeight: "500", color: "#3D2B6B",
    fontFamily: "'Nunito', sans-serif", caretColor: "#8B6AD1",
  },
  sendBtn: {
    width: "40px", height: "40px", borderRadius: "12px", border: "none",
    background: "linear-gradient(135deg, #8B6AD1, #6891E8)",
    color: "#fff", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, boxShadow: "0 4px 14px rgba(107,81,191,0.35)",
    transition: "all 0.2s ease",
  },
};

export default App;