import { DbConnection, tables } from './module_bindings';
import type {
  Discovery,
  MarineObservation,
  Mission,
  SensorAlert,
  SensorReading,
  Submarine,
} from './module_bindings/types';

type Notify = (message: string) => void;

type ObisFeature = {
  geometry: { coordinates: number[][][] };
  properties: { n: number };
};

type ObisGrid = { features?: ObisFeature[] };

const DB_HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
const DB_NAME = 'hackutd2026-5b053';
const TOKEN_KEY = `${DB_HOST}/${DB_NAME}/auth_token`;
const DEMO_STORAGE_KEY = 'abyssal-simulated-rov-observations-v1';
const robotExamples = [
  {
    commonName: 'Lanternfish (family-level ID)',
    scientificName: 'Myctophidae',
    region: 'Pacific',
    latitude: -32,
    longitude: -178,
    depthM: 740,
    lengthCm: 8.4,
    notes: 'SIMULATED SCENARIO · Example ROV image classifier flag. Not a real sighting.',
    reviewStatus: 'Uncertain identification',
  },
  {
    commonName: 'Dumbo octopus',
    scientificName: 'Grimpoteuthis sp.',
    region: 'Pacific',
    latitude: -31.5,
    longitude: -177.5,
    depthM: 4820,
    lengthCm: 24,
    notes: 'SIMULATED SCENARIO · Silhouette match confidence low; expert identification needed.',
    reviewStatus: 'Uncertain identification',
  },
  {
    commonName: 'Vampire squid',
    scientificName: 'Vampyroteuthis infernalis',
    region: 'Atlantic',
    latitude: 18.5,
    longitude: -65.5,
    depthM: 910,
    lengthCm: 18,
    notes: 'SIMULATED SCENARIO · Example oxygen-minimum-zone encounter.',
    reviewStatus: 'Known species',
  },
  {
    commonName: 'Giant squid',
    scientificName: 'Architeuthis dux',
    region: 'Southern',
    latitude: -58,
    longitude: -26,
    depthM: 1260,
    lengthCm: 160,
    notes: 'SIMULATED SCENARIO · Possible-range flag is a demo lead, not a verified range extension.',
    reviewStatus: 'Possible range extension',
  },
  {
    commonName: 'Grenadier',
    scientificName: 'Coryphaenoides armatus',
    region: 'Pacific',
    latitude: -23,
    longitude: -174,
    depthM: 3250,
    lengthCm: 48,
    notes: 'SIMULATED SCENARIO · Recorded while the ROV maps a trench slope.',
    reviewStatus: 'Known species',
  },
  {
    commonName: 'Sea cucumber',
    scientificName: 'Elpidiidae',
    region: 'Indian',
    latitude: -10,
    longitude: 110,
    depthM: 6100,
    lengthCm: 11,
    notes: 'SIMULATED SCENARIO · Example benthic observation; taxon is intentionally broad.',
    reviewStatus: 'Uncertain identification',
  },
] as const;

export type MissionObservation = {
  id: string;
  commonName: string;
  scientificName: string;
  latitude: number;
  longitude: number;
  region: string;
  lengthCm: number;
  depthM: number;
  ageEstimateYears: number;
  conservationStatus: string;
  conservationSource: string;
  biologicalSource: string;
  reviewStatus: string;
  evidenceSource: string;
  notes: string;
  reportedBy: string;
  isSimulated: boolean;
  robotReportId: string;
  recordedAt: Date;
};

