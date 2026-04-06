import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAuth } from './AuthContext';
import { LayoutDashboard, Users, Target, ClipboardList, Settings, LogOut, Menu, X, User as UserIcon, Bell, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import LoadingScreen from './components/LoadingScreen';
import { LogoRenderer } from './components/LogoRenderer';
import { AnimatedLogo } from './components/AnimatedLogo';
import toast from 'react-hot-toast';
import { formatDate, formatDateTime, formatTime, getPacificNow } from './dateUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Production = lazy(() => import('./pages/Production'));
const Targets = lazy(() => import('./pages/Targets'));
const Teams = lazy(() => import('./pages/Teams'));
const UsersPage = lazy(() => import('./pages/Users'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));
const MyTeam = lazy(() => import('./pages/MyTeam'));

export default function App() {
  const { isAuthenticated, user, logout, permissions, settings, token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const [companyName, setCompanyName] = useState('Production Analyst');
  const [companyLogo, setCompanyLogo] = useState('');
  const [themeColor, setThemeColor] = useState('#3bcf8d');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activePopup, setActivePopup] = useState<any>(null);
  const [selectedProductionMemberId, setSelectedProductionMemberId] = useState<string | null>(null);
  const hasFetchedOnce = useRef(false);

  useEffect(() => {
    const fetchPublicSettings = async () => {
      try {
        const response = await fetch('/api/company-info');
        if (response.ok) {
          const data = await response.json();
          if (data.company_name) setCompanyName(data.company_name);
          if (data.company_logo) setCompanyLogo(data.company_logo);
          if (data.theme_color) setThemeColor(data.theme_color);
          if (data.theme) {
            // Apply global theme if not logged in
            // Check localStorage directly to avoid race condition with state propagation
            const hasToken = !!localStorage.getItem('token');
            if (!isAuthenticated && !hasToken) {
              document.documentElement.classList.remove('light', 'dark');
              document.documentElement.classList.add(data.theme);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch public settings:', error);
      }
    };
    fetchPublicSettings();
    window.addEventListener('global-settings-updated', fetchPublicSettings);
    return () => window.removeEventListener('global-settings-updated', fetchPublicSettings);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && token) {
      fetchGlobalSettings();
      fetchNotifications();
      
      const notificationInterval = setInterval(fetchNotifications, 30000); // Poll every 30 seconds
      
      const handleSettingsUpdate = () => fetchGlobalSettings();
      const handleNotificationsUpdate = () => fetchNotifications();
      window.addEventListener('global-settings-updated', handleSettingsUpdate);
      window.addEventListener('notifications-updated', handleNotificationsUpdate);

      // SSE Connection
      const eventSource = new EventSource(`/api/events?token=${token}`);
      
      eventSource.addEventListener('global-settings-updated', () => {
        fetchGlobalSettings();
      });

      eventSource.addEventListener('permissions-updated', () => {
        // Dispatch event so AuthContext can pick it up
        window.dispatchEvent(new Event('permissions-updated'));
      });

      eventSource.addEventListener('users-updated', () => {
        window.dispatchEvent(new Event('users-updated'));
      });

      eventSource.addEventListener('teams-updated', () => {
        window.dispatchEvent(new Event('teams-updated'));
      });

      eventSource.addEventListener('notifications-updated', () => {
        window.dispatchEvent(new Event('notifications-updated'));
      });

      return () => {
        window.removeEventListener('global-settings-updated', handleSettingsUpdate);
        window.removeEventListener('notifications-updated', handleNotificationsUpdate);
        clearInterval(notificationInterval);
        eventSource.close();
      };
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    // Reduce initial loading time, but keep a small delay for smooth transition
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleGlobalError = (event: PromiseRejectionEvent | ErrorEvent) => {
      const error = (event as any).reason || (event as any).error;
      if (error && error.message) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.error === 'Forbidden' || parsed.message === 'Account deactivated') {
            logout();
            toast.error('Your account has been deactivated. Please contact an administrator.');
          }
        } catch (e) {
          // Not a JSON error
        }
      }
    };

    window.addEventListener('unhandledrejection', handleGlobalError);
    return () => window.removeEventListener('unhandledrejection', handleGlobalError);
  }, [logout]);

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 403) {
        const data = await response.json();
        if (data.message === 'Account deactivated') {
          logout();
          toast.error('Your account has been deactivated.');
          return;
        }
      }
      if (response.ok) {
        const data = await response.json();
        
        // Check for new notifications to trigger popup
        const unshownNotifications = data.filter((n: any) => !n.is_shown);
        const newUnshownNotifications = unshownNotifications.filter((n: any) => !notifications.find((old: any) => old.id === n.id));
        
        if (newUnshownNotifications.length > 0) {
          if (notificationsEnabled && hasFetchedOnce.current) {
            const latest = newUnshownNotifications[0];
            setActivePopup(latest);
            
            // Auto-hide after 5 seconds
            setTimeout(() => setActivePopup(null), 5000);
          }

          // Mark all new unshown notifications as shown on server
          // We do this even if hasFetchedOnce is false to prevent them from triggering on the next poll/refresh
          Promise.all(newUnshownNotifications.map(n => 
            fetch(`/api/notifications/${n.id}/shown`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
            })
          )).catch(err => console.error('Failed to mark notifications as shown', err));
        }
        
        setNotifications(data);
        hasFetchedOnce.current = true;
      }
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    }
  };

  const clearAllNotifications = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setNotifications([]);
        setShowNotifications(false);
      }
    } catch (error) {
      console.error('Failed to clear notifications', error);
    }
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: 1, is_shown: 1 } : n));
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  };

  const handleNotificationClick = (notification: any) => {
    if (!notification.is_read) {
      markNotificationAsRead(notification.id);
    }
    
    if (notification.type === 'target') {
      setActiveTab('targets');
      setShowNotifications(false);
      setActivePopup(null);
      // Store the reference_id to highlight in Targets page
      if (notification.reference_id) {
        sessionStorage.setItem('highlightTargetId', notification.reference_id);
        // Dispatch event to notify Targets page to highlight
        window.dispatchEvent(new CustomEvent('highlight-target', { detail: notification.reference_id }));
      }
    } else if (notification.type === 'production') {
      setActiveTab('production');
      setShowNotifications(false);
      setActivePopup(null);
    } else if (notification.type === 'user') {
      setActiveTab('my-team');
      setShowNotifications(false);
      setActivePopup(null);
    }
  };

  const handleLock = async (id: string) => {
    try {
      const response = await fetch(`/api/production/${id}/toggle-lock`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success('Production confirmed and locked');
        setActivePopup(null);
        // Refresh data if we are on production page
        window.dispatchEvent(new Event('production-updated'));
      } else {
        toast.error('Failed to lock production');
      }
    } catch (error) {
      toast.error('Connection error');
    }
  };

  const handleDashboardMemberSelect = (memberId: string) => {
    setSelectedProductionMemberId(memberId);
    setActiveTab('production');
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    if (themeColor) {
      document.documentElement.style.setProperty('--accent-primary', themeColor);
      document.documentElement.style.setProperty('--accent-secondary', themeColor);
    }
  }, [themeColor]);

  const fetchGlobalSettings = async () => {
    try {
      const response = await fetch('/api/global-settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.company_name) setCompanyName(data.company_name);
        if (data.company_logo) setCompanyLogo(data.company_logo);
        if (data.theme_color) {
          setThemeColor(data.theme_color);
        }
        if (data.notifications_enabled !== undefined) setNotificationsEnabled(data.notifications_enabled === 'true');
      }
    } catch (error) {
      console.error('Failed to fetch global settings', error);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' },
    { id: 'my-team', label: 'My Team', icon: Users, module: 'my_team' },
    { id: 'production', label: 'Production', icon: ClipboardList, module: 'production' },
    { id: 'targets', label: 'Targets', icon: Target, module: 'targets' },
    { id: 'teams', label: 'Teams', icon: Users, module: 'teams' },
    { id: 'users', label: 'Users', icon: UserIcon, module: 'users' },
    { id: 'settings', label: 'Settings', icon: Settings, module: 'settings' },
  ];

  const filteredNavItems = navItems.filter(item => {
    if (user?.role === 'super_admin') {
      if (item.id === 'my-team') return false; // Super admin doesn't need My Team
      return true;
    }
    if (item.id === 'my-team') return user?.role === 'tl' || user?.role === 'payment_posting';
    // SuperAdmin and Admin can access Settings, others see it by default for personal settings
    if (item.id === 'settings') return true;
    return permissions?.[item.module]?.can_view;
  });

  useEffect(() => {
    if (isAuthenticated) {
      const currentTabAccessible = filteredNavItems.some(item => item.id === activeTab);
      if (!currentTabAccessible && filteredNavItems.length > 0) {
        setActiveTab(filteredNavItems[0].id);
      }
    }
  }, [permissions, user, activeTab, isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Login />
      </Suspense>
    );
  }

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-border flex items-center gap-3">
        <AnimatedLogo
          logoUrl={companyLogo}
          companyName={companyName}
          size={40}
          className="flex items-center gap-3"
          textClassName="font-bold text-xs tracking-wider leading-tight text-text break-words line-clamp-2"
          isVisible={(isSidebarOpen || isMobileMenuOpen) && !isLoading}
        />
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {filteredNavItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setActiveTab(item.id);
              setIsMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group",
              activeTab === item.id
                ? "bg-brand/10 text-brand font-medium"
                : "text-text-3 hover:bg-brand/5 hover:text-text"
            )}
          >
            <item.icon size={20} className={cn(activeTab === item.id ? "text-brand" : "text-text-3 group-hover:text-brand")} />
            {(isSidebarOpen || isMobileMenuOpen) && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-border space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-bold shrink-0">
            {user?.full_name[0].toUpperCase()}
          </div>
          {(isSidebarOpen || isMobileMenuOpen) && (
            <div className="overflow-hidden">
              <div className="text-sm font-medium truncate text-text">{user?.full_name}</div>
              <div className="text-[10px] uppercase tracking-widest text-text-3">{user?.role.replace('_', ' ')}</div>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 p-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <LogOut size={20} />
          {(isSidebarOpen || isMobileMenuOpen) && <span>Logout</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      <AnimatePresence>
        {isLoading && <LoadingScreen />}
      </AnimatePresence>
      <div className={cn("flex h-screen bg-bg text-text font-sans overflow-hidden relative", isLoading ? "opacity-0" : "opacity-100 transition-opacity duration-500")}>
        {/* Desktop Sidebar */}
          <motion.aside
            initial={false}
            animate={{ width: isSidebarOpen ? 240 : 80 }}
            transition={{ duration: 0.08, ease: 'easeOut' }}
            className="hidden lg:flex bg-surface border-r border-border flex-col z-40"
          >
          <SidebarContent />
        </motion.aside>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                className="fixed inset-y-0 left-0 w-[280px] bg-surface border-r border-border flex flex-col z-50 lg:hidden"
              >
                <SidebarContent />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden w-full">
          <header className="h-16 border-b border-border bg-surface/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setIsMobileMenuOpen(true);
                  } else {
                    setIsSidebarOpen(!isSidebarOpen);
                  }
                }} 
                className="p-2 hover:bg-surface-2 rounded-lg text-text-3"
              >
                <Menu size={20} />
              </button>
              <div className="lg:hidden font-bold text-xs tracking-wider leading-tight flex items-center gap-2">
                {companyLogo && (
                  <div className="w-6 h-6 rounded bg-white flex items-center justify-center overflow-hidden">
                    <LogoRenderer logoUrl={companyLogo} size={24} className="w-full h-full object-contain" />
                  </div>
                )}
                <span className="truncate max-w-[150px]">{companyName.toUpperCase()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="hidden sm:block text-xs text-text-3 font-mono">
                {formatDate(getPacificNow())}
              </div>
              {notificationsEnabled && (
                <div className="relative">
                  <button 
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="p-2 hover:bg-surface-2 rounded-lg text-text-3 relative"
                  >
                    <Bell size={20} />
                    {notifications.filter(n => !n.is_read).length > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-surface"></span>
                    )}
                  </button>
                  
                  <AnimatePresence>
                    {showNotifications && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-2xl shadow-xl z-50 overflow-hidden"
                      >
                        <div className="p-4 border-b border-border flex items-center justify-between">
                          <h3 className="font-bold text-sm text-text">Notifications</h3>
                          <div className="flex items-center gap-2">
                            {notifications.length > 0 && (
                              <button 
                                onClick={clearAllNotifications}
                                className="text-[10px] uppercase tracking-widest font-bold text-brand hover:text-brand-hover"
                              >
                                Clear All
                              </button>
                            )}
                            <button onClick={() => setShowNotifications(false)} className="text-text-3 hover:text-text">
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto p-2">
                          {notifications.length > 0 ? (
                            notifications.map(notification => (
                              <div 
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                className={cn(
                                  "p-3 rounded-xl hover:bg-surface-2 transition-colors cursor-pointer mb-1",
                                  !notification.is_read ? "bg-brand/5" : ""
                                )}
                              >
                                <div className={cn("text-sm font-medium", !notification.is_read ? "text-brand" : "text-text")}>
                                  {notification.title}
                                </div>
                                <div className="text-xs text-text-3 mt-1">{notification.message}</div>
                                <div className="text-[10px] text-text-3 mt-2 font-mono">
                                  {formatDateTime(notification.created_at)}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-4 text-center text-sm text-text-3">
                              No notifications yet.
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="w-full max-w-[1600px] mx-auto"
              >
                <Suspense fallback={<div className="flex items-center justify-center h-[60vh] text-text-3">Loading...</div>}>
                  {activeTab === 'dashboard' && <Dashboard onSelectMember={handleDashboardMemberSelect} />}
                  {activeTab === 'my-team' && <MyTeam />}
                  {activeTab === 'production' && (
                    <Production
                      selectedMemberId={selectedProductionMemberId}
                      onSelectedMemberHandled={() => setSelectedProductionMemberId(null)}
                    />
                  )}
                  {activeTab === 'targets' && <Targets />}
                  {activeTab === 'teams' && <Teams />}
                  {activeTab === 'users' && <UsersPage />}
                  {activeTab === 'settings' && <SettingsPage />}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Notification Popup */}
      <AnimatePresence>
        {activePopup && (
          <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            onClick={() => handleNotificationClick(activePopup)}
            className="fixed bottom-6 right-6 z-[100] w-80 bg-surface border border-brand/30 rounded-2xl shadow-2xl p-4 overflow-hidden cursor-pointer"
          >
            <div className="absolute top-0 left-0 w-1 h-full bg-brand"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-xs font-bold text-brand uppercase tracking-widest">{activePopup.title}</div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePopup(null);
                }} 
                className="text-text-3 hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
            <div className="text-sm text-text font-medium leading-relaxed">{activePopup.message}</div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-text-3 font-mono opacity-60">
              <span>{formatTime(activePopup.created_at)}</span>
              <span className="bg-surface-2 px-2 py-0.5 rounded uppercase tracking-tighter">New Activity</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
