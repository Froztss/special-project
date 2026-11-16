export type StaffPage = 'dashboard' | 'profiles' | 'schedules' | 'tasks' | 'progress' | 'settings' | 'cards';
export type Page = StaffPage | 'child' | 'login' | 'register';

export interface ChildProfile {
  id: number;
  name: string;
  age: number;
  delayDomain: string;
  notes: string;
  avatar: string;
}

export interface ScheduleTask {
  id: string;
  activityId: string;
  name: string;
  icon: string;
  category: string;
  startTime: string;
  duration: number | null;
  status: 'pending' | 'done';
}

export interface DailySchedule {
  id: string;
  childId: number;
  date: string;
  tasks: ScheduleTask[];
}

export interface Preferences {
  fontSize: 'small' | 'medium' | 'large';
  contrast: 'normal' | 'high';
  soundOn: boolean;
}

export interface AppData {
  children: ChildProfile[];
  schedules: DailySchedule[];
  preferences: Preferences;
}

export interface AppActions {
  navigate: (page: Page) => void;
  openChild: (childId: number) => void;
  selectChild: (childId: number) => void;
  addChild: (child: Omit<ChildProfile, 'id'>) => void;
  updateChild: (child: ChildProfile) => void;
  deleteChild: (id: number) => void;
  updatePreferences: (preferences: Preferences) => void;
  updateSchedule: (schedule: DailySchedule) => void;
  markTask: (childId: number, taskId: string, done: boolean, date?: string) => void;
}

export interface SharedPageProps {
  data: AppData;
  selectedChildId: number;
  today: string;
  actions: AppActions;
}
