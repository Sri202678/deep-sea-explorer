import type { MissionObservation } from './marineLife';

type Notify = (message: string) => void;
type Region = 'Pacific' | 'Atlantic' | 'Indian' | 'Southern' | 'Arctic';
type Site = {
  id: string;
  name: string;
  region: Region;
  latitude: number;
  longitude: number;
  depth: number;
  x: number;
  y: number;
};
type ViewPoint = { x: number; y: number; scale: number };
type SharedSubmarine = {
  owner: string;
  callsign: string;
  latitude: number;
  longitude: number;
  depthM: number;
  batteryPct: number;
  status: string;
  assignedMissionId: bigint | null;
  isSimulated: boolean;
  updatedAt: Date;
};
type SharedMission = {
  id: bigint;
  title: string;
  description: string;
  region: string;
  latitude: number;
  longitude: number;
  depthM: number;
  status: string;
  assignedSubmarine: string | null;
  progressPct: number;
  updatedAt: Date;
};
type SharedDiscovery = {
  id: bigint;
  reporter: string;
  kind: string;
  name: string;
  notes: string;
  latitude: number;
  longitude: number;
  depthM: number;
  isSimulated: boolean;
  recordedAt: Date;
};
type SharedAlert = {
  id: bigint;
  submarine: string;
  kind: string;
  severity: string;
  message: string;
  reading: number;
  threshold: number;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  isSimulated: boolean;
  recordedAt: Date;
};
type SharedReading = {
  submarine: string;
  temperatureC: number;
  pressureMpa: number;
  oxygenMgL: number;
  isSimulated: boolean;
  recordedAt: Date;
};

const sites: Site[] = [
  { id: 'kermadec', name: 'Kermadec Ridge', region: 'Pacific', latitude: -32, longitude: -178, depth: 5100, x: -0.02, y: 0.06 },
  { id: 'tonga', name: 'Tonga Trench', region: 'Pacific', latitude: -23, longitude: -174, depth: 10800, x: 0.66, y: -0.15 },
  { id: 'loyalty', name: 'Loyalty Basin', region: 'Pacific', latitude: -21, longitude: 168, depth: 3500, x: -0.66, y: -0.18 },
  { id: 'mariana', name: 'Mariana Trench', region: 'Pacific', latitude: 11, longitude: 142, depth: 10900, x: 0.7, y: 0.38 },
  { id: 'peru-chile', name: 'Peru–Chile Trench', region: 'Pacific', latitude: -24, longitude: -71, depth: 8000, x: -0.7, y: 0.48 },
  { id: 'kuril', name: 'Kuril–Kamchatka', region: 'Pacific', latitude: 48, longitude: 155, depth: 9500, x: 0.15, y: -0.63 },
  { id: 'puerto-rico', name: 'Puerto Rico Trench', region: 'Atlantic', latitude: 19, longitude: -66, depth: 8400, x: -0.2, y: -0.55 },
  { id: 'south-sandwich', name: 'South Sandwich Arc', region: 'Southern', latitude: -58, longitude: -26, depth: 7200, x: 0.35, y: 0.65 },
  { id: 'java', name: 'Sunda Deep', region: 'Indian', latitude: -10, longitude: 110, depth: 7200, x: 0.62, y: 0.42 },
  { id: 'fram', name: 'Fram Strait', region: 'Arctic', latitude: 79, longitude: 4, depth: 5600, x: -0.42, y: -0.58 },
];

const canvas = document.getElementById('ocean-map-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Missing 3D ocean map canvas.');
const context = canvas.getContext('2d');
if (!context) throw new Error('This browser does not support canvas rendering for the ocean map.');

let observations: MissionObservation[] = [];
let selectedSite = sites[0];
let vehicleLatitude = sites[0].latitude;
let vehicleLongitude = sites[0].longitude;
let missionState = 'CONNECTING';
let currentDepth = 3842;
let temperature = 2.4;
let oxygen = 4.8;
let currentIdentity = '';
let sharedSubmarines: SharedSubmarine[] = [];
let sharedMissions: SharedMission[] = [];
let sharedDiscoveries: SharedDiscovery[] = [];
let sharedAlerts: SharedAlert[] = [];
let sharedReadings: SharedReading[] = [];
let rotationX = -0.62;
let rotationY = -0.12;
let zoom = 1;
let dragOrigin: { x: number; y: number; rotationX: number; rotationY: number } | null = null;
let redrawFrame = 0;
let customSiteCount = 0;
let activeViewPoints: Array<{ site: Site; point: ViewPoint }> = [];

function byId<T extends Element = HTMLElement>(id: string): T;
function byId(id: string): Element {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required exploration element: #${id}`);
  return element;
}

function modulatedTerrain(x: number, y: number) {
  const ridgeOne = Math.sin(x * 5.2 + Math.sin(y * 2.4)) * 0.11;
  const ridgeTwo = Math.cos(y * 8.1 + x * 1.7) * 0.075;
  const trench = Math.exp(-Math.pow((x + 0.08 + Math.sin(y * 2) * 0.13) * 4.5, 2)) * 0.27;
  const vent = Math.exp(-(((x - 0.56) ** 2) + ((y - 0.48) ** 2)) * 14) * 0.2;
  return ridgeOne + ridgeTwo - trench + vent;
}

