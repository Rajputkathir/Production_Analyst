import { parentPort } from 'node:worker_threads';
import { Pool, types } from 'pg';
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number.parseFloat(value));
const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
const useSsl = process.env.PGSSL === 'true' || ['require', 'verify-ca', 'verify-full'].includes(sslMode);
const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: String(process.env.PGPASSWORD ?? ''),
        database: process.env.PGDATABASE || 'production_analyst',
    };
if (useSsl) {
    poolConfig.ssl = {
        rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true',
    };
}
const pool = new Pool(poolConfig);
const transactionClients = new Map();
let responsePort = null;
function splitStatements(sql) {
    const statements = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i];
        const next = sql[i + 1];
        if (char === "'" && !inDoubleQuote) {
            current += char;
            if (inSingleQuote && next === "'") {
                current += next;
                i += 1;
            }
            else {
                inSingleQuote = !inSingleQuote;
            }
            continue;
        }
        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char;
            continue;
        }
        if (char === ';' && !inSingleQuote && !inDoubleQuote) {
            if (current.trim()) {
                statements.push(current.trim());
            }
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim()) {
        statements.push(current.trim());
    }
    return statements;
}
function serializeError(error) {
    return {
        message: error instanceof Error ? error.message : String(error),
        code: error && typeof error === 'object' ? error.code : undefined,
        detail: error && typeof error === 'object' ? error.detail : undefined,
        stack: error instanceof Error ? error.stack : undefined,
    };
}
async function runQuery({ sql, params = [], mode = 'all', txId }) {
    const executor = txId ? transactionClients.get(txId) : pool;
    if (!executor) {
        throw new Error(`Transaction ${txId} is not active.`);
    }
    const result = await executor.query(sql, params);
    if (mode === 'get') {
        return result.rows[0];
    }
    if (mode === 'run') {
        return {
            changes: result.rowCount ?? 0,
        };
    }
    return result.rows;
}
async function runExec({ sql, txId }) {
    const executor = txId ? transactionClients.get(txId) : pool;
    if (!executor) {
        throw new Error(`Transaction ${txId} is not active.`);
    }
    let lastResult = { changes: 0 };
    const statements = splitStatements(sql);
    for (const statement of statements) {
        const result = await executor.query(statement);
        lastResult = { changes: result.rowCount ?? 0 };
    }
    return lastResult;
}
async function beginTransaction({ txId }) {
    if (transactionClients.has(txId)) {
        throw new Error(`Transaction ${txId} is already active.`);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        transactionClients.set(txId, client);
    }
    catch (error) {
        client.release();
        throw error;
    }
    return { changes: 0 };
}
async function endTransaction({ txId, action }) {
    const client = transactionClients.get(txId);
    if (!client) {
        throw new Error(`Transaction ${txId} is not active.`);
    }
    try {
        await client.query(action);
    }
    finally {
        transactionClients.delete(txId);
        client.release();
    }
    return { changes: 0 };
}
async function handleRequest(message) {
    const { action, payload } = message;
    if (action === 'query') {
        return runQuery(payload);
    }
    if (action === 'exec') {
        return runExec(payload);
    }
    if (action === 'begin') {
        return beginTransaction(payload);
    }
    if (action === 'commit') {
        return endTransaction({ txId: payload.txId, action: 'COMMIT' });
    }
    if (action === 'rollback') {
        return endTransaction({ txId: payload.txId, action: 'ROLLBACK' });
    }
    if (action === 'close') {
        for (const [txId] of transactionClients) {
            await endTransaction({ txId, action: 'ROLLBACK' });
        }
        await pool.end();
        return { changes: 0 };
    }
    throw new Error(`Unsupported worker action: ${action}`);
}
parentPort.on('message', async (message) => {
    if (message.type === 'init-port') {
        responsePort = message.port;
        return;
    }
    if (!responsePort) {
        throw new Error('Response port has not been initialized.');
    }
    const signal = new Int32Array(message.signalBuffer);
    try {
        const result = await handleRequest(message);
        responsePort.postMessage({ result });
    }
    catch (error) {
        responsePort.postMessage({ error: serializeError(error) });
    }
    finally {
        Atomics.store(signal, 0, 1);
        Atomics.notify(signal, 0, 1);
    }
});
