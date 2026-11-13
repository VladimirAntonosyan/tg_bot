const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============ ИНИЦИАЛИЗАЦИЯ ============

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS clubs (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(chat_id, name)
            );

            CREATE TABLE IF NOT EXISTS national_teams (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(chat_id, name)
            );

            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                match_id INTEGER,
                date TIMESTAMP NOT NULL,
                tournament_type TEXT NOT NULL,
                player1 TEXT NOT NULL,
                player2 TEXT NOT NULL,
                team1 TEXT,
                team2 TEXT,
                score1 INTEGER NOT NULL,
                score2 INTEGER NOT NULL,
                penalties TEXT
            );

            CREATE TABLE IF NOT EXISTS tournaments (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                date TIMESTAMP NOT NULL,
                type TEXT NOT NULL,
                winner TEXT NOT NULL,
                winner_team TEXT,
                winner_points INTEGER,
                participants TEXT,
                matches TEXT
            );

            CREATE TABLE IF NOT EXISTS participants (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                participant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                username TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(chat_id, participant_id)
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                chat_id BIGINT PRIMARY KEY,
                tier TEXT DEFAULT 'free',
                purchased_at TIMESTAMP,
                payment_id TEXT,
                amount INTEGER
            );

            CREATE TABLE IF NOT EXISTS pending_payments (
                payment_id TEXT PRIMARY KEY,
                chat_id BIGINT NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_clubs_chat_id ON clubs(chat_id);
            CREATE INDEX IF NOT EXISTS idx_national_teams_chat_id ON national_teams(chat_id);
            CREATE INDEX IF NOT EXISTS idx_matches_chat_id ON matches(chat_id);
            CREATE INDEX IF NOT EXISTS idx_tournaments_chat_id ON tournaments(chat_id);
            CREATE INDEX IF NOT EXISTS idx_participants_chat_id ON participants(chat_id);
            CREATE INDEX IF NOT EXISTS idx_pending_payments_chat ON pending_payments(chat_id);
            CREATE INDEX IF NOT EXISTS idx_pending_payments_status ON pending_payments(status);

            -- 🔧 миграция: добавляем match_id, если таблица уже существовала без него
            ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_id INTEGER;
        `);
        console.log('✅ База данных инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
        throw error;
    }
}

// ============ УЧАСТНИКИ ============

async function getParticipants(chatId) {
    const result = await pool.query(
        'SELECT participant_id, name, username FROM participants WHERE chat_id = $1 ORDER BY id',
        [chatId]
    );
    return result.rows.map(r => ({
        id: r.participant_id,
        name: r.name,
        username: r.username
    }));
}

async function addParticipant(chatId, participantId, name, username = null) {
    try {
        await pool.query(
            'INSERT INTO participants (chat_id, participant_id, name, username) VALUES ($1, $2, $3, $4)',
            [chatId, participantId, name, username]
        );
        return true;
    } catch (error) {
        if (error.code === '23505') return false;
        throw error;
    }
}

async function removeParticipant(chatId, participantId) {
    const result = await pool.query(
        'DELETE FROM participants WHERE chat_id = $1 AND participant_id = $2',
        [chatId, participantId]
    );
    return result.rowCount > 0;
}

async function clearParticipants(chatId) {
    await pool.query('DELETE FROM participants WHERE chat_id = $1', [chatId]);
}

async function hasParticipants(chatId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM participants WHERE chat_id = $1',
        [chatId]
    );
    return parseInt(result.rows[0].count) > 0;
}

// ============ КЛУБЫ ============

async function getClubs(chatId) {
    const result = await pool.query(
        'SELECT name FROM clubs WHERE chat_id = $1 ORDER BY id',
        [chatId]
    );
    return result.rows.map(r => r.name);
}

async function addClub(chatId, name) {
    try {
        await pool.query('INSERT INTO clubs (chat_id, name) VALUES ($1, $2)', [chatId, name]);
        return true;
    } catch (error) {
        if (error.code === '23505') return false;
        throw error;
    }
}

async function removeClub(chatId, name) {
    const result = await pool.query(
        'DELETE FROM clubs WHERE chat_id = $1 AND name = $2',
        [chatId, name]
    );
    return result.rowCount > 0;
}

async function setClubs(chatId, names) {
    // 🔧 фикс: батч-вставка вместо N запросов
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM clubs WHERE chat_id = $1', [chatId]);

        if (names.length > 0) {
            const values = names.map((_, i) => `($1, $${i + 2})`).join(',');
            const params = [chatId, ...names];
            await client.query(
                `INSERT INTO clubs (chat_id, name) VALUES ${values} ON CONFLICT DO NOTHING`,
                params
            );
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// ============ СБОРНЫЕ ============

async function getNationalTeams(chatId) {
    const result = await pool.query(
        'SELECT name FROM national_teams WHERE chat_id = $1 ORDER BY id',
        [chatId]
    );
    return result.rows.map(r => r.name);
}

async function addNationalTeam(chatId, name) {
    try {
        await pool.query('INSERT INTO national_teams (chat_id, name) VALUES ($1, $2)', [chatId, name]);
        return true;
    } catch (error) {
        if (error.code === '23505') return false;
        throw error;
    }
}

async function removeNationalTeam(chatId, name) {
    const result = await pool.query(
        'DELETE FROM national_teams WHERE chat_id = $1 AND name = $2',
        [chatId, name]
    );
    return result.rowCount > 0;
}

async function setNationalTeams(chatId, names) {
    // 🔧 фикс: батч-вставка
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM national_teams WHERE chat_id = $1', [chatId]);

        if (names.length > 0) {
            const values = names.map((_, i) => `($1, $${i + 2})`).join(',');
            const params = [chatId, ...names];
            await client.query(
                `INSERT INTO national_teams (chat_id, name) VALUES ${values} ON CONFLICT DO NOTHING`,
                params
            );
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// ============ МАТЧИ ============

async function recordMatch(chatId, match, participants, tournamentType) {
    const player1Data = participants.find(p => p.name === match.player1);
    const player2Data = participants.find(p => p.name === match.player2);

    await pool.query(
        `INSERT INTO matches (chat_id, match_id, date, tournament_type, player1, player2, team1, team2, score1, score2, penalties)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
            chatId,
            match.id ?? null,
            new Date().toISOString(),
            tournamentType,
            match.player1,
            match.player2,
            player1Data ? player1Data.team : null,
            player2Data ? player2Data.team : null,
            match.score1,
            match.score2,
            match.penalties
        ]
    );
}

