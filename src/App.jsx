import { useState, useEffect, useRef } from 'react';
import { DateTime } from 'luxon';

function App() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
useEffect(() => {
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('✅ beforeinstallprompt イベントを検出', e);
  });

  window.addEventListener('appinstalled', () => {
    console.log('✅ アプリがインストールされました');
  });
}, []);


  useEffect(() => {
    const handler = (e) => {
      // 自動表示をキャンセルして、手動で出すようにする
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('ユーザーがインストールしました');
    } else {
      console.log('ユーザーがインストールをキャンセルしました');
    }
    setDeferredPrompt(null);
    setShowInstallButton(false);
  };
  useEffect(() => {
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isInStandaloneMode) {
      alert('iOSでは「ホーム画面に追加」でアプリとして使えます');
    }
  }, []);

  const defaultConfig = {
    brthOut: 20,
    brthIn: 16,
    endCond: 'deadline',
    endTime: '08:00',
    timeLen: 20,
    audioSrc: '/hyoushigi.mp3',
    tz: 'Asia/Tokyo'
  };

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('終了');
  const [bg, setBg] = useState('#ffffff');
  const [color, setColor] = useState('#000000');

  const timerRef = useRef();
  const audioRef = useRef();
  const fileInputRef = useRef();

  const savedCfg = (() => {
    try {
      const saved = localStorage.getItem('breath-config');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  })();

  const [brthOut, setBrthOut] = useState(savedCfg.brthOut ?? defaultConfig.brthOut);
  const [brthIn, setBrthIn] = useState(savedCfg.brthIn ?? defaultConfig.brthIn);
  const [endCond, setEndCond] = useState(savedCfg.endCond ?? 'deadline');
  const [endTime, setEndTime] = useState(savedCfg.endTime ?? '08:00');
  const [timeLen, setTimeLen] = useState(savedCfg.timeLen ?? defaultConfig.timeLen);
  const [audioSrc, setAudioSrc] = useState(savedCfg.audioSrc ?? '/hyoushigi.mp3');
  const [tz, setTz] = useState(savedCfg.tz ?? 'Asia/Tokyo');
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [startTimeMs, setStartTimeMs] = useState(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, [audioSrc]);

  // 保存時
  useEffect(() => {
   const config = {
      brthOut,
      brthIn,
      endCond,
      endTime,
      timeLen,
      audioSrc,
      tz
    };
    localStorage.setItem('breath-config', JSON.stringify(config));
  }, [brthOut, brthIn, endCond, endTime, timeLen, audioSrc, tz]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  const calcDeadline = () => {
    const now = DateTime.local().setZone(tz);
    if (endCond === 'deadline') {
      const [h, m] = endTime.split(':').map(Number);
      let end = now.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (end <= now) {
        end = end.plus({ days: 1 });
      }
      return end.toMillis();
    } else {
      return now.plus({ minutes: parseInt(timeLen) || 0 }).toMillis();
    }
  };

  // 最終呼気後の特殊処理
  const doFinal = () => {
    // 呼気長に応じたルール決定
    const n = parseInt(brthOut);
    let wait, repeats;
    if (n >= 17) {
      wait = 4; repeats = 12;
    } else if (n === 16) {
      wait =  3; repeats = 12;
    } else if (n >= 5) {
      wait = 2; repeats = n - 3;
    } else if (n >= 2) {
      wait = 1; repeats = n - 2;
    } else {
      wait = 1; repeats = 0;
    }

    setPhase('最終 呼氣');
    setBg('#ffe5cc');
    setColor('#663300');
    play();

    setTimeout(() => {
      let i = 0;
      const iv = setInterval(() => {
        if (i >= repeats) {
          clearInterval(iv);
          setTimeout(() => {
            setPhase('最終 吸氣');
            setBg('#fff2cc');
            setColor('#665500');
            play();
            // 最後の吸気後に停止
            setTimeout(stop, parseInt(brthIn) * 1000);
          }, 2000);
        } else {
          play();
          i++;
        }
      }, 1000);
    }, wait * 1000);
  };

  // 呼吸ループ開始
  const start = () => {
    if (running) return;

    const out = parseInt(brthOut);
    const inn = parseInt(brthIn);
    if (!out || !inn || out <= 0 || inn <= 0 || out > 180 || inn > 180) {
      alert('吸気・呼気秒数は1～180の数値で入力してください。');
      return;
    }

    if (endCond === 'time' && (!parseInt(timeLen) > 1440 || parseInt(timeLen) <= 0)) {
      alert('時間（分）は1～1440の数値で入力してください。');
      return;
    }

    setRunning(true);
    const deadline = calcDeadline();
    const now = Date.now();
    setStartTimeMs(now);
    setDeadlineMs(deadline);

    const loop = () => {
      const now = Date.now();
      const totalNext = out * 1000 + inn * 1000;

      if (now + totalNext > deadline) {
        doFinal();
        return;
      }

      // 呼気
      setPhase('呼氣');
      setBg('#d0f0c0');  // 明るめの緑
      setColor('#003300');  // 落ち着いた濃緑
      // setBg('green');
      // setColor('purple');
      play();

      timerRef.current = setTimeout(() => {
        // 吸気
        setPhase('吸氣');
        setBg('#cce5ff');
        setColor('#002244');
        play();

        timerRef.current = setTimeout(() => {
          // 次のループ
          loop();
        }, inn * 1000);
      }, out * 1000);
    };
    loop();
  };

  const stop = () => {
    clearTimeout(timerRef.current);
    setRunning(false);
    setPhase('終了');
    setBg('#ffffff');
    setColor('#000000');
  };

  // 音声再生
  const play = () => {
    if (audioRef.current) {
      const newAudio = audioRef.current.cloneNode(true);
      newAudio.play().catch((e) => {
        console.error('音声再生エラー:', e);
      });
    }
  };
  // 音声ファイルの読み込み
  const onAudioChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
        setAudioSrc(url);
    }
  };

  const resetToDefault = () => {
    setBrthOut(defaultConfig.brthOut);
    setBrthIn(defaultConfig.brthIn);
    setEndCond(defaultConfig.endCond);
    setEndTime(defaultConfig.endTime);
    setTimeLen(defaultConfig.timeLen);
    setAudioSrc(defaultConfig.audioSrc);
    setTz(defaultConfig.tz);

    // localStorage も初期化
    localStorage.setItem('breath-config', JSON.stringify(defaultConfig));

    // 🔧 ファイル入力欄もリセット
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds}秒`;
  };

  return (
    <>
      <div>
        {showInstallButton && (
          <div style={{ padding: '1em', textAlign: 'center' }}>
            <button onClick={handleInstallClick}>
              アプリをインストールする
            </button>
          </div>
        )}
      　<audio ref={audioRef} src={audioSrc} preload="auto" />
        <div style={{ background: bg, color, minHeight: '100vh', padding: 20 }}>
        <h1>氣の呼吸法</h1>
        <div>
          呼氣秒数：
          <input
            type="number"
            min="1"
            max="180"
            value={brthOut}
            onChange={e => setBrthOut(e.target.value)}
          />
          吸氣秒数：
          <input
            type="number"
            min="1"
            max="180"
            value={brthIn}
            onChange={e => setBrthIn(e.target.value)}
          />
        </div>
        <div>
          終了方法：
            <select value={endCond} onChange={e => setEndCond(e.target.value)}>
              <option value="deadline">終了時刻</option>
              <option value="time">時間（分）</option>
            </select>
            {endCond === 'time' ? (
              <>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={timeLen}
                  onChange={e => setTimeLen(e.target.value)}
                />
                <span>分</span>
              </>
            ) : (
              <>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
              />
                （ロケール:
                <select value={tz} onChange={e => setTz(e.target.value)}>
                  <option value="Asia/Tokyo">日本（東京）</option>
                  <option value="Europe/Stockholm">スウェーデン（ストックホルム）</option>
                  <option value="UTC">UTC</option>
                </select>）
              </>
            )}
          </div>
          <div>
            音声ファイル：
            <input type="file"  accept="audio/*" ref={fileInputRef} onChange={onAudioChange}/>
            <div>{audioSrc.includes('hyoushigi.mp3') ? '※音声ファイルが選択されていない場合はデフォルト音声を使用します。' : ''}</div>
          </div>

          <div style={{ marginTop: 20, fontSize: 24 }}>{phase}</div>
          {deadlineMs && running && (
            <div style={{ marginTop: 20 }}>
              <progress
                value={nowMs - startTimeMs}
                max={deadlineMs - startTimeMs}
                style={{ width: '100%', height: '20px' }}
              ></progress>
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                残り時間：{formatTime(deadlineMs - nowMs)}
              </div>
            </div>
          )}
          <div style={{ marginTop: 20 }}>
            <button 
              onClick={start}
              style={{
                opacity: running ? 0.5 : 1,
                pointerEvents: running ? 'none' : 'auto'
              }}
            >
              開始
            </button>
            <button onClick={stop}
              style={{
                opacity: !running ? 0.5 : 1,
                pointerEvents: !running ? 'none' : 'auto'
              }}
            >
              停止
            </button>
            <button onClick={resetToDefault}>デフォルトに戻す</button>
            </div>
          </div>
        </div>
      </>
    );
}

export default App;
