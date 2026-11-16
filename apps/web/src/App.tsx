import { useEffect, useState, type FormEvent } from 'react';
import { ChildView } from './ChildView';
import { SchedulePages, activityLibrary } from './SchedulePages';
import { StaffPages } from './StaffPages';
import type { AppActions, AppData, ChildProfile, DailySchedule, Page, Preferences, ScheduleTask, StaffPage } from './model';

const storageKey = 'araw-frontend-demo-v1';
const navItems: { page: StaffPage; label: string; icon: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '/assets/figma-701fc.svg' },
  { page: 'profiles', label: 'Child Profiles', icon: '/assets/figma-5e608.svg' },
  { page: 'schedules', label: 'Schedules', icon: '/assets/figma-cc1cc.svg' },
  { page: 'progress', label: 'Progress', icon: '/assets/figma-3bc4a.svg' },
  { page: 'settings', label: 'Settings', icon: '/assets/figma-5cefd.svg' },
];

function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function offsetDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function seedTask(activityId: string, index: number, done: boolean, date: string): ScheduleTask {
  const activity = activityLibrary.find((item) => item.activityId === activityId) ?? activityLibrary[0]!;
  return { ...activity, id: `demo-${date}-${activityId}-${index}`, startTime: activityId === 'learning' ? '09:00' : '', duration: activityId === 'learning' ? 20 : null, status: done ? 'done' : 'pending' };
}

function initialData(): AppData {
  const children: ChildProfile[] = [
    { id: 1, name: 'Mika', age: 6, delayDomain: 'Speech', notes: '', avatar: 'happy' },
    { id: 2, name: 'Leo', age: 7, delayDomain: 'Motor', notes: '', avatar: 'play' },
    { id: 3, name: 'Ari', age: 5, delayDomain: 'General', notes: '', avatar: 'book' },
  ];
  const pattern = ['wake', 'brush', 'breakfast', 'dress', 'learning', 'play'];
  const history = [
    { offset: -6, count: 4, done: 4 }, { offset: -5, count: 4, done: 3 },
    { offset: -3, count: 5, done: 4 }, { offset: -2, count: 5, done: 5 },
    { offset: -1, count: 6, done: 4 }, { offset: 0, count: 6, done: 4 },
  ];
  const schedules: DailySchedule[] = history.map(({ offset, count, done }) => {
    const date = offsetDate(offset);
    return { id: `demo-mika-${date}`, childId: 1, date, tasks: pattern.slice(0, count).map((id, index) => seedTask(id, index, index < done, date)) };
  });
  const leoDate = offsetDate(0);
  schedules.push({ id: `demo-leo-${leoDate}`, childId: 2, date: leoDate, tasks: ['wake', 'brush', 'play', 'bed'].map((id, index) => seedTask(id, index, false, leoDate)) });
  return { children, schedules, preferences: { fontSize: 'small', contrast: 'normal', soundOn: false } };
}

function readData(): AppData {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as AppData;
      if (Array.isArray(parsed.children) && Array.isArray(parsed.schedules) && parsed.preferences) return parsed;
    }
  } catch { /* Continue with the built-in demo. */ }
  return initialData();
}

function pageFromHash(): Page {
  const requested = window.location.hash.slice(1);
  const pages: Page[] = ['dashboard', 'profiles', 'schedules', 'tasks', 'progress', 'settings', 'cards', 'child', 'login', 'register'];
  return pages.find((page) => page === requested) ?? 'dashboard';
}

function Brand({ reversed = false }: { reversed?: boolean }) {
  return <div className={`araw-brand ${reversed ? 'reversed' : ''}`}><img src={reversed ? '/assets/brand-mark-large.svg' : '/assets/brand-mark.svg'} alt="" /><span>Araw</span></div>;
}