/**
 * 🔧 НОВОЕ: обновление матча при редактировании.
 * Ищем последнюю запись по (chat_id, player1, player2) и перезаписываем счёт/пенальти.
 * Так избегаем дублирования статистики.
 */
async function updateMatch(chatId, match) {
    const result = await pool.query(
        `UPDATE matches
         SET score1 = $1, score2 = $2, penalties = $3
         WHERE id = (
             SELECT id FROM matches
             WHERE chat_id = $4 AND player1 = $5 AND player2 = $6
             ORDER BY date DESC
             LIMIT 1
         )`,
        [match.score1, match.score2, match.penalties, chatId, match.player1, match.player2]
    );
    return result.rowCount > 0;
}

async function getAllMatches(chatId) {
    const result = await pool.query(
        'SELECT * FROM matches WHERE chat_id = $1 ORDER BY date ASC',
        [chatId]
    );
    return result.rows.map(r => ({
        id: r.match_id,                 // 🔧 match_id из турнира (может быть null у старых записей)
        dbId: r.id,                     // SERIAL id — на всякий случай
        date: r.date,
        tournamentType: r.tournament_type,
        player1: r.player1,
        player2: r.player2,
        team1: r.team1,
        team2: r.team2,
        score1: r.score1,
        score2: r.score2,
        penalties: r.penalties
    }));
}

