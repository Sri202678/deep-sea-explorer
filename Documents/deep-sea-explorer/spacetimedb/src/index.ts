import {
  SenderError,
  schema,
  table,
  t,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';

const marineObservation = table(
  {
    name: 'marine_observation',
    public: true,
    indexes: [
      {
        accessor: 'by_species',
        algorithm: 'btree',
        columns: ['scientificName'],
      },
      {
        accessor: 'by_robot_report_id',
        algorithm: 'btree',
        columns: ['robotReportId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    observer: t.identity(),
    commonName: t.string(),
    scientificName: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    region: t.string(),
    lengthCm: t.f64(),
    depthM: t.f64(),
    referenceAdultLengthCm: t.f64(),
    referenceLifespanYears: t.u16(),
    ageEstimateYears: t.u16(),
    biologicalSource: t.string(),
    conservationStatus: t.string(),
    conservationSource: t.string(),
    reviewStatus: t.string(),
    evidenceSource: t.string(),
    notes: t.string(),
    reportedBy: t.string().default('MISSION CONTROL'),
    isSimulated: t.bool().default(false),
    robotReportId: t.string().default(''),
    recordedAt: t.timestamp(),
  }
);

const submarine = table(
  {
    name: 'submarine',
    public: true,
  },
  {
    owner: t.identity().primaryKey(),
    callsign: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
    batteryPct: t.u8(),
    status: t.string(),
    assignedMissionId: t.option(t.u64()),
    isSimulated: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const discovery = table(
  {
    name: 'discovery',
    public: true,
    indexes: [
      {
        accessor: 'by_robot_report_id',
        algorithm: 'btree',
        columns: ['robotReportId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    reporter: t.identity(),
    kind: t.string(),
    name: t.string(),
    notes: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
    robotReportId: t.string().default(''),
    isSimulated: t.bool(),
    recordedAt: t.timestamp(),
  }
);

const mission = table(
  {
    name: 'mission',
    public: true,
  },
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    description: t.string(),
    region: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
    status: t.string(),
    assignedSubmarine: t.option(t.identity()),
    createdBy: t.identity(),
    progressPct: t.u8(),
    updatedAt: t.timestamp(),
  }
);

const sensorReading = table(
  {
    name: 'sensor_reading',
    public: true,
  },
  {
    submarine: t.identity().primaryKey(),
    temperatureC: t.f64(),
    pressureMpa: t.f64(),
    oxygenMgL: t.f64(),
    isSimulated: t.bool(),
    recordedAt: t.timestamp(),
  }
);

const sensorAlert = table(
  {
    name: 'sensor_alert',
    public: true,
    indexes: [
      {
        accessor: 'by_submarine_kind_acknowledged',
        algorithm: 'btree',
        columns: ['submarine', 'kind', 'acknowledged'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    submarine: t.identity(),
    kind: t.string(),
    severity: t.string(),
    message: t.string(),
    reading: t.f64(),
    threshold: t.f64(),
    acknowledged: t.bool(),
    acknowledgedBy: t.option(t.identity()),
    acknowledgedAt: t.option(t.timestamp()),
    isSimulated: t.bool(),
    recordedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  marineObservation,
  submarine,
  discovery,
  mission,
  sensorReading,
  sensorAlert,
});
export default spacetimedb;
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const conservationStatuses = new Set([
  'Unknown',
  'Rare (reported)',
  'Not evaluated',
  'Data deficient',
  'Least concern',
  'Near threatened',
  'Vulnerable',
  'Endangered',
  'Critically endangered',
]);

const reviewStatuses = new Set([
  'Known species',
  'Possible range extension',
  'Uncertain identification',
  'Candidate undescribed species',
]);

function requireText(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new SenderError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return trimmed;
}

export const addMarineObservation = spacetimedb.reducer(
  {
    commonName: t.string(),
    scientificName: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    region: t.string(),
    lengthCm: t.f64(),
    depthM: t.f64(),
    referenceAdultLengthCm: t.f64(),
    referenceLifespanYears: t.u16(),
    biologicalSource: t.string(),
    conservationStatus: t.string(),
    conservationSource: t.string(),
    reviewStatus: t.string(),
    evidenceSource: t.string(),
    notes: t.string(),
    robotReportId: t.string(),
  },
  (ctx, observation) => {
    insertObservation(ctx, observation, 'MISSION CONTROL', false);
  }
);

export const reportRobotObservation = spacetimedb.reducer(
  {
    commonName: t.string(),
    scientificName: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    region: t.string(),
    lengthCm: t.f64(),
    depthM: t.f64(),
    referenceAdultLengthCm: t.f64(),
    referenceLifespanYears: t.u16(),
    biologicalSource: t.string(),
    conservationStatus: t.string(),
    conservationSource: t.string(),
    reviewStatus: t.string(),
    evidenceSource: t.string(),
    notes: t.string(),
    robotReportId: t.string(),
  },
  (ctx, observation) => {
    const reportId = observation.robotReportId.trim();
    if (
      reportId &&
      [...ctx.db.marineObservation.by_robot_report_id.filter(reportId)].length > 0
    ) {
      return;
    }
    insertObservation(ctx, observation, 'NAUTILUS-01 · SIMULATED ROV', true);
    if (reportId) {
      ctx.db.discovery.insert({
        id: 0n,
        reporter: ctx.sender,
        kind: 'Marine life',
        name: requireText(observation.commonName, 'Common name', 100),
        notes: observation.notes.trim(),
        latitude: Math.round(observation.latitude * 2) / 2,
        longitude: Math.round(observation.longitude * 2) / 2,
        depthM: observation.depthM,
        robotReportId: reportId,
        isSimulated: true,
        recordedAt: ctx.timestamp,
      });
    }
  }
);

export const registerSubmarine = spacetimedb.reducer(
  { callsign: t.string() },
  (ctx, { callsign }) => {
    const normalizedCallsign = requireText(callsign, 'Callsign', 40);
    const existing = ctx.db.submarine.owner.find(ctx.sender);
    if (existing) {
      ctx.db.submarine.owner.update({
        ...existing,
        callsign: normalizedCallsign,
        status: 'active',
        updatedAt: ctx.timestamp,
      });
      return;
    }
    ctx.db.submarine.insert({
      owner: ctx.sender,
      callsign: normalizedCallsign,
      latitude: -32,
      longitude: -178,
      depthM: 5100,
      batteryPct: 84,
      status: 'active',
      assignedMissionId: undefined,
      isSimulated: true,
      updatedAt: ctx.timestamp,
    });
  }
);

export const updateSubmarinePosition = spacetimedb.reducer(
  {
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
    batteryPct: t.u8(),
  },
  (ctx, position) => {
    const submarine = ctx.db.submarine.owner.find(ctx.sender);
    if (!submarine) throw new SenderError('Register this client as a submarine before moving it.');
    validateCoordinates(position.latitude, position.longitude);
    if (!Number.isFinite(position.depthM) || position.depthM < 0 || position.depthM > 11_000) {
      throw new SenderError('Depth must be between 0 and 11,000 meters.');
    }
    if (position.batteryPct > 100) throw new SenderError('Battery must be between 0 and 100%.');
    ctx.db.submarine.owner.update({
      ...submarine,
      latitude: Math.round(position.latitude * 1000) / 1000,
      longitude: Math.round(position.longitude * 1000) / 1000,
      depthM: position.depthM,
      batteryPct: position.batteryPct,
      status: 'active',
      isSimulated: true,
      updatedAt: ctx.timestamp,
    });
  }
);

export const createDiscovery = spacetimedb.reducer(
  {
    kind: t.string(),
    name: t.string(),
    notes: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
  },
  (ctx, report) => {
    if (!ctx.db.submarine.owner.find(ctx.sender)) {
      throw new SenderError('Register this client as a submarine before reporting a discovery.');
    }
    const kind = requireText(report.kind, 'Discovery type', 40);
    if (!['Marine life', 'Hydrothermal vent', 'Seafloor formation', 'Other'].includes(kind)) {
      throw new SenderError('Choose a supported discovery type.');
    }
    validateCoordinates(report.latitude, report.longitude);
    if (!Number.isFinite(report.depthM) || report.depthM < 0 || report.depthM > 11_000) {
      throw new SenderError('Depth must be between 0 and 11,000 meters.');
    }
    const notes = report.notes.trim();
    if (notes.length > 1000) throw new SenderError('Discovery notes must be 1,000 characters or fewer.');
    ctx.db.discovery.insert({
      id: 0n,
      reporter: ctx.sender,
      kind,
      name: requireText(report.name, 'Discovery name', 100),
      notes,
      latitude: Math.round(report.latitude * 1000) / 1000,
      longitude: Math.round(report.longitude * 1000) / 1000,
      depthM: report.depthM,
      robotReportId: '',
      isSimulated: true,
      recordedAt: ctx.timestamp,
    });
  }
);

export const createMission = spacetimedb.reducer(
  {
    title: t.string(),
    description: t.string(),
    region: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    depthM: t.f64(),
  },
  (ctx, input) => {
    validateCoordinates(input.latitude, input.longitude);
    if (!Number.isFinite(input.depthM) || input.depthM < 0 || input.depthM > 11_000) {
      throw new SenderError('Depth must be between 0 and 11,000 meters.');
    }
    const description = input.description.trim();
    if (description.length > 500) throw new SenderError('Mission description must be 500 characters or fewer.');
    ctx.db.mission.insert({
      id: 0n,
      title: requireText(input.title, 'Mission title', 100),
      description,
      region: requireText(input.region, 'Mission region', 40),
      latitude: Math.round(input.latitude * 1000) / 1000,
      longitude: Math.round(input.longitude * 1000) / 1000,
      depthM: input.depthM,
      status: 'open',
      assignedSubmarine: undefined,
      createdBy: ctx.sender,
      progressPct: 0,
      updatedAt: ctx.timestamp,
    });
  }
);

export const assignMission = spacetimedb.reducer(
  { missionId: t.u64() },
  (ctx, { missionId }) => {
    const missionRow = ctx.db.mission.id.find(missionId);
    const submarine = ctx.db.submarine.owner.find(ctx.sender);
    if (!missionRow) throw new SenderError('Mission no longer exists.');
    if (!submarine) throw new SenderError('Register this client as a submarine before accepting a mission.');
    if (missionRow.status !== 'open' || missionRow.assignedSubmarine) {
      throw new SenderError('This mission has already been assigned.');
    }
    if (submarine.assignedMissionId !== undefined) {
      throw new SenderError('This submarine already has an active mission.');
    }
    ctx.db.mission.id.update({
      ...missionRow,
      status: 'assigned',
      assignedSubmarine: ctx.sender,
      updatedAt: ctx.timestamp,
    });
    ctx.db.submarine.owner.update({
      ...submarine,
      assignedMissionId: missionId,
      updatedAt: ctx.timestamp,
    });
  }
);

export const updateMissionProgress = spacetimedb.reducer(
  { missionId: t.u64(), progressPct: t.u8() },
  (ctx, { missionId, progressPct }) => {
    if (progressPct > 100) throw new SenderError('Mission progress must be between 0 and 100%.');
    const missionRow = ctx.db.mission.id.find(missionId);
    if (!missionRow || !missionRow.assignedSubmarine?.equals(ctx.sender)) {
      throw new SenderError('Only the assigned submarine can update this mission.');
    }
    const completed = progressPct === 100;
    ctx.db.mission.id.update({
      ...missionRow,
      progressPct,
      status: completed ? 'complete' : 'in_progress',
      updatedAt: ctx.timestamp,
    });
    if (completed) {
      const submarine = ctx.db.submarine.owner.find(ctx.sender);
      if (submarine) {
        ctx.db.submarine.owner.update({
          ...submarine,
          assignedMissionId: undefined,
          updatedAt: ctx.timestamp,
        });
      }
    }
  }
);

export const reportSensorReading = spacetimedb.reducer(
  { temperatureC: t.f64(), pressureMpa: t.f64(), oxygenMgL: t.f64() },
  (ctx, reading) => {
    if (!ctx.db.submarine.owner.find(ctx.sender)) {
      throw new SenderError('Register this client before sending sensor readings.');
    }
    if (!Number.isFinite(reading.temperatureC) || reading.temperatureC < -5 || reading.temperatureC > 50) {
      throw new SenderError('Temperature must be between -5 and 50°C.');
    }
    if (!Number.isFinite(reading.pressureMpa) || reading.pressureMpa < 0 || reading.pressureMpa > 100) {
      throw new SenderError('Pressure must be between 0 and 100 MPa.');
    }
    if (!Number.isFinite(reading.oxygenMgL) || reading.oxygenMgL < 0 || reading.oxygenMgL > 30) {
      throw new SenderError('Dissolved oxygen must be between 0 and 30 mg/L.');
    }
    const existing = ctx.db.sensorReading.submarine.find(ctx.sender);
    const row = {
      submarine: ctx.sender,
      temperatureC: reading.temperatureC,
      pressureMpa: reading.pressureMpa,
      oxygenMgL: reading.oxygenMgL,
      isSimulated: true,
      recordedAt: ctx.timestamp,
    };
    if (existing) ctx.db.sensorReading.submarine.update(row);
    else ctx.db.sensorReading.insert(row);

    addSensorAlert(ctx, 'temperature', reading.temperatureC, 5, 'Temperature exceeds the 5°C demo threshold.');
    addSensorAlert(ctx, 'pressure', reading.pressureMpa, 55, 'Pressure exceeds the 55 MPa demo threshold.');
    addSensorAlert(ctx, 'oxygen', reading.oxygenMgL, 3, 'Dissolved oxygen is below the 3 mg/L demo threshold.');
  }
);

export const acknowledgeSensorAlert = spacetimedb.reducer(
  { alertId: t.u64() },
  (ctx, { alertId }) => {
    const alert = ctx.db.sensorAlert.id.find(alertId);
    if (!alert) throw new SenderError('Sensor alert no longer exists.');
    if (alert.acknowledged) return;
    ctx.db.sensorAlert.id.update({
      ...alert,
      acknowledged: true,
      acknowledgedBy: ctx.sender,
      acknowledgedAt: ctx.timestamp,
    });
  }
);

function insertObservation(
  ctx: Ctx,
  observation: {
    commonName: string;
    scientificName: string;
    latitude: number;
    longitude: number;
    region: string;
    lengthCm: number;
    depthM: number;
    referenceAdultLengthCm: number;
    referenceLifespanYears: number;
    biologicalSource: string;
    conservationStatus: string;
    conservationSource: string;
    reviewStatus: string;
    evidenceSource: string;
    notes: string;
    robotReportId: string;
  },
  reportedBy: string,
  isSimulated: boolean
) {
    const reportId = observation.robotReportId.trim();
    if (reportId.length > 100) {
      throw new SenderError('Robot report ID must be 100 characters or fewer.');
    }

    if (reportId && [...ctx.db.marineObservation.by_robot_report_id.filter(reportId)].length > 0) {
      return;
    }

    const commonName = requireText(observation.commonName, 'Common name', 100);
    const scientificName = requireText(observation.scientificName, 'Scientific name', 160);
    const region = requireText(observation.region, 'Region', 40);
    const notes = observation.notes.trim();

    if (
      !Number.isFinite(observation.latitude) ||
      observation.latitude < -90 ||
      observation.latitude > 90 ||
      !Number.isFinite(observation.longitude) ||
      observation.longitude < -180 ||
      observation.longitude > 180
    ) {
      throw new SenderError('Enter valid latitude and longitude coordinates.');
    }
    if (!Number.isFinite(observation.lengthCm) || observation.lengthCm <= 0 || observation.lengthCm > 100_000) {
      throw new SenderError('Length must be greater than 0 and no more than 100,000 cm.');
    }
    if (!Number.isFinite(observation.depthM) || observation.depthM < 0 || observation.depthM > 11_000) {
      throw new SenderError('Depth must be between 0 and 11,000 meters.');
    }
    if (
      !Number.isFinite(observation.referenceAdultLengthCm) ||
      observation.referenceAdultLengthCm < 0 ||
      observation.referenceAdultLengthCm > 100_000
    ) {
      throw new SenderError('Reference adult length must be 0 (unknown) or a valid length in centimeters.');
    }
    if (observation.referenceLifespanYears > 500) {
      throw new SenderError('Reference lifespan must be 500 years or less.');
    }
    const hasAgeReferences =
      observation.referenceAdultLengthCm > 0 && observation.referenceLifespanYears > 0;
    if (
      (observation.referenceAdultLengthCm > 0 || observation.referenceLifespanYears > 0) &&
      !hasAgeReferences
    ) {
      throw new SenderError('Provide both reference adult length and lifespan to estimate age.');
    }
    if (!conservationStatuses.has(observation.conservationStatus)) {
      throw new SenderError('Choose a valid conservation category.');
    }
    if (!reviewStatuses.has(observation.reviewStatus)) {
      throw new SenderError('Choose a valid identification review status.');
    }
    if (notes.length > 1000) {
      throw new SenderError('Notes must be 1,000 characters or fewer.');
    }

    const evidenceSource = observation.evidenceSource.trim();
    const conservationSource = observation.conservationSource.trim();
    const biologicalSource = observation.biologicalSource.trim();
    if (conservationSource.length > 500 || biologicalSource.length > 500) {
      throw new SenderError('Reference links must be 500 characters or fewer.');
    }
    if (evidenceSource.startsWith('data:image/jpeg;base64,')) {
      const base64Image = evidenceSource.slice('data:image/jpeg;base64,'.length);
      if (evidenceSource.length > 120_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Image)) {
        throw new SenderError('Attached JPEG must be a valid, compressed image smaller than 90 KB.');
      }
    } else if (evidenceSource.length > 500) {
      throw new SenderError('Evidence URL must be 500 characters or fewer.');
    }
    if (hasAgeReferences && !biologicalSource) {
      throw new SenderError('Cite the source for reference adult size and lifespan.');
    }

    const ageEstimateYears = hasAgeReferences
      ? Math.max(
          1,
          Math.min(
            observation.referenceLifespanYears,
            Math.round(
              (observation.lengthCm / observation.referenceAdultLengthCm) *
                observation.referenceLifespanYears
            )
          )
        )
      : 0;

    ctx.db.marineObservation.insert({
      id: 0n,
      observer: ctx.sender,
      commonName,
      scientificName,
      latitude: Math.round(observation.latitude * 2) / 2,
      longitude: Math.round(observation.longitude * 2) / 2,
      region,
      lengthCm: observation.lengthCm,
      depthM: observation.depthM,
      referenceAdultLengthCm: observation.referenceAdultLengthCm,
      referenceLifespanYears: observation.referenceLifespanYears,
      ageEstimateYears,
      biologicalSource,
      conservationStatus: observation.conservationStatus,
      conservationSource,
      reviewStatus: observation.reviewStatus,
      evidenceSource,
      notes,
      reportedBy,
      isSimulated,
      robotReportId: reportId,
      recordedAt: ctx.timestamp,
    });
}

function validateCoordinates(latitude: number, longitude: number) {
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new SenderError('Enter valid latitude and longitude coordinates.');
  }
}

function addSensorAlert(
  ctx: Ctx,
  kind: string,
  reading: number,
  threshold: number,
  message: string
) {
  const isOutOfRange = kind === 'temperature'
    ? reading >= threshold
    : kind === 'pressure'
      ? reading >= threshold
      : reading < threshold;
  if (!isOutOfRange) return;
  const openAlerts = ctx.db.sensorAlert.by_submarine_kind_acknowledged.filter([
    ctx.sender,
    kind,
    false,
  ]);
  if ([...openAlerts].length > 0) return;
  ctx.db.sensorAlert.insert({
    id: 0n,
    submarine: ctx.sender,
    kind,
    severity:
      (kind === 'oxygen' && reading < 1.5) ||
      (kind === 'pressure' && reading >= 60) ||
      (kind === 'temperature' && reading >= 8)
        ? 'critical'
        : 'warning',
    message,
    reading,
    threshold,
    acknowledged: false,
    acknowledgedBy: undefined,
    acknowledgedAt: undefined,
    isSimulated: true,
    recordedAt: ctx.timestamp,
  });
}
