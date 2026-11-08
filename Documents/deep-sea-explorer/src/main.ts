import './style.css';
import { connectExploration } from './exploration';
import { connectMarineLife } from './marineLife';

type Reading = 'depth' | 'temperature' | 'pressure' | 'oxygen';
type SensorName = 'ctd' | 'oxygen' | 'sonar' | 'pressure';

function byId<T extends Element = HTMLElement>(id: string): T;
function byId(id: string): Element {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required page element: #${id}`);
  return element;
}

const readings: Record<Reading, number[]> = {
  depth: [3817, 3821, 3825, 3824, 3831, 3832, 3838, 3841, 3839, 3842],
  temperature: [2.78, 2.71, 2.65, 2.62, 2.55, 2.51, 2.47, 2.45, 2.42, 2.4],
  pressure: [38.42, 38.47, 38.51, 38.52, 38.58, 38.61, 38.66, 38.68, 38.69, 38.7],
  oxygen: [4.93, 4.91, 4.88, 4.86, 4.84, 4.83, 4.82, 4.81, 4.8, 4.8],
};

const sensorForReading: Partial<Record<Reading, SensorName>> = {
  depth: 'ctd',
  temperature: 'ctd',
  pressure: 'pressure',
  oxygen: 'oxygen',
};

const activeSensors = new Set<SensorName>(['ctd', 'oxygen', 'sonar', 'pressure']);
const temperatureInput = byId<HTMLInputElement>('temperature-control');
const lightInput = byId<HTMLInputElement>('light-control');
const cameraButton = byId<HTMLButtonElement>('camera-button');
const cameraVideo = byId<HTMLVideoElement>('camera-video');
const cameraView = byId<HTMLDivElement>('camera-view');
const chartLine = byId<SVGPathElement>('chart-line');
const chartArea = byId<SVGPathElement>('chart-area');
const chartDot = byId<SVGCircleElement>('chart-dot');
const toast = byId<HTMLDivElement>('toast');

let cameraStream: MediaStream | undefined;
let simulationPaused = false;
let elapsedSeconds = 2 * 60 * 60 + 18 * 60 + 42;
let toastTimeout = 0;
let tickCount = 0;