function AuthScreen({ page, onPage, onLogin }: { page: 'login' | 'register'; onPage: (page: Page) => void; onLogin: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Caregiver');
  const [error, setError] = useState('');
  const register = page === 'register';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (register && password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (register && name.trim()) { try { window.localStorage.setItem('araw-staff-name-v1', name.trim()); } catch { /* Continue without persistence. */ } }
    onLogin();
  }
  return <main className="auth-page"><div className="auth-layout">
    <section className="auth-intro"><Brand reversed /><h1>A clear day,<br />one step at a time.</h1><p>Visual schedules and picture cards</p></section>
    <form className="auth-card" onSubmit={submit}><div className="auth-mobile-logo"><Brand /></div><h2>{register ? 'Create your account' : 'Welcome back'}</h2>{!register && <p>For caregivers, OTs and SPED teachers.</p>}
      {register && <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Mara Santos" /></label>}
      <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></label>
      <label>Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} placeholder="••••••••" /></label>
      {register && <><small>Use at least 8 characters.</small><fieldset><legend>Role</legend>{['Caregiver', 'OT', 'SPED Teacher'].map((item) => <label className={`auth-role ${role === item ? 'selected' : ''}`} key={item}><input type="radio" value={item} checked={role === item} onChange={() => setRole(item)} />{item}</label>)}</fieldset></>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit">{register ? 'Create account' : 'Log in'}</button><button className="button button-outline" type="button" onClick={() => { setError(''); onPage(register ? 'login' : 'register'); }}>{register ? 'Back to log in' : 'Create an account'}</button>
    </form>
  </div></main>;
}

export function App() {
  const [data, setData] = useState<AppData>(readData);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [selectedChildId, setSelectedChildId] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const today = localDate();
  let staffName = 'Mara Santos';
  try { staffName = window.localStorage.getItem('araw-staff-name-v1') || staffName; } catch { /* Keep the demo name. */ }

  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* Continue without persistence. */ } }, [data]);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
  }

  const actions: AppActions = {
    navigate,
    openChild: (childId) => { setSelectedChildId(childId); navigate('child'); },
    selectChild: setSelectedChildId,
    addChild: (child) => { setData((current) => { const id = Math.max(0, ...current.children.map((item) => item.id)) + 1; setSelectedChildId(id); return { ...current, children: [...current.children, { ...child, id }] }; }); },
    updateChild: (child) => setData((current) => ({ ...current, children: current.children.map((item) => item.id === child.id ? child : item) })),
    deleteChild: (id) => { setData((current) => ({ ...current, children: current.children.filter((item) => item.id !== id), schedules: current.schedules.filter((item) => item.childId !== id) })); if (selectedChildId === id) setSelectedChildId(data.children.find((item) => item.id !== id)?.id ?? 0); },
    updatePreferences: (preferences: Preferences) => setData((current) => ({ ...current, preferences })),
    updateSchedule: (schedule) => setData((current) => ({ ...current, schedules: [...current.schedules.filter((item) => !(item.childId === schedule.childId && item.date === schedule.date)), schedule] })),
    markTask: (childId, taskId, done, date = today) => setData((current) => ({ ...current, schedules: current.schedules.map((schedule) => schedule.childId === childId && schedule.date === date ? { ...schedule, tasks: schedule.tasks.map((task) => task.id === taskId ? { ...task, status: done ? 'done' : 'pending' } : task) } : schedule) })),
  };

  const rootClass = `app-root font-${data.preferences.fontSize} contrast-${data.preferences.contrast}`;
  if (page === 'login' || page === 'register') return <div className={rootClass}><AuthScreen page={page} onPage={navigate} onLogin={() => navigate('dashboard')} /></div>;
  if (page === 'child') return <div className={rootClass}><ChildView data={data} selectedChildId={selectedChildId} today={today} actions={actions} /></div>;

  return <div className={rootClass}>
    <header className="staff-header"><Brand /><span className="staff-workspace-label">Staff workspace</span><div className="staff-account"><span>{staffName}</span><span>Caregiver</span></div><button className="button button-outline staff-logout" onClick={() => navigate('login')}>Log out</button><button className="button button-outline staff-menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Close' : 'Menu'}</button></header>
    <div className="staff-layout"><nav className={`staff-nav ${menuOpen ? 'open' : ''}`} aria-label="Staff navigation"><div className="staff-nav-items">{navItems.map((item) => <button className={`staff-nav-link ${(page === item.page || (item.page === 'schedules' && page === 'tasks')) ? 'active' : ''}`} key={item.page} onClick={() => navigate(item.page)}><span className="staff-nav-icon"><img src={item.icon} alt="" /></span><span>{item.label}</span></button>)}<p>A clear day,<br />one step at a time.</p></div></nav>
      <main className="staff-main">{(page === 'schedules' || page === 'tasks') ? <SchedulePages page={page} data={data} selectedChildId={selectedChildId} today={today} actions={actions} /> : <StaffPages page={page} data={data} selectedChildId={selectedChildId} today={today} actions={actions} />}</main>
    </div>
  </div>;
}
