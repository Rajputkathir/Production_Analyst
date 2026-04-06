import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { ProductionEntry, Team, User, Target, Client, MemberDetails } from '../types';
import { Plus, Search, Download, Lock, LockOpen, Edit2, Trash2, Shield } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { motion } from 'motion/react';
import ConfirmationModal from '../components/ConfirmationModal';
import { formatDate, toInputDateFormat, getPacificNow } from '../dateUtils';
import { getCachedData, setCachedData, clearCache } from '../lib/apiCache';

import { formatQualityDisplay } from '../qualityUtils';

type ProductionProps = {
  selectedMemberId?: string | null;
  onSelectedMemberHandled?: () => void;
};

type ProductionFormData = {
  team_id: string;
  user_id: string;
  client_name: string;
  date: string;
  production_value: number;
  target_value: number;
  base_target: number;
  downtime: string;
  downtime_reason: string;
  sample_production: string;
  quality_low: number;
  quality_high: number;
  quality: string;
  notes: string;
  reporting_to: string;
};

export default function Production({ selectedMemberId, onSelectedMemberHandled }: ProductionProps) {
  const { token, user: currentUser, permissions } = useAuth();
  const handledSelectedMemberId = useRef<string | null>(null);
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 1
  });
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isClientDeleteModalOpen, setIsClientDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [clientToDelete, setClientToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    team: '',
    dayFilter: 'this_month',
    customFrom: '',
    customTo: ''
  });

  const [isOtherReason, setIsOtherReason] = useState(false);
  const [isOtherClient, setIsOtherClient] = useState(false);
  const [otherClientName, setOtherClientName] = useState('');
  const [sampleProductionError, setSampleProductionError] = useState<string | null>(null);
  const STANDARD_DOWNTIME_REASONS = [
    "Machine Breakdown",
    "Power Outage",
    "Material Shortage",
    "Maintenance",
    "Meeting"
  ];

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['production'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);

  const SHIFT_HOURS = 8;

  const [formData, setFormData] = useState<ProductionFormData>({
    team_id: '',
    user_id: '',
    client_name: '',
    date: toInputDateFormat(getPacificNow()),
    production_value: 0,
    target_value: 0,
    base_target: 0,
    downtime: '0',
    downtime_reason: '',
    sample_production: '',
    quality_low: 0,
    quality_high: 0,
    quality: '',
    notes: '',
    reporting_to: ''
  });

  const createInitialFormData = useCallback((overrides: Partial<ProductionFormData> = {}): ProductionFormData => {
    const isMember = currentUser?.role === 'member';
    const memberTeamId = isMember ? (currentUser?.team_id || '') : '';
    const memberUserId = isMember ? (currentUser?.id || '') : '';
    const defaultTeamId = currentUser?.role === 'tl'
      ? (teams.find(t => t.team_leader_id === currentUser.id)?.id || currentUser.team_id || '')
      : memberTeamId;
    const defaultTeam = teams.find(t => t.id === defaultTeamId);

    return {
      team_id: defaultTeamId,
      user_id: memberUserId,
      client_name: '',
      date: toInputDateFormat(getPacificNow()),
      production_value: 0,
      target_value: 0,
      base_target: 0,
      downtime: '0',
      downtime_reason: '',
      sample_production: '',
      quality_low: 0,
      quality_high: 0,
      quality: '',
      notes: '',
      reporting_to: defaultTeam?.team_leader_name || '',
      ...overrides,
    };
  }, [currentUser, teams]);

  const getFilterDates = useCallback(() => {
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
        const first = dateCopy.getDate() - dateCopy.getDay();
        const firstDay = toInputDateFormat(new Date(dateCopy.setDate(first)));
        from = firstDay;
        break;
      }
      case 'this_month': {
        from = toInputDateFormat(new Date(dateCopy.getFullYear(), dateCopy.getMonth(), 1));
        break;
      }
      case 'last_3_months': {
        from = toInputDateFormat(new Date(dateCopy.getFullYear(), dateCopy.getMonth() - 2, 1));
        break;
      }
      case 'custom':
        from = filters.customFrom;
        to = filters.customTo;
        break;
    }
    return { from, to };
  }, [filters.dayFilter, filters.customFrom, filters.customTo]);

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    setIsLoading(true);
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        team_id: filters.team,
        search: filters.search,
        from,
        to
      });

      // Use cache for static data
      const cachedTeams = getCachedData('teams');
      const cachedUsers = getCachedData('users_production');
      const cachedTargets = getCachedData('targets');
      const cachedSettings = getCachedData('global_settings');
      const cachedClients = getCachedData('clients');

      const fetchPromises: Promise<any>[] = [
        fetch(`/api/production?${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } })
      ];

      if (!cachedTeams) fetchPromises.push(fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedUsers) fetchPromises.push(fetch('/api/users?exclude_roles=super_admin,admin,hr', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedTargets) fetchPromises.push(fetch('/api/targets', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedSettings) fetchPromises.push(fetch('/api/global-settings', { headers: { 'Authorization': `Bearer ${token}` } }));
      if (!cachedClients) fetchPromises.push(fetch('/api/clients', { headers: { 'Authorization': `Bearer ${token}` } }));

      const results = await Promise.all(fetchPromises);
      
      let resultIdx = 0;
      const prodRes = results[resultIdx++];
      
      if (prodRes.ok) {
        const result = await prodRes.json();
        setEntries(result.data);
        setPagination(result.pagination);
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

      if (cachedUsers) {
        setUsers(cachedUsers);
      } else {
        const userRes = results[resultIdx++];
        if (userRes.ok) {
          const data = await userRes.json();
          setUsers(data);
          setCachedData('users_production', data);
        }
      }

      if (cachedTargets) {
        setTargets(cachedTargets);
      } else {
        const targetRes = results[resultIdx++];
        if (targetRes.ok) {
          const data = await targetRes.json();
          setTargets(data);
          setCachedData('targets', data);
        }
      }

      if (cachedSettings) {
        setGlobalSettings(cachedSettings);
      } else {
        const settingsRes = results[resultIdx++];
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setGlobalSettings(data);
          setCachedData('global_settings', data);
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
    } finally {
      setIsLoading(false);
    }
  }, [token, modulePerms.can_view, pagination.page, pagination.limit, filters.team, filters.search, getFilterDates, currentUser]);

  const tlTeams = useMemo(() => {
    if (!currentUser) return [];
    return teams.filter(t => t.team_leader_id === currentUser.id || t.id === currentUser.team_id);
  }, [teams, currentUser]);

  const tlDepartments = useMemo(() => {
    const deptIds = new Set(tlTeams.map(t => t.parent_id || t.id));
    return teams.filter(t => deptIds.has(t.id) && !t.parent_id);
  }, [tlTeams, teams]);

  const uniqueSortedClients = useMemo(() => {
    // Prefer clients for the current team or global clients when deduplicating for the dropdown
    const sorted = [...clients].sort((a, b) => {
      if (a.team_id === formData.team_id && b.team_id !== formData.team_id) return -1;
      if (a.team_id !== formData.team_id && b.team_id === formData.team_id) return 1;
      if (a.team_id === null && b.team_id !== null) return -1;
      if (a.team_id !== null && b.team_id === null) return 1;
      return a.name.localeCompare(b.name);
    });
    const unique = Array.from(new Map(sorted.map(c => [c.name.toLowerCase(), c])).values());
    return unique.sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, formData.team_id]);

  const handleDeleteClient = useCallback(async (clientId: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete client');
    setClientToDelete(clientId);
    setIsClientDeleteModalOpen(true);
  }, [modulePerms.can_delete]);

  const confirmDeleteClient = useCallback(async () => {
    if (!clientToDelete) return;
    
    try {
      const res = await fetch(`/api/clients/${clientToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('Client deleted successfully');
        clearCache('clients');
        await fetchData();
        setFormData(prev => ({ ...prev, client_name: '' }));
      } else {
        const data = await res.json();
        toast.error(data.message || 'Failed to delete client. Please try again');
      }
    } catch (error) {
      toast.error('Failed to delete client. Please try again');
    } finally {
      setClientToDelete(null);
      setIsClientDeleteModalOpen(false);
    }
  }, [clientToDelete, token, fetchData]);

  useEffect(() => {
    fetchData();
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('teams-updated', fetchData);
    window.addEventListener('production-updated', fetchData);
    window.addEventListener('clients-updated', fetchData);
    return () => {
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('teams-updated', fetchData);
      window.removeEventListener('production-updated', fetchData);
      window.removeEventListener('clients-updated', fetchData);
    };
  }, [fetchData]);

  const prefillMemberAssignment = useCallback(async (memberId: string) => {
    if (!token) return;

    try {
      const response = await fetch(`/api/members/${memberId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || errorData.error || 'Member data not found';
        console.error('Failed to load member details:', errorData);
        toast.error(message);
        return;
      }

      const member = await response.json() as MemberDetails;
      const selectedTeamId = member.team_id || member.department_id || '';
      const selectedClient = member.client || '';
      const clientExists = !!selectedClient && clients.some(c => c.name.toLowerCase() === selectedClient.toLowerCase());

      setEditingId(null);
      setIsOtherReason(false);
      setSampleProductionError(null);
      setIsOtherClient(!!selectedClient && !clientExists);
      setOtherClientName(!!selectedClient && !clientExists ? selectedClient : '');
      setFormData(createInitialFormData({
        team_id: selectedTeamId,
        user_id: member.id,
        client_name: selectedClient,
        reporting_to: member.reporting_to || ''
      }));
      setIsModalOpen(true);
    } catch (error) {
      console.error('Failed to load member details:', error);
      toast.error('Failed to load member details');
    }
  }, [clients, createInitialFormData, token]);

  useEffect(() => {
    if (!selectedMemberId) {
      handledSelectedMemberId.current = null;
      return;
    }

    if (handledSelectedMemberId.current === selectedMemberId) {
      return;
    }

    handledSelectedMemberId.current = selectedMemberId;

    if (!modulePerms.can_create) {
      toast.error('No permission to create');
      onSelectedMemberHandled?.();
      return;
    }

    void prefillMemberAssignment(selectedMemberId).finally(() => {
      onSelectedMemberHandled?.();
    });
  }, [modulePerms.can_create, onSelectedMemberHandled, prefillMemberAssignment, selectedMemberId]);

  // Auto-fill client and target when team/user/date changes
  useEffect(() => {
    if (!editingId && (formData.team_id || formData.user_id) && formData.date) {
      const selectedTeam = teams.find(t => t.id === formData.team_id);
      if (selectedTeam?.client_name) {
        const clientName = selectedTeam.client_name || '';
        const clientExists = clients.some(c => c.name === clientName);
        setIsOtherClient(!clientExists && !!clientName);
        setOtherClientName(!clientExists ? clientName : '');
        setFormData(prev => prev.client_name !== clientName ? { ...prev, client_name: clientName } : prev);
      }

      let target = null;
      if (formData.user_id) {
        const userTargets = targets.filter(t => t.user_id === formData.user_id);
        target = userTargets.find(t => t.effective_date === formData.date);
        if (!target) {
          target = userTargets
            .filter(t => new Date(t.effective_date) <= new Date(formData.date))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
      }

      if (!target && formData.team_id) {
        const teamTargets = targets.filter(t => t.team_id === formData.team_id && !t.user_id);
        target = teamTargets.find(t => t.effective_date === formData.date);
        if (!target) {
          target = teamTargets
            .filter(t => new Date(t.effective_date) <= new Date(formData.date))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
        if (!target) {
          target = teamTargets.sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
      }

      if (target) {
        setFormData(prev => {
          const updates: any = {};
          if (selectedTeam?.client_name && prev.client_name !== selectedTeam.client_name) {
            updates.client_name = selectedTeam.client_name;
          }
          if (prev.base_target !== target.target_value) {
            updates.base_target = target.target_value;
            // Recalculate adjusted target based on current downtime
            const currentDowntime = parseFloat(prev.downtime.toString()) || 0;
            updates.target_value = Math.round(target.target_value * (SHIFT_HOURS - currentDowntime) / SHIFT_HOURS);
          }
          return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
        });
      }
    }
  }, [formData.team_id, formData.user_id, formData.date, targets, editingId, teams]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page !== 1) {
        setPagination(prev => ({ ...prev, page: 1 }));
      } else {
        fetchData();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (sampleProductionError) {
      toast.error(sampleProductionError);
      return;
    }

    const prodValue = parseFloat(formData.production_value.toString()) || 0;
    const sampleValue = parseInt(formData.sample_production) || 0;
    if (sampleValue > prodValue) {
      toast.error("Sample's Audited cannot be greater than Production");
      return;
    }

    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    // For member role, always override team_id and user_id from context
    if (currentUser?.role === 'member' && !editingId) {
      formData.team_id = currentUser.team_id || formData.team_id;
      formData.user_id = currentUser.id || formData.user_id;
      if (!formData.reporting_to) {
        const myTeam = teams.find(t => t.id === formData.team_id);
        formData.reporting_to = myTeam?.team_leader_name || '';
      }
    }

    const url = editingId ? `/api/production/${editingId}` : '/api/production';
    const method = editingId ? 'PUT' : 'POST';

    const trimmedOtherName = otherClientName.trim();
    let finalClientName = isOtherClient ? trimmedOtherName : formData.client_name;
    
    if (isOtherClient) {
      if (!trimmedOtherName) {
        toast.error('Please enter a client name');
        return;
      }
      
      const existingClient = clients.find(c => 
        c.name.toLowerCase() === trimmedOtherName.toLowerCase() && 
        (c.team_id === formData.team_id || c.team_id === null)
      ) || clients.find(c => c.name.toLowerCase() === trimmedOtherName.toLowerCase());
      
      if (!existingClient) {
        try {
          const res = await fetch('/api/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ name: trimmedOtherName, team_id: formData.team_id })
          });
          if (res.ok) {
            toast.success('Client added successfully');
            clearCache('clients');
            await fetchData();
            finalClientName = trimmedOtherName;
            setIsOtherClient(false);
            setOtherClientName('');
          } else {
            toast.error('Failed to add client');
            return;
          }
        } catch (err) {
          toast.error('Failed to add client');
          return;
        }
      } else if (existingClient.team_id !== formData.team_id) {
        // Map existing client to team only if not already mapped
        try {
          const res = await fetch(`/api/clients/${existingClient.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ ...existingClient, team_id: formData.team_id })
          });
          if (res.ok) {
            toast.success('Client mapped to team successfully');
            clearCache('clients');
            await fetchData();
            finalClientName = trimmedOtherName;
            setIsOtherClient(false);
            setOtherClientName('');
          } else {
            toast.error('Failed to map client to team');
            return;
          }
        } catch (err) {
          toast.error('Failed to map client to team');
          return;
        }
      } else {
        // Already mapped
        finalClientName = trimmedOtherName;
        setIsOtherClient(false);
        setOtherClientName('');
      }
    }

    if (!finalClientName) {
      toast.error('Please select or enter a client name');
      return;
    }

    try {
      const selectedTeam = teams.find(t => t.id === formData.team_id);
      const teamName = selectedTeam?.name || '';
      const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
      const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
      const isSpecialDept = ['Charge Entry'].includes(teamName);
      const isPaymentPosting = teamName === 'Payment Posting';

      let finalQualityLow = formData.quality_low || 0;
      let finalQualityHigh = formData.quality_high || 0;

      if (isAR || isSpecialDept) {
        const inputLow = formData.quality_low || 0;
        if (inputLow === 0) finalQualityLow = 0;
        else if (inputLow === 1) finalQualityLow = 0.5;
        else if (inputLow % 2 === 0) finalQualityLow = inputLow / 2;
        else finalQualityLow = Math.floor(inputLow / 2) + 0.05;
        
        finalQualityHigh = formData.quality_high || 0;
      } else if (isPaymentPosting) {
        finalQualityLow = (formData.quality_low || 0) / 3;
      }

      const sample = parseInt(formData.sample_production) || 0;
      const mistakes = finalQualityLow * 1 + finalQualityHigh * ((isSpecialDept || isPaymentPosting || isAR) ? 1 : 10);
      const correct = Math.max(0, sample - mistakes);
      const qualityPercent = sample > 0 ? Math.round((correct / sample) * 100) : 0;
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          ...formData,
          client_name: finalClientName,
          quality_low: finalQualityLow,
          quality_high: finalQualityHigh,
          quality: `${qualityPercent}%`,
          downtime: parseFloat(formData.downtime.toString()) || 0
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(data.message || (editingId ? 'Entry updated' : 'Entry added. Please lock it to finalize.'));
        if (isOtherClient) clearCache('clients');
        setIsModalOpen(false);
        setEditingId(null);
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to save entry');
      }
    } catch (error) {
      toast.error('Failed to save entry');
    }
  }, [editingId, modulePerms.can_edit, modulePerms.can_create, token, formData, fetchData, clients, isOtherClient, otherClientName, sampleProductionError]);

  const handleDelete = useCallback(async (id: string) => {
    const isTL = currentUser?.role === 'tl' || currentUser?.role === 'payment_posting';
    if (!modulePerms.can_delete && !isTL) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  }, [modulePerms.can_delete, currentUser?.role]);

  const confirmDelete = useCallback(async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/production/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Deleted successfully');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete. Please try again');
      }
    } catch (error) {
      toast.error('Failed to delete. Please try again');
    } finally {
      setIsDeleteModalOpen(false);
      setItemToDelete(null);
    }
  }, [itemToDelete, token, fetchData]);

  const openEdit = useCallback((entry: ProductionEntry) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    if (entry.is_locked && currentUser?.role !== 'super_admin') {
      return toast.error('Cannot edit a locked entry');
    }
    setEditingId(entry.id);
    const clientExists = clients.some(c => c.name === entry.client_name);
    setIsOtherClient(!clientExists && !!entry.client_name);
    setOtherClientName(!clientExists ? entry.client_name || '' : '');
    
    const isSpecialDept = ['AR Team', 'AR Analyst', 'Charge Entry'].includes(entry.team_name);
    const isPaymentPosting = entry.team_name === 'Payment Posting';
    
    let uncalculatedLow = entry.quality_low ?? 0;
    if (isSpecialDept) {
      if (uncalculatedLow === 0.5) uncalculatedLow = 1;
      else if (uncalculatedLow % 1 === 0) uncalculatedLow = uncalculatedLow * 2;
      else if (Math.abs((uncalculatedLow % 1) - 0.05) < 0.001) uncalculatedLow = Math.floor(uncalculatedLow) * 2 + 1;
    } else if (isPaymentPosting) {
      uncalculatedLow = uncalculatedLow * 3;
    }

    setFormData({
      team_id: entry.team_id,
      user_id: entry.user_id,
      client_name: entry.client_name || '',
      date: toInputDateFormat(entry.date),
      production_value: entry.production_value,
      target_value: entry.target_value,
      base_target: entry.target_value,
      downtime: (entry.downtime || 0).toString(),
      downtime_reason: entry.downtime_reason || '',
      sample_production: entry.sample_production || '',
      quality_low: uncalculatedLow,
      quality_high: entry.quality_high ?? 0,
      quality: entry.quality || '',
      notes: entry.notes || '',
      reporting_to: entry.reporting_to || ''
    });
    // If there was downtime, calculate back the base target
    if (entry.downtime && entry.downtime > 0 && entry.downtime < SHIFT_HOURS) {
      const base = Math.round(entry.target_value * SHIFT_HOURS / (SHIFT_HOURS - entry.downtime));
      setFormData(prev => ({ ...prev, base_target: base }));
    }
    const isStandard = STANDARD_DOWNTIME_REASONS.includes(entry.downtime_reason || '');
    setIsOtherReason(!isStandard && !!entry.downtime_reason);
    setIsModalOpen(true);
  }, [modulePerms.can_edit, currentUser?.role]);

  const toggleLock = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/production/${id}/toggle-lock`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, is_locked: !e.is_locked } : e));
        toast.success('Lock status updated');
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update lock status');
      }
    } catch (error) {
      toast.error('Connection error');
    }
  }, [token]);

  const handleExport = useCallback(async () => {
    setIsLoading(true);
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        limit: '10000', // Fetch a large number for export
        team_id: filters.team,
        search: filters.search,
        from,
        to
      });

      const response = await fetch(`/api/production?${queryParams}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });

      if (!response.ok) throw new Error('Failed to fetch data for export');
      
      const result = await response.json();
      const allFilteredEntries = result.data;

      if (allFilteredEntries.length === 0) {
        toast.error('No data to export');
        return;
      }

      const dataToExport = allFilteredEntries.map((entry: any) => {
        const parentName = entry.parent_team_name;
        const teamName = entry.team_name;
        const prefix = parentName ? `${parentName} - ` : '';
        const displayName = parentName ? (teamName.toUpperCase().startsWith(prefix.toUpperCase()) ? teamName : `${prefix}${teamName}`) : teamName;
        
        return {
          'Production Date': formatDate(entry.date),
          'Department': displayName,
          'User': entry.user_name,
          'Client': entry.client_name || '—',
          'Production': entry.production_value,
          'Target': entry.target_value,
          'Performance (%)': Math.round((entry.production_value / entry.target_value) * 100),
          'Downtime (Hours)': entry.downtime || 0,
          'Downtime Reason': entry.downtime_reason || '—',
          'Quality': formatQualityDisplay(entry.quality, entry.sample_production, currentUser?.role, entry.team_name),
          'Notes': entry.notes || ''
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Production Data');
      
      // Set column widths
      worksheet['!cols'] = [
        { wch: 15 }, // Production Date
        { wch: 20 }, // Department
        { wch: 20 }, // User
        { wch: 20 }, // Client
        { wch: 12 }, // Production
        { wch: 12 }, // Target
        { wch: 15 }, // Performance
        { wch: 15 }, // Downtime
        { wch: 20 }, // Downtime Reason
        { wch: 12 }, // Quality
        { wch: 30 }, // Notes
      ];

      XLSX.writeFile(workbook, `Production_Report_${formatDate(getPacificNow()).replace(/\//g, '-')}.xlsx`);
      toast.success('Excel file exported successfully');
    } catch (error) {
      toast.error('Failed to export data');
    } finally {
      setIsLoading(false);
    }
  }, [getFilterDates, filters.team, filters.search, token]);

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view production data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Production</h1>
          <p className="text-text-3 mt-1 text-xs">Track and manage production entries</p>
          {(currentUser?.role === 'tl' || currentUser?.role === 'payment_posting') && teams.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {teams.map((t, idx) => (
                <span key={`${t.id}-${idx}`} className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand border border-brand/20">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={handleExport}
            className="flex-1 sm:flex-none bg-surface border border-border hover:border-brand/50 text-text px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
          >
            <Download size={20} />
            Export to Excel
          </button>
          {modulePerms.can_create && (
            <button
              onClick={() => {
                setEditingId(null);
                setIsOtherReason(false);
                setIsOtherClient(false);
                setOtherClientName('');
                setSampleProductionError(null);
                setFormData(createInitialFormData());
                setIsModalOpen(true);
              }}
              className="flex-1 sm:flex-none bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
            >
              <Plus size={20} />
              Add Entry
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-surface border border-border rounded-2xl p-4">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" size={14} />
            <input 
              type="text"
              placeholder="Search..."
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
              className="w-full bg-bg border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-text outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Department</label>
          <select 
            value={(() => {
              const selectedTeam = teams.find(t => t.id === filters.team);
              return selectedTeam?.parent_id || filters.team;
            })()}
            onChange={(e) => {
              const deptId = e.target.value;
              setFilters({...filters, team: deptId});
            }}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {currentUser?.role !== 'tl' && <option value="">All Departments</option>}
            {(currentUser?.role === 'tl' ? tlDepartments : teams.filter(t => !t.parent_id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {(() => {
          const selectedDeptId = (() => {
            const selectedTeam = teams.find(t => t.id === filters.team);
            return selectedTeam?.parent_id || filters.team;
          })();
          const selectedDept = teams.find(t => t.id === selectedDeptId);
          const subTeams = teams.filter(t => t.parent_id === selectedDeptId);
          
          if (subTeams.length > 0) {
            const displayTeams = currentUser?.role === 'tl' 
              ? subTeams.filter(t => tlTeams.some(tl => tl.id === t.id || tl.id === selectedDeptId))
              : subTeams;
              
            if (displayTeams.length > 0) {
              return (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Team</label>
                  <select 
                    value={filters.team}
                    onChange={(e) => setFilters({...filters, team: e.target.value})}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
                  >
                    <option value={selectedDeptId}>All {selectedDept?.name} Teams</option>
                    {displayTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              );
            }
          }
          return null;
        })()}
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Day Filter</label>
          <select 
            value={filters.dayFilter}
            onChange={(e) => setFilters({...filters, dayFilter: e.target.value})}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
          >
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
            <option value="last_3_months">Last 3 Months</option>
            <option value="custom">Custom Date</option>
          </select>
        </div>
        {filters.dayFilter === 'custom' && (
          <>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">From</label>
              <input 
                type="date" 
                value={filters.customFrom}
                onChange={(e) => setFilters({...filters, customFrom: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
                placeholder="MM/DD/YYYY"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">To</label>
              <input 
                type="date" 
                value={filters.customTo}
                onChange={(e) => setFilters({...filters, customTo: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
                placeholder="MM/DD/YYYY"
              />
            </div>
          </>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-bg-secondary border-b border-border">
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Production Date</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Department</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">User</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Client</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Sample's Audited</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Production</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Target</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Downtime</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Downtime Reason</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Status</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Quality</th>
                {(modulePerms.can_edit || modulePerms.can_delete) && <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry, idx) => {
                const perf = Math.round((entry.production_value / entry.target_value) * 100);
                const allowedUnlockRoles = globalSettings.unlock_roles ? globalSettings.unlock_roles.split(',') : ['super_admin', 'admin', 'hr'];
                const canUnlock = currentUser && allowedUnlockRoles.includes(currentUser.role);
                const canEditLocked = currentUser?.role === 'super_admin';
                
                const spNum = entry.sample_production ? parseInt(String(entry.sample_production).replace(/\D/g, ''), 10) : 0;
                
                const qNum = entry.quality ? parseInt(String(entry.quality).replace(/\D/g, ''), 10) : 0;

                const parentName = entry.parent_team_name;
                const teamName = entry.team_name;
                const prefix = parentName ? `${parentName} - ` : '';
                const displayName = parentName ? (teamName.toUpperCase().startsWith(prefix.toUpperCase()) ? teamName : `${prefix}${teamName}`) : teamName;

                return (
                  <tr key={`${entry.id}-${idx}`} className="hover:bg-bg-secondary/50 transition-colors group">
                    <td className="px-6 py-4 font-mono text-xs text-text">{formatDate(entry.date)}</td>
                    <td className="px-6 py-4 text-sm text-text">
                      {displayName}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-text">{entry.user_name}</td>
                    <td className="px-6 py-4 text-sm text-text-3">{entry.client_name || '—'}</td>
                    <td className="px-6 py-4 text-sm font-mono text-text-3">
                      {entry.sample_production ? (
                        <span>{entry.sample_production}</span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right text-text">
                      {entry.production_value.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right text-text-3">{entry.target_value.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm font-mono text-right text-text-3">
                      {entry.downtime ? `${entry.downtime}h` : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-3 max-w-[200px] truncate" title={entry.downtime_reason || ''}>
                      {entry.downtime_reason || '—'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        perf >= 100 ? 'bg-success/10 text-success' : perf >= 80 ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'
                      }`}>
                        {perf}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-center text-text-3">
                      {entry.quality ? (
                        <span className="font-bold text-brand">{formatQualityDisplay(entry.quality, entry.sample_production, currentUser?.role, entry.team_name)}</span>
                      ) : '—'}
                    </td>
                    {(modulePerms.can_edit || modulePerms.can_delete) && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {modulePerms.can_edit && (!entry.is_locked || canUnlock) && (
                            <button 
                              onClick={() => toggleLock(entry.id)} 
                              className={`p-2 rounded-lg transition-colors ${
                                entry.is_locked 
                                  ? 'text-brand bg-brand/10' 
                                  : 'text-text-3 hover:bg-border'
                              }`}
                              title={entry.is_locked ? 'Unlock Entry' : 'Lock Entry'}
                            >
                              {entry.is_locked ? <Lock size={16} /> : <LockOpen size={16} />}
                            </button>
                          )}
                          {modulePerms.can_edit && (!entry.is_locked || canEditLocked) && (
                            <button 
                              onClick={() => openEdit(entry)} 
                              className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors" 
                              title="Edit Entry"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {(modulePerms.can_delete || currentUser?.role === 'tl') && !entry.is_locked && (
                            <button 
                              onClick={() => handleDelete(entry.id)} 
                              className="p-2 rounded-lg transition-colors text-text-3 hover:bg-error/10 hover:text-error"
                              title="Delete Entry"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {modulePerms.can_delete && entry.is_locked && !canUnlock && currentUser?.role !== 'tl' && (
                            <button 
                              onClick={() => handleDelete(entry.id)} 
                              disabled={true}
                              className="p-2 rounded-lg transition-colors opacity-30 cursor-not-allowed"
                              title="Cannot delete locked entry"
                            >
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
        
        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 bg-bg-secondary border-t border-border flex items-center justify-between">
            <div className="text-xs text-text-3">
              Showing <span className="font-bold text-text">{(pagination.page - 1) * pagination.limit + 1}</span> to <span className="font-bold text-text">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-bold text-text">{pagination.total}</span> entries
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-bold text-text disabled:opacity-50 hover:bg-bg transition-colors"
              >
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum = pagination.page;
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1;
                  } else {
                    if (pagination.page <= 3) pageNum = i + 1;
                    else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i;
                    else pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${pagination.page === pageNum ? 'bg-brand text-white' : 'bg-surface border border-border text-text hover:bg-bg'}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: Math.min(pagination.totalPages, prev.page + 1) }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-bold text-text disabled:opacity-50 hover:bg-bg transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface border border-border rounded-3xl p-6 w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]"
          >
            <h2 className="text-xl font-bold mb-4 text-text">{editingId ? 'Edit Entry' : 'Add Production Entry'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Department, Team, User, and Reporting To Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {currentUser?.role === 'member' ? (
                  // Member: auto-filled, read-only department and user
                  <>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Department</label>
                      <div className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text opacity-70 cursor-not-allowed">
                        {(() => {
                          const myTeam = teams.find(t => t.id === (currentUser?.team_id || formData.team_id));
                          const dept = myTeam?.parent_id ? teams.find(t => t.id === myTeam.parent_id) : myTeam;
                          return dept?.name || 'No Department';
                        })()}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Name</label>
                      <div className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text opacity-70 cursor-not-allowed">
                        {currentUser?.full_name || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Reporting To</label>
                      <div className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text opacity-70 cursor-not-allowed">
                        {formData.reporting_to || (() => {
                          const myTeam = teams.find(t => t.id === (currentUser?.team_id || formData.team_id));
                          return myTeam?.team_leader_name || '—';
                        })()}
                      </div>
                    </div>
                  </>
                ) : (
                  // Non-member: full dept/team/user selectors
                  <>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Department</label>
                  <select
                    value={(() => {
                      const currentTeam = teams.find(t => t.id === formData.team_id);
                      return currentTeam?.parent_id || formData.team_id;
                    })()}
                    onChange={(e) => {
                      const newDeptId = e.target.value;
                      setFormData(prev => ({ ...prev, team_id: newDeptId, user_id: '', reporting_to: '' }));
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={!!editingId}
                  >
                    <option value="">Select Department</option>
                    {(currentUser?.role === 'tl' ? tlDepartments : teams.filter(t => !t.parent_id))
                      .map((t, idx) => <option key={`${t.id}-${idx}`} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                {(() => {
                  const currentTeam = teams.find(t => t.id === formData.team_id);
                  const currentDeptId = currentTeam?.parent_id || formData.team_id;
                  
                  const subTeams = teams.filter(t => t.parent_id === currentDeptId);
                  if (subTeams.length > 0) {
                    return (
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team</label>
                        <select
                          value={formData.team_id}
                          onChange={(e) => {
                            const newTeamId = e.target.value;
                            setFormData(prev => ({ ...prev, team_id: newTeamId, user_id: '', reporting_to: '' }));
                          }}
                          className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                          required
                          disabled={!!editingId}
                        >
                          <option value="">Select Team</option>
                          {subTeams
                            .filter(t => {
                              if (currentUser?.role === 'tl') {
                                return tlTeams.some(tl => tl.id === t.id);
                              }
                              return true;
                            })
                            .map((t, idx) => {
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

                {(() => {
                  const showUserFields = !!formData.team_id;
                  if (!showUserFields) return null;

                  return (
                    <>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">User</label>
                        <select
                          value={formData.user_id}
                          onChange={(e) => {
                            const selectedUserId = e.target.value;
                            const selectedUser = users.find(u => u.id === selectedUserId);
                            if (selectedUser && selectedUser.team_id) {
                              const team = teams.find(t => t.id === selectedUser.team_id);
                              setFormData(prev => ({ 
                                ...prev, 
                                user_id: selectedUserId, 
                                team_id: selectedUser.team_id,
                                reporting_to: team?.team_leader_name || ''
                              }));
                            } else {
                              setFormData(prev => ({ ...prev, user_id: selectedUserId }));
                            }
                          }}
                          className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                          required
                          disabled={!!editingId}
                        >
                          <option value="">Select User</option>
                          {users
                            .filter(u => {
                              if (editingId) return u.id === formData.user_id;
                              if (!u.is_active || !u.team_id || ['super_admin', 'admin', 'hr'].includes(u.role)) return false;
                              
                              if (currentUser?.role === 'tl') {
                                return tlTeams.some(tl => tl.id === u.team_id) || 
                                       (formData.team_id && u.team_id === formData.team_id);
                              }
                              
                              return !formData.team_id || u.team_id === formData.team_id || teams.find(t => t.id === u.team_id)?.parent_id === formData.team_id;
                            })
                            .map((u, idx) => (
                              <option key={`${u.id}-${idx}`} value={u.id}>{u.full_name} ({u.username})</option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Reporting To</label>
                        <input
                          type="text"
                          value={formData.reporting_to}
                          onChange={(e) => setFormData({ ...formData, reporting_to: e.target.value })}
                          className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                          placeholder="Team Leader name"
                        />
                      </div>
                    </>
                  );
                })()}
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Production Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                    placeholder="MM/DD/YYYY"
                  />
                </div>
                <div className="relative">
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Client</label>
                  <div className="flex gap-2">
                    <select
                      value={isOtherClient ? 'Other' : (formData.client_name ?? '')}
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
                      required
                    >
                      <option value="">{uniqueSortedClients.length > 0 ? 'Select Client' : 'No Clients Available'}</option>
                      {uniqueSortedClients.map((c, idx) => (
                        <option key={`${c.id}-${idx}`} value={c.name}>{c.name}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                    {!isOtherClient && formData.client_name && uniqueSortedClients.some(c => c.name === formData.client_name) && (
                      <button
                        type="button"
                        onClick={() => {
                          const client = uniqueSortedClients.find(c => c.name === formData.client_name);
                          if (client) handleDeleteClient(client.id);
                        }}
                        className="p-2.5 text-red-500 hover:bg-red-500/10 rounded-xl border border-border transition-colors"
                        title="Delete Client"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isOtherClient && (
                <div className="mb-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Production</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={formData.production_value ?? 0}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setFormData(prev => ({ ...prev, production_value: val }));
                        const sampleNum = parseInt(formData.sample_production) || 0;
                        if (sampleNum > val) {
                          setSampleProductionError("Sample's Audited cannot be greater than Production.");
                        } else {
                          setSampleProductionError(null);
                        }
                      }}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                      required
                      min="0"
                    />
                    {formData.target_value > 0 && formData.production_value > 0 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-brand">
                        {Math.round((formData.production_value / formData.target_value) * 100)}%
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Target (Adjusted)</label>
                  <input
                    type="number"
                    value={formData.target_value ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setFormData(prev => {
                        const currentDowntime = parseFloat(prev.downtime.toString()) || 0;
                        // If user manually edits target, we update base_target accordingly
                        const base = currentDowntime < SHIFT_HOURS 
                          ? Math.round(val * SHIFT_HOURS / (SHIFT_HOURS - currentDowntime))
                          : val;
                        return { ...prev, target_value: val, base_target: base };
                      });
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                    min="0"
                  />
                  {formData.base_target !== formData.target_value && (
                    <p className="text-[10px] text-text-3 mt-1 italic">
                      Base target: {formData.base_target} (reduced by {Math.round(parseFloat(formData.downtime.toString()) * 100 / SHIFT_HOURS)}% due to downtime)
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Downtime (Hours)</label>
                  <input
                    type="text"
                    value={formData.downtime ?? '0'}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow empty string, numbers, and one decimal point
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        const numVal = val === '' ? 0 : parseFloat(val);
                        if (numVal > SHIFT_HOURS) {
                          toast.error(`Downtime cannot exceed shift hours (${SHIFT_HOURS}h)`);
                          return;
                        }
                        setFormData(prev => {
                          const adjustedTarget = Math.round(prev.base_target * (SHIFT_HOURS - numVal) / SHIFT_HOURS);
                          return { ...prev, downtime: val, target_value: adjustedTarget };
                        });
                      }
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    placeholder="0.0"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Sample's Audited</label>
                  <div className="relative">
                    <input
                      type="text"
                      name="SAMPLE PRODUCTION"
                      value={formData.sample_production ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*$/.test(val)) {
                          setFormData(prev => ({ ...prev, sample_production: val }));
                          const sampleNum = parseInt(val) || 0;
                          if (sampleNum > formData.production_value) {
                            setSampleProductionError("Sample's Audited cannot be greater than Production.");
                          } else {
                            setSampleProductionError(null);
                          }
                        }
                      }}
                      className={`w-full bg-bg border ${sampleProductionError ? 'border-error' : 'border-border'} rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand`}
                      placeholder="Enter numeric value"
                    />
                    {sampleProductionError && <p className="text-error text-[10px] mt-1">{sampleProductionError}</p>}
                  </div>
                </div>
              {parseFloat(formData.downtime.toString()) > 0 && (
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Downtime Reason</label>
                  <select
                    value={isOtherReason ? "Other" : (formData.downtime_reason ?? '')}
                    onChange={(e) => {
                      if (e.target.value === "Other") {
                        setIsOtherReason(true);
                        setFormData({ ...formData, downtime_reason: "" });
                      } else {
                        setIsOtherReason(false);
                        setFormData({ ...formData, downtime_reason: e.target.value });
                      }
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required={parseFloat(formData.downtime.toString()) > 0}
                  >
                    <option value="">Select Reason</option>
                    {STANDARD_DOWNTIME_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    <option value="Other">Other</option>
                  </select>
                  {isOtherReason && (
                    <input
                      type="text"
                      value={formData.downtime_reason ?? ''}
                      onChange={(e) => setFormData({ ...formData, downtime_reason: e.target.value })}
                      placeholder="Enter custom reason"
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand animate-in slide-in-from-top-1 duration-200"
                      required
                    />
                  )}
                </div>
              )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Low</label>
                  <input
                    id="lowInput"
                    type="number"
                    value={formData.quality_low ?? 0}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d*$/.test(val)) {
                        setFormData(prev => ({ ...prev, quality_low: parseInt(val) || 0 }));
                      }
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    min="0"
                  />
                  {(() => {
                    const selectedTeam = teams.find(t => t.id === formData.team_id);
                    const teamName = selectedTeam?.name || '';
                    const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
                    const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
                    const isSpecialDept = ['Charge Entry'].includes(teamName);
                    const isPaymentPosting = teamName === 'Payment Posting';
                    
                    if (isAR || isSpecialDept) {
                      const inputLow = formData.quality_low || 0;
                      let calcLow = 0;
                      if (inputLow === 1) calcLow = 0.5;
                      else if (inputLow % 2 === 0) calcLow = inputLow / 2;
                      else if (inputLow > 1) calcLow = Math.floor(inputLow / 2) + 0.05;
                      
                      return (
                        <div className="mt-1 text-[10px] text-text-3 font-medium">
                          Calculated: {calcLow}
                        </div>
                      );
                    }
                    
                    if (isPaymentPosting) {
                      const inputLow = formData.quality_low || 0;
                      const calcLow = (inputLow / 3).toFixed(2);
                      return (
                        <div className="mt-1 text-[10px] text-text-3 font-medium">
                          Calculated: {calcLow} ({inputLow}/3)
                        </div>
                      );
                    }
                    
                    return null;
                  })()}
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">High</label>
                  <input
                    id="highInput"
                    type="number"
                    value={formData.quality_high ?? 0}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d*$/.test(val)) {
                        setFormData(prev => ({ ...prev, quality_high: parseInt(val) || 0 }));
                      }
                    }}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    min="0"
                  />
                  {(() => {
                    const selectedTeam = teams.find(t => t.id === formData.team_id);
                    const teamName = selectedTeam?.name || '';
                    const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
                    const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
                    const isSpecialDept = ['Charge Entry'].includes(teamName);
                    const isPaymentPosting = teamName === 'Payment Posting';
                    
                    if (isAR || isSpecialDept || isPaymentPosting) {
                      return (
                        <div className="mt-1 text-[10px] text-text-3 font-medium">
                          Weight: 1:1
                        </div>
                      );
                    }
                    return (
                      <div className="mt-1 text-[10px] text-text-3 font-medium">
                        Weight: 1:10
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="bg-bg p-4 rounded-xl border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-3">Total Weighted Mistakes:</span>
                  <span className="font-mono font-bold text-text">
                    {(() => {
                      const selectedTeam = teams.find(t => t.id === formData.team_id);
                      const teamName = selectedTeam?.name || '';
                      const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
                      const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
                      const isSpecialDept = ['Charge Entry'].includes(teamName);
                      const isPaymentPosting = teamName === 'Payment Posting';
                      
                      let low = formData.quality_low || 0;
                      let high = formData.quality_high || 0;
                      
                      if (isAR || isSpecialDept) {
                        const inputLow = low;
                        if (inputLow === 0) low = 0;
                        else if (inputLow === 1) low = 0.5;
                        else if (inputLow % 2 === 0) low = inputLow / 2;
                        else low = Math.floor(inputLow / 2) + 0.05;
                        high = formData.quality_high || 0;
                      } else if (isPaymentPosting) {
                        low = low / 3;
                      }
                      
                      return low * 1 + high * ((isSpecialDept || isPaymentPosting || isAR) ? 1 : 10);
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-3">Correct Units:</span>
                  <span className="font-mono font-bold text-text">
                    {(() => {
                      const sample = parseInt(formData.sample_production) || 0;
                      const selectedTeam = teams.find(t => t.id === formData.team_id);
                      const teamName = selectedTeam?.name || '';
                      const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
                      const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
                      const isSpecialDept = ['Charge Entry'].includes(teamName);
                      const isPaymentPosting = teamName === 'Payment Posting';
                      
                      let low = formData.quality_low || 0;
                      let high = formData.quality_high || 0;
                      
                      if (isAR || isSpecialDept) {
                        const inputLow = low;
                        if (inputLow === 0) low = 0;
                        else if (inputLow === 1) low = 0.5;
                        else if (inputLow % 2 === 0) low = inputLow / 2;
                        else low = Math.floor(inputLow / 2) + 0.05;
                        high = formData.quality_high || 0;
                      } else if (isPaymentPosting) {
                        low = low / 3;
                      }
                      
                      const mistakes = low * 1 + high * ((isSpecialDept || isPaymentPosting || isAR) ? 1 : 10);
                      return Math.max(0, sample - mistakes);
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-3">Quality %:</span>
                  <span className="font-mono font-bold text-brand">
                    {(() => {
                      const sample = parseInt(formData.sample_production) || 0;
                      const selectedTeam = teams.find(t => t.id === formData.team_id);
                      const teamName = selectedTeam?.name || '';
                      const isARSubTeam = teamName.startsWith('AR - ') || (selectedTeam?.parent_id && teams.find(t => t.id === selectedTeam.parent_id)?.name === 'AR');
                      const isAR = ['AR', 'AR (Accounts Receivable)', 'AR Team', 'AR Analyst'].includes(teamName) || isARSubTeam;
                      const isSpecialDept = ['Charge Entry'].includes(teamName);
                      const isPaymentPosting = teamName === 'Payment Posting';
                      
                      let low = formData.quality_low || 0;
                      let high = formData.quality_high || 0;
                      
                      if (isAR || isSpecialDept) {
                        const inputLow = low;
                        if (inputLow === 0) low = 0;
                        else if (inputLow === 1) low = 0.5;
                        else if (inputLow % 2 === 0) low = inputLow / 2;
                        else low = Math.floor(inputLow / 2) + 0.05;
                        high = formData.quality_high || 0;
                      } else if (isPaymentPosting) {
                        low = low / 3;
                      }
                      
                      const mistakes = low * 1 + high * ((isSpecialDept || isPaymentPosting || isAR) ? 1 : 10);
                      const correct = Math.max(0, sample - mistakes);
                      return sample > 0 ? `${Math.round((correct / sample) * 100)}%` : '0%';
                    })()}
                  </span>
                </div>
              </div>
              <div className="h-px bg-black my-6" />
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Notes</label>
                <textarea
                  value={formData.notes ?? ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand h-20 resize-none"
                  placeholder="Optional notes..."
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all"
                >
                  {editingId ? 'Update Entry' : 'Save Entry'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isClientDeleteModalOpen}
        onClose={() => setIsClientDeleteModalOpen(false)}
        onConfirm={confirmDeleteClient}
        title="Delete Client"
        message="Are you sure you want to delete this client?"
        confirmText="Delete"
        cancelText="Cancel"
      />
      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Entry"
        message="Are you sure you want to delete this item?"
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
