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
            
            CREATE INDEX IF NOT EXISTS idx_clubs_chat_id ON clubs(chat_id);
            CREATE INDEX IF NOT EXISTS idx_national_teams_chat_id ON national_teams(chat_id);
            CREATE INDEX IF NOT EXISTS idx_matches_chat_id ON matches(chat_id);
            CREATE INDEX IF NOT EXISTS idx_tournaments_chat_id ON tournaments(chat_id);
            CREATE INDEX IF NOT EXISTS idx_participants_chat_id ON participants(chat_id);
        `);
        console.log('✅ База данных инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
        throw error;
    }
}

// ============ УЧАСТНИКИ (participants) ============

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
        if (error.code === '23505') return false; // уже есть
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
        if (error.code === '23505') return false; // уже есть
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
    // Используется при онбординге
    await pool.query('DELETE FROM clubs WHERE chat_id = $1', [chatId]);
    for (const name of names) {
        await pool.query(
            'INSERT INTO clubs (chat_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [chatId, name]
        );
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

async function setNationalTeams(chatId, names) {
    await pool.query('DELETE FROM national_teams WHERE chat_id = $1', [chatId]);
    for (const name of names) {
        await pool.query(
            'INSERT INTO national_teams (chat_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [chatId, name]
        );
    }
}

async function addNationalTeam(chatId, name) {
    try {
        await pool.query('INSERT INTO national_teams (chat_id, name) VALUES ($1, $2)', [chatId, name]);
        return true;
    } catch (error) {
        if (error.code === '23505') return false; // уже есть
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

// ============ МАТЧИ ============

async function recordMatch(chatId, match, participants, tournamentType) {
    const player1Data = participants.find(p => p.name === match.player1);
    const player2Data = participants.find(p => p.name === match.player2);
    
    await pool.query(
        `INSERT INTO matches (chat_id, date, tournament_type, player1, player2, team1, team2, score1, score2, penalties)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            chatId,
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

async function getAllMatches(chatId) {
    const result = await pool.query(
        'SELECT * FROM matches WHERE chat_id = $1 ORDER BY date ASC',
        [chatId]
    );
    return result.rows.map(r => ({
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

// ============ ПОДПИСКИ (для будущей монетизации) ============

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

async function isDatabaseEmpty(chatId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM clubs WHERE chat_id = $1',
        [chatId]
    );
    return parseInt(result.rows[0].count) === 0;
}

module.exports = {
    initDatabase,
    // Participants
    getParticipants, addParticipant, removeParticipant, clearParticipants, hasParticipants,
    // Clubs
    getClubs, addClub, removeClub, setClubs,
    // National teams
    getNationalTeams, setNationalTeams, addNationalTeam, removeNationalTeam,
    // Matches
    recordMatch, getAllMatches,
    // Tournaments
    recordTournament, getAllTournaments, getTournamentCount,
    // Subscriptions
    getSubscription, setSubscription,
    // Utils
    isDatabaseEmpty
};
