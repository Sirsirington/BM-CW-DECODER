// BM CW Decoder V1.02 main logic
const logElem = document.getElementById('log');
const statusElem = document.getElementById('status');
const wpmElem = document.getElementById('wpmDisplay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const wavUpload = document.getElementById('wavUpload');
const inputMethods = document.getElementsByName('inputMethod');

let decoding = false;
let log = '';
let wpm = 0;
let method = 'mic';
let audioStream = null;
let audioCtx = null;
let analyser = null;
let micProcessor = null;
let keyPressStart = null;
let keyTimings = [];
let trainingData = [];
let autoTrain = true;

// Load log and training data from localStorage
function loadStored() {
  log = localStorage.getItem('bm_cw_log') || '';
  trainingData = JSON.parse(localStorage.getItem('bm_cw_training') || '[]');
  renderLog();
}
function saveLog() {
  localStorage.setItem('bm_cw_log', log);
}
function saveTraining() {
  localStorage.setItem('bm_cw_training', JSON.stringify(trainingData));
}

function renderLog() {
  logElem.textContent = log;
}
function updateWPM(val) {
  wpmElem.textContent = `WPM: ${val ? val.toFixed(1) : '--'}`;
}
function setStatus(msg) {
  statusElem.textContent = msg;
}

// UTC time display
function updateDateTime() {
  const now = new Date();
  const utc = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  document.getElementById('datetime').textContent = utc;
}
setInterval(updateDateTime, 1000);
updateDateTime();

// Input method selection
for (const radio of inputMethods) {
  radio.addEventListener('change', (e) => {
    method = e.target.value;
    wavUpload.disabled = method !== 'wav';
    setStatus(`Selected input: ${method}`);
  });
}

// Button logic
startBtn.onclick = async () => {
  if (decoding) return;
  decoding = true;
  stopBtn.disabled = false;
  startBtn.disabled = true;
  setStatus('Decoding started...');
  if (method === 'mic') startMicrophone();
  else if (method === 'keyboard') startKeyboard();
  else if (method === 'wav') {
    if (wavUpload.files[0]) {
      decodeWavFile(wavUpload.files[0]);
    } else {
      setStatus('Please upload a WAV file.');
      stopDecoding();
    }
  }
};
stopBtn.onclick = () => {
  stopDecoding();
};
clearBtn.onclick = () => {
  log = '';
  saveLog();
  renderLog();
  setStatus('Log cleared.');
  updateWPM(null);
};

// WAV File decode (basic, not perfect - for demonstration)
function decodeWavFile(file) {
  setStatus('Processing WAV file...');
  const reader = new FileReader();
  reader.onload = function(e) {
    const arrayBuffer = e.target.result;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.decodeAudioData(arrayBuffer, (audioBuffer) => {
      const data = audioBuffer.getChannelData(0);
      // Simple envelope detection for tone
      const threshold = 0.15;
      let last = 0, start = null, times = [];
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > threshold && last === 0) {
          start = i;
          last = 1;
        } else if (Math.abs(data[i]) < threshold && last === 1) {
          times.push({start, end: i});
          last = 0;
        }
        // --- Morse Sample Database UI ---

// Load sample list
function loadSampleDatabaseUI() {
  const select = document.getElementById('sampleSelect');
  const info = document.getElementById('sampleInfo');
  MORSE_SAMPLES.forEach((sample, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${sample.label} (${sample.wpm} WPM)`;
    select.appendChild(opt);
  });
  select.onchange = () => {
    const sample = MORSE_SAMPLES[select.value];
    info.innerHTML = `<b>Expected text:</b> <code>${sample.text}</code>`;
  };
  select.onchange(); // init display
}

document.getElementById('playSample').onclick = () => {
  const idx = document.getElementById('sampleSelect').value;
  const sample = MORSE_SAMPLES[idx];
  const audio = new Audio(sample.file);
  audio.play();
};

document.getElementById('decodeSample').onclick = () => {
  const idx = document.getElementById('sampleSelect').value;
  const sample = MORSE_SAMPLES[idx];
  fetch(sample.file)
    .then(resp => resp.blob())
    .then(blob => {
      // Use your existing decodeWavFile(blob)
      decodeWavFile(blob);
      setStatus(`Decoding sample: ${sample.label} (${sample.wpm} WPM). Expected: ${sample.text}`);
    });
};

// Run on load
window.onload = function() {
  // ...your existing code...
  if (typeof MORSE_SAMPLES !== "undefined") loadSampleDatabaseUI();
};
      }
      stopDecoding();
      decodeTimings(times, audioBuffer.sampleRate);
    });
  };
  reader.readAsArrayBuffer(file);
}

// Microphone decode (simple)
function startMicrophone() {
  navigator.mediaDevices.getUserMedia({audio: true})
    .then(stream => {
      audioStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser.fftSize = 1024;
      source.connect(analyser);
      micProcessor = setInterval(() => {
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let max = Math.max(...data);
        let min = Math.min(...data);
        let amp = (max - min) / 256;
        processMicAmplitude(amp);
      }, 8);
      setStatus('Listening to microphone...');
    })
    .catch(() => {
      setStatus('Microphone access denied.');
      stopDecoding();
    });
  micToneState = 0;
  micToneStart = null;
  micTimings = [];
}
let micToneState = 0, micToneStart = null, micTimings = [];
function processMicAmplitude(amp) {
  const threshold = 0.09;
  if (amp > threshold && micToneState === 0) {
    micToneStart = performance.now();
    micToneState = 1;
  } else if (amp < threshold && micToneState === 1) {
    let end = performance.now();
    micTimings.push({start: micToneStart, end: end});
    micToneState = 0;
    // Stop after 15s or 80 beeps for demo
    if (micTimings.length > 80 || (micTimings.length && (micTimings[micTimings.length-1].end - micTimings[0].start > 15000))) {
      stopDecoding();
      decodeTimings(micTimings, 1000); // ms based
    }
  }
}

// Keyboard input (spacebar = key down)
function startKeyboard() {
  setStatus('Press and release Spacebar to send Morse. Press "Stop" to decode.');
  keyTimings = [];
  keyPressStart = null;
  document.body.onkeydown = (e) => {
    if (e.code === "Space" && keyPressStart === null && decoding) {
      keyPressStart = performance.now();
    }
  };
  document.body.onkeyup = (e) => {
    if (e.code === "Space" && keyPressStart !== null && decoding) {
      let t = performance.now();
      keyTimings.push({start: keyPressStart, end: t});
      keyPressStart = null;
      // Stop after 80 keys or 20s for demo
      if (keyTimings.length > 80 || (keyTimings.length && (keyTimings[keyTimings.length-1].end - keyTimings[0].start > 20000))) {
        stopDecoding();
        decodeTimings(keyTimings, 1000);
      }
    }
  };
}

// Stop all input
function stopDecoding() {
  decoding = false;
  stopBtn.disabled = true;
  startBtn.disabled = false;
  setStatus('Stopped.');
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  if (micProcessor) {
    clearInterval(micProcessor);
    micProcessor = null;
  }
  document.body.onkeydown = null;
  document.body.onkeyup = null;
}

// Decode timings to Morse
function decodeTimings(times, sampleRate) {
  // Calculate durations (dit, dah, gaps)
  let durations = times.map(t => (t.end-t.start)/sampleRate);
  let gaps = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i].start - times[i-1].end)/sampleRate);
  }
  // Estimate dit length (shortest tone)
  let dit = Math.min(...durations);
  let dah = dit*3;
  // Estimate WPM
  wpm = 1.2 / dit;
  updateWPM(wpm);

  // Train on previous logs (simple: adjust dit/dah ratio)
  if (autoTrain && trainingData.length) {
    let ditArr = trainingData.map(d => d.dit);
    let avgDit = ditArr.reduce((a,b)=>a+b,0)/ditArr.length;
    if (avgDit && Math.abs(avgDit - dit) < 0.05) dit = avgDit;
    dah = dit*3;
  }

  // Build morse string
  let morse = '';
  for (let i = 0; i < durations.length; i++) {
    morse += durations[i] < (dit*1.7) ? '.' : '-';
    let gap = gaps[i] || 0;
    if (gap > dit*2.5 && gap < dah*3) morse += ' '; // letter gap
    if (gap >= dah*3) morse += ' / '; // word gap
  }

  // Decode and log
  let decoded = morse.split(' / ').map(word =>
    word.split(' ').map(code => MORSE_MAP[code] || '?').join('')
  ).join(' ');
  log += `[${getUTC()}] ${decoded}\n`;
  saveLog();
  renderLog();
  setStatus('Decoded: ' + decoded);

  // Save training
  trainingData.push({dit, dah, wpm, morse, decoded, time: Date.now()});
  saveTraining();
}

// Utility: get UTC date/time
function getUTC() {
  let now = new Date();
  return now.toISOString().replace('T',' ').substring(0,19) + ' UTC';
}

// Load stored data/log on page load

loadStored();
