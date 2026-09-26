import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Eye,
  FilePlus2,
  HeartPulse,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Search,
  ScanFace,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  VideoOff,
  Wifi,
  WifiOff,
  Wind,
  X,
} from "lucide-react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import "./App.css";

const REVIEW_THRESHOLD = 90;
const WINDOW_SECONDS = 8;

const LOCALE_RULES = {
  UAE: {
    label: "United Arab Emirates",
    fields: [
      { name: "fullName", label: "Full name", type: "text", required: true },
      { name: "emiratesId", label: "Emirates ID", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
      { name: "language", label: "Preferred language", type: "select", required: true, options: ["Arabic", "English"] },
    ],
  },
  UK: {
    label: "United Kingdom",
    fields: [
      { name: "fullName", label: "Full name", type: "text", required: true },
      { name: "nhsNumber", label: "NHS number", type: "text", required: true },
      { name: "postcode", label: "Postcode", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
    ],
  },
  US: {
    label: "United States",
    fields: [
      { name: "fullName", label: "Full name", type: "text", required: true },
      { name: "state", label: "State", type: "text", required: true },
      { name: "zipCode", label: "ZIP code", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
    ],
  },
  India: {
    label: "India",
    fields: [
      { name: "fullName", label: "Full name", type: "text", required: true },
      { name: "aadhaar", label: "Aadhaar number", type: "text", required: true },
      { name: "state", label: "State", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
      { name: "language", label: "Preferred language", type: "select", required: false, options: ["Hindi", "English", "Tamil", "Telugu", "Bengali", "Marathi", "Kannada", "Malayalam", "Gujarati", "Punjabi"] },
    ],
  },
};

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "patients", label: "Patient queue", icon: UsersRound },
  { id: "intake", label: "New intake", icon: FilePlus2 },
  { id: "monitor", label: "Fatigue monitor", icon: ScanFace },
  { id: "logic", label: "Logic & dashboard", icon: Activity },
];

const TITLES = {
  overview: ["Clinical overview", "Your unit at a glance"],
  patients: ["Patient queue", "Review incoming patient entries"],
  intake: ["Patient intake", "A country-aware registration form"],
  monitor: ["Fatigue monitor", "On-device eye-closure and blink assessment"],
  logic: ["Logic & dashboard", "Live review signals and routing decisions"],
  vitals: ["My vitals", "Personal readings and recent history"],
};

function calculateConfidence(country, formData) {
  const rules = LOCALE_RULES[country];
  if (!rules) return { confidence: 0, deviations: 0 };
  let deviations = 0;

  rules.fields.forEach((field) => {
    const value = (formData[field.name] || "").trim();
    if (field.required && !value) {
      deviations += 1;
      return;
    }
    if (!value) return;
    if (field.name === "emiratesId" && !/^\d{15}$/.test(value.replace(/-/g, ""))) deviations += 1;
    if (field.name === "nhsNumber" && !/^\d{10}$/.test(value.replace(/\s/g, ""))) deviations += 1;
    if (field.name === "aadhaar" && !/^\d{12}$/.test(value.replace(/\s/g, ""))) deviations += 1;
    if (field.name === "zipCode" && !/^\d{5}$/.test(value)) deviations += 1;
    if (field.name === "postcode" && !/^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(value)) deviations += 1;
    if (field.name === "phone" && (!/^\+?[\d\s()-]{7,20}$/.test(value) || value.replace(/\D/g, "").length < 7)) deviations += 1;
    if (field.name === "dateOfBirth" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) deviations += 1;
  });

  return { confidence: Math.max(0, 100 - deviations * 15), deviations };
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "The local service could not complete the request.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatTime(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function priorityClass(priority = "Routine") {
  return priority.toLowerCase().replace(/[^a-z]+/g, "-");
}

function statusForScore(score) {
  if (score === null || score === undefined) return { label: "Awaiting check", className: "status-muted" };
  if (score < 60) return { label: "Elevated fatigue", className: "status-alert" };
  if (score < 80) return { label: "Needs attention", className: "status-watch" };
  return { label: "Within range", className: "status-good" };
}

function LoginPage({ onLogin }) {
  const [role, setRole] = useState("patient");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    if (password.trim().length < 6) {
      setError("Enter a demo password with at least six characters.");
      return;
    }
    onLogin({ role, name: name.trim(), email: email.trim() });
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-brand"><span className="brand-mark"><HeartPulse size={22} /></span><span><strong>Vigil</strong><small>CARE OPERATIONS</small></span></div>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>Sign in to Vigil</h1>
        <p className="login-subtitle">Choose the workspace for this demo session.</p>
        <div className="role-switch" role="group" aria-label="Choose account type">
          <button className={role === "patient" ? "role-option is-selected" : "role-option"} type="button" aria-pressed={role === "patient"} onClick={() => setRole("patient")}><HeartPulse size={17} /><span>Patient</span></button>
          <button className={role === "employee" ? "role-option is-selected" : "role-option"} type="button" aria-pressed={role === "employee"} onClick={() => setRole("employee")}><Stethoscope size={17} /><span>Employee</span></button>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="login-name"><span>{role === "patient" ? "Patient name" : "Employee name"}</span><input id="login-name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder={role === "patient" ? "Your name" : "Care team name"} /></label>
          <label className="form-field" htmlFor="login-email"><span>Email</span><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label className="form-field" htmlFor="login-password"><span>Password</span><input id="login-password" type="password" autoComplete="current-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button button-primary login-submit" type="submit">Continue as {role === "patient" ? "patient" : "employee"}<ChevronRight size={16} /></button>
        </form>
        <p className="login-demo-note"><ShieldCheck size={15} /> Demo sign-in only. Credentials are not sent to a server or authenticated.</p>
      </section>
      <aside className="login-side-note"><span>VIGIL / CARE SIGNALS</span><p>One workspace for patient readings and reviewer attention.</p><small>Demo only. Do not enter real patient or employee credentials.</small></aside>
    </main>
  );
}

function getVitalsStatus(reading) {
  const urgent = reading.heartRate < 40
    || reading.heartRate > 130
    || reading.spo2 < 90
    || reading.systolic >= 180
    || reading.diastolic >= 120
    || reading.temperature >= 40
    || reading.temperature < 35;
  if (urgent) return { label: "Needs prompt clinical review", className: "vital-urgent" };
  const attention = reading.heartRate < 50
    || reading.heartRate > 110
    || reading.spo2 < 95
    || reading.systolic < 90
    || reading.temperature >= 38;
  return attention
    ? { label: "Outside demo reference range", className: "vital-attention" }
    : { label: "Within demo reference range", className: "vital-normal" };
}

function PatientVitalsPage({ user, readings, onAddReading, onLogout, session }) {
  const [draft, setDraft] = useState({ heartRate: "", systolic: "", diastolic: "", spo2: "", temperature: "" });
  const [formError, setFormError] = useState("");
  const latest = readings[0] || null;
  const latestStatus = latest ? getVitalsStatus(latest) : null;

  function handleChange(event) {
    const { name, value } = event.target;
    setDraft((previous) => ({ ...previous, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const reading = {
      id: crypto.randomUUID(),
      heartRate: Number(draft.heartRate),
      systolic: Number(draft.systolic),
      diastolic: Number(draft.diastolic),
      spo2: Number(draft.spo2),
      temperature: Number(draft.temperature),
      recordedAt: new Date().toISOString(),
    };
    if (reading.systolic <= reading.diastolic) {
      setFormError("Systolic pressure should be higher than diastolic pressure.");
      return;
    }
    onAddReading(reading);
    setDraft({ heartRate: "", systolic: "", diastolic: "", spo2: "", temperature: "" });
    setFormError("");
  }

  return (
    <main className="patient-shell">
      <header className="patient-topbar">
        <a className="patient-brand" href="#vitals"><span className="brand-mark"><HeartPulse size={21} /></span><strong>Vigil</strong></a>
        <div className="patient-account"><span>{user.name}</span><button className="icon-button" type="button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
      </header>
      <div className="patient-content">
        <div className="patient-heading"><div><p className="eyebrow">PATIENT WORKSPACE</p><h1>My vitals</h1><p>Record and review your recent measurements.</p></div><span className="patient-session-tag"><span /> Patient session</span></div>
        <section className="panel patient-camera-panel">
          <div className="patient-camera-summary">
            <div className="patient-camera-copy">
              <p className="section-kicker">OPTIONAL ON-DEVICE CHECK</p>
              <h2>Alertness monitor</h2>
              <p>Uses eye activity as a wellness signal. It does not measure blood pressure, oxygen, heart rate, or diagnose fatigue.</p>
              <div className={`patient-camera-status patient-camera-${session.monitorState}`}><span />{session.monitorState === "starting" ? "Requesting camera access" : session.monitorState === "running" ? "Monitoring locally" : session.monitorState === "no-face" ? "Face not found" : session.monitorState === "error" ? "Camera unavailable" : "Camera stopped"}</div>
              {session.monitorError && <p className="patient-camera-error" role="alert">{session.monitorError}</p>}
            </div>
            <div className="patient-alertness-reading">
              <span>{session.monitoring ? "LIVE ALERTNESS" : "LAST ALERTNESS"}</span>
              <strong>{session.metrics.score === null ? "--" : `${Math.round(session.metrics.score)}%`}</strong>
              <small>{session.metrics.score === null ? "Waiting for an eye-activity reading" : statusForScore(session.metrics.score).label}</small>
            </div>
            <div className="patient-camera-actions">
              <label className="form-field patient-camera-picker" htmlFor="patient-monitor-camera">
                <span>Camera input <small>{session.cameras.length ? `${session.cameras.length} found` : "system default available"}</small></span>
                <select
                  id="patient-monitor-camera"
                  value={session.selectedCameraId}
                  onChange={(event) => { session.setMonitorError(""); session.setSelectedCameraId(event.target.value); }}
                  aria-label="Choose patient alertness camera"
                >
                  <option value="default">System default camera</option>
                  {session.cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
                </select>
              </label>
              {session.monitoring ? (
                <button className="button button-danger" type="button" onClick={() => { session.setMonitoring(false); session.setMonitorState("idle"); }}><VideoOff size={16} /> Stop check</button>
              ) : (
                <button className="button button-primary" type="button" onClick={() => { session.setMonitorError(""); session.setMonitoring(true); }}><Camera size={16} /> {session.monitorState === "error" ? "Retry camera" : "Start camera check"}</button>
              )}
            </div>
          </div>
          {session.monitoring && (
            <div className="patient-camera-preview camera-stage camera-on">
              <CameraPreview stream={session.cameraStream} />
              <div className="camera-overlay"><span className="face-guide" /><span className="camera-live"><i /> LOCAL PROCESSING</span></div>
            </div>
          )}
          <video ref={session.sourceVideoRef} className="camera-source" playsInline muted aria-hidden="true" />
          <p className="vitals-disclaimer"><ShieldCheck size={15} /> Camera frames stay on this device. Patient alertness scores are not sent to the employee trust or review system.</p>
        </section>
        <div className="vitals-layout">
          <section className="panel vitals-entry-panel">
            <div className="panel-heading"><div><p className="section-kicker">NEW READING</p><h2>Record vitals</h2></div><Activity size={18} /></div>
            <form className="vitals-form" onSubmit={handleSubmit}>
              <label className="form-field" htmlFor="vital-heart-rate"><span>Heart rate <b>*</b></span><div className="vital-input-wrap"><input id="vital-heart-rate" name="heartRate" type="number" min="20" max="250" required value={draft.heartRate} onChange={handleChange} placeholder="72" /><small>bpm</small></div></label>
              <label className="form-field" htmlFor="vital-systolic"><span>Blood pressure <b>*</b></span><div className="bp-inputs"><div className="vital-input-wrap"><input id="vital-systolic" name="systolic" type="number" min="50" max="260" required value={draft.systolic} onChange={handleChange} placeholder="120" /><small>SYS</small></div><span>/</span><div className="vital-input-wrap"><input aria-label="Diastolic blood pressure" name="diastolic" type="number" min="30" max="180" required value={draft.diastolic} onChange={handleChange} placeholder="80" /><small>DIA</small></div><small>mmHg</small></div></label>
              <label className="form-field" htmlFor="vital-spo2"><span>Oxygen saturation <b>*</b></span><div className="vital-input-wrap"><input id="vital-spo2" name="spo2" type="number" min="50" max="100" required value={draft.spo2} onChange={handleChange} placeholder="98" /><small>% SpO2</small></div></label>
              <label className="form-field" htmlFor="vital-temperature"><span>Temperature <b>*</b></span><div className="vital-input-wrap"><input id="vital-temperature" name="temperature" type="number" min="30" max="45" step="0.1" required value={draft.temperature} onChange={handleChange} placeholder="36.8" /><small>°C</small></div></label>
              {formError && <p className="vitals-error" role="alert">{formError}</p>}
              <button className="button button-primary" type="submit"><Activity size={16} /> Save reading</button>
            </form>
            <p className="vitals-disclaimer"><ShieldCheck size={15} /> Readings stay in this browser session. Reference flags are informational, not a diagnosis.</p>
          </section>
          <section className="panel latest-vitals-panel">
            <div className="panel-heading"><div><p className="section-kicker">LATEST READING</p><h2>{latest ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(latest.recordedAt)) : "No readings yet"}</h2></div></div>
            {latest ? (
              <>
                <div className={`vitals-status ${latestStatus.className}`}><span />{latestStatus.label}</div>
                <div className="vitals-metric-grid">
                  <VitalMetric label="Heart rate" value={latest.heartRate} unit="bpm" icon={HeartPulse} />
                  <VitalMetric label="Blood pressure" value={`${latest.systolic}/${latest.diastolic}`} unit="mmHg" icon={Activity} />
                  <VitalMetric label="Oxygen saturation" value={latest.spo2} unit="%" icon={Eye} />
                  <VitalMetric label="Temperature" value={Number(latest.temperature).toFixed(1)} unit="°C" icon={Wind} />
                </div>
              </>
            ) : <EmptyState icon={HeartPulse} title="Your readings will appear here" detail="Add a measurement to start your personal history." />}
          </section>
        </div>
        <section className="panel vitals-history-panel">
          <div className="panel-heading"><div><p className="section-kicker">HISTORY</p><h2>Recent readings</h2></div><span>{readings.length} saved this session</span></div>
          {readings.length ? <div className="vitals-history-list">{readings.map((reading) => {
            const status = getVitalsStatus(reading);
            return <article className="vitals-history-row" key={reading.id}><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(reading.recordedAt))}</time><span>{reading.heartRate} bpm</span><span>{reading.systolic}/{reading.diastolic} mmHg</span><span>{reading.spo2}% SpO2</span><span>{Number(reading.temperature).toFixed(1)}°C</span><span className={`vitals-history-status ${status.className}`}>{status.label}</span></article>;
          })}</div> : <EmptyState icon={Clock3} title="No measurement history" detail="Saved readings remain available until you sign out or reload." />}
        </section>
      </div>
    </main>
  );
}

function VitalMetric({ label, value, unit, icon: Icon }) {
  return <article className="vital-metric"><span className="vital-metric-icon"><Icon size={17} /></span><span className="vital-metric-label">{label}</span><strong>{value}<small>{unit}</small></strong></article>;
}

function App() {
  const [activeSection, setActiveSection] = useState("overview");
  const [currentUser, setCurrentUser] = useState(null);
  const [patientVitals, setPatientVitals] = useState([]);
  const [patients, setPatients] = useState([]);
  const [readings, setReadings] = useState([]);
  const [queue, setQueue] = useState([]);
  const [trust, setTrust] = useState({
    trust: 100,
    alertness: 100,
    clickTiming: 100,
    canaryPerformance: 100,
    source: "click-timing fallback",
    fatigueDetected: false,
    threshold: 60,
    frictionSeconds: 0,
    confirmationRequired: false,
  });
  const [stats, setStats] = useState({ reviewed: 0, caught: 0, missed: 0 });
  const [apiStatus, setApiStatus] = useState("connecting");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const fatigueSession = useFatigueSession(
    selectedPatientId,
    currentUser?.role === "employee" || currentUser?.role === "patient",
    currentUser?.role === "employee",
  );
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("success");
  const [search, setSearch] = useState("");
  const [reviewConfirmation, setReviewConfirmation] = useState("");
  const [resetDeadline, setResetDeadline] = useState(null);
  const [resetRemaining, setResetRemaining] = useState(0);
  const [resetComplete, setResetComplete] = useState(false);
  const [criticalAlertDismissed, setCriticalAlertDismissed] = useState(false);
  const queueSeenAt = useRef(new Map());
  const previousReviewAt = useRef(null);

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      if (currentUser?.role !== "employee") return;
      try {
        const [patientData, readingData, queueData, trustData, statsData] = await Promise.all([
          requestJson("/api/patients"),
          requestJson("/api/alertness"),
          requestJson("/queue"),
          requestJson("/trust"),
          requestJson("/stats"),
        ]);
        if (!mounted) return;
        setPatients(patientData.patients);
        setReadings(readingData.readings);
        setQueue(queueData.queue);
        setTrust(trustData);
        setStats(statsData);
        setApiStatus("online");
      } catch {
        if (mounted) setApiStatus("offline");
      }
    };
    void loadData();
    const intervalId = window.setInterval(loadData, 2000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [currentUser?.role]);

  useEffect(() => {
    const now = performance.now();
    queue.forEach((entry) => {
      if (!queueSeenAt.current.has(entry.id)) queueSeenAt.current.set(entry.id, now);
    });
    const activeIds = new Set(queue.map((entry) => entry.id));
    queueSeenAt.current.forEach((_, id) => {
      if (!activeIds.has(id)) queueSeenAt.current.delete(id);
    });
  }, [queue]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!resetDeadline) return undefined;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((resetDeadline - Date.now()) / 1000));
      setResetRemaining(remaining);
      if (remaining === 0) {
        setResetDeadline(null);
        setResetComplete(true);
      }
    };
    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(intervalId);
  }, [resetDeadline]);

  function startAlertnessReset() {
    setResetComplete(false);
    setResetRemaining(20);
    setResetDeadline(Date.now() + 20_000);
  }

  const [title, subtitle] = TITLES[activeSection];
  const reviewPatients = queue;
  const filteredQueue = queue.filter((entry) => {
    const query = search.trim().toLowerCase();
    return !query || `${entry.name} ${entry.reason}`.toLowerCase().includes(query);
  });
  const liveAlertness = currentUser?.role === "employee" && fatigueSession.monitoring && fatigueSession.metrics.score !== null
    ? fatigueSession.metrics.score
    : trust.alertness;
  const alertnessLow = currentUser?.role === "employee" && liveAlertness < 80;
  const dangerouslyLow = currentUser?.role === "employee" && liveAlertness < 40;

  useEffect(() => {
    if (!dangerouslyLow) setCriticalAlertDismissed(false);
  }, [dangerouslyLow]);

  function handleLogin(user) {
    setCurrentUser(user);
    setActiveSection(user.role === "employee" ? "overview" : "vitals");
    setCriticalAlertDismissed(false);
  }

  function handleLogout() {
    fatigueSession.setMonitoring(false);
    setCurrentUser(null);
    setPatientVitals([]);
    setSelectedPatientId("");
    setReviewConfirmation("");
    setActiveSection("overview");
  }

  function addPatientVital(reading) {
    setPatientVitals((previous) => [reading, ...previous]);
  }

  async function submitIntake(payload) {
    try {
      const response = await requestJson("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPatients((previous) => [response.patient, ...previous]);
      if (response.patient.reviewRequired) {
        const queueEntry = {
          id: response.patient.id,
          name: response.patient.name,
          country: response.patient.country,
          reason: response.patient.reason,
          priority: response.patient.priority,
          confidence: response.patient.confidence,
          createdAt: response.patient.createdAt,
          intake: response.patient.intake,
        };
        setQueue((previous) => [queueEntry, ...previous.filter((entry) => entry.id !== queueEntry.id)]);
      }
      setNoticeType("success");
      setNotice(response.routing === "auto-accepted"
        ? `${response.patient.name} passed the confidence check and was auto-accepted.`
        : `${response.patient.name} added to the human review queue.`);
      setActiveSection(response.patient.reviewRequired ? "patients" : "overview");
    } catch (error) {
      setNotice(error.message);
      throw error;
    }
  }

  async function reviewQueueItem(id, decision) {
    const now = performance.now();
    const firstSeen = queueSeenAt.current.get(id) ?? now - 1800;
    const intervalMs = previousReviewAt.current === null ? null : Math.round(now - previousReviewAt.current);
    previousReviewAt.current = now;
    try {
      const result = await requestJson(`/review/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          elapsedMs: Math.round(now - firstSeen),
          intervalMs,
          confirmation: reviewConfirmation,
        }),
      });
      setQueue((previous) => previous.filter((entry) => entry.id !== id));
      setNoticeType(result.outcome || "success");
      setNotice(result.message);
      if (trust.confirmationRequired) setReviewConfirmation("");
    } catch (error) {
      setNoticeType(error.status === 423 ? "fatigue" : "missed");
      setNotice(error.message);
      if (error.status === 423 || error.status === 428) {
        try {
          setTrust(await requestJson("/trust"));
        } catch {
          setApiStatus("offline");
        }
      }
    }
  }

  if (!currentUser) return <LoginPage onLogin={handleLogin} />;

  if (currentUser.role === "patient") {
    return <PatientVitalsPage user={currentUser} readings={patientVitals} onAddReading={addPatientVital} onLogout={handleLogout} session={fatigueSession} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setActiveSection("overview"); }}>
          <span className="brand-mark"><HeartPulse size={21} strokeWidth={2.2} /></span>
          <span><strong>Vigil</strong><small>CARE OPERATIONS</small></span>
        </a>

        <div className="unit-switcher">
          <span className="unit-icon"><Stethoscope size={17} /></span>
          <span><strong>North wing</strong><small>General medicine</small></span>
          <ChevronRight className="unit-chevron" size={15} />
        </div>

        <p className="nav-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeSection === item.id ? "is-active" : ""}`}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                type="button"
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "patients" && reviewPatients.length > 0 && <span className="nav-count">{reviewPatients.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span><strong>Camera stays local</strong><small>Only score summaries sync</small></span>
          </div>
          <div className="profile-row">
            <div className="profile-avatar">{initials(currentUser.name)}</div>
            <span><strong>{currentUser.name}</strong><small>Employee workspace</small></span>
            <span className="profile-more">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>North wing</span><ChevronRight size={14} /><strong>{title}</strong></div>
          <div className="topbar-actions">
            <span className={`connection-state connection-${apiStatus}`}>
              {apiStatus === "online" ? <Wifi size={14} /> : apiStatus === "offline" ? <WifiOff size={14} /> : <LoaderCircle className="spin" size={14} />}
              {apiStatus === "online" ? "Local service connected" : apiStatus === "offline" ? "Service unavailable" : "Connecting"}
            </span>
            <button
              className={`monitor-toggle ${fatigueSession.monitoring ? "monitor-toggle-active" : ""}`}
              type="button"
              aria-pressed={fatigueSession.monitoring}
              title={fatigueSession.monitorError || (fatigueSession.monitoring ? "Stop fatigue monitoring" : "Start fatigue monitoring across the website")}
              onClick={() => {
                fatigueSession.setMonitorError("");
                if (fatigueSession.monitoring) {
                  fatigueSession.setMonitoring(false);
                  fatigueSession.setMonitorState("idle");
                } else {
                  fatigueSession.setMonitoring(true);
                }
              }}
            >
              {fatigueSession.monitoring ? <VideoOff size={15} /> : <Camera size={15} />}
              <span>{fatigueSession.monitoring ? fatigueSession.monitorState === "starting" ? "Requesting camera" : "Camera active" : fatigueSession.monitorState === "error" ? "Retry camera" : "Start monitor"}</span>
            </button>
            <button className="icon-button notification-button" aria-label="Notifications" type="button" onClick={() => { setNoticeType("success"); setNotice(`${reviewPatients.length} entries need a human review.`); }}>
              <Bell size={18} /><span className="notification-dot" />
            </button>
            <button className="topbar-avatar topbar-logout" type="button" onClick={handleLogout} aria-label="Sign out" title="Sign out">{initials(currentUser.name)}</button>
          </div>
        </header>

        {fatigueSession.monitoring && (
          <div className="session-ribbon" role="status">
            <span className="session-ribbon-live"><i /> Monitoring across the website</span>
            <span>{fatigueSession.monitorState === "no-face" ? "Face not found" : fatigueSession.monitorState === "starting" ? "Starting camera" : fatigueSession.metrics.score === null ? "Waiting for first reading" : `Alertness ${Math.round(fatigueSession.metrics.score)}%`}</span>
            <span className="session-ribbon-privacy"><ShieldCheck size={14} /> Video stays on this device</span>
          </div>
        )}

        {trust.fatigueDetected && activeSection !== "patients" && (
          <div className="global-fatigue-banner" role="alert">
            <AlertTriangle size={17} />
            <span><strong>Fatigue Detected</strong><small>Review actions are paused while trust recovers.</small></span>
            <b>{Math.round(trust.trust)}%</b>
          </div>
        )}

        {alertnessLow && (
          <section className="alertness-booster" role={trust.fatigueDetected ? "alert" : "status"}>
            <span className="booster-icon"><Wind size={18} /></span>
            <div className="booster-copy">
              <strong>{resetComplete ? "Reset complete" : "Take a short reset"}</strong>
              <p>{resetComplete
                ? "This pause does not alter your alertness score. Review actions still follow the trust gate and confirmation rules."
                : !fatigueSession.monitoring || fatigueSession.metrics.score === null
                  ? "The click-timing proxy is low. Pause for 20 seconds and refocus before continuing."
                  : "Recent eye activity is low. Pause for 20 seconds and refocus before continuing."}</p>
            </div>
            {resetDeadline ? (
              <div className="booster-countdown" aria-live="polite">
                <span>{Math.floor((20 - resetRemaining) / 4) % 2 === 0 ? "Breathe in gently" : "Breathe out gently"}</span>
                <strong>{resetRemaining}s</strong>
                <i className="breathing-ring" />
              </div>
            ) : resetComplete ? (
              <button className="booster-action" type="button" onClick={() => setResetComplete(false)}>Dismiss</button>
            ) : (
              <button className="booster-action" type="button" onClick={startAlertnessReset}><Wind size={15} /> Start 20-second reset</button>
            )}
          </section>
        )}

        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</p>
              <h1>{title}</h1>
              <p className="page-subtitle">{subtitle}</p>
            </div>
            {activeSection !== "intake" && (
              <button className="button button-primary" onClick={() => setActiveSection("intake")} type="button">
                <FilePlus2 size={17} /> New patient
              </button>
            )}
          </div>

          {apiStatus === "offline" && (
            <div className="service-banner" role="status">
              <AlertTriangle size={18} />
              <span>Local service is offline. Start <code>python backend/main.py</code> from the project root to load and save patient entries.</span>
            </div>
          )}

          {activeSection === "overview" && (
            <Overview
              patients={patients}
              readings={readings}
              reviewPatients={reviewPatients}
              trust={trust}
              onNewIntake={() => setActiveSection("intake")}
              onOpenPatients={() => setActiveSection("patients")}
              onOpenMonitor={(patientId = "") => { setSelectedPatientId(patientId); setActiveSection("monitor"); }}
            />
          )}
          {activeSection === "patients" && (
            <PatientQueue
              queue={filteredQueue}
              search={search}
              onSearch={setSearch}
              trust={trust}
              stats={stats}
              reviewConfirmation={reviewConfirmation}
              onConfirmationChange={setReviewConfirmation}
              onReview={reviewQueueItem}
            />
          )}
          {activeSection === "intake" && <IntakeForm onSubmit={submitIntake} />}
          {activeSection === "logic" && (
            <LogicDashboard
              queue={filteredQueue}
              search={search}
              onSearch={setSearch}
              trust={trust}
              stats={stats}
              reviewConfirmation={reviewConfirmation}
              onConfirmationChange={setReviewConfirmation}
              onReview={reviewQueueItem}
            />
          )}
          {activeSection === "monitor" && (
            <FatigueMonitor
              patients={patients}
              latestReading={readings.at(-1)}
              selectedPatientId={selectedPatientId}
              onSelectPatient={setSelectedPatientId}
              session={fatigueSession}
              onBack={() => setActiveSection("overview")}
            />
          )}
        </div>
      </main>

      <video ref={fatigueSession.sourceVideoRef} className="camera-source" playsInline muted aria-hidden="true" />

      {dangerouslyLow && !criticalAlertDismissed && (
        <div className="critical-alert-backdrop">
          <section className="critical-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="critical-alert-title" aria-describedby="critical-alert-description">
            <span className="critical-alert-icon"><AlertTriangle size={23} /></span>
            <p className="section-kicker">REVIEWER SAFETY CHECK</p>
            <h2 id="critical-alert-title">Alertness is critically low</h2>
            <p id="critical-alert-description">Pause reviewing now. Approval and rejection stay locked until trust recovers and the recovery confirmation is complete.</p>
            <div className="critical-alert-score"><span>Current alertness</span><strong>{Math.round(liveAlertness)}%</strong></div>
            <button className="button button-primary" type="button" onClick={() => { startAlertnessReset(); setCriticalAlertDismissed(true); }}><Wind size={17} /> Pause and start 20-second reset</button>
            <button className="critical-dismiss" type="button" onClick={() => setCriticalAlertDismissed(true)}>Acknowledge alert</button>
          </section>
        </div>
      )}

      {notice && <div className={`toast toast-${noticeType}`} role={noticeType === "missed" || noticeType === "fatigue" ? "alert" : "status"}>{noticeType === "missed" || noticeType === "fatigue" ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{notice}<button onClick={() => setNotice("")} type="button" aria-label="Dismiss"><X size={16} /></button></div>}
    </div>
  );
}

function Overview({ patients, readings, reviewPatients, trust, onNewIntake, onOpenPatients, onOpenMonitor }) {
  const averageConfidence = patients.length
    ? Math.round(patients.reduce((total, patient) => total + patient.confidence, 0) / patients.length)
    : null;

  return (
    <div className="view-stack view-enter">
      <section className="metric-grid" aria-label="Unit metrics">
        <MetricCard label="Patient entries" value={patients.length} detail="In this local session" icon={UsersRound} tone="sage" />
        <MetricCard label="Human review" value={reviewPatients.length} detail="Waiting for a decision" icon={ClipboardList} tone="coral" />
        <MetricCard label="Live trust" value={`${Math.round(trust.trust)}%`} detail={trust.fatigueDetected ? "Fatigue detected" : "Alertness within range"} icon={Activity} tone="blue" />
        <MetricCard label="Form confidence" value={averageConfidence === null ? "--" : `${averageConfidence}%`} detail={patients.length ? "Average structure score" : "Available after intake"} icon={ShieldCheck} tone="gold" />
      </section>

      <section className="overview-grid">
        <div className="panel trend-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">FATIGUE SIGNAL</p><h2>Alertness trace</h2></div>
            <span className="live-tag"><span /> LIVE</span>
          </div>
          <AlertnessChart readings={readings} />
          <div className="chart-foot"><span><i className="chart-key" />Alertness estimate</span><span>8-second blink window</span></div>
        </div>

        <div className="panel review-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">ATTENTION</p><h2>Review queue</h2></div>
            <button className="text-action" onClick={onOpenPatients} type="button">See all <ChevronRight size={15} /></button>
          </div>
          {reviewPatients.length ? (
            <div className="review-list">
              {reviewPatients.slice(0, 4).map((patient) => (
                <button className="review-item" key={patient.id} onClick={() => onOpenMonitor(patient.id)} type="button">
                  <span className="patient-avatar">{initials(patient.name)}</span>
                  <span className="review-person"><strong>{patient.name}</strong><small>{patient.reason || patient.country || "Intake check"}</small></span>
                  <span className="review-confidence">{patient.confidence}%</span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Queue is clear" detail="Entries with lower structural confidence will appear here." />
          )}
          <div className="review-foot"><ShieldCheck size={15} /> Confidence supports review; it is not a clinical decision.</div>
        </div>
      </section>

      <section className="panel patient-panel">
        <div className="panel-heading">
          <div><p className="section-kicker">INTAKE ACTIVITY</p><h2>Recent patients</h2></div>
          <button className="text-action" onClick={onOpenPatients} type="button">Open queue <ChevronRight size={15} /></button>
        </div>
        {patients.length ? <PatientTable patients={patients.slice(0, 5)} onOpenMonitor={onOpenMonitor} /> : (
          <div className="empty-table">
            <div className="empty-icon"><UsersRound size={20} /></div>
            <div><strong>No patient entries yet</strong><p>Start a country-aware intake to see patients in this queue.</p></div>
            <button className="button button-secondary" onClick={onNewIntake} type="button"><FilePlus2 size={16} /> Start intake</button>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-${tone}`}><Icon size={18} strokeWidth={1.9} /></span>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
      {label === "Human review" && <span className="metric-accent"><ArrowUpRight size={14} /></span>}
    </article>
  );
}

function AlertnessChart({ readings }) {
  const points = readings.slice(-24);
  if (points.length < 2) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-lines"><span /><span /><span /><span /></div>
        <div className="chart-empty-message"><Activity size={19} /><strong>Waiting for a fatigue check</strong><span>Start the monitor to build a live trace.</span></div>
      </div>
    );
  }
  const coordinates = points.map((reading, index) => ({
    x: 8 + (index / (points.length - 1)) * 384,
    y: 134 - (Math.max(0, Math.min(100, reading.score)) / 100) * 116,
  }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = `${line} L 392,142 L 8,142 Z`;

  return (
    <div className="chart-wrap">
      <div className="chart-y-labels"><span>100</span><span>50</span><span>0</span></div>
      <svg className="alertness-chart" viewBox="0 0 400 150" role="img" aria-label="Alertness readings over time">
        {[18, 76, 134].map((y) => <line key={y} x1="8" x2="392" y1={y} y2={y} className="chart-gridline" />)}
        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />
        {coordinates.slice(-1).map((point) => <circle key="latest" cx={point.x} cy={point.y} r="4.5" className="chart-point" />)}
      </svg>
      <div className="chart-x-labels"><span>{formatTime(points[0].createdAt)}</span><span>{formatTime(points.at(-1).createdAt)}</span></div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon size={18} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

function PatientTable({ patients, onOpenMonitor }) {
  return (
    <div className="table-scroll">
      <table className="patient-table">
        <thead><tr><th>Patient</th><th>Visit reason</th><th>Priority</th><th>Form confidence</th><th>Received</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td><span className="table-person"><span className="patient-avatar">{initials(patient.name)}</span><span><strong>{patient.name}</strong><small>{patient.country || "Patient"}</small></span></span></td>
              <td className="reason-cell">{patient.reason || "General intake"}</td>
              <td><span className={`priority-pill priority-${priorityClass(patient.priority)}`}>{patient.priority || "Routine"}</span></td>
              <td><ConfidenceValue confidence={patient.confidence} /></td>
              <td className="time-cell">{formatTime(patient.createdAt)}</td>
              <td><button className="row-action" type="button" onClick={() => onOpenMonitor(patient.id)} aria-label={`Open fatigue monitor for ${patient.name}`}><ChevronRight size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfidenceValue({ confidence }) {
  const low = confidence <= REVIEW_THRESHOLD;
  return <span className={`confidence-value ${low ? "confidence-low" : "confidence-high"}`}><span />{confidence}%</span>;
}

function PatientQueue({ queue, search, onSearch, trust, stats, reviewConfirmation, onConfirmationChange, onReview }) {
  const confirmationReady = !trust.confirmationRequired || reviewConfirmation.trim().length >= 12;
  const actionsLocked = trust.fatigueDetected || trust.frictionSeconds > 0 || !confirmationReady;

  return (
    <div className="view-stack view-enter">
      <div className="queue-toolbar">
        <label className="search-field"><Search size={17} /><input aria-label="Search patients" placeholder="Search name, country or visit reason" value={search} onChange={(event) => onSearch(event.target.value)} /></label>
        <div className="queue-toolbar-meta">
          <span className="queue-count">{queue.length} waiting</span>
          <span className={`trust-chip ${trust.alertness < trust.threshold ? "trust-chip-low" : ""}`}><Eye size={14} />{trust.cameraAlertness === null ? "Click proxy" : "Alertness"} {Math.round(trust.alertness)}%</span>
          <span className={`trust-chip ${trust.trust < trust.threshold ? "trust-chip-low" : ""}`} title={`Signal: ${trust.source}`}><Activity size={14} />Trust {Math.round(trust.trust)}%</span>
        </div>
      </div>
      {trust.fatigueDetected && (
        <div className="fatigue-banner" role="alert">
          <AlertTriangle size={20} />
          <span><strong>Fatigue Detected</strong><small>Review decisions are paused. Trust combines alertness, decision timing, and recent canary outcomes.</small></span>
          <b>{Math.round(trust.trust)}%</b>
        </div>
      )}
      {!trust.fatigueDetected && trust.frictionSeconds > 0 && (
        <div className="recovery-banner" role="status">
          <Clock3 size={18} />
          <span><strong>Recovery pause</strong><small>Take a moment before reviewing resumes.</small></span>
          <b>{trust.frictionSeconds}s</b>
        </div>
      )}
      {!trust.fatigueDetected && trust.frictionSeconds === 0 && trust.confirmationRequired && (
        <label className="review-confirmation" htmlFor="review-confirmation">
          <ShieldCheck size={18} />
          <span><strong>Written confirmation required</strong><small>Briefly confirm you are ready to resume reviewing (12 characters minimum).</small></span>
          <textarea id="review-confirmation" rows="2" minLength={12} value={reviewConfirmation} onChange={(event) => onConfirmationChange(event.target.value)} placeholder="I have paused and rechecked my attention..." />
        </label>
      )}
      <section className="review-stats" aria-label="Review statistics">
        <div><span>Reviewed</span><strong>{stats.reviewed}</strong></div>
        <div><span>Caught</span><strong>{stats.caught}</strong></div>
        <div><span>Missed</span><strong>{stats.missed}</strong></div>
      </section>
      <section className="panel queue-panel">
        <div className="review-queue-list">
          {queue.length ? queue.map((entry) => (
            <article className="review-queue-item" key={entry.id}>
              <span className="patient-avatar">{initials(entry.name)}</span>
              <span className="review-queue-person"><strong>{entry.name}</strong><small>{entry.reason || "Patient entry"}</small><small>{formatTime(entry.createdAt)}</small></span>
              <span className="queue-confidence"><small>Confidence</small><strong className={entry.confidence <= REVIEW_THRESHOLD ? "text-coral" : "text-green"}>{entry.confidence}%</strong></span>
              <span className={`priority-pill priority-${priorityClass(entry.priority)}`}>{entry.priority || "Routine"}</span>
              <div className="review-actions">
                <button className="review-reject" type="button" onClick={() => onReview(entry.id, "reject")} disabled={actionsLocked}><X size={15} />Reject</button>
                <button className="review-approve" type="button" onClick={() => onReview(entry.id, "approve")} disabled={actionsLocked}><Check size={15} />Approve</button>
              </div>
              <details className="review-entry-details">
                <summary>Inspect submitted fields</summary>
                <dl>
                  {entry.country && <div><dt>Background</dt><dd>{LOCALE_RULES[entry.country]?.label || entry.country}</dd></div>}
                  {Object.entries(entry.intake || {}).map(([field, value]) => (
                    <div key={field}><dt>{field.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</dt><dd>{String(value) || "Not provided"}</dd></div>
                  ))}
                </dl>
              </details>
            </article>
          )) : <EmptyState icon={Search} title="No entries waiting" detail={search ? "Try another search." : "New entries that need review will appear here."} />}
        </div>
      </section>
      <p className="queue-disclaimer"><ShieldCheck size={15} /> Decisions are held in local memory for this demo session and clear when the API restarts.</p>
    </div>
  );
}

function IntakeForm({ onSubmit }) {
  const [country, setCountry] = useState("");
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const rules = country ? LOCALE_RULES[country] : null;
  const { confidence, deviations } = calculateConfidence(country, formData);

  function handleCountryChange(event) {
    setCountry(event.target.value);
    setFormData({});
    setError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!rules) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        name: formData.fullName.trim(),
        country,
        dateOfBirth: formData.dateOfBirth,
        phone: formData.phone,
        reason: formData.reason,
        priority: formData.priority || "Routine",
        confidence,
        deviations,
        intake: { ...formData },
      });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="intake-layout view-enter">
      <form className="panel intake-form" onSubmit={handleSubmit}>
        <div className="form-section-heading"><span className="form-step">01</span><div><h2>Patient details</h2><p>Fields adapt to the selected country or background.</p></div></div>
        <div className="field-grid country-grid">
          <label className="form-field field-wide" htmlFor="country">
            <span>Country or background <b>*</b></span>
            <select id="country" value={country} onChange={handleCountryChange} required>
              <option value="">Select a country</option>
              {Object.entries(LOCALE_RULES).map(([code, rule]) => <option key={code} value={code}>{rule.label}</option>)}
            </select>
          </label>
        </div>

        {rules ? (
          <>
            <div className="field-grid">
              {rules.fields.map((field) => (
                <label className="form-field" htmlFor={field.name} key={field.name}>
                  <span>{field.label}{field.required && <b> *</b>}</span>
                  {field.type === "select" ? (
                    <select id={field.name} name={field.name} value={formData[field.name] || ""} onChange={handleChange} required={field.required}>
                      <option value="">Select an option</option>
                      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input id={field.name} name={field.name} type={field.type} value={formData[field.name] || ""} onChange={handleChange} required={field.required} autoComplete={field.name === "fullName" ? "name" : field.name === "phone" ? "tel" : field.name === "dateOfBirth" ? "bday" : "off"} />
                  )}
                </label>
              ))}
            </div>

            <div className="form-divider" />
            <div className="form-section-heading"><span className="form-step">02</span><div><h2>Visit information</h2><p>Summarize the reason for today&apos;s visit.</p></div></div>
            <div className="field-grid">
              <label className="form-field" htmlFor="priority"><span>Visit priority <b>*</b></span>
                <select id="priority" name="priority" value={formData.priority || "Routine"} onChange={handleChange} required>
                  <option>Routine</option><option>Same day</option><option>Urgent</option>
                </select>
              </label>
              <label className="form-field field-wide" htmlFor="reason"><span>Reason for visit <b>*</b></span>
                <textarea id="reason" name="reason" rows="3" placeholder="Main concern or requested care" value={formData.reason || ""} onChange={handleChange} required />
              </label>
            </div>

            <label className="consent-row"><input type="checkbox" required /><span>Patient or authorized representative has agreed to this local demo intake.</span></label>
            {error && <div className="form-error" role="alert"><AlertTriangle size={16} />{error}</div>}
            <div className="form-footer">
              <div className="form-confidence"><span>Structural confidence</span><strong className={confidence <= REVIEW_THRESHOLD ? "text-coral" : "text-green"}>{confidence}%</strong><small>{deviations ? `${deviations} validation issue${deviations === 1 ? "" : "s"}` : "Required fields complete"}</small></div>
              <button className="button button-primary" disabled={submitting} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{submitting ? "Saving entry" : "Add to patient queue"}</button>
            </div>
          </>
        ) : <div className="form-placeholder"><ClipboardList size={20} /><span>Choose a country to load the appropriate patient fields.</span></div>}
      </form>

      <aside className="intake-aside">
        <div className="panel confidence-panel">
          <p className="section-kicker">FORM CHECK</p>
          <div className="confidence-dial" style={{ "--confidence": `${confidence}%` }}><span>{rules ? `${confidence}%` : "--"}</span></div>
          <h3>{!rules ? "Ready for intake" : confidence <= REVIEW_THRESHOLD ? "Human review suggested" : "Structure looks consistent"}</h3>
          <p>{!rules ? "Select a background to begin. Confidence reflects form structure, not clinical accuracy." : confidence <= REVIEW_THRESHOLD ? "This entry will be added to the review queue before any downstream action." : "Required fields and common identifier formats passed the structural check."}</p>
          <div className="review-threshold"><span>Review threshold</span><strong>{REVIEW_THRESHOLD}%</strong></div>
        </div>
        <div className="privacy-card"><ShieldCheck size={19} /><div><strong>Local demo mode</strong><p>Submissions are held in API memory only. Do not enter real patient information.</p></div></div>
      </aside>
    </div>
  );
}

async function listCameraInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
  } catch {
    return [];
  }
}

function useFatigueSession(selectedPatientId, enabled, publishToEmployeeTrust) {
  const sourceVideoRef = useRef(null);
  const selectedPatientRef = useRef(selectedPatientId);
  const publishToEmployeeTrustRef = useRef(publishToEmployeeTrust);
  publishToEmployeeTrustRef.current = publishToEmployeeTrust;
  const [monitoring, setMonitoring] = useState(false);
  const [monitorState, setMonitorState] = useState("idle");
  const [monitorError, setMonitorError] = useState("");
  const [cameraStream, setCameraStream] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("default");
  const [metrics, setMetrics] = useState({ score: null, blinks: 0, ear: null, longClosure: false });

  useEffect(() => {
    if (!enabled) {
      setMonitoring(false);
      setMonitorState("idle");
      setMonitorError("");
      setMetrics({ score: null, blinks: 0, ear: null, longClosure: false });
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setMonitoring(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, [enabled]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatientId;
  }, [selectedPatientId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return undefined;
    let mounted = true;
    const refreshCameras = async () => {
      const available = await listCameraInputs();
      if (!mounted) return;
      setCameras(available);
      setSelectedCameraId((current) => current !== "default" && !available.some((camera) => camera.deviceId === current) ? "default" : current);
    };
    void refreshCameras();
    mediaDevices.addEventListener?.("devicechange", refreshCameras);
    return () => {
      mounted = false;
      mediaDevices.removeEventListener?.("devicechange", refreshCameras);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !monitoring) return undefined;
    let mounted = true;
    let frameId = 0;
    let stream;
    let landmarker;
    let previousVideoTime = -1;
    let closedFrames = 0;
    let longClosure = false;
    let smoothedScore = 100;
    let lastUiUpdate = 0;
    let lastPost = 0;
    const blinkTimes = [];

    const distance = (first, second, width, height) => Math.hypot((first.x - second.x) * width, (first.y - second.y) * height);
    const eyeRatio = (landmarks, eye, width, height) => {
      const vertical = distance(landmarks[eye.top], landmarks[eye.bottom], width, height);
      const horizontal = distance(landmarks[eye.left], landmarks[eye.right], width, height);
      return horizontal ? vertical / horizontal : 0;
    };

    async function begin() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires localhost or a secure connection.");
        setMonitorState("starting");
        const videoConstraints = selectedCameraId === "default"
          ? { facingMode: "user", width: { ideal: 640 } }
          : { deviceId: { exact: selectedCameraId }, width: { ideal: 640 } };
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setCameraStream(stream);
        void listCameraInputs().then((available) => { if (mounted) setCameras(available); });
        sourceVideoRef.current.srcObject = stream;
        await sourceVideoRef.current.play();
        const vision = await FilesetResolver.forVisionTasks("/mediapipe");
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (mounted) setMonitorState("running");

        const detect = () => {
          if (!mounted || !sourceVideoRef.current || sourceVideoRef.current.readyState < 2) {
            frameId = window.requestAnimationFrame(detect);
            return;
          }
          const video = sourceVideoRef.current;
          if (video.currentTime !== previousVideoTime) {
            previousVideoTime = video.currentTime;
            const result = landmarker.detectForVideo(video, performance.now());
            const landmarks = result.faceLandmarks?.[0];
            if (landmarks) {
              const left = eyeRatio(landmarks, { top: 159, bottom: 145, left: 33, right: 133 }, video.videoWidth, video.videoHeight);
              const right = eyeRatio(landmarks, { top: 386, bottom: 374, left: 362, right: 263 }, video.videoWidth, video.videoHeight);
              const ear = (left + right) / 2;
              if (ear < 0.21) {
                closedFrames += 1;
                if (closedFrames >= 15) longClosure = true;
              } else {
                if (closedFrames >= 2) blinkTimes.push(Date.now());
                closedFrames = 0;
                longClosure = false;
              }
              while (blinkTimes.length && Date.now() - blinkTimes[0] > WINDOW_SECONDS * 1000) blinkTimes.shift();
              let rawScore = blinkTimes.length >= 2 ? 100 : (blinkTimes.length / 2) * 100;
              if (longClosure) rawScore = Math.max(0, rawScore - 40);
              const alpha = rawScore < smoothedScore ? 0.4 : 0.1;
              smoothedScore = Math.round((alpha * rawScore + (1 - alpha) * smoothedScore) * 10) / 10;
              const now = Date.now();
              if (now - lastUiUpdate > 450) {
                setMetrics({ score: smoothedScore, blinks: blinkTimes.length, ear: ear.toFixed(3), longClosure });
                setMonitorState("running");
                lastUiUpdate = now;
              }
              if (publishToEmployeeTrustRef.current && now - lastPost > 2000) {
                void requestJson("/alertness", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ score: smoothedScore / 100, blinkCount: blinkTimes.length, longClosure, patientId: selectedPatientRef.current || null }),
                }).catch((error) => setMonitorError(error.message));
                lastPost = now;
              }
            } else if (Date.now() - lastUiUpdate > 450) {
              setMonitorState("no-face");
              lastUiUpdate = Date.now();
            }
          }
          frameId = window.requestAnimationFrame(detect);
        };
        frameId = window.requestAnimationFrame(detect);
      } catch (error) {
        if (mounted) {
          setMonitorError(error.message || "Unable to start the fatigue monitor.");
          setMonitorState("error");
          setMonitoring(false);
        }
      }
    }

    void begin();
    return () => {
      mounted = false;
      window.cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
      setCameraStream(null);
    };
  }, [enabled, monitoring, selectedCameraId]);

  return {
    sourceVideoRef,
    cameraStream,
    monitoring,
    setMonitoring,
    monitorState,
    setMonitorState,
    monitorError,
    setMonitorError,
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    metrics,
  };
}

function LogicDashboard({ queue, search, onSearch, trust, stats, reviewConfirmation, onConfirmationChange, onReview }) {
  return (
    <div className="logic-workspace view-stack view-enter">
      <section className="metric-grid" aria-label="Live review logic metrics">
        <MetricCard label="Waiting for review" value={queue.length} detail="Low-confidence entries" icon={ClipboardList} tone="coral" />
        <MetricCard label={trust.cameraAlertness == null ? "Click proxy" : "Camera alertness"} value={`${Math.round(trust.alertness)}%`} detail={trust.source} icon={Eye} tone="blue" />
        <MetricCard label="Combined trust" value={`${Math.round(trust.trust)}%`} detail={trust.fatigueDetected ? "Review gate engaged" : "Review gate open"} icon={Activity} tone={trust.fatigueDetected ? "coral" : "sage"} />
        <MetricCard label="Canary record" value={`${stats.caught} / ${stats.missed}`} detail={`${stats.reviewed} decisions · caught / missed`} icon={ShieldCheck} tone="gold" />
      </section>

      <section className="panel logic-flow-panel">
        <div className="panel-heading">
          <div><p className="section-kicker">ROUTING &amp; ESCALATION</p><h2>How review decisions are shaped</h2></div>
          <span className="logic-mode-tag">{trust.mode || "auto"} mode</span>
        </div>
        <div className="logic-flow-grid">
          <div className="logic-flow-step"><span>01</span><div><strong>Validate locale fields</strong><p>Server checks the selected country pattern and recalculates structural confidence.</p></div></div>
          <div className="logic-flow-step"><span>02</span><div><strong>Route by confidence</strong><p>High confidence is auto-accepted; low confidence enters the reviewer queue.</p></div></div>
          <div className="logic-flow-step"><span>03</span><div><strong>Challenge fairly</strong><p>Locale-aware hidden traps are derived from valid tricky cases. Their identity is never sent to the queue.</p></div></div>
          <div className="logic-flow-step"><span>04</span><div><strong>Apply review friction</strong><p>Fresh camera, click rhythm and canary outcomes combine into trust. Below 60%, decisions pause.</p></div></div>
        </div>
      </section>

      <PatientQueue
        queue={queue}
        search={search}
        onSearch={onSearch}
        trust={trust}
        stats={stats}
        reviewConfirmation={reviewConfirmation}
        onConfirmationChange={onConfirmationChange}
        onReview={onReview}
      />
    </div>
  );
}

function CameraPreview({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!stream || !videoRef.current) return undefined;
    videoRef.current.srcObject = stream;
    void videoRef.current.play().catch(() => { });
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  return <video ref={videoRef} className="camera-video" playsInline muted aria-label="Local fatigue assessment camera" />;
}

function FatigueMonitor({ patients, latestReading, selectedPatientId, onSelectPatient, session }) {
  const {
    cameraStream,
    monitoring,
    setMonitoring,
    monitorState,
    setMonitorState,
    monitorError,
    setMonitorError,
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    metrics,
  } = session;

  const displayedScore = metrics.score ?? latestReading?.score ?? null;
  const displayedBlinks = metrics.score === null ? latestReading?.blinkCount ?? 0 : metrics.blinks;
  const displayedLongClosure = metrics.score === null ? Boolean(latestReading?.longClosure) : metrics.longClosure;
  const scoreStatus = statusForScore(displayedScore);

  return (
    <div className="monitor-layout view-enter">
      <section className="panel camera-panel">
        <div className="panel-heading camera-heading">
          <div><p className="section-kicker">ON-DEVICE ASSESSMENT</p><h2>Live camera check</h2></div>
          <span className={`monitor-status monitor-${monitorState}`}><span />{monitorState === "running" ? "Analyzing" : monitorState === "starting" ? "Starting" : monitorState === "no-face" ? "Face not found" : monitorState === "error" ? "Unavailable" : "Camera off"}</span>
        </div>
        <div className={`camera-stage ${monitoring ? "camera-on" : ""}`}>
          <CameraPreview stream={cameraStream} />
          {!monitoring && <div className="camera-placeholder"><span className="camera-placeholder-icon"><VideoOff size={24} /></span><strong>Camera is off</strong><span>Start only with the patient&apos;s consent.</span></div>}
          {monitoring && <div className="camera-overlay"><span className="face-guide" /><span className="camera-live"><i /> LOCAL PROCESSING</span></div>}
        </div>
        {monitorError && <div className="monitor-error" role="alert"><AlertTriangle size={16} />{monitorError}</div>}
        <div className="camera-controls">
          <label className="form-field patient-link" htmlFor="monitor-patient"><span>Link to patient <small>(optional)</small></span>
            <select id="monitor-patient" value={selectedPatientId} onChange={(event) => onSelectPatient(event.target.value)} disabled={monitoring}>
              <option value="">Unlinked assessment</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
            </select>
          </label>
          <label className="form-field camera-picker" htmlFor="monitor-camera"><span>Camera input <small>{cameras.length ? `${cameras.length} found` : "allow access to reveal names"}</small></span>
            <select id="monitor-camera" value={selectedCameraId} onChange={(event) => { setSelectedCameraId(event.target.value); setMonitorError(""); }} disabled={monitoring}>
              <option value="default">System default camera</option>
              {cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
            </select>
          </label>
          {monitoring ? (
            <button className="button button-danger" type="button" onClick={() => { setMonitoring(false); setMonitorState("idle"); }}><VideoOff size={17} /> Stop check</button>
          ) : (
            <button className="button button-primary" type="button" onClick={() => { setMonitorError(""); setMonitoring(true); }}><Camera size={17} /> Start camera check</button>
          )}
        </div>
      </section>

      <aside className="monitor-side">
        <section className="panel score-panel">
          <div className="score-heading"><span className="section-kicker">ALERTNESS ESTIMATE</span><span className="score-pulse"><i /></span></div>
          <div className="score-reading">{displayedScore === null ? "--" : Math.round(displayedScore)}<span>{displayedScore === null ? "" : "%"}</span></div>
          <div className={`score-status ${scoreStatus.className}`}><span />{displayedScore === null ? "Waiting for first reading" : scoreStatus.label}</div>
          <div className="score-meter"><span style={{ width: `${displayedScore ?? 0}%` }} /></div>
          <p className="score-footnote">Smoothed blink frequency and prolonged eye closure over an {WINDOW_SECONDS}-second window.</p>
        </section>
        <section className="panel signal-panel">
          <div className="panel-heading"><div><p className="section-kicker">LIVE SIGNALS</p><h2>Eye activity</h2></div><Eye size={19} /></div>
          <div className="signal-row"><span>Eye aspect ratio</span><strong>{metrics.ear ?? "--"}</strong></div>
          <div className="signal-row"><span>Blinks in window</span><strong>{displayedBlinks}</strong></div>
          <div className="signal-row"><span>Prolonged closure</span><strong className={displayedLongClosure ? "text-coral" : "text-green"}>{displayedLongClosure ? "Detected" : "None"}</strong></div>
        </section>
        <div className="clinical-note"><AlertTriangle size={17} /><p><strong>Decision support only.</strong> This experimental estimate is not a diagnosis or a substitute for clinical assessment. Poor lighting, camera angle, or accessibility needs can affect results.</p></div>
      </aside>
    </div>
  );
}

export default App;