const getInput = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();
const getNumber = (formData: FormData, name: string) => Number(formData.get(name));
const formattedCoordinate = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(1)}°${value < 0 ? negative : positive}`;

function appendBar(
  container: HTMLElement,
  label: string,
  count: number,
  max: number,
  labelClass: string,
  countClass: string,
  fillClass: string
) {
  const row = document.createElement('div');
  row.className = 'distribution-row';
  const rowLabel = document.createElement('span');
  rowLabel.className = labelClass;
  rowLabel.textContent = label;
  const track = document.createElement('span');
  track.className = 'distribution-track';
  const fill = document.createElement('span');
  fill.className = fillClass;
  fill.style.width = `${Math.max(1, (count / Math.max(max, 1)) * 100)}%`;
  track.append(fill);
  const rowCount = document.createElement('span');
  rowCount.className = countClass;
  rowCount.textContent = count.toLocaleString();
  row.append(rowLabel, track, rowCount);
  container.append(row);
}

function setConnectionStatus(state: 'connecting' | 'connected' | 'error', text: string) {
  const status = document.getElementById('db-status');
  const badge = document.querySelector<HTMLElement>('.db-connection');
  const button = document.getElementById('submit-observation') as HTMLButtonElement | null;
  if (!status || !badge || !button) return;
  status.textContent = text;
  badge.classList.toggle('connected', state === 'connected');
  badge.classList.toggle('error', state === 'error');
  button.disabled = state !== 'connected';
  if (state === 'connected') button.innerHTML = 'Add to shared mission log <span>↗</span>';
  if (state === 'connecting') button.textContent = 'Connecting to database…';
  if (state === 'error') button.textContent = 'Database unavailable';
}

function safeSourceLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function safeJournalImage(value: string) {
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 120_000) {
    return value;
  }
  const url = safeSourceLink(value);
  return url && /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url) ? url : '';
}

function makeRobotExample(index: number): MissionObservation {
  const example = robotExamples[index];
  return {
    id: `demo-seed-${String(index + 1).padStart(2, '0')}`,
    ...example,
    ageEstimateYears: 0,
    conservationStatus: 'Unknown',
    conservationSource: '',
    biologicalSource: '',
    evidenceSource: '',
    reportedBy: 'NAUTILUS-01 · SIMULATED ROV',
    isSimulated: true,
    robotReportId: `nautilus-demo-seed-${String(index + 1).padStart(2, '0')}`,
    recordedAt: new Date(Date.now() - (robotExamples.length - index) * 90_000),
  };
}

function readLocalRobotReports(): MissionObservation[] {
  try {
    const stored = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!stored) return robotExamples.map((_, index) => makeRobotExample(index));
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error('Stored simulated ROV reports are not a list.');
    return parsed.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Stored ROV report is invalid.');
      const report = entry as Omit<MissionObservation, 'recordedAt'> & { recordedAt: string };
      return { ...report, recordedAt: new Date(report.recordedAt) };
    });
  } catch (error) {
    console.error('Could not restore local simulated ROV reports.', error);
    return robotExamples.map((_, index) => makeRobotExample(index));
  }
}

let localRobotReports = readLocalRobotReports();
let remoteObservations: MarineObservation[] = [];
let activeConnection: DbConnection | undefined;
let currentIdentity = '';
let robotReportsPaused = false;
let robotTimer = 0;
let currentReportIndex = 0;
let lastRobotReportAt = new Date();

function storeLocalRobotReports() {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(localRobotReports.slice(-120)));
  } catch (error) {
    console.error('Could not save simulated ROV reports locally.', error);
  }
}

function toMissionObservation(row: MarineObservation): MissionObservation {
  return {
    id: String(row.id),
    commonName: row.commonName,
    scientificName: row.scientificName,
    latitude: row.latitude,
    longitude: row.longitude,
    region: row.region,
    lengthCm: row.lengthCm,
    depthM: row.depthM,
    ageEstimateYears: row.ageEstimateYears,
    conservationStatus: row.conservationStatus,
    conservationSource: row.conservationSource,
    biologicalSource: row.biologicalSource,
    reviewStatus: row.reviewStatus,
    evidenceSource: row.evidenceSource,
    notes: row.notes,
    reportedBy: row.reportedBy,
    isSimulated: row.isSimulated,
    robotReportId: row.robotReportId,
    recordedAt: new Date(Number(row.recordedAt.microsSinceUnixEpoch / 1000n)),
  };
}

function combinedObservations() {
  const rows = new Map<string, MissionObservation>();
  remoteObservations.forEach((row) => {
    const display = toMissionObservation(row);
    rows.set(display.robotReportId || `db-${display.id}`, display);
  });
  localRobotReports.forEach((row) => {
    const key = row.robotReportId || row.id;
    if (!rows.has(key)) rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
}

function publishObservations() {
  const rows = combinedObservations();
  window.dispatchEvent(new CustomEvent<MissionObservation[]>('abyssal:observations', { detail: rows }));
  renderSightingsChart(rows);
  renderObservationJournal(rows);
}

function renderSightingsChart(rows: MissionObservation[]) {
  const chart = document.getElementById('sighting-chart');
  if (!chart) return;
  chart.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-chart';
    empty.textContent = 'Your submitted observations will build this regional chart.';
    chart.append(empty);
    return;
  }

  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.region, (counts.get(row.region) ?? 0) + 1));
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];
  sorted.forEach(([region, count]) => {
    const bar = document.createElement('div');
    bar.className = 'sighting-bar-row';
    const label = document.createElement('span');
    label.className = 'sighting-bar-label';
    label.textContent = region;
    const track = document.createElement('span');
    track.className = 'sighting-bar-track';
    const fill = document.createElement('span');
    fill.className = 'sighting-bar-fill';
    fill.style.width = `${Math.max(2, (count / max) * 100)}%`;
    track.append(fill);
    const total = document.createElement('span');
    total.className = 'sighting-bar-count';
    total.textContent = String(count);
    bar.append(label, track, total);
    chart.append(bar);
  });
}

function renderObservationJournal(rows: MissionObservation[]) {
  const list = document.getElementById('observation-list');
  const count = document.getElementById('observation-count');
  if (!list || !count) return;

  count.textContent = `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`;
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-observations';
    empty.textContent = 'No sightings logged yet. Record one to start the expedition dataset.';
    list.append(empty);
    renderSightingsChart(rows);
    return;
  }

  rows.forEach((observation) => {
    const card = document.createElement('article');
    card.className = 'observation-card';
    const top = document.createElement('div');
    top.className = 'observation-card-top';
    const title = document.createElement('div');
    const commonName = document.createElement('div');
    commonName.className = 'observation-card-title';
    commonName.textContent = observation.commonName;
    const scientificName = document.createElement('div');
    scientificName.className = 'observation-card-scientific';
    scientificName.textContent = observation.scientificName;
    title.append(commonName, scientificName);
    const review = document.createElement('span');
    review.className = 'observation-card-status';
    if (observation.reviewStatus !== 'Known species') review.classList.add('review');
    review.textContent = observation.reviewStatus === 'Known species'
      ? 'IDENTIFIED'
      : 'EXPERT REVIEW';
    top.append(title, review);

    const details = document.createElement('div');
    details.className = 'observation-card-meta';
    const time = observation.recordedAt;
    const ageText = observation.ageEstimateYears > 0
      ? `~${observation.ageEstimateYears} yr (rough estimate)`
      : 'Age unknown';
    [
      `${observation.lengthCm.toLocaleString()} cm`,
      `${observation.depthM.toLocaleString()} m deep`,
      ageText,
      observation.region,
      `${formattedCoordinate(observation.latitude, 'N', 'S')} · ${formattedCoordinate(observation.longitude, 'E', 'W')}`,
      time.toLocaleString(),
    ].forEach((text) => {
      const item = document.createElement('span');
      item.textContent = text;
      details.append(item);
    });

    const conservation = document.createElement('div');
    conservation.className = 'observation-card-meta';
    const conservationText = document.createElement('span');
    conservationText.textContent = `Conservation: ${observation.conservationStatus}`;
    if (
      ['Vulnerable', 'Endangered', 'Critically endangered', 'Rare (reported)'].includes(
        observation.conservationStatus
      )
    ) {
      conservationText.classList.add('conservation-flag');
    }
    conservation.append(conservationText);
    if (observation.conservationSource) {
      const verifiedLink = safeSourceLink(observation.conservationSource);
      if (verifiedLink) {
        const source = document.createElement('a');
        source.className = 'observation-card-source';
        source.href = verifiedLink;
        source.target = '_blank';
        source.rel = 'noreferrer';
        source.textContent = 'Open cited status source ↗';
        conservation.append(source);
      }
    } else if (observation.conservationStatus !== 'Unknown') {
      const unverified = document.createElement('span');
      unverified.textContent = ' · source not supplied; unverified';
      conservation.append(unverified);
    }

    const reporter = document.createElement('span');
    reporter.className = 'observation-reporter';
    reporter.textContent = observation.isSimulated
      ? 'ROBOT REPORT · SIMULATED'
      : `REPORTED BY ${observation.reportedBy}`;
    top.append(reporter);
    card.append(top, details, conservation);
    if (observation.notes) {
      const notes = document.createElement('p');
      notes.className = 'observation-card-notes';
      notes.textContent = observation.notes;
      card.append(notes);
    }
    const evidence = safeSourceLink(observation.evidenceSource);
    const journalImage = safeJournalImage(observation.evidenceSource);
    if (journalImage) {
      const image = document.createElement('img');
      image.className = 'observation-image';
      image.src = journalImage;
      image.alt = `Field evidence for ${observation.commonName}`;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      card.append(image);
    }
    if (evidence) {
      const link = document.createElement('a');
      link.className = 'observation-card-source';
      link.href = evidence;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Open evidence ↗';
      card.append(link);
    }
    list.append(card);
  });
}

function renderObservations(connection: DbConnection) {
  remoteObservations = [...connection.db.marineObservation.iter()];
  publishObservations();
  updateRobotStreamStatus();
}

function publishSharedState(connection: DbConnection) {
  const submarines = [...connection.db.submarine.iter()].map((row: Submarine) => ({
    owner: row.owner.toHexString(),
    callsign: row.callsign,
    latitude: row.latitude,
    longitude: row.longitude,
    depthM: row.depthM,
    batteryPct: row.batteryPct,
    status: row.status,
    assignedMissionId: row.assignedMissionId,
    isSimulated: row.isSimulated,
    updatedAt: new Date(Number(row.updatedAt.microsSinceUnixEpoch / 1000n)),
  }));
  const missions = [...connection.db.mission.iter()].map((row: Mission) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    depthM: row.depthM,
    status: row.status,
    assignedSubmarine: row.assignedSubmarine?.toHexString() ?? null,
    progressPct: row.progressPct,
    updatedAt: new Date(Number(row.updatedAt.microsSinceUnixEpoch / 1000n)),
  }));
  const discoveries = [...connection.db.discovery.iter()].map((row: Discovery) => ({
    id: row.id,
    reporter: row.reporter.toHexString(),
    kind: row.kind,
    name: row.name,
    notes: row.notes,
    latitude: row.latitude,
    longitude: row.longitude,
    depthM: row.depthM,
    isSimulated: row.isSimulated,
    recordedAt: new Date(Number(row.recordedAt.microsSinceUnixEpoch / 1000n)),
  }));
  const alerts = [...connection.db.sensorAlert.iter()].map((row: SensorAlert) => ({
    id: row.id,
    submarine: row.submarine.toHexString(),
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    reading: row.reading,
    threshold: row.threshold,
    acknowledged: row.acknowledged,
    acknowledgedBy: row.acknowledgedBy?.toHexString() ?? null,
    isSimulated: row.isSimulated,
    recordedAt: new Date(Number(row.recordedAt.microsSinceUnixEpoch / 1000n)),
  }));
  const readings = [...connection.db.sensorReading.iter()].map((row: SensorReading) => ({
    submarine: row.submarine.toHexString(),
    temperatureC: row.temperatureC,
    pressureMpa: row.pressureMpa,
    oxygenMgL: row.oxygenMgL,
    isSimulated: row.isSimulated,
    recordedAt: new Date(Number(row.recordedAt.microsSinceUnixEpoch / 1000n)),
  }));
  window.dispatchEvent(new CustomEvent('abyssal:shared:submarines', { detail: submarines }));
  window.dispatchEvent(new CustomEvent('abyssal:shared:missions', { detail: missions }));
  window.dispatchEvent(new CustomEvent('abyssal:shared:discoveries', { detail: discoveries }));
  window.dispatchEvent(new CustomEvent('abyssal:shared:alerts', { detail: alerts }));
  window.dispatchEvent(new CustomEvent('abyssal:shared:readings', { detail: readings }));
}

function installSharedActionHandlers(notify: Notify) {
  const submit = (action: string, operation: (connection: DbConnection) => Promise<unknown>) => {
    const connection = activeConnection;
    if (!connection?.isActive) {
      notify('Connect to the shared mission database before using this control.');
      return;
    }
    void operation(connection).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown reducer error.';
      console.error(`SpacetimeDB action ${action} failed.`, error);
      notify(`Could not ${action}: ${message}`);
    });
  };
  window.addEventListener('abyssal:action:move', (event) => {
    const position = (event as CustomEvent<{
      latitude: number; longitude: number; depthM: number; batteryPct: number;
    }>).detail;
    submit('move the submarine', (connection) => connection.reducers.updateSubmarinePosition(position));
  });
  window.addEventListener('abyssal:action:create-discovery', (event) => {
    const report = (event as CustomEvent<{
      kind: string; name: string; notes: string; latitude: number; longitude: number; depthM: number;
    }>).detail;
    submit('save the discovery', (connection) => connection.reducers.createDiscovery(report));
  });
  window.addEventListener('abyssal:action:create-mission', (event) => {
    const mission = (event as CustomEvent<{
      title: string; description: string; region: string; latitude: number; longitude: number; depthM: number;
    }>).detail;
    submit('create the mission', (connection) => connection.reducers.createMission(mission));
  });
  window.addEventListener('abyssal:action:assign-mission', (event) => {
    const { missionId } = (event as CustomEvent<{ missionId: bigint }>).detail;
    submit('assign the mission', (connection) => connection.reducers.assignMission({ missionId }));
  });
  window.addEventListener('abyssal:action:mission-progress', (event) => {
    const progress = (event as CustomEvent<{ missionId: bigint; progressPct: number }>).detail;
    submit('update mission progress', (connection) => connection.reducers.updateMissionProgress(progress));
  });
  window.addEventListener('abyssal:action:ack-alert', (event) => {
    const { alertId } = (event as CustomEvent<{ alertId: bigint }>).detail;
    submit('acknowledge the alert', (connection) => connection.reducers.acknowledgeSensorAlert({ alertId }));
  });
  window.addEventListener('abyssal:action:report-sensors', (event) => {
    const reading = (event as CustomEvent<{
      temperatureC: number; pressureMpa: number; oxygenMgL: number;
    }>).detail;
    submit('share the sensor reading', (connection) => connection.reducers.reportSensorReading(reading));
  });
}

function robotReportPayload(report: MissionObservation) {
  return {
    commonName: report.commonName,
    scientificName: report.scientificName,
    latitude: report.latitude,
    longitude: report.longitude,
    region: report.region,
    lengthCm: report.lengthCm,
    depthM: report.depthM,
    referenceAdultLengthCm: 0,
    referenceLifespanYears: 0,
    biologicalSource: '',
    conservationStatus: 'Unknown',
    conservationSource: '',
    reviewStatus: report.reviewStatus,
    evidenceSource: '',
    notes: report.notes,
    robotReportId: report.robotReportId,
  };
}

function updateRobotStreamStatus() {
  const status = document.getElementById('robot-stream-status');
  const count = document.getElementById('robot-report-count');
  const time = document.getElementById('robot-report-time');
  const toggle = document.getElementById('robot-stream-toggle') as HTMLButtonElement | null;
  const badge = document.querySelector<HTMLElement>('.robot-uplink');
  if (!status || !count || !time || !toggle || !badge) return;
  const hasLiveDatabase = Boolean(activeConnection?.isActive);
  status.textContent = robotReportsPaused
    ? 'STREAM PAUSED'
    : hasLiveDatabase
      ? 'LIVE DATABASE · SIMULATED ROV'
      : 'LOCAL PREVIEW · SIMULATED ROV';
  badge.classList.toggle('database-connected', hasLiveDatabase && !robotReportsPaused);
  badge.classList.toggle('stream-paused', robotReportsPaused);
  count.textContent = String(localRobotReports.length);
  time.textContent = lastRobotReportAt.toLocaleTimeString();
  toggle.textContent = robotReportsPaused ? 'Resume reports' : 'Pause reports';
}

async function reportToDatabase(report: MissionObservation) {
  if (!activeConnection?.isActive) return;
  await activeConnection.reducers.reportRobotObservation(robotReportPayload(report));
}

function makeLiveRobotReport(notify: Notify) {
  const example = robotExamples[currentReportIndex % robotExamples.length];
  const reportId = `nautilus-live-${Math.floor(Date.now() / 45_000)}`;
  if (localRobotReports.some((row) => row.robotReportId === reportId) ||
      remoteObservations.some((row) => row.robotReportId === reportId)) {
    return;
  }
  currentReportIndex += 1;
  const siteIndex = currentReportIndex % 3;
  const report: MissionObservation = {
    id: reportId,
    commonName: example.commonName,
    scientificName: example.scientificName,
    latitude: example.latitude + (Math.random() - 0.5) * 0.4,
    longitude: example.longitude + (Math.random() - 0.5) * 0.4,
    region: siteIndex === 1 ? 'Pacific' : example.region,
    lengthCm: Number((example.lengthCm * (0.94 + Math.random() * 0.12)).toFixed(1)),
    depthM: Math.max(50, Math.round(example.depthM + (Math.random() - 0.5) * 300)),
    ageEstimateYears: 0,
    conservationStatus: 'Unknown',
    conservationSource: '',
    biologicalSource: '',
    reviewStatus: example.reviewStatus,
    evidenceSource: '',
    notes: `SIMULATED SCENARIO · Automated NAUTILUS-01 sample scan ${currentReportIndex}. Synthetic values awaiting human review.`,
    reportedBy: 'NAUTILUS-01 · SIMULATED ROV',
    isSimulated: true,
    robotReportId: reportId,
    recordedAt: new Date(),
  };
  localRobotReports = [...localRobotReports, report].slice(-120);
  lastRobotReportAt = report.recordedAt;
  storeLocalRobotReports();
  publishObservations();
  updateRobotStreamStatus();
  void reportToDatabase(report).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown reducer error.';
    console.error(`Simulated ROV report ${reportId} was not saved to SpacetimeDB.`, error);
    const status = document.getElementById('robot-stream-status');
    if (status && activeConnection?.isActive) status.textContent = 'DATABASE REPORT FAILED';
    notify(`ROV sample is in the local preview but failed to save to the shared database: ${message}`);
  });
}

function syncSeedReportsToDatabase(connection: DbConnection, notify: Notify) {
  const existingReportIds = new Set(
    [...connection.db.marineObservation.iter()].map((row) => row.robotReportId)
  );
  const reports = localRobotReports.filter(
    (row) => row.isSimulated && row.robotReportId && !existingReportIds.has(row.robotReportId)
  );
  void reports.reduce(
    (previous, report) => previous.then(() => connection.reducers.reportRobotObservation(robotReportPayload(report))),
    Promise.resolve()
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown reducer error.';
    console.error('Could not sync simulated ROV sample reports to SpacetimeDB.', error);
    notify(`The local ROV sample data is ready, but could not be copied to the shared database: ${message}`);
  });
}

function startRobotReportStream(notify: Notify) {
  const toggle = document.getElementById('robot-stream-toggle');
  toggle?.addEventListener('click', () => {
    robotReportsPaused = !robotReportsPaused;
    updateRobotStreamStatus();
    if (!robotReportsPaused) makeLiveRobotReport(notify);
  });
  publishObservations();
  updateRobotStreamStatus();
  robotTimer = window.setInterval(() => {
    if (robotReportsPaused || document.visibilityState !== 'visible') return;
    makeLiveRobotReport(notify);
  }, 45_000);
  window.addEventListener('beforeunload', () => window.clearInterval(robotTimer));
}

function addObisFeature(container: HTMLElement, feature: ObisFeature, max: number) {
  const ring = feature.geometry.coordinates[0];
  if (!ring?.length) return;
  const longitudes = ring.map((point) => point[0]);
  const latitudes = ring.map((point) => point[1]);
  const label = `${Math.min(...latitudes).toFixed(0)}–${Math.max(...latitudes).toFixed(0)}° lat · ${Math.min(...longitudes).toFixed(0)}–${Math.max(...longitudes).toFixed(0)}° lon`;
  appendBar(container, label, feature.properties.n, max, 'distribution-label', 'distribution-count', 'distribution-bar');
}

async function compareWithObis(scientificName: string, notify: Notify, requestId: number) {
  const status = document.getElementById('obis-status');
  const chart = document.getElementById('obis-chart');
  const summary = document.getElementById('obis-summary');
  const sourceLink = document.getElementById('obis-source-link') as HTMLAnchorElement | null;
  if (!status || !chart || !summary || !sourceLink) return;

  const query = encodeURIComponent(scientificName);
  const apiUrl = `https://api.obis.org/v3/occurrence/grid/2?scientificname=${query}`;
  sourceLink.href = apiUrl;
  status.classList.remove('error');
  status.textContent = 'Loading global occurrence cells from OBIS…';
  chart.replaceChildren();
  summary.hidden = true;

  try {
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OBIS returned HTTP ${response.status}.`);
    const data = (await response.json()) as ObisGrid;
    if (requestId !== obisRequestId) return;
    const features = (data.features ?? [])
      .filter((feature) => Number.isFinite(feature.properties?.n) && feature.properties.n > 0)
      .sort((a, b) => b.properties.n - a.properties.n);
    if (features.length === 0) {
      status.textContent = `OBIS has no mapped occurrence cells for “${scientificName}”. Check the spelling or try an accepted scientific name.`;
      return;
    }

    const total = features.reduce((sum, feature) => sum + feature.properties.n, 0);
    const totalLabel = document.createElement('span');
    totalLabel.textContent = 'Records represented in mapped cells';
    const totalCount = document.createElement('strong');
    totalCount.textContent = total.toLocaleString();
    summary.replaceChildren(totalLabel, totalCount);
    summary.hidden = false;
    features.slice(0, 6).forEach((feature) => addObisFeature(chart, feature, features[0].properties.n));
    status.textContent = `Showing the ${Math.min(features.length, 6)} highest-count grid cells for ${scientificName}.`;
  } catch (error) {
    if (requestId !== obisRequestId) return;
    const message = error instanceof Error ? error.message : 'Unknown request error.';
    status.classList.add('error');
    status.textContent = `Could not load OBIS data: ${message}`;
    notify('OBIS comparison failed. Check your connection and try again.');
  }
}

let obisRequestId = 0;

export function connectMarineLife(notify: Notify) {
  const observationForm = document.getElementById('observation-form') as HTMLFormElement | null;
  const obisForm = document.getElementById('obis-search-form') as HTMLFormElement | null;
  const obisInput = document.getElementById('obis-search-name') as HTMLInputElement | null;
  if (!observationForm || !obisForm || !obisInput) throw new Error('Marine life interface is incomplete.');

  let connection: DbConnection | undefined;
  let subscribed = false;
  installSharedActionHandlers(notify);
  startRobotReportStream(notify);
  setConnectionStatus('connecting', 'CONNECTING TO MAINcloud');

  const builder = DbConnection.builder()
    .withUri(DB_HOST)
    .withDatabaseName(DB_NAME)
    .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
    .withAutomaticReconnect()
    .onConnect((conn, identity, token) => {
      localStorage.setItem(TOKEN_KEY, token);
      connection = conn;
      activeConnection = conn;
      currentIdentity = identity.toHexString();
      window.dispatchEvent(new CustomEvent('abyssal:shared:connected', {
        detail: { identity: currentIdentity },
      }));
      setConnectionStatus('connecting', 'CONNECTED · SYNCING TABLE');
      const callsign = `ROV-${currentIdentity.slice(-4).toUpperCase()}`;
      void conn.reducers.registerSubmarine({ callsign }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown reducer error.';
        console.error('Could not register the shared submarine.', error);
        notify(`Could not register this client as a submarine: ${message}`);
      });
      if (subscribed) return;
      subscribed = true;
      conn.db.marineObservation.onInsert(() => renderObservations(conn));
      conn.db.marineObservation.onDelete(() => renderObservations(conn));
      conn.db.marineObservation.onUpdate(() => renderObservations(conn));
      conn.db.submarine.onInsert(() => publishSharedState(conn));
      conn.db.submarine.onDelete(() => publishSharedState(conn));
      conn.db.submarine.onUpdate(() => publishSharedState(conn));
      conn.db.mission.onInsert(() => publishSharedState(conn));
      conn.db.mission.onDelete(() => publishSharedState(conn));
      conn.db.mission.onUpdate(() => publishSharedState(conn));
      conn.db.discovery.onInsert(() => publishSharedState(conn));
      conn.db.discovery.onDelete(() => publishSharedState(conn));
      conn.db.discovery.onUpdate(() => publishSharedState(conn));
      conn.db.sensorAlert.onInsert(() => publishSharedState(conn));
      conn.db.sensorAlert.onDelete(() => publishSharedState(conn));
      conn.db.sensorAlert.onUpdate(() => publishSharedState(conn));
      conn.db.sensorReading.onInsert(() => publishSharedState(conn));
      conn.db.sensorReading.onDelete(() => publishSharedState(conn));
      conn.db.sensorReading.onUpdate(() => publishSharedState(conn));
      conn.subscriptionBuilder()
        .onApplied(() => {
          setConnectionStatus('connected', 'MAINcloud · REAL-TIME');
          const streamLabel = document.getElementById('stream-label');
          if (streamLabel) streamLabel.textContent = 'LIVE SHARED STATE · SIMULATED';
          renderObservations(conn);
          publishSharedState(conn);
          syncSeedReportsToDatabase(conn, notify);
          updateRobotStreamStatus();
        })
        .onError((context) => {
          const message = context.event?.message ?? 'The marine observation subscription was rejected.';
          setConnectionStatus('error', 'MODULE NOT READY');
          notify(`Could not subscribe to marine observations: ${message}`);
        })
        .subscribe([
          tables.marineObservation,
          tables.submarine,
          tables.mission,
          tables.discovery,
          tables.sensorReading,
          tables.sensorAlert,
        ]);
    })
    .onDisconnect(() => {
      setConnectionStatus('connecting', 'RECONNECTING');
      const streamLabel = document.getElementById('stream-label');
      if (streamLabel) streamLabel.textContent = 'RECONNECTING TO SHARED STATE';
      updateRobotStreamStatus();
    })
    .onConnectError((_context, error) => {
      setConnectionStatus('error', 'CONNECTION ERROR');
      updateRobotStreamStatus();
      notify(`Could not connect to SpacetimeDB: ${error.message}`);
    });
  connection = builder.build();

  const referenceInputs = [
    document.getElementById('length-cm') as HTMLInputElement | null,
    document.getElementById('adult-size-cm') as HTMLInputElement | null,
    document.getElementById('lifespan-years') as HTMLInputElement | null,
  ];
  referenceInputs.forEach((input) => input?.addEventListener('input', () => {
    const lengthCm = Number(referenceInputs[0]?.value);
    const adultLengthCm = Number(referenceInputs[1]?.value);
    const lifespan = Number(referenceInputs[2]?.value);
    const preview = document.getElementById('age-preview');
    if (!preview) return;
    if (lengthCm > 0 && adultLengthCm > 0 && lifespan > 0) {
      const age = Math.max(1, Math.min(lifespan, Math.round((lengthCm / adultLengthCm) * lifespan)));
      preview.textContent = `~${age} years · rough estimate`;
    } else {
      preview.textContent = 'Not enough reference data';
    }
  }));

  const imageUpload = document.getElementById('image-upload') as HTMLInputElement | null;
  const imageDataInput = document.getElementById('evidence-image') as HTMLInputElement | null;
  const imagePreview = document.getElementById('evidence-image-preview') as HTMLImageElement | null;
  const imageStatus = document.getElementById('image-upload-status');
  imageUpload?.addEventListener('change', async () => {
    const file = imageUpload.files?.[0];
    if (!file || !imageDataInput || !imagePreview || !imageStatus) return;
    if (!file.type.startsWith('image/')) {
      imageUpload.value = '';
      imageStatus.textContent = 'Choose a supported image file.';
      notify('Only image files can be attached.');
      return;
    }
    imageStatus.textContent = 'Compressing image for the shared field log…';
    try {
      const bitmap = await createImageBitmap(file);
      const maxDimension = 640;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image compression is not available in this browser.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const compress = (quality: number) => new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The image could not be compressed.'));
        }, 'image/jpeg', quality);
      });
      let blob = await compress(0.65);
      if (blob.size > 85_000) blob = await compress(0.48);
      if (blob.size > 85_000) throw new Error('Image is still too large after compression. Choose a smaller image.');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image could not be read.'));
        reader.onerror = () => reject(new Error('Image could not be read.'));
        reader.readAsDataURL(blob);
      });
      imageDataInput.value = dataUrl;
      imagePreview.src = dataUrl;
      imagePreview.hidden = false;
      imageStatus.textContent = `Ready to share · ${(blob.size / 1024).toFixed(0)} KB JPEG`;
    } catch (error) {
      imageDataInput.value = '';
      imagePreview.removeAttribute('src');
      imagePreview.hidden = true;
      imageStatus.textContent = 'Image attachment failed.';
      const message = error instanceof Error ? error.message : 'Unknown image error.';
      notify(`Could not attach image: ${message}`);
    }
  });

  observationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const activeConnection = connection;
    if (!activeConnection || !activeConnection.isActive) {
      notify('Connect to the mission database before submitting a sighting.');
      return;
    }

    const formData = new FormData(observationForm);
    const lengthCm = getNumber(formData, 'lengthCm');
    const referenceAdultLengthCm = getNumber(formData, 'adultSizeCm') || 0;
    const referenceLifespanYears = getNumber(formData, 'lifespanYears') || 0;
    const sourceValues = [
      getInput(formData, 'biologicalSource'),
      getInput(formData, 'conservationSource'),
      imageDataInput?.value || getInput(formData, 'evidenceSource'),
    ];
    if (
      sourceValues[0] && !safeSourceLink(sourceValues[0]) ||
      sourceValues[1] && !safeSourceLink(sourceValues[1]) ||
      sourceValues[2] && !safeSourceLink(sourceValues[2]) && !safeJournalImage(sourceValues[2])
    ) {
      notify('Source links must use http:// or https://.');
      return;
    }

    const submit = document.getElementById('submit-observation') as HTMLButtonElement | null;
    if (submit) submit.disabled = true;
    try {
      await activeConnection.reducers.addMarineObservation({
        commonName: getInput(formData, 'commonName'),
        scientificName: getInput(formData, 'scientificName'),
        latitude: getNumber(formData, 'latitude'),
        longitude: getNumber(formData, 'longitude'),
        region: getInput(formData, 'region'),
        lengthCm,
        depthM: getNumber(formData, 'depthM'),
        referenceAdultLengthCm,
        referenceLifespanYears,
        biologicalSource: sourceValues[0],
        conservationStatus: getInput(formData, 'conservationStatus'),
        conservationSource: sourceValues[1],
        reviewStatus: getInput(formData, 'reviewStatus'),
        evidenceSource: sourceValues[2],
        notes: getInput(formData, 'notes'),
        robotReportId: '',
      });
      notify('Observation submitted to the shared mission log.');
      observationForm.reset();
      if (imageDataInput) imageDataInput.value = '';
      if (imagePreview) {
        imagePreview.removeAttribute('src');
        imagePreview.hidden = true;
      }
      if (imageStatus) imageStatus.textContent = 'Attached images are shared with mission subscribers.';
      const preview = document.getElementById('age-preview');
      if (preview) preview.textContent = 'Not enough reference data';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reducer error.';
      notify(`Could not save observation: ${message}`);
    } finally {
      if (submit) submit.disabled = !connection?.isActive;
    }
  });

  obisForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const scientificName = obisInput.value.trim();
    if (!scientificName) return;
    const requestId = ++obisRequestId;
    void compareWithObis(scientificName, notify, requestId);
  });

  document.getElementById('scientific-name')?.addEventListener('change', (event) => {
    const scientificName = (event.currentTarget as HTMLInputElement).value.trim();
    if (scientificName) obisInput.value = scientificName;
  });
}
