import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Palette, Shield, Check, Lock, Save, Bell, Building2, Upload, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserRole, Team } from '../types';
import { formatDateTime } from '../dateUtils';
interface PermissionRow {
  role: UserRole;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

const uiModules = [
  { id: 'dashboard', label: 'dashboard' },
  { id: 'users', label: 'users' },
  { id: 'teams', label: 'teams' },
  { id: 'production', label: 'production' },
  { id: 'targets', label: 'targets' },
  { id: 'settings', label: 'settings' },
];

const roles: { id: UserRole; label: string; badgeClass: string }[] = [
  { id: 'admin', label: 'Admin', badgeClass: 'bg-blue-900/30 text-blue-400' },
  { id: 'hr', label: 'HR', badgeClass: 'bg-purple-900/30 text-purple-400' },
  { id: 'tl', label: 'Team Leader', badgeClass: 'bg-amber-900/30 text-amber-500' },
  { id: 'payment_posting', label: 'Payment Posting', badgeClass: 'bg-blue-500/20 text-blue-400' },
  { id: 'member', label: 'Member', badgeClass: 'bg-brand/20 text-brand' }
];

export default function SettingsPage() {
  const { user, token, settings, updateSettings, permissions, updatePermissions } = useAuth();
  const [rolePermissions, setRolePermissions] = useState<PermissionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Global Settings State
  const [companyName, setCompanyName] = useState('Production Analyst');
  const [companyLogo, setCompanyLogo] = useState('');
  const [themeColor, setThemeColor] = useState('#3bcf8d');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [unlockRoles, setUnlockRoles] = useState<string[]>(['super_admin', 'admin']);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const modulePerms = useMemo(() => {
    if (user?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['settings'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [user?.role, permissions]);

  const canAccessAll = useMemo(() => user?.role === 'super_admin' || user?.role === 'admin', [user?.role]);
  const canAccessView = useMemo(() => canAccessAll || modulePerms.can_view, [canAccessAll, modulePerms.can_view]);
  const canAccessCompany = useMemo(() => canAccessAll || modulePerms.can_edit, [canAccessAll, modulePerms.can_edit]);
  const canAccessPermissions = useMemo(() => canAccessAll || modulePerms.can_delete, [canAccessAll, modulePerms.can_delete]);
  const canAccessPassword = useMemo(() => canAccessAll || modulePerms.can_create, [canAccessAll, modulePerms.can_create]);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);

  const fetchTeams = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/teams', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setTeams(await response.json());
      }
    } catch (error) {
      console.error('Failed to fetch teams', error);
    }
  }, [token]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setIsLoadingNotifications(true);
    try {
      const response = await fetch('/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    } finally {
      setIsLoadingNotifications(false);
    }
  }, [token]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1, is_shown: 1 } : n));
        // Also dispatch event to update header notifications
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  }, [token]);

  const clearAllNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setNotifications([]);
        window.dispatchEvent(new Event('notifications-updated'));
        toast.success('Notifications cleared');
      }
    } catch (error) {
      console.error('Failed to clear notifications', error);
      toast.error('Failed to clear notifications');
    }
  }, [token]);

  const fetchGlobalSettings = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/global-settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.company_name) setCompanyName(data.company_name);
        if (data.company_logo) setCompanyLogo(data.company_logo);
        if (data.theme_color) setThemeColor(data.theme_color);
        if (data.notifications_enabled !== undefined) setNotificationsEnabled(data.notifications_enabled === 'true');
        if (data.unlock_roles) setUnlockRoles(data.unlock_roles.split(','));
      }
    } catch (error) {
      console.error('Failed to fetch global settings', error);
    }
  }, [token]);

  const fetchPermissions = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/permissions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setRolePermissions(data.map((p: any) => ({
          ...p,
          can_view: !!p.can_view,
          can_create: !!p.can_create,
          can_edit: !!p.can_edit,
          can_delete: !!p.can_delete
        })));
      }
    } catch (error) {
      toast.error('Failed to fetch permissions');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchGlobalSettings();
    fetchNotifications();
    fetchTeams();
    if (canAccessPermissions) {
      fetchPermissions();
    } else {
      setIsLoading(false);
    }
    
    window.addEventListener('global-settings-updated', fetchGlobalSettings);
    window.addEventListener('notifications-updated', fetchNotifications);
    window.addEventListener('teams-updated', fetchTeams);
    if (canAccessPermissions) {
      window.addEventListener('permissions-updated', fetchPermissions);
    }
    
    return () => {
      window.removeEventListener('global-settings-updated', fetchGlobalSettings);
      window.removeEventListener('notifications-updated', fetchNotifications);
      window.removeEventListener('teams-updated', fetchTeams);
      window.removeEventListener('permissions-updated', fetchPermissions);
    };
  }, [fetchGlobalSettings, fetchNotifications, fetchPermissions, fetchTeams, canAccessPermissions]);

  const handleToggleAction = (role: UserRole, module: string, action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete') => {
    // Security check: Only SuperAdmin can grant permissions they don't have
    if (user?.role !== 'super_admin' && !permissions?.[module]?.[action]) {
      return toast.error('You cannot grant a permission you do not have');
    }
    setRolePermissions(prev => {
      const existing = prev.find(p => p.role === role && p.module === module);
      const updated = prev.filter(p => !(p.role === role && p.module === module));
      
      const newPerm = existing ? { ...existing } : {
        role,
        module,
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false
      };
      
      newPerm[action] = !newPerm[action];
      
      // If view is disabled, disable all others
      if (action === 'can_view' && !newPerm.can_view) {
        newPerm.can_create = false;
        newPerm.can_edit = false;
        newPerm.can_delete = false;
      }
      // If any action is enabled, view must be enabled
      if (action !== 'can_view' && newPerm[action]) {
        newPerm.can_view = true;
      }

      updated.push(newPerm);
      return updated;
    });
  };

  const handleSavePermissions = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/permissions/bulk', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ permissions: rolePermissions })
      });

      if (response.ok) {
        toast.success('Settings updated successfully');
        
        // Update current user's permissions instantly if their role was modified
        if (user) {
          const myNewPerms = rolePermissions.filter(p => p.role === user.role);
          const newPermsMap: any = {};
          myNewPerms.forEach(p => {
            newPermsMap[p.module] = {
              can_view: p.can_view,
              can_create: p.can_create,
              can_edit: p.can_edit,
              can_delete: p.can_delete
            };
          });
          updatePermissions(newPermsMap);
        }
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update settings');
      }
    } catch (error) {
      toast.error('Connection error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGlobalSettings = async () => {
    setIsSavingGlobal(true);
    try {
      const response = await fetch('/api/global-settings', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          company_name: companyName,
          company_logo: companyLogo,
          theme_color: themeColor,
          notifications_enabled: notificationsEnabled,
          unlock_roles: unlockRoles.join(',')
        })
      });

      if (response.ok) {
        toast.success('Settings updated successfully');
        // Dispatch custom event to update logo/name in header/sidebar without reload
        window.dispatchEvent(new Event('global-settings-updated'));
      } else {
        toast.error('Failed to update settings');
      }
    } catch (error) {
      toast.error('Connection error');
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast.error('New passwords do not match');
    }
    
    setIsChangingPassword(true);
    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      });

      if (response.ok) {
        toast.success('Settings updated successfully');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to change password');
      }
    } catch (error) {
      toast.error('Connection error');
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (!canAccessAll && !modulePerms.can_view && !['hr', 'tl', 'member', 'payment_posting'].includes(user?.role || '')) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to access the Settings module.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-8 animate-in fade-in duration-500 pb-12 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Settings</h1>
        <p className="text-text-3 text-[10px] sm:text-xs mt-1">System configuration and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Theme, Notifications, Password */}
        <div className="lg:col-span-1 space-y-6">
          {/* Company Information */}
          {canAccessCompany && (
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                  <Building2 size={18} />
                </div>
                <h3 className="font-bold text-sm text-text">Company Information</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Company Logo</label>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl border border-border bg-bg flex items-center justify-center overflow-hidden">
                      {companyLogo ? (
                        <img src={companyLogo} alt="Logo" className="w-full h-full object-contain" />
                      ) : (
                        <Building2 size={24} className="text-text-3 opacity-50" />
                      )}
                    </div>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-bg border border-border rounded-lg text-xs font-bold hover:border-brand transition-colors flex items-center gap-2"
                    >
                      <Upload size={14} />
                      Upload Logo
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleLogoUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Company Name</label>
                  <input 
                    type="text" 
                    value={companyName} 
                    onChange={e => setCompanyName(e.target.value)} 
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand" 
                  />
                </div>
                <button 
                  onClick={handleSaveGlobalSettings}
                  disabled={isSavingGlobal}
                  className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  {isSavingGlobal ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Unlock Permission Settings */}
          {canAccessCompany && (
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-brand/10 text-brand">
                  <Lock size={18} />
                </div>
                <h3 className="font-bold text-sm text-text">Unlock Permission Settings</h3>
              </div>
              
              <div className="space-y-4">
                <p className="text-[10px] text-text-3 leading-relaxed">Select which roles are allowed to unlock locked production entries.</p>
                
                <div className="space-y-2">
                  {[
                    { id: 'super_admin', label: 'Superadmin' },
                    { id: 'admin', label: 'Admin' },
                    { id: 'hr', label: 'HR' },
                    { id: 'tl', label: 'Team Leader (TL)' }
                  ].map(role => (
                    <label key={role.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-bg cursor-pointer group hover:border-brand/30 transition-colors">
                      <span className="text-xs font-bold text-text">{role.label}</span>
                      <div className="flex items-center">
                        <input 
                          type="checkbox" 
                          checked={unlockRoles.includes(role.id)}
                          onChange={() => {
                            if (unlockRoles.includes(role.id)) {
                              setUnlockRoles(unlockRoles.filter(r => r !== role.id));
                            } else {
                              setUnlockRoles([...unlockRoles, role.id]);
                            }
                          }}
                          className="hidden"
                        />
                        <div className={`w-10 h-5 rounded-full transition-colors relative ${unlockRoles.includes(role.id) ? 'bg-brand' : 'bg-border'}`}>
                          <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-all ${unlockRoles.includes(role.id) ? 'left-6' : 'left-1'}`} />
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <button 
                  onClick={handleSaveGlobalSettings}
                  disabled={isSavingGlobal}
                  className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  {isSavingGlobal ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Notification System */}
          {canAccessView && (
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-brand/10 text-brand">
                  <Bell size={18} />
                </div>
                <h3 className="font-bold text-sm text-text">Notification System</h3>
              </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-bg">
                <div>
                  <div className="text-sm font-bold text-text">Enable Notifications</div>
                  <div className="text-[10px] text-text-3 mt-0.5">In-app notifications for logged-in users</div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => {
                      setNotificationsEnabled(!notificationsEnabled);
                      fetch('/api/global-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ notifications_enabled: !notificationsEnabled })
                      }).then(() => {
                        toast.success('Settings updated successfully');
                        window.dispatchEvent(new Event('global-settings-updated'));
                      });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors relative ${notificationsEnabled ? 'bg-brand' : 'bg-border'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${notificationsEnabled ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold">Recent Activity</label>
                  <div className="flex items-center gap-3">
                    {notifications.length > 0 && (
                      <button 
                        onClick={clearAllNotifications}
                        className="text-[10px] text-red-500 hover:underline font-bold"
                      >
                        Clear All
                      </button>
                    )}
                    <button 
                      onClick={fetchNotifications}
                      className="text-[10px] text-brand hover:underline"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                  {isLoadingNotifications ? (
                    <div className="text-center py-4 text-xs text-text-3">Loading notifications...</div>
                  ) : notifications.length > 0 ? (
                    notifications.map(notification => (
                      <div 
                        key={notification.id}
                        onClick={() => !notification.is_read && markAsRead(notification.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          !notification.is_read 
                            ? 'border-brand/30 bg-brand/5' 
                            : 'border-border bg-bg/50 hover:bg-bg'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className={`text-xs font-bold ${!notification.is_read ? 'text-brand' : 'text-text'}`}>
                            {notification.title}
                          </div>
                          {!notification.is_read && (
                            <div className="w-2 h-2 bg-brand rounded-full shrink-0 mt-1" />
                          )}
                        </div>
                        <div className="text-[11px] text-text-3 mt-1 leading-relaxed">
                          {notification.message}
                        </div>
                        <div className="text-[9px] text-text-3 mt-2 font-mono opacity-60">
                          {formatDateTime(notification.created_at)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 border border-dashed border-border rounded-xl">
                      <Bell size={24} className="mx-auto text-text-3 opacity-20 mb-2" />
                      <div className="text-xs text-text-3">No recent activity</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Profile Settings (Password Change) */}
          {canAccessPassword && (
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
                  <Lock size={18} />
                </div>
                <h3 className="font-bold text-sm text-text">Profile Settings</h3>
              </div>
              
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">New Password</label>
                  <div className="relative">
                    <input 
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword} 
                      onChange={e => setNewPassword(e.target.value)} 
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand pr-12" 
                      required 
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors"
                    >
                      {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Confirm New Password</label>
                  <div className="relative">
                    <input 
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword} 
                      onChange={e => setConfirmPassword(e.target.value)} 
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand pr-12" 
                      required 
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button 
                  type="submit" 
                  disabled={isChangingPassword} 
                  className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  {isChangingPassword ? 'Updating...' : 'Change Password'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right Column: Role Permissions */}
        <div className="lg:col-span-2">
          {canAccessPermissions ? (
            <div className="space-y-6">
              <div className="bg-surface border border-border rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-brand/10 text-brand">
                      <Palette size={18} />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-text">Global Application Theme</h3>
                      <p className="text-[10px] text-text-3">Select the primary brand color for the entire application</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 mb-6">
                    {[
                      '#3bcf8d', // Original Emerald
                      '#10b981', // Standard Emerald
                      '#3b82f6', // Blue
                      '#8b5cf6', // Violet
                      '#f43f5e', // Rose
                      '#f59e0b', // Amber
                      '#06b6d4', // Cyan
                      '#ec4899', // Pink
                    ].map(color => (
                      <button
                        key={color}
                        onClick={() => setThemeColor(color)}
                        className={`w-10 h-10 rounded-xl transition-all border-2 ${
                          themeColor === color ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                    <div className="flex items-center gap-3 ml-4 pl-4 border-l border-border">
                      <input 
                        type="color" 
                        value={themeColor}
                        onChange={(e) => setThemeColor(e.target.value)}
                        className="w-10 h-10 rounded-xl bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-text-3 uppercase">{themeColor}</span>
                    </div>
                  </div>

                  <button 
                    onClick={handleSaveGlobalSettings}
                    disabled={isSavingGlobal}
                    className="bg-brand hover:bg-brand-hover text-white font-bold py-2 px-6 rounded-lg transition-all flex items-center gap-2 text-sm"
                  >
                    <Save size={16} />
                    {isSavingGlobal ? 'Saving Theme...' : 'Apply Global Theme'}
                  </button>
                </div>

              <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-brand/10 text-brand">
                    <Shield size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-text">Role Permission Management</h3>
                    <p className="text-[10px] text-text-3">Configure feature access per role</p>
                  </div>
                </div>
                <button 
                  onClick={handleSavePermissions}
                  disabled={isSaving}
                  className="bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg transition-all flex items-center gap-2 text-sm"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
                </div>
              ) : (
                <div className="space-y-8">
                  {roles.map(role => (
                    <div key={role.id} className="space-y-3">
                      <div className={`inline-block px-2.5 py-1 rounded text-xs font-bold ${role.badgeClass}`}>
                        {role.label}
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {uiModules.map(module => {
                          const perm = rolePermissions.find(p => p.role === role.id && p.module === module.id);
                          
                          return (
                            <div 
                              key={module.id} 
                              className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-bg/50 hover:border-brand/30 transition-colors"
                            >
                              <div className="text-sm font-bold text-text capitalize">{module.label}</div>
                              <div className="grid grid-cols-2 gap-2">
                                {(['can_view', 'can_create', 'can_edit', 'can_delete'] as const).map(action => {
                                  const isChecked = !!perm?.[action];
                                  const hasPermissionToGrant = user?.role === 'super_admin' || !!permissions?.[module.id]?.[action];
                                  
                                  return (
                                    <label 
                                      key={action} 
                                      className={`flex items-center gap-2 group ${!hasPermissionToGrant ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                      title={!hasPermissionToGrant ? "You don't have this permission to grant it to others" : ""}
                                    >
                                      <div className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                                        isChecked ? 'bg-brand' : 'bg-white/10 group-hover:bg-white/20'
                                      }`}>
                                        {isChecked && <Check size={12} className="text-white" strokeWidth={4} />}
                                      </div>
                                      <span className="text-[10px] uppercase tracking-wider text-text-3 group-hover:text-text transition-colors">
                                        {action.replace('can_', '')}
                                      </span>
                                      <input 
                                        type="checkbox" 
                                        className="hidden" 
                                        checked={isChecked} 
                                        disabled={!hasPermissionToGrant}
                                        onChange={() => hasPermissionToGrant && handleToggleAction(role.id, module.id, action)} 
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col items-center justify-center h-full min-h-[400px] text-text-3">
              <Shield size={48} className="mb-4 opacity-20" />
              <h2 className="text-xl font-bold text-text">Administrative Settings</h2>
              <p className="text-sm text-center mt-2 max-w-sm">Administrative settings are restricted. You have access to personal preferences like Theme, Notifications, and Profile settings.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
