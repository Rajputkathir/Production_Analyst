import bcrypt from 'bcryptjs';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';
import { v4 as uuidv4 } from 'uuid';
import { ensureDatabaseUrl } from "./postgresConfig.js";
import { POSTGRES_INDEX_STATEMENTS, POSTGRES_OPTIONAL_COLUMNS, POSTGRES_SCHEMA_STATEMENTS, } from "./postgresSchema.js";
ensureDatabaseUrl();
const worker = new Worker(new URL('./dbWorker.js', import.meta.url));
const { port1, port2 } = new MessageChannel();
worker.postMessage({ type: 'init-port', port: port2 }, [port2]);
worker.unref();
let currentTransactionId;
worker.on('error', (error) => {
    console.error('PostgreSQL worker failed:', error);
});
worker.on('exit', (code) => {
    if (code !== 0) {
        console.error(`PostgreSQL worker exited with code ${code}`);
    }
});
function convertInsertOrReplace(sql) {
    const match = sql
        .trim()
        .match(/^INSERT\s+OR\s+REPLACE\s+INTO\s+([A-Za-z_][\w]*)\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)\s*$/i);
    if (!match) {
        return sql;
    }
    const table = match[1].toLowerCase();
    const columns = match[2].split(',').map((column) => column.trim());
    const values = match[3].trim();
    const conflictTargets = {
        role_permissions: ['role', 'module'],
        settings: ['key'],
        user_settings: ['user_id'],
    };
    const conflictColumns = conflictTargets[table];
    if (!conflictColumns) {
        return sql.replace(/INSERT\s+OR\s+REPLACE/i, 'INSERT');
    }
    const updateColumns = columns.filter((column) => !conflictColumns.some((conflictColumn) => conflictColumn.toLowerCase() === column.toLowerCase()));
    const updateClause = updateColumns.length
        ? `DO UPDATE SET ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`
        : 'DO NOTHING';
    return `INSERT INTO ${match[1]} (${columns.join(', ')}) VALUES (${values}) ON CONFLICT (${conflictColumns.join(', ')}) ${updateClause}`;
}
function replacePlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
}
function transformSql(sql) {
    let transformed = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
    transformed = convertInsertOrReplace(transformed);
    transformed = transformed.replace(/ON\s+CONFLICT\s*\(\s*team_id\s*,\s*user_id\s*,\s*effective_date\s*\)/gi, "ON CONFLICT ((COALESCE(team_id, '')), (COALESCE(user_id, '')), effective_date)");
    return replacePlaceholders(transformed);
}
function makeError(error) {
    const wrapped = new Error(error?.message || 'Unknown PostgreSQL error');
    if (error?.code)
        wrapped.code = error.code;
    if (error?.detail)
        wrapped.detail = error.detail;
    if (error?.stack)
        wrapped.stack = error.stack;
    return wrapped;
}
function sendWorkerRequest(request) {
    const signalBuffer = new SharedArrayBuffer(4);
    const signal = new Int32Array(signalBuffer);
    worker.postMessage({ ...request, signalBuffer });
    const waitResult = Atomics.wait(signal, 0, 0, 120000);
    if (waitResult === 'timed-out') {
        throw new Error('Timed out waiting for the PostgreSQL worker.');
    }
    const response = receiveMessageOnPort(port1)?.message;
    if (!response) {
        throw new Error('No response received from the PostgreSQL worker.');
    }
    if (response.error) {
        throw makeError(response.error);
    }
    return response.result;
}
class PreparedStatement {
    sql;
    constructor(sql) {
        this.sql = transformSql(sql);
    }
    all(...params) {
        return sendWorkerRequest({
            action: 'query',
            payload: { sql: this.sql, params, mode: 'all', txId: currentTransactionId },
        });
    }
    get(...params) {
        return sendWorkerRequest({
            action: 'query',
            payload: { sql: this.sql, params, mode: 'get', txId: currentTransactionId },
        });
    }
    run(...params) {
        return sendWorkerRequest({
            action: 'query',
            payload: { sql: this.sql, params, mode: 'run', txId: currentTransactionId },
        });
    }
}
const db = {
    prepare(sql) {
        return new PreparedStatement(sql);
    },
    exec(sql) {
        return sendWorkerRequest({
            action: 'exec',
            payload: { sql: transformSql(sql), txId: currentTransactionId },
        });
    },
    transaction(fn) {
        return (...args) => {
            const parentTransactionId = currentTransactionId;
            if (parentTransactionId) {
                return fn(...args);
            }
            const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            sendWorkerRequest({ action: 'begin', payload: { txId } });
            currentTransactionId = txId;
            try {
                const result = fn(...args);
                sendWorkerRequest({ action: 'commit', payload: { txId } });
                return result;
            }
            catch (error) {
                try {
                    sendWorkerRequest({ action: 'rollback', payload: { txId } });
                }
                catch (rollbackError) {
                    console.error('Failed to roll back PostgreSQL transaction:', rollbackError);
                }
                throw error;
            }
            finally {
                currentTransactionId = undefined;
            }
        };
    },
};
function columnExists(tableName, columnName) {
    return !!db
        .prepare(`SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ?
         AND column_name = ?`)
        .get(tableName, columnName);
}
function ensureColumn(tableName, columnName, definition) {
    if (!columnExists(tableName, columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}
function ensureSchema() {
    for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
        db.exec(statement);
    }
    for (const column of POSTGRES_OPTIONAL_COLUMNS) {
        ensureColumn(column.table, column.column, column.definition);
    }
    if (!columnExists('production_entries', 'sample_production') && columnExists('production_entries', 'sample_name')) {
        db.exec('ALTER TABLE production_entries RENAME COLUMN sample_name TO sample_production');
    }
    for (const statement of POSTGRES_INDEX_STATEMENTS) {
        db.exec(statement);
    }
}
function seedDefaultUsers() {
    const superAdminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('superadmin');
    const superAdminPassword = bcrypt.hashSync('superadmin123', 10);
    if (!superAdminExists) {
        db.prepare(`
      INSERT INTO users (id, username, full_name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('u0', 'superadmin', 'Super Administrator', 'super@example.com', superAdminPassword, 'super_admin', 1);
        db.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?)').run('u0', 'light');
    }
    else {
        db.prepare('UPDATE users SET password = ? WHERE username = ?').run(superAdminPassword, 'superadmin');
    }
    const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        const adminPassword = bcrypt.hashSync('admin123', 10);
        db.prepare(`
      INSERT INTO users (id, username, full_name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('u1', 'admin', 'System Administrator', 'admin@example.com', adminPassword, 'admin', 1);
        db.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?)').run('u1', 'light');
    }
}
function seedPermissions() {
    const permCount = db.prepare('SELECT COUNT(*) as count FROM role_permissions').get();
    if (permCount.count === 0) {
        const roles = ['super_admin', 'admin', 'hr', 'tl', 'member', 'payment_posting'];
        const modules = ['dashboard', 'production', 'targets', 'teams', 'users', 'settings'];
        for (const role of roles) {
            for (const module of modules) {
                let canView = 0;
                let canCreate = 0;
                let canEdit = 0;
                let canDelete = 0;
                if (role === 'super_admin') {
                    canView = canCreate = canEdit = canDelete = 1;
                }
                else if (role === 'admin') {
                    canView = canCreate = canEdit = canDelete = 1;
                }
                else if (role === 'tl') {
                    if (['dashboard', 'production', 'teams', 'users'].includes(module))
                        canView = 1;
                    if (module === 'production') {
                        canCreate = 1;
                        canEdit = 1;
                    }
                }
                else if (role === 'member') {
                    if (['dashboard', 'production', 'teams', 'users'].includes(module))
                        canView = 1;
                }
                else if (role === 'payment_posting') {
                    if (['dashboard', 'production', 'teams', 'users'].includes(module))
                        canView = 1;
                    if (module === 'production') {
                        canCreate = 1;
                        canEdit = 1;
                    }
                }
                else if (role === 'hr') {
                    if (['dashboard', 'users', 'teams'].includes(module))
                        canView = 1;
                    if (['users', 'teams'].includes(module)) {
                        canCreate = 1;
                        canEdit = 1;
                    }
                }
                db.prepare(`
          INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(role, module, canView, canCreate, canEdit, canDelete);
            }
        }
    }
    const paymentPostingPerms = db.prepare('SELECT COUNT(*) as count FROM role_permissions WHERE role = ?').get('payment_posting');
    if (paymentPostingPerms.count === 0) {
        const modules = ['dashboard', 'production', 'targets', 'teams', 'users', 'settings'];
        for (const module of modules) {
            let canView = 0;
            let canCreate = 0;
            let canEdit = 0;
            if (['dashboard', 'production', 'teams', 'users'].includes(module))
                canView = 1;
            if (module === 'production') {
                canCreate = 1;
                canEdit = 1;
            }
            db.prepare(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('payment_posting', module, canView, canCreate, canEdit, 0);
        }
    }
}
function seedSettings() {
    const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
    if (settingsCount.count === 0) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('company_name', 'Production Analyst');
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('notifications_enabled', 'true');
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('unlock_roles', 'super_admin,admin,hr');
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme_color', '#3bcf8d');
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'light');
    }
}
function seedTeams() {
    const standardDepts = ['AR', 'Charge Entry', 'Payment Posting', 'AR Analyst'];
    for (const dept of standardDepts) {
        const exists = db.prepare('SELECT id FROM teams WHERE name = ? AND parent_id IS NULL').get(dept);
        if (!exists) {
            db.prepare('INSERT INTO teams (id, name, description) VALUES (?, ?, ?)').run(uuidv4(), dept, `${dept} Department`);
        }
    }
    const arDept = db.prepare('SELECT id FROM teams WHERE name = ? AND parent_id IS NULL').get('AR');
    if (arDept) {
        const arTeams = ['AR - NY', 'AR - SSM'];
        for (const teamName of arTeams) {
            const exists = db.prepare('SELECT id FROM teams WHERE name = ? AND parent_id = ?').get(teamName, arDept.id);
            if (!exists) {
                const oldName = teamName.replace('AR - ', '');
                const oldExists = db.prepare('SELECT id FROM teams WHERE name = ? AND parent_id = ?').get(oldName, arDept.id);
                if (oldExists) {
                    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(teamName, oldExists.id);
                }
                else {
                    db.prepare('INSERT INTO teams (id, name, description, parent_id) VALUES (?, ?, ?, ?)').run(uuidv4(), teamName, `${oldName} Team`, arDept.id);
                }
            }
        }
    }
}
function normalizeAndCleanupTeams() {
    try {
        const allTeams = db.prepare('SELECT id, name, parent_id FROM teams').all();
        for (const team of allTeams) {
            if (!team.parent_id) {
                continue;
            }
            const parent = allTeams.find((candidate) => candidate.id === team.parent_id);
            if (!parent) {
                continue;
            }
            const prefix = `${parent.name} - `;
            if (!team.name.toUpperCase().startsWith(prefix.toUpperCase())) {
                const newName = `${prefix}${team.name}`;
                const exists = db.prepare('SELECT id FROM teams WHERE name = ? AND id != ?').get(newName, team.id);
                if (!exists) {
                    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(newName, team.id);
                }
            }
        }
        db.exec(`
      DELETE FROM teams
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY LOWER(name), COALESCE(parent_id, 'root')
                   ORDER BY
                     CASE WHEN team_leader_id IS NOT NULL THEN 0 ELSE 1 END,
                     CASE WHEN client_name IS NOT NULL THEN 0 ELSE 1 END,
                     created_at ASC
                 ) AS row_num
          FROM teams
        ) ranked
        WHERE ranked.row_num > 1
      )
    `);
    }
    catch (error) {
        console.error('Failed to cleanup duplicate teams:', error);
    }
}
function cleanupClients() {
    db.prepare("DELETE FROM clients WHERE name IN ('Client A', 'Client B', 'Client C')").run();
    db.prepare("UPDATE teams SET client_name = NULL WHERE client_name IN ('Client A', 'Client B', 'Client C')").run();
    db.prepare("UPDATE production_entries SET client_name = NULL WHERE client_name IN ('Client A', 'Client B', 'Client C')").run();
}
export function initDb() {
    try {
        db.prepare('SELECT 1 as connected').get();
        console.log('Connected to PostgreSQL');
    }
    catch (error) {
        console.error('Failed to connect to PostgreSQL', error);
        throw error;
    }
    ensureSchema();
    seedDefaultUsers();
    seedPermissions();
    seedSettings();
    seedTeams();
    normalizeAndCleanupTeams();
    cleanupClients();
}
export default db;