// ============ ТУРНИРЫ ============

async function recordTournament(chatId, tournament, winner) {
    await pool.query(
        `INSERT INTO tournaments (chat_id, date, type, winner, winner_team, winner_points, participants, matches)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            chatId,
            new Date().toISOString(),
            tournament.type,
            winner.name,
            winner.team,
            winner.points,
            JSON.stringify(tournament.participants),
            JSON.stringify(tournament.matches)
        ]
    );
}

async function getAllTournaments(chatId) {
    const result = await pool.query(
        'SELECT * FROM tournaments WHERE chat_id = $1 ORDER BY date ASC',
        [chatId]
    );
    return result.rows.map(r => ({
        date: r.date,
        type: r.type,
        winner: r.winner,
        winnerTeam: r.winner_team,
        winnerPoints: r.winner_points,
        participants: JSON.parse(r.participants || '[]'),
        matches: JSON.parse(r.matches || '[]')
    }));
}

async function getTournamentCount(chatId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM tournaments WHERE chat_id = $1',
        [chatId]
    );
    return parseInt(result.rows[0].count);
}

// ============ ПОДПИСКИ ============

async function getSubscription(chatId) {
    const result = await pool.query(
        'SELECT * FROM subscriptions WHERE chat_id = $1',
        [chatId]
    );
    if (result.rows.length === 0) return { tier: 'free' };
    return result.rows[0];
}

async function setSubscription(chatId, tier, paymentId = null, amount = null) {
    await pool.query(
        `INSERT INTO subscriptions (chat_id, tier, purchased_at, payment_id, amount)
         VALUES ($1, $2, NOW(), $3, $4)
         ON CONFLICT (chat_id) DO UPDATE SET
            tier = EXCLUDED.tier,
            purchased_at = EXCLUDED.purchased_at,
            payment_id = EXCLUDED.payment_id,
            amount = EXCLUDED.amount`,
        [chatId, tier, paymentId, amount]
    );
}

// ============ ПЛАТЕЖИ ============

async function savePendingPayment(paymentId, chatId, amount) {
    await pool.query(
        `INSERT INTO pending_payments (payment_id, chat_id, amount, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (payment_id) DO NOTHING`,
        [paymentId, chatId, amount]
    );
}

async function getPendingPayment(paymentId) {
    const result = await pool.query(
        'SELECT * FROM pending_payments WHERE payment_id = $1',
        [paymentId]
    );
    return result.rows[0] || null;
}

async function getPendingPaymentsByChat(chatId) {
    const result = await pool.query(
        `SELECT * FROM pending_payments
         WHERE chat_id = $1 AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 5`,
        [chatId]
    );
    return result.rows;
}

async function updatePaymentStatus(paymentId, status) {
    await pool.query(
        'UPDATE pending_payments SET status = $1 WHERE payment_id = $2',
        [status, paymentId]
    );
}

// ============ УТИЛИТЫ ============

async function isDatabaseEmpty(chatId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM clubs WHERE chat_id = $1',
        [chatId]
    );
    return parseInt(result.rows[0].count) === 0;
}

async function closePool() {
    await pool.end();
}

// ============ ЭКСПОРТ ============

module.exports = {
    // Init
    initDatabase,
    closePool,

    // Participants
    getParticipants, addParticipant, removeParticipant, clearParticipants, hasParticipants,

    // Clubs
    getClubs, addClub, removeClub, setClubs,

    // National teams
    getNationalTeams, addNationalTeam, removeNationalTeam, setNationalTeams,

    // Matches
    recordMatch, updateMatch, getAllMatches,

    // Tournaments
    recordTournament, getAllTournaments, getTournamentCount,

    // Subscriptions
    getSubscription, setSubscription,

    // Payments
    savePendingPayment, getPendingPayment, getPendingPaymentsByChat, updatePaymentStatus,

    // Utils
    isDatabaseEmpty
};