function project(x: number, y: number, height: number, width: number, canvasHeight: number): ViewPoint {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const rotatedX = x * cosY - height * sinY;
  const rotatedHeight = x * sinY + height * cosY;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const rotatedY = y * cosX - rotatedHeight * sinX;
  const finalHeight = y * sinX + rotatedHeight * cosX;
  const perspective = (2.5 / (3.4 - finalHeight)) * zoom;
  return {
    x: width / 2 + rotatedX * width * 0.39 * perspective,
    y: canvasHeight * 0.52 + rotatedY * canvasHeight * 0.48 * perspective,
    scale: perspective,
  };
}

function localPosition(site: Site) {
  const x = ((site.longitude - vehicleLongitude + 540) % 360 - 180) / 47;
  const y = (site.latitude - vehicleLatitude) / 43;
  return { x: Math.max(-1.35, Math.min(1.35, x)), y: Math.max(-1.3, Math.min(1.3, y)) };
}

function regionForCoordinates(latitude: number, longitude: number): Region {
  if (Math.abs(latitude) >= 60) return latitude > 0 ? 'Arctic' : 'Southern';
  if (longitude >= -30 && longitude <= 60) return 'Atlantic';
  if (longitude > 60 && longitude < 150) return 'Indian';
  return 'Pacific';
}

function plotSite(site: Site, point: ViewPoint, isVehicle: boolean, selected: boolean) {
  if (!context) return;
  const visible = point.x > 20 && point.x < canvas!.clientWidth - 20 && point.y > 28 && point.y < canvas!.clientHeight - 22;
  if (!visible) return;

  context.beginPath();
  context.arc(point.x, point.y, selected ? 8 : 5, 0, Math.PI * 2);
  context.fillStyle = isVehicle ? '#f5bc79' : selected ? '#f3bd78' : '#71dbc7';
  context.fill();
  context.strokeStyle = isVehicle ? 'rgba(255,215,166,.7)' : 'rgba(203,246,236,.68)';
  context.lineWidth = 1;
  context.stroke();
  if (selected || isVehicle) {
    context.font = '9px "DM Mono", monospace';
    context.textAlign = 'left';
    context.fillStyle = '#d8e6e8';
    context.fillText(isVehicle ? 'ROV' : site.name.toUpperCase(), point.x + 10, point.y - 7);
  }
  if (!isVehicle) activeViewPoints.push({ site, point });
}

