import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { User, Team } from '../types';
import { Users as UsersIcon, Shield, Mail, Hash, RefreshCw } from 'lucide-react';
import { getCachedData, setCachedData } from '../lib/apiCache';

export default function MyTeam() {
  const { token, user: currentUser } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const tlTeams = useMemo(() => {
    if (!currentUser) return [];
    return teams.filter(t => t.team_leader_id === currentUser.id || t.id === currentUser.team_id);
  }, [teams, currentUser]);

  const tlDepartments = useMemo(() => {
    const deptIds = new Set(tlTeams.map(t => t.parent_id).filter(Boolean));
    return teams.filter(t => deptIds.has(t.id));
  }, [tlTeams, teams]);

  const fetchMyData = useCallback(async (showLoading = true) => {
    if (currentUser?.role !== 'tl' && currentUser?.role !== 'payment_posting') return;
    if (showLoading) setIsLoading(true);
    try {
      const cachedTeams = getCachedData('teams');

      const fetchPromises: Promise<any>[] = [
        fetch('/api/my-team', { headers: { 'Authorization': `Bearer ${token}` } })
      ];

      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      const membersRes = results[resultIdx++];

      if (membersRes.ok) {
        setMembers(await membersRes.json());
      }

      if (cachedTeams) {
        setTeams(cachedTeams);
      } else {
        const teamsRes = results[resultIdx++];
        if (teamsRes.ok) {
          const data = await teamsRes.json();
          setTeams(data);
          setCachedData('teams', data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch team data', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [token, currentUser]);

  useEffect(() => {
    fetchMyData(true);
    
    // Poll for updates every 30 seconds to automatically reflect changes
    const interval = setInterval(() => {
      fetchMyData(false);
    }, 30000);
    
    const handleUpdate = () => fetchMyData(false);
    window.addEventListener('users-updated', handleUpdate);
    window.addEventListener('teams-updated', handleUpdate);
    window.addEventListener('clients-updated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('users-updated', handleUpdate);
      window.removeEventListener('teams-updated', handleUpdate);
      window.removeEventListener('clients-updated', handleUpdate);
    };
  }, [fetchMyData]);

  if (currentUser?.role !== 'tl' && currentUser?.role !== 'payment_posting') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">This page is restricted to Team Leaders.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">My Team</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            <p className="text-text-3 text-xs">View members assigned to your team and track your performance</p>
            {tlTeams.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-border" />
                <div className="flex items-center gap-1.5">
                  <Shield size={12} className="text-brand" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-text">
                    {tlDepartments.map(d => d.name).join(', ') || 'Department'}
                  </span>
                </div>
                <span className="w-1 h-1 rounded-full bg-border" />
                <div className="flex items-center gap-1.5">
                  <UsersIcon size={12} className="text-brand" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-text">
                    {tlTeams.map(t => t.name).join(', ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button 
            onClick={() => fetchMyData(true)}
            className="p-2.5 bg-surface border border-border hover:border-brand/50 rounded-xl text-text-3 hover:text-brand transition-all"
            title="Refresh Data"
          >
            <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center gap-2">
          <UsersIcon size={16} className="text-brand" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-text">
            Assigned Members ({members.filter(m => m.role === 'member' || !m.role || m.role === 'tl').length || members.length})
          </h3>
        </div>
        
        {isLoading ? (
          <div className="p-8 text-center text-text-3 text-sm">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-text-3 text-sm flex flex-col items-center">
            <UsersIcon size={32} className="mb-3 opacity-20" />
            <p>No members are currently assigned to you.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Member Name</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Username / ID</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Email</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Team</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-text flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs">
                        {member.full_name.charAt(0).toUpperCase()}
                      </div>
                      {member.full_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-3 font-mono">
                      <div className="flex items-center gap-1.5">
                        <Hash size={12} className="opacity-50" />
                        {member.username}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-3">
                      {member.email ? (
                        <div className="flex items-center gap-1.5">
                          <Mail size={12} className="opacity-50" />
                          {member.email}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-2 text-text-3 border border-border">
                        {member.team_name || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        member.is_active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                      }`}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
