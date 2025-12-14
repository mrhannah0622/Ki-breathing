import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";

/**
 * App.jsx — 改修版（最終呼氣ロジック復元 + pause/resume + prepareAudio + WakeLock + WebAudio fallback）
 *
 * 使い方：
 * - Start を最初に押す前に (スマホでは) 必ずユーザー操作が必要 → Start 内で prepareAudio を呼ぶ
 * - スリープ復帰後に音が鳴らない場合は「音声を再有効化する」ボタンで再ロックを解除できる
 */

export default function App() {
  const defaultConfig = {
    brthOut: 20,
    brthIn: 16,
    endCond: "deadline",
    endTime: "08:00",
    timeLen: 20,
    audioSrc: "/hyoushigi.mp3",
    tz: "Asia/Tokyo",
  };

  // load saved config immediately (synchronous)
  const savedCfg = (() => {
    try {
      const s = localStorage.getItem("breath-config");
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  })();

  const [brthOut, setBrthOut] = useState(savedCfg.brthOut ?? defaultConfig.brthOut);
  const [brthIn, setBrthIn] = useState(savedCfg.brthIn ?? defaultConfig.brthIn);
  const [endCond, setEndCond] = useState(savedCfg.endCond ?? defaultConfig.endCond);
  const [endTime, setEndTime] = useState(savedCfg.endTime ?? defaultConfig.endTime);
  const [timeLen, setTimeLen] = useState(savedCfg.timeLen ?? defaultConfig.timeLen);
  const [audioSrc, setAudioSrc] = useState(savedCfg.audioSrc ?? defaultConfig.audioSrc);
  const [tz, setTz] = useState(savedCfg.tz ?? defaultConfig.tz);

  // UI state
  const [phase, setPhase] = useState("終了");
  const [bg, setBg] = useState("#ffffff");
  const [color, setColor] = useState("#000000");

  // resume / blocked UI
  const [needsResume, setNeedsResume] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // refs for control
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const timeoutsRef = useRef([]); // holds timeout/interval ids
  const startTimeRef = useRef(null);
  const deadlineRef = useRef(null);
  const pausedRemainingRef = useRef(null); // when paused in 'time' mode

  // audio elements & WebAudio
  const exhaleAudioRef = useRef(null); // <audio> fallback (exhale)
  const inhaleAudioRef = useRef(null); // <audio> fallback (inhale)
  const ctxRef = useRef(null);         // AudioContext if available
  const bufferRef = useRef(null);      // decoded AudioBuffer (for WebAudio playback)
  const audioPreparedRef = useRef(false);

  // WakeLock
  const wakeLockRef = useRef(null);

  // persist settings
  useEffect(() => {
    const cfg = { brthOut, brthIn, endCond, endTime, timeLen, audioSrc, tz };
    localStorage.setItem("breath-config", JSON.stringify(cfg));
  }, [brthOut, brthIn, endCond, endTime, timeLen, audioSrc, tz]);

  // decode into AudioBuffer when audioSrc changes (but don't auto-play)
  useEffect(() => {
    let cancelled = false;
    const tryDecode = async () => {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        if (!ctxRef.current) ctxRef.current = new C();
        // fetch with cache-first semantics; if offline, this should hit the browser cache (Workbox will put it there)
        const res = await fetch(audioSrc, { cache: "force-cache" });
        const ab = await res.arrayBuffer();
        // decode - may fail if no user gesture on some platforms; catch errors.
        await ctxRef.current.decodeAudioData(
          ab.slice(0),
          (buf) => {
            if (!cancelled) bufferRef.current = buf;
          },
          (err) => {
            console.warn("decodeAudioData failed", err);
          }
        );
      } catch (e) {
        console.warn("fetch/decode failed", e);
      }
    };
    tryDecode();
    return () => { cancelled = true; };
  }, [audioSrc]);

  // helper: clear timeouts/intervals
  const clearAllTimers = () => {
    timeoutsRef.current.forEach((id) => { try { clearTimeout(id); clearInterval(id); } catch {} });
    timeoutsRef.current = [];
  };

  // addTimeout wrapper (stores ids)
  const addTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter(x => x !== id);
      try { fn(); } catch (e) { console.error(e); }
    }, ms);
    timeoutsRef.current.push(id);
    return id;
  };

  // prepareAudio: must be called as a user gesture (Start button or manual resume)
  const prepareAudio = async () => {
    // ensure AudioContext created on user gesture for iOS/Chrome policies
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C && !ctxRef.current) ctxRef.current = new C();
    } catch (e) {
      console.warn("AudioContext unavailable", e);
    }

    // Try quick play/pause of audio elements to "unlock" playback on mobile
    try {
      if (exhaleAudioRef.current) {
        await exhaleAudioRef.current.play().catch(()=>{});
        exhaleAudioRef.current.pause();
        exhaleAudioRef.current.currentTime = 0;
      }
      if (inhaleAudioRef.current) {
        await inhaleAudioRef.current.play().catch(()=>{});
        inhaleAudioRef.current.pause();
        inhaleAudioRef.current.currentTime = 0;
      }
      audioPreparedRef.current = true;
      setNeedsResume(false);
      setAudioBlocked(false);
    } catch (e) {
      console.warn("prepareAudio failed", e);
      // leave audioPreparedRef false => show manual resume UI
    }
  };

  // tryPlay: play specific audio element but guard with runningRef
  const tryPlayElement = async (el) => {
    if (!runningRef.current || pausedRef.current) return;
    if (!el) return;
    try {
      await el.play();
      setNeedsResume(false);
      setAudioBlocked(false);
    } catch (e) {
      console.warn("element play failed", e);
      setNeedsResume(true);
      setAudioBlocked(true);
    }
  };

  // play via WebAudio if decoded; fallback to element play
  const playSound = async (el) => {
    if (!runningRef.current || pausedRef.current) return;

    // prefer decoded buffer
    if (ctxRef.current && bufferRef.current) {
      try {
        if (ctxRef.current.state === "suspended") {
          await ctxRef.current.resume().catch(()=>{});
        }
        const src = ctxRef.current.createBufferSource();
        src.buffer = bufferRef.current;
        // optional: use gain node to control volume and avoid Android auto-adjust
        const gain = ctxRef.current.createGain();
        gain.gain.value = 1.0;
        src.connect(gain).connect(ctxRef.current.destination);
        src.start(0);
        // we don't keep references to stop these (they end quickly); if needed can store and stop on stop()
        return;
      } catch (e) {
        console.warn("WebAudio play failed, falling back to element", e);
      }
    }

    // fallback to element
    await tryPlayElement(el);
  };

  // calc deadline ms (timezone-aware)
  const calcDeadlineMs = () => {
    const now = DateTime.local().setZone(tz);
    if (endCond === "deadline") {
      const [h, m] = (endTime || "00:00").split(":").map(Number);
      let end = now.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (end <= now) end = end.plus({ days: 1 });
      return end.toMillis();
    } else {
      const minutes = parseInt(timeLen) || 0;
      return now.plus({ minutes }).toMillis();
    }
  };

  // 最終呼氣処理（完全復元）
  const doFinal = () => {
    if (!runningRef.current) return;
    const n = parseInt(brthOut) || 0;
    let wait, repeats;
    if (n >= 17) { wait = 4; repeats = 12; }
    else if (n === 16) { wait = 3; repeats = 12; }
    else if (n >= 5) { wait = 2; repeats = n - 3; }
    else if (n >= 2) { wait = 1; repeats = n - 2; }
    else { wait = 1; repeats = 0; }

    setPhase("最終 呼氣");
    setBg("#ffe5cc"); setColor("#663300");
    // play the exhale beep
    playSound(exhaleAudioRef.current);

    // after `wait` seconds: play 1-second-interval beeps repeats times, then final inhale after 2s
    addTimeout(() => {
      let i = 0;
      const iv = setInterval(() => {
        if (!runningRef.current) { clearInterval(iv); return; }
        if (i >= repeats) {
          clearInterval(iv);
          // after 2s play final inhale beep
          addTimeout(() => {
            if (!runningRef.current) return;
            setPhase("最終 吸氣");
            setBg("#fff2cc"); setColor("#665500");
            playSound(inhaleAudioRef.current);
            // stop after final inhale duration
            addTimeout(stop, (parseInt(brthIn) || 0) * 1000);
          }, 2000);
          return;
        }
        playSound(exhaleAudioRef.current);
        i++;
      }, 1000);
      timeoutsRef.current.push(iv);
    }, (wait || 0) * 1000);
  };

  // main scheduleLoop: schedules one pair (exhale -> inhale) and calls itself
  const scheduleLoop = () => {
    if (!runningRef.current || pausedRef.current) return;

    const out = parseInt(brthOut) || 0;
    const inn = parseInt(brthIn) || 0;
    if (out <= 0 || inn <= 0) return;

    // compute whether next complete pair would exceed deadline
    const now = Date.now();
    const nextPairMs = (out + inn) * 1000;
    const willExceed = deadlineRef.current && (now + nextPairMs > deadlineRef.current);

    // play exhale
    setPhase("呼氣"); setBg("#d0f0c0"); setColor("#003300");
    playSound(exhaleAudioRef.current);

    // schedule inhale after out seconds
    addTimeout(() => {
      if (!runningRef.current || pausedRef.current) return;

      // play inhale
      setPhase("吸氣"); setBg("#cce5ff"); setColor("#002244");
      playSound(inhaleAudioRef.current);

      // after inhale duration
      addTimeout(() => {
        if (!runningRef.current || pausedRef.current) return;

        if (willExceed) {
          // IMPORTANT: we must finish this inhale, then call doFinal (i.e. always end with exhale->inhale pair)
          doFinal();
          return;
        }
        // schedule next pair
        scheduleLoop();
      }, inn * 1000);

    }, out * 1000);
  };

  // start handler
  const start = async () => {
    if (runningRef.current) return;

    // validation
    const out = parseInt(brthOut) || 0;
    const inn = parseInt(brthIn) || 0;
    if (!out || !inn || out < 1 || inn < 1 || out > 180 || inn > 180) {
      alert("呼気・吸気は1〜180で設定してください");
      return;
    }
    if (endCond === "time") {
      const t = parseInt(timeLen) || 0;
      if (t <= 0 || t > 1440) { alert("時間（分）は1〜1440の範囲で指定してください"); return; }
    }

    // prepare audio (must be triggered by user gesture)
    await prepareAudio();

    // start wake lock if possible
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        // listen for release
        wakeLockRef.current?.addEventListener?.('release', () => { wakeLockRef.current = null; });
      }
    } catch (e) {
      console.warn("WakeLock error", e);
    }

    runningRef.current = true;
    pausedRef.current = false;
    pausedRemainingRef.current = null;

    startTimeRef.current = Date.now();
    deadlineRef.current = calcDeadlineMs();

    setPhase("開始");
    scheduleLoop();
  };

  // pause: if endCond === 'time' we freeze remaining; if 'deadline' we don't change deadline
  const pause = () => {
    if (!runningRef.current || pausedRef.current) return;
    pausedRef.current = true;

    // stop scheduled timers and any playing sources (we used WebAudio BufferSource which stops naturally)
    clearAllTimers();

    // in 'time' mode, capture remaining and hold it
    if (endCond === "time" && deadlineRef.current) {
      pausedRemainingRef.current = Math.max(0, deadlineRef.current - Date.now());
    }

    setPhase("一時停止");
  };

  // resume: always start with 呼氣
  const resume = async () => {
    if (!runningRef.current || !pausedRef.current) return;

    await prepareAudio();

    // if time-mode and we had frozen remaining, recompute deadline from now
    if (endCond === "time" && pausedRemainingRef.current != null) {
      deadlineRef.current = Date.now() + pausedRemainingRef.current;
      pausedRemainingRef.current = null;
    }
    pausedRef.current = false;
    setPhase("再開");

    // resume the loop starting with 呼氣
    scheduleLoop();
  };

  // stop: clear everything
  const stop = () => {
    runningRef.current = false;
    pausedRef.current = false;
    clearAllTimers();
    // release wake lock if any
    try { wakeLockRef.current?.release?.(); wakeLockRef.current = null; } catch (e) {}
    startTimeRef.current = null;
    deadlineRef.current = null;
    pausedRemainingRef.current = null;
    setPhase("終了");
    setBg("#ffffff"); setColor("#000000");
  };

  // visibility handler: don't auto-play on visibility change (that's what caused sound on tab switches)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        // reload audio element's src to help some iOS cases (but do NOT auto-play)
        if (audioPreparedRef.current) {
          exhaleAudioRef.current?.load();
          inhaleAudioRef.current?.load();
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // small timer to force UI updates of remaining time
  useEffect(() => {
    const iv = setInterval(() => { /* rerender */ setPhase(p => p); }, 1000);
    return () => clearInterval(iv);
  }, []);

  // helper: remaining ms
  const remainingMs = (() => {
    if (!startTimeRef.current || !deadlineRef.current) return 0;
    if (pausedRef.current && endCond === "time" && pausedRemainingRef.current != null) return pausedRemainingRef.current;
    return Math.max(0, deadlineRef.current - Date.now());
  })();

  // manual resume button (shown if playback failed and user needs to tap)
  const manualResume = async () => {
    await prepareAudio();
    if (runningRef.current && !pausedRef.current) {
      // try a test play to confirm
      await playSound(exhaleAudioRef.current);
    }
    setNeedsResume(false);
  };

  // file input handler
  const onAudioChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setAudioSrc(URL.createObjectURL(f));
      // clear decoded buffer so re-decode runs via effect
      bufferRef.current = null;
      audioPreparedRef.current = false;
    }
  };

  // reset to defaults
  const resetToDefault = () => {
    setBrthOut(defaultConfig.brthOut);
    setBrthIn(defaultConfig.brthIn);
    setEndCond(defaultConfig.endCond);
    setEndTime(defaultConfig.endTime);
    setTimeLen(defaultConfig.timeLen);
    setAudioSrc(defaultConfig.audioSrc);
    setTz(defaultConfig.tz);
    localStorage.setItem("breath-config", JSON.stringify(defaultConfig));
  };

  // small UI
  return (
    <div style={{ background: bg, color, minHeight: "100vh", padding: 20 }}>
      <h1>氣の呼吸法</h1>

      {/* two audio elements (same src) used as fallback; prefer WebAudio buffer playback */}
      <audio ref={exhaleAudioRef} src={audioSrc} preload="auto" style={{ display: "none" }} />
      <audio ref={inhaleAudioRef} src={audioSrc} preload="auto" style={{ display: "none" }} />

      <div>
        呼氣秒数：
        <input type="number" min="1" max="180" value={brthOut} onChange={e => setBrthOut(e.target.value)} />
        吸氣秒数：
        <input type="number" min="1" max="180" value={brthIn} onChange={e => setBrthIn(e.target.value)} />
      </div>

      <div style={{ marginTop: 8 }}>
        終了方法：
        <select value={endCond} onChange={e => setEndCond(e.target.value)}>
          <option value="deadline">終了時刻</option>
          <option value="time">時間（分）</option>
        </select>

        {endCond === "time" ? (
          <>
            <input type="number" min="1" max="1440" value={timeLen} onChange={e => setTimeLen(e.target.value)} />
            <span>分</span>
          </>
        ) : (
          <>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            <select value={tz} onChange={e => setTz(e.target.value)}>
              <option value="Asia/Tokyo">日本（東京）</option>
              <option value="Europe/Stockholm">Sweden (Stockholm)</option>
              <option value="UTC">UTC</option>
            </select>
          </>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        音声ファイル：
        <input type="file" accept="audio/*" onChange={onAudioChange} />
        <div>{audioSrc?.includes("hyoushigi.mp3") ? "※デフォルト音声を使用" : "カスタム音声を使用"}</div>
      </div>

      <div style={{ marginTop: 12, fontSize: 24 }}>{phase}</div>

      {(startTimeRef.current && deadlineRef.current) && (
        <div style={{ marginTop: 12 }}>
          <progress value={Math.max(0, (deadlineRef.current - remainingMs) - startTimeRef.current)} max={Math.max(1, deadlineRef.current - startTimeRef.current)} style={{ width: "100%" }} />
          <div style={{ textAlign: "center", marginTop: 6 }}>
            残り時間: {Math.floor(remainingMs / 60000)}分 {Math.floor((remainingMs % 60000) / 1000)}秒
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={start} disabled={runningRef.current} style={{ marginRight: 8 }}>開始</button>
        <button onClick={pause} disabled={!runningRef.current || pausedRef.current} style={{ marginRight: 8 }}>一時停止</button>
        <button onClick={resume} disabled={!runningRef.current || !pausedRef.current} style={{ marginRight: 8 }}>再開</button>
        <button onClick={stop} style={{ marginRight: 8 }}>停止</button>
        <button onClick={resetToDefault}>デフォルトに戻す</button>
      </div>

      {(needsResume || audioBlocked) && (
        <div style={{ marginTop: 10 }}>
          <button onClick={manualResume} style={{ padding: "8px 12px", background: "#ffaa00" }}>
            ▶ 音声を再有効化する
          </button>
          <div style={{ marginTop: 6, color: "#666" }}>
            スリープ復帰後に音が出ない場合はこのボタンを押してください（iPhone 対応）
          </div>
        </div>
      )}
    </div>
  );
}
