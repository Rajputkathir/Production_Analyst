export type UserRole = 'super_admin' | 'admin' | 'hr' | 'tl' | 'member' | 'payment_posting';

export interface User {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  role: UserRole;
  team_id?: string;
  team_name?: string;
  parent_team_name?: string;
  is_active: boolean;
}

export interface MemberDetails {
  id: string;
  name: string;
  department: string;
  department_id?: string;
  team: string;
  team_id?: string;
  client: string;
  reporting_to?: string;
}

export interface Permission {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface RolePermissions {
  [module: string]: Permission;
}

export interface UserSettings {
  theme: 'light' | 'dark';
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  client_name?: string;
  team_leader_id?: string;
  team_leader_name?: string;
  parent_id?: string;
  members?: User[];
  is_active: boolean;
}

export interface ProductionEntry {
  id: string;
  team_id: string;
  team_name: string;
  parent_team_name?: string;
  user_id: string;
  user_name: string;
  client_name?: string;
  date: string;
  production_value: number;
  target_value: number;
  quality?: string;
  quality_low?: number;
  quality_high?: number;
  notes?: string;
  downtime?: number;
  downtime_reason?: string;
  sample_production?: string;
  reporting_to?: string;
  is_locked: boolean;
}

export interface Target {
  id: string;
  team_id?: string;
  team_name?: string;
  parent_team_name?: string;
  user_id?: string;
  user_name?: string;
  target_value: number;
  period: 'daily' | 'weekly' | 'monthly';
  effective_date: string;
}

export interface DashboardStats {
  totalEntries: number;
  totalProduction: number;
  totalTarget: number;
  totalDowntime: number;
  averagePerformance: number;
  averageQuality: number;
  teamCount: number;
  userCount: number;
}

export interface DashboardDailyPoint {
  date: string;
  production: number;
  target: number;
  performance: number;
}

export interface DashboardDowntimeReason {
  name: string;
  value: number;
}

export interface DashboardRecentDowntime {
  id: string;
  date: string;
  user_id: string;
  user_name: string;
  team_name: string;
  parent_team_name?: string;
  downtime: number;
  downtime_reason?: string;
}

export interface DashboardTeamPerformance {
  id?: string;
  name: string;
  production: number;
  target: number;
}

export interface DashboardTopPerformer {
  id: string;
  name: string;
  pct: number;
  production: number;
  target: number;
}

export interface DashboardClientDistribution {
  name: string;
  value: number;
}

export interface DashboardDepartmentUserCount {
  id: string;
  name: string;
  value: number;
}

export interface DashboardChartData {
  dailyData: DashboardDailyPoint[];
  downtimeReasonData: DashboardDowntimeReason[];
  recentDowntime: DashboardRecentDowntime[];
  teamPerfData: DashboardTeamPerformance[];
  userPerf: DashboardTopPerformer[];
  clientDistribution: DashboardClientDistribution[];
  departmentUserCount: DashboardDepartmentUserCount[];
}

export interface Client {
  id: string;
  name: string;
  team_id?: string;
  is_active: boolean;
}
