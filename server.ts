import * as dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
console.log("DATABASE_URL:", process.env.DATABASE_URL);

process.env.TZ = 'America/Los_Angeles';

const { default: db, initDb } = await import("./src/db.ts");

const JWT_SECRET = process.env.JWT_SECRET || "production_analyst_secret_key_123";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

async function findAvailablePort(startPort: number, host: string): Promise<number> {
  const isPortAvailable = (port: number) =>
    new Promise<boolean>((resolve, reject) => {
      const tester = createNetServer()
        .once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "EADDRINUSE" || error.code === "EACCES") {
            resolve(false);
            return;
          }
          reject(error);
        })
        .once("listening", () => {
          tester.close(() => resolve(true));
        });

      tester.listen(port, host);
    });

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port += 1;
  }

  return port;
}

async function startServer() {
  initDb();
  const app = express();
  const DEFAULT_PORT = Number(process.env.PORT || 3000);
  const HOST = "0.0.0.0";
  const httpServer = createHttpServer(app);

  // Performance: create indexes for most-queried columns
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pe_user_id ON production_entries(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pe_team_id ON production_entries(team_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pe_date ON production_entries(date)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pe_is_locked ON production_entries(is_locked)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pe_created_by ON production_entries(created_by)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_teams_parent_id ON teams(parent_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_teams_leader_id ON teams(team_leader_id)').run();
  } catch (_) { /* indexes may already exist */ }

  app.use(express.json({ limit: '50mb' }));

  // SSE Clients
  const sseClients = new Map<string, Set<any>>();

  const broadcastEvent = (event: string, data: any = {}, userId?: string) => {
    if (userId) {
      const userClients = sseClients.get(userId);
      if (userClients) {
        userClients.forEach(client => {
          client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
      }
    } else {
      sseClients.forEach(userClients => {
        userClients.forEach(client => {
          client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
      });
    }
  };

  const toSql = (val: any) => {
    if (val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  };

  const hasOwn = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj || {}, key);

  const normalizeNullableIdentifier = (val: any) => {
    if (val === undefined || val === null || val === '') return null;
    return val;
  };

  const normalizeOptionalValue = (val: any) => {
    if (val === undefined) return null;
    return val;
  };

  const parseNumericField = (value: any, fieldName: string, options?: { required?: boolean; defaultValue?: number; min?: number }) => {
    const required = options?.required ?? false;
    const defaultValue = options?.defaultValue;
    const min = options?.min;

    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new ValidationError(`${fieldName} is required`);
      }
      return defaultValue ?? null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new ValidationError(`${fieldName} must be a valid number`);
    }

    if (min !== undefined && parsed < min) {
      throw new ValidationError(`${fieldName} cannot be negative`);
    }

    return parsed;
  };

  const logApiRequest = (route: string, payload: any) => {
    console.log(`[${route}] request`, payload);
  };

  const logApiQuery = (route: string, message: string, payload?: any) => {
    if (payload === undefined) {
      console.log(`[${route}] ${message}`);
      return;
    }
    console.log(`[${route}] ${message}`, payload);
  };

  const logApiError = (route: string, error: unknown, payload?: any) => {
    if (payload !== undefined) {
      console.error(`[${route}] error`, payload);
    }
    console.error(`[${route}]`, error);
  };

  app.get('/api/events', (req: any, res: any) => {
    const token = req.query.token;
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return res.sendStatus(403);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const userId = decoded.id;
      if (!sseClients.has(userId)) {
        sseClients.set(userId, new Set());
      }
      sseClients.get(userId)!.add(res);

      req.on('close', () => {
        const userClients = sseClients.get(userId);
        if (userClients) {
          userClients.delete(res);
          if (userClients.size === 0) {
            sseClients.delete(userId);
          }
        }
      });
    });
  });

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return res.sendStatus(403);
      
      // Fetch latest user info from DB to ensure team_id and other fields are current
      const user = db.prepare('SELECT id, username, full_name, role, team_id, is_active FROM users WHERE id = ?').get(decoded.id) as any;
      
      if (!user) return res.sendStatus(403);
      if (!user.is_active) return res.status(403).json({ message: "Account deactivated" });
      
      req.user = user;
      next();
    });
  };

  const checkAdmin = (req: any, res: any, next: any) => {
    if (req.user && (req.user.role === 'super_admin' || req.user.role === 'admin')) {
      next();
    } else {
      res.status(403).json({ message: "Admin access required" });
    }
  };

  const checkPermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete') => {
    return (req: any, res: any, next: any) => {
      if (req.user.role === 'super_admin') return next();

      const permission = db.prepare(`
        SELECT can_view, can_create, can_edit, can_delete 
        FROM role_permissions 
        WHERE role = ? AND module = ?
      `).get(req.user.role, module) as any;

      if (!permission) return res.status(403).json({ message: "Permission denied" });

      const hasPermission = 
        (action === 'view' && permission.can_view) ||
        (action === 'create' && permission.can_create) ||
        (action === 'edit' && permission.can_edit) ||
        (action === 'delete' && permission.can_delete);

      if (!hasPermission) {
        return res.status(403).json({ message: `Permission denied for ${action} on ${module}` });
      }
      next();
    };
  };

  // --- Helper Functions ---
  // Migration for notifications table
  try {
    db.prepare("ALTER TABLE notifications ADD COLUMN type TEXT").run();
    db.prepare("ALTER TABLE notifications ADD COLUMN reference_id TEXT").run();
  } catch (e) {
    // Columns probably already exist
  }

  const createGlobalNotification = (title: string, message: string, type?: string, reference_id?: string) => {
    const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all() as any[];
    const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction((usersList) => {
      for (const user of usersList) {
        stmt.run(uuidv4(), user.id, title, message, type || null, reference_id || null);
      }
    });
    transaction(users);
    broadcastEvent('notifications-updated');
  };

  // --- API Routes ---

  // Auth
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(toSql(username)) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: "Account deactivated" });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    
    const permissions = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(user.role) as any[];
    const permissionsMap: any = {};
    permissions.forEach(p => {
      permissionsMap[p.module] = {
        can_view: !!p.can_view,
        can_create: !!p.can_create,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete
      };
    });

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(user.id) as any || { theme: 'light' };

    res.json({ 
      token, 
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, team_id: user.team_id },
      permissions: permissionsMap,
      settings,
      needsPasswordChange: !!user.needs_password_change
    });
  });

  app.post("/api/auth/force-change-password", authenticateToken, (req: any, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ?, needs_password_change = 0 WHERE id = ?').run(hashedPassword, req.user.id);
    
    res.json({ success: true });
  });

  // Role Permissions
  app.get("/api/me/permissions", authenticateToken, (req: any, res) => {
    if (req.user.role === 'super_admin') {
      return res.json({ super_admin: true });
    }
    const permissions = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(req.user.role) as any[];
    const permissionsMap: any = {};
    permissions.forEach(p => {
      permissionsMap[p.module] = {
        can_view: !!p.can_view,
        can_create: !!p.can_create,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete
      };
    });
    res.json(permissionsMap);
  });

  app.get("/api/permissions", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canView = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_view);

    if (!canView) {
      return res.status(403).json({ message: "Unauthorized. Settings access required." });
    }
    
    const roles = ['admin', 'hr', 'tl', 'member', 'payment_posting'];
    const placeholders = roles.map(() => '?').join(',');
    const permissions = db.prepare(`SELECT * FROM role_permissions WHERE role IN (${placeholders})`).all(...roles);
    res.json(permissions);
  });

  app.post("/api/permissions", authenticateToken, (req: any, res) => {
    const { role, module, can_view, can_create, can_edit, can_delete } = req.body;
    
    // Authorization check - ONLY SuperAdmin
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "Unauthorized. SuperAdmin access required." });
    }

    db.prepare(`
      INSERT OR REPLACE INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(toSql(role), toSql(module), can_view ? 1 : 0, can_create ? 1 : 0, can_edit ? 1 : 0, can_delete ? 1 : 0);

    broadcastEvent('permissions-updated');
    res.json({ success: true });
  });

  // Global Settings
  app.get("/api/company-info", (req, res) => {
    const settings = db.prepare("SELECT * FROM settings WHERE key IN ('company_name', 'company_logo', 'theme_color', 'theme')").all() as any[];
    const info: any = {};
    settings.forEach(s => {
      info[s.key] = s.value;
    });
    res.json(info);
  });

  app.get("/api/global-settings", authenticateToken, (req: any, res) => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const settingsMap: any = {};
    settings.forEach(s => {
      settingsMap[s.key] = s.value;
    });
    res.json(settingsMap);
  });

  app.post("/api/global-settings", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canEdit = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_edit);
    const canDelete = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_delete);
    const canView = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_view) || ['hr', 'tl', 'member', 'payment_posting'].includes(req.user.role);

    if (!canEdit && !canDelete && !canView) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const { company_name, company_logo, notifications_enabled, unlock_roles, theme_color, theme } = req.body;
    
    // Only users with delete permission can change theme_color or theme
    if ((theme_color !== undefined || theme !== undefined) && !canDelete) {
      return res.status(403).json({ message: "Delete permission required to change the theme" });
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction(() => {
      if (company_name !== undefined && canEdit) stmt.run('company_name', toSql(company_name));
      if (company_logo !== undefined && canEdit) stmt.run('company_logo', toSql(company_logo));
      if (notifications_enabled !== undefined && canView) stmt.run('notifications_enabled', toSql(notifications_enabled.toString()));
      if (unlock_roles !== undefined && canEdit) stmt.run('unlock_roles', toSql(unlock_roles));
      if (theme_color !== undefined && canDelete) stmt.run('theme_color', toSql(theme_color));
      if (theme !== undefined && canDelete) stmt.run('theme', toSql(theme));
    });
    
    transaction();
    broadcastEvent('global-settings-updated');
    res.json({ success: true });
  });

  app.post("/api/permissions/bulk", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canManage = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_delete);

    if (!canManage) {
      return res.status(403).json({ message: "Unauthorized. Administrative access required." });
    }
    
    const { permissions } = req.body;
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = db.transaction((perms) => {
      // Get current user's permissions to validate they aren't granting more than they have
      const userPerms = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(req.user.role) as any[];
      const userPermsMap = userPerms.reduce((acc, p) => {
        acc[p.module] = p;
        return acc;
      }, {} as any);

      for (const p of perms) {
        // If not super_admin, check if user has the permission they are trying to grant
        if (req.user.role !== 'super_admin') {
          const uPerm = userPermsMap[p.module] || { can_view: 0, can_create: 0, can_edit: 0, can_delete: 0 };
          if (p.can_view && !uPerm.can_view) p.can_view = 0;
          if (p.can_create && !uPerm.can_create) p.can_create = 0;
          if (p.can_edit && !uPerm.can_edit) p.can_edit = 0;
          if (p.can_delete && !uPerm.can_delete) p.can_delete = 0;
        }
        stmt.run(toSql(p.role), toSql(p.module), p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0);
      }
    });
    
    try {
      transaction(permissions);
      broadcastEvent('permissions-updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/change-password", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canCreate = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_create);
    if (!canCreate) {
      return res.status(403).json({ message: "Create permission required to change password" });
    }
    const { newPassword } = req.body;

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);
    
    res.json({ success: true });
  });

  // Notifications
  app.get("/api/notifications", authenticateToken, (req: any, res) => {
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json(notifications);
  });

  app.delete("/api/notifications", authenticateToken, (req: any, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/:id/read", authenticateToken, (req: any, res) => {
    db.prepare('UPDATE notifications SET is_read = 1, is_shown = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/:id/shown", authenticateToken, (req: any, res) => {
    db.prepare('UPDATE notifications SET is_shown = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  // User Settings
  app.get("/api/user-settings", authenticateToken, (req: any, res) => {
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    res.json(settings || { theme: 'light' });
  });

  app.post("/api/user-settings", authenticateToken, (req: any, res) => {
    const { theme } = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO user_settings (user_id, theme)
      VALUES (?, ?)
    `).run(req.user.id, toSql(theme));
    res.json({ success: true });
  });

  // Settings (Restricted to SuperAdmin)
  app.get("/api/settings", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "SuperAdmin access required" });
    }
    res.json({
      theme: 'light',
      notifications: true,
      permissions: {
        admin: ['dashboard', 'users', 'teams', 'production', 'targets', 'settings'],
        tl: ['production'],
        member: ['production_view']
      }
    });
  });

  app.post("/api/settings", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "SuperAdmin access required" });
    }
    res.json({ success: true });
  });

  const formatTeamDisplayName = (teamName?: string | null, parentTeamName?: string | null) => {
    if (!teamName) return '';
    if (!parentTeamName) return teamName;
    const prefix = `${parentTeamName} - `;
    return teamName.toUpperCase().startsWith(prefix.toUpperCase()) ? teamName : `${prefix}${teamName}`;
  };

  const isLowWeightQualityTeam = (teamName?: string | null, parentTeamName?: string | null) => {
    const normalizedTeam = (teamName || '').trim().toLowerCase();
    const normalizedParent = (parentTeamName || '').trim().toLowerCase();
    return normalizedTeam === 'payment posting'
      || normalizedTeam === 'charge entry'
      || normalizedTeam === 'ar'
      || normalizedTeam === 'ar (accounts receivable)'
      || normalizedTeam === 'ar team'
      || normalizedTeam === 'ar analyst'
      || normalizedTeam.startsWith('ar - ')
      || normalizedParent === 'ar';
  };

  const buildDashboardEntryScope = (req: any, filters: any, options?: { useResolvedClientFilter?: boolean }) => {
    let baseFrom = `
      FROM production_entries pe
      LEFT JOIN teams t ON pe.team_id = t.id
      LEFT JOIN teams pt ON t.parent_id = pt.id
      LEFT JOIN users u ON pe.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (req.user.role === 'member') {
      baseFrom += ' AND pe.user_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      baseFrom += ' AND (t.team_leader_id = ? OR pe.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    if (filters.team_id) {
      baseFrom += ' AND (pe.team_id = ? OR t.parent_id = ?)';
      params.push(filters.team_id, filters.team_id);
    }
    if (filters.user_id) {
      baseFrom += ' AND pe.user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.client) {
      baseFrom += options?.useResolvedClientFilter
        ? ' AND COALESCE(NULLIF(pe.client_name, \'\'), NULLIF(t.client_name, \'\'), \'\') = ?'
        : ' AND pe.client_name = ?';
      params.push(filters.client);
    }
    if (filters.from) {
      baseFrom += ' AND pe.date >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      baseFrom += ' AND pe.date <= ?';
      params.push(filters.to);
    }

    return { baseFrom, params };
  };

  const buildDailyProductionTrend = (rows: any[], filters: any) => {
    if (!rows.length) {
      return [];
    }

    const toIsoDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
    const formatIsoDate = (value: Date) => value.toISOString().slice(0, 10);

    const sortedRows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const endIso = typeof filters.to === 'string' && filters.to
      ? filters.to
      : String(sortedRows[sortedRows.length - 1].date);
    const endDate = toIsoDate(endIso);

    const defaultWindowStart = new Date(endDate);
    defaultWindowStart.setUTCDate(defaultWindowStart.getUTCDate() - 13);
    const defaultStartIso = formatIsoDate(defaultWindowStart);

    let startIso = typeof filters.from === 'string' && filters.from
      ? filters.from
      : String(sortedRows[0].date);
    if (startIso < defaultStartIso) {
      startIso = defaultStartIso;
    }
    if (startIso > endIso) {
      startIso = endIso;
    }

    const rowMap = new Map(
      sortedRows.map((row) => [
        String(row.date),
        {
          production: Number(row.production || 0),
          target: Number(row.target || 0),
        },
      ])
    );

    const points: any[] = [];
    for (let cursor = toIsoDate(startIso); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const iso = formatIsoDate(cursor);
      const value = rowMap.get(iso) || { production: 0, target: 0 };
      points.push({
        date: iso.split('-').slice(1).join('/'),
        production: value.production,
        target: value.target,
        performance: value.target > 0 ? Math.round((value.production / value.target) * 100) : 0,
      });
    }

    return points;
  };

  const buildDashboardUserScope = (req: any, filters: any) => {
    let baseFrom = `
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      LEFT JOIN teams pt ON t.parent_id = pt.id
      WHERE u.is_active = 1
    `;
    const params: any[] = [];

    if (req.user.role === 'member') {
      baseFrom += ' AND u.id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      baseFrom += ' AND (t.team_leader_id = ? OR u.id = ?)';
      params.push(req.user.id, req.user.id);
    }

    if (filters.team_id) {
      baseFrom += ' AND (u.team_id = ? OR t.parent_id = ?)';
      params.push(filters.team_id, filters.team_id);
    }
    if (filters.user_id) {
      baseFrom += ' AND u.id = ?';
      params.push(filters.user_id);
    }
    if (filters.client) {
      baseFrom += ' AND COALESCE(t.client_name, \'\') = ?';
      params.push(filters.client);
    }

    return { baseFrom, params };
  };

  // Dashboard Stats
  app.get("/api/dashboard/stats", authenticateToken, checkPermission('dashboard', 'view'), (req: any, res) => {
    const route = "GET /api/dashboard/stats";
    logApiRequest(route, req.query);

    try {
      const { baseFrom, params } = buildDashboardEntryScope(req, req.query);

      const aggregate = db.prepare(`
        SELECT
          COUNT(*) AS total_entries,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) AS total_production,
          COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) AS total_target,
          COALESCE(SUM(COALESCE(pe.downtime, 0)), 0) AS total_downtime
        ${baseFrom}
      `).get(...params) as any;

      const qualityAggregate = db.prepare(`
        SELECT
          COALESCE(SUM(
            COALESCE(pe.quality_low, 0) +
            (
              COALESCE(pe.quality_high, 0) *
              CASE
                WHEN LOWER(COALESCE(t.name, '')) = 'payment posting'
                  OR LOWER(COALESCE(t.name, '')) = 'charge entry'
                  OR LOWER(COALESCE(t.name, '')) = 'ar'
                  OR LOWER(COALESCE(t.name, '')) = 'ar (accounts receivable)'
                  OR LOWER(COALESCE(t.name, '')) = 'ar team'
                  OR LOWER(COALESCE(t.name, '')) = 'ar analyst'
                  OR LOWER(COALESCE(t.name, '')) LIKE 'ar - %'
                  OR LOWER(COALESCE(pt.name, '')) = 'ar'
                THEN 1
                ELSE 10
              END
            )
          ), 0) AS total_mistakes,
          COALESCE(SUM(
            COALESCE(NULLIF(TRIM(COALESCE(pe.sample_production, '')), '')::double precision, COALESCE(pe.production_value, 0))
          ), 0) AS total_sample
        ${baseFrom}
      `).get(...params) as any;

      let teamsCountQuery = 'SELECT COUNT(*) AS count FROM teams t WHERE t.is_active = 1';
      const teamsCountParams: any[] = [];

      if (req.user.role === 'member') {
        teamsCountQuery += ' AND t.id = ?';
        teamsCountParams.push(req.user.team_id || null);
      } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
        teamsCountQuery += ' AND t.team_leader_id = ?';
        teamsCountParams.push(req.user.id);
      }
      if (req.query.team_id) {
        teamsCountQuery += ' AND (t.id = ? OR t.parent_id = ?)';
        teamsCountParams.push(req.query.team_id, req.query.team_id);
      }
      if (req.query.client) {
        teamsCountQuery += ' AND COALESCE(t.client_name, \'\') = ?';
        teamsCountParams.push(req.query.client);
      }

      let usersCountQuery = `
        SELECT COUNT(DISTINCT u.id) AS count
        FROM users u
        LEFT JOIN teams t ON u.team_id = t.id
        WHERE u.is_active = 1
      `;
      const usersCountParams: any[] = [];

      if (req.user.role === 'member') {
        usersCountQuery += ' AND u.id = ?';
        usersCountParams.push(req.user.id);
      } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
        usersCountQuery += ' AND (t.team_leader_id = ? OR u.id = ?)';
        usersCountParams.push(req.user.id, req.user.id);
      }
      if (req.query.team_id) {
        usersCountQuery += ' AND (u.team_id = ? OR t.parent_id = ?)';
        usersCountParams.push(req.query.team_id, req.query.team_id);
      }
      if (req.query.user_id) {
        usersCountQuery += ' AND u.id = ?';
        usersCountParams.push(req.query.user_id);
      }
      if (req.query.client) {
        usersCountQuery += ' AND COALESCE(t.client_name, \'\') = ?';
        usersCountParams.push(req.query.client);
      }

      const teamsCount = db.prepare(teamsCountQuery).get(...teamsCountParams) as any;
      const usersCount = db.prepare(usersCountQuery).get(...usersCountParams) as any;

      const totalProduction = Number(aggregate?.total_production || 0);
      const totalTarget = Number(aggregate?.total_target || 0);
      const totalSample = Number(qualityAggregate?.total_sample || 0);
      const totalMistakes = Number(qualityAggregate?.total_mistakes || 0);

      const payload = {
        totalEntries: Number(aggregate?.total_entries || 0),
        totalProduction,
        totalTarget,
        totalDowntime: Number(aggregate?.total_downtime || 0),
        averagePerformance: totalTarget > 0 ? (totalProduction / totalTarget) * 100 : 0,
        averageQuality: totalSample > 0 ? ((totalSample - totalMistakes) / totalSample) * 100 : 0,
        teamCount: Number(teamsCount?.count || 0),
        userCount: Number(usersCount?.count || 0)
      };

      logApiQuery(route, 'Resolved dashboard stats', payload);
      res.json(payload);
    } catch (error) {
      logApiError(route, error, req.query);
      const message = error instanceof Error ? error.message : 'Failed to fetch dashboard stats';
      res.status(500).json({ success: false, error: message, message });
    }
  });

  app.get("/api/dashboard/chart-data", authenticateToken, checkPermission('dashboard', 'view'), (req: any, res) => {
    const route = "GET /api/dashboard/chart-data";
    logApiRequest(route, req.query);

    try {
      const { baseFrom, params } = buildDashboardEntryScope(req, req.query);
      const entryParams = [...params];
      const dailyScope = buildDashboardEntryScope(req, req.query, { useResolvedClientFilter: true });

      const dailyRows = db.prepare(`
        SELECT
          pe.date,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) AS production,
          COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) AS target
        ${dailyScope.baseFrom}
        GROUP BY pe.date
        ORDER BY pe.date ASC
      `).all(...dailyScope.params) as any[];

      const downtimeReasonRows = db.prepare(`
        SELECT
          pe.downtime_reason AS name,
          COALESCE(SUM(COALESCE(pe.downtime, 0)), 0) AS value
        ${baseFrom}
        AND COALESCE(pe.downtime, 0) > 0
        AND pe.downtime_reason IS NOT NULL
        AND pe.downtime_reason != ''
        GROUP BY pe.downtime_reason
        ORDER BY value DESC, pe.downtime_reason ASC
      `).all(...entryParams) as any[];

      const recentDowntimeRows = db.prepare(`
        SELECT
          pe.id,
          pe.date,
          pe.user_id,
          u.full_name AS user_name,
          t.name AS team_name,
          pt.name AS parent_team_name,
          pe.downtime,
          pe.downtime_reason
        ${baseFrom}
        AND COALESCE(pe.downtime, 0) > 0
        ORDER BY pe.date DESC, pe.created_at DESC
        LIMIT 5
      `).all(...entryParams) as any[];

      const teamPerformanceRows = db.prepare(`
        SELECT
          t.id,
          t.name AS team_name,
          pt.name AS parent_team_name,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) AS production,
          COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) AS target
        ${baseFrom}
        GROUP BY t.id, t.name, pt.name
        ORDER BY production DESC, target DESC, t.name ASC
      `).all(...entryParams) as any[];

      const topPerformerRows = db.prepare(`
        SELECT
          u.id,
          u.full_name AS name,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) AS production,
          COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) AS target
        ${baseFrom}
        GROUP BY u.id, u.full_name
        HAVING COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) > 0 OR COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) > 0
        ORDER BY
          CASE
            WHEN COALESCE(SUM(COALESCE(pe.target_value, 0)), 0) > 0
            THEN COALESCE(SUM(COALESCE(pe.production_value, 0)), 0)::double precision / NULLIF(COALESCE(SUM(COALESCE(pe.target_value, 0)), 0), 0)
            ELSE 0
          END DESC,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) DESC,
          u.full_name ASC
        LIMIT 5
      `).all(...entryParams) as any[];

      const clientDistributionRows = db.prepare(`
        SELECT
          COALESCE(NULLIF(pe.client_name, ''), NULLIF(t.client_name, ''), 'Unassigned') AS name,
          COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) AS value
        ${baseFrom}
        GROUP BY COALESCE(NULLIF(pe.client_name, ''), NULLIF(t.client_name, ''), 'Unassigned')
        HAVING COALESCE(SUM(COALESCE(pe.production_value, 0)), 0) > 0
        ORDER BY value DESC, name ASC
        LIMIT 6
      `).all(...entryParams) as any[];

      const userScope = buildDashboardUserScope(req, req.query);
      const departmentUserRows = db.prepare(`
        SELECT
          COALESCE(pt.id, t.id) AS id,
          COALESCE(pt.name, t.name) AS name,
          COUNT(DISTINCT u.id) AS value
        ${userScope.baseFrom}
        AND u.role NOT IN ('super_admin', 'admin', 'hr')
        GROUP BY COALESCE(pt.id, t.id), COALESCE(pt.name, t.name)
        ORDER BY value DESC, name ASC
      `).all(...userScope.params) as any[];

      const payload = {
        dailyData: buildDailyProductionTrend(dailyRows, req.query),
        downtimeReasonData: downtimeReasonRows.map((row) => ({
          name: row.name,
          value: Number(row.value || 0)
        })),
        recentDowntime: recentDowntimeRows.map((row) => ({
          id: row.id,
          date: row.date,
          user_id: row.user_id,
          user_name: row.user_name,
          team_name: row.team_name,
          parent_team_name: row.parent_team_name,
          downtime: Number(row.downtime || 0),
          downtime_reason: row.downtime_reason
        })),
        teamPerfData: teamPerformanceRows
          .map((row) => ({
            id: row.id,
            name: formatTeamDisplayName(row.team_name, row.parent_team_name),
            production: Number(row.production || 0),
            target: Number(row.target || 0)
          }))
          .filter((row) => row.production > 0 || row.target > 0),
        userPerf: topPerformerRows.map((row) => {
          const production = Number(row.production || 0);
          const target = Number(row.target || 0);
          return {
            id: row.id,
            name: row.name,
            production,
            target,
            pct: target > 0 ? Math.round((production / target) * 100) : 0
          };
        }),
        clientDistribution: clientDistributionRows.map((row) => ({
          name: row.name,
          value: Number(row.value || 0)
        })),
        departmentUserCount: departmentUserRows.map((row) => ({
          id: row.id,
          name: row.name,
          value: Number(row.value || 0)
        })),
        lastUpdated: new Date().toISOString()
      };

      logApiQuery(route, 'Resolved dashboard chart data', {
        dailyPoints: payload.dailyData.length,
        downtimeReasons: payload.downtimeReasonData.length,
        recentDowntime: payload.recentDowntime.length,
        teamPerf: payload.teamPerfData.length,
        topPerformers: payload.userPerf.length,
        clientDistribution: payload.clientDistribution.length,
        departmentUserCount: payload.departmentUserCount.length
      });
      res.json(payload);
    } catch (error) {
      logApiError(route, error, req.query);
      const message = error instanceof Error ? error.message : 'Failed to fetch dashboard chart data';
      res.status(500).json({ success: false, error: message, message });
    }
  });

  // Production Entries
  app.get("/api/production", authenticateToken, checkPermission('production', 'view'), (req: any, res) => {
    const { team_id, user_id, from, to, search, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let baseQuery = `
      FROM production_entries pe
      LEFT JOIN teams t ON pe.team_id = t.id
      LEFT JOIN users u ON pe.user_id = u.id
      WHERE 1=1
    `;
    let params: any[] = [];
    
    // Role-based visibility
    if (req.user.role === 'member') {
      // Member sees all their own entries (locked or unlocked)
      baseQuery += ` AND pe.user_id = ?`;
      params.push(req.user.id);
    } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      // TL sees all entries for their teams plus any they created
      baseQuery += ` AND (t.team_leader_id = ? OR pe.created_by = ?)`;
      params.push(req.user.id, req.user.id);
    }
    // Admin/super_admin/hr: see ALL entries - no additional role filter needed

    // Filters
    if (team_id) {
      baseQuery += ` AND pe.team_id = ?`;
      params.push(team_id);
    }
    if (user_id) {
      baseQuery += ` AND pe.user_id = ?`;
      params.push(user_id);
    }
    if (from) {
      baseQuery += ` AND pe.date >= ?`;
      params.push(from);
    }
    if (to) {
      baseQuery += ` AND pe.date <= ?`;
      params.push(to);
    }
    if (search) {
      baseQuery += ` AND (u.full_name LIKE ? OR pe.client_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    try {
      // Get total count for pagination
      const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
      const countResult = db.prepare(countQuery).get(...params) as any;
      const totalCount = countResult?.total || 0;

      // Get paginated data
      const dataQuery = `
        SELECT pe.*, t.name as team_name, pt.name as parent_team_name, u.full_name as user_name 
        FROM production_entries pe
        LEFT JOIN teams t ON pe.team_id = t.id
        LEFT JOIN teams pt ON t.parent_id = pt.id
        LEFT JOIN users u ON pe.user_id = u.id
        WHERE 1=1
        ${baseQuery.split('WHERE 1=1')[1]}
        ORDER BY pe.date DESC, pe.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const entries = db.prepare(dataQuery).all(...params, Number(limit), offset) as any[];
      
      const mappedEntries = entries.map(e => ({ ...e, is_locked: !!e.is_locked }));
      
      res.json({
        data: mappedEntries,
        pagination: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit))
        }
      });
    } catch (err) {
      console.error('Error in /api/production:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/production", authenticateToken, checkPermission('production', 'create'), (req: any, res) => {
    const route = "POST /api/production";
    logApiRequest(route, req.body);

    try {
      let team_id = normalizeNullableIdentifier(req.body.team_id);
      const user_id = normalizeNullableIdentifier(req.body.user_id);
      let client_name = normalizeOptionalValue(req.body.client_name);
      const date = normalizeOptionalValue(req.body.date);
      const production_value = parseNumericField(req.body.production_value, 'production_value', { required: true, min: 0 });
      const target_value = parseNumericField(req.body.target_value, 'target_value', { required: true, min: 0 });
      const quality = normalizeOptionalValue(req.body.quality);
      const quality_low = parseNumericField(req.body.quality_low, 'quality_low', { defaultValue: 0, min: 0 });
      const quality_high = parseNumericField(req.body.quality_high, 'quality_high', { defaultValue: 0, min: 0 });
      const notes = normalizeOptionalValue(req.body.notes);
      const downtime = parseNumericField(req.body.downtime, 'downtime', { defaultValue: 0, min: 0 });
      const downtime_reason = normalizeOptionalValue(req.body.downtime_reason);
      const sample_production = normalizeOptionalValue(req.body.sample_production);
      const reporting_to = normalizeOptionalValue(req.body.reporting_to);

      if (!user_id) {
        return res.status(400).json({ success: false, error: "user_id is required", message: "user_id is required" });
      }

      if (!date) {
        return res.status(400).json({ success: false, error: "date is required", message: "date is required" });
      }

      if (!team_id && user_id) {
        const assignedUser = db.prepare('SELECT team_id FROM users WHERE id = ?').get(user_id) as any;
        if (assignedUser && assignedUser.team_id) {
          team_id = assignedUser.team_id;
        }
      }

      if (!team_id && (req.user.role === 'tl' || req.user.role === 'payment_posting')) {
        const tlTeam = db.prepare('SELECT id FROM teams WHERE team_leader_id = ? LIMIT 1').get(req.user.id) as any;
        if (tlTeam) team_id = tlTeam.id;
      }

      if (!team_id) {
        return res.status(400).json({ success: false, error: "team_id is required", message: "team_id is required" });
      }

      if (!client_name && team_id) {
        const team = db.prepare('SELECT client_name FROM teams WHERE id = ?').get(team_id) as any;
        if (team) client_name = team.client_name || '';
      }

      logApiQuery(route, 'Checking for duplicate production entry', { user_id, date, client_name });
      const duplicate = db.prepare(`
        SELECT id, is_locked FROM production_entries
        WHERE user_id = ? AND date = ? AND client_name IS NOT DISTINCT FROM ?
      `).get(toSql(user_id), toSql(date), toSql(client_name)) as any;

      if (duplicate) {
        if (duplicate.is_locked && req.user.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            error: "A locked production entry already exists for this user, date, and client. Cannot update.",
            message: "A locked production entry already exists for this user, date, and client. Cannot update."
          });
        }

        logApiQuery(route, 'Updating existing production entry', { id: duplicate.id });
        db.prepare(`
          UPDATE production_entries
          SET team_id = ?, user_id = ?, client_name = ?, date = ?, production_value = ?, target_value = ?, quality = ?, quality_low = ?, quality_high = ?, notes = ?, downtime = ?, downtime_reason = ?, sample_production = ?, reporting_to = ?
          WHERE id = ?
        `).run(
          toSql(team_id),
          toSql(user_id),
          toSql(client_name),
          toSql(date),
          toSql(production_value),
          toSql(target_value),
          toSql(quality),
          toSql(quality_low),
          toSql(quality_high),
          toSql(notes),
          toSql(downtime),
          toSql(downtime_reason),
          toSql(sample_production),
          toSql(reporting_to),
          duplicate.id
        );

        return res.status(200).json({ success: true, id: duplicate.id, message: "Saved successfully" });
      }

      const id = uuidv4();
      logApiQuery(route, 'Inserting production entry', { id, team_id, user_id, date });
      db.prepare(`
        INSERT INTO production_entries (id, team_id, user_id, client_name, date, production_value, target_value, quality, quality_low, quality_high, notes, downtime, downtime_reason, sample_production, reporting_to, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        toSql(team_id),
        toSql(user_id),
        toSql(client_name),
        toSql(date),
        toSql(production_value),
        toSql(target_value),
        toSql(quality),
        toSql(quality_low),
        toSql(quality_high),
        toSql(notes),
        toSql(downtime),
        toSql(downtime_reason),
        toSql(sample_production),
        toSql(reporting_to),
        req.user.id
      );

      res.status(201).json({ success: true, id, message: "Saved successfully" });
    } catch (error) {
      logApiError(route, error, req.body);
      const message = error instanceof Error ? error.message : 'Failed to save production entry';
      res.status(error instanceof ValidationError ? 400 : 500).json({ success: false, error: message, message });
    }
  });

  app.put("/api/production/:id", authenticateToken, checkPermission('production', 'edit'), (req: any, res) => {
    const route = "PUT /api/production/:id";
    const id = req.params.id;
    logApiRequest(route, { id, body: req.body });

    try {
      const existingEntry = db.prepare(`
        SELECT is_locked, team_id, user_id, date, client_name, production_value, target_value, quality, quality_low, quality_high, notes, downtime, downtime_reason, sample_production, reporting_to
        FROM production_entries
        WHERE id = ?
      `).get(id) as any;

      if (!existingEntry) {
        return res.status(404).json({ success: false, error: "Entry not found", message: "Entry not found" });
      }

      if (existingEntry.is_locked && req.user.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: "Cannot edit a locked entry. Only Superadmin can unlock.",
          message: "Cannot edit a locked entry. Only Superadmin can unlock."
        });
      }

      const checkTeamId = hasOwn(req.body, 'team_id') ? normalizeNullableIdentifier(req.body.team_id) : existingEntry.team_id;
      const checkUserId = hasOwn(req.body, 'user_id') ? normalizeNullableIdentifier(req.body.user_id) : existingEntry.user_id;
      const checkDate = hasOwn(req.body, 'date') ? normalizeOptionalValue(req.body.date) : existingEntry.date;
      const checkClientName = hasOwn(req.body, 'client_name') ? normalizeOptionalValue(req.body.client_name) : existingEntry.client_name;
      const production_value = hasOwn(req.body, 'production_value')
        ? parseNumericField(req.body.production_value, 'production_value', { required: true, min: 0 })
        : Number(existingEntry.production_value);
      const target_value = hasOwn(req.body, 'target_value')
        ? parseNumericField(req.body.target_value, 'target_value', { required: true, min: 0 })
        : Number(existingEntry.target_value);
      const quality = hasOwn(req.body, 'quality') ? normalizeOptionalValue(req.body.quality) : existingEntry.quality;
      const quality_low = hasOwn(req.body, 'quality_low')
        ? parseNumericField(req.body.quality_low, 'quality_low', { defaultValue: 0, min: 0 })
        : Number(existingEntry.quality_low || 0);
      const quality_high = hasOwn(req.body, 'quality_high')
        ? parseNumericField(req.body.quality_high, 'quality_high', { defaultValue: 0, min: 0 })
        : Number(existingEntry.quality_high || 0);
      const notes = hasOwn(req.body, 'notes') ? normalizeOptionalValue(req.body.notes) : existingEntry.notes;
      const downtime = hasOwn(req.body, 'downtime')
        ? parseNumericField(req.body.downtime, 'downtime', { defaultValue: 0, min: 0 })
        : Number(existingEntry.downtime || 0);
      const downtime_reason = hasOwn(req.body, 'downtime_reason') ? normalizeOptionalValue(req.body.downtime_reason) : existingEntry.downtime_reason;
      const sample_production = hasOwn(req.body, 'sample_production') ? normalizeOptionalValue(req.body.sample_production) : existingEntry.sample_production;
      const reporting_to = hasOwn(req.body, 'reporting_to') ? normalizeOptionalValue(req.body.reporting_to) : existingEntry.reporting_to;

      if (!checkTeamId || !checkUserId || !checkDate) {
        return res.status(400).json({ success: false, error: "team_id, user_id, and date are required", message: "team_id, user_id, and date are required" });
      }

      logApiQuery(route, 'Checking for duplicate production entry', { id, user_id: checkUserId, date: checkDate, client_name: checkClientName });
      const duplicate = db.prepare(`
        SELECT id FROM production_entries
        WHERE user_id = ? AND date = ? AND client_name IS NOT DISTINCT FROM ? AND id != ?
      `).get(toSql(checkUserId), toSql(checkDate), toSql(checkClientName), id) as any;

      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: "A production entry already exists for this user, date, and client.",
          message: "A production entry already exists for this user, date, and client."
        });
      }

      logApiQuery(route, 'Updating production entry', { id, team_id: checkTeamId, user_id: checkUserId, date: checkDate });
      db.prepare(`
        UPDATE production_entries
        SET team_id = ?, user_id = ?, date = ?, production_value = ?, target_value = ?, client_name = ?, quality = ?, quality_low = ?, quality_high = ?, notes = ?, downtime = ?, downtime_reason = ?, sample_production = ?, reporting_to = ?
        WHERE id = ?
      `).run(
        toSql(checkTeamId),
        toSql(checkUserId),
        toSql(checkDate),
        toSql(production_value),
        toSql(target_value),
        toSql(checkClientName),
        toSql(quality),
        toSql(quality_low),
        toSql(quality_high),
        toSql(notes),
        toSql(downtime),
        toSql(downtime_reason),
        toSql(sample_production),
        toSql(reporting_to),
        id
      );

      res.json({ success: true, id, message: "Saved successfully" });
    } catch (error) {
      logApiError(route, error, { id, body: req.body });
      const message = error instanceof Error ? error.message : 'Failed to save production entry';
      res.status(error instanceof ValidationError ? 400 : 500).json({ success: false, error: message, message });
    }
  });

  app.delete("/api/production/:id", authenticateToken, (req: any, res) => {
    // super_admin can always delete
    if (req.user.role !== 'super_admin') {
      const isTLRole = req.user.role === 'tl' || req.user.role === 'payment_posting';
      if (!isTLRole) {
        // Check explicit delete permission for non-TL roles
        const perm = db.prepare('SELECT can_delete FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'production') as any;
        if (!perm || !perm.can_delete) {
          return res.status(403).json({ message: "Permission denied for delete on production" });
        }
      }
    }

    const entry = db.prepare('SELECT is_locked, team_id FROM production_entries WHERE id = ?').get(req.params.id) as any;
    if (!entry) {
      return res.status(404).json({ message: "Production entry not found" });
    }
    if (entry.is_locked) {
      return res.status(403).json({ message: "Cannot delete a locked entry" });
    }

    // TL can only delete entries from teams they lead
    if ((req.user.role === 'tl' || req.user.role === 'payment_posting') && req.user.role !== 'super_admin') {
      const team = db.prepare('SELECT team_leader_id FROM teams WHERE id = ?').get(entry.team_id) as any;
      if (!team || team.team_leader_id !== req.user.id) {
        return res.status(403).json({ message: "Permission denied - entry does not belong to your team" });
      }
    }

    db.prepare('DELETE FROM production_entries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/production/:id/toggle-lock", authenticateToken, (req: any, res) => {
    const entry = db.prepare('SELECT is_locked, created_by FROM production_entries WHERE id = ?').get(req.params.id) as any;
    if (!entry) {
      return res.status(404).json({ message: "Production entry not found" });
    }

    const isCurrentlyLocked = !!entry.is_locked;
    const isCreator = entry.created_by === req.user.id;
    
    // If trying to UNLOCK (locked -> unlocked)
    if (isCurrentlyLocked) {
      const unlockSettings = db.prepare('SELECT value FROM settings WHERE key = ?').get('unlock_roles') as any;
      const allowedRoles = unlockSettings ? unlockSettings.value.split(',') : ['super_admin', 'admin', 'hr'];
      
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: `Only ${allowedRoles.join(', ')} can unlock entries` });
      }
    } else {
      // If trying to LOCK (unlocked -> locked)
      // Allow if creator OR has edit permission
      const hasEditPerm = req.user.role === 'super_admin' || (db.prepare('SELECT can_edit FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'production') as any)?.can_edit === 1;
      if (!isCreator && !hasEditPerm) {
        return res.status(403).json({ message: "Permission denied to lock this entry" });
      }
    }

    const newLockStatus = isCurrentlyLocked ? 0 : 1;
    db.prepare('UPDATE production_entries SET is_locked = ? WHERE id = ?').run(newLockStatus, req.params.id);
    
    if (!isCurrentlyLocked) {
      // It was unlocked, now it's locked (confirmed)
      const fullEntry = db.prepare(`
        SELECT pe.*, t.name as team_name, u.full_name as user_name 
        FROM production_entries pe 
        JOIN teams t ON pe.team_id = t.id 
        JOIN users u ON pe.user_id = u.id
        WHERE pe.id = ?
      `).get(req.params.id) as any;
      
      if (fullEntry) {
        createGlobalNotification(
          'Production Entry Added',
          `${fullEntry.user_name} added a production entry for ${fullEntry.team_name}.`,
          'production',
          req.params.id
        );
        broadcastEvent('notifications-updated');
      }
    }

    res.json({ success: true, is_locked: !!newLockStatus });
  });

  // Teams
  app.get("/api/teams", authenticateToken, (req: any, res, next) => {
    if (req.user.role === 'member' || req.user.role === 'tl' || req.user.role === 'payment_posting') return next();
    return checkPermission('teams', 'view')(req, res, next);
  }, (req: any, res) => {
    let query = `
      SELECT t.*, u.full_name as team_leader_name 
      FROM teams t 
      LEFT JOIN users u ON t.team_leader_id = u.id
      WHERE t.is_active = 1
    `;
    let params: any[] = [];
    
    if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      // Return teams TL leads PLUS their parent departments (for dashboard dept display)
      query += ` AND (t.team_leader_id = ? OR t.id IN (
        SELECT DISTINCT parent_id FROM teams WHERE team_leader_id = ? AND parent_id IS NOT NULL
      ))`;
      params.push(req.user.id, req.user.id);
    } else if (req.user.role === 'member') {
      // Return member's own team plus the parent department
      query += ` AND (t.id = (SELECT team_id FROM users WHERE id = ?) OR t.id = (
        SELECT parent_id FROM teams WHERE id = (SELECT team_id FROM users WHERE id = ?)
      ))`;
      params.push(req.user.id, req.user.id);
    }
    
    const teams = db.prepare(query).all(...params) as any[];
    
    const users = db.prepare('SELECT * FROM users WHERE is_active = 1').all() as any[];
    
    const teamsWithMembers = teams.map(team => {
      // Direct members of this team
      const directMembers = users.filter(u => u.team_id === team.id && u.role === 'member');
      
      // For parent departments (no parent_id), also include members from all sub-teams
      if (!team.parent_id) {
        const subTeamIds = teams.filter(t => t.parent_id === team.id).map(t => t.id);
        const subMembers = subTeamIds.length > 0
          ? users.filter(u => subTeamIds.includes(u.team_id) && u.role === 'member')
          : [];
        const allMembers = [...directMembers, ...subMembers];
        // Deduplicate by id
        const unique = allMembers.filter((m, i, self) => self.findIndex(x => x.id === m.id) === i);
        return { ...team, members: unique };
      }
      return { ...team, members: directMembers };
    });
    
    res.json(teamsWithMembers);
  });

  app.post("/api/teams", authenticateToken, checkPermission('teams', 'create'), (req, res) => {
    const route = "POST /api/teams";
    logApiRequest(route, req.body);

    try {
      const rawName = normalizeOptionalValue(req.body.name);
      const description = normalizeOptionalValue(req.body.description);
      const client_name = normalizeOptionalValue(req.body.client_name);
      const team_leader_id = normalizeNullableIdentifier(req.body.team_leader_id);
      const parent_id = normalizeNullableIdentifier(req.body.parent_id);
      const member_ids = Array.isArray(req.body.member_ids) ? req.body.member_ids.filter(Boolean) : [];

      if (!rawName || !String(rawName).trim()) {
        return res.status(400).json({ success: false, message: "Team name is required" });
      }

      if (!parent_id && (rawName === 'SSM' || rawName === 'NY')) {
        return res.status(400).json({ success: false, message: "Standalone 'SSM' or 'NY' teams are not allowed." });
      }

      let finalName = String(rawName).trim();
      if (parent_id) {
        const parent = db.prepare('SELECT name FROM teams WHERE id = ?').get(parent_id) as any;
        if (parent) {
          const prefix = `${parent.name} - `;
          const normalizedName = finalName.replace(new RegExp(`^${parent.name}\\s*-\\s*`, 'i'), '');
          finalName = `${prefix}${normalizedName}`;
        }
      }

      const duplicate = db.prepare('SELECT id FROM teams WHERE LOWER(name) = LOWER(?)').get(finalName) as any;
      if (duplicate) {
        return res.status(400).json({ success: false, message: parent_id ? "Sub-team already exists" : "Team already exists" });
      }

      const id = uuidv4();
      const transaction = db.transaction(() => {
        db.prepare('INSERT INTO teams (id, name, description, client_name, team_leader_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          toSql(finalName),
          toSql(description),
          toSql(client_name),
          toSql(team_leader_id),
          toSql(parent_id)
        );
        if (member_ids.length > 0) {
          const placeholders = member_ids.map(() => '?').join(',');
          db.prepare(`UPDATE users SET team_id = ? WHERE id IN (${placeholders})`).run(id, ...member_ids);
        }
      });

      transaction();
      broadcastEvent('teams-updated');
      broadcastEvent('users-updated');
      res.status(201).json({ success: true, id });
    } catch (error) {
      logApiError(route, error, req.body);
      res.status(500).json({ success: false, message: "Failed to save team" });
    }
  });

  app.put("/api/teams/:id", authenticateToken, checkPermission('teams', 'edit'), (req, res) => {
    const route = "PUT /api/teams/:id";
    logApiRequest(route, { id: req.params.id, body: req.body });

    try {
      const rawName = normalizeOptionalValue(req.body.name);
      const description = normalizeOptionalValue(req.body.description);
      const client_name = normalizeOptionalValue(req.body.client_name);
      const team_leader_id = normalizeNullableIdentifier(req.body.team_leader_id);
      const parent_id = normalizeNullableIdentifier(req.body.parent_id);
      const member_ids = Array.isArray(req.body.member_ids) ? req.body.member_ids.filter(Boolean) : [];

      if (!rawName || !String(rawName).trim()) {
        return res.status(400).json({ success: false, message: "Team name is required" });
      }

      if (!parent_id && (rawName === 'SSM' || rawName === 'NY')) {
        return res.status(400).json({ success: false, message: "Standalone 'SSM' or 'NY' teams are not allowed." });
      }

      let finalName = String(rawName).trim();
      if (parent_id) {
        const parent = db.prepare('SELECT name FROM teams WHERE id = ?').get(parent_id) as any;
        if (parent) {
          const prefix = `${parent.name} - `;
          const normalizedName = finalName.replace(new RegExp(`^${parent.name}\\s*-\\s*`, 'i'), '');
          finalName = `${prefix}${normalizedName}`;
        }
      }

      const duplicate = db.prepare('SELECT id FROM teams WHERE LOWER(name) = LOWER(?) AND id != ?').get(finalName, req.params.id) as any;
      if (duplicate) {
        return res.status(400).json({ success: false, message: parent_id ? "Sub-team already exists" : "Team already exists" });
      }

      const transaction = db.transaction(() => {
        db.prepare('UPDATE teams SET name = ?, description = ?, client_name = ?, team_leader_id = ?, parent_id = ? WHERE id = ?').run(
          toSql(finalName),
          toSql(description),
          toSql(client_name),
          toSql(team_leader_id),
          toSql(parent_id),
          req.params.id
        );
        db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(req.params.id);
        if (member_ids.length > 0) {
          const placeholders = member_ids.map(() => '?').join(',');
          db.prepare(`UPDATE users SET team_id = ? WHERE id IN (${placeholders})`).run(req.params.id, ...member_ids);
        }
      });

      transaction();
      broadcastEvent('teams-updated');
      broadcastEvent('users-updated');
      res.json({ success: true });
    } catch (error) {
      logApiError(route, error, { id: req.params.id, body: req.body });
      res.status(500).json({ success: false, message: "Failed to update team" });
    }
  });

  app.delete("/api/teams/:id", authenticateToken, checkPermission('teams', 'delete'), (req, res) => {
    try {
      // Check if any users are assigned to this department
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE team_id = ?').get(req.params.id) as any;
      if (userCount && userCount.count > 0) {
        return res.status(400).json({ message: "Cannot delete department as it is currently assigned to one or more users." });
      }

      // Check if any sub-teams are assigned to this department
      const subTeamCount = db.prepare('SELECT COUNT(*) as count FROM teams WHERE parent_id = ?').get(req.params.id) as any;
      if (subTeamCount && subTeamCount.count > 0) {
        return res.status(400).json({ message: "Cannot delete department as it has one or more sub-teams assigned to it." });
      }

      const result = db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ message: "Department not found" });
      }
      broadcastEvent('teams-updated');
      broadcastEvent('users-updated');
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting department:', err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Users
  app.get("/api/users", authenticateToken, (req: any, res, next) => {
    if (req.user.role === 'member' || req.user.role === 'tl' || req.user.role === 'payment_posting') return next();
    return checkPermission('users', 'view')(req, res, next);
  }, (req: any, res) => {
    let query = `
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.team_id, u.is_active, t.name as team_name, pt.name as parent_team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      LEFT JOIN teams pt ON t.parent_id = pt.id
    `;
    let params: any[] = [];
    
    if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      query += ` WHERE (t.team_leader_id = ? OR u.id = ?)`;
      params.push(req.user.id, req.user.id);
    } else if (req.user.role === 'member') {
      query += ` WHERE (u.team_id = ? OR u.id = ?)`;
      params.push(req.user.team_id, req.user.id);
    }
    
    const excludeRoles = req.query.exclude_roles ? (req.query.exclude_roles as string).split(',') : [];
    if (excludeRoles.length > 0) {
      const placeholders = excludeRoles.map(() => '?').join(',');
      if (query.includes('WHERE')) {
        query += ` AND u.role NOT IN (${placeholders})`;
      } else {
        query += ` WHERE u.role NOT IN (${placeholders})`;
      }
      params.push(...excludeRoles);
    }
    
    const users = db.prepare(query).all(...params);
    res.json(users);
  });

  app.get("/api/my-team", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'tl' && req.user.role !== 'payment_posting') {
      return res.status(403).json({ message: "Forbidden" });
    }
    // Get all teams this TL leads (directly)
    const ledTeams = db.prepare('SELECT id FROM teams WHERE team_leader_id = ?').all(req.user.id) as any[];
    const ledTeamIds = ledTeams.map(t => t.id);

    // Also gather sub-team IDs for any parent teams the TL leads
    const subTeamIds: string[] = [];
    for (const teamId of ledTeamIds) {
      const subTeams = db.prepare('SELECT id FROM teams WHERE parent_id = ?').all(teamId) as any[];
      subTeamIds.push(...subTeams.map(st => st.id));
    }
    const allTeamIds = [...new Set([...ledTeamIds, ...subTeamIds])];

    if (allTeamIds.length === 0) {
      return res.json([]);
    }

    const placeholders = allTeamIds.map(() => '?').join(',');
    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.team_id, u.is_active, t.name as team_name
      FROM users u
      JOIN teams t ON u.team_id = t.id
      WHERE u.team_id IN (${placeholders}) AND u.id != ? AND u.role = 'member'
    `).all(...allTeamIds, req.user.id);
    res.json(users);
  });

  app.get("/api/members/:id", authenticateToken, (req: any, res) => {
    const route = "GET /api/members/:id";
    const memberId = req.params.id;
    logApiRequest(route, { memberId, requesterId: req.user.id, requesterRole: req.user.role });

    try {
      const member = db.prepare(`
        SELECT
          u.id,
          u.full_name,
          u.role,
          u.team_id,
          t.name AS team_name,
          t.client_name,
          t.team_leader_id,
          leader.full_name AS team_leader_name,
          parent.id AS department_id,
          parent.name AS department_name
        FROM users u
        LEFT JOIN teams t ON u.team_id = t.id
        LEFT JOIN users leader ON t.team_leader_id = leader.id
        LEFT JOIN teams parent ON t.parent_id = parent.id
        WHERE u.id = ? AND u.is_active = 1
      `).get(memberId) as any;

      if (!member) {
        return res.status(404).json({ success: false, error: "Member data not found", message: "Member data not found" });
      }

      let canAccess = false;
      if (['super_admin', 'admin', 'hr'].includes(req.user.role)) {
        canAccess = true;
      } else if (req.user.id === member.id) {
        canAccess = true;
      } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
        canAccess = !!member.team_leader_id && member.team_leader_id === req.user.id;
      }

      if (!canAccess) {
        return res.status(404).json({ success: false, error: "Member data not found", message: "Member data not found" });
      }

      let client = member.client_name || '';
      if (!client && member.team_id) {
        const mappedClient = db.prepare(`
          SELECT name
          FROM clients
          WHERE team_id = ? AND is_active = 1
          ORDER BY name ASC
          LIMIT 1
        `).get(member.team_id) as any;
        client = mappedClient?.name || '';
      }

      const payload = {
        id: member.id,
        name: member.full_name,
        department: member.department_name || member.team_name || '',
        department_id: member.department_id || member.team_id || null,
        team: member.team_name || '',
        team_id: member.team_id || null,
        client,
        reporting_to: member.team_leader_name || ''
      };

      logApiQuery(route, 'Resolved member assignment', payload);
      res.json(payload);
    } catch (error) {
      logApiError(route, error, { memberId });
      const message = error instanceof Error ? error.message : 'Failed to fetch member data';
      res.status(500).json({ success: false, error: message, message });
    }
  });

  app.post("/api/users", authenticateToken, checkPermission('users', 'create'), (req: any, res) => {
    const route = "POST /api/users";
    logApiRequest(route, req.body);

    try {
      const username = normalizeOptionalValue(req.body.username);
      const full_name = normalizeOptionalValue(req.body.full_name);
      const email = normalizeOptionalValue(req.body.email);
      const role = normalizeOptionalValue(req.body.role);
      const password = normalizeOptionalValue(req.body.password);
      const finalTeamId = normalizeNullableIdentifier(req.body.team_id);

      if (!username || !String(username).trim()) {
        return res.status(400).json({ success: false, message: "Username is required" });
      }
      if (!full_name || !String(full_name).trim()) {
        return res.status(400).json({ success: false, message: "Full name is required" });
      }
      if (!role || !String(role).trim()) {
        return res.status(400).json({ success: false, message: "Role is required" });
      }
      if (!password || !String(password)) {
        return res.status(400).json({ success: false, message: "Password is required" });
      }

      const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
      if (existingUser) {
        return res.status(400).json({ success: false, message: "Username already exists" });
      }

      const id = uuidv4();
      const hashedPassword = bcrypt.hashSync(String(password), 10);
      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO users (id, username, full_name, email, role, team_id, password, needs_password_change)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          toSql(String(username).trim()),
          toSql(String(full_name).trim()),
          toSql(email),
          toSql(role),
          finalTeamId,
          hashedPassword,
          1
        );
        db.prepare(`
          INSERT INTO user_settings (user_id, theme)
          VALUES (?, ?)
        `).run(id, 'light');
      });

      transaction();

      if (finalTeamId) {
        const team = db.prepare('SELECT name, team_leader_id FROM teams WHERE id = ?').get(finalTeamId) as any;
        if (team && team.team_leader_id) {
          const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
          stmt.run(uuidv4(), team.team_leader_id, 'New Team Member', `${full_name} has been assigned to your team: ${team.name}`, 'user', id);
          broadcastEvent('notifications-updated', {}, team.team_leader_id);
        }
      }

      broadcastEvent('users-updated');
      res.status(201).json({ success: true, id });
    } catch (error) {
      logApiError(route, error, req.body);
      res.status(500).json({ success: false, message: "Failed to save user" });
    }
  });

  app.put("/api/users/:id", authenticateToken, checkPermission('users', 'edit'), (req: any, res) => {
    const route = "PUT /api/users/:id";
    logApiRequest(route, { id: req.params.id, body: req.body });

    try {
      const full_name = normalizeOptionalValue(req.body.full_name);
      const email = normalizeOptionalValue(req.body.email);
      const role = normalizeOptionalValue(req.body.role);
      const finalTeamId = normalizeNullableIdentifier(req.body.team_id);
      const is_active = req.body.is_active;
      const password = normalizeOptionalValue(req.body.password);

      const userToEdit = db.prepare('SELECT role, team_id FROM users WHERE id = ?').get(req.params.id) as any;
      if (!userToEdit) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (!full_name || !String(full_name).trim()) {
        return res.status(400).json({ success: false, message: "Full name is required" });
      }
      if (!role || !String(role).trim()) {
        return res.status(400).json({ success: false, message: "Role is required" });
      }

      if (userToEdit.role === 'super_admin') {
        if (req.user.role !== 'super_admin') {
          return res.status(403).json({ success: false, message: "Only SuperAdmin can modify a SuperAdmin account" });
        }
        if (role !== 'super_admin' || is_active === 0 || is_active === false) {
          return res.status(403).json({ success: false, message: "Cannot modify SuperAdmin role or deactivate account" });
        }
      }

      if (finalTeamId && finalTeamId !== userToEdit.team_id) {
        const team = db.prepare('SELECT name, team_leader_id FROM teams WHERE id = ?').get(finalTeamId) as any;
        if (team && team.team_leader_id) {
          const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
          stmt.run(uuidv4(), team.team_leader_id, 'New Team Member', `${full_name} has been assigned to your team: ${team.name}`, 'user', req.params.id);
          broadcastEvent('notifications-updated', {}, team.team_leader_id);
        }
      }

      if (password) {
        if ((req as any).user.role !== 'super_admin' && (req as any).user.role !== 'admin') {
          return res.status(403).json({ success: false, message: "Only SuperAdmin and Admin can update passwords" });
        }
        const hashedPassword = bcrypt.hashSync(String(password), 10);
        db.prepare(`
          UPDATE users SET full_name = ?, email = ?, role = ?, team_id = ?, is_active = ?, password = ?
          WHERE id = ?
        `).run(toSql(String(full_name).trim()), toSql(email), toSql(role), finalTeamId, toSql(is_active === undefined ? 1 : is_active), hashedPassword, req.params.id);
      } else {
        db.prepare(`
          UPDATE users SET full_name = ?, email = ?, role = ?, team_id = ?, is_active = ?
          WHERE id = ?
        `).run(toSql(String(full_name).trim()), toSql(email), toSql(role), finalTeamId, toSql(is_active === undefined ? 1 : is_active), req.params.id);
      }

      broadcastEvent('users-updated');
      res.json({ success: true });
    } catch (error) {
      logApiError(route, error, { id: req.params.id, body: req.body });
      res.status(500).json({ success: false, message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", authenticateToken, checkPermission('users', 'delete'), (req, res) => {
    const userToDelete = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id) as any;
    if (userToDelete && userToDelete.role === 'super_admin') {
      return res.status(403).json({ message: "Cannot delete SuperAdmin account" });
    }

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    broadcastEvent('users-updated');
    res.json({ success: true });
  });

  app.get("/api/clients", authenticateToken, (req, res) => {
    const { team_id } = req.query;
    let query = 'SELECT id, name, team_id FROM clients WHERE is_active = 1';
    let params: any[] = [];
    
    if (team_id) {
      query += ' AND (team_id = ? OR team_id IS NULL)';
      params.push(team_id);
    }
    
    const clientsFromTable = db.prepare(query).all(...params) as any[];
    
    // Also fetch from teams table for backward compatibility/legacy data
    let teamQuery = "SELECT id as team_id, client_name as name FROM teams WHERE client_name IS NOT NULL AND client_name != ''";
    let teamParams: any[] = [];
    if (team_id) {
      teamQuery += " AND id = ?";
      teamParams.push(team_id);
    }
    const clientsFromTeams = db.prepare(teamQuery).all(...teamParams) as any[];
    
    // Combine all unique (name, team_id) pairs
    const allClients = new Map<string, { id: string, name: string, team_id: string | null }>();
    
    clientsFromTable.forEach(c => {
      const key = `${c.name.toLowerCase()}-${c.team_id || 'null'}`;
      allClients.set(key, c);
    });
    
    clientsFromTeams.forEach(c => {
      const key = `${c.name.toLowerCase()}-${c.team_id || 'null'}`;
      if (!allClients.has(key)) {
        allClients.set(key, { id: c.name, name: c.name, team_id: c.team_id });
      }
    });
    
    const result = Array.from(allClients.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json(result);
  });

  app.post("/api/clients", authenticateToken, (req, res) => {
    const route = "POST /api/clients";
    logApiRequest(route, req.body);

    try {
      const name = normalizeOptionalValue(req.body.name);
      const team_id = normalizeNullableIdentifier(req.body.team_id);

      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: "Client name is required" });
      }

      const id = uuidv4();
      db.prepare('INSERT INTO clients (id, name, team_id) VALUES (?, ?, ?)').run(id, String(name).trim(), team_id);
      broadcastEvent('clients-updated');
      res.status(201).json({ success: true, id, name: String(name).trim(), team_id });
    } catch (error) {
      logApiError(route, error, req.body);
      res.status(400).json({ success: false, message: "Client already exists for this team" });
    }
  });

  app.put("/api/clients/:id", authenticateToken, (req, res) => {
    const route = "PUT /api/clients/:id";
    logApiRequest(route, { id: req.params.id, body: req.body });

    try {
      const name = normalizeOptionalValue(req.body.name);
      const team_id = normalizeNullableIdentifier(req.body.team_id);
      const is_active = req.body.is_active;
      const id = req.params.id;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: "Client name is required" });
      }

      db.prepare('UPDATE clients SET name = ?, team_id = ?, is_active = ? WHERE id = ?')
        .run(toSql(String(name).trim()), team_id, toSql(is_active !== undefined ? (is_active ? 1 : 0) : 1), id);
      broadcastEvent('clients-updated');
      res.json({ success: true });
    } catch (error) {
      logApiError(route, error, { id: req.params.id, body: req.body });
      res.status(400).json({ success: false, message: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", authenticateToken, checkPermission('production', 'delete'), (req, res) => {
    // Check if it's a real ID or a name (for legacy/aggregated entries)
    const id = req.params.id;
    
    // Try to find by ID first
    let client = db.prepare('SELECT name, team_id FROM clients WHERE id = ?').get(id) as any;
    
    // If not found, check if it's a name (for legacy/aggregated entries)
    if (!client) {
      // Check if this name exists in clients or teams
      const nameExistsInClients = db.prepare('SELECT name FROM clients WHERE name = ?').get(id) as any;
      const nameExistsInTeams = db.prepare('SELECT client_name FROM teams WHERE client_name = ?').get(id) as any;
      
      if (nameExistsInClients || nameExistsInTeams) {
        client = { name: id };
      }
    }
    
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const transaction = db.transaction(() => {
      // Delete all instances of this client name from clients table
      db.prepare('DELETE FROM clients WHERE name = ?').run(client.name);
      
      // Remove references in teams table for all teams
      db.prepare('UPDATE teams SET client_name = NULL WHERE client_name = ?').run(client.name);

      // Remove references in production_entries table for all entries
      db.prepare('UPDATE production_entries SET client_name = NULL WHERE client_name = ?').run(client.name);
    });

    transaction();
    
    broadcastEvent('clients-updated');
    broadcastEvent('teams-updated');
    broadcastEvent('production-updated');
    res.json({ success: true });
  });

  // Targets
  app.get("/api/targets", authenticateToken, checkPermission('targets', 'view'), (req: any, res) => {
    let query = `
      SELECT tg.*, t.name as team_name, pt.name as parent_team_name, u.full_name as user_name
      FROM targets tg
      LEFT JOIN teams t ON tg.team_id = t.id
      LEFT JOIN teams pt ON t.parent_id = pt.id
      LEFT JOIN users u ON tg.user_id = u.id
    `;
    const params: any[] = [];

    if (req.user.role === 'member') {
      query += ` WHERE tg.team_id = ?`;
      params.push(req.user.team_id);
    } else if (req.user.role === 'tl' || req.user.role === 'payment_posting') {
      query += ` WHERE t.team_leader_id = ?`;
      params.push(req.user.id);
    }

    const targets = db.prepare(query).all(...params);
    res.json(targets);
  });

  app.post("/api/targets", authenticateToken, checkPermission('targets', 'create'), (req, res) => {
    const route = "POST /api/targets";
    logApiRequest(route, req.body);

    try {
      const team_id = normalizeNullableIdentifier(req.body.team_id);
      const user_id = normalizeNullableIdentifier(req.body.user_id);
      const target_value = parseNumericField(req.body.target_value, 'target_value', { required: true, min: 0 });
      const period = normalizeOptionalValue(req.body.period);
      const effective_date = normalizeOptionalValue(req.body.effective_date);

      if (!team_id && !user_id) {
        return res.status(400).json({ success: false, error: "Team or User is required", message: "Team or User is required" });
      }

      if (!period || !effective_date) {
        return res.status(400).json({
          success: false,
          error: "period and effective_date are required",
          message: "period and effective_date are required"
        });
      }

      logApiQuery(route, 'Checking for existing target', { team_id, user_id, effective_date });
      const existing = db.prepare(`
        SELECT id FROM targets
        WHERE team_id IS NOT DISTINCT FROM ? AND user_id IS NOT DISTINCT FROM ? AND effective_date = ?
      `).get(toSql(team_id), toSql(user_id), toSql(effective_date)) as any;

      const targetId = existing?.id || uuidv4();

      if (existing) {
        logApiQuery(route, 'Updating target', { id: targetId });
        db.prepare(`
          UPDATE targets
          SET team_id = ?, user_id = ?, target_value = ?, period = ?, effective_date = ?
          WHERE id = ?
        `).run(toSql(team_id), toSql(user_id), toSql(target_value), toSql(period), toSql(effective_date), targetId);
      } else {
        logApiQuery(route, 'Inserting target', { id: targetId });
        db.prepare(`
          INSERT INTO targets (id, team_id, user_id, target_value, period, effective_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(targetId, toSql(team_id), toSql(user_id), toSql(target_value), toSql(period), toSql(effective_date));
      }

      const team = team_id ? db.prepare('SELECT name FROM teams WHERE id = ?').get(team_id) as any : null;
      const teamName = team ? team.name : 'Unknown Team';
      const action = existing ? 'Target Updated' : 'Target Created';
      const message = existing
        ? `${(req as any).user.username} updated the target for ${teamName} (Effective: ${effective_date}).`
        : `${(req as any).user.username} set a new target for ${teamName} (Effective: ${effective_date}).`;

      createGlobalNotification(action, message, 'target', targetId);

      res.status(existing ? 200 : 201).json({ success: true, id: targetId, message: "Saved successfully" });
    } catch (error) {
      logApiError(route, error, req.body);
      const message = error instanceof Error ? error.message : 'Failed to save target';
      res.status(error instanceof ValidationError ? 400 : 500).json({ success: false, error: message, message });
    }
  });

  app.delete("/api/targets/:id", authenticateToken, checkPermission('targets', 'delete'), (req, res) => {
    const result = db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "Target not found" });
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const hmrConfig = process.env.DISABLE_HMR === "true"
      ? false
      : { server: httpServer };
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrConfig,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = await findAvailablePort(DEFAULT_PORT, HOST);
  if (port !== DEFAULT_PORT) {
    console.warn(`Port ${DEFAULT_PORT} is already in use. Starting on http://localhost:${port} instead.`);
  }

  httpServer.listen(port, HOST, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