function drawMap() {
  if (!context) return;
  const bounds = canvas!.getBoundingClientRect();
  if (bounds.width < 5 || bounds.height < 5) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const desiredWidth = Math.round(bounds.width * pixelRatio);
  const desiredHeight = Math.round(bounds.height * pixelRatio);
  if (canvas!.width !== desiredWidth || canvas!.height !== desiredHeight) {
    canvas!.width = desiredWidth;
    canvas!.height = desiredHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#082739');
  background.addColorStop(0.53, '#0b3145');
  background.addColorStop(1, '#071923');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.54, height * 0.42, 4, width * 0.54, height * 0.42, width * 0.6);
  glow.addColorStop(0, 'rgba(75, 171, 183, .16)');
  glow.addColorStop(1, 'rgba(5, 21, 31, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const cols = 30;
  const rows = 22;
  const mesh: ViewPoint[][] = [];
  for (let row = 0; row <= rows; row += 1) {
    const line: ViewPoint[] = [];
    const y = (row / rows) * 2 - 1;
    for (let col = 0; col <= cols; col += 1) {
      const x = (col / cols) * 2 - 1;
      line.push(project(x, y, modulatedTerrain(x, y), width, height));
    }
    mesh.push(line);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const points = [mesh[row][col], mesh[row][col + 1], mesh[row + 1][col + 1], mesh[row + 1][col]];
      const relief = modulatedTerrain((col / cols) * 2 - 1, (row / rows) * 2 - 1);
      const hue = 190 + Math.max(-14, Math.min(18, relief * 78));
      const lightness = Math.max(13, Math.min(28, 19 + relief * 28));
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context!.lineTo(point.x, point.y));
      context.closePath();
      context.fillStyle = `hsla(${hue}, 39%, ${lightness}%, .92)`;
      context.fill();
      context.strokeStyle = 'rgba(119, 207, 204, .15)';
      context.lineWidth = 0.55;
      context.stroke();
    }
  }

  context.strokeStyle = 'rgba(159, 223, 215, .13)';
  context.lineWidth = 1;
  for (let row = 0; row <= rows; row += 2) {
    context.beginPath();
    mesh[row].forEach((point, index) => {
      if (index === 0) context!.moveTo(point.x, point.y);
      else context!.lineTo(point.x, point.y);
    });
    context.stroke();
  }
  for (let col = 0; col <= cols; col += 2) {
    context.beginPath();
    for (let row = 0; row <= rows; row += 1) {
      if (row === 0) context.moveTo(mesh[row][col].x, mesh[row][col].y);
      else context.lineTo(mesh[row][col].x, mesh[row][col].y);
    }
    context.stroke();
  }

  activeViewPoints = [];
  sites.forEach((site) => {
    const local = localPosition(site);
    const point = project(local.x, local.y, modulatedTerrain(local.x, local.y) + 0.05, width, height);
    plotSite(site, point, false, site.id === selectedSite.id);
  });
  observations.forEach((observation) => {
    const local = localPosition({
      id: '',
      name: '',
      region: 'Pacific',
      latitude: observation.latitude,
      longitude: observation.longitude,
      depth: observation.depthM,
      x: 0,
      y: 0,
    });
    if (Math.abs(local.x) > 1 || Math.abs(local.y) > 1) return;
    const point = project(local.x, local.y, modulatedTerrain(local.x, local.y) + 0.07, width, height);
    if (point.x > 20 && point.x < width - 20 && point.y > 28 && point.y < height - 22) {
      context!.beginPath();
      context!.arc(point.x, point.y, 3.3, 0, Math.PI * 2);
      context!.fillStyle = '#bb9bed';
      context!.fill();
      context!.strokeStyle = 'rgba(234,216,255,.7)';
      context!.stroke();
    }
  });

  sharedDiscoveries.forEach((discovery) => {
    const local = localPosition({
      id: '',
      name: '',
      region: 'Pacific',
      latitude: discovery.latitude,
      longitude: discovery.longitude,
      depth: discovery.depthM,
      x: 0,
      y: 0,
    });
    if (Math.abs(local.x) > 1 || Math.abs(local.y) > 1) return;
    const point = project(local.x, local.y, modulatedTerrain(local.x, local.y) + 0.1, width, height);
    if (point.x < 20 || point.x > width - 20 || point.y < 28 || point.y > height - 22) return;
    context!.beginPath();
    context!.rect(point.x - 3, point.y - 3, 6, 6);
    context!.fillStyle = '#e6ae78';
    context!.fill();
  });

  sharedSubmarines.forEach((submarine) => {
    const local = localPosition({
      id: submarine.owner,
      name: submarine.callsign,
      region: 'Pacific',
      latitude: submarine.latitude,
      longitude: submarine.longitude,
      depth: submarine.depthM,
      x: 0,
      y: 0,
    });
    if (Math.abs(local.x) > 1 || Math.abs(local.y) > 1) return;
    const point = project(local.x, local.y, modulatedTerrain(local.x, local.y) + 0.13, width, height);
    if (point.x < 20 || point.x > width - 20 || point.y < 28 || point.y > height - 22) return;
    const isMine = submarine.owner === currentIdentity;
    context!.beginPath();
    context!.arc(point.x, point.y, isMine ? 7 : 5, 0, Math.PI * 2);
    context!.fillStyle = isMine ? '#f5bc79' : '#71dbc7';
    context!.fill();
    context!.strokeStyle = 'rgba(230,246,236,.75)';
    context!.stroke();
    context!.font = '9px "DM Mono", monospace';
    context!.textAlign = 'left';
    context!.fillStyle = '#d8e6e8';
    context!.fillText(submarine.callsign, point.x + 10, point.y - 7);
  });
}

function scheduleDraw() {
  if (redrawFrame) return;
  redrawFrame = window.requestAnimationFrame(() => {
    redrawFrame = 0;
    drawMap();
  });
}

function haversineDistance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const term =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

