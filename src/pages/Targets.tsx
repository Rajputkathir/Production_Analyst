import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { Target, Team, User } from '../types';
import { Plus, Trash2, Shield, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationModal from '../components/ConfirmationModal';
import { formatDate, toInputDateFormat, getPacificNow } from '../dateUtils';
import { getCachedData, setCachedData, clearCache } from '../lib/apiCache';

export default function Targets() {
  const { token, user: currentUser, permissions } = useAuth();
  const [targets, setTargets] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const currentTargets = useMemo(() => {
    // Filter teams to show only sub-teams or departments without children
    const filteredTeams = teams.filter(team => {
      const hasChildren = teams.some(t => t.parent_id === team.id);
      return team.parent_id || !hasChildren;
    });

    return filteredTeams.map(team => {
      const teamTargets = targets.filter(t => t.team_id === team.id);
      const latestTarget = teamTargets.sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
      
      let displayName = team.name;
      if (team.parent_id) {
        const parent = teams.find(p => p.id === team.parent_id);
        if (parent) {
          const prefix = `${parent.name} - `;
          // Case-insensitive check for prefix
          if (!team.name.toUpperCase().startsWith(prefix.toUpperCase())) {
            displayName = `${prefix}${team.name}`;
          }
        }
      }

      return {
        team: { ...team, name: displayName },
        target: latestTarget
      };
    });
  }, [teams, targets]);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['targets'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);
  const [formData, setFormData] = useState({
    team_id: '',
    user_id: '',
    target_value: 1000,
    period: 'daily' as const,
    effective_date: toInputDateFormat(getPacificNow())
  });
  const [users, setUsers] = useState<User[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    const handleHighlight = (e: any) => {
      const id = e.detail;
      setHighlightedId(id);
      setTimeout(() => {
        const element = document.getElementById(`target-${id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
      setTimeout(() => setHighlightedId(null), 5000);
    };

    window.addEventListener('highlight-target', handleHighlight);
    
    // Check session storage for initial highlight
    const storedId = sessionStorage.getItem('highlightTargetId');
    if (storedId) {
      setHighlightedId(storedId);
      sessionStorage.removeItem('highlightTargetId');
      setTimeout(() => {
        const element = document.getElementById(`target-${storedId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
      setTimeout(() => setHighlightedId(null), 5000);
    }

    return () => window.removeEventListener('highlight-target', handleHighlight);
  }, []);

  useEffect(() => {
    if ((formData.team_id || formData.user_id) && formData.effective_date) {
      const existing = targets.find(t => 
        (formData.user_id ? t.user_id === formData.user_id : t.team_id === formData.team_id) && 
        t.effective_date === formData.effective_date
      );
      if (existing) {
        setFormData(prev => ({
          ...prev,
          target_value: existing.target_value,
          period: existing.period as any
        }));
        setIsUpdating(true);
      } else {
        if (isUpdating) {
          setFormData(prev => ({
            ...prev,
            target_value: 1000,
            period: 'daily'
          }));
        }
        setIsUpdating(false);
      }
    }
  }, [formData.team_id, formData.user_id, formData.effective_date, targets]);

  const openEdit = (target: Target) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    setFormData({
      team_id: target.team_id || '',
      user_id: target.user_id || '',
      target_value: target.target_value,
      period: target.period as any,
      effective_date: target.effective_date
    });
    setIsEditMode(true);
    setIsModalOpen(true);
  };

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    try {
      const cachedTeams = getCachedData('teams');
      const cachedUsers = getCachedData('users');

      const fetchPromises: Promise<any>[] = [
        fetch('/api/targets', { headers: { 'Authorization': `Bearer ${token}` } })
      ];

      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedUsers) fetchPromises.push(fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      const tgtRes = results[resultIdx++];
      if (tgtRes.ok) setTargets(await tgtRes.json());

      if (cachedTeams) {
        setTeams(cachedTeams);
      } else {
        const teamRes = results[resultIdx++];
        if (teamRes.ok) {
          const data = await teamRes.json();
          setTeams(data);
          setCachedData('teams', data);
        }
      }

      if (cachedUsers) {
        setUsers(cachedUsers);
      } else {
        const userRes = results[resultIdx++];
        if (userRes.ok) {
          const data = await userRes.json();
          setUsers(data);
          setCachedData('users', data);
        }
      }
    } catch (error) {
      toast.error('Failed to fetch data');
    }
  }, [token, modulePerms.can_view]);

  useEffect(() => {
    fetchData();
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('teams-updated', fetchData);
    return () => {
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('teams-updated', fetchData);
    };
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modulePerms.can_create) return toast.error('No permission to create');

    // Validation: If a department has sub-teams (like AR), a sub-team MUST be selected
    const selectedTeam = teams.find(t => t.id === formData.team_id);
    const hasChildren = teams.some(t => t.parent_id === formData.team_id);
    
    if (hasChildren && !formData.user_id) {
      return toast.error(`Please select a specific team under ${selectedTeam?.name}`);
    }

    try {
      const response = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        toast.success(isUpdating || isEditMode ? 'Target updated successfully' : 'Target set successfully');
        clearCache('targets');
        setIsModalOpen(false);
        setFormData({ team_id: '', user_id: '', target_value: 1000, period: 'daily', effective_date: toInputDateFormat(getPacificNow()) });
        setIsUpdating(false);
        setIsEditMode(false);
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to save target');
    }
  };

  const handleDelete = async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/targets/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Target deleted');
        clearCache('targets');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete');
      }
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view targets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Targets</h1>
          <p className="text-text-3 mt-1 text-xs">Set production targets for teams and users</p>
        </div>
        {modulePerms.can_create && (
          <button
            onClick={() => {
              setIsEditMode(false);
              setFormData({ team_id: '', user_id: '', target_value: 1000, period: 'daily', effective_date: toInputDateFormat(getPacificNow()) });
              setIsModalOpen(true);
            }}
            className="w-full sm:w-auto bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            Set Target
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {currentTargets.map(({ team, target }, idx) => (
          <div key={`${team.id}-${idx}`} className="bg-surface border border-border rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-3 mb-1">{team.name}</div>
              <div className="text-2xl font-bold text-text">
                {target ? target.target_value.toLocaleString() : '—'}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${target ? 'bg-brand/10 text-brand' : 'bg-error/10 text-error'}`}>
                {target ? target.period : 'No Target Set'}
              </span>
              {target && <span className="text-[10px] text-text-3 font-mono">{formatDate(target.effective_date)}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-secondary">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text">Target History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-bg-secondary border-b border-border">
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Target For</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Target Value</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Period</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Effective Date</th>
              {(modulePerms.can_edit || modulePerms.can_delete) && <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {targets.map((target, idx) => {
              const parentName = target.parent_team_name;
              const teamName = target.team_name;
              const prefix = parentName ? `${parentName} - ` : '';
              const displayName = parentName ? (teamName.toUpperCase().startsWith(prefix.toUpperCase()) ? teamName : `${prefix}${teamName}`) : teamName;

              return (
                <tr 
                  key={`${target.id}-${idx}`} 
                  id={`target-${target.id}`}
                  className={`hover:bg-bg-secondary/50 transition-all duration-500 ${
                    highlightedId === target.id ? 'bg-brand/20 ring-2 ring-brand ring-inset' : ''
                  }`}
                >
                  <td className="px-6 py-4 text-sm text-text">
                    {target.user_name ? (
                      <div className="flex flex-col">
                        <span className="font-bold">{target.user_name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-text-3">Individual Target</span>
                        <span className="text-[9px] text-text-3 italic">
                          {displayName}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <span>{displayName}</span>
                        <span className="text-[10px] uppercase tracking-wider text-text-3">Team Target</span>
                      </div>
                    )}
                  </td>
                <td className="px-6 py-4 text-sm font-mono text-right text-brand font-bold">{target.target_value.toLocaleString()}</td>
                <td className="px-6 py-4 text-center">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-2 text-text-3 border border-border">
                    {target.period}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-text-3">{formatDate(target.effective_date)}</td>
                {(modulePerms.can_edit || modulePerms.can_delete) && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {modulePerms.can_edit && (
                        <button onClick={() => openEdit(target)} className="p-2 hover:bg-brand/10 rounded-lg text-text-3 hover:text-brand transition-colors">
                          <Edit2 size={16} />
                        </button>
                      )}
                      {modulePerms.can_delete && (
                        <button onClick={() => handleDelete(target.id)} className="p-2 hover:bg-error/10 rounded-lg text-text-3 hover:text-error transition-colors">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-8 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 text-text">{isEditMode ? 'Edit Target' : 'Set Target'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Department</label>
                    <select
                      value={(() => {
                        const currentTeam = teams.find(t => t.id === formData.team_id);
                        return currentTeam?.parent_id || formData.team_id;
                      })()}
                      onChange={(e) => {
                        const newDeptId = e.target.value;
                        setFormData({ ...formData, team_id: newDeptId, user_id: '' });
                      }}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      required={!formData.user_id}
                      disabled={isEditMode}
                    >
                      <option value="">Select Department</option>
                      {teams.filter(t => !t.parent_id).map((t, idx) => <option key={`${t.id}-${idx}`} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const currentTeam = teams.find(t => t.id === formData.team_id);
                    const currentDeptId = currentTeam?.parent_id || formData.team_id;
                    const currentDept = teams.find(t => t.id === currentDeptId);
                    
                    const subTeams = teams.filter(t => t.parent_id === currentDeptId);
                    if (subTeams.length > 0) {
                      return (
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team</label>
                          <select
                            value={formData.team_id}
                            onChange={(e) => {
                              const newTeamId = e.target.value;
                              setFormData({ ...formData, team_id: newTeamId, user_id: '' });
                            }}
                            className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                            required={!formData.user_id}
                            disabled={isEditMode}
                          >
                            <option value="">Select Team</option>
                            {subTeams.map((t, idx) => {
                              const parent = teams.find(p => p.id === t.parent_id);
                              const prefix = parent ? `${parent.name} - ` : '';
                              const displayName = parent ? (t.name.toUpperCase().startsWith(prefix.toUpperCase()) ? t.name : `${prefix}${t.name}`) : t.name;
                              return <option key={`${t.id}-${idx}`} value={t.id}>{displayName}</option>;
                            })}
                          </select>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {(() => {
                  const currentTeam = teams.find(t => t.id === formData.team_id);
                  const currentDeptId = currentTeam?.parent_id || formData.team_id;
                  const currentDept = teams.find(t => t.id === currentDeptId);
                  
                  // Hide User selection for AR department as per requirement
                  if (currentDept?.name === 'AR') return null;

                  return (
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">User (Optional)</label>
                      <select
                        value={formData.user_id}
                        onChange={(e) => setFormData({ ...formData, user_id: e.target.value, team_id: '' })}
                        className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                        required={!formData.team_id}
                        disabled={isEditMode}
                      >
                        <option value="">Select User</option>
                        {users.filter(u => u.is_active).map((u, idx) => <option key={`${u.id}-${idx}`} value={u.id}>{u.full_name} ({u.role.toUpperCase()})</option>)}
                      </select>
                    </div>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Target Value</label>
                  <input
                    type="number"
                    value={formData.target_value}
                    onChange={(e) => setFormData({ ...formData, target_value: parseInt(e.target.value) || 0 })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Period</label>
                  <select
                    value={formData.period}
                    onChange={(e) => setFormData({ ...formData, period: e.target.value as any })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Effective Date</label>
                <input
                  type="date"
                  value={formData.effective_date}
                  onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                  required
                  disabled={isEditMode}
                />
              </div>
              {isUpdating && (
                <div className="bg-brand/10 border border-brand/20 rounded-xl p-3 mb-4">
                  <p className="text-[10px] text-brand font-bold uppercase tracking-wider">
                    Target already exists for this team on this date. Saving will update the existing value.
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all">
                  {isUpdating || isEditMode ? 'Update Target' : 'Save Target'}
                </button>
                <button type="button" onClick={() => { setIsModalOpen(false); setIsEditMode(false); }} className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Target"
        message="Are you sure you want to delete this target? This action cannot be undone."
      />
    </div>
  );
}