const formatDepth = (value: number) => Math.round(value).toLocaleString('en-US');
const setText = (id: string, value: string) => {
  byId(id).textContent = value;
};

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function updateRange(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percentage = ((value - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(90deg, #65dec9 0%, #65dec9 ${percentage}%, #253641 ${percentage}%, #253641 100%)`;
}

function pathForValues(values: number[], width: number, height: number, min: number, max: number) {
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / (max - min)) * height;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function drawTemperatureChart() {
  const values = readings.temperature;
  const width = 640;
  const height = 150;
  const line = pathForValues(values, width, height, 1, 4);
  const lastY = height - ((values[values.length - 1] - 1) / 3) * height;
  chartLine.setAttribute('d', line);
  chartArea.setAttribute('d', `${line} L${width},${height} L0,${height} Z`);
  chartDot.setAttribute('cx', String(width));
  chartDot.setAttribute('cy', lastY.toFixed(1));
  setText('chart-current', `${values[values.length - 1].toFixed(1)}°C`);
}

function drawSparkline(elementId: string, values: number[], color: string, fill: string, min: number, max: number) {
  const container = byId<HTMLDivElement>(elementId);
  const line = pathForValues(values, 100, 46, min, max);
  container.innerHTML = `<svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true"><path d="${line} L100,48 L0,48 Z" fill="${fill}" /><path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>`;
}

function renderReading(reading: Reading) {
  if (sensorForReading[reading] && !activeSensors.has(sensorForReading[reading]!)) return;
  const values = readings[reading];
  const current = values[values.length - 1];
  switch (reading) {
    case 'depth':
      setText('depth-value', formatDepth(current));
      setText('depth-trend', `${Math.abs(Math.round(current - values[0]))} m`);
      setText('camera-depth', `${formatDepth(current)} M`);
      drawSparkline('depth-spark', values, '#65dec9', 'rgba(101,222,201,.24)', 3800, 3860);
      break;
    case 'temperature':
      setText('temp-value', current.toFixed(1));
      setText('current-water-temp', `${current.toFixed(1)}°C`);
      drawSparkline('temp-spark', values, '#65dec9', 'rgba(101,222,201,.24)', 1.8, 3.2);
      drawTemperatureChart();
      break;
    case 'pressure':
      setText('pressure-value', current.toFixed(1));
      setText('pressure-trend', (current - values[0]).toFixed(1));
      setText('hull-reading', `${current.toFixed(1)} MPa`);
      drawSparkline('pressure-spark', values, '#80aeff', 'rgba(128,174,255,.2)', 38, 39);
      break;
    case 'oxygen':
      setText('oxygen-value', current.toFixed(1));
      setText('sensor-oxygen', `${current.toFixed(1)} mg/L`);
      drawSparkline('oxygen-spark', values, '#b393f4', 'rgba(179,147,244,.2)', 4.4, 5.2);
      break;
  }
}

function advanceValue(reading: Reading, step: number) {
  const values = readings[reading];
  const last = values[values.length - 1];
  const drift = reading === 'depth'
    ? 1 + Math.random() * 2.4
    : reading === 'temperature'
      ? (temperatureInput.valueAsNumber / 12 - last / 12) * 0.035 + (Math.random() - 0.56) * 0.025
      : reading === 'pressure'
        ? (Math.random() - 0.25) * 0.035
        : (Math.random() - 0.5) * 0.035;
  const next = reading === 'depth'
    ? Math.max(100, Math.min(6000, last + drift))
    : reading === 'temperature'
      ? Math.max(1.2, Math.min(8, last + drift))
      : reading === 'pressure'
        ? Math.max(1, Math.min(60, last + drift))
        : Math.max(0.5, Math.min(12, last + drift));
  values.push(Number(next.toFixed(reading === 'depth' ? 0 : 2)));
  if (values.length > 60) values.shift();
  if (step % 5 === 0 && reading === 'oxygen') {
    if (activeSensors.has('ctd')) {
      setText('salinity-reading', `${(34.7 + (Math.random() - 0.5) * 0.1).toFixed(1)} PSU`);
    }
    if (activeSensors.has('sonar')) {
      setText('sonar-range', `${(28.4 + (Math.random() - 0.5) * 0.6).toFixed(1)} m range`);
    }
  }
  renderReading(reading);
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

function updateSensors() {
  document.querySelectorAll<HTMLInputElement>('.toggle-input').forEach((input) => {
    const sensor = input.dataset.sensor as SensorName;
    const row = document.querySelector<HTMLElement>(`.sensor-row[data-sensor-row="${sensor}"]`);
    if (row) {
      row.classList.toggle('sensor-disabled', !input.checked);
      const pill = row.querySelector<HTMLElement>('.health-pill');
      if (pill) pill.innerHTML = input.checked ? '<i></i>Nominal' : '<i></i>Offline';
    }
    if (input.checked) activeSensors.add(sensor);
    else activeSensors.delete(sensor);
  });
  setText('active-count', String(activeSensors.size));
  (Object.keys(sensorForReading) as Reading[]).forEach(renderReading);
}

document.querySelectorAll<HTMLInputElement>('.toggle-input').forEach((input) => {
  const sensor = input.dataset.sensor as SensorName;
  const row = input.closest('.sensor-toggle-row');
  if (row) row.setAttribute('aria-label', `${sensor} sensor`);
  input.addEventListener('change', updateSensors);
});

temperatureInput.addEventListener('input', () => {
  const value = temperatureInput.valueAsNumber;
  setText('target-value', value.toFixed(1));
  setText('target-inline', value.toFixed(1));
  updateRange(temperatureInput);
});

lightInput.addEventListener('input', () => {
  const value = lightInput.valueAsNumber;
  setText('light-value', String(value));
  updateRange(lightInput);
  document.getElementById('ocean-scene')!.setAttribute('style', `filter: brightness(${0.55 + value / 100})`);
  document.getElementById('camera-video')!.style.filter = `brightness(${0.65 + value / 100})`;
});

byId<HTMLButtonElement>('pause-button').addEventListener('click', (event) => {
  simulationPaused = !simulationPaused;
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = simulationPaused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', simulationPaused ? 'Resume live data' : 'Pause live data');
  button.title = simulationPaused ? 'Resume live data' : 'Pause live data';
  setText('stream-label', simulationPaused ? 'STREAM PAUSED' : (cameraStream ? 'CAMERA CONNECTED' : 'LIVE SIMULATION'));
  showToast(simulationPaused ? 'Telemetry stream paused.' : 'Live telemetry resumed.');
});

cameraButton.addEventListener('click', async () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
    cameraVideo.srcObject = null;
    cameraView.classList.remove('video-active');
    cameraButton.setAttribute('aria-label', 'Start camera');
    cameraButton.title = 'Start camera';
    setText('camera-status', 'DEMO FOOTAGE');
    setText('feed-status', 'demo mode');
    setText('stream-label', simulationPaused ? 'STREAM PAUSED' : 'LIVE SIMULATION');
    showToast('Camera stopped. Demo view restored.');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Live camera is not available in this browser context; demo footage remains on.');
    return;
  }

  cameraButton.disabled = true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraView.classList.add('video-active');
    cameraButton.setAttribute('aria-label', 'Stop camera');
    cameraButton.title = 'Stop camera';
    setText('camera-status', 'LOCAL CAMERA');
    setText('feed-status', 'local camera');
    setText('stream-label', 'CAMERA CONNECTED');
    showToast('Local camera connected. Video stays on this device.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Camera permission was not granted.';
    showToast(`Could not start camera: ${message}`);
  } finally {
    cameraButton.disabled = false;
  }
});

byId<HTMLButtonElement>('snapshot-button').addEventListener('click', () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('This browser could not create a camera snapshot.');
    return;
  }
  if (cameraStream && cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  } else {
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, '#082a40');
    background.addColorStop(1, '#07151e');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#b6d6d5';
    context.font = '32px sans-serif';
    context.fillText('PELAGIC II · DEMO CAMERA FRAME', 48, 76);
    context.fillStyle = '#72d9c6';
    context.font = '22px monospace';
    context.fillText(`DEPTH ${formatDepth(readings.depth.at(-1) ?? 0)} M  ·  ${(readings.temperature.at(-1) ?? 0).toFixed(1)}°C`, 48, 120);
    context.fillStyle = '#486b78';
    context.beginPath();
    context.ellipse(690, 665, 760, 200, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#c07879';
    context.beginPath();
    context.ellipse(215, 648, 38, 90, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#1c3e4b';
    context.beginPath();
    context.ellipse(690, 405, 115, 36, 0, 0, Math.PI * 2);
    context.fill();
  }
  const link = document.createElement('a');
  link.download = `pelagic-ii-${new Date().toISOString().replaceAll(':', '-')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('Camera snapshot saved.');
});

byId<HTMLButtonElement>('refresh-sensors').addEventListener('click', () => {
  if (activeSensors.has('ctd')) {
    advanceValue('temperature', tickCount);
    advanceValue('depth', tickCount);
  }
  if (activeSensors.has('pressure')) advanceValue('pressure', tickCount);
  if (activeSensors.has('oxygen')) advanceValue('oxygen', tickCount);
  showToast('Sensor readings refreshed.');
});

byId<HTMLButtonElement>('inject-sensor-alert').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('abyssal:action:report-sensors', {
    detail: { temperatureC: 9.2, pressureMpa: 62, oxygenMgL: 1.2 },
  }));
  showToast('Submitting a simulated sensor anomaly to the shared alert stream.');
});

byId<HTMLSelectElement>('chart-range').addEventListener('change', (event) => {
  const range = Number((event.currentTarget as HTMLSelectElement).value);
  const samples = range * 12;
  setText('chart-time-start', `${range} min ago`);
  readings.temperature = readings.temperature.slice(-samples);
  drawTemperatureChart();
});

document.querySelectorAll<HTMLAnchorElement>('.side-nav .nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelector('.side-nav .nav-link.active')?.classList.remove('active');
    link.classList.add('active');
  });
});

updateRange(temperatureInput);
updateRange(lightInput);
drawTemperatureChart();
Object.keys(readings).forEach((reading) => renderReading(reading as Reading));
updateSensors();
setText('mission-clock', `${new Date().toISOString().slice(11, 19)} UTC`);
connectExploration(showToast);
connectMarineLife(showToast);

window.setInterval(() => {
  setText('mission-clock', `${new Date().toISOString().slice(11, 19)} UTC`);
  setText('frame-time', tickCount === 0 ? 'just now' : `${tickCount}s ago`);
  if (simulationPaused) return;
  tickCount += 1;
  elapsedSeconds += 1;
  setText('elapsed-time', formatDuration(elapsedSeconds));
  if (activeSensors.has('ctd')) {
    advanceValue('depth', tickCount);
    advanceValue('temperature', tickCount);
  }
  if (activeSensors.has('pressure')) advanceValue('pressure', tickCount);
  if (activeSensors.has('oxygen')) advanceValue('oxygen', tickCount);
  window.dispatchEvent(new CustomEvent('abyssal:telemetry', {
    detail: {
      depth: readings.depth.at(-1),
      temperature: readings.temperature.at(-1),
      oxygen: readings.oxygen.at(-1),
    },
  }));
  if (tickCount % 10 === 0) {
    window.dispatchEvent(new CustomEvent('abyssal:action:report-sensors', {
      detail: {
        temperatureC: readings.temperature.at(-1) ?? 2.4,
        pressureMpa: readings.pressure.at(-1) ?? 38.7,
        oxygenMgL: readings.oxygen.at(-1) ?? 4.8,
      },
    }));
  }
}, 1000);

window.addEventListener('beforeunload', () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
  window.clearTimeout(toastTimeout);
});
