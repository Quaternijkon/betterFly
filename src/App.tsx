import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, setDoc,
  doc, query, onSnapshot, serverTimestamp, Timestamp, orderBy, writeBatch,
  getDocs, getDoc
} from 'firebase/firestore';

// --- Firebase Configuration ---
// ⚠️⚠️⚠️ 请务必替换为你自己的 Firebase 配置 ⚠️⚠️⚠️
const firebaseConfig = {
  apiKey: "AIzaSyABdPqsF9MxDooqG6P5RvAbzFY6HLVU2yY",
  authDomain: "betterfly-e7452.firebaseapp.com",
  projectId: "betterfly-e7452",
  storageBucket: "betterfly-e7452.firebasestorage.app",
  messagingSenderId: "313348818810",
  appId: "1:313348818810:web:502ea39d4bff4e431338c3",
  measurementId: "G-N4LK61CPCL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Types ---
interface Goal {
  type: 'positive' | 'negative';
  metric: 'count' | 'duration';
  period: 'week' | 'month';
  targetValue: number;
}

interface EventType {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  createdAt: string;
  goal?: Goal | null;
  tags?: string[];
}

interface Session {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string | null;
  note?: string;
  incomplete?: boolean; // New flag: recorded for duration but not count
  rating?: number; // 1-5 rating
  tags?: string[];
}

interface UserSettings {
  themeColor: string;
  weekStart: number;
  stopMode: 'quick' | 'note' | 'interactive';
  darkMode: boolean;
}

// --- Constants ---
const DEFAULT_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e', '#a855f7', '#06b6d4', '#84cc16'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const STORAGE_KEYS = {
  SESSIONS: 'tracker_sessions',
  EVENTS: 'tracker_events',
  SETTINGS: 'tracker_settings',
  PENDING_DELETES: 'tracker_pending_deletes',
  PENDING_SYNC: 'tracker_pending_sync'
};

interface PendingDeletes {
  sessions: string[];
  events: string[];
}

type PendingSyncOp =
  | { type: 'sessionCreate'; payload: Session }
  | { type: 'sessionUpdate'; payload: Session }
  | { type: 'sessionDelete'; payload: { id: string } }
  | { type: 'eventCreate'; payload: EventType }
  | { type: 'eventUpdate'; payload: EventType }
  | { type: 'eventDelete'; payload: { id: string } }
  | { type: 'settingsUpdate'; payload: UserSettings };

const getPendingDeletes = (): PendingDeletes => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_DELETES) || '{"sessions":[], "events":[]}');
  } catch {
    return { sessions: [], events: [] };
  }
};

const addPendingDelete = (type: 'sessions' | 'events', id: string) => {
  const pending = getPendingDeletes();
  if (!pending[type].includes(id)) {
    pending[type].push(id);
    localStorage.setItem(STORAGE_KEYS.PENDING_DELETES, JSON.stringify(pending));
  }
};

const clearPendingDeletes = () => {
  localStorage.removeItem(STORAGE_KEYS.PENDING_DELETES);
};

const getPendingSyncQueue = (): PendingSyncOp[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_SYNC) || '[]');
  } catch {
    return [];
  }
};

const setPendingSyncQueue = (queue: PendingSyncOp[]) => {
  localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(queue));
};

