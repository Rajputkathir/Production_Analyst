import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { Team, User, Client } from '../types';
import { Plus, Edit2, Trash2, Users as UsersIcon, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationModal from '../components/ConfirmationModal';
import { getCachedData, setCachedData, clearCache } from '../lib/apiCache';

export default function Teams() {
  const { token, user: currentUser, permissions } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isRemoveClientModalOpen, setIsRemoveClientModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isOtherClient, setIsOtherClient] = useState(false);
  const [otherClientName, setOtherClientName] = useState('');

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['teams'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    client_name: '',
    team_leader_id: '',
    parent_id: '',
    member_ids: [] as string[]
  });

  const displayTeams = useMemo(() => {
    // Filter teams to show only sub-teams or departments without children
    return teams.filter(team => {
      const hasChildren = teams.some(t => t.parent_id === team.id);
      return team.parent_id || !hasChildren;
    });
  }, [teams]);

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    try {
      const cachedTeams = getCachedData('teams');
      const cachedUsers = getCachedData('users');
      const cachedClients = getCachedData('clients');

      const fetchPromises: Promise<any>[] = [];
      
      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedUsers) fetchPromises.push(fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedClients) fetchPromises.push(fetch('/api/clients', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      
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

      if (cachedClients) {
        setClients(cachedClients);
      } else {
        const clientRes = results[resultIdx++];
        if (clientRes.ok) {
          const data = await clientRes.json();
          setClients(data);
          setCachedData('clients', data);
        }
      }
    } catch (error) {
      toast.error('Failed to fetch data');
    }
  }, [token, modulePerms.can_view]);

  useEffect(() => {
    fetchData();
    window.addEventListener('teams-updated', fetchData);
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('clients-updated', fetchData);
    return () => {
      window.removeEventListener('teams-updated', fetchData);
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('clients-updated', fetchData);
    };
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    const finalClientName = isOtherClient ? otherClientName : formData.client_name;
    if (!finalClientName) {
      toast.error('Please select or enter a client name');
      return;
    }

    const parentDept = teams.find(t => t.id === formData.parent_id);
    let finalName = formData.name.trim();
    
    // Enforce prefix for sub-teams based on parent department
    if (parentDept) {
      const prefix = `${parentDept.name} - `;
      // Normalize: remove any existing prefix variations like "AR-", "AR -", "AR- "
      const normalizedName = finalName.replace(new RegExp(`^${parentDept.name}\\s*-\\s*`, 'i'), '');
      finalName = `${prefix}${normalizedName}`;
    }

    // Validate if team name already exists (case-insensitive)
    const isDuplicate = teams.some(t => 
      t.id !== editingId && 
      t.name.toLowerCase() === finalName.toLowerCase()
    );

    if (isDuplicate) {
      toast.error(parentDept ? 'Sub-team already exists' : 'Team already exists');
      return;
    }

    const url = editingId ? `/api/teams/${editingId}` : '/api/teams';
    const method = editingId ? 'PUT' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...formData, name: finalName, client_name: finalClientName }),
      });
      if (response.ok) {
        const teamData = await response.json();
        const teamId = editingId || teamData.id;

        // (Optional) Save new client to database if it's "Other"
        if (isOtherClient && otherClientName && teamId) {
          const exists = clients.some(c => c.name.toLowerCase() === otherClientName.toLowerCase() && c.team_id === teamId);
          if (!exists) {
            fetch('/api/clients', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ name: otherClientName, team_id: teamId })
            }).catch(err => console.error('Failed to auto-save client', err));
          }
        }

        toast.success(editingId ? 'Team updated' : 'Team created');
        clearCache('teams');
        if (isOtherClient) clearCache('clients');
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({ name: '', description: '', client_name: '', team_leader_id: '', parent_id: '', member_ids: [] });
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to save team');
    }
  };

  const openEdit = (team: Team) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    setEditingId(team.id);
    const clientExists = clients.some(c => c.name === team.client_name);
    setIsOtherClient(!clientExists && !!team.client_name);
    setOtherClientName(!clientExists ? team.client_name || '' : '');

    setFormData({ 
      name: team.name, 
      description: team.description || '', 
      client_name: team.client_name || '',
      team_leader_id: team.team_leader_id || '',
      parent_id: team.parent_id || '',
      member_ids: team.members?.map(m => m.id) || []
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const handleRemoveClient = () => {
    setIsRemoveClientModalOpen(true);
  };

  const confirmRemoveClient = async () => {
    const clientToDelete = clients.find(c => c.name === formData.client_name && (c.team_id === editingId || !c.team_id));
    const identifier = clientToDelete ? clientToDelete.id : formData.client_name;
    
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(identifier)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Client deleted');
        clearCache('clients');
        fetchData(); // Refresh clients list
      } else {
        toast.error('Failed to delete client');
      }
    } catch (error) {
      toast.error('Failed to delete client');
    }
    
    setFormData({ ...formData, client_name: '' });
    setIsOtherClient(false);
    setOtherClientName('');
    setIsRemoveClientModalOpen(false);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/teams/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Team deleted');
        clearCache('teams');
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
        <p className="text-sm">You do not have permission to view teams.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Teams</h1>
          <p className="text-text-3 mt-1 text-xs">Manage production teams and clients</p>
        </div>
        {modulePerms.can_create && (
          <button
            onClick={() => { setEditingId(null); setFormData({ name: '', description: '', client_name: '', team_leader_id: '', parent_id: '', member_ids: [] }); setIsModalOpen(true); }}
            className="w-full sm:w-auto bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            Add Team
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {displayTeams.map((team) => (
          <div key={team.id} className="bg-surface border border-border rounded-3xl p-6 hover:border-brand/30 transition-all group">
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 bg-brand/10 rounded-2xl flex items-center justify-center text-brand">
                <UsersIcon size={24} />
              </div>
              {(modulePerms.can_edit || modulePerms.can_delete) && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {modulePerms.can_edit && (
                    <button onClick={() => openEdit(team)} className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors">
                      <Edit2 size={16} />
                    </button>
                  )}
                  {modulePerms.can_delete && (
                    <button onClick={() => handleDelete(team.id)} className="p-2 hover:bg-error/10 rounded-lg text-text-3 hover:text-error transition-colors">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <h3 className="text-lg font-bold mb-1 text-text">
              {(() => {
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
                return displayName;
              })()}
              {team.parent_id && (
                <span className="ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface-2 text-text-3 border border-border">
                  Sub-team
                </span>
              )}
            </h3>
            {team.parent_id && (
              <div className="text-[10px] text-text-3 font-bold uppercase tracking-widest mb-1">
                Dept: {teams.find(t => t.id === team.parent_id)?.name || 'Unknown'}
              </div>
            )}
            {team.team_leader_name && <div className="text-xs text-brand font-medium mb-1">Leader: {team.team_leader_name}</div>}
            {team.client_name && <div className="text-xs text-text-3 mb-3">Client: {team.client_name}</div>}
            <p className="text-sm text-text-3 leading-relaxed line-clamp-2 mb-3">{team.description || 'No description provided.'}</p>
            <div className="text-xs text-text-3 font-medium">
              Members: {(() => {
                if (!team.parent_id) {
                  // For parent departments, count direct + sub-team members
                  const subTeamIds = teams.filter(t => t.parent_id === team.id).map(t => t.id);
                  const directMembers = users.filter(u => u.team_id === team.id && u.role === 'member');
                  const subMembers = users.filter(u => subTeamIds.includes(u.team_id) && u.role === 'member');
                  const total = new Set([...directMembers, ...subMembers].map(u => u.id)).size;
                  return total;
                }
                return team.members ? team.members.length : 0;
              })()}
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="p-8 pb-4">
              <h2 className="text-xl font-bold text-text">{editingId ? 'Edit Team' : 'Create Team'}</h2>
            </div>
            
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto p-8 pt-0 space-y-4 custom-scrollbar">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Parent Department (Optional)</label>
                  <select
                    value={formData.parent_id}
                    onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  >
                    <option value="">None (Top-level Department)</option>
                    {teams.filter(t => !t.parent_id && t.id !== editingId).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team Leader</label>
                  <select
                    value={formData.team_leader_id}
                    onChange={(e) => setFormData({ ...formData, team_leader_id: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  >
                    <option value="">Select Team Leader</option>
                    {users.filter(u => (u.role === 'tl' || u.role === 'payment_posting') && u.is_active).map((u, idx) => (
                      <option key={`${u.id}-${idx}`} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Client Name</label>
                  <div className="flex gap-2">
                    <select
                      value={isOtherClient ? 'Other' : (formData.client_name || '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'Other') {
                          setIsOtherClient(true);
                          setFormData({ ...formData, client_name: 'Other' });
                        } else {
                          setIsOtherClient(false);
                          setFormData({ ...formData, client_name: val });
                        }
                      }}
                      className="flex-1 bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    >
                      <option value="">{clients.length > 0 ? 'Select Client' : 'No Clients Available'}</option>
                      {clients.map((c, idx) => (
                        <option key={`${c.id}-${idx}`} value={c.name}>{c.name}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                    {formData.client_name && (
                      <button
                        type="button"
                        onClick={handleRemoveClient}
                        className="bg-error/10 hover:bg-error/20 text-error px-4 py-2.5 rounded-xl transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                {isOtherClient && (
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">New Client Name</label>
                    <input
                      type="text"
                      value={otherClientName}
                      onChange={(e) => setOtherClientName(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                      placeholder="Enter client name"
                      required={isOtherClient}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand h-24 resize-none"
                  />
                </div>
              </div>

              <div className="p-8 pt-4 flex gap-3 border-t border-border">
                <button type="submit" className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all">{editingId ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Team"
        message="Are you sure you want to delete this team? This will permanently remove the team record. Note: This may affect historical production data associated with this team."
      />

      <ConfirmationModal
        isOpen={isRemoveClientModalOpen}
        onClose={() => setIsRemoveClientModalOpen(false)}
        onConfirm={confirmRemoveClient}
        title="Remove Client"
        message="Are you sure you want to delete this client? This will permanently remove the client from the team."
        confirmText="Delete"
      />
    </div>
  );
}