function formatCoordinates(site: Pick<Site, 'latitude' | 'longitude'>) {
  const lat = `${Math.abs(site.latitude).toFixed(1)}°${site.latitude < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(site.longitude).toFixed(1)}°${site.longitude < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}

function setSelectedSite(site: Site) {
  selectedSite = site;
  byId('selected-waypoint-name').textContent = site.name;
  byId('selected-waypoint-detail').textContent = `${site.region} · ${formatCoordinates(site)} · ~${site.depth.toLocaleString()} m`;
  byId('map-coordinate').textContent = formatCoordinates(site);
  byId('map-depth-label').textContent = `SEAFLOOR · ${site.depth.toLocaleString()} M`;
  scheduleDraw();
}

function updateBattery() {
  const submarine = sharedSubmarines.find((row) => row.owner === currentIdentity);
  const value = byId('mission-battery-value');
  const battery = byId('battery-value');
  const mainBar = byId('mission-battery-bar');
  const sidebarBar = byId('battery-bar');
  value.textContent = submarine ? `${submarine.batteryPct}%` : '—';
  battery.textContent = submarine ? `${submarine.batteryPct}%` : '—';
  const batteryPercent = submarine?.batteryPct ?? 0;
  mainBar.style.width = `${batteryPercent}%`;
  sidebarBar.style.width = `${batteryPercent}%`;
  mainBar.classList.toggle('battery-critical', batteryPercent <= 24);
  sidebarBar.classList.toggle('battery-critical', batteryPercent <= 24);
  const activeMission = sharedMissions.find((row) =>
    row.assignedSubmarine === currentIdentity &&
    (row.status === 'assigned' || row.status === 'in_progress')
  );
  missionState = activeMission?.status.toUpperCase() ?? (submarine ? submarine.status.toUpperCase() : 'CONNECTING');
  byId('mission-state').textContent = missionState;
  byId('mission-state').className = `mission-state-chip ${missionState.toLowerCase()}`;
}

function addEmptyMessage(container: HTMLElement, message: string) {
  const empty = document.createElement('div');
  empty.className = 'shared-record-empty';
  empty.textContent = message;
  container.append(empty);
}

function renderSharedSubmarines() {
  const list = byId('shared-submarine-list');
  list.replaceChildren();
  const ownSubmarine = sharedSubmarines.find((row) => row.owner === currentIdentity);
  byId('vehicle-callsign').textContent = ownSubmarine?.callsign ?? 'YOUR SUBMARINE';
  byId('vehicle-connection-state').textContent = ownSubmarine ? `VEHICLE ${ownSubmarine.status.toUpperCase()}` : 'CONNECTING';
  sharedSubmarines
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .forEach((submarine) => {
      const row = document.createElement('div');
      row.className = 'shared-record';
      const top = document.createElement('div');
      top.className = 'shared-record-top';
      const name = document.createElement('strong');
      name.textContent = `${submarine.callsign}${submarine.owner === currentIdentity ? ' · YOU' : ''}`;
      const status = document.createElement('small');
      status.textContent = submarine.status.toUpperCase();
      top.append(name, status);
      const detail = document.createElement('div');
      detail.className = 'shared-record-meta';
      detail.textContent = `${formatCoordinates(submarine)} · ${Math.round(submarine.depthM).toLocaleString()} m · ${submarine.batteryPct}% battery`;
      row.append(top, detail);
      list.append(row);
    });
  if (sharedSubmarines.length === 0) addEmptyMessage(list, 'Waiting for subscribed submarine state…');
  if (ownSubmarine) {
    vehicleLatitude = ownSubmarine.latitude;
    vehicleLongitude = ownSubmarine.longitude;
    currentDepth = ownSubmarine.depthM;
  }
  updateBattery();
  scheduleDraw();
}

function renderSharedMissions() {
  const list = byId('shared-mission-list');
  list.replaceChildren();
  const activeMission = sharedMissions.find((row) =>
    row.assignedSubmarine === currentIdentity &&
    (row.status === 'assigned' || row.status === 'in_progress')
  );
  const rows = sharedMissions
    .filter((row) => row.status !== 'complete')
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  rows.forEach((mission) => {
    const card = document.createElement('div');
    card.className = 'shared-record';
    const top = document.createElement('div');
    top.className = 'shared-record-top';
    const title = document.createElement('strong');
    title.textContent = mission.title;
    const status = document.createElement('small');
    status.textContent = mission.status.toUpperCase();
    top.append(title, status);
    const detail = document.createElement('div');
    detail.className = 'shared-record-meta';
    detail.textContent = `${mission.region} · ${formatCoordinates(mission)} · ${Math.round(mission.depthM).toLocaleString()} m · ${mission.progressPct}%`;
    card.append(top, detail);
    if (mission.description) {
      const description = document.createElement('small');
      description.textContent = mission.description;
      card.append(description);
    }
    if (mission.status === 'open' && !activeMission) {
      const assign = document.createElement('button');
      assign.type = 'button';
      assign.textContent = 'Assign to my submarine';
      assign.addEventListener('click', () => window.dispatchEvent(new CustomEvent('abyssal:action:assign-mission', {
        detail: { missionId: mission.id },
      })));
      card.append(assign);
    } else if (mission.assignedSubmarine === currentIdentity && mission.status !== 'complete') {
      const progress = document.createElement('button');
      progress.type = 'button';
      progress.textContent = mission.progressPct >= 75 ? 'Complete mission' : 'Advance progress 25%';
      progress.addEventListener('click', () => window.dispatchEvent(new CustomEvent('abyssal:action:mission-progress', {
        detail: { missionId: mission.id, progressPct: Math.min(100, mission.progressPct + 25) },
      })));
      card.append(progress);
    } else if (mission.assignedSubmarine) {
      const assigned = sharedSubmarines.find((submarine) => submarine.owner === mission.assignedSubmarine);
      const assignedLabel = document.createElement('small');
      assignedLabel.textContent = `Assigned to ${assigned?.callsign ?? 'another submarine'}`;
      card.append(assignedLabel);
    }
    list.append(card);
  });
  if (rows.length === 0) addEmptyMessage(list, 'No open missions. Create one at the selected waypoint.');
  updateBattery();
}

function renderSharedDiscoveries() {
  const list = byId('shared-discovery-list');
  const count = byId('discovery-count');
  list.replaceChildren();
  count.textContent = `${sharedDiscoveries.length} SHARED`;
  sharedDiscoveries
    .slice()
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .slice(0, 8)
    .forEach((discovery) => {
      const row = document.createElement('div');
      row.className = 'shared-record';
      const title = document.createElement('strong');
      title.textContent = `${discovery.kind} · ${discovery.name}`;
      const detail = document.createElement('div');
      detail.className = 'shared-record-meta';
      detail.textContent = `${formatCoordinates(discovery)} · ${Math.round(discovery.depthM).toLocaleString()} m · ${discovery.recordedAt.toLocaleTimeString()}${discovery.isSimulated ? ' · SIMULATED' : ''}`;
      row.append(title, detail);
      list.append(row);
    });
  if (sharedDiscoveries.length === 0) addEmptyMessage(list, 'Shared discoveries will appear here for every subscriber.');
  scheduleDraw();
}

function renderSharedAlerts() {
  const list = byId('shared-alert-list');
  list.replaceChildren();
  sharedAlerts
    .slice()
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .slice(0, 10)
    .forEach((alert) => {
      const row = document.createElement('div');
      row.className = `shared-record shared-alert ${alert.severity}${alert.acknowledged ? ' acknowledged' : ''}`;
      const top = document.createElement('div');
      top.className = 'shared-record-top';
      const title = document.createElement('strong');
      title.textContent = `${alert.severity} · ${alert.kind}`;
      const vehicle = sharedSubmarines.find((submarine) => submarine.owner === alert.submarine);
      const source = document.createElement('small');
      source.textContent = vehicle?.callsign ?? 'ROV';
      top.append(title, source);
      const detail = document.createElement('div');
      detail.className = 'shared-record-meta';
      detail.textContent = `${alert.message} Reading ${alert.reading} · threshold ${alert.threshold}${alert.acknowledged ? ' · ACKNOWLEDGED' : ''}`;
      row.append(top, detail);
      if (!alert.acknowledged) {
        const acknowledge = document.createElement('button');
        acknowledge.type = 'button';
        acknowledge.textContent = 'Acknowledge for team';
        acknowledge.addEventListener('click', () => window.dispatchEvent(new CustomEvent('abyssal:action:ack-alert', {
          detail: { alertId: alert.id },
        })));
        row.append(acknowledge);
      }
      list.append(row);
    });
  if (sharedAlerts.length === 0) addEmptyMessage(list, 'No sensor alerts reported.');
}

function renderSharedReadings() {
  const reading = sharedReadings.find((row) => row.submarine === currentIdentity);
  if (!reading) return;
  temperature = reading.temperatureC;
  oxygen = reading.oxygenMgL;
  renderScanner();
  renderEcosystem();
}

function renderSharedState() {
  renderSharedSubmarines();
  renderSharedMissions();
  renderSharedDiscoveries();
  renderSharedAlerts();
  renderSharedReadings();
}

function updateRecommendations() {
  const container = byId('route-recommendations');
  const counts = new Map<Region, number>();
  const regionOrder: Region[] = ['Pacific', 'Atlantic', 'Indian', 'Southern', 'Arctic'];
  regionOrder.forEach((region) => counts.set(region, 0));
  observations.forEach((observation) => {
    const region = observation.region as Region;
    if (counts.has(region)) counts.set(region, (counts.get(region) ?? 0) + 1);
  });

  const candidates = [...sites].sort((a, b) => {
    const coverageDelta = (counts.get(a.region) ?? 0) - (counts.get(b.region) ?? 0);
    if (coverageDelta !== 0) return coverageDelta;
    return haversineDistance(
      { latitude: vehicleLatitude, longitude: vehicleLongitude },
      { latitude: a.latitude, longitude: a.longitude }
    ) - haversineDistance(
      { latitude: vehicleLatitude, longitude: vehicleLongitude },
      { latitude: b.latitude, longitude: b.longitude }
    );
  }).slice(0, 3);

  container.replaceChildren();
  candidates.forEach((site, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'route-suggestion';
    if (selectedSite.id === site.id) card.classList.add('selected');
    const top = document.createElement('span');
    top.className = 'route-suggestion-top';
    const name = document.createElement('strong');
    name.textContent = site.name;
    const tag = document.createElement('small');
    tag.textContent = index === 0 ? 'LOW COVERAGE' : `${counts.get(site.region) ?? 0} LOGGED`;
    top.append(name, tag);
    const detail = document.createElement('span');
    detail.className = 'route-suggestion-detail';
    detail.textContent = `${site.region} · ${formatCoordinates(site)} · ~${site.depth.toLocaleString()} m`;
    card.append(top, detail);
    card.addEventListener('click', () => {
      setSelectedSite(site);
      updateBattery();
      updateRecommendations();
    });
    container.append(card);
  });
  updateBattery();
}

function depthBand(depth: number) {
  if (depth >= 6000) return 'Hadal zone';
  if (depth >= 4000) return 'Abyssal zone';
  if (depth >= 1000) return 'Bathyal zone';
  if (depth >= 200) return 'Mesopelagic';
  return 'Sunlit / upper ocean';
}

function svgElement<T extends keyof SVGElementTagNameMap>(tag: T, attributes: Record<string, string>) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function renderEcosystem() {
  const graph = byId<SVGSVGElement>('ecosystem-graph');
  const insights = byId('ecosystem-insights');
  const sample = byId('ecosystem-sample');
  graph.replaceChildren();
  insights.replaceChildren();

  if (observations.length === 0) {
    sample.textContent = 'AWAITING FIELD DATA';
    const text = svgElement('text', { x: '360', y: '115', 'text-anchor': 'middle', class: 'eco-empty' });
    text.textContent = 'Log an observation to build a co-occurrence graph';
    graph.append(text);
    const message = document.createElement('p');
    message.textContent = 'The live mission snapshot is stable: simulated water is 2.4°C with 4.8 mg/L dissolved oxygen. Log sightings to compare recorded species against depth and habitat context.';
    insights.append(message);
    return;
  }

  const speciesCounts = new Map<string, { commonName: string; count: number; depths: number[] }>();
  const bands = new Map<string, number>();
  observations.forEach((row) => {
    const current = speciesCounts.get(row.scientificName) ?? { commonName: row.commonName, count: 0, depths: [] };
    current.count += 1;
    current.depths.push(row.depthM);
    speciesCounts.set(row.scientificName, current);
    const band = depthBand(row.depthM);
    bands.set(band, (bands.get(band) ?? 0) + 1);
  });

  const species = [...speciesCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 4);
  const habitat = [...bands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const speciesX = 120;
  const habitatX = 420;
  const contextX = 630;
  const rowGap = 48;
  const speciesTop = 42 + Math.max(0, (4 - species.length) * 15);
  species.forEach(([, details], index) => {
    const y = speciesTop + index * rowGap;
    const matchingBand = depthBand(details.depths.reduce((sum, depth) => sum + depth, 0) / details.depths.length);
    const target = habitat.find(([name]) => name === matchingBand) ?? habitat[0];
    if (!target) return;
    const targetY = 76 + habitat.indexOf(target) * 84;
    const edge = svgElement('path', { d: `M 205 ${y} C 290 ${y}, 320 ${targetY}, 335 ${targetY}`, class: 'eco-edge' });
    const edgeLabel = svgElement('text', { x: '275', y: String((y + targetY) / 2 - 4), class: 'eco-edge-label' });
    edgeLabel.textContent = `${details.count} record${details.count === 1 ? '' : 's'}`;
    graph.append(edge, edgeLabel);
  });
  habitat.forEach(([name, count], index) => {
    const y = 76 + index * 84;
    const edge = svgElement('path', { d: `M 505 ${y} C 555 ${y}, 560 112, 565 112`, class: 'eco-edge eco-edge-context' });
    graph.append(edge);
    const group = svgElement('g', { class: 'eco-habitat-node', transform: `translate(${habitatX} ${y})` });
    group.append(
      svgElement('rect', { x: '-85', y: '-19', width: '170', height: '38', rx: '7' }),
      svgElement('circle', { cx: '-68', cy: '0', r: '4' })
    );
    const title = svgElement('text', { x: '-56', y: '-2', class: 'eco-node-title' });
    title.textContent = name;
    const sub = svgElement('text', { x: '-56', y: '10', class: 'eco-node-subtitle' });
    sub.textContent = `${count} co-observation${count === 1 ? '' : 's'}`;
    group.append(title, sub);
    graph.append(group);
  });
  species.forEach(([scientificName, details], index) => {
    const y = speciesTop + index * rowGap;
    const group = svgElement('g', { class: 'eco-species-node', transform: `translate(${speciesX} ${y})` });
    group.append(svgElement('rect', { x: '-95', y: '-17', width: '190', height: '34', rx: '7' }));
    const title = svgElement('text', { x: '-83', y: '-1', class: 'eco-node-title' });
    title.textContent = details.commonName.length > 23 ? `${details.commonName.slice(0, 20)}…` : details.commonName;
    const sub = svgElement('text', { x: '-83', y: '10', class: 'eco-node-subtitle' });
    sub.textContent = scientificName;
    group.append(title, sub);
    graph.append(group);
  });

  const contextNode = svgElement('g', { class: 'eco-context-node', transform: `translate(${contextX} 112)` });
  contextNode.append(
    svgElement('rect', { x: '-69', y: '-25', width: '138', height: '50', rx: '7' }),
    svgElement('circle', { cx: '-51', cy: '-8', r: '3.5' }),
    svgElement('circle', { cx: '-51', cy: '9', r: '3.5' })
  );
  const contextTitle = svgElement('text', { x: '-40', y: '-6', class: 'eco-node-title' });
  contextTitle.textContent = 'LIVE DIVE';
  const tempText = svgElement('text', { x: '-40', y: '-7', class: 'eco-node-subtitle' });
  tempText.textContent = `${temperature.toFixed(1)}°C`;
  const oxygenText = svgElement('text', { x: '-40', y: '11', class: 'eco-node-subtitle' });
  oxygenText.textContent = `${oxygen.toFixed(1)} mg/L O₂`;
  contextNode.append(contextTitle, tempText, oxygenText);
  graph.append(contextNode);

  sample.textContent = `${observations.length} LOGGED OBSERVATION${observations.length === 1 ? '' : 'S'}`;
  const regionCounts = new Map<string, number>();
  observations.forEach((row) => regionCounts.set(row.region, (regionCounts.get(row.region) ?? 0) + 1));
  const topRegion = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topBand = habitat[0];
  const summary = document.createElement('p');
  summary.textContent = `${speciesCounts.size} identified taxon label${speciesCounts.size === 1 ? '' : 's'} in ${regionCounts.size} region${regionCounts.size === 1 ? '' : 's'}.`;
  const popular = document.createElement('p');
  popular.textContent = topRegion
    ? `Most sampled region: ${topRegion[0]} (${topRegion[1]} observation${topRegion[1] === 1 ? '' : 's'}).`
    : 'No region has enough observations for comparison.';
  const zone = document.createElement('p');
  zone.textContent = topBand ? `Most common depth band in this log: ${topBand[0]} (${topBand[1]} records).` : '';
  insights.append(summary, popular, zone);
}

function renderScanner() {
  const container = byId('scanner-findings');
  container.replaceChildren();
  const findings: Array<{ kind: 'review' | 'environment' | 'context'; title: string; detail: string }> = [];
  if (oxygen < 3) {
    findings.push({ kind: 'environment', title: 'Low oxygen reading', detail: `${oxygen.toFixed(1)} mg/L simulated value · check optode calibration` });
  }
  if (currentDepth > 6000 && oxygen >= 3) {
    findings.push({ kind: 'environment', title: 'Hadal-depth survey', detail: `${currentDepth.toLocaleString()} m · verify pressure and oxygen sensor ranges` });
  }
  if (temperature > 4 && currentDepth > 1000) {
    findings.push({ kind: 'environment', title: 'Temperature outlier', detail: `${temperature.toFixed(1)}°C at ${currentDepth.toLocaleString()} m · simulated thresholds only` });
  }

  const speciesCounts = new Map<string, number>();
  observations.forEach((row) => speciesCounts.set(row.scientificName, (speciesCounts.get(row.scientificName) ?? 0) + 1));
  observations.slice(0, 30).forEach((row) => {
    if (row.reviewStatus === 'Candidate undescribed species') {
      findings.push({ kind: 'review', title: `Taxonomic review requested: ${row.commonName}`, detail: `${row.scientificName} · candidate label is unverified, not a confirmed new species` });
    } else if (row.reviewStatus === 'Uncertain identification') {
      findings.push({ kind: 'review', title: `Identification needs review: ${row.commonName}`, detail: `${row.scientificName} · compare the evidence link and request expert confirmation` });
    } else if (row.reviewStatus === 'Possible range extension') {
      findings.push({ kind: 'review', title: `Check possible range extension: ${row.commonName}`, detail: `${row.region} · compare with OBIS records before drawing conclusions` });
    }
    if ((speciesCounts.get(row.scientificName) ?? 0) <= 2 && findings.length < 6) {
      findings.push({ kind: 'context', title: `Sparse expedition records: ${row.commonName}`, detail: `Only ${speciesCounts.get(row.scientificName)} in this mission log · not a global rarity estimate` });
    }
    if (row.depthM > 6000 && findings.length < 6) {
      findings.push({ kind: 'environment', title: `Deep-water record: ${row.commonName}`, detail: `${row.depthM.toLocaleString()} m · verify depth and species ID against cited records` });
    }
  });

  if (findings.length === 0) {
    findings.push({
      kind: 'context',
      title: observations.length === 0 ? 'No species flags yet' : 'No review flags in current log',
      detail: observations.length === 0
        ? `Simulated sensors stable at ${temperature.toFixed(1)}°C and ${oxygen.toFixed(1)} mg/L O₂ · log an observation to scan it`
        : 'No rule-based leads were found. This is not a guarantee of species identity or ecosystem health.',
    });
  }

  findings.slice(0, 4).forEach((finding) => {
    const item = document.createElement('div');
    item.className = `scanner-finding ${finding.kind}`;
    const symbol = document.createElement('span');
    symbol.className = 'scanner-finding-icon';
    symbol.textContent = finding.kind === 'review' ? '!' : finding.kind === 'environment' ? '⌁' : '◌';
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = finding.title;
    const detail = document.createElement('small');
    detail.textContent = finding.detail;
    text.append(title, detail);
    item.append(symbol, text);
    container.append(item);
  });
}

function renderObservations(rows: MissionObservation[]) {
  observations = [...rows];
  renderScanner();
  renderEcosystem();
  updateRecommendations();
  scheduleDraw();
}

function connectObservationUpdates() {
  window.addEventListener('abyssal:observations', (event) => {
    const detail = (event as CustomEvent<MissionObservation[]>).detail;
    if (Array.isArray(detail)) renderObservations(detail);
  });
  window.dispatchEvent(new CustomEvent<MissionObservation[]>('abyssal:observations', { detail: observations }));
}

function setWaypointFromPointer(event: PointerEvent) {
  const bounds = canvas!.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const hit = activeViewPoints.find(({ point }) => Math.hypot(point.x - x, point.y - y) < 15);
  if (hit) {
    setSelectedSite(hit.site);
    updateRecommendations();
    return;
  }

  const longitude = Math.max(-179, Math.min(179, vehicleLongitude + ((x / bounds.width) - 0.5) * 52));
  const latitude = Math.max(-82, Math.min(82, vehicleLatitude + ((0.5 - y / bounds.height) * 38)));
  customSiteCount += 1;
  const site: Site = {
    id: `custom-${customSiteCount}`,
    name: `Custom survey waypoint ${customSiteCount}`,
    region: regionForCoordinates(latitude, longitude),
    latitude: Math.round(latitude * 2) / 2,
    longitude: Math.round(longitude * 2) / 2,
    depth: Math.max(100, Math.round(currentDepth / 100) * 100),
    x: (x / bounds.width) * 2 - 1,
    y: (y / bounds.height) * 2 - 1,
  };
  for (let index = sites.length - 1; index >= 0; index -= 1) {
    if (sites[index].id.startsWith('custom-')) sites.splice(index, 1);
  }
  sites.push(site);
  setSelectedSite(site);
  updateRecommendations();
}

function attachMapInteractions() {
  canvas!.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragOrigin = { x: event.clientX, y: event.clientY, rotationX, rotationY };
    canvas!.setPointerCapture(event.pointerId);
  });
  canvas!.addEventListener('pointermove', (event) => {
    if (!dragOrigin) return;
    rotationY = dragOrigin.rotationY + (event.clientX - dragOrigin.x) * 0.006;
    rotationX = Math.max(-1.25, Math.min(0.5, dragOrigin.rotationX + (event.clientY - dragOrigin.y) * 0.004));
    scheduleDraw();
  });
  canvas!.addEventListener('pointerup', (event) => {
    if (!dragOrigin) return;
    const moved = Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y);
    dragOrigin = null;
    if (moved < 5) setWaypointFromPointer(event);
  });
  canvas!.addEventListener('pointercancel', () => { dragOrigin = null; });
  canvas!.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.max(0.7, Math.min(1.65, zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
    scheduleDraw();
  }, { passive: false });
  byId('map-zoom-in').addEventListener('click', () => {
    zoom = Math.min(1.65, zoom + 0.12);
    scheduleDraw();
  });
  byId('map-zoom-out').addEventListener('click', () => {
    zoom = Math.max(0.7, zoom - 0.12);
    scheduleDraw();
  });
  byId('map-reset').addEventListener('click', () => {
    rotationX = -0.62;
    rotationY = -0.12;
    zoom = 1;
    scheduleDraw();
  });
  new ResizeObserver(scheduleDraw).observe(canvas!.parentElement!);
}

function attachMissionControls(notify: Notify) {
  byId('route-waypoint').addEventListener('click', () => {
    const submarine = sharedSubmarines.find((row) => row.owner === currentIdentity);
    window.dispatchEvent(new CustomEvent('abyssal:action:move', {
      detail: {
        latitude: selectedSite.latitude,
        longitude: selectedSite.longitude,
        depthM: selectedSite.depth,
        batteryPct: submarine?.batteryPct ?? 84,
      },
    }));
    notify(`Sending ${submarine?.callsign ?? 'submarine'} move to the shared database…`);
  });

  byId<HTMLFormElement>('mission-create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    window.dispatchEvent(new CustomEvent('abyssal:action:create-mission', {
      detail: {
        title: String(values.get('title') ?? '').trim(),
        description: String(values.get('description') ?? '').trim(),
        region: selectedSite.region,
        latitude: selectedSite.latitude,
        longitude: selectedSite.longitude,
        depthM: selectedSite.depth,
      },
    }));
    notify(`Submitting mission at ${selectedSite.name}…`);
    form.reset();
  });

  byId<HTMLFormElement>('discovery-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    window.dispatchEvent(new CustomEvent('abyssal:action:create-discovery', {
      detail: {
        kind: String(values.get('kind') ?? ''),
        name: String(values.get('name') ?? '').trim(),
        notes: String(values.get('notes') ?? '').trim(),
        latitude: selectedSite.latitude,
        longitude: selectedSite.longitude,
        depthM: selectedSite.depth,
      },
    }));
    notify(`Submitting shared discovery at ${selectedSite.name}…`);
    form.reset();
  });
}

export function connectExploration(notify: Notify) {
  connectObservationUpdates();
  attachMapInteractions();
  attachMissionControls(notify);
  window.addEventListener('abyssal:shared:connected', (event) => {
    currentIdentity = (event as CustomEvent<{ identity: string }>).detail.identity;
    renderSharedState();
  });
  window.addEventListener('abyssal:shared:submarines', (event) => {
    sharedSubmarines = (event as CustomEvent<SharedSubmarine[]>).detail;
    renderSharedSubmarines();
    renderSharedMissions();
    renderSharedAlerts();
  });
  window.addEventListener('abyssal:shared:missions', (event) => {
    sharedMissions = (event as CustomEvent<SharedMission[]>).detail;
    renderSharedMissions();
  });
  window.addEventListener('abyssal:shared:discoveries', (event) => {
    sharedDiscoveries = (event as CustomEvent<SharedDiscovery[]>).detail;
    renderSharedDiscoveries();
  });
  window.addEventListener('abyssal:shared:alerts', (event) => {
    sharedAlerts = (event as CustomEvent<SharedAlert[]>).detail;
    renderSharedAlerts();
  });
  window.addEventListener('abyssal:shared:readings', (event) => {
    sharedReadings = (event as CustomEvent<SharedReading[]>).detail;
    renderSharedReadings();
  });
  renderScanner();
  renderEcosystem();
  updateRecommendations();
  updateBattery();
  renderSharedSubmarines();
  renderSharedMissions();
  renderSharedDiscoveries();
  renderSharedAlerts();
  scheduleDraw();
  window.addEventListener('abyssal:telemetry', (event) => {
    const detail = (event as CustomEvent<{ depth: number; temperature: number; oxygen: number }>).detail;
    if (Number.isFinite(detail?.depth)) currentDepth = detail.depth;
    if (Number.isFinite(detail?.temperature)) temperature = detail.temperature;
    if (Number.isFinite(detail?.oxygen)) oxygen = detail.oxygen;
    renderScanner();
    renderEcosystem();
    scheduleDraw();
  });
  window.addEventListener('beforeunload', () => {
    if (redrawFrame) window.cancelAnimationFrame(redrawFrame);
  });
}
