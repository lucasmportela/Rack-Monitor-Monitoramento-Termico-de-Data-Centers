const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_RECORDS = Math.max(1, Math.min(500, Number.parseInt(process.env.HISTORY_MAX_RECORDS || "100", 10) || 100));
const HISTORY_FILE = path.resolve(process.env.HISTORY_FILE || path.join(__dirname, "data", "history.json"));

let pool = null;
if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    pool.on("error", (error) => console.error("Erro inesperado no pool PostgreSQL:", error.message));
}

let initialization;
let fileQueue = Promise.resolve();

function withFileLock(operation) {
    const result = fileQueue.then(operation, operation);
    fileQueue = result.then(() => undefined, () => undefined);
    return result;
}

async function initializeStorage() {
    if (pool) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rack_monitor_history (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                payload JSONB NOT NULL
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS rack_monitor_history_created_at_idx
            ON rack_monitor_history (created_at DESC, id DESC)
        `);
        return;
    }

    await withFileLock(async () => {
        await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
        try {
            JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
        } catch (error) {
            if (error.code !== "ENOENT") throw new Error("O arquivo local do histórico está inválido.");
            await fs.writeFile(HISTORY_FILE, "[]\n", "utf8");
        }
    });
}

async function ensureInitialized() {
    if (!initialization) {
        initialization = initializeStorage().catch((error) => {
            initialization = null;
            throw error;
        });
    }
    await initialization;
}

function obterInfoPersistencia() {
    const usaPostgres = Boolean(pool);
    const persistente = usaPostgres || process.env.NODE_ENV !== "production";
    return {
        tipo: usaPostgres ? "PostgreSQL" : "arquivo local",
        persistente,
        aviso: persistente ? null :
            "Armazenamento temporário do Render. Configure DATABASE_URL com PostgreSQL para preservar o histórico entre reinicializações e deploys."
    };
}

function normalizarRegistro(row) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    return { id: String(row.id), registradoEm: new Date(row.created_at).toISOString(), ...payload };
}

async function salvarHistorico(payload) {
    await ensureInitialized();

    if (pool) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                "INSERT INTO rack_monitor_history (payload) VALUES ($1::jsonb) RETURNING id, created_at, payload",
                [JSON.stringify(payload)]
            );
            await client.query(
                `DELETE FROM rack_monitor_history
                 WHERE id NOT IN (
                    SELECT id FROM rack_monitor_history
                    ORDER BY created_at DESC, id DESC LIMIT $1
                 )`,
                [MAX_RECORDS]
            );
            await client.query("COMMIT");
            return normalizarRegistro(result.rows[0]);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    return withFileLock(async () => {
        const registros = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
        const registro = { id: crypto.randomUUID(), registradoEm: new Date().toISOString(), ...payload };
        const atualizados = [registro, ...registros].slice(0, MAX_RECORDS);
        const temporario = `${HISTORY_FILE}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temporario, `${JSON.stringify(atualizados, null, 2)}\n`, "utf8");
        await fs.rename(temporario, HISTORY_FILE);
        return registro;
    });
}

async function listarHistorico(limite = 20) {
    await ensureInitialized();
    const quantidade = Math.min(100, Math.max(1, Number.parseInt(limite, 10) || 20));

    if (pool) {
        const result = await pool.query(
            "SELECT id, created_at, payload FROM rack_monitor_history ORDER BY created_at DESC, id DESC LIMIT $1",
            [quantidade]
        );
        return result.rows.map(normalizarRegistro);
    }

    return withFileLock(async () => {
        const registros = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
        return registros.slice(0, quantidade);
    });
}

module.exports = { listarHistorico, salvarHistorico, obterInfoPersistencia };
