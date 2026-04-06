import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { DashboardStats, DashboardChartData, Team, User } from '../types';
import { TrendingUp, Target, Users, ClipboardList, Zap, Activity, Shield, Clock } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend, PieChart, Pie } from 'recharts';
import { formatDate, toInputDateFormat, getPacificNow } from '../dateUtils';
import { getCachedData, setCachedData } from '../lib/apiCache';

type DashboardProps = {
  onSelectMember?: (memberId: string) => void;
};

export default function Dashboard({ onSelectMember }: DashboardProps) {
  const { token, user: currentUser, permissions } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<DashboardChartData | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allClients, setAllClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    team: '',
    user: '',
    client: '',
    dayFilter: 'this_month',
    customFrom: '',
    customTo: '',
    memberView: 'personal' as 'personal' | 'team'
  });

  const emptyChartData = useMemo<DashboardChartData>(() => ({
    dailyData: [],
    downtimeReasonData: [],
    recentDowntime: [],
    teamPerfData: [],
    userPerf: [],
    clientDistribution: [],
    departmentUserCount: []
  }), []);

  const getFilterDates = useCallback(() => {
    try {
      const now = getPacificNow();
      const today = toInputDateFormat(now);
      
      let from = '';
      let to = today;

      const dateCopy = new Date(now.getTime());

      switch (filters.dayFilter) {
        case 'today':
          from = today;
          break;
        case 'this_week': {
          const day = dateCopy.getDay();
          const diff = dateCopy.getDate() - day + (day === 0 ? -6 : 1);
          const firstDay = toInputDateFormat(new Date(dateCopy.setDate(diff)));
          from = firstDay;
          break;
        }
        case 'this_month': {
          from = toInputDateFormat(new Date(dateCopy.getFullYear(), dateCopy.getMonth(), 1));
          break;
        }
        case 'this_year': {
          from = toInputDateFormat(new Date(dateCopy.getFullYear(), 0, 1));
          break;
        }
        case 'last_3_months': {
          from = toInputDateFormat(new Date(dateCopy.getFullYear(), dateCopy.getMonth() - 2, 1));
          break;
        }
        case 'custom':
          from = filters.customFrom || '';
          to = filters.customTo || today;
          break;
      }
      return { from, to };
    } catch (err) {
      console.error('Error in getFilterDates:', err);
      return { from: '', to: toInputDateFormat(getPacificNow()) };
    }
  }, [filters.dayFilter, filters.customFrom, filters.customTo]);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['dashboard'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);

  const fetchData = useCallback(async (showLoading = true) => {
    if (!modulePerms.can_view || !token) return;
    
    if (showLoading) setIsLoading(true);
    setDashboardError(null);
    
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        team_id: filters.team || '',
        user_id: filters.user || '',
        client: filters.client || '',
        from: from || '',
        to: to || ''
      });

      // For members, always filter by their own user_id to show personal data
      if (currentUser?.role === 'member') {
        queryParams.set('user_id', currentUser.id);
        queryParams.set('team_id', currentUser.team_id || '');
      }

      // Use cache for static data
      const cachedTeams = getCachedData('teams');
      const cachedUsers = getCachedData('users');
      const cachedClients = getCachedData('clients');

      const fetchPromises: Promise<any>[] = [
        fetch(`/api/dashboard/stats?${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/dashboard/chart-data?${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } })
      ];

      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedUsers) fetchPromises.push(fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedClients) fetchPromises.push(fetch('/api/clients', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      const statsRes = results[resultIdx++];
      const chartRes = results[resultIdx++];
      
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      } else {
        const errorData = await statsRes.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to load dashboard stats');
      }

      if (chartRes.ok) {
        const charts = await chartRes.json();
        setChartData(charts);
      } else {
        const errorData = await chartRes.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to load dashboard chart data');
      }

      if (cachedTeams) {
        setTeams(cachedTeams);
      } else {
        const teamRes = results[resultIdx++];
        if (teamRes.ok) {
          const fetchedTeams = await teamRes.json();
          setTeams(fetchedTeams || []);
          setCachedData('teams', fetchedTeams);
          
          if (showLoading && currentUser && !filters.team) {
            if ((currentUser.role === 'tl' || currentUser.role === 'payment_posting') && fetchedTeams.length > 0) {
              const myTeams = fetchedTeams.filter((t: any) => t.team_leader_id === currentUser.id || t.id === currentUser.team_id);
              if (myTeams.length > 0) {
                setFilters(prev => ({ ...prev, team: myTeams[0].id }));
              }
            } else if (currentUser.role === 'member') {
              const userTeam = fetchedTeams.find((t: Team) => t.id === currentUser.team_id);
              setFilters(prev => ({ 
                ...prev, 
                team: currentUser.team_id || '',
                client: userTeam?.client_name || ''
              }));
            }
            // super_admin, admin, hr: no auto-team filter - show all data
          }
        }
      }

      if (cachedUsers) {
        setUsers(cachedUsers);
      } else {
        const userRes = results[resultIdx++];
        if (userRes.ok) {
          const fetchedUsers = await userRes.json();
          setUsers(fetchedUsers || []);
          setCachedData('users', fetchedUsers);
        }
      }

      if (cachedClients) {
        setAllClients(cachedClients);
      } else {
        const clientRes = results[resultIdx++];
        if (clientRes.ok) {
          const fetchedClients = await clientRes.json();
          setAllClients(fetchedClients || []);
          setCachedData('clients', fetchedClients);
        }
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setDashboardError(error instanceof Error ? error.message : 'Failed to load dashboard data');
      setChartData(emptyChartData);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [token, modulePerms.can_view, getFilterDates, filters.team, filters.user, filters.client, currentUser, emptyChartData]);

  useEffect(() => {
    fetchData(true);
    
    const interval = setInterval(() => {
      fetchData(false);
    }, 60000);
    
    const handleUpdate = () => fetchData(false);
    window.addEventListener('users-updated', handleUpdate);
    window.addEventListener('teams-updated', handleUpdate);
    window.addEventListener('production-updated', handleUpdate);
    window.addEventListener('clients-updated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('users-updated', handleUpdate);
      window.removeEventListener('teams-updated', handleUpdate);
      window.removeEventListener('production-updated', handleUpdate);
      window.removeEventListener('clients-updated', handleUpdate);
    };
  }, [fetchData]);

  const latestMe = useMemo(() => users.find(u => u.id === currentUser?.id) || currentUser, [users, currentUser]);
  const myTeam = useMemo(() => teams.find(t => t.id === latestMe?.team_id), [teams, latestMe]);

  const tlTeams = useMemo(() => {
    if (!currentUser || (currentUser.role !== 'tl' && currentUser.role !== 'payment_posting')) return [];
    // Include teams where TL is team_leader, plus their own team_id assignment
    const myTeams = teams.filter(t => t.team_leader_id === currentUser.id);
    if (currentUser.team_id && !myTeams.find(t => t.id === currentUser.team_id)) {
      const assignedTeam = teams.find(t => t.id === currentUser.team_id);
      if (assignedTeam) myTeams.push(assignedTeam);
    }
    return myTeams;
  }, [teams, currentUser]);

  const tlDepartments = useMemo(() => {
    // Departments are teams with no parent_id; find them from tlTeams' parent_ids
    const deptIds = new Set(tlTeams.map(t => t.parent_id).filter(Boolean));
    const directDepts = tlTeams.filter(t => !t.parent_id);
    const depts = teams.filter(t => deptIds.has(t.id) || directDepts.some(dt => dt.id === t.id));
    // Fallback: if no departments found but tlTeams exist, use the teams themselves as departments
    return depts.length > 0 ? depts : tlTeams.filter(t => !t.parent_id);
  }, [tlTeams, teams]);

  const resolvedChartData = chartData || emptyChartData;
  const dailyData = resolvedChartData.dailyData;
  const downtimeReasonData = resolvedChartData.downtimeReasonData;
  const recentDowntime = resolvedChartData.recentDowntime;
  const teamPerfData = resolvedChartData.teamPerfData;
  const userPerf = resolvedChartData.userPerf;
  const clientDistribution = resolvedChartData.clientDistribution;
  const departmentUserCount = resolvedChartData.departmentUserCount;

  const canPrefillProduction = useMemo(() => {
    if (currentUser?.role === 'super_admin') return true;
    return !!permissions?.['production']?.can_create;
  }, [currentUser?.role, permissions]);

  const handleMemberClick = useCallback((memberId?: string) => {
    if (!memberId || !onSelectMember || !canPrefillProduction) return;
    onSelectMember(memberId);
  }, [canPrefillProduction, onSelectMember]);

  const clients = useMemo(() => {
    // Get clients from teams (legacy/default)
    const teamClients = teams
      .filter(t => {
        if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') return t.team_leader_id === currentUser.id;
        if (currentUser?.role === 'member') return t.id === currentUser.team_id;
        if (filters.team) return t.id === filters.team;
        return true;
      })
      .map(t => t.client_name).filter(Boolean);

    // Get clients from clients table
    const dbClients = allClients
      .filter(c => {
        if (filters.team) return c.team_id === filters.team || c.team_id === null;
        if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') {
          const userTeams = teams.filter(t => t.team_leader_id === currentUser.id).map(t => t.id);
          return c.team_id === null || userTeams.includes(c.team_id);
        }
        if (currentUser?.role === 'member') return c.team_id === currentUser.team_id || c.team_id === null;
        return true;
      })
      .map(c => c.name);

    return Array.from(new Set([...teamClients, ...dbClients])) as string[];
  }, [teams, allClients, currentUser, filters.team]);

  const clientChartColors = useMemo(() => [
    'var(--accent-primary)',
    'var(--warning-color)',
    'var(--success-color)',
    '#ef4444',
    '#06b6d4',
    '#f97316',
  ], []);

  const kpis = useMemo(() => {
    if (currentUser?.role === 'member') {
      return [
        { label: 'My Entries', value: stats?.totalEntries || 0, icon: ClipboardList, color: 'var(--accent-primary)' },
        { label: 'My Production', value: (stats?.totalProduction || 0).toLocaleString(), icon: TrendingUp, color: 'var(--text-primary)' },
        { label: 'My Target', value: (stats?.totalTarget || 0).toLocaleString(), icon: Target, color: 'var(--text-primary)' },
        { label: 'My Downtime', value: `${stats?.totalDowntime || 0}h`, icon: Clock, color: 'var(--text-primary)' },
        { label: 'My Performance', value: `${Math.round(stats?.averagePerformance || 0)}%`, icon: Zap, color: 'var(--text-primary)' },
        { label: 'My Quality', value: `${Math.max(0, Math.round(stats?.averageQuality || 0))}%`, icon: Shield, color: 'var(--text-primary)' },
      ];
    }
    return [
      { label: currentUser?.role === 'tl' ? 'Team Entries' : 'Total Entries', value: stats?.totalEntries || 0, icon: ClipboardList, color: 'var(--accent-primary)' },
      { label: currentUser?.role === 'tl' ? 'Team Production' : 'Total Production', value: (stats?.totalProduction || 0).toLocaleString(), icon: TrendingUp, color: 'var(--text-primary)' },
      { label: currentUser?.role === 'tl' ? 'Team Target' : 'Total Target', value: (stats?.totalTarget || 0).toLocaleString(), icon: Target, color: 'var(--text-primary)' },
      { label: 'Total Downtime', value: `${stats?.totalDowntime || 0}h`, icon: Clock, color: 'var(--text-primary)' },
      { label: 'Avg Performance', value: `${Math.round(stats?.averagePerformance || 0)}%`, icon: Zap, color: 'var(--text-primary)' },
      { label: 'Avg Quality', value: `${Math.max(0, Math.round(stats?.averageQuality || 0))}%`, icon: Shield, color: 'var(--text-primary)' },
      { label: currentUser?.role === 'tl' ? 'My Teams' : 'Departments', value: stats?.teamCount || 0, icon: Users, color: 'var(--text-primary)' },
      { label: currentUser?.role === 'tl' ? 'Team Members' : 'Active Users', value: stats?.userCount || 0, icon: Activity, color: 'var(--text-primary)' },
    ];
  }, [stats, currentUser?.role]);

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view the dashboard.</p>
      </div>
    );
  }

  if (isLoading && (!stats || !chartData)) return <div className="flex items-center justify-center h-[60vh] text-text-3">Loading analytics...</div>;

  return (
    <div className="pb-10 pt-6 px-4 sm:px-8">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
                {currentUser?.role === 'tl' || currentUser?.role === 'payment_posting' || currentUser?.role === 'member' 
                  ? `Welcome, ${currentUser.full_name.split(' ')[0]}` 
                  : 'Dashboard'}
              </h1>
              <p className="text-text-3 text-xs mt-1">
                {currentUser?.role === 'tl' || currentUser?.role === 'payment_posting'
                  ? 'Overview of your team\'s performance and production' 
                  : currentUser?.role === 'member'
                    ? 'Your personal production and team overview'
                    : 'Production analytics & performance overview'}
              </p>
            </div>
            {isLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-brand border-t-transparent mt-1"></div>
            )}
          </div>
        </div>

        {dashboardError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {dashboardError}
          </div>
        )}

        {/* Filters */}
        <div className="sticky top-0 z-20 bg-surface border border-border rounded-xl p-4 sm:p-5 shadow-sm mb-6">

          <h3 className="text-xs font-bold uppercase tracking-widest text-text mb-4 text-left">Filters</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <div className="space-y-1.5 w-full">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">Department</label>
            {currentUser?.role === 'member' ? (
              <div className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] flex items-center justify-start text-xs text-text">
                {(() => {
                  const myTeam = teams.find(t => t.id === currentUser.team_id);
                  const parentDept = myTeam?.parent_id ? teams.find(t => t.id === myTeam.parent_id) : myTeam;
                  return parentDept?.name || 'No Department';
                })()}
              </div>
            ) : (
              <select 
                value={(() => {
                  const currentTeam = teams.find(t => t.id === filters.team);
                  return currentTeam?.parent_id || filters.team;
                })()}
                onChange={(e) => {
                  const newDeptId = e.target.value;
                  setFilters({...filters, team: newDeptId, user: ''});
                }}
                className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(currentUser?.role !== 'tl' && currentUser?.role !== 'payment_posting') && <option value="">All Departments</option>}
                {teams
                  .filter(t => !t.parent_id)
                  .filter(t => {
                    if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') return t.team_leader_id === currentUser.id || teams.some(st => st.parent_id === t.id && st.team_leader_id === currentUser.id);
                    return true;
                  })
                  .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>

          {(() => {
            const currentTeam = teams.find(t => t.id === filters.team);
            const currentDeptId = currentTeam?.parent_id || filters.team;
            const currentDept = teams.find(t => t.id === currentDeptId);
            
            if (currentDept?.name === 'AR' || currentUser?.role === 'member') {
              const subTeams = teams.filter(t => t.parent_id === currentDeptId);
              if (subTeams.length > 0 || currentUser?.role === 'member') {
                return (
                  <div className="space-y-1.5 w-full">
                    <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">Team</label>
                    {currentUser?.role === 'member' ? (
                      <div className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] flex items-center justify-start text-xs text-text">
                        {teams.find(t => t.id === currentUser.team_id)?.name || 'No Team'}
                      </div>
                    ) : (
                      <select 
                        value={filters.team}
                        onChange={(e) => setFilters({...filters, team: e.target.value, user: ''})}
                        className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand"
                      >
                        <option value={currentDeptId}>
                          {(currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') ? 'All My Teams' : `All ${currentDept?.name} Teams`}
                        </option>
                        {subTeams
                          .filter(t => {
                            if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') return t.team_leader_id === currentUser.id || t.id === currentUser.team_id;
                            return true;
                          })
                          .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                );
              }
            }
            return null;
          })()}

          <div className="space-y-1.5 w-full">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">Member</label>
            {currentUser?.role === 'member' ? (
              <div className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] flex items-center justify-start text-xs text-text">
                {currentUser.full_name}
              </div>
            ) : (
              <select 
                value={filters.user}
                onChange={(e) => setFilters({...filters, user: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand"
              >
                <option value="">All Members</option>
                {users
                  .filter(u => {
                    if (['admin', 'super_admin', 'hr'].includes(u.role)) return false;
                    if (filters.team && u.team_id !== filters.team) return false;
                    if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') {
                      const team = teams.find(t => t.id === u.team_id);
                      if (team?.team_leader_id !== currentUser.id) return false;
                    }
                    if (filters.client) {
                      const team = teams.find(t => t.id === u.team_id);
                      if (team?.client_name !== filters.client) return false;
                    }
                    return true;
                  })
                  .sort((a, b) => a.full_name.localeCompare(b.full_name))
                  .map(u => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.username})
                    </option>
                  ))}
              </select>
            )}
          </div>
          <div className="space-y-1.5 w-full">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">Client</label>
            {currentUser?.role === 'member' ? (
              <div className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] flex items-center justify-start text-xs text-text">
                {myTeam?.client_name || 'General'}
              </div>
            ) : (
              <select 
                value={filters.client}
                onChange={(e) => setFilters({...filters, client: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(currentUser?.role as string) === 'member'}
              >
                <option value="">All Clients</option>
                {clients.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
          <div className="space-y-1.5 w-full">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">Day Filter</label>
            <select 
              value={filters.dayFilter}
              onChange={(e) => setFilters({...filters, dayFilter: e.target.value})}
              className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand"
            >
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="this_year">This Year</option>
              <option value="last_3_months">Last 3 Months</option>
              <option value="custom">Custom Date</option>
            </select>
          </div>
          <div className="space-y-1.5 w-full">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4 opacity-0">Clear</label>
            <button
              onClick={() => {
                let defaultTeam = '';
                if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') {
                  const myTeams = teams.filter(t => t.team_leader_id === currentUser.id || t.id === currentUser.team_id);
                  if (myTeams.length > 0) defaultTeam = myTeams[0].id;
                } else if (currentUser?.role === 'member') {
                  defaultTeam = currentUser.team_id || '';
                }
                setFilters({ team: defaultTeam, user: '', client: '', dayFilter: 'this_month', customFrom: '', customTo: '', memberView: 'personal' });
              }}
              className="w-full bg-border-2 hover:bg-border text-text font-bold px-4 rounded-lg text-xs transition-all h-[34px] flex items-center justify-center"
            >
              Clear
            </button>
          </div>
          
          {filters.dayFilter === 'custom' && (
            <>
              <div className="space-y-1.5 w-full">
                <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">From</label>
                <input 
                  type="date" 
                  value={filters.customFrom}
                  onChange={(e) => setFilters({...filters, customFrom: e.target.value})}
                  className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand"
                />
              </div>
              <div className="space-y-1.5 w-full">
                <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider text-left block h-4">To</label>
                <input 
                  type="date" 
                  value={filters.customTo}
                  onChange={(e) => setFilters({...filters, customTo: e.target.value})}
                  className="w-full bg-bg border border-border rounded-lg px-3 h-[34px] text-xs text-text outline-none focus:border-brand"
                />
              </div>
            </>
          )}
          </div>
        </div>


      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-text-3 mb-2">{kpi.label}</div>
              <div className="text-xl sm:text-2xl font-bold tracking-tight text-text">{kpi.value}</div>
            </div>
            <div className="p-2 rounded-lg bg-bg/50 text-text-3">
              <kpi.icon size={16} className={i === 3 ? "text-brand" : ""} />
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Daily Production Trend</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                  itemStyle={{ color: 'var(--text-primary)', fontSize: '12px' }}
                />
                <Legend verticalAlign="top" align="center" iconType="square" wrapperStyle={{ fontSize: '10px', paddingBottom: '20px' }} />
                <Area name="Production" type="monotone" dataKey="production" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.1} strokeWidth={2} isAnimationActive={true} animationDuration={500} />
                <Area name="Target" type="monotone" dataKey="target" stroke="var(--warning-color)" fill="transparent" strokeDasharray="5 5" strokeWidth={1.5} isAnimationActive={true} animationDuration={500} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Performance % by Day</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} domain={[0, 120]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                  cursor={{ fill: 'var(--border-primary)' }}
                />
                <Bar dataKey="performance" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500}>
                  {dailyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.performance >= 100 ? 'var(--success-color)' : entry.performance >= 80 ? 'var(--warning-color)' : 'var(--error-color)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Downtime by Reason (Hours)</h3>
          <div className="h-[250px] sm:h-[280px]">
            {downtimeReasonData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={downtimeReasonData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" horizontal={true} vertical={false} />
                  <XAxis type="number" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} width={100} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                    cursor={{ fill: 'var(--border-primary)' }}
                  />
                  <Bar dataKey="value" fill="var(--error-color)" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-text-3 text-xs italic">
                No downtime recorded in this period
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Downtime Table */}
      {recentDowntime.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex justify-between items-center">
            <h3 className="text-xs font-bold text-text uppercase tracking-widest">Recent Downtime Events</h3>
            <Clock size={14} className="text-text-3" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-bg/50">
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-text-3">Date</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-text-3">Member</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-text-3">Department</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-text-3 text-right">Hours</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-text-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentDowntime.map((entry) => (
                  <tr key={entry.id} className="hover:bg-bg/30 transition-colors">
                    <td className="px-6 py-4 text-xs text-text">{formatDate(entry.date)}</td>
                    <td className="px-6 py-4 text-xs text-text font-medium">
                      {canPrefillProduction ? (
                        <button
                          type="button"
                          onClick={() => handleMemberClick(entry.user_id)}
                          className="text-left text-brand hover:text-brand-hover underline underline-offset-2 transition-colors"
                        >
                          {entry.user_name}
                        </button>
                      ) : (
                        entry.user_name
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-text-3">
                      {entry.parent_team_name ? (entry.team_name.startsWith(`${entry.parent_team_name} - `) ? entry.team_name : `${entry.parent_team_name} - ${entry.team_name}`) : entry.team_name}
                    </td>
                    <td className="px-6 py-4 text-xs text-text font-mono text-right">{entry.downtime}h</td>
                    <td className="px-6 py-4 text-xs text-text-3 italic">{entry.downtime_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Department-wise User Count</h3>
          <div className="h-[250px] sm:h-[280px]">
            {departmentUserCount.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departmentUserCount}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                    cursor={{ fill: 'var(--border-primary)' }}
                  />
                  <Bar dataKey="value" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-text-3 text-xs italic">
                No department user data available
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Client-wise Production Distribution</h3>
          <div className="h-[250px] sm:h-[280px]">
            {clientDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={clientDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    isAnimationActive={true}
                    animationDuration={500}
                  >
                    {clientDistribution.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={clientChartColors[index % clientChartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                  />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-text-3 text-xs italic">
                No client production data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${currentUser?.role === 'member' ? 'lg:col-span-3' : 'lg:col-span-2'} bg-surface border border-border rounded-2xl p-4 sm:p-6`}>
          <h3 className="text-xs font-bold text-text mb-6">Department Performance</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={teamPerfData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                />
                <Legend verticalAlign="top" align="center" iconType="square" wrapperStyle={{ fontSize: '10px', paddingBottom: '20px' }} />
                <Bar name="Production" dataKey="production" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500} />
                <Bar name="Target" dataKey="target" fill="var(--warning-color)" fillOpacity={0.4} radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {currentUser?.role !== 'member' && (
          <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
            <h3 className="text-xs font-bold text-text mb-6">Top Performers</h3>
            <div className="space-y-5">
              {userPerf.map((p, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-text-3">{i + 1}</span>
                      {canPrefillProduction ? (
                        <button
                          type="button"
                          onClick={() => handleMemberClick(p?.id)}
                          className="font-medium text-text hover:text-brand transition-colors underline underline-offset-2"
                        >
                          {p?.name}
                        </button>
                      ) : (
                        <span className="font-medium text-text">{p?.name}</span>
                      )}
                    </div>
                    <span className="font-bold text-brand text-[10px]">{p?.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${p!.pct >= 100 ? 'bg-success' : 'bg-warning'}`}
                      style={{ width: `${Math.min(p!.pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {userPerf.length === 0 && <div className="text-center py-10 text-text-3 text-xs">No data available</div>}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