// --- Utility Functions ---
const uuid = () => crypto.randomUUID();

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` : '66 133 244';
};

const formatDuration = (seconds: number) => {
  if (isNaN(seconds) || seconds < 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getDayKey = (dateInput: string | Date) => {
  const date = new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateToInputString = (dateInput: string | Date | null) => {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const offset = date.getTimezoneOffset() * 60000;
  return (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
};

// --- Icons (Inline SVG) ---
const Icon = ({ path, className, size = 24, ...props }: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
    {path}
  </svg>
);

const Icons = {
  Square: (p: any) => <Icon path={<rect width="18" height="18" x="3" y="3" rx="2" />} {...p} />,
  BarChart2: (p: any) => <Icon path={<><line x1="18" x2="18" y1="20" y2="10" /><line x1="12" x2="12" y1="20" y2="4" /><line x1="6" x2="6" y1="20" y2="14" /></>} {...p} />,
  Clock: (p: any) => <Icon path={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>} {...p} />,
  Settings: (p: any) => <Icon path={<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>} {...p} />,
  History: (p: any) => <Icon path={<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>} {...p} />,
  Edit2: (p: any) => <Icon path={<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />} {...p} />,
  Trash2: (p: any) => <Icon path={<><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>} {...p} />,
  Save: (p: any) => <Icon path={<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />} {...p} />,
  X: (p: any) => <Icon path={<path d="M18 6 6 18M6 6l12 12" />} {...p} />,
  Plus: (p: any) => <Icon path={<path d="M5 12h14M12 5v14" />} {...p} />,
  LayoutGrid: (p: any) => <Icon path={<><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>} {...p} />,
  CheckCircle2: (p: any) => <Icon path={<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>} {...p} />,
  User: (p: any) => <Icon path={<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>} {...p} />,
  Activity: (p: any) => <Icon path={<path d="M22 12h-4l-3 9L9 3l-3 9H2" />} {...p} />,
  Filter: (p: any) => <Icon path={<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />} {...p} />,
  ChevronDown: (p: any) => <Icon path={<path d="m6 9 6 6 6-6" />} {...p} />,
  Check: (p: any) => <Icon path={<path d="M20 6 9 17l-5-5" />} {...p} />,
  Calendar: (p: any) => <Icon path={<><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></>} {...p} />,
  Grid: (p: any) => <Icon path={<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></>} {...p} />,
  List: (p: any) => <Icon path={<><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></>} {...p} />,
  Moon: (p: any) => <Icon path={<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />} {...p} />,
  Sun: (p: any) => <Icon path={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>} {...p} />,
  Download: (p: any) => <Icon path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></>} {...p} />,
  Upload: (p: any) => <Icon path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></>} {...p} />,
  TrendingUp: (p: any) => <Icon path={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>} {...p} />,
  FileText: (p: any) => <Icon path={<><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></>} {...p} />,
  PlusCircle: (p: any) => <Icon path={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="16" /><line x1="8" x2="16" y1="12" y2="12" /></>} {...p} />,
  Hash: (p: any) => <Icon path={<><line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" /><line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" /></>} {...p} />,
  Zap: (p: any) => <Icon path={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />} {...p} />,
  Coffee: (p: any) => <Icon path={<><path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><line x1="6" x2="6" y1="2" y2="4" /><line x1="10" x2="10" y1="2" y2="4" /><line x1="14" x2="14" y1="2" y2="4" /></>} {...p} />,
  Maximize: (p: any) => <Icon path={<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>} {...p} />,
  Loader2: (p: any) => <Icon path={<path d="M21 12a9 9 0 1 1-6.219-8.56" />} className={`${p.className || ''} animate-spin`} {...p} />,
  Cloud: (p: any) => <Icon path={<path d="M17.5 19c0-3.037-2.463-5.5-5.5-5.5S6.5 15.963 6.5 19H5c-1.105 0-2 .895-2 2s.895 2 2 2h14c1.105 0 2-.895 2-2s-.895-2-2-2h-1.5z" />} {...p} />,
  CloudOff: (p: any) => <Icon path={<><path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" /><line x1="1" x2="23" y1="1" y2="23" /></>} {...p} />,
  LogOut: (p: any) => <Icon path={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></>} {...p} />,
  Github: (p: any) => <svg viewBox="0 0 24 24" width={p.size || 24} height={p.size || 24} className={p.className} fill="currentColor" {...p}><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>,
  Google: (p: any) => <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" className={p.className} {...p}><path fill="#EA4335" d="M24 12.276c0-.85-.076-1.668-.217-2.456H12v4.646h6.73c-.29 1.543-1.108 2.85-2.358 3.687l3.81 2.956c2.23-2.054 3.518-5.078 3.518-8.833z" /><path fill="#34A853" d="M12 24c3.24 0 5.958-1.074 7.942-2.906l-3.81-2.956c-1.075.72-2.45 1.146-4.132 1.146-3.125 0-5.772-2.11-6.72-4.952H1.363v3.116C3.388 21.432 7.42 24 12 24z" /><path fill="#FBBC05" d="M5.28 14.288c-.244-.73-.383-1.516-.383-2.32 0-.803.14-1.59.383-2.318V6.533H1.363C.493 8.27 0 10.076 0 12c0 1.924.492 3.73 1.363 5.385l3.917-3.097z" /><path fill="#4285F4" d="M12 4.774c1.763 0 3.35.607 4.595 1.795l3.447-3.447C17.955 1.22 15.236 0 12 0 7.42 0 3.388 2.568 1.363 6.534l3.917 3.097C6.228 6.883 8.875 4.774 12 4.774z" /></svg>,
  Microsoft: (p: any) => <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 23 23" className={p.className} {...p}><path fill="#f3f3f3" d="M0 0h23v23H0z" /><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>,
  Star: (p: any) => <Icon path={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />} {...p} />,
  Tag: (p: any) => <Icon path={<path d="M12 2H2v10l9.29 9.29a2.5 2.5 0 0 0 3.54 0l6.17-6.17a2.5 2.5 0 0 0 0-3.54L12 2z" />} {...p} />,
  Smile: (p: any) => <Icon path={<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" x2="9.01" y1="9" y2="9" /><line x1="15" x2="15.01" y1="9" y2="9" /></>} {...p} />,
  Scissors: (p: any) => <Icon path={<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" x2="8.12" y1="4" y2="15.88" /><line x1="14.47" x2="20" y1="14.48" y2="20" /><line x1="8.12" x2="12" y1="8.12" y2="12" /></>} {...p} />,
  UploadCloud: (p: any) => <Icon path={<><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></>} {...p} />,
  ArrowRight: (p: any) => <Icon path={<path d="M5 12h14m-7-7 7 7-7 7" />} {...p} />,
};

// --- Sub-Components (Defined BEFORE App) ---

const AuthModal = ({ onClose, onLoginSuccess }: { onClose: () => void, onLoginSuccess: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Auto-register logic: Try login -> If UserNotFound -> Try Register
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLoginSuccess();
      onClose();
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        // Attempt registration
        try {
          // Basic check to differentiate "Wrong Password" from "No User" if API allows,
          // but 'invalid-credential' is somewhat generic. 
          // However, standard flow "Auto-register" usually implies: "We create if not exists".
          // But if user exists and typed wrong password, we shouldn't create.
          // `invalid-credential` covers both "user not found" and "wrong password" in modern firebase.
          // So, we cannot easily distinguish without `fetchSignInMethodsForEmail` which is safer.

          // Safer approach: Check existence first.
          // const methods = await fetchSignInMethodsForEmail(auth, email); 
          // (This is not always enabled for security).

          // Let's rely on explicit error codes or fallback. 
          // If it was a wrong password, createUser will fail with 'email-already-in-use'.
          const userCred = await createUserWithEmailAndPassword(auth, email, password);
          if (userCred.user) {
            onLoginSuccess();
            onClose();
          }
        } catch (regErr: any) {
          if (regErr.code === 'auth/email-already-in-use') {
            setError("账号已存在，密码错误？");
          } else if (regErr.code === 'auth/weak-password') {
            setError("密码太弱，请至少使用6位字符");
          } else {
            setError(regErr.message.replace('Firebase: ', ''));
          }
        }
      } else {
        setError(err.message.replace('Firebase: ', ''));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (providerName: 'google' | 'github' | 'microsoft' | 'anonymous') => {
    setError('');
    setIsLoading(true);
    try {
      let provider;
      if (providerName === 'google') provider = new GoogleAuthProvider();
      if (providerName === 'github') provider = new GithubAuthProvider();
      if (providerName === 'microsoft') provider = new OAuthProvider('microsoft.com');

      if (providerName === 'anonymous') {
        await signInAnonymously(auth);
      } else if (provider) {
        await signInWithPopup(auth, provider);
      }
      onLoginSuccess();
      onClose();
    } catch (err: any) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        setError("此邮箱已关联其他登录方式 (如 Google)，请使用该方式登录以合并账号。");
      } else {
        setError(err.message.replace('Firebase: ', ''));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-m3-surface-container w-full max-w-[420px] p-8 rounded-[28px] shadow-elevation-2 relative">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="text-3xl font-medium tracking-tight flex items-baseline select-none">
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>b</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>e</span>
              <span className="text-[#FBBC05] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>t</span>
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>t</span>
              <span className="text-[#34A853] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>e</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>r</span>
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>F</span>
              <span className="text-[#34A853] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>l</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>y</span>
            </div>
            <h3 className="text-xl font-normal text-m3-on-surface mt-2">欢迎回来</h3>
            <p className="text-sm text-m3-on-surface-variant mt-1">登录或自动注册账号</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full border border-m3-outline-variant/40 hover:bg-m3-on-surface/5 transition-colors">
            <Icons.X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-google-red/10 text-google-red text-xs rounded-xl flex items-start gap-2">
            <span className="mt-0.5">⚠️</span> {error}
          </div>
        )}

        <div className="space-y-3 mb-6">
          <button onClick={() => handleSocialLogin('google')} className="relative w-full flex items-center justify-center gap-3 bg-white border border-m3-outline-variant hover:bg-gray-50 transition-colors p-2.5 rounded-full text-sm font-medium text-m3-on-surface">
            <div className="w-5 h-5 absolute left-4"><Icons.Google /></div>
            <span>Google 继续</span>
          </button>
          <button onClick={() => handleSocialLogin('github')} className="relative w-full flex items-center justify-center gap-3 bg-white border border-m3-outline-variant hover:bg-gray-50 transition-colors p-2.5 rounded-full text-sm font-medium text-m3-on-surface">
            <Icons.Github size={18} className="absolute left-4" />
            <span>GitHub 继续</span>
          </button>
          <button onClick={() => handleSocialLogin('microsoft')} className="relative w-full flex items-center justify-center gap-3 bg-white border border-m3-outline-variant hover:bg-gray-50 transition-colors p-2.5 rounded-full text-sm font-medium text-m3-on-surface">
            <div className="w-5 h-5 absolute left-4"><Icons.Microsoft /></div>
            <span>Microsoft 继续</span>
          </button>
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-m3-outline-variant"></div></div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider"><span className="px-2 bg-m3-surface-container text-m3-on-surface-variant">或使用邮箱</span></div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div className="group relative">
            <input
              type="email"
              placeholder=" "
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="peer w-full px-4 py-3 border border-m3-outline rounded-lg bg-m3-surface text-m3-on-surface focus:border-google-blue focus:border-2 outline-none transition-colors"
              required
            />
            <label className="absolute left-3 -top-2.5 bg-m3-surface-container px-1 text-xs text-m3-on-surface-variant transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-google-blue">
              邮箱地址
            </label>
          </div>

          <div className="group relative">
            <input
              type="password"
              placeholder=" "
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="peer w-full px-4 py-3 border border-m3-outline rounded-lg bg-m3-surface text-m3-on-surface focus:border-google-blue focus:border-2 outline-none transition-colors"
              required
              minLength={6}
            />
            <label className="absolute left-3 -top-2.5 bg-m3-surface-container px-1 text-xs text-m3-on-surface-variant transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-google-blue">
              密码
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-google-blue text-white py-2.5 rounded-full font-medium hover:shadow-elevation-1 hover:bg-google-blue/90 transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? <Icons.Loader2 size={18} className="animate-spin" /> : <Icons.ArrowRight size={18} />}
            <span>快速登录</span>
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => handleSocialLogin('anonymous')} className="text-xs text-m3-on-surface-variant hover:text-google-blue transition-colors">游客试用 →</button>
        </div>
      </div>
    </div>
  );
};
// Helper icon for button removed (moved to main Icons object)

const MultiSelectFilter = ({ options, selectedIds, onChange, label }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const toggleAll = () => {
    if (selectedIds.length === options.length) onChange([]);
    else onChange(options.map((o: any) => o.id));
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((i: string) => i !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div className="relative z-30" ref={containerRef}>
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center justify-between w-full md:w-auto gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:border-[rgba(var(--theme-rgb),0.6)] transition-colors shadow-sm dark:text-gray-200">
        <div className="flex items-center gap-2 truncate">
          <Icons.Filter size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
          <span className="truncate">{label} ({selectedIds.length})</span>
        </div>
        <Icons.ChevronDown size={14} className={`text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-full md:w-64 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-xl p-2 max-h-60 overflow-y-auto z-50">
          <button onClick={toggleAll} className="flex items-center gap-2 w-full p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
            <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedIds.length === options.length ? 'bg-[rgb(var(--theme-rgb))] border-[rgb(var(--theme-rgb))]' : 'border-gray-300 dark:border-gray-500'}`}>
              {selectedIds.length === options.length && <Icons.Check size={10} className="text-white" />}
            </div>
            全选 / 清空
          </button>
          <div className="h-px bg-gray-100 dark:bg-gray-700 my-1" />
          {options.map((opt: any) => (
            <button key={opt.id} onClick={() => toggleOne(opt.id)} className="flex items-center gap-2 w-full p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
              <div className={`w-4 h-4 border rounded flex items-center justify-center shrink-0 ${selectedIds.includes(opt.id) ? 'bg-[rgb(var(--theme-rgb))] border-[rgb(var(--theme-rgb))]' : 'border-gray-300 dark:border-gray-500'}`}>
                {selectedIds.includes(opt.id) && <Icons.Check size={10} className="text-white" />}
              </div>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
              <span className="truncate">{opt.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const TrendChart = ({ data, events, metric, darkMode, period, chartType }: any) => {
  const height = 280;
  const padding = 40;
  const pointSpacing = period === 'day' ? 12 : 28;
  const width = Math.max(360, data.length * pointSpacing + padding * 2);

  let maxY = 0;
  data.forEach((d: any) => {
    Object.values(d.values).forEach((v: any) => maxY = Math.max(maxY, v));
  });
  if (maxY === 0) maxY = 10;

  const getX = (index: number) => padding + (index / (data.length - 1 || 1)) * (width - padding * 2);
  const getY = (val: number) => height - padding - (val / maxY) * (height - padding * 2);

  const lines = events.map((ev: any) => {
    const points = data.map((d: any, i: number) => {
      const val = d.values[ev.id] || 0;
      return `${getX(i)},${getY(val)}`;
    }).join(' ');
    return { ...ev, points };
  });

  const shouldShowLabel = (d: any, i: number) => {
    if (period === 'day') {
      if (data.length <= 14) return true;
      const date = new Date(d.date);
      return date.getDay() === 1;
    }
    return true;
  };

  const formatVal = (val: number) => metric === 'duration' ? `${(val / 3600).toFixed(2)}小时` : `${Math.round(val)}`;

  const barWidth = (width - padding * 2) / Math.max(data.length, 1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto font-sans">
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = height - padding - t * (height - padding * 2);
          return (
            <g key={t}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke={darkMode ? "#374151" : "#e5e7eb"} strokeDasharray="4" />
              <text x={padding - 10} y={y + 4} textAnchor="end" fontSize="10" fill={darkMode ? "#9ca3af" : "#6b7280"}>
                {metric === 'duration' ? (maxY * t / 3600).toFixed(1) + '小时' : Math.floor(maxY * t)}
              </text>
            </g>
          );
        })}

        {chartType === 'bar' ? (
          data.map((d: any, i: number) => {
            let acc = 0;
            return events.map((ev: any) => {
              const val = d.values[ev.id] || 0;
              if (val === 0) return null;
              const x = padding + i * barWidth + 2;
              const y = getY(acc + val);
              const h = getY(acc) - y;
              acc += val;
              return (
                <rect
                  key={`${ev.id}-${i}`}
                  x={x}
                  y={y}
                  width={Math.max(2, barWidth - 4)}
                  height={h}
                  rx={2}
                  fill={ev.color}
                  opacity={0.85}
                  data-tip={`${d.date} · ${ev.name}: ${formatVal(val)}`}
                />
              );
            });
          })
        ) : (
          lines.map((line: any) => (
            <polyline key={line.id} points={line.points} fill="none" stroke={line.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 hover:opacity-100 hover:stroke-[3px] transition-all" />
          ))
        )}

        {chartType === 'line' &&
          events.map((ev: any) =>
            data.map((d: any, i: number) => {
              const val = d.values[ev.id] || 0;
              if (val === 0) return null;
              return (
                <circle
                  key={`${ev.id}-pt-${i}`}
                  cx={getX(i)}
                  cy={getY(val)}
                  r={3}
                  fill={ev.color}
                  opacity={0.8}
                  data-tip={`${d.date} · ${ev.name}: ${formatVal(val)}`}
                />
              );
            })
          )}

        {data.map((d: any, i: number) => {
          if (!shouldShowLabel(d, i)) return null;
          const label = period === 'month' ? d.date : d.date.slice(5);
          return (
            <text key={i} x={getX(i)} y={height - 10} textAnchor="middle" fontSize="10" fill={darkMode ? "#9ca3af" : "#6b7280"}>
              {label}
            </text>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center px-2">
        {lines.map((l: any) => (
          <div key={l.id} className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">{l.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DailyTimelineSpectrum = ({ sessions, compareSessions, color, mode = '1d', palette = 'mono', showComparison = false }: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compareRef = useRef<HTMLCanvasElement>(null);
  const baseDataRef = useRef<{ type: '1d' | '2d'; minuteCounts?: Int32Array; grid?: Int32Array[] } | null>(null);
  const compareDataRef = useRef<{ type: '1d' | '2d'; minuteCounts?: Int32Array; grid?: Int32Array[] } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const getThermalColor = (t: number) => {
    const clamped = Math.max(0, Math.min(1, t));
    const hue = 220 - clamped * 220; // blue -> red
    return `hsl(${hue}, 90%, 50%)`;
  };

  const buildMinuteCounts = (data: any[]) => {
    const minuteCounts = new Int32Array(1440);
    data.forEach((s: any) => {
      if (!s.startTime) return;
      const start = new Date(s.startTime);
      const end = s.endTime ? new Date(s.endTime) : new Date();
      if (end.getTime() - start.getTime() > 86400000) return;

      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = end.getHours() * 60 + end.getMinutes();

      if (startMin <= endMin) {
        for (let i = startMin; i <= endMin; i++) minuteCounts[i]++;
      } else {
        for (let i = startMin; i < 1440; i++) minuteCounts[i]++;
        for (let i = 0; i <= endMin; i++) minuteCounts[i]++;
      }
    });
    return minuteCounts;
  };

  const buildHeatGrid = (data: any[]) => {
    const grid = Array.from({ length: 7 }, () => new Int32Array(1440));
    data.forEach((s: any) => {
      if (!s.startTime) return;
      const start = new Date(s.startTime);
      const end = s.endTime ? new Date(s.endTime) : new Date();
      if (end.getTime() - start.getTime() > 86400000) return;

      const temp = new Date(start);
      while (temp <= end) {
        const day = temp.getDay();
        const minute = temp.getHours() * 60 + temp.getMinutes();
        grid[day][minute] += 1;
        temp.setMinutes(temp.getMinutes() + 1);
      }
    });
    return grid;
  };

  const render1D = (data: any[], canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);

    const minuteCounts = buildMinuteCounts(data);
    let maxOverlap = 0;
    for (let i = 0; i < 1440; i++) maxOverlap = Math.max(maxOverlap, minuteCounts[i]);
    if (maxOverlap === 0) maxOverlap = 1;

    const activeCounts = Array.from(minuteCounts).filter(c => c > 0).sort((a, b) => a - b);
    const countToAlpha = new Map<number, number>();
    if (activeCounts.length > 0) {
      const uniqueCounts = [...new Set(activeCounts)];
      uniqueCounts.forEach(val => {
        const rank = activeCounts.lastIndexOf(val) + 1;
        const percentile = rank / activeCounts.length;
        countToAlpha.set(val, 0.3 + (percentile * 0.7));
      });
    }

    const sliceWidth = width / 1440;
    for (let i = 0; i < 1440; i++) {
      const count = minuteCounts[i];
      if (count === 0) continue;
      const alpha = countToAlpha.get(count) || (count / maxOverlap);
      if (palette === 'thermal') {
        ctx.fillStyle = getThermalColor(alpha);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
      }
      ctx.fillRect(i * sliceWidth, 0, Math.ceil(sliceWidth), height);
    }

    return { type: '1d' as const, minuteCounts };
  };

  const render2D = (data: any[], canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);

    const grid = buildHeatGrid(data);
    let maxCount = 0;
    grid.forEach(row => row.forEach(v => { maxCount = Math.max(maxCount, v); }));
    if (maxCount === 0) maxCount = 1;

    const cellW = width / 1440;
    const cellH = height / 7;
    for (let d = 0; d < 7; d++) {
      for (let m = 0; m < 1440; m++) {
        const val = grid[d][m];
        if (val === 0) continue;
        const t = val / maxCount;
        if (palette === 'thermal') {
          ctx.fillStyle = getThermalColor(t);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.2 + t * 0.8;
        }
        ctx.fillRect(m * cellW, d * cellH, cellW, cellH);
      }
    }

    return { type: '2d' as const, grid };
  };

  useEffect(() => {
    if (mode === '2d') baseDataRef.current = render2D(sessions, canvasRef.current) || null;
    else baseDataRef.current = render1D(sessions, canvasRef.current) || null;
  }, [sessions, color, mode, palette]);

  useEffect(() => {
    if (!showComparison || !compareSessions) return;
    if (mode === '2d') compareDataRef.current = render2D(compareSessions, compareRef.current) || null;
    else compareDataRef.current = render1D(compareSessions, compareRef.current) || null;
  }, [compareSessions, color, mode, palette, showComparison]);

  const findRange = (arr: Int32Array, idx: number) => {
    const value = arr[idx] || 0;
    let start = idx;
    let end = idx;
    while (start - 1 >= 0 && arr[start - 1] === value) start--;
    while (end + 1 < arr.length && arr[end + 1] === value) end++;
    return { start, end, value };
  };

  const minuteToLabel = (minute: number) => {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const handlePointer = (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>, dataset: typeof baseDataRef, container: HTMLDivElement | null) => {
    if (!container || !dataset.current) return;
    const rect = container.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0]?.clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0]?.clientY : event.clientY;
    if (clientX === undefined || clientY === undefined) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (dataset.current.type === '1d' && dataset.current.minuteCounts) {
      const idx = Math.min(1439, Math.max(0, Math.floor((x / rect.width) * 1440)));
      const segment = findRange(dataset.current.minuteCounts, idx);
      const count = segment.value;
      const startLabel = minuteToLabel(segment.start);
      const endLabel = minuteToLabel(segment.end + 1);
      const duration = segment.end - segment.start + 1;
      setTooltip({
        x: x + 8,
        y: y + 8,
        text: `${startLabel} - ${endLabel} · ${count} 次 · ${duration} 分钟`
      });
      return;
    }
    if (dataset.current.type === '2d' && dataset.current.grid) {
      const col = Math.min(1439, Math.max(0, Math.floor((x / rect.width) * 1440)));
      const row = Math.min(6, Math.max(0, Math.floor((y / rect.height) * 7)));
      const rowData = dataset.current.grid[row];
      if (!rowData) return;
      const segment = findRange(rowData, col);
      const count = segment.value;
      const startLabel = minuteToLabel(segment.start);
      const endLabel = minuteToLabel(segment.end + 1);
      const duration = segment.end - segment.start + 1;
      const dayLabel = row === 0 ? 7 : row; // 1-7 display
      setTooltip({
        x: x + 8,
        y: y + 8,
        text: `星期${dayLabel} ${startLabel} - ${endLabel} · ${count} 次 · ${duration} 分钟`
      });
    }
  };

  const clearTooltip = () => setTooltip(null);

  return (
    <div className="mt-6 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm relative">
      <h3 className="font-bold text-gray-700 dark:text-gray-200 text-sm mb-4 flex items-center gap-2">
        <Icons.Clock size={16} /> 24小时光谱分布 (时段覆盖)
      </h3>

      <div className="space-y-4">
        <div>
          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">本周期</div>
          {mode === '2d' ? (
            <div
              className="relative w-full bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden"
              onMouseMove={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onMouseLeave={clearTooltip}
              onClick={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onTouchMove={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onTouchEnd={clearTooltip}
            >
              <canvas ref={canvasRef} width={480} height={140} className="w-full h-40 block" />
              <div className="absolute bottom-0 left-0 w-full flex justify-between px-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none mix-blend-multiply dark:mix-blend-screen">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
              </div>
              <div className="absolute left-1 top-2 bottom-2 flex flex-col justify-between text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none">
                {[1, 2, 3, 4, 5, 6, 7].map(n => <span key={n}>{n}</span>)}
              </div>
            </div>
          ) : (
            <div
              className="relative h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden"
              onMouseMove={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onMouseLeave={clearTooltip}
              onClick={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onTouchMove={(e) => handlePointer(e, baseDataRef, e.currentTarget)}
              onTouchEnd={clearTooltip}
            >
              <canvas ref={canvasRef} width={1440} height={60} className="w-full h-full block" />
              <div className="absolute bottom-0 left-0 w-full flex justify-between px-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none mix-blend-multiply dark:mix-blend-screen">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
              </div>
            </div>
          )}
        </div>

        {showComparison && compareSessions && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">上周期</div>
            {mode === '2d' ? (
              <div
                className="relative w-full bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden"
                onMouseMove={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onMouseLeave={clearTooltip}
                onClick={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onTouchMove={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onTouchEnd={clearTooltip}
              >
                <canvas ref={compareRef} width={480} height={140} className="w-full h-40 block" />
                <div className="absolute bottom-0 left-0 w-full flex justify-between px-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none mix-blend-multiply dark:mix-blend-screen">
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
                <div className="absolute left-1 top-2 bottom-2 flex flex-col justify-between text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none">
                  {[1, 2, 3, 4, 5, 6, 7].map(n => <span key={n}>{n}</span>)}
                </div>
              </div>
            ) : (
              <div
                className="relative h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden"
                onMouseMove={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onMouseLeave={clearTooltip}
                onClick={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onTouchMove={(e) => handlePointer(e, compareDataRef, e.currentTarget)}
                onTouchEnd={clearTooltip}
              >
                <canvas ref={compareRef} width={1440} height={60} className="w-full h-full block" />
                <div className="absolute bottom-0 left-0 w-full flex justify-between px-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none mix-blend-multiply dark:mix-blend-screen">
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none px-2 py-1 text-xs rounded-lg bg-gray-900/90 text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

const HeatmapCalendar = ({ dataMap, color, title, unit, weekStart = 1, darkMode }: any) => {
  const [viewMode, setViewMode] = useState<'git' | 'year' | 'calendar'>('git');

  // Quantile-based coloring logic (Dynamic thresholds)
  const values = Array.from(dataMap.values() as Iterable<number>).filter(v => v > 0).sort((a, b) => a - b);
  let q1 = 0, q2 = 0, q3 = 0;

  if (values.length > 0) {
    q1 = values[Math.ceil(values.length * 0.25) - 1];
    q2 = values[Math.ceil(values.length * 0.50) - 1];
    q3 = values[Math.ceil(values.length * 0.75) - 1];
  }

  const getIntensity = (val: number) => {
    if (val === 0) return { opacity: 1, color: darkMode ? '#374151' : '#e5e7eb' };

    // 4 Levels based on quantiles
    if (val <= q1) return { opacity: 0.4, color };      // 0-25%
    if (val <= q2) return { opacity: 0.6, color };      // 25-50%
    if (val <= q3) return { opacity: 0.8, color };      // 50-75%
    return { opacity: 1, color };                       // Top 25%
  };

  const renderGitView = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = new Date(today); startDate.setDate(today.getDate() - 364);
    const diff = (startDate.getDay() - weekStart + 7) % 7;
    startDate.setDate(startDate.getDate() - diff);

    const weeks = [];
    let currentWeek: any[] = [];
    const iterDate = new Date(startDate);
    const endDate = new Date(today);
    const endDiff = (endDate.getDay() - weekStart + 7) % 7;
    endDate.setDate(endDate.getDate() + (6 - endDiff));

    while (iterDate <= endDate) {
      const key = getDayKey(iterDate);
      const val = dataMap.get(key) || 0;
      currentWeek.push({ date: new Date(iterDate), key, val });
      if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
      iterDate.setDate(iterDate.getDate() + 1);
    }

    return (
      <div className="w-full overflow-x-auto pb-2 scrollbar-hide">
        <div className="flex gap-[2px] min-w-max">
          {weeks.map((week, wIdx) => (
            <div key={wIdx} className="flex flex-col gap-[2px]">
              {week.map((day) => {
                const { opacity, color: bg } = getIntensity(day.val);
                return <div key={day.key} title={`${day.date.toLocaleDateString()}: ${Math.floor(day.val)} ${unit}`} className="w-3 h-3 rounded-[1px]" style={{ backgroundColor: bg, opacity: bg.startsWith('#') && bg !== color ? 1 : opacity }} />;
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderYearView = () => {
    const year = new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => i);
    return (
      <div className="space-y-1 overflow-x-auto pb-2">
        {months.map(month => {
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
          return (
            <div key={month} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 w-8 font-mono text-right shrink-0">{MONTH_NAMES[month]}</span>
              <div className="flex gap-[2px]">
                {days.map(day => {
                  const date = new Date(year, month, day);
                  const key = getDayKey(date);
                  const val = dataMap.get(key) || 0;
                  const { opacity, color: bg } = getIntensity(val);
                  return <div key={key} title={`${date.toLocaleDateString()}: ${Math.floor(val)} ${unit}`} className="w-3 h-3 rounded-[1px] shrink-0" style={{ backgroundColor: bg, opacity: bg.startsWith('#') && bg !== color ? 1 : opacity }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCalendarView = () => {
    const year = new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => i);
    const weekDays = weekStart === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'];

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {months.map(month => {
          const firstDay = new Date(year, month, 1);
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          let pad = (firstDay.getDay() - weekStart + 7) % 7;
          const blanks = Array(pad).fill(null);
          const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

          return (
            <div key={month} className="border border-gray-100 dark:border-gray-700 rounded-lg p-2 bg-gray-50/30 dark:bg-gray-800/30">
              <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1.5 text-center">{MONTH_NAMES[month]}</div>
              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {weekDays.map(d => <div key={d} className="text-[6px] text-gray-300 dark:text-gray-600 text-center scale-75">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {blanks.map((_, i) => <div key={`blank-${i}`} className="w-full aspect-square" />)}
                {days.map(day => {
                  const date = new Date(year, month, day);
                  const key = getDayKey(date);
                  const val = dataMap.get(key) || 0;
                  const { opacity, color: bg } = getIntensity(val);
                  return (
                    <div
                      key={key}
                      title={`${date.toLocaleDateString()}: ${Math.floor(val)} ${unit}`}
                      className="w-full aspect-square rounded-[1px]"
                      style={{ backgroundColor: bg, opacity: bg.startsWith('#') && bg !== color ? 1 : opacity }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full" style={{ backgroundColor: color }} />
          <h4 className="font-bold text-gray-700 dark:text-gray-200 text-sm">{title}</h4>
        </div>
        <div className="flex bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
          <button onClick={() => setViewMode('git')} className={`p-1.5 rounded-md ${viewMode === 'git' ? 'bg-white dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.8)]' : 'text-gray-400'}`}><Icons.Grid size={14} /></button>
          <button onClick={() => setViewMode('year')} className={`p-1.5 rounded-md ${viewMode === 'year' ? 'bg-white dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.8)]' : 'text-gray-400'}`}><Icons.List size={14} /></button>
          <button onClick={() => setViewMode('calendar')} className={`p-1.5 rounded-md ${viewMode === 'calendar' ? 'bg-white dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.8)]' : 'text-gray-400'}`}><Icons.Calendar size={14} /></button>
        </div>
      </div>
      {viewMode === 'git' && renderGitView()}
      {viewMode === 'year' && renderYearView()}
      {viewMode === 'calendar' && renderCalendarView()}
    </div>
  );
};

const StarRating = ({ value, onChange, readOnly = false }: any) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => !readOnly && onChange(star)}
          className={`transition-all ${readOnly ? 'cursor-default' : 'hover:scale-110 cursor-pointer'}`}
          disabled={readOnly}
        >
          <Icons.Star size={readOnly ? 14 : 24} className={star <= (value || 0) ? "fill-yellow-400 text-yellow-400" : "text-gray-300 dark:text-gray-600"} />
        </button>
      ))}
    </div>
  );
};

const WeeklyRadarChart = ({ sessions, color, darkMode }: any) => {
  const size = 200;
  const center = size / 2;
  const radius = 60;

  // Filter out recent incomplete week data to ensure fairness
  // Logic: Exclude data after the last Sunday.
  const now = new Date();
  const currentWeekStart = new Date(now);
  const day = currentWeekStart.getDay() || 7; // 1-7 (Mon-Sun)
  if (day !== 1) currentWeekStart.setHours(-24 * (day - 1)); // Back to Monday
  else currentWeekStart.setHours(0, 0, 0, 0);

  // Actually simpler: Just define "Complete Weeks" as anything before "This Monday 00:00"
  // Assuming weekStart is Monday.

  const validSessions = sessions.filter((s: Session) => s.endTime && new Date(s.endTime) < currentWeekStart);

  const daySums = new Float32Array(7); // 0=Sun, 1=Mon...
  validSessions.forEach((s: Session) => {
    if (!s.endTime) return;
    const d = new Date(s.endTime).getDay();
    const dur = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000;
    daySums[d] += dur;
  });

  // Reorder to Mon-Sun (0=Mon, ... 6=Sun)
  // daySums: 0=Sun, 1=Mon...
  const orderedData = [1, 2, 3, 4, 5, 6, 0].map(d => daySums[d]);
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  const maxVal = Math.max(...orderedData, 1);

  const getPoint = (idx: number, val: number) => {
    const angle = (Math.PI * 2 * idx) / 7 - Math.PI / 2;
    const r = (val / maxVal) * radius;
    return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
  };

  const polygonPoints = orderedData.map((val, i) => getPoint(i, val)).join(' ');
  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="text-xs font-bold text-gray-400 uppercase mb-2">周分布（完整周）</div>
      {validSessions.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">数据不足一周</div>
      ) : (
        <svg width={size} height={size} className="overflow-visible">
          {gridLevels.map(level => {
            const points = Array.from({ length: 7 }).map((_, i) => {
              const angle = (Math.PI * 2 * i) / 7 - Math.PI / 2;
              const r = radius * level;
              return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            }).join(' ');
            return <polygon key={level} points={points} fill="none" stroke={darkMode ? "#374151" : "#e5e7eb"} strokeWidth="1" />;
          })}
          {Array.from({ length: 7 }).map((_, i) => {
            const angle = (Math.PI * 2 * i) / 7 - Math.PI / 2;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            const lx = center + (radius + 20) * Math.cos(angle);
            const ly = center + (radius + 20) * Math.sin(angle);
            return (
              <g key={i}>
                <line x1={center} y1={center} x2={x} y2={y} stroke={darkMode ? "#374151" : "#e5e7eb"} strokeWidth="1" />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={darkMode ? "#9ca3af" : "#6b7280"}>{labels[i]}</text>
              </g>
            );
          })}
          <polygon points={polygonPoints} fill={color} fillOpacity="0.4" stroke={color} strokeWidth="2" />
          {orderedData.map((val, i) => {
            const [rx, ry] = getPoint(i, val).split(',').map(Number);
            return (
              <circle key={i} cx={rx} cy={ry} r="3" fill={color} data-tip={`${labels[i]} · ${(val / 3600).toFixed(2)}小时`} />
            );
          })}
        </svg>
      )}
    </div>
  );
};

const ClockRadarChart = ({ sessions, darkMode }: any) => {
  const size = 220;
  const center = size / 2;
  const radius = 70;
  const dayColors = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6'];
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  if (!sessions || sessions.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">暂无数据</div>;
  }

  const startTimes = sessions.map((s: Session) => new Date(s.startTime).getTime()).filter((v: number) => !isNaN(v));
  const endTimes = sessions.map((s: Session) => s.endTime ? new Date(s.endTime).getTime() : NaN).filter((v: number) => !isNaN(v));
  if (startTimes.length === 0 || endTimes.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">数据不足</div>;
  }

  const rangeStart = new Date(Math.min(...startTimes));
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(Math.max(...endTimes));
  rangeEnd.setHours(0, 0, 0, 0);

  const dayCounts = new Float32Array(7);
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const dayIndex = (d.getDay() + 6) % 7; // 0=Mon
    dayCounts[dayIndex] += 1;
  }

  const durationSums = new Float32Array(7);
  sessions.forEach((s: Session) => {
    if (!s.endTime) return;
    const end = new Date(s.endTime);
    const dayIndex = (end.getDay() + 6) % 7; // 0=Mon
    const duration = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000;
    if (!isNaN(duration) && duration >= 0) durationSums[dayIndex] += duration;
  });

  const avgHours = Array.from(durationSums).map((sum, i) => (dayCounts[i] ? sum / dayCounts[i] / 3600 : 0));
  const maxVal = Math.max(...avgHours, 1e-6);

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const hourMarks = [0, 3, 6, 9];

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="text-xs font-bold text-gray-400 uppercase mb-2">星期平均时长（完整区间）</div>
      <svg width={size} height={size} className="overflow-visible">
        {gridLevels.map(level => (
          <circle key={level} cx={center} cy={center} r={radius * level} fill="none" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeWidth="1" />
        ))}
        {hourMarks.map((h, idx) => {
          const angle = (Math.PI * 2 * h) / 12 - Math.PI / 2;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          const lx = center + Math.cos(angle) * (radius + 16);
          const ly = center + Math.sin(angle) * (radius + 16);
          return (
            <g key={idx}>
              <line x1={center} y1={center} x2={x} y2={y} stroke={darkMode ? '#374151' : '#e5e7eb'} strokeWidth="1" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={darkMode ? '#9ca3af' : '#6b7280'}>{h === 0 ? 12 : h}</text>
            </g>
          );
        })}
        {avgHours.map((val, i) => {
          const angle = (Math.PI * 2 * i) / 7 - Math.PI / 2;
          const r = (val / maxVal) * radius;
          const x = center + Math.cos(angle) * r;
          const y = center + Math.sin(angle) * r;
          return (
            <g key={i}>
              <line x1={center} y1={center} x2={x} y2={y} stroke={dayColors[i]} strokeWidth="3" opacity="0.9" />
              <circle cx={x} cy={y} r="4" fill={dayColors[i]} data-tip={`${labels[i]} · ${(val).toFixed(2)}小时`} />
              <text x={center + Math.cos(angle) * (radius + 24)} y={center + Math.sin(angle) * (radius + 24)} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={dayColors[i]}>
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const GrowthIndicator = ({ current, previous, inverse = false }: any) => {
  if (previous === 0) return <span className="text-gray-300 text-xs text-center">-</span>;
  const growth = (current - previous) / previous;
  const isGood = inverse ? growth < 0 : growth > 0;
  const colorClass = isGood ? 'text-green-500' : 'text-red-500';

  return (
    <div className={`flex items-center gap-0.5 text-xs font-bold ${colorClass}`}>
      <span className={growth < 0 ? "rotate-180 transform inline-block" : ""}>↑</span>
      <span>{Math.abs(growth * 100).toFixed(0)}%</span>
    </div>
  );
};

const GoalRing = ({ goal, current, color, timeProgress }: any) => {
  const r1 = 18, r2 = 24;
  const c1 = 2 * Math.PI * r1, c2 = 2 * Math.PI * r2;
  const isNegative = goal.type === 'negative';

  let status: 'progress' | 'success' | 'fail' = 'progress';

  // Logic: 
  // Positive: Success if current >= target. 
  // Negative: Fail if current > target. Success if we survived the period (timeProgress >= 1 and current <= target).

  if (isNegative) {
    if (current > goal.targetValue) status = 'fail';
    else if (timeProgress >= 1) status = 'success';
  } else {
    // Positive
    if (current >= goal.targetValue) status = 'success';
    else if (timeProgress >= 1) status = 'fail'; // Period end and didn't reach target
  }

  // Early return for status icons (overrides rings)
  if (status === 'success') return <div className="absolute top-2 right-2 text-green-500 bg-white dark:bg-[#2c3038] rounded-full p-1 shadow-sm"><Icons.CheckCircle2 size={24} className="fill-green-100 dark:fill-green-900" /></div>;
  if (status === 'fail') return <div className="absolute top-2 right-2 text-red-500 bg-white dark:bg-[#2c3038] rounded-full p-1 shadow-sm"><Icons.X size={24} /></div>;

  // Progress Calculation
  let prog1 = 0, prog2 = 0;

  if (isNegative) {
    // Decaying Ring (Starts full, empties as current approaches target)
    // If current is 0, ring is 100%. If current is target, ring is 0%.
    // Formula: max(0, (target - current) / target)
    prog1 = Math.max(0, (goal.targetValue - current) / (goal.targetValue || 1));

    // Time Ring (Decaying? standard is usually increasing time. User asked "negative rings are decaying")
    // Let's interpret "decaying" for time as "Time Remaining". Starts 100%, ends 0%.
    prog2 = Math.max(0, 1 - timeProgress);
  } else {
    // Growing Ring (Positive)
    prog1 = Math.min(current / (goal.targetValue || 1), 1);
    prog2 = timeProgress; // Time always moves forward 0->1? Or matches the style? Standard is growing 0->1.
  }

  const off1 = c1 * (1 - prog1);
  const off2 = c2 * (1 - prog2);

  return (
    <div className="absolute top-2 right-2 w-14 h-14 opacity-80">
      <svg className="w-full h-full -rotate-90">
        <circle cx="28" cy="28" r={r2} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-200 dark:text-gray-700 opacity-30" />
        <circle cx="28" cy="28" r={r2} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-400 dark:text-gray-500" strokeDasharray={c2} strokeDashoffset={off2} strokeLinecap="round" />

        <circle cx="28" cy="28" r={r1} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-200 dark:text-gray-700 opacity-30" />
        <circle cx="28" cy="28" r={r1} stroke={color} strokeWidth="3" fill="none" strokeDasharray={c1} strokeDashoffset={off1} strokeLinecap="round" />
      </svg>
    </div>
  );
};

const EditEventModal = ({ eventType, onClose, onSave, onDelete }: any) => {
  const [name, setName] = useState(eventType.name);
  const [color, setColor] = useState(eventType.color);
  const [goal, setGoal] = useState<Goal | null>(eventType.goal || null);
  const [tags, setTags] = useState<string[]>(eventType.tags || []);
  const [newTag, setNewTag] = useState('');

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  // Material 3 Style Input
  const M3Input = ({ label, value, onChange, type = "text" }: any) => (
    <div className="relative group">
      <input
        type={type}
        value={value}
        onChange={onChange}
        className="peer w-full bg-gray-50 dark:bg-[#2c3038] border-b-2 border-gray-300 dark:border-gray-600 focus:border-[rgb(var(--theme-rgb))] dark:focus:border-[rgba(var(--theme-rgb),0.8)] outline-none pt-6 pb-2 px-4 rounded-t-lg transition-colors text-gray-900 dark:text-gray-100 placeholder-transparent"
        placeholder={label}
        id={label}
      />
      <label htmlFor={label} className="absolute left-4 top-2 text-xs text-gray-500 dark:text-gray-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:text-xs peer-focus:text-[rgb(var(--theme-rgb))] dark:peer-focus:text-[rgba(var(--theme-rgb),0.8)] font-medium cursor-text">
        {label}
      </label>
    </div>
  );

  const isNew = eventType.id === 'new';

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-m3-surface-container dark:bg-[#1e2025] rounded-[28px] p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-normal text-gray-900 dark:text-gray-100">{isNew ? '创建新事件' : '编辑事件'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-[#2c3038] rounded-full text-gray-600 dark:text-gray-300 transition-colors"><Icons.X size={24} /></button>
        </div>

        <div className="space-y-8">
          {/* Name Input */}
          <M3Input label="事件名称" value={name} onChange={(e: any) => setName(e.target.value)} />

          {/* Color Selection (Below input, more space) */}
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 block px-2">选择标记颜色</label>
            <div className="grid grid-cols-6 gap-3 px-1">
              {DEFAULT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Icons.Check size={16} className="text-white drop-shadow-md" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          {/* Tags Selection */}
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 block px-2">标签管理</label>
            <div className="flex flex-wrap gap-2 px-1 mb-2">
              {tags.map(t => (
                <span key={t} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-md text-xs flex items-center gap-1">
                  <Icons.Tag size={10} /> {t}
                  <button onClick={() => setTags(tags.filter(tag => tag !== t))} className="text-gray-400 hover:text-red-500"><Icons.X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                placeholder="输入标签后回车..."
                className="flex-1 bg-transparent border-b border-gray-200 dark:border-gray-700 px-2 py-1 text-sm outline-none focus:border-[rgb(var(--theme-rgb))] text-gray-900 dark:text-gray-100"
              />
              <button onClick={handleAddTag} disabled={!newTag.trim()} className="text-[rgb(var(--theme-rgb))] text-sm font-bold disabled:opacity-50">添加</button>
            </div>
          </div>

          {/* Goal Setting Section */}
          <div className="bg-gray-50 dark:bg-[#2c3038] rounded-[20px] p-5">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-widest">目标设定</span>
              {goal ?
                <button onClick={() => setGoal(null)} className="text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded-full bg-white dark:bg-[#1e2025] border dark:border-red-900/30">移除目标</button>
                :
                <button onClick={() => setGoal({ type: 'positive', metric: 'count', period: 'week', targetValue: 5 })} className="text-xs text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.6)] hover:bg-[rgba(var(--theme-rgb),0.1)] dark:hover:bg-[rgba(var(--theme-rgb),0.2)] px-3 py-1.5 rounded-full bg-white dark:bg-[#1e2025] border border-[rgba(var(--theme-rgb),0.2)] dark:border-[rgb(var(--theme-rgb))] font-bold shadow-sm">+ 启用目标</button>
              }
            </div>

            {goal && (
              <div className="space-y-4 animate-in slide-in-from-top-2">
                {/* 1. Goal Type */}
                <div className="flex p-1 bg-white dark:bg-[#1e2025] rounded-full border border-gray-200 dark:border-gray-700">
                  <button onClick={() => setGoal({ ...goal, type: 'positive' })} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-all ${goal.type === 'positive' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 shadow-sm' : 'text-gray-500'}`}>
                    正向激励 (至少完成)
                  </button>
                  <button onClick={() => setGoal({ ...goal, type: 'negative' })} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-all ${goal.type === 'negative' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 shadow-sm' : 'text-gray-500'}`}>
                    负向约束 (至多允许)
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* 2. Frequency */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400 font-bold uppercase ml-2">周期</label>
                    <select value={goal.period} onChange={e => setGoal({ ...goal, period: e.target.value as any })} className="w-full p-3 rounded-xl bg-white dark:bg-[#1e2025] border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-[rgba(var(--theme-rgb),0.2)]">
                      <option value="week">每周</option>
                      <option value="month">每月</option>
                    </select>
                  </div>

                  {/* 3. Metric */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400 font-bold uppercase ml-2">单位</label>
                    <select value={goal.metric} onChange={e => setGoal({ ...goal, metric: e.target.value as any })} className="w-full p-3 rounded-xl bg-white dark:bg-[#1e2025] border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-[rgba(var(--theme-rgb),0.2)]">
                      <option value="count">次数</option>
                      <option value="duration">时长（秒）</option>
                    </select>
                  </div>
                </div>

                {/* 4. Value */}
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 font-bold uppercase ml-2">
                    {goal.type === 'positive' ? '目标数值 (≥)' : '限制数值 (≤)'} - {goal.metric === 'duration' ? '时长' : '次数'}
                  </label>

                  {goal.metric === 'duration' ? (
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          min="0"
                          value={Math.floor(goal.targetValue / 3600)}
                          onChange={e => {
                            const h = Number(e.target.value);
                            const m = Math.floor((goal.targetValue % 3600) / 60);
                            setGoal({ ...goal, targetValue: h * 3600 + m * 60 });
                          }}
                          className="w-full p-3 rounded-xl bg-white dark:bg-[#1e2025] border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-lg font-mono font-bold outline-none focus:ring-2 focus:ring-[rgba(var(--theme-rgb),0.2)]"
                          placeholder="0"
                        />
                        <span className="absolute right-3 top-4 text-xs text-gray-400 font-bold">小时</span>
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={Math.floor((goal.targetValue % 3600) / 60)}
                          onChange={e => {
                            const h = Math.floor(goal.targetValue / 3600);
                            const m = Number(e.target.value);
                            setGoal({ ...goal, targetValue: h * 3600 + m * 60 });
                          }}
                          className="w-full p-3 rounded-xl bg-white dark:bg-[#1e2025] border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-lg font-mono font-bold outline-none focus:ring-2 focus:ring-[rgba(var(--theme-rgb),0.2)]"
                          placeholder="0"
                        />
                        <span className="absolute right-3 top-4 text-xs text-gray-400 font-bold">分钟</span>
                      </div>
                    </div>
                  ) : (
                    <input
                      type="number"
                      min="1"
                      value={goal.targetValue}
                      onChange={e => setGoal({ ...goal, targetValue: Number(e.target.value) })}
                      className="w-full p-3 rounded-xl bg-white dark:bg-[#1e2025] border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-lg font-mono font-bold outline-none focus:ring-2 focus:ring-[rgba(var(--theme-rgb),0.2)]"
                    />
                  )}

                  <div className="text-[10px] text-gray-400 text-right px-2">
                    {goal.metric === 'duration' ? 'Tips: 设置目标持续时间' : 'Tips: 设定目标计数值'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-8 pt-6 border-t border-gray-100 dark:border-gray-700">
          {!isNew && <button onClick={() => { if (confirm('确定删除此事件及其所有记录？')) onDelete(eventType.id); }} className="px-4 py-2.5 rounded-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium text-sm flex items-center gap-2"><Icons.Trash2 size={18} /> 删除</button>}
          <div className="flex-1"></div>
          <button onClick={onClose} className="px-6 py-2.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#2c3038] rounded-full font-medium text-sm transition-colors">取消</button>
          <button onClick={() => onSave(eventType.id, name, color, goal, tags)} className="px-6 py-2.5 bg-[rgb(var(--theme-rgb))] hover:bg-[rgb(var(--theme-rgb))] text-white rounded-full font-bold text-sm shadow-md hover:shadow-lg transition-all">保存更改</button>
        </div>
      </div>
    </div>
  );
};

const SessionModal = ({ session, eventTypes, onClose, onSave, onDelete, isAddMode }: any) => {
  const [start, setStart] = useState(session?.startTime ? dateToInputString(session.startTime) : dateToInputString(new Date()));
  const [end, setEnd] = useState(session?.endTime ? dateToInputString(session.endTime) : '');
  const [eventId, setEventId] = useState(session?.eventId || (eventTypes[0]?.id || ''));
  const [note, setNote] = useState(session?.note || '');
  const [incomplete, setIncomplete] = useState(session?.incomplete || false);
  const [rating, setRating] = useState(session?.rating || 0);
  const [tags, setTags] = useState<string[]>(session?.tags || []);
  const [newTag, setNewTag] = useState('');

  const availableTags = useMemo(() => {
    const evt = eventTypes.find((e: any) => e.id === eventId);
    return evt?.tags || [];
  }, [eventTypes, eventId]);

  useEffect(() => {
    if (session?.eventId !== eventId) {
      setTags([]);
      setNewTag('');
    }
  }, [eventId, session?.eventId]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (!tags.includes(trimmed)) setTags(prev => [...prev, trimmed]);
    setNewTag('');
  };

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) setTags(prev => prev.filter(t => t !== tag));
    else setTags(prev => [...prev, tag]);
  };

  const handleSave = () => {
    if (!start) return;
    if (!eventId) return alert("请选择一个事件类型");
    const newStart = new Date(start);
    const newEnd = end ? new Date(end) : null;
    if (newEnd && newEnd < newStart) return alert("结束时间不能早于开始时间");
    onSave(session?.id, newStart.toISOString(), newEnd?.toISOString() || null, eventId, note, incomplete, rating, tags);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl border dark:border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold dark:text-white">{isAddMode ? '补录记录' : '编辑记录'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full dark:text-gray-300"><Icons.X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">事件类型</label>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 text-gray-900 dark:bg-gray-700 dark:text-gray-100">
              {eventTypes.map((et: any) => <option key={et.id} value={et.id}>{et.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">开始时间</label>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 text-gray-900 dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">结束时间</label>
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 text-gray-900 dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400" />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer">
              <input type="checkbox" checked={incomplete} onChange={e => setIncomplete(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-[rgb(var(--theme-rgb))] focus:ring-[rgb(var(--theme-rgb))]" />
              <div>
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">标记为未完成</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">计入时间投入，但不计入完成次数</span>
              </div>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">心情 / 效率</label>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center gap-3">
              <StarRating value={rating} onChange={setRating} />
              <span className="text-xs text-gray-400 font-bold ml-auto">{rating > 0 ? ['非常糟糕', '不太好', '一般', '不错', '非常棒'][rating - 1] : '待评分'}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标签</label>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700 space-y-3">
              <div className="flex flex-wrap gap-2">
                {availableTags.length === 0 && (
                  <span className="text-xs text-gray-400">暂无可选标签</span>
                )}
                {availableTags.map((tag: string) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-1 rounded-full text-xs border transition-colors ${tags.includes(tag)
                      ? 'bg-[rgba(var(--theme-rgb),0.15)] border-[rgba(var(--theme-rgb),0.4)] text-[rgb(var(--theme-rgb))]'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300'
                      }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(newTag); } }}
                  className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-[#2c3038] border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 outline-none"
                  placeholder="新增标签"
                />
                <button
                  type="button"
                  onClick={() => addTag(newTag)}
                  className="px-3 py-2 rounded-lg bg-[rgba(var(--theme-rgb),0.12)] text-[rgb(var(--theme-rgb))] text-xs font-bold"
                >
                  添加
                </button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <span key={tag} className="px-2 py-1 rounded-full text-xs bg-[rgba(var(--theme-rgb),0.12)] text-[rgb(var(--theme-rgb))]">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 text-gray-900 dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400" placeholder="记录一些心得..." />
          </div>
        </div>
        <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-50 dark:border-gray-700">
          {!isAddMode && <button onClick={() => { if (confirm('确定删除?')) onDelete(session.id); }} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"><Icons.Trash2 size={16} /> 删除</button>}
          <div className={`flex gap-3 ${isAddMode ? 'ml-auto' : ''}`}>
            <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm font-medium dark:text-gray-300">取消</button>
            <button onClick={handleSave} className="px-4 py-2 bg-[rgb(var(--theme-rgb))] hover:bg-[rgb(var(--theme-rgb))] text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm"><Icons.Save size={16} /> 保存</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const StopSessionModal = ({ onStop, onClose }: any) => {
  const [note, setNote] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [rating, setRating] = useState(0);

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm border dark:border-gray-700 shadow-xl">
        <h3 className="text-lg font-bold mb-4 dark:text-white">结束记录</h3>

        <div className="space-y-4 mb-6">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase mb-2">心情评分</div>
            <div className="flex justify-center p-4 bg-gray-50 dark:bg-gray-700 rounded-xl">
              <StarRating value={rating} onChange={setRating} />
            </div>
          </div>

          <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
            <input type="checkbox" checked={incomplete} onChange={e => setIncomplete(e.target.checked)} className="w-5 h-5 rounded text-[rgb(var(--theme-rgb))]" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">标记为未完成 (中途放弃)</span>
          </label>

          <div>
            <div className="text-xs font-bold text-gray-400 uppercase mb-2">备注</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              autoFocus
              className="w-full p-3 border rounded-xl bg-gray-50 text-gray-900 border-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400"
              rows={3}
              placeholder="写点什么..."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium">取消</button>
          <button onClick={() => onStop(note, incomplete, rating)} className="flex-1 py-2 bg-[rgb(var(--theme-rgb))] text-white rounded-xl font-bold hover:bg-[rgb(var(--theme-rgb))] shadow-md">完成</button>
        </div>
      </div>
    </div>
  );
};

const OngoingSessionCard = ({ session, eventType, onStop }: any) => {
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const update = () => {
      const start = new Date(session.startTime).getTime();
      setDuration(Math.floor((Date.now() - start) / 1000));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [session]);
  const color = eventType?.color || '#9ca3af';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between group hover:shadow-md transition-all relative overflow-hidden">
      <div className="absolute bottom-0 left-0 h-1 bg-current opacity-20 w-full animate-pulse" style={{ color }} />
      <div className="flex items-center gap-4 z-10">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm" style={{ backgroundColor: color }}><Icons.Activity size={18} /></div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white">{eventType?.name || '未知事件'}</h4>
          <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {formatDuration(duration)}
          </div>
        </div>
      </div>
      <button onClick={() => onStop(session.id)} className="p-3 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-all z-10 border border-transparent hover:border-gray-100 dark:hover:border-gray-600"><Icons.Square size={20} className="fill-current" style={{ color }} /></button>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'stats' | 'history' | 'settings'>('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingSyncQueue, setPendingSyncQueueState] = useState<PendingSyncOp[]>(() => getPendingSyncQueue());
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Data State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [settings, setSettings] = useState<UserSettings>({ themeColor: '#3b82f6', weekStart: 1, stopMode: 'quick', darkMode: false });

  // Filters & UI State
  const [statsSelectedIds, setStatsSelectedIds] = useState<string[]>([]);
  const [historySelectedIds, setHistorySelectedIds] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [filterHasNote, setFilterHasNote] = useState<'all' | 'yes' | 'no'>('all');
  const [filterIncomplete, setFilterIncomplete] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [trendMetric, setTrendMetric] = useState<'count' | 'duration'>('duration');
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [trendChartType, setTrendChartType] = useState<'line' | 'bar'>('line');
  const [spectrumRange, setSpectrumRange] = useState<'all' | '7' | '30'>('30');
  const [spectrumMode, setSpectrumMode] = useState<'1d' | '2d'>('1d');
  const [spectrumPalette, setSpectrumPalette] = useState<'mono' | 'thermal'>('mono');
  const [ridgePeriod, setRidgePeriod] = useState<'week' | 'month'>('week');
  const [burstPeriod, setBurstPeriod] = useState<'week' | 'month'>('week');
  const [singleDurationChartType, setSingleDurationChartType] = useState<'line' | 'bar'>('line');
  const [singleGapChartType, setSingleGapChartType] = useState<'line' | 'bar'>('line');
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [durationBucket, setDurationBucket] = useState<1 | 5 | 15>(5);
  const [chartTooltip, setChartTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingEventType, setEditingEventType] = useState<EventType | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [stoppingNote, setStoppingNote] = useState('');

  const themeRgb = useMemo(() => hexToRgb(settings.themeColor), [settings.themeColor]);

  const tabs = [
    { id: 'home', label: '主页', icon: Icons.LayoutGrid, color: '#4285F4' },
    { id: 'history', label: '历史', icon: Icons.History, color: '#EA4335' },
    { id: 'stats', label: '统计', icon: Icons.BarChart2, color: '#FBBC05' },
    { id: 'settings', label: '设置', icon: Icons.Settings, color: '#34A853' }
  ] as const;

  const activeTabIndex = Math.max(0, tabs.findIndex(tab => tab.id === view));
  const activeTabColor = tabs[activeTabIndex]?.color || '#4285F4';
  const isRemoteMode = Boolean(user);

  // 1. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setPendingSyncQueue(pendingSyncQueue);
  }, [pendingSyncQueue]);

  // Dark Mode Effect
  useEffect(() => {
    if (settings.darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [settings.darkMode]);

  const enqueuePending = (op: PendingSyncOp) => {
    setPendingSyncQueueState(prev => {
      const next = [...prev, op];
      return next;
    });
  };

  const removePendingBySessionId = (sessionId: string) => {
    setPendingSyncQueueState(prev => prev.filter(op => {
      if ('payload' in op && (op.type === 'sessionCreate' || op.type === 'sessionUpdate')) {
        return op.payload.id !== sessionId;
      }
      if (op.type === 'sessionDelete') return op.payload.id !== sessionId;
      return true;
    }));
  };

  const removePendingByEventId = (eventId: string) => {
    setPendingSyncQueueState(prev => prev.filter(op => {
      if ('payload' in op && (op.type === 'eventCreate' || op.type === 'eventUpdate')) {
        return op.payload.id !== eventId;
      }
      if (op.type === 'eventDelete') return op.payload.id !== eventId;
      return true;
    }));
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const attemptWrite = async (op: PendingSyncOp, action: () => Promise<void>, retries = 2) => {
    try {
      await action();
      setLastSyncError(null);
      if (op.type.startsWith('session')) removePendingBySessionId((op as any).payload?.id || '');
      if (op.type.startsWith('event')) removePendingByEventId((op as any).payload?.id || '');
      if (op.type === 'settingsUpdate') setPendingSyncQueueState(prev => prev.filter(p => p.type !== 'settingsUpdate'));
    } catch (err: any) {
      if (retries > 0) {
        await sleep(600);
        return attemptWrite(op, action, retries - 1);
      }
      enqueuePending(op);
      setLastSyncError(err?.message || '同步失败');
      setSyncNotice('同步失败，已加入待同步队列');
    }
  };

  const retryPendingSync = async () => {
    if (!user || pendingSyncQueue.length === 0) return;
    setSyncing(true);
    try {
      for (const op of pendingSyncQueue) {
        if (op.type === 'sessionCreate') {
          const s = op.payload;
          const ref = doc(db, 'users', user.uid, 'sessions', s.id);
          await attemptWrite(op, () => setDoc(ref, {
            eventId: s.eventId,
            note: s.note || '',
            incomplete: s.incomplete || false,
            rating: s.rating || 0,
            tags: s.tags || [],
            startTime: Timestamp.fromDate(new Date(s.startTime)),
            endTime: s.endTime ? Timestamp.fromDate(new Date(s.endTime)) : null
          }));
        }

        if (op.type === 'sessionUpdate') {
          const s = op.payload;
          const ref = doc(db, 'users', user.uid, 'sessions', s.id);
          await attemptWrite(op, () => updateDoc(ref, {
            eventId: s.eventId,
            note: s.note || '',
            incomplete: s.incomplete || false,
            rating: s.rating || 0,
            tags: s.tags || [],
            startTime: Timestamp.fromDate(new Date(s.startTime)),
            endTime: s.endTime ? Timestamp.fromDate(new Date(s.endTime)) : null
          }));
        }

        if (op.type === 'sessionDelete') {
          const ref = doc(db, 'users', user.uid, 'sessions', op.payload.id);
          await attemptWrite(op, () => deleteDoc(ref));
        }

        if (op.type === 'eventCreate') {
          const e = op.payload;
          const ref = doc(db, 'users', user.uid, 'event_types', e.id);
          await attemptWrite(op, () => setDoc(ref, {
            ...e,
            createdAt: Timestamp.fromDate(new Date(e.createdAt))
          }));
        }

        if (op.type === 'eventUpdate') {
          const e = op.payload;
          const ref = doc(db, 'users', user.uid, 'event_types', e.id);
          await attemptWrite(op, () => updateDoc(ref, { name: e.name, color: e.color, goal: e.goal || null, tags: e.tags || [] }));
        }

        if (op.type === 'eventDelete') {
          const ref = doc(db, 'users', user.uid, 'event_types', op.payload.id);
          await attemptWrite(op, () => deleteDoc(ref));
        }

        if (op.type === 'settingsUpdate') {
          const ref = doc(db, 'users', user.uid, 'settings', 'preferences');
          await attemptWrite(op, () => setDoc(ref, op.payload, { merge: true }));
        }
      }
    } finally {
      setSyncing(false);
    }
  };

  // 2. Data Initialization (Remote if logged in, otherwise Local)
  useEffect(() => {
    if (!user) {
      loadLocalData();
      return;
    }

    // Backfill local metadata for legacy users if server is empty
    (async () => {
      try {
        const localSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        const localEvents = localStorage.getItem(STORAGE_KEYS.EVENTS);
        const localSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);

        const [eventsSnap, sessionsSnap, settingsSnap] = await Promise.all([
          getDocs(collection(db, 'users', user.uid, 'event_types')),
          getDocs(collection(db, 'users', user.uid, 'sessions')),
          getDoc(doc(db, 'users', user.uid, 'settings', 'preferences'))
        ]);

        if (eventsSnap.empty && localEvents) {
          const parsed = JSON.parse(localEvents) as EventType[];
          const batch = writeBatch(db);
          parsed.forEach(e => {
            const ref = doc(db, 'users', user.uid, 'event_types', e.id);
            batch.set(ref, { ...e, createdAt: Timestamp.fromDate(new Date(e.createdAt)) });
          });
          await batch.commit();
        }

        if (sessionsSnap.empty && localSessions) {
          const parsed = JSON.parse(localSessions) as Session[];
          const batch = writeBatch(db);
          parsed.forEach(s => {
            const ref = doc(db, 'users', user.uid, 'sessions', s.id);
            batch.set(ref, {
              eventId: s.eventId,
              note: s.note || '',
              incomplete: s.incomplete || false,
              rating: s.rating || 0,
              tags: s.tags || [],
              startTime: Timestamp.fromDate(new Date(s.startTime)),
              endTime: s.endTime ? Timestamp.fromDate(new Date(s.endTime)) : null
            });
          });
          await batch.commit();
        }

        if (!settingsSnap.exists() && localSettings) {
          const parsed = JSON.parse(localSettings) as UserSettings;
          await setDoc(doc(db, 'users', user.uid, 'settings', 'preferences'), parsed, { merge: true });
        }
      } catch (err: any) {
        setLastSyncError(err?.message || '元数据迁移失败');
        setSyncNotice('检测到历史数据，迁移失败，请手动同步');
      }
    })();

    setLoading(true);
    const sessionsRef = collection(db, 'users', user.uid, 'sessions');
    const eventsRef = collection(db, 'users', user.uid, 'event_types');
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');

    let gotSessions = false;
    let gotEvents = false;

    const unsubscribeSessions = onSnapshot(sessionsRef, (snap) => {
      const nextSessions = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .map((s: any) => ({
          ...s,
          startTime: s.startTime?.toDate ? s.startTime.toDate().toISOString() : s.startTime,
          endTime: s.endTime?.toDate ? s.endTime.toDate().toISOString() : s.endTime
        }))
        .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      setSessions(nextSessions as Session[]);
      gotSessions = true;
      if (gotEvents) setLoading(false);
    });

    const unsubscribeEvents = onSnapshot(eventsRef, (snap) => {
      const nextEvents = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .map((e: any) => ({
          ...e,
          createdAt: e.createdAt?.toDate ? e.createdAt.toDate().toISOString() : e.createdAt
        }))
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEventTypes(nextEvents as EventType[]);
      if (statsSelectedIds.length === 0) setStatsSelectedIds(nextEvents.map((e: any) => e.id));
      if (historySelectedIds.length === 0) setHistorySelectedIds(nextEvents.map((e: any) => e.id));
      gotEvents = true;
      if (gotSessions) setLoading(false);
    });

    const unsubscribeSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as UserSettings);
      }
    });

    return () => {
      unsubscribeSessions();
      unsubscribeEvents();
      unsubscribeSettings();
    };
  }, [user]);

  // Helper: Load Local Data
  const loadLocalData = () => {
    setLoading(true);
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (storedSettings) setSettings(JSON.parse(storedSettings));

    const storedEvents = localStorage.getItem(STORAGE_KEYS.EVENTS);
    if (storedEvents) {
      const parsed = JSON.parse(storedEvents);
      // Ensure goals are loaded correctly (handling potential nulls or structure changes)
      setEventTypes(parsed);
      if (statsSelectedIds.length === 0) setStatsSelectedIds(parsed.map((e: any) => e.id));
      if (historySelectedIds.length === 0) setHistorySelectedIds(parsed.map((e: any) => e.id));
    }

    const storedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (storedSessions) setSessions(JSON.parse(storedSessions));
    setLoading(false);
  };

  // Helper: Auto-save to Local Data (Always)
  useEffect(() => {
    // Avoid overwriting with empty data during initial load blink
    if (!loading && !isRemoteMode) {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(eventTypes));
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    }
  }, [settings, eventTypes, sessions, loading, isRemoteMode]);


  // 3. New Sync Logic: Bidirectional Sync with Enhanced Merging
  const handleSync = async () => {
    if (!user) return alert("请先登录");
    setSyncing(true);
    try {
      const batch = writeBatch(db);
      const pendingDeletes = getPendingDeletes();

      // --- PHASE 0: PROCESS LOCAL DELETIONS (PUSH) ---
      // We push local deletions to the server by setting a 'deleted' flag.
      // This ensures other devices know to delete them too (Tombstone pattern).

      const sRef = collection(db, 'users', user.uid, 'sessions');
      const eRef = collection(db, 'users', user.uid, 'event_types');

      pendingDeletes.sessions.forEach(id => {
        batch.set(doc(sRef, id), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });
      });
      pendingDeletes.events.forEach(id => {
        batch.set(doc(eRef, id), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });
      });

      // --- A. SETTINGS SYNC ---
      const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
      const settingsSnap = await getDoc(settingsRef);

      // Merge Settings: Remote > Local, but if Remote is missing keys, use Local.
      let finalSettings = { ...settings };
      if (settingsSnap.exists()) {
        finalSettings = { ...finalSettings, ...settingsSnap.data() };
      }
      // Push combined settings
      batch.set(settingsRef, finalSettings, { merge: true });
      setSettings(finalSettings as UserSettings);

      // --- B. EVENTS SYNC ---
      const serverEventsSnap = await getDocs(eRef);

      // Map: ID -> Event
      const serverEventsMap = new Map();
      serverEventsSnap.forEach(doc => {
        const data = doc.data();
        // IGNORE deleted items from server (Tombstone check)
        // If server says deleted, we will NOT add it to our list.
        if (data.deleted) return;
        serverEventsMap.set(doc.id, { ...data, id: doc.id });
      });

      const localEventMap = new Map(eventTypes.map(e => [e.id, e]));
      const finalEventsMap = new Map();

      // 1. Load Server Events
      serverEventsMap.forEach((sEvent, id) => {
        // If server has it (and not deleted), it wins
        finalEventsMap.set(id, {
          ...sEvent,
          createdAt: sEvent.createdAt?.toDate ? sEvent.createdAt.toDate().toISOString() : sEvent.createdAt
        });
      });

      // 2. Push Local Events that don't exist on Server
      localEventMap.forEach((lEvent, id) => {
        // Only push if NOT already on server AND NOT in pending deletes (obviously)
        if (!finalEventsMap.has(id) && !pendingDeletes.events.includes(id)) {
          // Double check: if server explicitly has it as deleted (we filtered it out above), should we revive it?
          // Current logic: No. If server deleted it, it's gone.
          // BUT, what if this is a NEW event with same ID? (Unlikely with UUID).
          // Assume new.

          // We need to check if the ID was in the server snapshot but filtered out as deleted.
          const serverDoc = serverEventsSnap.docs.find(d => d.id === id);
          if (serverDoc && serverDoc.data().deleted) {
            // Server deleted it. Local has it. Who wins?
            // Usually deletion wins. Remove from local.
            return;
          }

          finalEventsMap.set(id, lEvent);
          // Push to server
          const ref = doc(eRef, id);
          batch.set(ref, {
            ...lEvent,
            createdAt: lEvent.createdAt ? Timestamp.fromDate(new Date(lEvent.createdAt)) : serverTimestamp()
          });
        }
      });

      // Sort to maintain order (creation time)
      const mergedEvents = Array.from(finalEventsMap.values()) as EventType[];
      mergedEvents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEventTypes(mergedEvents);


      // --- C. SESSIONS SYNC ---
      const serverSessionsSnap = await getDocs(sRef);
      const serverSessionsMap = new Map();

      serverSessionsSnap.forEach(doc => {
        const data = doc.data();
        if (data.deleted) return; // Ignore tombstones
        serverSessionsMap.set(doc.id, { ...data, id: doc.id });
      });

      const localSessionsMap = new Map(sessions.map(s => [s.id, s]));
      const finalSessionsMap = new Map();

      // 1. Process Server Sessions
      serverSessionsMap.forEach((sSession, id) => {
        finalSessionsMap.set(id, {
          ...sSession,
          startTime: sSession.startTime?.toDate ? sSession.startTime.toDate().toISOString() : sSession.startTime,
          endTime: sSession.endTime?.toDate ? sSession.endTime.toDate().toISOString() : sSession.endTime
        });
      });

      // 2. Process Local Sessions
      localSessionsMap.forEach((lSession, id) => {
        if (!finalSessionsMap.has(id)) {
          // Check if server has it marked as deleted
          const serverDoc = serverSessionsSnap.docs.find(d => d.id === id);
          if (serverDoc && serverDoc.data().deleted) {
            return; // Server deleted it, remove locally
          }

          finalSessionsMap.set(id, lSession);
          // Push to server
          const ref = doc(sRef, id);
          batch.set(ref, {
            eventId: lSession.eventId,
            note: lSession.note || '',
            incomplete: lSession.incomplete || false,
            rating: lSession.rating || 0,
            tags: lSession.tags || [],
            startTime: lSession.startTime ? Timestamp.fromDate(new Date(lSession.startTime)) : serverTimestamp(),
            endTime: lSession.endTime ? Timestamp.fromDate(new Date(lSession.endTime)) : null
          });
        }
      });

      const mergedSessions = Array.from(finalSessionsMap.values()) as Session[];
      mergedSessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      setSessions(mergedSessions);


      await batch.commit();
      clearPendingDeletes(); // Success!
      alert("同步完成！数据已与服务器合并。");
    } catch (e: any) {
      console.error(e);
      alert("同步失败: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeduplicate = () => {
    if (!confirm("确定要执行去重操作吗？\n这将基于 [开始时间] 和 [事件ID] 删除完全重复的记录，只保留一份。")) return;

    const contentSeen = new Set();
    const uniqueSessions = sessions.filter(s => {
      // Create a unique signature for the content
      const key = `${s.eventId}-${s.startTime}-${s.endTime}`;
      if (contentSeen.has(key)) return false;
      contentSeen.add(key);
      return true;
    });

    const removedCount = sessions.length - uniqueSessions.length;
    if (removedCount === 0) {
      alert("未发现重复记录。");
      return;
    }

    setSessions(uniqueSessions);
    alert(`成功删除了 ${removedCount} 条重复记录。\n请记得点击 [覆盖云端数据] 以将清理后的状态同步到服务器！`);
  };

  const handleOverwriteCloud = async () => {
    if (!user) return alert("请先登录");
    if (!confirm("⚠️ 高危操作警告 ⚠️\n\n这将【清除服务器上的所有数据】并上传您当前的本地数据。\n\n请确认：\n1. 您当前的本地数据是正确的（已去重）。\n2. 您希望彻底重置云端状态。\n\n是否继续？")) return;

    setSyncing(true);
    try {
      // 1. Delete all server data (Sessions & Events)
      // Note: Firestore requires deleting docs individually or via batch.
      const batchDelete = writeBatch(db);
      const sRef = collection(db, 'users', user.uid, 'sessions');
      const eRef = collection(db, 'users', user.uid, 'event_types');

      const [sSnaps, eSnaps] = await Promise.all([getDocs(sRef), getDocs(eRef)]);

      let opCount = 0;
      const MAX_BATCH = 400;

      const commitBatchIfFull = async (b: any) => {
        if (opCount >= MAX_BATCH) {
          await b.commit();
          opCount = 0;
          return writeBatch(db);
        }
        return b;
      };

      let currentBatch = batchDelete;

      for (const doc of sSnaps.docs) {
        currentBatch.delete(doc.ref);
        opCount++;
        currentBatch = await commitBatchIfFull(currentBatch);
      }
      for (const doc of eSnaps.docs) {
        currentBatch.delete(doc.ref);
        opCount++;
        currentBatch = await commitBatchIfFull(currentBatch);
      }

      await currentBatch.commit(); // Commit remaining deletions

      // 2. Upload Local Data
      let uploadBatch = writeBatch(db);
      opCount = 0;
      currentBatch = uploadBatch; // reset for upload

      // Upload Events
      for (const e of eventTypes) {
        const ref = doc(eRef, e.id);
        currentBatch.set(ref, {
          ...e,
          createdAt: e.createdAt ? Timestamp.fromDate(new Date(e.createdAt)) : serverTimestamp()
        });
        opCount++;
        currentBatch = await commitBatchIfFull(currentBatch);
      }

      // Upload Sessions
      for (const s of sessions) {
        const ref = doc(sRef, s.id);
        currentBatch.set(ref, {
          eventId: s.eventId,
          note: s.note || '',
          incomplete: s.incomplete || false,
          rating: s.rating || 0,
          tags: s.tags || [],
          startTime: s.startTime ? Timestamp.fromDate(new Date(s.startTime)) : serverTimestamp(),
          endTime: s.endTime ? Timestamp.fromDate(new Date(s.endTime)) : null
        });
        opCount++;
        currentBatch = await commitBatchIfFull(currentBatch);
      }

      // Upload Settings
      const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
      currentBatch.set(settingsRef, settings, { merge: true });

      await currentBatch.commit();

      alert("云端数据已成功重置为当前本地状态。");
    } catch (e: any) {
      console.error(e);
      alert("操作失败: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleClearLocalData = () => {
    if (confirm("确定要清空本地所有数据吗？这不会影响云端数据，但会清空当前视图。建议先同步。")) {
      setEventTypes([]);
      setSessions([]);
      setSettings({ themeColor: '#3b82f6', weekStart: 1, stopMode: 'quick', darkMode: false });
      localStorage.removeItem(STORAGE_KEYS.SESSIONS);
      localStorage.removeItem(STORAGE_KEYS.EVENTS);
      localStorage.removeItem(STORAGE_KEYS.SETTINGS);
      alert("本地数据已清空");
    }
  };


  // --- Actions (Local Only) ---

  const handleStart = async (eventId: string) => {
    if (activeEventIds.has(eventId)) return;
    const newSession: Session = { id: uuid(), eventId, startTime: new Date().toISOString(), endTime: null };
    setSessions(prev => [newSession, ...prev]);

    if (user) {
      const ref = doc(db, 'users', user.uid, 'sessions', newSession.id);
      await attemptWrite(
        { type: 'sessionCreate', payload: newSession },
        () => setDoc(ref, {
          eventId: newSession.eventId,
          note: '',
          incomplete: false,
          rating: 0,
          tags: [],
          startTime: Timestamp.fromDate(new Date(newSession.startTime)),
          endTime: null
        })
      );
    }
  };

  const handleStop = async (id: string, noteStr: string, incomplete: boolean = false, rating: number = 0, tags: string[] = []) => {
    const endTime = new Date().toISOString();
    setSessions(prev => prev.map(s => s.id === id ? { ...s, endTime, note: noteStr, incomplete, rating, tags } : s));
    setStoppingSessionId(null); setStoppingNote('');

    if (user) {
      const ref = doc(db, 'users', user.uid, 'sessions', id);
      await attemptWrite(
        { type: 'sessionUpdate', payload: { id, eventId: '', startTime: '', endTime, note: noteStr, incomplete, rating, tags } as Session },
        () => updateDoc(ref, {
          endTime: Timestamp.fromDate(new Date(endTime)),
          note: noteStr || '',
          incomplete: incomplete || false,
          rating: rating || 0,
          tags: tags || []
        })
      );
    }
  };

  const handleSaveEventType = async (id: string, name: string, color: string, goal: Goal | null, tags: string[] = []) => {
    if (id === 'new') {
      const newEvent: EventType = { id: uuid(), name, color, goal, archived: false, createdAt: new Date().toISOString(), tags };
      setEventTypes(prev => [...prev, newEvent]);
      if (user) {
        const ref = doc(db, 'users', user.uid, 'event_types', newEvent.id);
        await attemptWrite(
          { type: 'eventCreate', payload: newEvent },
          () => setDoc(ref, {
            ...newEvent,
            createdAt: Timestamp.fromDate(new Date(newEvent.createdAt))
          })
        );
      }
    } else {
      setEventTypes(prev => prev.map(e => e.id === id ? { ...e, name, color, goal, tags } : e));
      if (user) {
        const ref = doc(db, 'users', user.uid, 'event_types', id);
        await attemptWrite(
          { type: 'eventUpdate', payload: { id, name, color, goal, tags, archived: false, createdAt: new Date().toISOString() } as EventType },
          () => updateDoc(ref, { name, color, goal, tags })
        );
      }
    }
    setEditingEventType(null);
  };

  const handleDeleteEvent = async (id: string) => {
    if (id === 'new') {
      setEditingEventType(null);
      return;
    }
    if (!confirm('确定要删除这个事件类型吗？这将同时删除所有关联的记录。')) return;

    if (user) {
      const batch = writeBatch(db);
      const eRef = doc(db, 'users', user.uid, 'event_types', id);
      batch.delete(eRef);
      sessions.filter(s => s.eventId === id).forEach(s => {
        const sRef = doc(db, 'users', user.uid, 'sessions', s.id);
        batch.delete(sRef);
      });
      await attemptWrite(
        { type: 'eventDelete', payload: { id } },
        () => batch.commit()
      );
    } else {
      addPendingDelete('events', id);
      // Find all sessions using this event and mark them as deleted too
      const relatedSessionIds = sessions.filter(s => s.eventId === id).map(s => s.id);
      relatedSessionIds.forEach(sid => addPendingDelete('sessions', sid));
    }

    setEventTypes(prev => prev.filter(e => e.id !== id));
    setSessions(prev => prev.filter(s => s.eventId !== id));
    setEditingEventType(null);
  };

  const handleUpdateSession = async (id: string, s: string, e: string | null, evId: string, n: string, inc: boolean, rate: number = 0, tags: string[] = []) => {
    setSessions(prev => prev.map(session => session.id === id ? { ...session, startTime: s, endTime: e, eventId: evId, note: n, incomplete: inc, rating: rate, tags } : session));
    setEditingSession(null);

    if (tags.length > 0) {
      const currentEvent = eventTypes.find(ev => ev.id === evId);
      const nextTags = Array.from(new Set([...(currentEvent?.tags || []), ...tags]));
      setEventTypes(prev => prev.map(ev => ev.id === evId ? { ...ev, tags: nextTags } : ev));

      if (user) {
        const ref = doc(db, 'users', user.uid, 'event_types', evId);
        await attemptWrite(
          { type: 'eventUpdate', payload: { id: evId, name: currentEvent?.name || '', color: currentEvent?.color || '#3b82f6', archived: currentEvent?.archived ?? false, createdAt: currentEvent?.createdAt || new Date().toISOString(), goal: currentEvent?.goal || null, tags: nextTags } as EventType },
          () => updateDoc(ref, { tags: nextTags })
        );
      }
    }

    if (user) {
      const ref = doc(db, 'users', user.uid, 'sessions', id);
      await attemptWrite(
        { type: 'sessionUpdate', payload: { id, eventId: evId, startTime: s, endTime: e, note: n, incomplete: inc, rating: rate, tags } as Session },
        () => updateDoc(ref, {
          eventId: evId,
          note: n || '',
          incomplete: inc || false,
          rating: rate || 0,
          tags: tags || [],
          startTime: Timestamp.fromDate(new Date(s)),
          endTime: e ? Timestamp.fromDate(new Date(e)) : null
        })
      );
    }
  };

  const handleAddSession = async (_id: string, s: string, e: string | null, evId: string, n: string, inc: boolean, rate: number = 0, tags: string[] = []) => {
    const newSession = { id: uuid(), startTime: s, endTime: e, eventId: evId, note: n, incomplete: inc, rating: rate, tags };
    setSessions(prev => [newSession, ...prev]);
    setIsAddMode(false);

    if (tags.length > 0) {
      const currentEvent = eventTypes.find(ev => ev.id === evId);
      const nextTags = Array.from(new Set([...(currentEvent?.tags || []), ...tags]));
      setEventTypes(prev => prev.map(ev => ev.id === evId ? { ...ev, tags: nextTags } : ev));

      if (user) {
        const ref = doc(db, 'users', user.uid, 'event_types', evId);
        await attemptWrite(
          { type: 'eventUpdate', payload: { id: evId, name: currentEvent?.name || '', color: currentEvent?.color || '#3b82f6', archived: currentEvent?.archived ?? false, createdAt: currentEvent?.createdAt || new Date().toISOString(), goal: currentEvent?.goal || null, tags: nextTags } as EventType },
          () => updateDoc(ref, { tags: nextTags })
        );
      }
    }

    if (user) {
      const ref = doc(db, 'users', user.uid, 'sessions', newSession.id);
      await attemptWrite(
        { type: 'sessionCreate', payload: newSession as Session },
        () => setDoc(ref, {
          eventId: evId,
          note: n || '',
          incomplete: inc || false,
          rating: rate || 0,
          tags: tags || [],
          startTime: Timestamp.fromDate(new Date(s)),
          endTime: e ? Timestamp.fromDate(new Date(e)) : null
        })
      );
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    if (user) {
      const ref = doc(db, 'users', user.uid, 'sessions', id);
      await attemptWrite(
        { type: 'sessionDelete', payload: { id } },
        () => deleteDoc(ref)
      );
    } else {
      addPendingDelete('sessions', id);
    }
    setSessions(prev => prev.filter(s => s.id !== id));
    setEditingSession(null);
  };

  const toggleSetting = async (key: keyof UserSettings, val: any) => {
    const next = { ...settings, [key]: val } as UserSettings;
    setSettings(next);

    if (user) {
      const ref = doc(db, 'users', user.uid, 'settings', 'preferences');
      await attemptWrite(
        { type: 'settingsUpdate', payload: next },
        () => setDoc(ref, next, { merge: true })
      );
    }
  };

  // --- Derived Calculations (Same as before) ---
  const activeSessions = useMemo(() => sessions.filter(s => s.endTime === null), [sessions]);
  const activeEventIds = new Set(activeSessions.map(s => s.eventId));

  const filteredSessions = useMemo(() => sessions.filter(s => {
    const et = eventTypes.find(e => e.id === s.eventId);
    if (filterTags.length > 0 && !filterTags.some(t => et?.tags?.includes(t))) return false;
    if (filterRating !== null && (s.rating || 0) < filterRating) return false;
    if (filterIncomplete === 'complete' && s.incomplete) return false;
    if (filterIncomplete === 'incomplete' && !s.incomplete) return false;
    if (filterHasNote === 'yes' && !s.note) return false;
    if (filterHasNote === 'no' && s.note) return false;
    return true;
  }), [sessions, eventTypes, filterTags, filterRating, filterIncomplete, filterHasNote]);

  // (Assuming calculateStats, getGoalStatus, trendData, getHeatmapData, exportData, importData, components are unchanged from previous version)
  // Re-pasting the helper logic for completeness since we are inside a full file block
  // ... [Logic omitted for brevity in thought process, but included in final code block] ...

  // Re-implementing helper logic inside component scope to access state
  const calculateStats = (relevantSessions: Session[]) => {
    const finishedSessions = relevantSessions.filter(s => s.endTime);
    // Count excludes "incomplete" sessions; Duration includes ALL sessions regardless of flag
    const totalCount = finishedSessions.filter(s => !s.incomplete).length;
    const totalDuration = finishedSessions.reduce((acc, s) => acc + ((new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000), 0);
    const uniqueDates = [...new Set(finishedSessions.map(s => getDayKey(new Date(s.endTime!))))].sort();

    if (uniqueDates.length === 0) return { totalCount, totalDuration, currentStreak: 0, currentGap: 0, maxStreak: 0, maxGap: 0 };
    const parseDate = (str: string) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
    const dayDiff = (d1: Date, d2: Date) => Math.floor((d2.getTime() - d1.getTime()) / 86400000);
    let maxStreak = 1, maxGap = 0, tempStreak = 1;
    for (let i = 1; i < uniqueDates.length; i++) {
      const diff = dayDiff(parseDate(uniqueDates[i - 1]), parseDate(uniqueDates[i]));
      if (diff === 1) tempStreak++; else { maxStreak = Math.max(maxStreak, tempStreak); tempStreak = 1; maxGap = Math.max(maxGap, diff - 1); }
    }
    maxStreak = Math.max(maxStreak, tempStreak);
    const todayStr = getDayKey(new Date());
    const yestStr = getDayKey(new Date(Date.now() - 86400000));
    const lastDateStr = uniqueDates[uniqueDates.length - 1];
    const today = new Date(); today.setHours(0, 0, 0, 0); const lastDate = parseDate(lastDateStr);
    let currentStreak = 0, currentGap = 0;
    if (lastDateStr === todayStr || lastDateStr === yestStr) {
      currentStreak = 1;
      let curr = new Date(lastDate);
      curr.setDate(curr.getDate() - 1);
      while (uniqueDates.includes(getDayKey(curr))) { currentStreak++; curr.setDate(curr.getDate() - 1); }
    } else { currentGap = dayDiff(lastDate, today); }
    const gapSinceLast = dayDiff(lastDate, today);
    if (gapSinceLast > maxGap) maxGap = gapSinceLast;
    return { totalCount, totalDuration, currentStreak, currentGap, maxStreak, maxGap };
  };

  const getCompletionExtras = (relevantSessions: Session[]) => {
    const completed = relevantSessions.filter(s => s.endTime && !s.incomplete);
    if (completed.length === 0) return { maxDuration: null, minDuration: null, minGap: null };

    const durations = completed.map(s => (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000).filter(v => v >= 0);
    const maxDuration = durations.length ? Math.max(...durations) : null;
    const minDuration = durations.length ? Math.min(...durations) : null;

    const sortedByEnd = completed.slice().sort((a, b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
    let minGap: number | null = null;
    for (let i = 1; i < sortedByEnd.length; i++) {
      const prevEnd = new Date(sortedByEnd[i - 1].endTime!).getTime();
      const currEnd = new Date(sortedByEnd[i].endTime!).getTime();
      const gap = (currEnd - prevEnd) / 1000;
      if (gap >= 0 && (minGap === null || gap < minGap)) minGap = gap;
    }

    return { maxDuration, minDuration, minGap };
  };

  const getDurationStats = (relevantSessions: Session[]) => {
    const completed = relevantSessions.filter(s => s.endTime && !s.incomplete);
    if (completed.length === 0) {
      return { avg: null, median: null, p90: null, count: 0 };
    }
    const durations = completed
      .map(s => (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000)
      .filter(v => v >= 0)
      .sort((a, b) => a - b);
    const count = durations.length;
    const avg = durations.reduce((a, b) => a + b, 0) / count;
    const median = count % 2 === 0
      ? (durations[count / 2 - 1] + durations[count / 2]) / 2
      : durations[Math.floor(count / 2)];
    const p90Index = Math.min(count - 1, Math.ceil(count * 0.9) - 1);
    const p90 = durations[p90Index];
    return { avg, median, p90, count };
  };

  const buildHistogram = (relevantSessions: Session[]) => {
    const completed = relevantSessions.filter(s => s.endTime && !s.incomplete);
    if (completed.length === 0) return { bins: [], min: 0, max: 0, maxCount: 0 };

    const durations = completed
      .map(s => (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000)
      .filter(v => v >= 0);

    const min = Math.min(...durations);
    const max = Math.max(...durations);
    if (min === max) {
      return {
        bins: [{ start: min, end: max, count: durations.length }],
        min,
        max,
        maxCount: durations.length
      };
    }

    const binCount = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(durations.length))));
    const step = (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, i) => ({
      start: min + i * step,
      end: min + (i + 1) * step,
      count: 0
    }));

    durations.forEach(d => {
      const idx = Math.min(binCount - 1, Math.floor((d - min) / step));
      bins[idx].count += 1;
    });

    const maxCount = Math.max(...bins.map(b => b.count));
    return { bins, min, max, maxCount };
  };

  const buildDurationSeries = (relevantSessions: Session[]) => {
    const completed = relevantSessions
      .filter(s => s.endTime && !s.incomplete)
      .sort((a, b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
    return completed.map(s => (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000);
  };

  const buildGapSeries = (relevantSessions: Session[]) => {
    const completed = relevantSessions
      .filter(s => s.endTime && !s.incomplete)
      .sort((a, b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < completed.length; i++) {
      const prevEnd = new Date(completed[i - 1].endTime!).getTime();
      const currStart = new Date(completed[i].startTime).getTime();
      const gap = (currStart - prevEnd) / 1000;
      if (gap >= 0) gaps.push(gap);
    }
    return gaps;
  };

  const buildMinuteCountsForSessions = (sourceSessions: Session[]) => {
    const minuteCounts = new Int32Array(1440);
    sourceSessions.forEach((s) => {
      if (!s.startTime) return;
      const start = new Date(s.startTime);
      const end = s.endTime ? new Date(s.endTime) : new Date();
      if (end.getTime() - start.getTime() > 86400000) return;
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = end.getHours() * 60 + end.getMinutes();
      if (startMin <= endMin) {
        for (let i = startMin; i <= endMin; i++) minuteCounts[i]++;
      } else {
        for (let i = startMin; i < 1440; i++) minuteCounts[i]++;
        for (let i = 0; i <= endMin; i++) minuteCounts[i]++;
      }
    });
    return minuteCounts;
  };

  const buildTimeSlices = (period: 'week' | 'month', count: number) => {
    const now = new Date();
    if (period === 'week') {
      const current = new Date(now);
      const diff = (current.getDay() - settings.weekStart + 7) % 7;
      current.setDate(current.getDate() - diff);
      current.setHours(0, 0, 0, 0);
      return Array.from({ length: count }, (_, i) => {
        const start = new Date(current);
        start.setDate(start.getDate() - (count - 1 - i) * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return { start, end, label: getDayKey(start) };
      });
    }
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return Array.from({ length: count }, (_, i) => {
      const start = new Date(currentMonth);
      start.setMonth(start.getMonth() - (count - 1 - i));
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      return { start, end, label };
    });
  };

  const buildStartGapSeries = (relevantSessions: Session[]) => {
    const completed = relevantSessions
      .filter(s => s.endTime && !s.incomplete)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < completed.length; i++) {
      const prevStart = new Date(completed[i - 1].startTime).getTime();
      const currStart = new Date(completed[i].startTime).getTime();
      const gap = (currStart - prevStart) / 1000;
      if (gap >= 0) gaps.push(gap);
    }
    return gaps;
  };

  const getGoalStatus = (event: EventType) => {
    if (!event.goal) return null;
    const { metric, period, targetValue } = event.goal;
    const now = new Date(); let start = new Date(now);
    if (period === 'week') { const day = start.getDay(); const diff = (day - settings.weekStart + 7) % 7; start.setDate(start.getDate() - diff); start.setHours(0, 0, 0, 0); } else { start.setDate(1); start.setHours(0, 0, 0, 0); }
    const relSessions = sessions.filter(s => s.eventId === event.id && s.endTime && new Date(s.endTime) >= start);
    // Count excludes incomplete; Duration includes all
    let current = metric === 'count' ? relSessions.filter(s => !s.incomplete).length : relSessions.reduce((acc, s) => acc + ((new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000), 0);
    const endPeriod = new Date(start); if (period === 'week') endPeriod.setDate(endPeriod.getDate() + 7); else endPeriod.setMonth(endPeriod.getMonth() + 1);
    const timeProgress = Math.min(Math.max((now.getTime() - start.getTime()) / (endPeriod.getTime() - start.getTime()), 0), 1);
    return { current, targetValue, timeProgress };
  };

  const trendData = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    sessions.filter(s => {
      if (!s.endTime || !statsSelectedIds.includes(s.eventId)) return false;
      const et = eventTypes.find(e => e.id === s.eventId);

      if (filterTags.length > 0 && !filterTags.some(t => et?.tags?.includes(t))) return false;
      if (filterRating !== null && (s.rating || 0) < filterRating) return false;
      if (filterIncomplete === 'complete' && s.incomplete) return false;
      if (filterIncomplete === 'incomplete' && !s.incomplete) return false;
      if (filterHasNote === 'yes' && !s.note) return false;
      if (filterHasNote === 'no' && s.note) return false;

      return true;
    }).forEach(s => {
      const date = new Date(s.endTime!); let key = '';
      if (trendPeriod === 'day') key = getDayKey(date);
      else if (trendPeriod === 'week') { const d = new Date(date); d.setDate(d.getDate() - (d.getDay() - settings.weekStart + 7) % 7); key = getDayKey(d); } else key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, {});
      // Count 0 if incomplete
      const val = trendMetric === 'count' ? (s.incomplete ? 0 : 1) : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      if (!isNaN(val)) map.get(key)![s.eventId] = (map.get(key)![s.eventId] || 0) + val;
    });
    return Array.from(map.entries()).map(([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions, statsSelectedIds, trendMetric, trendPeriod, settings.weekStart, filterTags, filterRating, filterIncomplete, filterHasNote, eventTypes]);

  const getEventGrowth = (eventId: string | 'all') => {
    if (trendData.length < 2) return 0;
    const currentFrame = trendData[trendData.length - 1].values;
    const prevFrame = trendData[trendData.length - 2].values;

    let current = 0, prev = 0;

    if (eventId === 'all') {
      current = Object.values(currentFrame).reduce((a, b) => a + (b || 0), 0);
      prev = Object.values(prevFrame).reduce((a, b) => a + (b || 0), 0);
    } else {
      current = currentFrame[eventId] || 0;
      prev = prevFrame[eventId] || 0;
    }

    if (prev === 0) return current > 0 ? 100 : 0;
    const growth = ((current - prev) / prev) * 100;
    return isNaN(growth) ? 0 : growth;
  };

  const getHeatmapData = (metric: 'count' | 'duration') => {
    const m = new Map<string, number>();
    sessions.filter(s => {
      if (!s.endTime || !statsSelectedIds.includes(s.eventId)) return false;
      const et = eventTypes.find(e => e.id === s.eventId);

      if (filterTags.length > 0 && !filterTags.some(t => et?.tags?.includes(t))) return false;
      if (filterRating !== null && (s.rating || 0) < filterRating) return false;
      if (filterIncomplete === 'complete' && s.incomplete) return false;
      if (filterIncomplete === 'incomplete' && !s.incomplete) return false;
      if (filterHasNote === 'yes' && !s.note) return false;
      if (filterHasNote === 'no' && s.note) return false;

      return true;
    }).forEach(s => {
      const key = getDayKey(new Date(s.endTime!));
      const val = metric === 'count' ? (s.incomplete ? 0 : 1) : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      if (!isNaN(val)) m.set(key, (m.get(key) || 0) + val);
    });
    return m;
  };

  const getTrendDataForSessions = (sourceSessions: Session[]) => {
    const map = new Map<string, Record<string, number>>();
    sourceSessions.filter(s => s.endTime).forEach(s => {
      const date = new Date(s.endTime!);
      let key = '';
      if (trendPeriod === 'day') key = getDayKey(date);
      else if (trendPeriod === 'week') {
        const d = new Date(date);
        d.setDate(d.getDate() - (d.getDay() - settings.weekStart + 7) % 7);
        key = getDayKey(d);
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }
      if (!map.has(key)) map.set(key, {});
      const val = trendMetric === 'count'
        ? (s.incomplete ? 0 : 1)
        : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      if (!isNaN(val)) map.get(key)![s.eventId] = (map.get(key)![s.eventId] || 0) + val;
    });
    return Array.from(map.entries())
      .map(([date, values]) => ({ date, values }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const getHeatmapDataForSessions = (sourceSessions: Session[], metric: 'count' | 'duration') => {
    const m = new Map<string, number>();
    sourceSessions.filter(s => s.endTime).forEach(s => {
      const key = getDayKey(new Date(s.endTime!));
      const val = metric === 'count'
        ? (s.incomplete ? 0 : 1)
        : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      if (!isNaN(val)) m.set(key, (m.get(key) || 0) + val);
    });
    return m;
  };

  const getSpectrumRangeFromSessions = (sourceSessions: Session[], range: 'all' | '7' | '30', offsetDays: number = 0) => {
    if (range === 'all') return sourceSessions.filter(s => s.endTime);
    const days = Number(range);
    const end = new Date();
    end.setDate(end.getDate() - offsetDays);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    return sourceSessions.filter(s => {
      if (!s.endTime) return false;
      const endTime = new Date(s.endTime);
      return endTime >= start && endTime <= end;
    });
  };

  const handleChartTooltipMove = (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const tipTarget = target?.closest?.('[data-tip]') as HTMLElement | null;
    const tip = tipTarget?.dataset?.tip as string | undefined;
    const current = event.currentTarget as HTMLElement;
    if (!tip) {
      setChartTooltip(null);
      return;
    }
    const rect = current.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0]?.clientX : (event as React.MouseEvent).clientX;
    const clientY = 'touches' in event ? event.touches[0]?.clientY : (event as React.MouseEvent).clientY;
    if (clientX === undefined || clientY === undefined) return;
    setChartTooltip({
      x: clientX - rect.left + 10,
      y: clientY - rect.top + 10,
      text: tip
    });
  };

  const clearChartTooltip = () => setChartTooltip(null);

  const formatHourMinute = (date: Date) => {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  const minuteToLabel = (minute: number) => {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const exportData = () => {
    const data = { settings, eventTypes, sessions };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tracker_backup.json'; a.click();
  };

  const getSpectrumRangeSessions = (range: 'all' | '7' | '30', offsetDays: number = 0) => {
    if (range === 'all') return sessions.filter(s => s.endTime && statsSelectedIds.includes(s.eventId));
    const days = Number(range);
    const end = new Date();
    end.setDate(end.getDate() - offsetDays);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    return sessions.filter(s => {
      if (!s.endTime || !statsSelectedIds.includes(s.eventId)) return false;
      const endTime = new Date(s.endTime);
      return endTime >= start && endTime <= end;
    });
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string);
        if (confirm('导入将覆盖当前数据，确定吗？')) {
          if (user) { alert("在线模式暂不支持全量覆盖导入，请使用设置页面的同步功能"); return; }
          setSettings(data.settings);
          setEventTypes(data.eventTypes);
          setSessions(data.sessions);
          alert('导入完成');
        }
      } catch (err) { alert('格式错误'); }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className={`${settings.darkMode ? 'dark' : ''} bf-m3 min-h-screen w-full bg-m3-surface dark:bg-[#111318] text-m3-on-surface dark:text-gray-100 font-sans`}
      style={{ '--theme-rgb': themeRgb } as React.CSSProperties}
    >
      <nav className="sticky top-0 z-30 backdrop-blur bg-m3-surface/80 dark:bg-[#111318]/80 border-b border-m3-outline-variant/30">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-medium tracking-tight select-none flex items-baseline">
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>b</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>e</span>
              <span className="text-[#FBBC05] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>t</span>
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>t</span>
              <span className="text-[#34A853] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>e</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>r</span>
              <span className="text-[#4285F4] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>F</span>
              <span className="text-[#34A853] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>l</span>
              <span className="text-[#EA4335] font-serif italic" style={{ fontFamily: 'Times New Roman' }}>y</span>
            </div>
            <span className="text-xs text-m3-on-surface-variant hidden sm:inline">专注记录</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-m3-primary-container text-m3-on-primary-container hover:shadow-elevation-1 transition-all disabled:opacity-70"
              >
                {syncing ? <Icons.Loader2 size={16} /> : <Icons.Cloud size={16} />}
                <span>{syncing ? '同步中' : '同步'}</span>
              </button>
            )}
            <button
              onClick={() => toggleSetting('darkMode', !settings.darkMode)}
              className="p-2.5 rounded-full border border-m3-outline-variant/30 text-m3-on-surface-variant hover:bg-m3-on-surface/5 transition-colors"
              title="切换主题"
            >
              {settings.darkMode ? <Icons.Moon size={18} /> : <Icons.Sun size={18} />}
            </button>
            <button
              onClick={() => user ? setView('settings') : setShowAuthModal(true)}
              className="p-2.5 rounded-full border border-m3-outline-variant/30 hover:bg-m3-on-surface/5 transition-colors"
              title={user ? (user.email || 'User') : '登录'}
            >
              {user ? (
                <div className="w-7 h-7 rounded-full bg-[rgba(var(--theme-rgb),0.2)] text-[rgb(var(--theme-rgb))] flex items-center justify-center text-xs font-bold">
                  {user.email?.[0].toUpperCase() || 'U'}
                </div>
              ) : (
                <Icons.User size={18} className="text-m3-on-surface-variant" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {(pendingSyncQueue.length > 0 || lastSyncError) && (
        <div className="bg-google-yellow/10 border-b border-google-yellow/20 text-m3-on-surface">
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-google-yellow" />
              <span>同步异常：存在未同步记录，建议手动同步或重试。</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={retryPendingSync} className="px-3 py-1 rounded-full border border-google-yellow/30 hover:bg-google-yellow/10">重试待同步</button>
              <button onClick={handleSync} className="px-3 py-1 rounded-full border border-m3-outline-variant/40 hover:bg-m3-on-surface/5">手动同步</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {syncNotice && (
          <div className="mb-4 bg-m3-surface-container-high border border-m3-outline-variant/40 rounded-xl p-3 text-sm text-m3-on-surface flex items-center justify-between">
            <span>{syncNotice}</span>
            <button onClick={() => setSyncNotice(null)} className="text-m3-on-surface-variant hover:text-m3-on-surface">关闭</button>
          </div>
        )}
        <div className="flex justify-center mb-8">
          <div className="relative bg-m3-surface-container-high p-1 rounded-full grid grid-cols-4 w-full max-w-2xl border border-m3-outline-variant/30">
            <div
              className="absolute top-1 bottom-1 rounded-full shadow-md z-0 transition-all duration-300"
              style={{
                backgroundColor: activeTabColor,
                left: `calc(${activeTabIndex * 25}% + 4px)`,
                width: 'calc(25% - 8px)'
              }}
            />
            {tabs.map(tab => {
              const isActive = view === tab.id;
              const IconComp = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id as any)}
                  className="relative z-10 flex-auto py-2.5 text-sm font-medium flex items-center justify-center gap-2 rounded-full outline-none focus-visible:ring-2 ring-google-blue/50"
                >
                  <span className={`relative flex items-center gap-2 transition-colors duration-200 ${isActive ? 'text-white' : 'text-m3-on-surface-variant hover:text-m3-on-surface'}`}>
                    <IconComp className="w-4 h-4" />
                    <span className={isActive ? 'inline' : 'hidden md:inline'}>{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* --- HOME VIEW --- */}
        {view === 'home' && (
          <div className="max-w-6xl mx-auto animate-in fade-in">
            <header className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-normal text-gray-900 dark:text-gray-50">今日看板</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{new Date().toLocaleDateString()} · {activeSessions.length} 个进行中</p>
              </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
              {eventTypes.filter(e => !e.archived).map(et => {
                const isActive = activeEventIds.has(et.id);
                const goalStat = getGoalStatus(et);
                const stats = calculateStats(sessions.filter(s => s.eventId === et.id));
                const isFinishedToday = sessions.some(s => s.eventId === et.id && s.endTime && getDayKey(new Date(s.endTime)) === getDayKey(new Date()));

                return (
                  <button
                    key={et.id}
                    onClick={() => handleStart(et.id)}
                    disabled={isActive}
                    className={`
                      relative group text-left transition-all duration-300
                      flex flex-col justify-between p-5 min-h-[160px]
                      rounded-[24px] border-0
                      ${isActive
                        ? 'bg-[rgba(var(--theme-rgb),0.1)] dark:bg-[#1e2330] ring-2 ring-[rgba(var(--theme-rgb),0.2)] cursor-default'
                        : 'bg-m3-surface-container dark:bg-[#2e3035] hover:bg-m3-surface-container-high dark:hover:bg-[#363a42] hover:shadow-lg hover:-translate-y-1'
                      }
                    `}
                  >
                    <div className="flex justify-between items-start w-full mb-4">
                      <div className={`
                        w-10 h-10 rounded-xl flex items-center justify-center text-xl
                        ${isActive ? 'bg-[rgba(var(--theme-rgb),0.4)] dark:bg-[rgb(var(--theme-rgb))] text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.4)]' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300'}
                      `} style={isActive ? {} : { color: et.color }}>
                        {et.name[0]}
                      </div>
                      {goalStat && (
                        <div className="scale-90 opacity-80">
                          <GoalRing goal={et.goal} current={goalStat.current} color={et.color} timeProgress={goalStat.timeProgress} />
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="text-lg font-medium text-gray-800 dark:text-gray-100 mb-2 truncate leading-tight">{et.name}</h3>

                      <div className="flex gap-4 text-xs font-medium opacity-80">
                        <div className={`flex flex-col ${stats.currentStreak > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                          <span className="text-[10px] uppercase tracking-wider opacity-60">连胜</span>
                          <span className="text-base">{stats.currentStreak}<span className="text-[10px] ml-0.5">天</span></span>
                        </div>
                        <div className={`flex flex-col ${stats.currentGap > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                          <span className="text-[10px] uppercase tracking-wider opacity-60">未做</span>
                          <span className="text-base">{stats.currentGap}<span className="text-[10px] ml-0.5">天</span></span>
                        </div>
                      </div>
                    </div>

                    {isFinishedToday && !isActive && (
                      <div className="absolute top-4 right-4 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 p-1 rounded-full">
                        <Icons.Check size={14} strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}

              <button onClick={() => setView('settings')} className="flex flex-col items-center justify-center p-4 rounded-[24px] border border-dashed border-gray-300 dark:border-gray-600 hover:border-[rgba(var(--theme-rgb),0.8)] dark:hover:border-[rgb(var(--theme-rgb))] hover:bg-[rgba(var(--theme-rgb),0.05)] dark:hover:bg-gray-800/50 transition-all text-gray-400 min-h-[160px]">
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-2">
                  <Icons.Plus size={24} />
                </div>
                <span className="text-sm font-medium">新建事件</span>
              </button>
            </div>

            {activeSessions.length > 0 && (
              <div className="animate-in slide-in-from-bottom-6 duration-500">
                <div className="flex items-center gap-2 mb-4 px-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-gray-500 uppercase tracking-widest">进行中</span>
                </div>
                <div className="space-y-3">
                  {activeSessions.map(s => <OngoingSessionCard key={s.id} session={s} eventType={eventTypes.find(e => e.id === s.eventId)} onStop={() => settings.stopMode === 'quick' ? handleStop(s.id, '') : setStoppingSessionId(s.id)} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ... (History and Stats views remain structurally same, just ensuring icons are used correctly) ... */}
        {/* To keep file size manageable, I'm abbreviating History/Stats logic which is identical to previous successful offline version but with correct imports. */}
        {/* Please ensure you copy the FULL logic for History/Stats from the previous step if specific changes weren't requested there, but here is the essential integration: */}

        {view === 'history' && (
          <div className="max-w-4xl mx-auto animate-in fade-in pb-20">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold">历史记录</h1>
              <div className="flex gap-2">
                <button onClick={() => { setEditingSession(null); setIsAddMode(true); }} className="flex items-center gap-1 bg-[rgb(var(--theme-rgb))] hover:bg-[rgb(var(--theme-rgb))] text-white px-3 py-2 rounded-lg text-sm font-bold shadow-sm"><Icons.PlusCircle size={16} /> 补录</button>
                <MultiSelectFilter options={eventTypes} selectedIds={historySelectedIds} onChange={setHistorySelectedIds} label="筛选" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
              {sessions.filter(s => s.eventId && historySelectedIds.includes(s.eventId)).map(s => {
                const et = eventTypes.find(e => e.id === s.eventId);
                const duration = !s.endTime ? (Date.now() - new Date(s.startTime).getTime()) / 1000 : ((new Date(s.endTime).getTime()) - (new Date(s.startTime).getTime())) / 1000;
                return (
                  <div key={s.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between group hover:border-[rgba(var(--theme-rgb),0.4)] dark:hover:border-[rgb(var(--theme-rgb))] transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: et?.color }} />
                      <div>
                        <div className="flex items-center gap-2 mb-1"><span className="font-bold text-gray-800 dark:text-gray-200">{et?.name}</span>{!s.endTime && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-md font-bold">进行中</span>}</div>
                        <div className="font-mono text-sm text-gray-600 dark:text-gray-400 mb-1">{formatDuration(duration)}</div>
                        <div className="text-xs text-gray-400">{new Date(s.startTime).toLocaleString()} {s.endTime ? ` - ${new Date(s.endTime).toLocaleTimeString()}` : ''}</div>
                        {s.note && <div className="mt-2 text-xs text-gray-500 bg-gray-50 dark:bg-gray-700/50 p-2 rounded italic"><Icons.FileText size={10} className="inline mr-1" />{s.note}</div>}
                      </div>
                    </div>
                    <button onClick={() => { setEditingSession(s); setIsAddMode(false); }} className="p-2 text-gray-300 hover:text-[rgb(var(--theme-rgb))] dark:hover:text-[rgba(var(--theme-rgb),0.8)] rounded-lg"><Icons.Edit2 size={16} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'stats' && (
          <div
            className="max-w-5xl mx-auto animate-in fade-in pb-20 relative"
            onMouseOver={detailEventId ? undefined : handleChartTooltipMove}
            onMouseMove={detailEventId ? undefined : handleChartTooltipMove}
            onMouseLeave={detailEventId ? undefined : clearChartTooltip}
            onTouchStart={detailEventId ? undefined : handleChartTooltipMove}
            onTouchMove={detailEventId ? undefined : handleChartTooltipMove}
            onTouchEnd={detailEventId ? undefined : clearChartTooltip}
          >
            <header className="flex flex-col gap-4 mb-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-normal text-gray-900 dark:text-gray-50">趋势分析</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">数据洞察与回顾</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <MultiSelectFilter options={eventTypes} selectedIds={statsSelectedIds} onChange={setStatsSelectedIds} label="事件" />
                  <MultiSelectFilter options={Array.from(new Set(eventTypes.flatMap(e => e.tags || []))).map(t => ({ id: t, name: t, color: '#9ca3af' }))} selectedIds={filterTags} onChange={setFilterTags} label="标签" />
                  <select value={filterRating || ''} onChange={e => setFilterRating(e.target.value ? Number(e.target.value) : null)} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[rgb(var(--theme-rgb))] outline-none">
                    <option value="">所有评分</option>
                    <option value="5">5 星</option>
                    <option value="4">4 星及以上</option>
                    <option value="3">3 星及以上</option>
                  </select>
                  <select value={filterIncomplete} onChange={e => setFilterIncomplete(e.target.value as any)} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[rgb(var(--theme-rgb))] outline-none">
                    <option value="all">状态: 全部</option>
                    <option value="complete">仅完成</option>
                    <option value="incomplete">仅未完</option>
                  </select>
                  <select value={filterHasNote} onChange={e => setFilterHasNote(e.target.value as any)} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[rgb(var(--theme-rgb))] outline-none">
                    <option value="all">备注: 全部</option>
                    <option value="yes">有备注</option>
                    <option value="no">无备注</option>
                  </select>
                </div>
              </div>
            </header>

            {/* Individual Breakdown */}
            {statsSelectedIds.length > 0 && (
              <div className="mb-8">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 px-1">分项数据</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {eventTypes.filter(e => statsSelectedIds.includes(e.id)).map(et => {
                    const stats = calculateStats(filteredSessions.filter(s => s.eventId === et.id));
                    const extras = getCompletionExtras(filteredSessions.filter(s => s.eventId === et.id));
                    const durationStats = getDurationStats(filteredSessions.filter(s => s.eventId === et.id));
                    return (
                      <button
                        key={et.id}
                        onClick={() => setDetailEventId(et.id)}
                        className="bg-white dark:bg-[#1e2330] p-6 rounded-[24px] text-left hover:shadow-lg transition-all border border-transparent hover:border-[rgba(var(--theme-rgb),0.3)]"
                      >
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-8 rounded-full" style={{ backgroundColor: et.color }} />
                            <span className="text-lg font-medium text-gray-900 dark:text-white">{et.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <GrowthIndicator percentage={getEventGrowth(et.id)} />
                            <span className="text-[10px] uppercase text-gray-400">查看详情</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{stats.maxStreak}</div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">最长连胜</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{stats.maxGap}</div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">最长断档</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{stats.totalCount}</div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">次数</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{formatDuration(stats.totalDuration)}</div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">时长</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {extras.maxDuration === null ? '-' : formatDuration(extras.maxDuration)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">最长一次</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {extras.minDuration === null ? '-' : formatDuration(extras.minDuration)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">最短一次</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {extras.minGap === null ? '-' : formatDuration(extras.minGap)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">最短间隔</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {durationStats.avg === null ? '-' : formatDuration(durationStats.avg)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">平均时长</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {durationStats.median === null ? '-' : formatDuration(durationStats.median)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">中位数时长</div>
                          </div>
                          <div>
                            <div className="text-xl font-light text-gray-900 dark:text-white font-mono">
                              {durationStats.p90 === null ? '-' : formatDuration(durationStats.p90)}
                            </div>
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">P90 时长</div>
                          </div>
                        </div>

                        <div className="mt-6 bg-gray-50/80 dark:bg-[#2c3038]/60 rounded-2xl p-4 text-sm text-gray-500 dark:text-gray-300 border border-dashed border-gray-200 dark:border-gray-700">
                          图表预览已隐藏，点击卡片查看完整分析图表。
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts (Existing) with Controls */}
            {detailEventId && (() => {
              const detailEvent = eventTypes.find(e => e.id === detailEventId);
              if (!detailEvent) return null;
              const detailSessions = filteredSessions.filter(s => s.eventId === detailEvent.id);
              const detailStats = calculateStats(detailSessions);
              const detailExtras = getCompletionExtras(detailSessions);
              const detailDurationStats = getDurationStats(detailSessions);
              const detailHistogram = buildHistogram(detailSessions);
              const detailDurationSeries = buildDurationSeries(detailSessions);
              const detailGapSeries = buildGapSeries(detailSessions);
              const detailStartGapSeries = buildStartGapSeries(detailSessions);
              const detailCompleted = detailSessions.filter(s => s.endTime && !s.incomplete);
              const detailInertiaPoints = (() => {
                const ordered = detailCompleted
                  .slice()
                  .sort((a, b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
                return ordered.slice(1).map((s, i) => {
                  const prev = ordered[i];
                  const prevDur = Math.max(0, (new Date(prev.endTime!).getTime() - new Date(prev.startTime).getTime()) / 60000);
                  const currDur = Math.max(0, (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 60000);
                  return { prevDur, currDur };
                });
              })();
              const detailBucketData = (() => {
                if (detailCompleted.length === 0) return { bins: [], maxCount: 0, max: 0 };
                const durationsMin = detailCompleted
                  .map(s => (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 60000)
                  .filter(v => v >= 0);
                if (durationsMin.length === 0) return { bins: [], maxCount: 0, max: 0 };
                const max = Math.max(...durationsMin);
                const bucketSize = durationBucket;
                const bucketCount = Math.max(1, Math.ceil(max / bucketSize));
                const bins = Array.from({ length: bucketCount }, (_, i) => ({
                  start: i * bucketSize,
                  end: (i + 1) * bucketSize,
                  count: 0
                }));
                durationsMin.forEach(v => {
                  const idx = Math.min(bucketCount - 1, Math.floor(v / bucketSize));
                  bins[idx].count += 1;
                });
                const maxCount = Math.max(...bins.map(b => b.count));
                return { bins, maxCount, max };
              })();
              const detailStartDurationPoints = detailCompleted.map(s => {
                const start = new Date(s.startTime);
                const startMin = start.getHours() * 60 + start.getMinutes();
                const durationMin = Math.max(0, (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 60000);
                return { startMin, durationMin, start };
              });
              const detailTrendData = getTrendDataForSessions(detailSessions);
              const detailHeatmapCount = getHeatmapDataForSessions(detailSessions, 'count');
              const detailHeatmapDuration = getHeatmapDataForSessions(detailSessions, 'duration');
              const detailSpectrumBase = getSpectrumRangeFromSessions(detailSessions, spectrumRange);
              const detailPolarSessions = getSpectrumRangeFromSessions(detailSessions, spectrumRange);
              const detailSpectrumCompare = spectrumRange === 'all' ? [] : getSpectrumRangeFromSessions(detailSessions, spectrumRange, Number(spectrumRange));
              const detailSpectrumShowCompare = spectrumRange !== 'all' && detailSpectrumCompare.length > 0;
              const detailRidgeSlices = buildTimeSlices(ridgePeriod, ridgePeriod === 'week' ? 52 : 12);
              const detailRidgeSeries = detailRidgeSlices.map(slice => {
                const sliceSessions = detailSessions.filter(s => s.endTime && new Date(s.endTime) >= slice.start && new Date(s.endTime) < slice.end);
                const counts = buildMinuteCountsForSessions(sliceSessions);
                let max = 0;
                for (let i = 0; i < 1440; i++) max = Math.max(max, counts[i]);
                return { counts, max, label: slice.label };
              });
              const detailRidgeMax = Math.max(1, ...detailRidgeSeries.map(s => s.max));
              const detailBurstSlices = buildTimeSlices(burstPeriod, burstPeriod === 'week' ? 52 : 12);
              const detailBurstSeries = detailBurstSlices.map(slice => {
                const sliceSessions = detailSessions
                  .filter(s => s.endTime && new Date(s.endTime) >= slice.start && new Date(s.endTime) < slice.end)
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                const gaps: number[] = [];
                for (let i = 1; i < sliceSessions.length; i++) {
                  const prevStart = new Date(sliceSessions[i - 1].startTime).getTime();
                  const currStart = new Date(sliceSessions[i].startTime).getTime();
                  const gap = (currStart - prevStart) / 1000;
                  if (gap >= 0) gaps.push(gap);
                }
                if (gaps.length === 0) return { label: slice.label, B: 0 };
                const mu = gaps.reduce((a, b) => a + b, 0) / gaps.length;
                const variance = gaps.reduce((a, b) => a + Math.pow(b - mu, 2), 0) / gaps.length;
                const sigma = Math.sqrt(variance);
                const B = (sigma - mu) / (sigma + mu);
                return { label: slice.label, B: Math.max(-1, Math.min(1, B)) };
              });

              return (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                  <div
                    className="bg-white dark:bg-[#1e2330] w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] p-6 md:p-8 shadow-2xl relative m3-scrollbar"
                    onMouseOver={handleChartTooltipMove}
                    onMouseMove={handleChartTooltipMove}
                    onMouseLeave={clearChartTooltip}
                    onTouchStart={handleChartTooltipMove}
                    onTouchMove={handleChartTooltipMove}
                    onTouchEnd={clearChartTooltip}
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-8 rounded-full" style={{ backgroundColor: detailEvent.color }} />
                        <div>
                          <h3 className="text-2xl font-semibold text-gray-900 dark:text-white">{detailEvent.name}</h3>
                          <p className="text-xs text-gray-400">单事件详细分析</p>
                        </div>
                      </div>
                      <button onClick={() => setDetailEventId(null)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Icons.X size={18} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailStats.totalCount}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">总次数</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{formatDuration(detailStats.totalDuration)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">总时长</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailExtras.maxDuration === null ? '-' : formatDuration(detailExtras.maxDuration)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">最长一次</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailExtras.minDuration === null ? '-' : formatDuration(detailExtras.minDuration)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">最短一次</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailExtras.minGap === null ? '-' : formatDuration(detailExtras.minGap)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">最短间隔</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailDurationStats.avg === null ? '-' : formatDuration(detailDurationStats.avg)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">平均时长</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailDurationStats.median === null ? '-' : formatDuration(detailDurationStats.median)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">中位数</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="text-xl font-light text-gray-900 dark:text-white font-mono">{detailDurationStats.p90 === null ? '-' : formatDuration(detailDurationStats.p90)}</div>
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">P90 时长</div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            极坐标系
                            <span data-tip="角度=开始时间（24h），半径=持续时间；支持范围切换。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                            <button onClick={() => setSpectrumRange('7')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === '7' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>7天</button>
                            <button onClick={() => setSpectrumRange('30')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === '30' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>30天</button>
                            <button onClick={() => setSpectrumRange('all')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === 'all' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>全部</button>
                          </div>
                        </div>
                        {detailPolarSessions.filter(s => s.endTime).length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/60 dark:bg-black/10 rounded-2xl p-2">
                              <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">极坐标散点 + 包络线</div>
                              <svg viewBox="0 0 320 320" className="w-full h-72">
                                {(() => {
                                  const points = detailPolarSessions
                                    .filter(s => s.endTime)
                                    .map(s => {
                                      const start = new Date(s.startTime);
                                      const end = new Date(s.endTime!);
                                      const durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
                                      const startMinutes = start.getHours() * 60 + start.getMinutes();
                                      const angle = (startMinutes / 1440) * Math.PI * 2 - Math.PI / 2;
                                      return { durationMin, angle, startMinutes };
                                    });
                                  const maxDur = Math.max(...points.map(p => p.durationMin), 1);
                                  const rScale = (val: number) => 20 + (val / maxDur) * 120;
                                  const center = 160;
                                  const bins = Array.from({ length: 96 }, () => 0);
                                  points.forEach(p => {
                                    const bin = Math.min(95, Math.floor((p.startMinutes / 1440) * 96));
                                    bins[bin] = Math.max(bins[bin], p.durationMin);
                                  });
                                  const envelope = bins.map((v, i) => {
                                    const angle = (i / 96) * Math.PI * 2 - Math.PI / 2;
                                    const r = rScale(v);
                                    return { x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r };
                                  });
                                  const path = envelope.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
                                  return (
                                    <>
                                      {[30, 60, 90, 120].map((r, i) => (
                                        <circle key={i} cx={center} cy={center} r={r} fill="none" stroke={settings.darkMode ? '#374151' : '#e5e7eb'} strokeWidth="1" />
                                      ))}
                                      <path d={path} fill="none" stroke={detailEvent.color} strokeWidth="2" opacity={0.7} />
                                      {points.map((p, i) => {
                                        const r = rScale(p.durationMin);
                                        const x = center + Math.cos(p.angle) * r;
                                        const y = center + Math.sin(p.angle) * r;
                                        const hourDecimal = (p.startMinutes / 60).toFixed(2);
                                        return (
                                          <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`开始 ${hourDecimal}h · 时长 ${Math.round(p.durationMin)} 分钟`} />
                                        );
                                      })}
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>
                            <div className="bg-white/60 dark:bg-black/10 rounded-2xl p-2">
                              <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">极坐标弧线（起止时间）</div>
                              <svg viewBox="0 0 320 320" className="w-full h-72">
                                {(() => {
                                  const items = detailPolarSessions
                                    .filter(s => s.endTime)
                                    .map(s => {
                                      const start = new Date(s.startTime);
                                      const end = new Date(s.endTime!);
                                      const durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
                                      const startMinutes = start.getHours() * 60 + start.getMinutes();
                                      const endMinutes = end.getHours() * 60 + end.getMinutes();
                                      return { startMinutes, endMinutes, durationMin };
                                    });
                                  const maxDur = Math.max(...items.map(p => p.durationMin), 1);
                                  const rScale = (val: number) => 20 + (val / maxDur) * 120;
                                  const center = 160;
                                  return (
                                    <>
                                      {[30, 60, 90, 120].map((r, i) => (
                                        <circle key={i} cx={center} cy={center} r={r} fill="none" stroke={settings.darkMode ? '#374151' : '#e5e7eb'} strokeWidth="1" />
                                      ))}
                                      {items.map((p, i) => {
                                        const r = rScale(p.durationMin);
                                        const startAngle = (p.startMinutes / 1440) * Math.PI * 2 - Math.PI / 2;
                                        const endAngle = (p.endMinutes / 1440) * Math.PI * 2 - Math.PI / 2;
                                        const drawArc = (sa: number, ea: number, key: string) => {
                                          const largeArc = ea - sa > Math.PI ? 1 : 0;
                                          const x1 = center + Math.cos(sa) * r;
                                          const y1 = center + Math.sin(sa) * r;
                                          const x2 = center + Math.cos(ea) * r;
                                          const y2 = center + Math.sin(ea) * r;
                                          const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
                                          return <path key={key} d={d} fill="none" stroke={detailEvent.color} strokeWidth={4} opacity={0.7} data-tip={`起 ${minuteToLabel(p.startMinutes)} · 止 ${minuteToLabel(p.endMinutes)} · ${Math.round(p.durationMin)} 分钟`} />;
                                        };
                                        if (p.endMinutes >= p.startMinutes) {
                                          return drawArc(startAngle, endAngle, `a-${i}`);
                                        }
                                        const endOfDay = Math.PI * 2 - Math.PI / 2;
                                        return (
                                          <g key={`a-${i}`}>
                                            {drawArc(startAngle, endOfDay, `a1-${i}`)}
                                            {drawArc(-Math.PI / 2, endAngle, `a2-${i}`)}
                                          </g>
                                        );
                                      })}
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">时长分布（动态分箱）</div>
                          <span data-tip="根据完成时长自动分箱，Y 为频次。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailHistogram.bins.length === 0 ? (
                          <div className="text-xs text-gray-400">暂无完成记录</div>
                        ) : (
                          <div className="w-full">
                            <svg viewBox="0 0 720 200" className="w-full h-48">
                              {detailHistogram.bins.map((b, i) => {
                                const barWidth = 640 / detailHistogram.bins.length;
                                const h = detailHistogram.maxCount === 0 ? 0 : (b.count / detailHistogram.maxCount) * 140;
                                const x = 40 + i * barWidth;
                                const y = 170 - h;
                                return (
                                  <rect
                                    key={i}
                                    x={x}
                                    y={y}
                                    width={Math.max(4, barWidth - 6)}
                                    height={h}
                                    rx={3}
                                    fill={detailEvent.color}
                                    opacity={0.8}
                                    data-tip={`${formatDuration(b.start)} - ${formatDuration(b.end)} · ${b.count} 次`}
                                  />
                                );
                              })}
                              <line x1={40} y1={170} x2={680} y2={170} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                              <text x={18} y={170} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0</text>
                              <text x={18} y={100} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(detailHistogram.maxCount / 2)}</text>
                              <text x={18} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{detailHistogram.maxCount}</text>
                            </svg>
                            <div className="flex justify-between text-[10px] text-gray-400">
                              {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                                <span key={pct}>{formatDuration(detailHistogram.min + (detailHistogram.max - detailHistogram.min) * pct)}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">时长分布（固定分箱）</div>
                            <span data-tip="按固定桶宽统计频次。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-[10px]">
                            <button onClick={() => setDurationBucket(1)} className={`px-2 py-0.5 rounded-md transition-all ${durationBucket === 1 ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>1分钟</button>
                            <button onClick={() => setDurationBucket(5)} className={`px-2 py-0.5 rounded-md transition-all ${durationBucket === 5 ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>5分钟</button>
                            <button onClick={() => setDurationBucket(15)} className={`px-2 py-0.5 rounded-md transition-all ${durationBucket === 15 ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>15分钟</button>
                          </div>
                        </div>
                        {detailBucketData.bins.length === 0 ? (
                          <div className="text-xs text-gray-400">暂无完成记录</div>
                        ) : (
                          <div className="w-full">
                            <svg viewBox="0 0 720 200" className="w-full h-48">
                              {detailBucketData.bins.map((b, i) => {
                                const barWidth = 640 / detailBucketData.bins.length;
                                const h = detailBucketData.maxCount === 0 ? 0 : (b.count / detailBucketData.maxCount) * 140;
                                const x = 40 + i * barWidth;
                                const y = 170 - h;
                                return (
                                  <rect
                                    key={i}
                                    x={x}
                                    y={y}
                                    width={Math.max(4, barWidth - 6)}
                                    height={h}
                                    rx={3}
                                    fill={detailEvent.color}
                                    opacity={0.8}
                                    data-tip={`${b.start}-${b.end} 分钟 · ${b.count} 次`}
                                  />
                                );
                              })}
                              <line x1={40} y1={170} x2={680} y2={170} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                              <text x={18} y={170} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0</text>
                              <text x={18} y={100} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(detailBucketData.maxCount / 2)}</text>
                              <text x={18} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{detailBucketData.maxCount}</text>
                            </svg>
                            <div className="flex justify-between text-[10px] text-gray-400">
                              {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                                <span key={pct}>{Math.round(detailBucketData.max * pct)}分钟</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">单次时长</div>
                            <span data-tip="每次完成的时长序列。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-[10px]">
                            <button onClick={() => setSingleDurationChartType('line')} className={`px-2 py-0.5 rounded-md transition-all ${singleDurationChartType === 'line' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>折线</button>
                            <button onClick={() => setSingleDurationChartType('bar')} className={`px-2 py-0.5 rounded-md transition-all ${singleDurationChartType === 'bar' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>柱状</button>
                          </div>
                        </div>
                        {detailDurationSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 180" className="w-full h-44">
                            {(() => {
                              const maxVal = Math.max(...detailDurationSeries);
                              const minVal = Math.min(...detailDurationSeries);
                              const range = Math.max(1, maxVal - minVal);
                              const midVal = (minVal + maxVal) / 2;
                              if (singleDurationChartType === 'bar') {
                                const barWidth = 640 / detailDurationSeries.length;
                                return (
                                  <>
                                    {detailDurationSeries.map((v, i) => {
                                      const h = ((v - minVal) / range) * 120;
                                      return (
                                        <rect
                                          key={i}
                                          x={40 + i * barWidth}
                                          y={150 - h}
                                          width={Math.max(4, barWidth - 4)}
                                          height={h}
                                          rx={2}
                                          fill={detailEvent.color}
                                          opacity={0.8}
                                          data-tip={`第${i + 1}次 · ${formatDuration(v)}`}
                                        />
                                      );
                                    })}
                                    <line x1={40} y1={150} x2={680} y2={150} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                    <text x={10} y={150} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(minVal)}</text>
                                    <text x={10} y={90} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(midVal)}</text>
                                    <text x={10} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(maxVal)}</text>
                                  </>
                                );
                              }
                              const points = detailDurationSeries.map((v, i) => {
                                const x = 40 + (i / (detailDurationSeries.length - 1)) * 640;
                                const y = 150 - ((v - minVal) / range) * 120;
                                return `${x},${y}`;
                              }).join(' ');
                              return (
                                <>
                                  <polyline points={points} fill="none" stroke={detailEvent.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  {detailDurationSeries.map((v, i) => {
                                    const x = 40 + (i / (detailDurationSeries.length - 1)) * 640;
                                    const y = 150 - ((v - minVal) / range) * 120;
                                    return (
                                      <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`第${i + 1}次 · ${formatDuration(v)}`} />
                                    );
                                  })}
                                  <line x1={40} y1={150} x2={680} y2={150} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <text x={10} y={150} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(minVal)}</text>
                                  <text x={10} y={90} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(midVal)}</text>
                                  <text x={10} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(maxVal)}</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">间隔（对数）</div>
                            <span data-tip="本次开始-上次结束的间隔，使用对数坐标。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-[10px]">
                            <button onClick={() => setSingleGapChartType('line')} className={`px-2 py-0.5 rounded-md transition-all ${singleGapChartType === 'line' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>折线</button>
                            <button onClick={() => setSingleGapChartType('bar')} className={`px-2 py-0.5 rounded-md transition-all ${singleGapChartType === 'bar' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>柱状</button>
                          </div>
                        </div>
                        {detailGapSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 180" className="w-full h-44">
                            {(() => {
                              const logVals = detailGapSeries.map(v => Math.log10(v + 1));
                              const logValsStart = detailStartGapSeries.map(v => Math.log10(v + 1));
                              const allLogs = [...logVals, ...logValsStart];
                              const maxVal = Math.max(...allLogs);
                              const minVal = Math.min(...allLogs);
                              const range = Math.max(1e-6, maxVal - minVal);
                              const rawMin = Math.min(...detailGapSeries);
                              const rawMax = Math.max(...detailGapSeries);
                              const rawMid = (rawMin + rawMax) / 2;
                              const anchorSeconds = [3600, 43200, 86400];
                              const anchorLines = anchorSeconds.map(sec => {
                                const v = Math.log10(sec + 1);
                                const y = 150 - ((v - minVal) / range) * 120;
                                return { sec, y };
                              });
                              if (singleGapChartType === 'bar') {
                                const barWidth = 640 / logVals.length;
                                return (
                                  <>
                                    {anchorLines.map((a) => (
                                      <line key={a.sec} x1={40} y1={a.y} x2={680} y2={a.y} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="3" />
                                    ))}
                                    {logVals.map((v, i) => {
                                      const h = ((v - minVal) / range) * 120;
                                      return (
                                        <rect
                                          key={i}
                                          x={40 + i * barWidth}
                                          y={150 - h}
                                          width={Math.max(4, barWidth - 4)}
                                          height={h}
                                          rx={2}
                                          fill={detailEvent.color}
                                          opacity={0.8}
                                          data-tip={`间隔${i + 1} · ${formatDuration(detailGapSeries[i] || 0)}`}
                                        />
                                      );
                                    })}
                                    <line x1={40} y1={150} x2={680} y2={150} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                    <text x={10} y={150} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMin)}</text>
                                    <text x={10} y={90} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMid)}</text>
                                    <text x={10} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMax)}</text>
                                  </>
                                );
                              }
                              const points = logVals.map((v, i) => {
                                const x = 40 + (i / (logVals.length - 1)) * 640;
                                const y = 150 - ((v - minVal) / range) * 120;
                                return `${x},${y}`;
                              }).join(' ');
                              const pointsStart = logValsStart.map((v, i) => {
                                const x = 40 + (i / (logValsStart.length - 1 || 1)) * 640;
                                const y = 150 - ((v - minVal) / range) * 120;
                                return `${x},${y}`;
                              }).join(' ');
                              return (
                                <>
                                  {anchorLines.map((a) => (
                                    <line key={a.sec} x1={40} y1={a.y} x2={680} y2={a.y} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="3" />
                                  ))}
                                  <polyline points={points} fill="none" stroke={detailEvent.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  {pointsStart && (
                                    <polyline points={pointsStart} fill="none" stroke={settings.darkMode ? '#9ca3af' : '#6b7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  )}
                                  {logVals.map((v, i) => {
                                    const x = 40 + (i / (logVals.length - 1)) * 640;
                                    const y = 150 - ((v - minVal) / range) * 120;
                                    return (
                                      <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`间隔${i + 1} · ${formatDuration(detailGapSeries[i] || 0)}`} />
                                    );
                                  })}
                                  {logValsStart.map((v, i) => {
                                    const x = 40 + (i / (logValsStart.length - 1 || 1)) * 640;
                                    const y = 150 - ((v - minVal) / range) * 120;
                                    return (
                                      <circle key={`s-${i}`} cx={x} cy={y} r={3} fill={settings.darkMode ? '#9ca3af' : '#6b7280'} opacity={0.8} data-tip={`间隔（开始-开始）${i + 1} · ${formatDuration(detailStartGapSeries[i] || 0)}`} />
                                    );
                                  })}
                                  <line x1={40} y1={150} x2={680} y2={150} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <text x={10} y={150} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMin)}</text>
                                  <text x={10} y={90} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMid)}</text>
                                  <text x={10} y={30} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{formatDuration(rawMax)}</text>
                                  <text x={520} y={18} fontSize="10" fill={detailEvent.color}>开始-结束</text>
                                  <text x={600} y={18} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>开始-开始</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">惯性散点（上次-本次时长）</div>
                          <span data-tip="X: 上次时长分钟；Y: 本次时长分钟。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailInertiaPoints.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const maxX = Math.max(...detailInertiaPoints.map(p => p.prevDur), 1);
                              const maxY = Math.max(...detailInertiaPoints.map(p => p.currDur), 1);
                              const midX = maxX / 2;
                              const midY = maxY / 2;
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  {detailInertiaPoints.map((p, idx) => {
                                    const x = 50 + (p.prevDur / maxX) * 620;
                                    const y = 180 - (p.currDur / maxY) * 140;
                                    return (
                                      <circle key={idx} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.75} data-tip={`上次 ${Math.round(p.prevDur)}m · 本次 ${Math.round(p.currDur)}m`} />
                                    );
                                  })}
                                  <text x={50} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0m</text>
                                  <text x={50 + (midX / maxX) * 620 - 8} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(midX)}m</text>
                                  <text x={660} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(maxX)}m</text>
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0m</text>
                                  <text x={18} y={180 - (midY / maxY) * 140} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(midY)}m</text>
                                  <text x={18} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(maxY)}m</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">四象限散点（时间-时长）</div>
                          <span data-tip="X: 一天内开始时间（分钟）；Y: 单次时长（分钟）；原点为 12:00 与 P50 时长。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailStartDurationPoints.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const medianMinutes = detailDurationStats.median === null ? 0 : detailDurationStats.median / 60;
                              const maxY = Math.max(...detailStartDurationPoints.map(p => p.durationMin), medianMinutes, 1);
                              const originX = 50 + (720 / 1440) * 620; // 12:00 -> 中点
                              const originY = 180 - (medianMinutes / maxY) * 140;
                              const yMid = (medianMinutes + maxY) / 2;
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={originX} y1={30} x2={originX} y2={180} stroke={settings.darkMode ? '#6b7280' : '#9ca3af'} strokeDasharray="4" />
                                  <line x1={50} y1={originY} x2={690} y2={originY} stroke={settings.darkMode ? '#6b7280' : '#9ca3af'} strokeDasharray="4" />
                                  {detailStartDurationPoints.map((p, idx) => {
                                    const x = 50 + (p.startMin / 1440) * 620;
                                    const y = 180 - (p.durationMin / maxY) * 140;
                                    return (
                                      <circle
                                        key={idx}
                                        cx={x}
                                        cy={y}
                                        r={3}
                                        fill={detailEvent.color}
                                        opacity={0.75}
                                        data-tip={`开始 ${formatHourMinute(p.start)} · 时长 ${Math.round(p.durationMin)} 分钟`}
                                      />
                                    );
                                  })}
                                  <text x={50} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>00:00</text>
                                  <text x={50 + (360 / 1440) * 620 - 12} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>06:00</text>
                                  <text x={originX - 12} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>12:00</text>
                                  <text x={50 + (1080 / 1440) * 620 - 12} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>18:00</text>
                                  <text x={650} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>24:00</text>
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0分钟</text>
                                  <text x={18} y={originY + 4} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>P50</text>
                                  <text x={18} y={180 - (yMid / maxY) * 140} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(yMid)}分钟</text>
                                  <text x={18} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(maxY)}分钟</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>
                      {/* 开始时间-时长散点（已由四象限散点替代） */}

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">间隔-时长散点</div>
                          <span data-tip="X: 间隔小时；Y: 本次时长小时。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailDurationSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const completed = detailSessions
                                .filter(s => s.endTime && !s.incomplete)
                                .sort((a, b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
                              const points = completed.slice(1).map((s, i) => {
                                const prevEnd = new Date(completed[i].endTime!).getTime();
                                const currStart = new Date(s.startTime).getTime();
                                const gapHours = Math.max(0, (currStart - prevEnd) / 3600000);
                                const durationHours = Math.max(0, (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 3600000);
                                return { gapHours, durationHours };
                              });
                              if (points.length === 0) return null;
                              const maxX = Math.max(...points.map(p => p.gapHours), 1);
                              const maxY = Math.max(...points.map(p => p.durationHours), 1);
                              const midX = maxX / 2;
                              const midY = maxY / 2;
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  {points.map((p, idx) => {
                                    const x = 50 + (p.gapHours / maxX) * 620;
                                    const y = 180 - (p.durationHours / maxY) * 140;
                                    return (
                                      <circle key={idx} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.75} data-tip={`间隔 ${p.gapHours.toFixed(2)}小时 · 时长 ${p.durationHours.toFixed(2)}小时`} />
                                    );
                                  })}
                                  <text x={50} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0小时</text>
                                  <text x={50 + (midX / maxX) * 620 - 8} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{midX.toFixed(1)}小时</text>
                                  <text x={660} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{maxX.toFixed(1)}小时</text>
                                  <text x={12} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0小时</text>
                                  <text x={12} y={180 - (midY / maxY) * 140} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{midY.toFixed(1)}小时</text>
                                  <text x={12} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{maxY.toFixed(1)}小时</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">累计投入曲线</div>
                          <span data-tip="X: 累计次数百分比；Y: 累计时长百分比。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailDurationSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const durations = detailDurationSeries.slice().sort((a, b) => a - b);
                              const total = durations.reduce((a, b) => a + b, 0);
                              let cumulative = 0;
                              const points = durations.map((d, i) => {
                                cumulative += d;
                                const x = (i + 1) / durations.length;
                                const y = total === 0 ? 0 : cumulative / total;
                                return { x, y };
                              });
                              const path = points.map((p, i) => {
                                const x = 50 + p.x * 620;
                                const y = 180 - p.y * 140;
                                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                              }).join(' ');
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <path d={path} fill="none" stroke={detailEvent.color} strokeWidth={2} />
                                  {points.map((p, i) => {
                                    const x = 50 + p.x * 620;
                                    const y = 180 - p.y * 140;
                                    return (
                                      <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`累计次数 ${(p.x * 100).toFixed(1)}% · 累计时长 ${(p.y * 100).toFixed(1)}%`} />
                                    );
                                  })}
                                  <line x1={50} y1={180} x2={690} y2={40} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="4" />
                                  <text x={50} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0%</text>
                                  <text x={670} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>100%</text>
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0%</text>
                                  <text x={18} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>100%</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">留存概率</div>
                          <span data-tip="X: 已坚持分钟；Y: 继续坚持的概率。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailDurationSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const durationsMin = detailDurationSeries.map(v => v / 60).sort((a, b) => a - b);
                              const total = durationsMin.length;
                              const unique = Array.from(new Set(durationsMin));
                              const points = unique.map(val => {
                                const survivors = durationsMin.filter(d => d >= val).length;
                                return { x: val, y: survivors / total };
                              });
                              const maxX = Math.max(...points.map(p => p.x), 1);
                              const path = points.map((p, i) => {
                                const x = 50 + (p.x / maxX) * 620;
                                const y = 180 - p.y * 140;
                                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                              }).join(' ');
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <path d={path} fill="none" stroke={detailEvent.color} strokeWidth={2} />
                                  {points.map((p, i) => {
                                    const x = 50 + (p.x / maxX) * 620;
                                    const y = 180 - p.y * 140;
                                    return (
                                      <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`坚持 ${p.x.toFixed(1)} 分钟后继续概率 ${(p.y * 100).toFixed(1)}%`} />
                                    );
                                  })}
                                  <text x={50} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0分钟</text>
                                  <text x={660} y={205} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{Math.round(maxX)}分钟</text>
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0%</text>
                                  <text x={18} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>100%</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">日时长标准差</div>
                          <span data-tip="按周/按月统计每天时长的标准差（不含零值日）。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        {detailSessions.filter(s => s.endTime).length < 3 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const period = trendPeriod === 'day' ? 'week' : trendPeriod;
                              const buckets = new Map<string, number[]>();
                              detailSessions.filter(s => s.endTime).forEach(s => {
                                const end = new Date(s.endTime!);
                                let key = '';
                                if (period === 'week') {
                                  const d = new Date(end);
                                  d.setDate(d.getDate() - (d.getDay() - settings.weekStart + 7) % 7);
                                  key = getDayKey(d);
                                } else {
                                  key = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
                                }
                                const dayKey = getDayKey(end);
                                const duration = (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 3600_000;
                                const mapKey = `${key}-${dayKey}`;
                                if (!buckets.has(mapKey)) buckets.set(mapKey, []);
                                buckets.get(mapKey)!.push(duration);
                              });

                              const periodMap = new Map<string, number[]>();
                              buckets.forEach((vals, key) => {
                                const periodKey = key.split('-').slice(0, period === 'week' ? 3 : 2).join('-');
                                const total = vals.reduce((a, b) => a + b, 0);
                                if (!periodMap.has(periodKey)) periodMap.set(periodKey, []);
                                periodMap.get(periodKey)!.push(total);
                              });

                              const series = Array.from(periodMap.entries())
                                .sort((a, b) => a[0].localeCompare(b[0]))
                                .map(([key, totals]) => {
                                  const nonZero = totals.filter(v => v > 0);
                                  if (nonZero.length === 0) return { key, std: 0 };
                                  const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
                                  const variance = nonZero.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nonZero.length;
                                  return { key, std: Math.sqrt(variance) };
                                });
                              if (series.length < 2) return null;
                              const maxVal = Math.max(...series.map(s => s.std), 1e-3);
                              const points = series.map((s, i) => {
                                const x = 50 + (i / (series.length - 1)) * 620;
                                const y = 180 - (s.std / maxVal) * 140;
                                return `${x},${y}`;
                              }).join(' ');
                              return (
                                <>
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <polyline points={points} fill="none" stroke={detailEvent.color} strokeWidth={2} />
                                  {series.map((s, i) => {
                                    const x = 50 + (i / (series.length - 1)) * 620;
                                    const y = 180 - (s.std / maxVal) * 140;
                                    return (
                                      <circle key={i} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`${s.key} · 标准差 ${s.std.toFixed(2)}小时`} />
                                    );
                                  })}
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0小时</text>
                                  <text x={18} y={40} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{maxVal.toFixed(1)}小时</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>
                    </div>

                    <div className="mt-8 space-y-6">
                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            山峦图（24h 光谱）
                            <span data-tip="按周/按月切片，展示最近 52 周/12 月的时段光谱。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                            <button onClick={() => setRidgePeriod('week')} className={`px-2 py-1 rounded-md transition-all ${ridgePeriod === 'week' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>周</button>
                            <button onClick={() => setRidgePeriod('month')} className={`px-2 py-1 rounded-md transition-all ${ridgePeriod === 'month' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>月</button>
                          </div>
                        </div>
                        <div className="max-h-[520px] overflow-y-auto m3-scrollbar">
                          <svg viewBox={`0 0 720 ${detailRidgeSeries.length * 16 + 20}`} className="w-full h-auto">
                            {detailRidgeSeries.map((slice, idx) => {
                              const baseY = 20 + idx * 16 + 12;
                              const amp = 10;
                              const points = Array.from(slice.counts).map((v, i) => {
                                const x = 40 + (i / 1439) * 640;
                                const y = baseY - (v / detailRidgeMax) * amp;
                                return `${x},${y}`;
                              }).join(' ');
                              return (
                                <g key={slice.label}>
                                  <polyline points={points} fill="none" stroke={detailEvent.color} strokeWidth="1.5" opacity={0.65} />
                                  {idx % 6 === 0 && (
                                    <text x={4} y={baseY} fontSize="9" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>{slice.label}</text>
                                  )}
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            泊松爆发指数
                            <span data-tip="B=(σ-μ)/(σ+μ)，范围 -1 到 1。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                            <button onClick={() => setBurstPeriod('week')} className={`px-2 py-1 rounded-md transition-all ${burstPeriod === 'week' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>周</button>
                            <button onClick={() => setBurstPeriod('month')} className={`px-2 py-1 rounded-md transition-all ${burstPeriod === 'month' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>月</button>
                          </div>
                        </div>
                        {detailBurstSeries.length < 2 ? (
                          <div className="text-xs text-gray-400">数据不足</div>
                        ) : (
                          <svg viewBox="0 0 720 220" className="w-full h-52">
                            {(() => {
                              const points = detailBurstSeries.map((s, i) => {
                                const x = 50 + (i / (detailBurstSeries.length - 1)) * 620;
                                const y = 180 - ((s.B + 1) / 2) * 140;
                                return `${x},${y}`;
                              }).join(' ');
                              return (
                                <>
                                  <line x1={50} y1={30} x2={50} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#374151' : '#e5e7eb'} />
                                  <line x1={50} y1={110} x2={690} y2={110} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="4" />
                                  <line x1={50} y1={30} x2={690} y2={30} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="4" />
                                  <line x1={50} y1={180} x2={690} y2={180} stroke={settings.darkMode ? '#4b5563' : '#d1d5db'} strokeDasharray="4" />
                                  <polyline points={points} fill="none" stroke={detailEvent.color} strokeWidth="2" />
                                  {detailBurstSeries.map((s, i) => {
                                    const x = 50 + (i / (detailBurstSeries.length - 1)) * 620;
                                    const y = 180 - ((s.B + 1) / 2) * 140;
                                    return (
                                      <circle key={s.label} cx={x} cy={y} r={3} fill={detailEvent.color} opacity={0.8} data-tip={`${s.label} · B=${s.B.toFixed(2)}`} />
                                    );
                                  })}
                                  <text x={18} y={180} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>-1</text>
                                  <text x={18} y={112} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>0</text>
                                  <text x={18} y={32} fontSize="10" fill={settings.darkMode ? '#9ca3af' : '#6b7280'}>1</text>
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            趋势图
                            <span data-tip="按日/周/月聚合的次数或时长趋势。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setTrendPeriod('day')} className={`px-2 py-1 rounded-md transition-all ${trendPeriod === 'day' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>日</button>
                              <button onClick={() => setTrendPeriod('week')} className={`px-2 py-1 rounded-md transition-all ${trendPeriod === 'week' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>周</button>
                              <button onClick={() => setTrendPeriod('month')} className={`px-2 py-1 rounded-md transition-all ${trendPeriod === 'month' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>月</button>
                            </div>
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setTrendMetric('count')} className={`px-2 py-1 rounded-md transition-all ${trendMetric === 'count' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>次数</button>
                              <button onClick={() => setTrendMetric('duration')} className={`px-2 py-1 rounded-md transition-all ${trendMetric === 'duration' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>时长</button>
                            </div>
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setTrendChartType('line')} className={`px-2 py-1 rounded-md transition-all ${trendChartType === 'line' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>折线</button>
                              <button onClick={() => setTrendChartType('bar')} className={`px-2 py-1 rounded-md transition-all ${trendChartType === 'bar' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>柱状</button>
                            </div>
                          </div>
                        </div>
                        <TrendChart data={detailTrendData} events={[detailEvent]} metric={trendMetric} darkMode={settings.darkMode} period={trendPeriod} chartType={trendChartType} />
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                          雷达图
                          <span data-tip="包含周分布与时钟雷达（按星期平均时长）。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white/60 dark:bg-black/10 rounded-2xl">
                            <WeeklyRadarChart sessions={detailSessions.filter(s => s.endTime)} darkMode={settings.darkMode} />
                          </div>
                          <div className="bg-white/60 dark:bg-black/10 rounded-2xl">
                            <ClockRadarChart sessions={detailSessions} darkMode={settings.darkMode} />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                          <HeatmapCalendar title="活跃频率" dataMap={detailHeatmapCount} color={detailEvent.color} unit="次" weekStart={settings.weekStart} darkMode={settings.darkMode} />
                        </div>
                        <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                          <HeatmapCalendar title="投入时间" dataMap={detailHeatmapDuration} color={detailEvent.color} unit="秒" weekStart={settings.weekStart} darkMode={settings.darkMode} />
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-[#2c3038] p-4 rounded-2xl">
                        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            光谱分布
                            <span data-tip="时段覆盖强度分布，可切换周期/维度/配色。" className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-gray-400 text-gray-500">i</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setSpectrumRange('7')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === '7' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>7天</button>
                              <button onClick={() => setSpectrumRange('30')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === '30' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>30天</button>
                              <button onClick={() => setSpectrumRange('all')} className={`px-2 py-1 rounded-md transition-all ${spectrumRange === 'all' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>全部</button>
                            </div>
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setSpectrumMode('1d')} className={`px-2 py-1 rounded-md transition-all ${spectrumMode === '1d' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>一维</button>
                              <button onClick={() => setSpectrumMode('2d')} className={`px-2 py-1 rounded-md transition-all ${spectrumMode === '2d' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>二维</button>
                            </div>
                            <div className="bg-white dark:bg-gray-700 p-0.5 rounded-lg flex text-xs">
                              <button onClick={() => setSpectrumPalette('mono')} className={`px-2 py-1 rounded-md transition-all ${spectrumPalette === 'mono' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>纯色</button>
                              <button onClick={() => setSpectrumPalette('thermal')} className={`px-2 py-1 rounded-md transition-all ${spectrumPalette === 'thermal' ? 'bg-gray-100 dark:bg-gray-600 shadow-sm text-[rgb(var(--theme-rgb))] font-bold' : 'text-gray-500'}`}>冷热色</button>
                            </div>
                          </div>
                        </div>
                        <DailyTimelineSpectrum
                          sessions={detailSpectrumBase}
                          compareSessions={detailSpectrumCompare}
                          showComparison={detailSpectrumShowCompare}
                          color={detailEvent.color}
                          mode={spectrumMode}
                          palette={spectrumPalette}
                        />
                      </div>
                    </div>
                    {chartTooltip && (
                      <div
                        className="pointer-events-none absolute z-50 bg-gray-900/90 text-white text-xs px-2 py-1 rounded-lg shadow-lg"
                        style={{ left: chartTooltip.x, top: chartTooltip.y }}
                      >
                        {chartTooltip.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {!detailEventId && chartTooltip && (
              <div
                className="pointer-events-none absolute z-50 bg-gray-900/90 text-white text-xs px-2 py-1 rounded-lg shadow-lg"
                style={{ left: chartTooltip.x, top: chartTooltip.y }}
              >
                {chartTooltip.text}
              </div>
            )}
          </div>
        )}

        {/* VIEW: SETTINGS */}
        {view === 'settings' && (
          <div className="max-w-2xl mx-auto animate-in fade-in pb-20">
            <h1 className="text-2xl font-bold mb-8">设置与管理</h1>

            {/* Account Management Card */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm mb-6">
              <h3 className="font-bold text-sm mb-4">账号与同步</h3>
              {user ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[rgba(var(--theme-rgb),0.2)] text-[rgb(var(--theme-rgb))] flex items-center justify-center font-bold">{user.email?.[0].toUpperCase() || 'U'}</div>
                    <div>
                      <div className="font-bold dark:text-white">{user.email || '匿名用户'}</div>
                      <div className="text-xs text-gray-400">用户ID: {user.uid.slice(0, 8)}...</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSync} disabled={syncing} className="flex-1 flex items-center justify-center gap-2 bg-[rgba(var(--theme-rgb),0.1)] dark:bg-[rgb(var(--theme-rgb))]/30 text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.8)] py-2 rounded-xl text-sm font-bold">
                      {syncing ? <Icons.Loader2 className="animate-spin" size={16} /> : <Icons.Cloud size={16} />} <span>同步云端数据</span>
                    </button>
                    <button onClick={handleClearLocalData} className="flex-1 flex items-center justify-center gap-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 py-2 rounded-xl text-sm font-bold">
                      <Icons.Trash2 size={16} /> <span>清空本地数据</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-2">高级修复工具</div>
                    <div className="flex gap-2">
                      <button onClick={handleDeduplicate} className="flex-1 flex items-center justify-center gap-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 py-2 rounded-xl text-sm font-bold">
                        <Icons.Scissors size={16} /> <span>去除重复</span>
                      </button>
                      <button onClick={handleOverwriteCloud} className="flex-1 flex items-center justify-center gap-2 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 py-2 rounded-xl text-sm font-bold">
                        <Icons.UploadCloud size={16} /> <span>覆盖云端</span>
                      </button>
                    </div>
                  </div>

                  <button onClick={() => signOut(auth)} className="w-full mt-2 flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
                    <Icons.LogOut size={16} /> 退出登录
                  </button>
                  <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                    提示：前端仅使用本地数据。点击“同步”将会在本地和云端之间双向合并数据。
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="flex justify-center mb-3 text-gray-300"><Icons.CloudOff size={32} /></div>
                  <p className="text-sm text-gray-500 mb-4">当前为离线模式，数据仅保存在本机。</p>
                  <button onClick={() => setShowAuthModal(true)} className="bg-[rgb(var(--theme-rgb))] hover:bg-[rgb(var(--theme-rgb))] text-white px-6 py-2 rounded-xl font-bold text-sm">登录 / 注册</button>
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <button onClick={handleClearLocalData} className="text-red-400 hover:text-red-500 text-xs flex items-center justify-center gap-1 mx-auto">
                      <Icons.Trash2 size={12} /> 清空本地数据
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Existing Settings (Create Event, General, etc.) */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm mb-6">
              <h3 className="font-bold text-sm mb-4">事件管理</h3>
              <button
                onClick={() => setEditingEventType({ id: 'new', name: '', color: DEFAULT_COLORS[0], archived: false, createdAt: '', goal: null })}
                className="w-full py-4 bg-[rgba(var(--theme-rgb),0.1)] dark:bg-[rgba(var(--theme-rgb),0.2)] border border-[rgba(var(--theme-rgb),0.2)] dark:border-[rgb(var(--theme-rgb))]/30 rounded-2xl flex items-center justify-center gap-2 text-[rgb(var(--theme-rgb))] dark:text-[rgba(var(--theme-rgb),0.8)] font-bold hover:bg-[rgba(var(--theme-rgb),0.2)] dark:hover:bg-[rgba(var(--theme-rgb),0.4)] transition-colors"
              >
                <Icons.PlusCircle size={20} />
                创建新事件
              </button>

              <div className="space-y-2 mt-4">
                {eventTypes.length === 0 && <div className="text-center text-gray-400 text-sm py-4">暂无事件，请创建</div>}
                {eventTypes.map(et => (
                  <div key={et.id} onClick={() => setEditingEventType(et)} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2c3038] rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-[#363b45] transition-colors border border-transparent hover:border-[rgba(var(--theme-rgb),0.4)] dark:hover:border-[rgb(var(--theme-rgb))]/50 group">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ backgroundColor: et.color }} />
                      <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-[rgb(var(--theme-rgb))] dark:group-hover:text-[rgba(var(--theme-rgb),0.8)] transition-colors">{et.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {et.goal && (
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 bg-white dark:bg-black/20 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-700">
                          {et.goal.type === 'negative' ? <span className="text-red-400">≤</span> : <span className="text-green-500">≥</span>}
                          <span>{et.goal.metric === 'duration' ? (et.goal.targetValue / 3600).toFixed(1) + '小时' : et.goal.targetValue}</span>
                          <span className="opacity-50">/ {et.goal.period === 'week' ? '周' : '月'}</span>
                        </div>
                      )}
                      <Icons.Edit2 size={14} className="text-gray-300 group-hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* General Settings */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-8">
              <div>
                <h3 className="font-bold text-sm mb-4 text-gray-900 dark:text-gray-100">界面外观</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">深色模式</span>
                    <button onClick={() => toggleSetting('darkMode', !settings.darkMode)} className="p-2 bg-white dark:bg-gray-600 rounded-lg shadow-sm text-gray-600 dark:text-yellow-400">
                      {settings.darkMode ? <Icons.Moon size={18} /> : <Icons.Sun size={18} />}
                    </button>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">主题强调色</div>
                    <div className="grid grid-cols-6 gap-3">
                      {DEFAULT_COLORS.slice(0, 6).map(c => (
                        <button
                          key={c}
                          onClick={() => toggleSetting('themeColor', c)}
                          className={`h-8 w-8 rounded-full transition-all ${settings.themeColor === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110' : 'hover:scale-105'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-4 text-gray-900 dark:text-gray-100">偏好设置</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">日历起始</span>
                    <button onClick={() => toggleSetting('weekStart', settings.weekStart === 1 ? 0 : 1)} className="bg-white dark:bg-gray-600 px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm text-gray-700 dark:text-gray-200">
                      {settings.weekStart === 1 ? '周一 (Monday)' : '周日 (Sunday)'}
                    </button>
                  </div>
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">停止模式</span>
                    <select value={settings.stopMode} onChange={e => toggleSetting('stopMode', e.target.value)} className="bg-white dark:bg-gray-600 px-2 py-1.5 rounded-lg text-sm font-medium shadow-sm text-gray-700 dark:text-gray-200 outline-none border-none">
                      <option value="quick">❤️ 点按即停（快速）</option>
                      <option value="interactive">📝 详细记录（详细）</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-4 text-gray-900 dark:text-gray-100">数据管理</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center justify-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <input type="file" accept=".json" onChange={importData} className="hidden" />
                    <Icons.Upload size={16} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">导入备份</span>
                  </label>
                  <button onClick={exportData} className="flex items-center justify-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <Icons.Download size={16} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">导出备份</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODALS */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onLoginSuccess={() => setShowAuthModal(false)} />}
      {editingSession && <SessionModal session={editingSession} eventTypes={eventTypes} onClose={() => setEditingSession(null)} onSave={handleUpdateSession} onDelete={handleDeleteSession} isAddMode={false} darkMode={settings.darkMode} />}
      {isAddMode && <SessionModal session={null} eventTypes={eventTypes} onClose={() => setIsAddMode(false)} onSave={handleAddSession} isAddMode={true} darkMode={settings.darkMode} />}
      {editingEventType && <EditEventModal eventType={editingEventType} onClose={() => setEditingEventType(null)} onSave={handleSaveEventType} onDelete={handleDeleteEvent} darkMode={settings.darkMode} />}
      {stoppingSessionId && <StopSessionModal onClose={() => setStoppingSessionId(null)} onStop={(n: string, inc: boolean, r: number) => handleStop(stoppingSessionId, n, inc, r)} />}
    </div>
  );
}
