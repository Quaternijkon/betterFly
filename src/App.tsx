import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Square, BarChart2, Clock, Settings, History, Edit2, Trash2, 
  Save, X, Plus, LayoutGrid, CheckCircle2, 
  User as UserIcon, Activity, Filter, ChevronDown, Check, 
  Calendar as CalendarIcon, Grid, List, Moon, Sun, Download, Upload,
  TrendingUp, FileText, PlusCircle, Hash, Zap, Coffee, Maximize
} from 'lucide-react';

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
}

interface Session {
  id: string;
  eventId: string;
  startTime: string; 
  endTime: string | null; 
  note?: string;
}

interface UserSettings {
  themeColor: string;
  weekStart: number;
  stopMode: 'quick' | 'note';
  darkMode: boolean;
}

// --- Constants ---
const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const STORAGE_KEYS = {
  SESSIONS: 'tracker_sessions',
  EVENTS: 'tracker_events',
  SETTINGS: 'tracker_settings'
};

// --- Utility Functions ---
const uuid = () => crypto.randomUUID();

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

// --- Sub-Components ---

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
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:border-blue-300 transition-colors shadow-sm dark:text-gray-200 w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-500 dark:text-gray-400" />
          <span>{label} ({selectedIds.length})</span>
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-full md:w-64 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-xl p-2 max-h-60 overflow-y-auto z-50">
          <button onClick={toggleAll} className="flex items-center gap-2 w-full p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
            <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedIds.length === options.length ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-500'}`}>
              {selectedIds.length === options.length && <Check size={10} className="text-white" />}
            </div>
            全选 / 清空
          </button>
          <div className="h-px bg-gray-100 dark:bg-gray-700 my-1" />
          {options.map((opt: any) => (
            <button key={opt.id} onClick={() => toggleOne(opt.id)} className="flex items-center gap-2 w-full p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
              <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedIds.includes(opt.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-500'}`}>
                {selectedIds.includes(opt.id) && <Check size={10} className="text-white" />}
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

const TrendChart = ({ data, events, metric, darkMode }: any) => {
  const height = 300;
  const width = 800;
  const padding = 40;
  
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

  return (
    <div className="w-full">
      <div className="w-full overflow-x-auto pb-4">
        <div className="min-w-[600px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto font-sans">
            {[0, 0.25, 0.5, 0.75, 1].map(t => {
              const y = height - padding - t * (height - padding * 2);
              return (
                <g key={t}>
                  <line x1={padding} y1={y} x2={width - padding} y2={y} stroke={darkMode ? "#374151" : "#e5e7eb"} strokeDasharray="4" />
                  <text x={padding - 10} y={y + 4} textAnchor="end" fontSize="10" fill={darkMode ? "#9ca3af" : "#6b7280"}>
                    {metric === 'duration' ? (maxY * t / 3600).toFixed(1) + 'h' : Math.floor(maxY * t)}
                  </text>
                </g>
              );
            })}
            {data.map((d: any, i: number) => {
              if (data.length > 10 && i % Math.ceil(data.length / 10) !== 0) return null;
              return <text key={i} x={getX(i)} y={height - 10} textAnchor="middle" fontSize="10" fill={darkMode ? "#9ca3af" : "#6b7280"}>{d.date.slice(5)}</text>;
            })}
            {lines.map((line: any) => (
              <polyline key={line.id} points={line.points} fill="none" stroke={line.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 hover:opacity-100 hover:stroke-[3px] transition-all" />
            ))}
          </svg>
        </div>
      </div>
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

const DailyTimelineSpectrum = ({ sessions, color, darkMode }: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const minuteCounts = new Int32Array(1440); 
    let maxOverlap = 0;

    sessions.forEach((s: any) => {
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

    for(let i=0; i<1440; i++) maxOverlap = Math.max(maxOverlap, minuteCounts[i]);
    if (maxOverlap === 0) maxOverlap = 1;

    const sliceWidth = width / 1440;
    for (let i = 0; i < 1440; i++) {
      const count = minuteCounts[i];
      if (count === 0) continue;
      const alpha = (count / maxOverlap).toFixed(2);
      ctx.fillStyle = color;
      ctx.globalAlpha = parseFloat(alpha);
      ctx.fillRect(i * sliceWidth, 0, Math.ceil(sliceWidth), height);
    }
  }, [sessions, color]);

  return (
    <div className="mt-6 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
      <h3 className="font-bold text-gray-700 dark:text-gray-200 text-sm mb-4 flex items-center gap-2">
        <Clock size={16} /> 24小时频率光谱 (00:00 - 24:00)
      </h3>
      <div className="relative h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden">
        <canvas ref={canvasRef} width={1440} height={60} className="w-full h-full block" />
        <div className="absolute bottom-0 left-0 w-full flex justify-between px-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono pointer-events-none mix-blend-multiply dark:mix-blend-screen">
          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
        </div>
      </div>
    </div>
  );
};

const HeatmapCalendar = ({ dataMap, color, title, unit, weekStart = 1, darkMode }: any) => {
  const [viewMode, setViewMode] = useState<'git' | 'year' | 'calendar'>('git');
  
  let maxVal = 0;
  dataMap.forEach((v: number) => maxVal = Math.max(maxVal, v));
  if (maxVal === 0) maxVal = 1;

  const getIntensity = (val: number) => {
    if (val === 0) return { opacity: 1, color: darkMode ? '#374151' : '#e5e7eb' };
    const ratio = Math.min(val / maxVal, 1);
    return { opacity: 0.3 + (ratio * 0.7), color };
  };

  const renderGitView = () => {
    const today = new Date(); today.setHours(0,0,0,0);
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
    const months = Array.from({length: 12}, (_, i) => i);
    return (
      <div className="space-y-1 overflow-x-auto pb-2">
        {months.map(month => {
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const days = Array.from({length: daysInMonth}, (_, i) => i + 1);
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
    const months = Array.from({length: 12}, (_, i) => i);
    const weekDays = weekStart === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'];

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {months.map(month => {
          const firstDay = new Date(year, month, 1);
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          let pad = (firstDay.getDay() - weekStart + 7) % 7;
          const blanks = Array(pad).fill(null);
          const days = Array.from({length: daysInMonth}, (_, i) => i + 1);

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
                  return <div key={key} className="w-full aspect-square rounded-[1px]" style={{ backgroundColor: bg, opacity: bg.startsWith('#') && bg !== color ? 1 : opacity }} />;
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
          <button onClick={() => setViewMode('git')} className={`p-1.5 rounded-md ${viewMode === 'git' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}><Grid size={14} /></button>
          <button onClick={() => setViewMode('year')} className={`p-1.5 rounded-md ${viewMode === 'year' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}><List size={14} /></button>
          <button onClick={() => setViewMode('calendar')} className={`p-1.5 rounded-md ${viewMode === 'calendar' ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}><CalendarIcon size={14} /></button>
        </div>
      </div>
      {viewMode === 'git' && renderGitView()}
      {viewMode === 'year' && renderYearView()}
      {viewMode === 'calendar' && renderCalendarView()}
    </div>
  );
};

const GoalRing = ({ goal, current, color, timeProgress }: any) => {
  const r1 = 18, r2 = 24;
  const c1 = 2 * Math.PI * r1, c2 = 2 * Math.PI * r2;
  
  let status: 'progress' | 'success' | 'fail' = 'progress';
  if (goal.type === 'positive') {
    if (current >= goal.targetValue) status = 'success';
  } else {
    if (current > goal.targetValue) status = 'fail';
    else if (timeProgress >= 1 && current <= goal.targetValue) status = 'success';
  }

  if (status === 'success') return <div className="absolute top-2 right-2 text-green-500 bg-white dark:bg-gray-800 rounded-full p-1 shadow-sm"><CheckCircle2 size={20} /></div>;
  if (status === 'fail') return <div className="absolute top-2 right-2 text-red-500 bg-white dark:bg-gray-800 rounded-full p-1 shadow-sm"><X size={20} /></div>;

  const pctGoal = Math.min(current / (goal.targetValue || 1), 1);
  const off1 = c1 * (1 - pctGoal);
  const off2 = c2 * (1 - timeProgress);

  return (
    <div className="absolute top-2 right-2 w-14 h-14 opacity-50">
      <svg className="w-full h-full -rotate-90">
        <circle cx="28" cy="28" r={r2} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-200 dark:text-gray-700" />
        <circle cx="28" cy="28" r={r2} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-400 dark:text-gray-500" strokeDasharray={c2} strokeDashoffset={off2} strokeLinecap="round" />
        <circle cx="28" cy="28" r={r1} stroke="currentColor" strokeWidth="3" fill="none" className="text-gray-200 dark:text-gray-700" />
        <circle cx="28" cy="28" r={r1} stroke={color} strokeWidth="3" fill="none" strokeDasharray={c1} strokeDashoffset={off1} strokeLinecap="round" />
      </svg>
    </div>
  );
};

const EditEventModal = ({ eventType, onClose, onSave, onDelete }: any) => {
  const [name, setName] = useState(eventType.name);
  const [color, setColor] = useState(eventType.color);
  const [goal, setGoal] = useState<Goal | null>(eventType.goal || null);

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl border dark:border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold dark:text-white">编辑事件</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full dark:text-gray-300"><X size={20} /></button>
        </div>
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">名称与颜色</label>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} className="flex-1 bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 rounded-lg px-3 py-2 dark:text-white" />
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-10 p-1 rounded cursor-pointer" />
            </div>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">目标设定</span>
              {goal ? <button onClick={() => setGoal(null)} className="text-xs text-red-500">移除目标</button> : <button onClick={() => setGoal({ type: 'positive', metric: 'count', period: 'week', targetValue: 5 })} className="text-xs text-blue-500">+ 添加目标</button>}
            </div>
            {goal && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <select value={goal.type} onChange={e => setGoal({...goal, type: e.target.value as any})} className="p-2 rounded bg-white dark:bg-gray-700 border dark:border-gray-600 dark:text-white"><option value="positive">正向 (至少)</option><option value="negative">负向 (至多)</option></select>
                <select value={goal.period} onChange={e => setGoal({...goal, period: e.target.value as any})} className="p-2 rounded bg-white dark:bg-gray-700 border dark:border-gray-600 dark:text-white"><option value="week">每周</option><option value="month">每月</option></select>
                <select value={goal.metric} onChange={e => setGoal({...goal, metric: e.target.value as any})} className="p-2 rounded bg-white dark:bg-gray-700 border dark:border-gray-600 dark:text-white"><option value="count">次数</option><option value="duration">时长(秒)</option></select>
                <input type="number" value={goal.targetValue} onChange={e => setGoal({...goal, targetValue: Number(e.target.value)})} className="p-2 rounded bg-white dark:bg-gray-700 border dark:border-gray-600 dark:text-white" />
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-50 dark:border-gray-700">
          <button onClick={() => { if(confirm('确定删除此事件及其所有记录？')) onDelete(eventType.id); }} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg text-sm"><Trash2 size={16} /> 删除</button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm dark:text-gray-300">取消</button>
            <button onClick={() => onSave(eventType.id, name, color, goal)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm">保存</button>
          </div>
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

  const handleSave = () => {
    if (!start) return;
    if (!eventId) return alert("请选择一个事件类型");
    const newStart = new Date(start);
    const newEnd = end ? new Date(end) : null;
    if (newEnd && newEnd < newStart) return alert("结束时间不能早于开始时间");
    onSave(session?.id, newStart.toISOString(), newEnd?.toISOString() || null, eventId, note);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl border dark:border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold dark:text-white">{isAddMode ? '补录记录' : '编辑记录'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full dark:text-gray-300"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">事件类型</label>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-700 dark:text-white">
              {eventTypes.map((et: any) => <option key={et.id} value={et.id}>{et.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">开始时间</label>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-700 dark:text-white"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">结束时间</label>
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-700 dark:text-white"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-700 dark:text-white" placeholder="记录一些心得..." />
          </div>
        </div>
        <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-50 dark:border-gray-700">
          {!isAddMode && <button onClick={() => { if(confirm('确定删除?')) onDelete(session.id); }} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"><Trash2 size={16} /> 删除</button>}
          <div className={`flex gap-3 ${isAddMode ? 'ml-auto' : ''}`}>
            <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm font-medium dark:text-gray-300">取消</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm"><Save size={16} /> 保存</button>
          </div>
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
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm" style={{ backgroundColor: color }}><Activity size={18} /></div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white">{eventType?.name || '未知事件'}</h4>
          <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {formatDuration(duration)}
          </div>
        </div>
      </div>
      <button onClick={() => onStop(session.id)} className="p-3 rounded-full hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-all z-10 border border-transparent hover:border-gray-100 dark:hover:border-gray-600"><Square size={20} className="fill-current" style={{ color }} /></button>
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<'home' | 'stats' | 'history' | 'settings'>('home');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [settings, setSettings] = useState<UserSettings>({ themeColor: '#3b82f6', weekStart: 1, stopMode: 'quick', darkMode: false });
  const [statsSelectedIds, setStatsSelectedIds] = useState<string[]>([]);
  const [historySelectedIds, setHistorySelectedIds] = useState<string[]>([]);
  const [trendMetric, setTrendMetric] = useState<'count' | 'duration'>('duration');
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingEventType, setEditingEventType] = useState<EventType | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [stoppingNote, setStoppingNote] = useState('');
  const [newEventName, setNewEventName] = useState('');
  const [newEventColor, setNewEventColor] = useState(DEFAULT_COLORS[0]);

  // --- Persistence ---
  useEffect(() => {
    const loadData = () => {
      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) setSettings(JSON.parse(storedSettings));
      const storedEvents = localStorage.getItem(STORAGE_KEYS.EVENTS);
      if (storedEvents) {
        const parsed = JSON.parse(storedEvents);
        setEventTypes(parsed);
        if (statsSelectedIds.length === 0) setStatsSelectedIds(parsed.map((e:any) => e.id));
        if (historySelectedIds.length === 0) setHistorySelectedIds(parsed.map((e:any) => e.id));
      }
      const storedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      if (storedSessions) setSessions(JSON.parse(storedSessions));
    };
    loadData();
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(eventTypes)); }, [eventTypes]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions)); }, [sessions]);

  const activeSessions = useMemo(() => sessions.filter(s => s.endTime === null), [sessions]);
  const activeEventIds = new Set(activeSessions.map(s => s.eventId));

  // --- Statistics Logic ---
  const calculateStats = (relevantSessions: Session[]) => {
    const finishedSessions = relevantSessions.filter(s => s.endTime);
    const totalCount = finishedSessions.length;
    const totalDuration = finishedSessions.reduce((acc, s) => acc + ((new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000), 0);
    const uniqueDates = [...new Set(finishedSessions.map(s => getDayKey(new Date(s.endTime!))))].sort();
    
    if (uniqueDates.length === 0) return { totalCount, totalDuration, currentStreak: 0, currentGap: 0, maxStreak: 0, maxGap: 0 };

    const parseDate = (str: string) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
    const dayDiff = (d1: Date, d2: Date) => Math.floor((d2.getTime() - d1.getTime()) / 86400000);

    let maxStreak = 1, maxGap = 0, tempStreak = 1;
    for (let i = 1; i < uniqueDates.length; i++) {
      const diff = dayDiff(parseDate(uniqueDates[i-1]), parseDate(uniqueDates[i]));
      if (diff === 1) tempStreak++;
      else {
        maxStreak = Math.max(maxStreak, tempStreak);
        tempStreak = 1;
        maxGap = Math.max(maxGap, diff - 1);
      }
    }
    maxStreak = Math.max(maxStreak, tempStreak);

    const todayStr = getDayKey(new Date());
    const yestStr = getDayKey(new Date(Date.now() - 86400000));
    const lastDateStr = uniqueDates[uniqueDates.length - 1];
    const today = new Date(); today.setHours(0,0,0,0);
    const lastDate = parseDate(lastDateStr);

    let currentStreak = 0, currentGap = 0;
    if (lastDateStr === todayStr || lastDateStr === yestStr) {
      currentStreak = 1;
      let curr = new Date(lastDate);
      curr.setDate(curr.getDate() - 1);
      while (uniqueDates.includes(getDayKey(curr))) { currentStreak++; curr.setDate(curr.getDate() - 1); }
    } else {
      currentGap = dayDiff(lastDate, today);
    }
    
    const gapSinceLast = dayDiff(lastDate, today);
    if (gapSinceLast > maxGap) maxGap = gapSinceLast;

    return { totalCount, totalDuration, currentStreak, currentGap, maxStreak, maxGap };
  };

  const getGoalStatus = (event: EventType) => {
    if (!event.goal) return null;
    const { metric, period, targetValue } = event.goal;
    const now = new Date();
    let start = new Date(now);
    if (period === 'week') {
      const day = start.getDay();
      const diff = (day - settings.weekStart + 7) % 7;
      start.setDate(start.getDate() - diff);
      start.setHours(0,0,0,0);
    } else { start.setDate(1); start.setHours(0,0,0,0); }
    const relSessions = sessions.filter(s => s.eventId === event.id && s.endTime && new Date(s.endTime) >= start);
    let current = metric === 'count' ? relSessions.length : relSessions.reduce((acc, s) => acc + ((new Date(s.endTime!).getTime() - new Date(s.startTime).getTime())/1000), 0);
    const endPeriod = new Date(start);
    if (period === 'week') endPeriod.setDate(endPeriod.getDate() + 7); else endPeriod.setMonth(endPeriod.getMonth() + 1);
    const timeProgress = Math.min(Math.max((now.getTime() - start.getTime()) / (endPeriod.getTime() - start.getTime()), 0), 1);
    return { current, targetValue, timeProgress };
  };

  const trendData = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    sessions.filter(s => s.endTime && statsSelectedIds.includes(s.eventId)).forEach(s => {
      const date = new Date(s.endTime!);
      let key = '';
      if (trendPeriod === 'day') key = getDayKey(date);
      else if (trendPeriod === 'week') {
        const d = new Date(date);
        d.setDate(d.getDate() - (d.getDay() - settings.weekStart + 7) % 7);
        key = getDayKey(d);
      } else key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      if (!map.has(key)) map.set(key, {});
      const val = trendMetric === 'count' ? 1 : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      map.get(key)![s.eventId] = (map.get(key)![s.eventId] || 0) + val;
    });
    return Array.from(map.entries()).map(([date, values]) => ({ date, values })).sort((a,b) => a.date.localeCompare(b.date));
  }, [sessions, statsSelectedIds, trendMetric, trendPeriod, settings.weekStart]);

  const getHeatmapData = (metric: 'count' | 'duration') => {
    const m = new Map<string, number>();
    sessions.filter(s => s.endTime && statsSelectedIds.includes(s.eventId)).forEach(s => {
      const key = getDayKey(new Date(s.endTime!));
      const val = metric === 'count' ? 1 : (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 1000;
      m.set(key, (m.get(key) || 0) + val);
    });
    return m;
  };

  const handleStart = (eventId: string) => {
    if (activeEventIds.has(eventId)) return;
    const newSession: Session = { id: uuid(), eventId, startTime: new Date().toISOString(), endTime: null };
    setSessions(prev => [newSession, ...prev]);
  };

  const handleStop = (id: string, noteStr: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, endTime: new Date().toISOString(), note: noteStr } : s));
    setStoppingSessionId(null); setStoppingNote('');
  };

  const handleCreateEvent = () => {
    if (!newEventName.trim()) return;
    const newEvent: EventType = { id: uuid(), name: newEventName.trim(), color: newEventColor, archived: false, createdAt: new Date().toISOString(), goal: null };
    setEventTypes(prev => [...prev, newEvent]);
    setNewEventName('');
  };

  const handleUpdateEvent = (id: string, name: string, color: string, goal: Goal | null) => {
    setEventTypes(prev => prev.map(e => e.id === id ? { ...e, name, color, goal } : e));
    setEditingEventType(null);
  };

  const handleDeleteEvent = (id: string) => {
    setEventTypes(prev => prev.filter(e => e.id !== id));
    setSessions(prev => prev.filter(s => s.eventId !== id));
    setEditingEventType(null);
  }

  const handleUpdateSession = (id: string, s: string, e: string | null, evId: string, n: string) => {
    setSessions(prev => prev.map(session => session.id === id ? { ...session, startTime: s, endTime: e, eventId: evId, note: n } : session));
    setEditingSession(null);
  }

  const handleAddSession = (_id: string, s: string, e: string | null, evId: string, n: string) => {
    const newSession = { id: uuid(), startTime: s, endTime: e, eventId: evId, note: n };
    setSessions(prev => [newSession, ...prev]);
    setIsAddMode(false);
  }

  const handleDeleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    setEditingSession(null);
  }

  const exportData = () => {
    const data = { settings, eventTypes, sessions };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tracker_backup.json'; a.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string);
        if (confirm('导入将覆盖当前数据，确定吗？')) {
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
    <div className={`${settings.darkMode ? 'dark' : ''} h-dvh w-full bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 font-sans flex flex-col md:flex-row overflow-hidden`}>
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-20 flex-col items-center border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-6 z-20">
        <div className="mb-8 font-bold text-xl text-blue-600 dark:text-blue-400">M.</div>
        <nav className="flex flex-col gap-6 w-full px-2">
          {[{ id: 'home', icon: LayoutGrid }, { id: 'history', icon: History }, { id: 'stats', icon: BarChart2 }, { id: 'settings', icon: Settings }].map(item => (
            <button key={item.id} onClick={() => setView(item.id as any)} className={`p-3 rounded-xl transition-all flex justify-center ${view === item.id ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              <item.icon size={24} />
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto overflow-x-hidden relative scroll-smooth">
        <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-6xl mx-auto">
          
          {/* Header for Mobile (Optional, can be integrated into views) */}
          <div className="md:hidden flex justify-between items-center mb-6">
             <div className="font-bold text-xl text-blue-600 dark:text-blue-400">M.</div>
             {/* User Icon or Settings shortcut could go here */}
          </div>

          {view === 'home' && (
            <div className="animate-in fade-in space-y-8">
              <header>
                <h1 className="text-2xl md:text-3xl font-bold mb-2">仪表盘</h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">追踪你的习惯与目标</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {eventTypes.filter(e => !e.archived).map(et => {
                  const isActive = activeEventIds.has(et.id);
                  const goalStat = getGoalStatus(et);
                  const stats = calculateStats(sessions.filter(s => s.eventId === et.id));
                  return (
                    <button key={et.id} onClick={() => handleStart(et.id)} disabled={isActive} className={`group relative p-5 rounded-2xl border transition-all text-left overflow-hidden h-36 flex flex-col justify-between shadow-sm ${isActive ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700 opacity-80 cursor-not-allowed' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 active:scale-[0.98]'}`}>
                      <div className="flex justify-between items-start w-full">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: et.color }} />
                        {goalStat && <GoalRing goal={et.goal} current={goalStat.current} color={et.color} timeProgress={goalStat.timeProgress} />}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 truncate pr-8">{et.name}</h3>
                        <div className="flex gap-2 mt-1.5">
                          {isActive ? <span className="text-xs font-medium text-green-600 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full flex items-center gap-1.5"><Activity size={12} /> 进行中</span> :
                            stats.currentStreak > 0 ? <span className="text-xs font-medium text-orange-500 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded-full flex items-center gap-1.5"><Zap size={12} /> 连胜 {stats.currentStreak}天</span> :
                            <span className="text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full flex items-center gap-1.5"><Coffee size={12} /> 中断 {stats.currentGap}天</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                <button onClick={() => setView('settings')} className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-800 transition-all text-gray-400 h-36 active:scale-[0.98]">
                  <Plus size={24} /><span className="text-sm font-medium mt-2">添加事件</span>
                </button>
              </div>

              {activeSessions.length > 0 && (
                <div className="animate-in slide-in-from-bottom-4 pt-4">
                  <div className="flex items-center gap-2 mb-4 text-gray-400 text-xs font-bold uppercase tracking-wider"><Activity size={14} /> 进行中</div>
                  <div className="space-y-3">
                    {activeSessions.map(s => <OngoingSessionCard key={s.id} session={s} eventType={eventTypes.find(e => e.id === s.eventId)} onStop={() => settings.stopMode === 'quick' ? handleStop(s.id, '') : setStoppingSessionId(s.id)} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'history' && (
            <div className="max-w-4xl mx-auto animate-in fade-in space-y-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h1 className="text-2xl font-bold">历史记录</h1>
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                   <button onClick={() => { setEditingSession(null); setIsAddMode(true); }} className="flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all"><PlusCircle size={18}/> 补录</button>
                   <div className="w-full sm:w-auto"><MultiSelectFilter options={eventTypes} selectedIds={historySelectedIds} onChange={setHistorySelectedIds} label="筛选" /></div>
                </div>
              </div>
              <div className="space-y-3">
                {sessions.filter(s => s.eventId && historySelectedIds.includes(s.eventId)).map(s => {
                   const et = eventTypes.find(e => e.id === s.eventId);
                   const duration = !s.endTime ? (Date.now()-new Date(s.startTime).getTime())/1000 : ((new Date(s.endTime).getTime())-(new Date(s.startTime).getTime()))/1000;
                   return (
                    <div key={s.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between group gap-4">
                      <div className="flex items-start gap-4">
                        <div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: et?.color }} />
                        <div>
                          <div className="flex items-center gap-2 mb-1"><span className="font-bold text-gray-800 dark:text-gray-200">{et?.name}</span>{!s.endTime && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-md font-bold">进行中</span>}</div>
                          <div className="font-mono text-sm text-gray-600 dark:text-gray-400 mb-1">{formatDuration(duration)}</div>
                          <div className="text-xs text-gray-400">{new Date(s.startTime).toLocaleString()} {s.endTime ? ` - ${new Date(s.endTime).toLocaleTimeString()}` : ''}</div>
                          {s.note && <div className="mt-2 text-xs text-gray-500 bg-gray-50 dark:bg-gray-700/50 p-2 rounded italic break-words"><FileText size={10} className="inline mr-1"/>{s.note}</div>}
                        </div>
                      </div>
                      <button onClick={() => { setEditingSession(s); setIsAddMode(false); }} className="p-2 text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 bg-gray-50 sm:bg-transparent rounded-lg self-end sm:self-center"><Edit2 size={18} /></button>
                    </div>
                   );
                })}
              </div>
            </div>
          )}

          {view === 'stats' && (
            <div className="max-w-5xl mx-auto animate-in fade-in space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h1 className="text-2xl font-bold">趋势与分析</h1>
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center w-full md:w-auto">
                  <div className="flex bg-white dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm w-full sm:w-auto">
                    {['day', 'week', 'month'].map(p => <button key={p} onClick={() => setTrendPeriod(p as any)} className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg uppercase transition-all ${trendPeriod === p ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{p === 'day' ? '日' : p === 'week' ? '周' : '月'}</button>)}
                  </div>
                  <div className="w-full sm:w-auto"><MultiSelectFilter options={eventTypes} selectedIds={statsSelectedIds} onChange={setStatsSelectedIds} label="事件" /></div>
                </div>
              </div>

              {/* Detailed Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statsSelectedIds.length > 1 && (
                  <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm border-l-4 border-l-gray-500">
                    <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2"><CheckCircle2 size={18} className="text-gray-500"/> 合并统计</h4>
                    {(() => {
                      const stats = calculateStats(sessions.filter(s => s.eventId && statsSelectedIds.includes(s.eventId)));
                      return (
                        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                          <div className="flex justify-between items-center"><span>总次数</span><span className="font-mono font-bold dark:text-white text-base">{stats.totalCount}</span></div>
                          <div className="flex justify-between items-center"><span>总时长</span><span className="font-mono font-bold dark:text-white text-base">{(stats.totalDuration/3600).toFixed(1)}h</span></div>
                          <div className="flex justify-between items-center"><span>最长连胜</span><span className="font-mono font-bold dark:text-white text-base">{stats.maxStreak}天</span></div>
                          <div className="flex justify-between items-center"><span>最长中断</span><span className="font-mono font-bold dark:text-white text-base">{stats.maxGap}天</span></div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {eventTypes.filter(e => statsSelectedIds.includes(e.id)).map(et => {
                  const stats = calculateStats(sessions.filter(s => s.eventId === et.id));
                  return (
                    <div key={et.id} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm" style={{ borderLeft: `4px solid ${et.color}` }}>
                      <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2 truncate">{et.name}</h4>
                      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                        <div className="flex justify-between items-center"><span className="flex gap-1.5 items-center"><Hash size={14}/> 总次数</span><span className="font-mono font-bold dark:text-white text-base">{stats.totalCount}</span></div>
                        <div className="flex justify-between items-center"><span className="flex gap-1.5 items-center"><Clock size={14}/> 总时长</span><span className="font-mono font-bold dark:text-white text-base">{(stats.totalDuration/3600).toFixed(1)}h</span></div>
                        <div className="flex justify-between items-center"><span className="flex gap-1.5 items-center"><Zap size={14}/> 最长连胜</span><span className="font-mono font-bold dark:text-white text-base">{stats.maxStreak}天</span></div>
                        <div className="flex justify-between items-center"><span className="flex gap-1.5 items-center"><Maximize size={14}/> 最长中断</span><span className="font-mono font-bold dark:text-white text-base">{stats.maxGap}天</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold flex items-center gap-2"><TrendingUp size={18}/> 趋势图</h3>
                  <div className="flex gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                     <button onClick={() => setTrendMetric('duration')} className={`px-3 py-1 text-xs rounded-md transition-all ${trendMetric === 'duration' ? 'bg-white dark:bg-gray-600 shadow-sm font-bold text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>时长</button>
                     <button onClick={() => setTrendMetric('count')} className={`px-3 py-1 text-xs rounded-md transition-all ${trendMetric === 'count' ? 'bg-white dark:bg-gray-600 shadow-sm font-bold text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>次数</button>
                  </div>
                </div>
                <TrendChart data={trendData} events={eventTypes.filter(e => statsSelectedIds.includes(e.id))} metric={trendMetric} period={trendPeriod} darkMode={settings.darkMode} />
              </div>

              <div className="space-y-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                   <HeatmapCalendar title="活跃频率 (次数)" dataMap={getHeatmapData('count')} color={settings.themeColor} unit="次" weekStart={settings.weekStart} darkMode={settings.darkMode} />
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                   <HeatmapCalendar title="投入时间 (时长)" dataMap={getHeatmapData('duration')} color={settings.themeColor} unit="秒" weekStart={settings.weekStart} darkMode={settings.darkMode} />
                </div>
              </div>

              <DailyTimelineSpectrum sessions={sessions.filter(s => s.endTime && statsSelectedIds.includes(s.eventId!))} color={settings.themeColor} darkMode={settings.darkMode} />
            </div>
          )}

          {view === 'settings' && (
            <div className="max-w-2xl mx-auto animate-in fade-in space-y-6 pb-20">
              <h1 className="text-2xl font-bold mb-8">设置与管理</h1>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-bold text-sm mb-4">创建新事件</h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="事件名称" className="flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                  <div className="flex gap-2 items-center">
                    <div className="flex gap-1">{DEFAULT_COLORS.slice(0, 4).map(c => <button key={c} onClick={() => setNewEventColor(c)} className={`w-8 h-8 rounded-full border-2 transition-transform ${newEventColor === c ? 'border-gray-400 scale-110' : 'border-transparent'}`} style={{backgroundColor: c}} />)}</div>
                    <button onClick={handleCreateEvent} disabled={!newEventName} className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold px-6 py-2.5 rounded-xl disabled:opacity-50 transition-all whitespace-nowrap">创建</button>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                 <h3 className="font-bold text-sm mb-4">现有事件</h3>
                 <div className="space-y-2">
                   {eventTypes.map(et => (
                     <div key={et.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                       <div className="flex items-center gap-3 overflow-hidden">
                         <div className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor: et.color}}/>
                         <span className="dark:text-white font-medium truncate">{et.name}</span>
                         {et.goal && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap">有目标</span>}
                       </div>
                       <button onClick={() => setEditingEventType(et)} className="text-sm text-blue-600 hover:underline px-2">编辑</button>
                     </div>
                   ))}
                 </div>
              </div>

              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-6">
                 <h3 className="font-bold text-sm">通用设置</h3>
                 <div className="flex justify-between items-center">
                   <span>深色模式</span>
                   <button onClick={() => setSettings(s => ({...s, darkMode: !s.darkMode}))} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg transition-colors">{settings.darkMode ? <Moon size={20}/> : <Sun size={20}/>}</button>
                 </div>
                 <div className="flex justify-between items-center">
                   <div><span>停止模式</span><div className="text-xs text-gray-400">选择填写备注的方式</div></div>
                   <select value={settings.stopMode} onChange={e => setSettings(s => ({...s, stopMode: e.target.value as any}))} className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg text-sm outline-none border-r-8 border-transparent"><option value="quick">快速停止</option><option value="note">弹窗填写</option></select>
                 </div>
                 <div className="flex justify-between items-center">
                   <span>日历起始</span>
                   <button onClick={() => setSettings(s => ({...s, weekStart: s.weekStart === 1 ? 0 : 1}))} className="bg-gray-100 dark:bg-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors w-24">{settings.weekStart === 1 ? '周一' : '周日'}</button>
                 </div>
              </div>

              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                 <h3 className="font-bold text-sm mb-4">数据管理</h3>
                 <div className="flex flex-col sm:flex-row gap-4">
                   <button onClick={exportData} className="flex-1 flex items-center justify-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 py-3 rounded-xl font-bold transition-transform active:scale-[0.98]"><Download size={18}/> 导出备份</button>
                   <label className="flex-1 flex items-center justify-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 py-3 rounded-xl font-bold cursor-pointer transition-transform active:scale-[0.98]"><Upload size={18}/> 恢复备份<input type="file" accept=".json" onChange={importData} className="hidden" /></label>
                 </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-around items-center h-16 z-50 px-2 safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {[{ id: 'home', icon: LayoutGrid, label: '主页' }, { id: 'history', icon: History, label: '历史' }, { id: 'stats', icon: BarChart2, label: '统计' }, { id: 'settings', icon: Settings, label: '设置' }].map(item => (
          <button key={item.id} onClick={() => setView(item.id as any)} className={`flex flex-col items-center justify-center w-full h-full gap-1 ${view === item.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
            <item.icon size={20} className={view === item.id ? 'fill-current opacity-20' : ''} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* MODALS */}
      {editingSession && <SessionModal session={editingSession} eventTypes={eventTypes} onClose={() => setEditingSession(null)} onSave={handleUpdateSession} onDelete={handleDeleteSession} isAddMode={false} darkMode={settings.darkMode} />}
      
      {isAddMode && <SessionModal session={null} eventTypes={eventTypes} onClose={() => setIsAddMode(false)} onSave={handleAddSession} isAddMode={true} darkMode={settings.darkMode} />}
      
      {editingEventType && <EditEventModal eventType={editingEventType} onClose={() => setEditingEventType(null)} onSave={handleUpdateEvent} onDelete={handleDeleteEvent} darkMode={settings.darkMode} />}

      {stoppingSessionId && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl w-full max-w-sm border dark:border-gray-700 shadow-2xl">
            <h3 className="text-lg font-bold mb-4 dark:text-white">记录心得?</h3>
            <textarea autoFocus value={stoppingNote} onChange={e => setStoppingNote(e.target.value)} className="w-full p-3 border rounded-xl mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-white" rows={3} placeholder="可选备注..." />
            <button onClick={() => handleStop(stoppingSessionId, stoppingNote)} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors">完成</button>
          </div>
        </div>
      )}
    </div>
  );
}