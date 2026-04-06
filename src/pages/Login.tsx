import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { motion } from 'motion/react';
import { LogIn, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const [username, setUsername] = useState('superadmin');
  const [password, setPassword] = useState('superadmin123');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tempAuthData, setTempAuthData] = useState<any>(null);
  const [companyInfo, setCompanyInfo] = useState<{ company_name?: string; company_logo?: string; theme?: 'light' | 'dark' }>({
    company_name: 'Production Analyst'
  });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const { login } = useAuth();

  useEffect(() => {
    const fetchCompanyInfo = async () => {
      try {
        const response = await fetch('/api/company-info');
        if (response.ok) {
          const data = await response.json();
          if (data.company_name || data.company_logo) {
            setCompanyInfo(data);
          }
          if (data.theme_color) {
            document.documentElement.style.setProperty('--accent-primary', data.theme_color);
            document.documentElement.style.setProperty('--accent-secondary', data.theme_color);
          }
          if (data.theme) {
            // Only apply global theme if not already logged in
            const hasToken = !!localStorage.getItem('token');
            if (!hasToken) {
              setTheme(data.theme);
              document.documentElement.classList.remove('light', 'dark');
              document.documentElement.classList.add(data.theme);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch company info:', error);
      }
    };
    fetchCompanyInfo();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (response.ok) {
        if (data.needsPasswordChange) {
          setNeedsPasswordChange(true);
          setTempAuthData(data);
          toast.success('Please update your password');
        } else {
          login(data.token, data.user, data.permissions, data.settings);
          toast.success('Welcome back!');
        }
      } else {
        toast.error(data.message || 'Login failed');
      }
    } catch (error) {
      toast.error('Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (newPassword.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/force-change-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempAuthData.token}`
        },
        body: JSON.stringify({ newPassword }),
      });

      if (response.ok) {
        toast.success('Password updated successfully!');
        login(tempAuthData.token, tempAuthData.user, tempAuthData.permissions, tempAuthData.settings);
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update password');
      }
    } catch (error) {
      toast.error('Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl overflow-hidden relative border ${
            theme === 'dark' 
              ? 'bg-surface-2 border-border-2 shadow-black/40' 
              : 'bg-white border-border shadow-lg'
          }`}>
            {companyInfo.company_logo ? (
              <div className="relative w-full h-full">
                <img 
                  src={companyInfo.company_logo} 
                  alt="Company Logo" 
                  className={`w-full h-full object-cover transition-all duration-500 ${
                    theme === 'dark' ? 'brightness-90 contrast-110' : 'brightness-100'
                  }`}
                  referrerPolicy="no-referrer"
                />
                <div className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${
                  theme === 'dark' ? 'bg-black/20 opacity-100' : 'bg-white/5 opacity-0'
                }`} />
              </div>
            ) : (
              '📊'
            )}
          </div>
          <h1 className="text-3xl font-bold text-text tracking-tight">
            {companyInfo.company_name && companyInfo.company_name !== 'Production Analyst' ? (
              companyInfo.company_name
            ) : (
              <>Production <span className="text-brand">Analyst</span></>
            )}
          </h1>
          <p className="text-text-3 mt-2">Healthcare Operations Intelligence</p>
        </div>

        <div className="bg-surface border border-border rounded-3xl p-8 shadow-2xl">
          {!needsPasswordChange ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all"
                  placeholder="Enter username"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all pr-12"
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                    style={{ WebkitTextSecurity: undefined }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors p-1"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-4 rounded-xl shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? 'Signing in...' : (
                  <>
                    <LogIn size={20} />
                    Sign In
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordChange} className="space-y-6">
              <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-text">Create New Password</h2>
                <p className="text-sm text-text-3 mt-1">This is your first login. Please set a secure password.</p>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all pr-12"
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors p-1"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all pr-12"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors p-1"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-brand hover:bg-brand-hover text-white font-bold py-4 rounded-xl shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? 'Updating...' : (
                  <>
                    <LogIn size={20} />
                    Update & Sign In
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setNeedsPasswordChange(false)}
                className="w-full text-text-3 hover:text-text text-sm transition-colors"
              >
                Back to Login
              </button>
            </form>
          )}

          {!needsPasswordChange && (
            <div className="mt-8 p-4 bg-brand/5 border border-brand/10 rounded-2xl flex items-start gap-3">
              <ShieldCheck className="text-brand shrink-0 mt-0.5" size={18} />
              <div className="text-xs text-text-3 leading-relaxed">
                Default credentials: <br />
                <span className="text-text font-mono">superadmin / superadmin123</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
