// BM CW Decoder V1.02 (TensorFlow.js enhanced, mic access improved & clear status)
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

// TensorFlow.js model
let model = null;

// For mic
let micToneState = 0, micToneStart = null, micTimings = [];
let micPermissionDenied = false;

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
function saveModelWeights() {
  if (model) model.save('localstorage://bm_cw_model');
}
async function loadModelWeights() {
  try {
    model = await tf.loadLayersModel('localstorage://bm_cw_model');
  } catch {
    model = null;
  }
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
    if (method === 'mic') {
      setStatus('Click "Start" and allow microphone access, then send CW toward your mic.');
    } else if (method === 'keyboard') {
      setStatus('Click "Start" and use your Spacebar as CW key.');
    } else {
      setStatus('Choose and upload a WAV file, then click "Start".');
    }
  });
}

// Button logic
startBtn.onclick = async () => {
  if (decoding) return;
  decoding = true;
  stopBtn.disabled = false;
  startBtn.disabled = true;
  micPermissionDenied = false;
  if (method === 'mic') {
    setStatus('Requesting microphone access. Please allow access if prompted.');
    await ensureModel();
    // Request mic access only on click
    navigator.mediaDevices.getUserMedia({audio: true})
      .then(async stream => {
        audioStream = stream;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
          try {
            await audioCtx.resume();
          } catch (e) {
            setStatus('AudioContext could not be resumed. Try clicking Start again or check browser permissions.');
            stopDecoding();
            return;
          }
        }
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
        setStatus('Mic access granted! Send CW tone toward your mic.');
      })
      .catch(err => {
        micPermissionDenied = true;
        setStatus('Microphone access denied or unavailable. Please grant permission and retry.');
        stopDecoding();
      });
  } else if (method === 'keyboard') {
    setStatus('Press and release Spacebar to send Morse. Press "Stop" to decode.');
    await ensureModel();
    startKeyboard();
  } else if (method === 'wav') {
    if (wavUpload.files[0]) {
      setStatus('Processing WAV file...');
      await ensureModel();
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

// TensorFlow.js: Build or load model
async function ensureModel() {
  await loadModelWeights();
  if (model) return;
  // input: [duration, gap]
  model = tf.sequential();
  model.add(tf.layers.dense({units: 16, activation: 'relu', inputShape: [2]}));
  model.add(tf.layers.dense({units: 8, activation: 'relu'}));
  model.add(tf.layers.dense({units: 3, activation: 'softmax'})); // dot, dash, gap
  model.compile({optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy']});
  // If training data exists, train
  if (trainingData.length > 5) await trainModel();
}
async function trainModel() {
  if (!model || trainingData.length < 6) return;
  setStatus("Training model...");
  // trainingData: {duration, gap, label: 0-dot,1-dash,2-gap}
  const xs = tf.tensor2d(trainingData.map(d => [d.duration, d.gap]));
  const ys = tf.tensor2d(trainingData.map(d => {
    if (d.label === 0) return [1,0,0];
    if (d.label === 1) return [0,1,0];
    return [0,0,1];
  }));
  await model.fit(xs, ys, {epochs: 30, batchSize: 8});
  saveModelWeights();
  setStatus("Model trained.");
}

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
      }
      stopDecoding();
      decodeTimings(times, audioBuffer.sampleRate);
    });
  };
  reader.readAsArrayBuffer(file);
}

// Microphone amplitude handler
function processMicAmplitude(amp) {
  if (micPermissionDenied) return;
  const threshold = 0.09;
  if (amp > threshold && micToneState === 0) {
    micToneStart = performance.now();
    micToneState = 1;
  } else if (amp < threshold && micToneState === 1) {
    let end = performance.now();
    micTimings.push({start: micToneStart, end: end});
    micToneState = 0;
    // Stop after 80 beeps or 15s
    if (micTimings.length > 80 || (micTimings.length && (micTimings[micTimings.length-1].end - micTimings[0].start > 15000))) {
      stopDecoding();
      decodeTimings(micTimings, 1000); // ms based
    }
  }
}

// Keyboard input (spacebar = key down)
function startKeyboard() {
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
  if (!micPermissionDenied) setStatus('Stopped.');
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

// Decode timings to Morse (TensorFlow.js powered)
async function decodeTimings(times, sampleRate) {
  await ensureModel();
  // Calculate durations (dit, dah, gaps)
  let durations = times.map(t => (t.end-t.start)/sampleRate);
  let gaps = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i].start - times[i-1].end)/sampleRate);
  }
  // Estimate dit length (shortest tone)
  let dit = Math.min(...durations);
  wpm = 1.2 / dit;
  updateWPM(wpm);

  // Use TF.js model for classification
  let morse = '';
  for (let i = 0; i < durations.length; i++) {
    let gap = gaps[i] || 0;
    let input = tf.tensor2d([[durations[i], gap]]);
    let pred = model.predict(input);
    let arr = await pred.array();
    let idx = arr[0].indexOf(Math.max(...arr[0])); // 0-dot, 1-dash, 2-gap
    // Fallback for first run
    if (isNaN(idx)) {
      idx = durations[i] < (dit*1.7) ? 0 : 1;
    }
    if (idx === 0) morse += '.';
    else if (idx === 1) morse += '-';
    // For gap, add separator
    if (gap > dit*2.5 && gap < dit*6) morse += ' ';
    if (gap >= dit*6) morse += ' / ';
    // Save for training
    trainingData.push({duration: durations[i], gap, label: idx});
  }

  saveTraining();
  await trainModel();

  // Decode and log
  let decoded = morse.split(' / ').map(word =>
    word.split(' ').map(code => MORSE_MAP[code] || '?').join('')
  ).join(' ');
  log += `[${getUTC()}] ${decoded}\n`;
  saveLog();
  renderLog();
  setStatus('Decoded: ' + decoded);
}

// Utility: get UTC date/time
function getUTC() {
  let now = new Date();
  return now.toISOString().replace('T',' ').substring(0,19) + ' UTC';
}

// On page load, show instructions for mic
window.onload = function() {
  loadStored();
  ensureModel();
  setStatus('Click "Start" and allow microphone access, then send CW toward your mic.');
};
