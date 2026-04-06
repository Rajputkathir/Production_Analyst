import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { User, Team } from '../types';
import { Plus, Edit2, Trash2, Shield, User as UserIcon, Key, Eye, EyeOff, UserX, UserCheck, Check, X, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationModal from '../components/ConfirmationModal';
import { getCachedData, setCachedData, clearCache } from '../lib/apiCache';

export default function UsersPage() {
  const { token, user: currentUser, permissions } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [itemToToggleStatus, setItemToToggleStatus] = useState<User | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState('');
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [isDeptDeleteModalOpen, setIsDeptDeleteModalOpen] = useState(false);
  const [deptToDelete, setDeptToDelete] = useState<string | null>(null);

  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const [isTeamDeleteModalOpen, setIsTeamDeleteModalOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<string | null>(null);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['users'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    email: '',
    role: 'member' as any,
    team_id: '',
    password: '',
    is_active: true
  });

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    try {
      const cachedUsers = getCachedData('users');
      const cachedTeams = getCachedData('teams');

      const fetchPromises: Promise<any>[] = [];
      
      if (!cachedUsers) fetchPromises.push(fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      
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
    } catch (error) {
      toast.error('Failed to fetch users');
    }
  }, [token, modulePerms.can_view]);

  useEffect(() => {
    fetchData();
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('teams-updated', fetchData);
    window.addEventListener('clients-updated', fetchData);
    return () => {
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('teams-updated', fetchData);
      window.removeEventListener('clients-updated', fetchData);
    };
  }, [fetchData]);

  useEffect(() => {
    const isAnyModalOpen = isModalOpen || isDeleteModalOpen || isStatusModalOpen || isDeptDeleteModalOpen;
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, isDeleteModalOpen, isStatusModalOpen, isDeptDeleteModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    const url = editingId ? `/api/users/${editingId}` : '/api/users';
    const method = editingId ? 'PUT' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        if (editingId && formData.password) {
          toast.success('User password updated successfully');
        } else {
          toast.success(editingId ? 'User updated successfully' : 'User created successfully');
        clearCache('users');
        clearCache('users_production');
        }
        setIsModalOpen(false);
        setEditingId(null);
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to save user');
    }
  };

  const handleDelete = async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const handleToggleStatus = (user: User) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    if (user.id === currentUser?.id) return toast.error('You cannot deactivate yourself');
    if (user.role === 'super_admin' && currentUser?.role !== 'super_admin') {
      return toast.error('Only Super Admin can deactivate another Super Admin');
    }
    setItemToToggleStatus(user);
    setIsStatusModalOpen(true);
  };

  const handleAddDepartment = async () => {
    if (!newDepartmentName.trim()) return;
    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newDepartmentName.trim() }),
      });
      if (response.ok) {
        const newTeam = await response.json();
        toast.success('Department added successfully');
        clearCache('teams');
        setNewDepartmentName('');
        setIsDeptDropdownOpen(false);
        setTeams(prev => [...prev, newTeam]);
        setFormData(prev => ({ ...prev, team_id: newTeam.id }));
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to add department');
    }
  };

  const handleUpdateDepartment = async (id: string) => {
    if (!editingDepartmentName.trim()) return;
    try {
      const team = teams.find(t => t.id === id);
      const response = await fetch(`/api/teams/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...team, name: editingDepartmentName.trim() }),
      });
      if (response.ok) {
        toast.success('Department updated successfully');
        clearCache('teams');
        setEditingDepartmentId(null);
        setEditingDepartmentName('');
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to update department');
    }
  };

  const handleDeleteDepartment = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeptToDelete(id);
    setIsDeptDeleteModalOpen(true);
  };

  const confirmDeleteDepartment = async () => {
    if (!deptToDelete) return;
    try {
      const response = await fetch(`/api/teams/${deptToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Department deleted successfully');
        clearCache('teams');
        setTeams(prev => prev.filter(t => t.id !== deptToDelete));
        if (formData.team_id === deptToDelete) {
          setFormData(prev => ({ ...prev, team_id: '' }));
        }
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete department');
      }
    } catch (error) {
      toast.error('Failed to delete department');
    } finally {
      setDeptToDelete(null);
      setIsDeptDeleteModalOpen(false);
    }
  };

  const handleAddTeam = async (parentId: string) => {
    if (!newTeamName.trim()) return;
    try {
      const parentDept = teams.find(t => t.id === parentId);
      let finalName = newTeamName.trim();
      if (parentDept) {
        const prefix = `${parentDept.name} - `;
        const normalizedName = finalName.replace(new RegExp(`^${parentDept.name}\\s*-\\s*`, 'i'), '');
        finalName = `${prefix}${normalizedName}`;
      }

      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: finalName, parent_id: parentId }),
      });
      if (response.ok) {
        const newTeam = await response.json();
        toast.success('Team added successfully');
        clearCache('teams');
        setNewTeamName('');
        setTeams(prev => [...prev, { ...newTeam, name: finalName, parent_id: parentId, is_active: true }]);
        setFormData(prev => ({ ...prev, team_id: newTeam.id }));
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to add team');
    }
  };

  const handleUpdateTeam = async (id: string) => {
    if (!editingTeamName.trim()) return;
    try {
      const team = teams.find(t => t.id === id);
      const parentDept = teams.find(t => t.id === team?.parent_id);
      let finalName = editingTeamName.trim();
      if (parentDept) {
        const prefix = `${parentDept.name} - `;
        const normalizedName = finalName.replace(new RegExp(`^${parentDept.name}\\s*-\\s*`, 'i'), '');
        finalName = `${prefix}${normalizedName}`;
      }

      const response = await fetch(`/api/teams/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...team, name: finalName }),
      });
      if (response.ok) {
        toast.success('Team updated successfully');
        clearCache('teams');
        setEditingTeamId(null);
        setEditingTeamName('');
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to update team');
    }
  };

  const handleDeleteTeam = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTeamToDelete(id);
    setIsTeamDeleteModalOpen(true);
  };

  const confirmDeleteTeam = async () => {
    if (!teamToDelete) return;
    try {
      const response = await fetch(`/api/teams/${teamToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Team deleted successfully');
        clearCache('teams');
        setTeams(prev => prev.filter(t => t.id !== teamToDelete));
        if (formData.team_id === teamToDelete) {
          const deletedTeam = teams.find(t => t.id === teamToDelete);
          setFormData(prev => ({ ...prev, team_id: deletedTeam?.parent_id || '' }));
        }
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete team');
      }
    } catch (error) {
      toast.error('Failed to delete team');
    } finally {
      setTeamToDelete(null);
      setIsTeamDeleteModalOpen(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!itemToToggleStatus) return;
    try {
      const response = await fetch(`/api/users/${itemToToggleStatus.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          full_name: itemToToggleStatus.full_name,
          email: itemToToggleStatus.email,
          role: itemToToggleStatus.role,
          team_id: itemToToggleStatus.team_id,
          is_active: !itemToToggleStatus.is_active
        }),
      });
      if (response.ok) {
        toast.success(`User ${itemToToggleStatus.is_active ? 'deactivated' : 'activated'} successfully`);
        clearCache('users');
        clearCache('users_production');
        setIsStatusModalOpen(false);
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update status');
      }
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/users/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('User deleted');
        clearCache('users');
        clearCache('users_production');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete');
      }
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  const openEdit = (user: User) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    setEditingId(user.id);
    setShowPassword(false);
    setFormData({
      username: user.username,
      full_name: user.full_name,
      email: user.email || '',
      role: user.role,
      team_id: user.team_id || '',
      password: '',
      is_active: !!user.is_active
    });
    setIsModalOpen(true);
  };

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Users</h1>
          <p className="text-text-3 mt-1 text-xs">Manage team members and system access</p>
        </div>
        {modulePerms.can_create && (
          <button
            onClick={() => { 
              setEditingId(null); 
              setShowPassword(false); 
              
              let defaultTeamId = '';
              if (currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') {
                const tlTeams = teams.filter(t => t.team_leader_id === currentUser.id);
                if (tlTeams.length > 0) {
                  defaultTeamId = tlTeams[0].id;
                }
              }
              
              setFormData({ 
                username: '', 
                full_name: '', 
                email: '', 
                role: 'member', 
                team_id: defaultTeamId, 
                password: '',
                is_active: true
              }); 
              setIsModalOpen(true); 
            }}
            className="w-full sm:w-auto bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            Add User
          </button>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">User</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Role</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Department</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Status</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold">
                      {u.full_name[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text">{u.full_name}</div>
                      <div className="text-xs text-text-3">{u.email || u.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    u.role === 'super_admin' ? 'bg-error/10 text-error' : 
                    u.role === 'admin' ? 'bg-surface-2 text-text-3 border border-border' : 
                    u.role === 'hr' ? 'bg-surface-2 text-text-3 border border-border' : 
                    u.role === 'payment_posting' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-brand/10 text-brand'
                  }`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-text-3">
                  {u.parent_team_name ? (u.team_name.startsWith(`${u.parent_team_name} - `) ? u.team_name : `${u.parent_team_name} - ${u.team_name}`) : (u.team_name || '—')}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    u.is_active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    {modulePerms.can_edit && (u.role !== 'super_admin' || currentUser?.role === 'super_admin') && (
                      <button onClick={() => openEdit(u)} className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors" title="Edit User">
                        <Edit2 size={16} />
                      </button>
                    )}
                    {modulePerms.can_edit && u.id !== currentUser?.id && (u.role !== 'super_admin' || currentUser?.role === 'super_admin') && (
                      <button 
                        onClick={() => handleToggleStatus(u)} 
                        className={`p-2 rounded-lg transition-colors ${u.is_active ? 'hover:bg-error/10 text-text-3 hover:text-error' : 'hover:bg-success/10 text-text-3 hover:text-success'}`}
                        title={u.is_active ? 'Deactivate User' : 'Activate User'}
                      >
                        {u.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                    )}
                    {modulePerms.can_delete && u.id !== currentUser?.id && u.role !== 'super_admin' && (
                      <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-error/10 rounded-lg text-text-3 hover:text-error transition-colors" title="Delete User">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-8 pb-4 flex items-center justify-between shrink-0">
              <h2 className="text-xl font-bold text-text">{editingId ? 'Edit User' : 'Create User'}</h2>
              {editingId && (
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  formData.is_active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                }`}>
                  {formData.is_active ? 'Active' : 'Inactive'}
                </span>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 pt-0 custom-scrollbar">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Full Name</label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                    disabled={!!editingId}
                  />
                </div>
              </div>
              {editingId && (
                <div className="flex items-center gap-3 p-4 bg-surface-2 rounded-xl border border-border">
                  <div className="flex-1">
                    <div className="text-sm font-bold text-text">Account Status</div>
                    <div className="text-xs text-text-3">{formData.is_active ? 'This account is currently active' : 'This account is currently deactivated'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.is_active ? 'bg-success' : 'bg-error'}`}
                    disabled={formData.role === 'super_admin' && currentUser?.role !== 'super_admin'}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              )}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  >
                    <option value="member">Member</option>
                    <option value="tl">Team Leader</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                    {currentUser?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>
                <div className="relative">
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Department</label>
                  <div 
                    onClick={() => setIsDeptDropdownOpen(!isDeptDropdownOpen)}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand cursor-pointer flex justify-between items-center"
                  >
                    <span>{(() => {
                      const currentTeam = teams.find(t => t.id === formData.team_id);
                      const deptId = currentTeam?.parent_id || formData.team_id;
                      return teams.find(t => t.id === deptId)?.name || 'Select Department';
                    })()}</span>
                    <ChevronDown size={16} className={`transition-transform ${isDeptDropdownOpen ? 'rotate-180' : ''}`} />
                  </div>

                  {isDeptDropdownOpen && (
                    <div className="absolute z-50 w-full mt-2 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
                      <div className="max-h-60 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        <div 
                          onClick={() => {
                            setFormData({ ...formData, team_id: '' });
                            setIsDeptDropdownOpen(false);
                          }}
                          className={`p-2 rounded-lg transition-colors cursor-pointer ${!formData.team_id ? 'bg-brand/10 text-brand' : 'hover:bg-bg'}`}
                        >
                          <span className="text-sm">No Department</span>
                        </div>
                        {teams.filter(t => !t.parent_id).map((t) => (
                          <div 
                            key={t.id} 
                            onClick={() => {
                              if (editingDepartmentId !== t.id) {
                                setFormData({ ...formData, team_id: t.id });
                                setIsDeptDropdownOpen(false);
                              }
                            }}
                            className={`flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer ${(() => {
                              const currentTeam = teams.find(tm => tm.id === formData.team_id);
                              const deptId = currentTeam?.parent_id || formData.team_id;
                              return deptId === t.id;
                            })() ? 'bg-brand/10 text-brand' : 'hover:bg-bg'}`}
                          >
                            {editingDepartmentId === t.id ? (
                              <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={editingDepartmentName}
                                  onChange={(e) => setEditingDepartmentName(e.target.value)}
                                  className="flex-1 bg-bg border border-brand rounded px-2 py-1 text-xs outline-none text-text"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateDepartment(t.id)}
                                  className="p-1 text-success hover:bg-success/10 rounded"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingDepartmentId(null)}
                                  className="p-1 text-error hover:bg-error/10 rounded"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="text-sm truncate mr-2">{t.name}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingDepartmentId(t.id);
                                      setEditingDepartmentName(t.name);
                                    }}
                                    className="p-1 text-text-3 hover:text-brand hover:bg-brand/10 rounded transition-colors"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteDepartment(t.id, e)}
                                    className="p-1 text-text-3 hover:text-error hover:bg-error/10 rounded transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="p-2 border-t border-border bg-bg-secondary">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newDepartmentName}
                            onChange={(e) => setNewDepartmentName(e.target.value)}
                            placeholder="Add new department..."
                            className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text outline-none focus:border-brand"
                          />
                          <button
                            type="button"
                            onClick={handleAddDepartment}
                            className="p-1.5 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {(() => {
                const currentTeam = teams.find(t => t.id === formData.team_id);
                const currentDeptId = currentTeam?.parent_id || (currentTeam && !currentTeam.parent_id ? currentTeam.id : '');
                
                if (currentDeptId) {
                  const subTeams = teams.filter(t => t.parent_id === currentDeptId);
                  return (
                    <div className="mt-4 relative">
                      <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team Name</label>
                      <div 
                        onClick={() => setIsTeamDropdownOpen(!isTeamDropdownOpen)}
                        className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand cursor-pointer flex justify-between items-center"
                      >
                        <span>{teams.find(t => t.id === formData.team_id && t.parent_id === currentDeptId)?.name || 'Select Team'}</span>
                        <ChevronDown size={16} className={`transition-transform ${isTeamDropdownOpen ? 'rotate-180' : ''}`} />
                      </div>

                      {isTeamDropdownOpen && (
                        <div className="absolute z-50 w-full mt-2 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
                          <div className="max-h-60 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            <div 
                              onClick={() => {
                                setFormData({ ...formData, team_id: currentDeptId });
                                setIsTeamDropdownOpen(false);
                              }}
                              className={`p-2 rounded-lg transition-colors cursor-pointer ${formData.team_id === currentDeptId ? 'bg-brand/10 text-brand' : 'hover:bg-bg'}`}
                            >
                              <span className="text-sm">No Specific Team (Department Level)</span>
                            </div>
                            {subTeams.map((t) => (
                              <div 
                                key={t.id} 
                                onClick={() => {
                                  if (editingTeamId !== t.id) {
                                    setFormData({ ...formData, team_id: t.id });
                                    setIsTeamDropdownOpen(false);
                                  }
                                }}
                                className={`flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer ${formData.team_id === t.id ? 'bg-brand/10 text-brand' : 'hover:bg-bg'}`}
                              >
                                {editingTeamId === t.id ? (
                                  <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="text"
                                      value={editingTeamName}
                                      onChange={(e) => setEditingTeamName(e.target.value)}
                                      className="flex-1 bg-bg border border-brand rounded px-2 py-1 text-xs outline-none text-text"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateTeam(t.id)}
                                      className="p-1 text-success hover:bg-success/10 rounded"
                                    >
                                      <Check size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingTeamId(null)}
                                      className="p-1 text-error hover:bg-error/10 rounded"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-sm truncate mr-2">{t.name}</span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingTeamId(t.id);
                                          setEditingTeamName(t.name);
                                        }}
                                        className="p-1 text-text-3 hover:text-brand hover:bg-brand/10 rounded transition-colors"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => handleDeleteTeam(t.id, e)}
                                        className="p-1 text-text-3 hover:text-error hover:bg-error/10 rounded transition-colors"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="p-2 border-t border-border bg-bg-secondary">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={newTeamName}
                                onChange={(e) => setNewTeamName(e.target.value)}
                                placeholder="Add new team..."
                                className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text outline-none focus:border-brand"
                              />
                              <button
                                type="button"
                                onClick={() => handleAddTeam(currentDeptId)}
                                className="p-1.5 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin' || !editingId) && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">
                    {editingId ? 'Update Password (Leave blank to keep current)' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand pr-12"
                      required={!editingId}
                      placeholder={editingId ? 'Enter new password' : ''}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-6 sticky bottom-0 bg-surface -mx-8 px-8 pb-0 mt-4 border-t border-border/50">
                <button type="submit" className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all">{editingId ? 'Update User' : 'Create User'}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}

      <ConfirmationModal
        isOpen={isTeamDeleteModalOpen}
        onClose={() => {
          setIsTeamDeleteModalOpen(false);
          setTeamToDelete(null);
        }}
        onConfirm={confirmDeleteTeam}
        title="Delete Team"
        message="Are you sure you want to delete this team? This action cannot be undone."
      />

      <ConfirmationModal
        isOpen={isDeptDeleteModalOpen}
        onClose={() => {
          setIsDeptDeleteModalOpen(false);
          setDeptToDelete(null);
        }}
        onConfirm={confirmDeleteDepartment}
        title="Delete Department"
        message="Are you sure you want to delete this department? This action cannot be undone."
      />

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone and will remove all access for this user."
      />

      <ConfirmationModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={confirmToggleStatus}
        title={itemToToggleStatus?.is_active ? 'Deactivate User' : 'Activate User'}
        message={`Are you sure you want to ${itemToToggleStatus?.is_active ? 'deactivate' : 'activate'} ${itemToToggleStatus?.full_name}? ${itemToToggleStatus?.is_active ? 'They will no longer be able to log in or access the system.' : 'They will regain access to the system.'}`}
      />
    </div>
  );
}
